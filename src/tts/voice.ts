import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { generateSpeech } from 'ai';
import { ffmpeg, silence } from '../media.js';
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

export function defaultCacheDir(): string {
  return process.env.CUTSMITH_CACHE_DIR || path.join(os.homedir(), '.cache', 'cutsmith', 'tts');
}

export function voiceFromConfig(voice: Voice, cacheDir = defaultCacheDir()): VoiceProvider {
  if (voice.provider === 'none') return silentVoice(voice.wordsPerSecond);
  return openAICompatibleVoice(voice, cacheDir);
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

  return {
    async speak(rawText, outFile, { fresh }) {
      const text = rawText.replace(/\n/g, ' ').trim();
      // The cache key covers everything that changes the sound; the key itself never goes in it.
      const key = createHash('sha256')
        .update(JSON.stringify(['v1', config.baseURL ?? '', config.model, config.voice, config.instructions ?? '', config.prefix ?? '', config.format, text]))
        .digest('hex')
        .slice(0, 20);
      const cached = path.join(cacheDir, `${key}.mp3`);
      if (!fresh && fs.existsSync(cached)) {
        fs.copyFileSync(cached, outFile);
        return;
      }
      if (!apiKey) throw new Error(`No TTS key: set the ${config.apiKeyEnv} environment variable (voice.apiKeyEnv), or use "voice": { "provider": "none" }`);

      console.log(`[cutsmith] 🎙️  ${config.voice}: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);
      const { audio } = await generateSpeech({
        model: provider.speech(config.model),
        text: config.prefix ? `${config.prefix}\n${text}` : text,
        voice: config.voice,
        instructions: config.instructions,
        outputFormat: config.format,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const bytes = audio.uint8Array;
      // Everything is stored as MP3; a WAV is unwrapped first (see unwrap-wav.ts).
      const input = isWav(bytes) ? unwrapWav(bytes) : Buffer.from(bytes);
      ffmpeg(['-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '128k', outFile], input);
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.copyFileSync(outFile, cached);
    },
  };
}
