import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alignWords, estimateWords } from './align.js';
import { detectLayout, isVideoFile, normalizeLoudness, probeDuration, stage, stageBackdrop } from './media.js';
import { type Brand, type Project, type ProjectInput, parseBrand, parseProject, type RenderResult, type RetentionWarning } from './project.js';
import { renderWithRemotion } from './remotion-render.js';
import type { RenderScene, Theme, VideoProps } from './remotion/types.js';
import { BUILTIN_SFX, builtinSfx } from './sfx.js';
import { type VoiceProvider, voiceFromConfig } from './tts/voice.js';

export interface RenderOptions {
  /** Folder relative paths in the project resolve against. Default: the current folder. */
  baseDir?: string;
  /** Output video. Default: `<baseDir>/out/<title or "video">.mp4`. */
  out?: string;
  /** Output cover (JPEG). Default: next to the video, `-cover.jpg`. */
  cover?: string;
  /** Re-voice instead of using cached takes: every scene (true) or the listed scene ids. */
  fresh?: boolean | number[];
  /** Your own voice provider instead of the project's `voice`. */
  voice?: VoiceProvider;
  /** Scratch folder for staged files (a fresh subfolder is made and removed). Default: the OS temp folder. */
  workDir?: string;
  /** TTS cache folder. Default ~/.cache/cutsmith/tts or $CUTSMITH_CACHE_DIR. */
  cacheDir?: string;
  /** Browser tabs rendering at once. Default: Remotion's (half the CPU cores). */
  concurrency?: number | null;
  browserExecutable?: string;
}

const FPS = 30;
const SIZES = { vertical: { width: 1080, height: 1920 }, landscape: { width: 1920, height: 1080 } } as const;
/** Words in scene 1's first sentence: ~12 words at ~165 words a minute is about 3 seconds. */
const MAX_SPOKEN_HOOK_WORDS = 12;

const isUrl = (s: string) => /^https?:\/\//i.test(s);
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'video';

/** Where a project's video goes when no `out` is given: `<baseDir>/out/<title>.mp4`. */
export function defaultVideoPath(project: Pick<Project, 'title'>, baseDir: string): string {
  return path.join(baseDir, 'out', `${slugify(project.title ?? 'video')}.mp4`);
}

