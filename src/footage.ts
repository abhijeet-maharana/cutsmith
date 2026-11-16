import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output, transcribe, type UserContent } from 'ai';
import { z } from 'zod';
import { ffmpeg, probeDuration } from './media.js';
import type { Scene } from './project.js';

/**
 * Videos cut from your own recording, with your real voice instead of TTS.
 *
 * 1. `prepareFootage`: the voice is cleaned (rumble and hiss off, levels evened out), split into chunks
 *    at the pauses (so every cut lands in a pause), and every chunk is transcribed.
 * 2. You or your agent decide the edit: which chunks to keep, in what order, grouped into scenes.
 * 3. `cutFootage`: each scene's chunks are cut and joined into a clip plus its voice, with a 30 ms fade
 *    at every cut so joins don't click. The render then uses the clip as the visual (muted) and the
 *    voice instead of TTS.
 */

export interface FootageChunk {
  id: number;
  start: number;
  end: number;
  /** Verbatim transcript; empty when there is no speech. */
  text: string;
}

export interface PreparedFootage {
  /** The raw clip and the cleaned voice (absolute paths). */
  source: string;
  voice: string;
  durationSec: number;
  chunks: FootageChunk[];
}

/** One scene of the edit: chunk ids in playing order, plus optional on-screen extras. */
export const EditSceneSchema = z.object({
  chunks: z.array(z.number().int()).min(1),
  hookText: z.string().optional(),
  badge: z.string().optional(),
  badgeCue: z.string().optional(),
  sfx: z.object({ sound: z.string(), cue: z.string(), volume: z.number().optional() }).optional(),
});
export const EditSchema = z.object({ scenes: z.array(EditSceneSchema).min(1) });
export type EditScene = z.infer<typeof EditSceneSchema>;

export const TranscriberSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('whisper').describe('Any OpenAI-compatible /v1/audio/transcriptions endpoint (OpenAI, Groq, a local faster-whisper server).'),
    baseURL: z.string().optional(),
    apiKeyEnv: z.string().default('OPENAI_API_KEY'),
    model: z.string().default('whisper-1'),
    language: z.string().optional().describe('ISO-639-1 hint, e.g. "en".'),
  }),
  z.object({
    kind: z.literal('chat').describe('A chat model that takes audio (e.g. Gemini behind an OpenAI-compatible proxy). Better at mixed languages such as Hinglish in Roman script.'),
    baseURL: z.string().optional(),
    apiKeyEnv: z.string().default('OPENAI_API_KEY'),
    model: z.string(),
    instructions: z.string().optional().describe('Extra transcription rules, e.g. the script to write a language in.'),
  }),
]);
export type Transcriber = z.infer<typeof TranscriberSchema>;

const MIN_PAUSE_SEC = 0.25;
/** Kept around each stretch of speech so word starts and endings aren't clipped. */
const PAD_SEC = 0.12;
const MIN_CHUNK_SEC = 0.3;
const FADE_SEC = 0.03;
/** Chunks per transcription call for chat models. */
const CHAT_BATCH = 40;

function analyse(file: string, filter: string): string {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', filter, '-f', 'null', '-'], { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`ffmpeg ${filter} failed: ${String(run.stderr || run.error?.message).trim().slice(-300)}`);
  return run.stderr;
}

function hasAudio(file: string): boolean {
  const run = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf-8' });
  return !!run.stdout.trim();
}

