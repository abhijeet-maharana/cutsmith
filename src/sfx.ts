import * as remotionSfx from '@remotion/sfx';

/**
 * Built-in sound effects: short names for the most useful files of @remotion/sfx. They are streamed
 * from remotion.media while rendering (not shipped in this repo); each sound has its own licence on
 * its page there. Any other @remotion/sfx export name, a local file or a URL works too.
 */
export const BUILTIN_SFX = {
  whoosh: { src: remotionSfx.whoosh, volume: 0.1, use: 'scene change (played automatically between scenes)' },
  ding: { src: remotionSfx.ding, volume: 0.22, use: 'a message or alert arrives, a right answer, a solved problem' },
  notification: { src: remotionSfx.snapchatNotification, volume: 0.22, use: 'a phone gets a call or notification' },
  click: { src: remotionSfx.mouseClick, volume: 0.3, use: 'a tap on a button or screen' },
  shutter: { src: remotionSfx.shutterModern, volume: 0.22, use: 'a phone camera takes a photo or scans' },
  switch: { src: remotionSfx.uiSwitch, volume: 0.28, use: 'something is switched on or off' },
  whip: { src: remotionSfx.whip, volume: 0.18, use: 'a fast reveal or a before/after flip' },
  pageTurn: { src: remotionSfx.pageTurn, volume: 0.22, use: 'moving to the next step or page' },
  boom: { src: remotionSfx.vineBoom, volume: 0.16, use: 'a shocking fact' },
  scratch: { src: remotionSfx.recordScratch, volume: 0.18, use: 'a mistake is called out ("wait, don\'t do this")' },
} as const;

export type BuiltinSfx = keyof typeof BUILTIN_SFX;

const DEFAULT_VOLUME = 0.22;

/**
 * Resolves a scene's `sfx.sound`: a built-in name, an @remotion/sfx export, a URL, or a file path (the
 * caller resolves paths). Returns undefined for a name that is none of these.
 */
export function builtinSfx(sound: string): { src: string; volume: number } | undefined {
  if (sound in BUILTIN_SFX) {
    const s = BUILTIN_SFX[sound as BuiltinSfx];
    return { src: s.src, volume: s.volume };
  }
  const exported = (remotionSfx as Record<string, unknown>)[sound];
  if (typeof exported === 'string' && exported.startsWith('https://')) return { src: exported, volume: DEFAULT_VOLUME };
  if (/^https?:\/\//.test(sound)) return { src: sound, volume: DEFAULT_VOLUME };
  return undefined;
}