/** A path, a URL, or a bare name found in baseDir or one of assetDirs. */
function resolveFile(name: string, dirs: string[]): string | null {
  if (isUrl(name)) return name;
  if (path.isAbsolute(name)) return fs.existsSync(name) ? name : null;
  for (const dir of dirs) {
    const candidate = path.resolve(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function loadBrand(brand: Project['brand'], baseDir: string): { brand: Brand; dir: string } {
  if (typeof brand === 'string') {
    const file = path.resolve(baseDir, brand);
    return { brand: parseBrand(JSON.parse(fs.readFileSync(file, 'utf-8'))), dir: path.dirname(file) };
  }
  return { brand: parseBrand(brand ?? {}), dir: baseDir };
}

function buildTheme(brand: Brand, brandDir: string, publicDir: string): Theme {
  const font = brand.font;
  const fontFaces = (font?.files ?? []).map((f, i) => {
    const file = resolveFile(f.src, [brandDir]);
    if (!file || isUrl(file)) throw new Error(`Brand font ${f.src} not found next to the brand file`);
    return { family: font!.family, uri: stage(file, publicDir, `font_${i}`), weight: f.weight, style: f.style };
  });
  const logo = brand.logo ? resolveFile(brand.logo, [brandDir]) : null;
  if (brand.logo && !logo) throw new Error(`Brand logo ${brand.logo} not found next to the brand file`);
  const family = font?.googleFont ? font.googleFont.split(':')[0] : font?.family;
  const fallback = font?.fallback ?? "-apple-system, 'Segoe UI', Roboto, sans-serif";
  return {
    colors: brand.colors,
    fontStack: family ? `'${family}', ${fallback}` : fallback,
    fontFaces,
    fontCss: font?.googleFont ? `https://fonts.googleapis.com/css2?family=${font.googleFont.replace(/ /g, '+')}&display=block` : undefined,
    logoUri: logo ? (isUrl(logo) ? logo : stage(logo, publicDir, 'logo')) : undefined,
  };
}

/**
 * Short-form retention checks (vertical only). Never blocks: Shorts and Reels rank on completion,
 * sends and saves, so flag scripts that miss the basics.
 */
export function lintRetention(scenes: RenderScene[], { maxSeconds = 60 }: { maxSeconds?: number } = {}): RetentionWarning[] {
  const warnings: RetentionWarning[] = [];
  const first = scenes[0];
  if (!first) return warnings;

  const hookWords = first.hookText?.trim().split(/\s+/).length ?? 0;
  if (!first.hookText) warnings.push({ code: 'NO_HOOK_TEXT', message: 'Scene 1 has no hookText. Add a <= 6 word on-screen hook so the first 1.5 s stops the scroll.' });
  else if (hookWords > 6) warnings.push({ code: 'LONG_HOOK_TEXT', message: `hookText is ${hookWords} words; keep it <= 6 so it reads in ~1 s.` });

  const spoken = first.text.trim().split(/(?<=[.!?])\s+/)[0].split(/\s+/).filter(Boolean).length;
  if (spoken > MAX_SPOKEN_HOOK_WORDS) {
    warnings.push({ code: 'SLOW_SPOKEN_HOOK', message: `Scene 1's first sentence is ${spoken} words (~${(spoken / 2.75).toFixed(0)} s); keep it <= ${MAX_SPOKEN_HOOK_WORDS} so the hook lands in ~3 s.` });
  }
  if (scenes.slice(0, 2).every((s) => !s.isVideo && s.layout !== 'fullbleed')) {
    warnings.push({ code: 'STATIC_OPENING', message: 'Scenes 1-2 are both static framed images. Use a clip or a full-bleed visual in the first ~6 s.' });
  }
  for (const s of scenes) {
    if (s.durationSec > 9 && !s.isVideo) {
      warnings.push({ code: 'LONG_STATIC_SCENE', message: `Scene ${s.id} shows one still for ${s.durationSec.toFixed(1)} s. Split it (visuals should change every 3-5 s).` });
    }
  }
  const total = scenes.reduce((sum, s) => sum + s.durationSec, 0);
  if (total > maxSeconds) warnings.push({ code: 'TOO_LONG', message: `Total ${total.toFixed(1)} s is over ${maxSeconds} s. Shorts/Reels do best at 20-45 s.` });
  if (total < 15) warnings.push({ code: 'TOO_SHORT', message: `Total ${total.toFixed(1)} s is very short; make sure the payoff still lands.` });
  const tail = scenes.slice(-2).map((s) => s.text).join(' ');
  if (!/share|save|send|forward|follow|subscribe|comment|bhej|शेयर|सेव|भेज/i.test(tail)) {
    warnings.push({ code: 'NO_CTA', message: 'The last scenes ask for nothing. Sends, saves and follows are the strongest ranking signals.' });
  }
  return warnings;
}

/** Renders a project to an MP4 and a JPEG cover. Throws on anything that would make a broken video. */
export async function render(input: ProjectInput | Project, options: RenderOptions = {}): Promise<RenderResult> {
  const project = parseProject(input);
  const baseDir = path.resolve(options.baseDir ?? process.cwd());
  const dirs = [baseDir, ...project.assetDirs.map((d) => path.resolve(baseDir, d))];
  const canvas = SIZES[project.format];
  const out = path.resolve(options.out ?? defaultVideoPath(project, baseDir));
  const cover = path.resolve(options.cover ?? out.replace(/\.mp4$/i, '') + '-cover.jpg');
  const voice = options.voice ?? voiceFromConfig(project.voice, options.cacheDir);

  const scratchRoot = options.workDir ?? os.tmpdir();
  fs.mkdirSync(scratchRoot, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(scratchRoot, 'cutsmith-'));
  const publicDir = path.join(workDir, 'public');
  fs.mkdirSync(publicDir);

  try {
    const { brand, dir: brandDir } = loadBrand(project.brand, baseDir);
    const theme = buildTheme(brand, brandDir, publicDir);
    const scenes: RenderScene[] = [];
    const missingVisuals: number[] = [];

    /** A sound name: a local file from `sounds` first, then a built-in, then a file path or URL. */
    const resolveSound = (name: string, stageAs: string): { src: string; volume: number } => {
      const builtin = builtinSfx(name);
      const local = project.sounds[name];
      const file = local ? resolveFile(local, dirs) : builtin ? null : resolveFile(name, dirs);
      if (local && !file) throw new Error(`Sound file ${local} (sounds.${name}) not found`);
      if (!file && !builtin) throw new Error(`Sound "${name}" is not a built-in (${Object.keys(BUILTIN_SFX).join(', ')}), a file or a URL`);
      const volume = builtin?.volume ?? 0.22;
      if (!file) return { src: builtin!.src, volume };
      return { src: isUrl(file) ? file : stage(file, publicDir, stageAs), volume };
    };
    console.log(`[cutsmith] 🚀 ${project.title ?? 'video'}: ${project.scenes.length} scenes, ${project.format}`);

    for (const scene of project.scenes) {
      // The scene's own recording, or a voiced take of its line.
      let audio: string;
      if (scene.audio) {
        const own = resolveFile(scene.audio, dirs);
        if (!own || isUrl(own)) throw new Error(`Scene ${scene.id}: audio ${scene.audio} not found`);
        audio = own;
      } else {
        audio = path.join(workDir, `voice_${scene.id}.mp3`);
        const fresh = options.fresh === true || (Array.isArray(options.fresh) && options.fresh.includes(scene.id));
        await voice.speak(scene.text, audio, { fresh });
      }
      const durationSec = probeDuration(audio);

      const visual = scene.visual ? resolveFile(scene.visual, dirs) : null;
      if (scene.visual && !visual) console.warn(`[cutsmith] ⚠️  Scene ${scene.id}: ${scene.visual} not found (shown as VISUAL NEEDED)`);
      if (!visual) missingVisuals.push(scene.id);
      const isVideo = visual ? isVideoFile(visual.split('?')[0]) : false;
      // The file's shape decides unless the project says otherwise.
      const layout = visual ? (scene.layout ?? detectLayout(visual, canvas)) : undefined;

      // A silent draft take has nothing to measure; real speech is aligned to its pauses.
      const silent = !scene.audio && !options.voice && project.voice.provider === 'none';
      const words = silent ? estimateWords(scene.text, durationSec) : alignWords(scene.text, durationSec, audio);
      const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      const cueAt = (cue?: string): number | undefined => {
        if (!cue) return undefined;
        const hit = words.find((w) => norm(w.word) === norm(cue));
        if (!hit) console.warn(`[cutsmith] ⚠️  Scene ${scene.id}: cue word "${cue}" is not in its narration`);
        return hit?.start;
      };
      const panStart = cueAt(scene.panCue?.[0]);
      const panEnd = cueAt(scene.panCue?.[1]);

      let sfx: RenderScene['sfx'];
      if (scene.sfx) {
        const at = cueAt(scene.sfx.cue);
        const sound = resolveSound(scene.sfx.sound, `sfx_${scene.id}`);
        if (at !== undefined) sfx = { src: sound.src, volume: scene.sfx.volume ?? sound.volume, startSec: at };
      }

      scenes.push({
        id: scene.id,
        text: scene.text,
        badge: scene.badge,
        assetUri: visual ? (isUrl(visual) ? visual : stage(visual, publicDir, `scene_${scene.id}_visual`)) : '',
        backdropUri: visual && !isVideo && layout !== 'fullbleed' ? stageBackdrop(visual, publicDir, `scene_${scene.id}_backdrop`) : undefined,
        audioUri: stage(audio, publicDir, `scene_${scene.id}_audio`),
        isVideo,
        clipDurationInFrames: isVideo && !isUrl(visual!) ? Math.round(probeDuration(visual!) * FPS) : undefined,
        layout,
        panY: scene.panY,
        missing: !visual,
        neededVisual: visual ? undefined : scene.visualNeeded || `Visual for scene ${scene.id}`,
        durationSec,
        badgeStartSec: cueAt(scene.badgeCue),
        panRangeSec: panStart !== undefined && panEnd !== undefined && panEnd > panStart ? [panStart, panEnd] : undefined,
        durationInFrames: Math.round(durationSec * FPS),
        words,
        hookText: scene.hookText?.trim() || undefined,
        hookTone: scene.hookText ? scene.hookTone : undefined,
        hookPosition: scene.hookText ? scene.hookPosition : undefined,
        sfx,
        hideSubtitles: scene.hideSubtitles,
      });
    }

    const warnings = project.lint && project.format === 'vertical' ? lintRetention(scenes, typeof project.lint === 'object' ? project.lint : {}) : [];
    for (const w of warnings) console.log(`[cutsmith] 📉 [${w.code}] ${w.message}`);

    let musicUri: string | undefined;
    if (project.music) {
      const music = resolveFile(project.music.file, dirs);
      if (!music) throw new Error(`Music ${project.music.file} not found`);
      musicUri = isUrl(music) ? music : stage(music, publicDir, 'music');
    }

    const endCard = project.endCard || undefined;
    const props: VideoProps = {
      ...canvas,
      fps: FPS,
      scenes,
      theme,
      musicUri,
      musicVolume: project.music?.volume ?? 0.025,
      endCard: endCard && { ...endCard },
      whooshUri: project.transitions.whoosh ? resolveSound('whoosh', 'whoosh').src : undefined,
      progressBar: project.progressBar,
      subtitles: project.subtitles,
    };
    await renderWithRemotion(props, out, { publicDir, coverPath: cover, concurrency: options.concurrency, browserExecutable: options.browserExecutable });
    normalizeLoudness(out);
    console.log(`[cutsmith] ✅ ${out}`);

    let start = 0;
    return {
      video: out,
      cover,
      durationSec: +scenes.reduce((sum, s) => sum + s.durationInFrames / FPS, 0).toFixed(2),
      missingVisuals,
      warnings,
      scenes: scenes.map((s) => {
        const time = { id: s.id, start: +start.toFixed(2), end: +(start + s.durationInFrames / FPS).toFixed(2) };
        start += s.durationInFrames / FPS;
        return time;
      }),
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