/** Stretches of speech between pauses of MIN_PAUSE_SEC, with the threshold set from the clip's own level. */
export function speechRanges(voice: string, duration: number): Array<{ start: number; end: number }> {
  const mean = analyse(voice, 'volumedetect').match(/mean_volume:\s*(-?[\d.]+) dB/);
  const threshold = Math.min(-25, Math.max(-50, (mean ? parseFloat(mean[1]) : -30) - 14));
  const out = analyse(voice, `silencedetect=noise=${threshold}dB:d=${MIN_PAUSE_SEC}`);

  const silences: Array<{ start: number; end: number }> = [];
  let open: number | null = null;
  for (const line of out.split('\n')) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (s) open = Math.max(0, parseFloat(s[1]));
    if (e && open !== null) {
      silences.push({ start: open, end: parseFloat(e[1]) });
      open = null;
    }
  }
  if (open !== null) silences.push({ start: open, end: duration });

  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const silence of [...silences, { start: duration, end: duration }]) {
    if (silence.start - cursor >= MIN_CHUNK_SEC) ranges.push({ start: cursor, end: silence.start });
    cursor = silence.end;
  }
  // Pad each range into the pauses around it, never past halfway to the next one.
  return ranges.map((r, i) => {
    const prevEnd = i > 0 ? ranges[i - 1].end : 0;
    const nextStart = i < ranges.length - 1 ? ranges[i + 1].start : duration;
    return {
      start: +Math.max(r.start - PAD_SEC, (prevEnd + r.start) / 2, 0).toFixed(3),
      end: +Math.min(r.end + PAD_SEC, (r.end + nextStart) / 2, duration).toFixed(3),
    };
  });
}

async function transcribeChunks(files: Array<{ id: number; file: string }>, config: Transcriber): Promise<Map<number, string>> {
  const provider = createOpenAI({ name: 'cutsmith-transcribe', baseURL: config.baseURL, apiKey: process.env[config.apiKeyEnv] });
  if (!process.env[config.apiKeyEnv]) throw new Error(`No transcription key: set the ${config.apiKeyEnv} environment variable`);
  const texts = new Map<number, string>();

  if (config.kind === 'whisper') {
    for (const { id, file } of files) {
      const { text } = await transcribe({
        model: provider.transcription(config.model),
        audio: fs.readFileSync(file),
        providerOptions: config.language ? { openai: { language: config.language } } : undefined,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(120_000),
      });
      texts.set(id, text.trim());
    }
    return texts;
  }

  const schema = z.object({ chunks: z.array(z.object({ id: z.number().int(), text: z.string().describe('Verbatim speech, fillers included. Empty string if there is no speech.') })) });
  for (let i = 0; i < files.length; i += CHAT_BATCH) {
    const content: UserContent = [];
    for (const { id, file } of files.slice(i, i + CHAT_BATCH)) {
      content.push({ type: 'text', text: `Chunk ${id}:` }, { type: 'file', data: fs.readFileSync(file).toString('base64'), mediaType: 'audio/mpeg' });
    }
    const { output } = await generateText({
      model: provider.chat(config.model),
      output: Output.object({ schema }),
      instructions: [
        'You transcribe numbered audio chunks cut from one recording, for subtitles and editing.',
        'Write exactly what is said in each chunk, word for word, including fillers, repeats and false starts, because the editor uses them to decide what to cut.',
        'Never translate, correct or complete a sentence. Return one entry per chunk id; an empty string when a chunk has no speech.',
        config.instructions ?? '',
      ].join(' '),
      messages: [{ role: 'user', content }],
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(300_000),
    });
    for (const c of output.chunks) texts.set(c.id, c.text.trim());
  }
  return texts;
}

/**
 * Cleans the voice of a recording, splits it at the pauses and transcribes every chunk. Writes
 * `<name>-voice.wav` into `outDir` (default: next to the clip).
 */
