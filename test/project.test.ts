import { describe, expect, it } from 'vitest';
import { layoutFor } from '../src/media';
import { parseProject } from '../src/project';
import { lintRetention } from '../src/render';

describe('parseProject', () => {
  it('fills in defaults', () => {
    const p = parseProject({ scenes: [{ id: 1, text: 'Hi' }] });
    expect(p.format).toBe('vertical');
    expect(p.voice).toEqual({ provider: 'none', wordsPerSecond: 2.6 });
    expect(p.subtitles).toEqual({ wordsPerChunk: 3, uppercase: true });
    expect(p.transitions.whoosh).toBe(true);
  });

  it('lists every problem', () => {
    expect(() => parseProject({ scenes: [{ id: 0, text: '' }] })).toThrow(/scenes\.0\.id[\s\S]*scenes\.0\.text/);
  });

  it('rejects duplicate scene ids', () => {
    expect(() => parseProject({ scenes: [{ id: 1, text: 'a' }, { id: 1, text: 'b' }] })).toThrow(/unique/);
  });
});

describe('layoutFor', () => {
  const vertical = { width: 1080, height: 1920 };
  const landscape = { width: 1920, height: 1080 };
  it('fills the canvas with a visual of its shape', () => {
    expect(layoutFor({ width: 1080, height: 1920 }, vertical)).toBe('fullbleed');
    expect(layoutFor({ width: 1920, height: 1080 }, landscape)).toBe('fullbleed');
  });
  it('frames tall screenshots', () => {
    expect(layoutFor({ width: 1080, height: 2400 }, vertical)).toBe('framed');
    expect(layoutFor({ width: 1080, height: 1920 }, landscape)).toBe('framed');
  });
  it('fits square and wide photos', () => {
    expect(layoutFor({ width: 1000, height: 1000 }, vertical)).toBe('fitted');
    expect(layoutFor({ width: 1000, height: 1000 }, landscape)).toBe('fitted');
  });
});

describe('lintRetention', () => {
  const scene = (id: number, text: string, extra = {}) => ({ id, text, assetUri: 'x.jpg', durationSec: 5, durationInFrames: 150, ...extra });
  it('flags a missing hook and a missing ask', () => {
    const codes = lintRetention([scene(1, 'Hello there.'), scene(2, 'Bye.'), scene(3, 'End.')]).map((w) => w.code);
    expect(codes).toContain('NO_HOOK_TEXT');
    expect(codes).toContain('NO_CTA');
    expect(codes).toContain('STATIC_OPENING');
  });
  it('passes a tight script', () => {
    const codes = lintRetention([
      scene(1, 'Stop this now.', { hookText: 'Stop this', isVideo: true }),
      scene(2, 'Here is why.', { isVideo: true }),
      scene(3, 'Save this for later.', { isVideo: true }),
    ]).map((w) => w.code);
    expect(codes).toEqual([]);
  });
});
