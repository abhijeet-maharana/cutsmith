import { z } from 'zod';

/**
 * The project file: everything cutsmith needs to render one video. An agent (or a person) writes it;
 * `cutsmith render project.json` turns it into an MP4 plus a JPEG cover.
 *
 * Relative paths (visuals, audio, music, brand, fonts, logo) resolve against the project file's folder,
 * then against each of `assetDirs`.
 */

const HookTone = z.enum(['alert', 'curiosity', 'proof']);
const Layout = z.enum(['fullbleed', 'framed', 'fitted']);

export const SceneSchema = z.object({
  id: z.number().int().positive().describe('Scene number, 1..n in playing order.'),
  text: z.string().min(1).describe('Exact narration. Voiced on its own (unless `audio` is set) and shown as karaoke subtitles.'),
  visual: z.string().optional().describe('Image or video for this scene: a path, a URL, or a bare file name looked up in assetDirs. Missing = a "VISUAL NEEDED" slot.'),
  audio: z.string().optional().describe('The scene\'s own recorded voice (e.g. cut from your footage). Used instead of TTS.'),
  layout: Layout.optional().describe('fullbleed = fills the canvas; framed = tall screenshot in a phone frame that scrolls; fitted = shown whole over a blurred copy. Default: picked from the file\'s shape.'),
  visualNeeded: z.string().optional().describe('Plain description of the shot this line needs; shown in the placeholder while `visual` is missing.'),
  hookText: z.string().optional().describe('Scene 1: a short (<= 6 words) on-screen hook shown huge for the first ~2 s.'),
  hookTone: HookTone.optional().describe('Hook accent: alert = red, curiosity = yellow, proof = green.'),
  hookPosition: z.enum(['top', 'center']).optional(),
  badge: z.string().optional().describe('Small label at the top of the frame, e.g. "⚠️ Privacy alert".'),
  badgeCue: z.string().optional().describe('Narration word at which the badge appears.'),
  panY: z.tuple([z.number(), z.number()]).optional().describe('Framed screenshots: vertical focus [from, to] in % (0 = top).'),
  panCue: z.tuple([z.string(), z.string()]).optional().describe('Framed screenshots: scroll from the first narration word to the second.'),
  sfx: z
    .object({
      sound: z.string().describe('A built-in name (see `cutsmith sfx`), a file path or a URL.'),
      cue: z.string().describe('Narration word the sound plays on.'),
      volume: z.number().min(0).max(1).optional(),
    })
    .optional(),
  hideSubtitles: z.boolean().optional().describe('No subtitles on this scene (e.g. they would cover text already on screen).'),
});

export const VoiceSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('openai-compatible').describe('Any /v1/audio/speech endpoint: OpenAI, a proxy in front of Gemini TTS, a local Kokoro server, ...'),
    baseURL: z.string().optional().describe('Default https://api.openai.com/v1.'),
    apiKeyEnv: z.string().default('OPENAI_API_KEY').describe('Name of the environment variable holding the key (never the key itself).'),
    model: z.string(),
    voice: z.string(),
    instructions: z.string().optional().describe('Delivery style sent as `instructions` (accent, pace, mood).'),
    prefix: z.string().optional().describe('Text sent before every line, for models that read stage directions from the text itself (e.g. Gemini TTS director\'s notes).'),
    format: z.enum(['wav', 'mp3']).default('wav'),
  }),
  z.object({
    provider: z.literal('gemini').describe('Gemini TTS through the Gemini API (a Google AI Studio key).'),
    apiKeyEnv: z.string().default('GEMINI_API_KEY').describe('Name of the environment variable holding the key (never the key itself).'),
    model: z.string().default('gemini-3.8-flash-tts'),
    voice: z.string().describe('A prebuilt Gemini voice, e.g. "Charon", "Kore", "Puck".'),
    prefix: z.string().optional().describe('Text sent before every line, e.g. a short style cue ("Say calmly: "). Long director\'s notes can make the model repeat the line; a take that runs far too long is made again.'),
  }),
  z.object({
    provider: z.literal('none').describe('No voice: silent scenes timed at `wordsPerSecond`. For drafts and tests.'),
    wordsPerSecond: z.number().positive().default(2.6),
  }),
]);