export async function prepareFootage(clip: string, options: { transcriber: Transcriber; outDir?: string; maxSourceSec?: number }): Promise<PreparedFootage> {
  const source = path.resolve(clip);
  if (!fs.existsSync(source)) throw new Error(`No file ${clip}`);
  if (!hasAudio(source)) throw new Error(`${clip} has no sound`);
  const duration = probeDuration(source);
  const max = options.maxSourceSec ?? 1800;
  if (duration > max) throw new Error(`${clip} is ${Math.round(duration)} s; the limit is ${max} s (maxSourceSec)`);

  const outDir = path.resolve(options.outDir ?? path.dirname(source));
  fs.mkdirSync(outDir, { recursive: true });
  const voice = path.join(outDir, `${path.parse(source).name}-voice.wav`);
  // Rumble and hiss off, near and far speech evened out; the final master is loudness-normalised later.
  ffmpeg(['-i', source, '-vn', '-ac', '1', '-ar', '48000', '-af', 'highpass=f=80,lowpass=f=12000,afftdn=nf=-25,dynaudnorm=f=200:g=11', voice]);

  const ranges = speechRanges(voice, duration);
  if (ranges.length === 0) throw new Error(`No speech found in ${clip}`);
  console.log(`[cutsmith] ✂️  ${path.basename(clip)}: ${ranges.length} stretches of speech in ${duration.toFixed(1)} s`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutsmith-footage-'));
  try {
    const files = ranges.map((r, i) => {
      const file = path.join(dir, `chunk-${i + 1}.mp3`);
      ffmpeg(['-ss', String(r.start), '-to', String(r.end), '-i', voice, '-ac', '1', '-ar', '16000', '-b:a', '32k', file]);
      return { id: i + 1, file };
    });
    const texts = await transcribeChunks(files, options.transcriber);
    return { source, voice, durationSec: duration, chunks: ranges.map((r, i) => ({ id: i + 1, ...r, text: texts.get(i + 1) ?? '' })) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Cuts each scene of the edit from the clip and its cleaned voice into `outDir` as `<prefix>_s<n>.mp4`
 * and `<prefix>_s<n>-voice.wav`, and returns project scenes that use them. Unknown or repeated chunk
 * ids are dropped (and scenes left empty), so a slip in the edit can't fail the cut.
 */
export function cutFootage(footage: PreparedFootage, edit: EditScene[], options: { outDir: string; prefix: string }): Scene[] {
  const byId = new Map(footage.chunks.map((c) => [c.id, c]));
  const used = new Set<number>();
  const plan = edit
    .map((scene) => ({ ...scene, chunks: scene.chunks.filter((id) => byId.has(id) && !used.has(id) && used.add(id)) }))
    .filter((scene) => scene.chunks.length > 0);
  if (plan.length === 0) throw new Error('The edit keeps no speech');
  fs.mkdirSync(options.outDir, { recursive: true });

  return plan.map((scene, i) => {
    const id = i + 1;
    const ranges = scene.chunks.map((c) => byId.get(c)!);
    const clip = path.join(options.outDir, `${options.prefix}_s${id}.mp4`);
    const audio = path.join(options.outDir, `${options.prefix}_s${id}-voice.wav`);
    const filters = ranges.flatMap((r, n) => {
      const length = r.end - r.start;
      return [
        `[0:v]trim=start=${r.start}:end=${r.end},setpts=PTS-STARTPTS[v${n}]`,
        `[1:a]atrim=start=${r.start}:end=${r.end},asetpts=PTS-STARTPTS,afade=t=in:d=${FADE_SEC},afade=t=out:st=${(length - FADE_SEC).toFixed(3)}:d=${FADE_SEC}[a${n}]`,
      ];
    });
    const inputs = (kind: 'v' | 'a') => ranges.map((_, n) => `[${kind}${n}]`).join('');
    filters.push(
      `${inputs('v')}concat=n=${ranges.length}:v=1:a=0,fps=30,scale='min(1920,iw)':-2,format=yuv420p[v]`,
      `${inputs('a')}concat=n=${ranges.length}:v=0:a=1[a]`
    );
    ffmpeg([
      '-i', footage.source, '-i', footage.voice, '-filter_complex', filters.join(';'),
      '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', clip,
      '-map', '[a]', '-c:a', 'pcm_s16le', audio,
    ]);

    const text = ranges.map((r) => r.text).filter(Boolean).join(' ');
    const words = new Set(text.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')));
    const inText = (word?: string) => !!word && words.has(word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
    return {
      id,
      text: text || '…',
      visual: clip,
      audio,
      ...(id === 1 && scene.hookText && { hookText: scene.hookText }),
      ...(scene.badge && { badge: scene.badge }),
      ...(inText(scene.badgeCue) && { badgeCue: scene.badgeCue }),
      ...(scene.sfx && inText(scene.sfx.cue) && { sfx: scene.sfx }),
    };
  });
}
