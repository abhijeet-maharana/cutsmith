import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { generateSpeech } from 'ai';
import { ffmpeg, probeDuration, silence } from '../media.js';
import type { Voice } from '../project.js';
import { isWav, unwrapWav } from './unwrap-wav.js';

/**
 * Speaks one scene's line into an MP3. Built in: any OpenAI-compatible /v1/audio/speech endpoint (with
 * a cache, so only changed lines cost a call) and "none" (silence, for drafts). Pass your own provider
 * to `render()` to use anything else.
 */
export interface VoiceProvider {
  speak(text: string, outFile: string, options: { fresh: boolean }): Promise<void>;
}

const TIMEOUT_MS = 2 * 60_000;
/**
 * A take longer than this for its words was not just read: some TTS models (Gemini with director's
 * notes, seen 2026-11-16) say the line twice or read the notes. Such a take is made again, up to
 * TAKE_TRIES times, and the shortest is kept. Normal speech is 2.3-3 words a second.
 */
const MIN_WORDS_PER_SECOND = 1.5;
const RATE_LIMIT_TRIES = 5;
const SLACK_SECONDS = 1.5;
const TAKE_TRIES = 3;

const tooLong = (text: string, seconds: number) => {
  const words = text.split(/\s+/).filter(Boolean).length;
  return words >= 4 && seconds > words / MIN_WORDS_PER_SECOND + SLACK_SECONDS;
};

export function defaultCacheDir(): string {
  return process.env.CUTSMITH_CACHE_DIR || path.join(os.homedir(), '.cache', 'cutsmith', 'tts');
}

export function voiceFromConfig(voice: Voice, cacheDir = defaultCacheDir()): VoiceProvider {
  if (voice.provider === 'none') return silentVoice(voice.wordsPerSecond);
  if (voice.provider === 'gemini') return geminiVoice(voice, cacheDir);
  return openAICompatibleVoice(voice, cacheDir);
}

