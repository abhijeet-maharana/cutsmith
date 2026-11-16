import { describe, expect, it } from 'vitest';
import { alignToSilences, estimateWords, parseSilences } from '../src/align';

describe('parseSilences', () => {
  it('reads ffmpeg silencedetect output, including silence that runs to the end', () => {
    const log = ['[silencedetect] silence_start: 0', '[silencedetect] silence_end: 0.3 | silence_duration: 0.3', '[silencedetect] silence_start: 2.5'].join('\n');
    expect(parseSilences(log, 3)).toEqual([
      { start: 0, end: 0.3 },
      { start: 2.5, end: 3 },
    ]);
  });
});

describe('alignToSilences', () => {
  it('trims leading and trailing silence and splits at a pause after punctuation', () => {
    const silences = [
      { start: 0, end: 0.2 },
      { start: 1.4, end: 1.8 },
      { start: 3.0, end: 3.2 },
    ];
    const words = alignToSilences('Stop doing this. Do that instead', 3.2, silences);
    expect(words.map((w) => w.word)).toEqual(['Stop', 'doing', 'this.', 'Do', 'that', 'instead']);
    expect(words[0].start).toBeCloseTo(0.2, 2);
    // "this." ends at the pause and "Do" starts after it.
    expect(words[2].end).toBeCloseTo(1.4, 2);
    expect(words[3].start).toBeCloseTo(1.8, 2);
    expect(words[5].end).toBeLessThanOrEqual(3.17);
  });

  it('keeps words in order with no overlaps', () => {
    const words = alignToSilences('one two three four five six seven', 4, [{ start: 2, end: 2.4 }]);
    for (let i = 1; i < words.length; i++) expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].end - 1e-6);
  });
});

describe('estimateWords', () => {
  it('spreads words over the duration', () => {
    const words = estimateWords('a longer sentence here', 2);
    expect(words).toHaveLength(4);
    expect(words[0].start).toBeGreaterThan(0);
    expect(words[3].end).toBeCloseTo(1.95, 2);
  });
});
