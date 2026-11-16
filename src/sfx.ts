const REMOTION_MEDIA = 'https://remotion.media';

/**
 * Built-in sound effects: short names for the most useful sounds of Remotion's sound library
 * (https://www.remotion.dev/docs/sfx). They are streamed from remotion.media while rendering, not
 * shipped in this repo; each sound has its own licence on its page there. A local file or any URL
 * works too.
 */
export const BUILTIN_SFX = {
  whoosh: { src: `${REMOTION_MEDIA}/whoosh.wav`, volume: 0.1, use: 'scene change (played automatically between scenes)' },
  ding: { src: `${REMOTION_MEDIA}/ding.wav`, volume: 0.22, use: 'a message or alert arrives, a right answer, a solved problem' },
  notification: { src: `${REMOTION_MEDIA}/snapchat-notification.wav`, volume: 0.22, use: 'a phone gets a call or notification' },
  click: { src: `${REMOTION_MEDIA}/mouse-click.wav`, volume: 0.3, use: 'a tap on a button or screen' },
  shutter: { src: `${REMOTION_MEDIA}/shutter-modern.wav`, volume: 0.22, use: 'a phone camera takes a photo or scans' },
  switch: { src: `${REMOTION_MEDIA}/switch.wav`, volume: 0.28, use: 'something is switched on or off' },
  whip: { src: `${REMOTION_MEDIA}/whip.wav`, volume: 0.18, use: 'a fast reveal or a before/after flip' },
  pageTurn: { src: `${REMOTION_MEDIA}/page-turn.wav`, volume: 0.22, use: 'moving to the next step or page' },
  boom: { src: `${REMOTION_MEDIA}/vine-boom.wav`, volume: 0.16, use: 'a shocking fact' },
  scratch: { src: `${REMOTION_MEDIA}/record-scratch.wav`, volume: 0.18, use: 'a mistake is called out ("wait, don\'t do this")' },
} as const;

export type BuiltinSfx = keyof typeof BUILTIN_SFX;

const DEFAULT_VOLUME = 0.22;

/**
 * Resolves a scene's `sfx.sound`: a built-in name or a URL (the caller resolves file paths). Returns
 * undefined for anything else.
 */
export function builtinSfx(sound: string): { src: string; volume: number } | undefined {
  if (sound in BUILTIN_SFX) {
    const s = BUILTIN_SFX[sound as BuiltinSfx];
    return { src: s.src, volume: s.volume };
  }
  if (/^https?:\/\//.test(sound)) return { src: sound, volume: DEFAULT_VOLUME };
  return undefined;
}