/** Serves a take from the cache, or makes it with `synthesize` (audio bytes) and caches it as MP3. */
function cachedVoice(cacheDir: string, keyParts: unknown[], label: string, synthesize: (text: string) => Promise<{ bytes: Uint8Array; rawPcmRate?: number }>): VoiceProvider {
  return {
    async speak(rawText, outFile, { fresh }) {
      const text = rawText.replace(/\n/g, ' ').trim();
      // The cache key covers everything that changes the sound; an API key never goes in it.
      const key = createHash('sha256').update(JSON.stringify([...keyParts, text])).digest('hex').slice(0, 20);
      const cached = path.join(cacheDir, `${key}.mp3`);
      if (!fresh && fs.existsSync(cached)) {
        fs.copyFileSync(cached, outFile);
        return;
      }
      console.log(`[cutsmith] 🎙️  ${label}: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);
      let best: { file: string; seconds: number } | null = null;
      for (let attempt = 1; attempt <= TAKE_TRIES; attempt++) {
        const take = `${outFile}.take${attempt}.mp3`;
        const { bytes, rawPcmRate } = await synthesize(text);
        if (rawPcmRate) {
          // Bare 16-bit PCM (older Gemini TTS models).
          ffmpeg(['-f', 's16le', '-ar', String(rawPcmRate), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '128k', take], Buffer.from(bytes));
        } else {
          // Everything is stored as MP3; a WAV is unwrapped first (see unwrap-wav.ts).
          ffmpeg(['-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '128k', take], isWav(bytes) ? unwrapWav(bytes) : Buffer.from(bytes));
        }
        const seconds = probeDuration(take);
        if (!best || seconds < best.seconds) {
          if (best) fs.rmSync(best.file, { force: true });
          best = { file: take, seconds };
        } else fs.rmSync(take, { force: true });
        if (!tooLong(text, seconds)) break;
        console.warn(`[cutsmith] ⚠️  Take ${attempt} is ${seconds.toFixed(1)} s for ${text.split(/\s+/).length} words (said twice?)${attempt < TAKE_TRIES ? '; making another' : '; keeping the shortest'}`);
      }
      fs.renameSync(best!.file, outFile);
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.copyFileSync(outFile, cached);
    },
  };
}

/** Gemini TTS through the Gemini API (generateContent with an AUDIO response). */
export function geminiVoice(config: Extract<Voice, { provider: 'gemini' }>, cacheDir = defaultCacheDir()): VoiceProvider {
  return cachedVoice(cacheDir, ['gemini-v1', config.model, config.voice, config.prefix ?? ''], config.voice, async (text) => {
    const apiKey = process.env[config.apiKeyEnv];
    if (!apiKey) throw new Error(`No Gemini key: set the ${config.apiKeyEnv} environment variable (voice.apiKeyEnv)`);
    type Reply = {
      error?: { message?: string; details?: Array<{ retryDelay?: string; violations?: Array<{ quotaId?: string; quotaValue?: string }> }> };
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
    };
    let res: Response | undefined;
    let body: Reply = {};
    // Rate limits (429) are retried after the delay Google asks for; anything else fails at once.
    for (let attempt = 1; attempt <= RATE_LIMIT_TRIES; attempt++) {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: config.prefix ? `${config.prefix}\n${text}` : text }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice } } } },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      body = (await res.json().catch(() => ({}))) as Reply;
      if (res.status !== 429 || attempt === RATE_LIMIT_TRIES) break;
      // A daily quota won't come back by waiting: say so at once.
      const daily = body.error?.details?.flatMap((d) => d.violations ?? []).find((v) => /PerDay/i.test(v.quotaId ?? ''));
      if (daily) throw new Error(`Gemini TTS daily quota reached (${daily.quotaValue ?? '?'} requests a day for ${config.model} on this key's plan); it resets at midnight Pacific time, or enable billing on the key's project`);
      const asked = body.error?.details?.map((d) => d.retryDelay).find(Boolean);
      const waitSec = Math.min(90, asked ? Math.ceil(parseFloat(asked)) + 1 : 20 * attempt);
      console.warn(`[cutsmith] ⏳ Gemini TTS rate limit; trying again in ${waitSec} s`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
    }
    if (!res!.ok) throw new Error(`Gemini TTS ${res!.status}: ${body.error?.message ?? 'no details'}`);
    const audio = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!audio?.data) throw new Error('Gemini TTS returned no audio');
    const bytes = Buffer.from(audio.data, 'base64');
    const rate = audio.mimeType?.match(/rate=(\d+)/)?.[1];
    return isWav(bytes) || !rate ? { bytes } : { bytes, rawPcmRate: Number(rate) };
  });
}

/** Silent take as long as the line would take to say, so timing and subtitles still look right. */
export function silentVoice(wordsPerSecond = 2.6): VoiceProvider {
  return {
    async speak(text, outFile) {
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      silence(Math.max(1, words / wordsPerSecond + 0.4), outFile);
    },
  };
}

export function openAICompatibleVoice(config: Extract<Voice, { provider: 'openai-compatible' }>, cacheDir = defaultCacheDir()): VoiceProvider {
  const apiKey = process.env[config.apiKeyEnv];
  const provider = createOpenAI({ name: 'cutsmith-tts', baseURL: config.baseURL, apiKey });
  const keyParts = ['v1', config.baseURL ?? '', config.model, config.voice, config.instructions ?? '', config.prefix ?? '', config.format];
  return cachedVoice(cacheDir, keyParts, config.voice, async (text) => {
    if (!apiKey) throw new Error(`No TTS key: set the ${config.apiKeyEnv} environment variable (voice.apiKeyEnv), or use "voice": { "provider": "none" }`);
    const { audio } = await generateSpeech({
      model: provider.speech(config.model),
      text: config.prefix ? `${config.prefix}\n${text}` : text,
      voice: config.voice,
      instructions: config.instructions,
      outputFormat: config.format,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { bytes: audio.uint8Array };
  });
}
