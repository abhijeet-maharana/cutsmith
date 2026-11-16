import { spawnSync } from 'node:child_process';
import type { WordTimestamp } from './remotion/types';

/**
 * Word timing for the karaoke subtitles, measured from the real audio with ffmpeg and no external API,
 * so it works with any voice. ffmpeg finds where speech starts and ends and every pause in between; the
 * script is split at those pauses (longest first, each matched to the word boundary whose position fits
 * it best, preferring boundaries after punctuation), and words share out time by length only inside one
 * measured stretch of speech. Subtitles land within ~0.1-0.15 s of the spoken word instead of drifting
 * 0.3-0.5 s. Falls back to a length-based estimate if anything goes wrong.
 */

interface Silence {
  start: number;
  end: number;
}

interface Token {
  word: string;
  weight: number;
  /** Script punctuation suggests a pause here. */
  boundaryAfter: boolean;
}

const MIN_PAUSE_SEC = 0.2;
/** Max |expected - measured| position (fraction of the stretch) to accept a pause as a split. */
const MAX_POSITION_ERROR = 0.2;
const PUNCTUATION_BONUS = 0.08;

export function parseSilences(ffmpegLog: string, durationSec: number): Silence[] {
  const silences: Silence[] = [];
  let open: number | null = null;
  for (const line of ffmpegLog.split('\n')) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (s) open = Math.max(0, parseFloat(s[1]));
    if (e && open !== null) {
      silences.push({ start: open, end: parseFloat(e[1]) });
      open = null;
    }
  }
  // Silence running to the end of the file has a start line but no end line.
  if (open !== null) silences.push({ start: open, end: durationSec });
  return silences;
}

function detectSilences(audioPath: string, durationSec: number): Silence[] {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-i', audioPath, '-af', 'silencedetect=noise=-35dB:d=0.1', '-f', 'null', '-'], {
    encoding: 'utf-8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`silencedetect failed: ${String(run.stderr).slice(-200)}`);
  return parseSilences(run.stderr, durationSec);
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const w of text.replace(/[\n\r]+/g, ' ').trim().split(/\s+/).filter(Boolean)) {
    if (!/[\p{L}\p{N}]/u.test(w)) {
      // Standalone punctuation (an em dash): not shown, but marks a pause.
      if (tokens.length) tokens[tokens.length - 1].boundaryAfter = true;
      continue;
    }
    const stripped = w.replace(/[.,!?;:'"“”()।—-]/g, '');
    tokens.push({ word: w, weight: Math.max(2.0, Math.min(6.5, stripped.length * 1.1)), boundaryAfter: /[.,!?;:।—]$/.test(w) });
  }
  return tokens;
}

function distribute(tokens: Token[], start: number, end: number): WordTimestamp[] {
  const total = tokens.reduce((a, t) => a + t.weight, 0) || 1;
  const dur = Math.max(0.1, end - start);
  let cur = start;
  return tokens.map((t) => {
    const d = (t.weight / total) * dur;
    const w = { word: t.word, start: +cur.toFixed(3), end: +(cur + d).toFixed(3) };
    cur += d;
    return w;
  });
}

function spread(tokens: Token[], start: number, end: number, pauses: Silence[]): WordTimestamp[] {
  const inside = pauses.filter((p) => p.start > start + 0.03 && p.end < end - 0.03);
  if (tokens.length < 2 || inside.length === 0) return distribute(tokens, start, end);

  const totalPause = inside.reduce((a, p) => a + (p.end - p.start), 0);
  const voiced = Math.max(0.2, end - start - totalPause);
  const totalWeight = tokens.reduce((a, t) => a + t.weight, 0);

  // Longest pause first; take the first one that maps cleanly to a word boundary.
  for (const p of [...inside].sort((a, b) => b.end - b.start - (a.end - a.start))) {
    const pauseBefore = inside.filter((q) => q.end <= p.start).reduce((a, q) => a + (q.end - q.start), 0);
    const frac = (p.start - start - pauseBefore) / voiced;

    let best = -1;
    let bestScore = Infinity;
    let cum = 0;
    for (let i = 1; i < tokens.length; i++) {
      cum += tokens[i - 1].weight;
      const err = Math.abs(cum / totalWeight - frac);
      const score = tokens[i - 1].boundaryAfter ? err - PUNCTUATION_BONUS : err;
      if (err <= MAX_POSITION_ERROR && score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) continue;
    return [
      ...spread(tokens.slice(0, best), start, p.start, inside.filter((q) => q.end <= p.start)),
      ...spread(tokens.slice(best), p.end, end, inside.filter((q) => q.start >= p.end)),
    ];
  }
  return distribute(tokens, start, end);
}

/** Word timing from silences already measured (exported for tests). */
export function alignToSilences(text: string, durationSec: number, silences: Silence[]): WordTimestamp[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];

  let speechStart = 0;
  let speechEnd = durationSec;
  const first = silences[0];
  if (first && first.start <= 0.02) speechStart = first.end;
  const last = silences[silences.length - 1];
  if (last && last.end >= durationSec - 0.05) speechEnd = last.start;
  if (speechEnd - speechStart < 0.4) throw new Error('speech window too small');

  const pauses = silences.filter((s) => s.start > speechStart + 0.05 && s.end < speechEnd - 0.05 && s.end - s.start >= MIN_PAUSE_SEC);
  const words = spread(tokens, speechStart, speechEnd, pauses);
  // Keep the last word from running past the audio.
  const lastWord = words[words.length - 1];
  if (lastWord) lastWord.end = Math.min(lastWord.end, +(durationSec - 0.03).toFixed(3));
  return words;
}

/** Length-based estimate: a little lead-in and tail, words weighted by length. */
export function estimateWords(text: string, durationSec: number): WordTimestamp[] {
  const raw = text.replace(/[\n\r]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (raw.length === 0) return [];
  const leadIn = Math.min(0.12, durationSec * 0.04);
  const tail = Math.min(0.25, durationSec * 0.07);
  const active = Math.max(0.4, durationSec - leadIn - tail);
  const weights = raw.map((w) => Math.max(2.0, Math.min(6.5, w.replace(/[.,!?;:'"“”()।]/g, '').length * 1.1)));
  const total = weights.reduce((a, b) => a + b, 0);
  let cur = leadIn;
  return raw.map((word, i) => {
    const d = (weights[i] / total) * active;
    const w = { word, start: +cur.toFixed(3), end: +(i === raw.length - 1 ? durationSec - 0.05 : cur + d).toFixed(3) };
    cur += d;
    return w;
  });
}

export function alignWords(text: string, durationSec: number, audioPath: string): WordTimestamp[] {
  try {
    return alignToSilences(text, durationSec, detectSilences(audioPath, durationSec));
  } catch (err) {
    console.warn(`[cutsmith] Audio alignment failed (${(err as Error).message}); using a length-based estimate`);
    return estimateWords(text, durationSec);
  }
}