export const BrandSchema = z.object({
  name: z.string().optional(),
  colors: z
    .object({
      background: z.string().default('#111827'),
      backgroundDeep: z.string().default('#030712'),
      accent: z.string().default('#38BDF8'),
      onAccent: z.string().default('#030712').describe('Text colour on the accent (end-card button).'),
      text: z.string().default('#FFFFFF'),
      frame: z.string().default('#1F2937').describe('Border of the phone frame around screenshots.'),
    })
    .prefault({}),
  font: z
    .object({
      family: z.string().describe('CSS font family name.'),
      files: z.array(z.object({ src: z.string(), weight: z.string().default('700'), style: z.string().default('normal') })).optional().describe('Local font files (ttf/otf/woff2).'),
      googleFont: z.string().optional().describe('Load the family from Google Fonts instead, e.g. "Inter:wght@700;800;900". Needs network while rendering.'),
      fallback: z.string().default("'Noto Sans Devanagari', -apple-system, 'Segoe UI', Roboto, sans-serif"),
    })
    .optional(),
  logo: z.string().optional().describe('Logo on the end card (PNG/SVG, light on dark).'),
});

export const EndCardSchema = z.object({
  headline: z.string().optional(),
  button: z.string().optional(),
  url: z.string().optional(),
  subline: z.string().optional(),
  tagline: z.string().optional(),
  seconds: z.number().positive().default(3).describe('How long it covers the end of the last scene (never more than 60% of it).'),
});

export const ProjectSchema = z.object({
  $schema: z.string().optional(),
  title: z.string().optional(),
  format: z.enum(['vertical', 'landscape']).default('vertical').describe('vertical = 1080x1920 (Shorts, Reels); landscape = 1920x1080 (YouTube).'),
  language: z.string().optional().describe('Free text, for your own records and the AI check, e.g. "en-IN" or "hi".'),
  scenes: z.array(SceneSchema).min(1),
  voice: VoiceSchema.default({ provider: 'none', wordsPerSecond: 2.6 }),
  music: z.object({ file: z.string(), volume: z.number().min(0).max(1).default(0.025) }).optional(),
  brand: z.union([z.string().describe('Path to a brand.json'), BrandSchema]).optional(),
  endCard: z.union([EndCardSchema, z.literal(false)]).optional().describe('false = no end card. Left out = no end card.'),
  transitions: z.object({ whoosh: z.boolean().default(true) }).prefault({}),
  sounds: z
    .record(z.string(), z.string())
    .default({})
    .describe('Local files for sound names, e.g. { "ding": "sfx/ding.wav", "whoosh": "sfx/whoosh.wav" }. They override the built-ins (keeping their volume), so a render needs no network for them.'),
  progressBar: z.boolean().default(true),
  subtitles: z.object({ wordsPerChunk: z.number().int().min(1).max(8).default(3), uppercase: z.boolean().default(true) }).prefault({}),
  assetDirs: z.array(z.string()).default([]).describe('Folders searched for bare file names in visual/audio/music.'),
  lint: z
    .union([z.boolean(), z.object({ maxSeconds: z.number().positive().default(60) })])
    .default(true)
    .describe('Short-form retention warnings (vertical only); never blocks. An object sets the length above which TOO_LONG is raised.'),
});

export type Scene = z.infer<typeof SceneSchema>;
export type Voice = z.infer<typeof VoiceSchema>;
export type Brand = z.infer<typeof BrandSchema>;
export type EndCard = z.infer<typeof EndCardSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectInput = z.input<typeof ProjectSchema>;

/** Validates a project and fills in defaults. Throws with every problem listed, one per line. */
export function parseProject(input: unknown): Project {
  const result = ProjectSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid project:\n${lines.join('\n')}`);
  }
  const ids = result.data.scenes.map((s) => s.id);
  if (new Set(ids).size !== ids.length) throw new Error('Invalid project:\n  - scenes: scene ids must be unique');
  return result.data;
}

export function parseBrand(input: unknown): Brand {
  return BrandSchema.parse(input);
}

/** JSON Schema of the project file, for editors and agents (`cutsmith schema`). */
export function projectJsonSchema(): unknown {
  return z.toJSONSchema(ProjectSchema, { io: 'input' });
}

/** What a render reports back. */
export interface RetentionWarning {
  code: string;
  message: string;
}

export interface RenderResult {
  video: string;
  cover: string;
  durationSec: number;
  /** Scenes still showing a VISUAL NEEDED slot. */
  missingVisuals: number[];
  warnings: RetentionWarning[];
  /** Where each scene starts and ends in the final video, in seconds. */
  scenes: Array<{ id: number; start: number; end: number }>;
}
