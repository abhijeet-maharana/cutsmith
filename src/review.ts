import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output, type UserContent } from 'ai';
import { z } from 'zod';
import type { Project, RenderResult } from './project.js';

/**
 * AI check of a finished video, before anyone posts it. A multimodal model gets the soundtrack, frames
 * from every scene (more around the hook), the script with each scene's time range and any reference
 * photos, and reports what a viewer would notice. Frames go as images, so any chat model that takes
 * images works; the soundtrack is sent only when `audio` is on (the model must accept audio).
 */

export const ReviewerSchema = z.object({
  baseURL: z.string().optional(),
  apiKeyEnv: z.string().default('OPENAI_API_KEY'),
  model: z.string(),
  audio: z.boolean().default(true).describe('Send the soundtrack too (the model must accept audio input).'),
  brief: z.string().optional().describe('What the video is for and what matters, e.g. the brand, the product, rules for how it must look.'),
  references: z.array(z.object({ file: z.string(), label: z.string() })).default([]).describe('Photos the video must match, e.g. the real product an AI-generated clip shows.'),
});
export type Reviewer = z.input<typeof ReviewerSchema>;

export const ReviewSchema = z.object({
  hookScore: z.number().describe('0-10: would someone scrolling stop in the first 2 seconds (motion, a clear problem, readable hook text).'),
  summary: z.string().describe('One line: is this ready to post, and the main thing to fix if not.'),
  issues: z.array(
    z.object({
      scene: z.number().int(),
      kind: z.enum(['reference_mismatch', 'wrong_visual', 'subtitles_cover', 'text_covered', 'unreadable', 'black_or_frozen', 'audio', 'other']),
      severity: z.enum(['high', 'low']).describe('high = a viewer would notice and it should not go out like this.'),
      problem: z.string().describe('What is wrong, as seen or heard.'),
      fix: z.string().describe('The concrete fix.'),
    })
  ),
});
export type Review = z.infer<typeof ReviewSchema>;

const HOOK_FRAMES_SEC = [0.3, 1, 2];

const SYSTEM = `You check a finished video before it is posted. You get the script per scene with its time range, frames from each scene labelled with their timestamp, maybe the soundtrack, and maybe reference photos.

Report only what is actually visible or audible, scene by scene:
- reference_mismatch: something shown that should match a reference photo (a product, its label, text, a logo, a QR code) differs from it: garbled letters, changed digits, a different pattern or colour. Small changes count.
- wrong_visual: the picture doesn't show what the line says.
- subtitles_cover: the subtitles (the dark pill with the spoken words) cover the thing the scene is about.
- text_covered: the badge or hook text covers the thing the scene is about, or text is cut off at the edge.
- unreadable: a screenshot or text in the frame is too small or blurred to read.
- black_or_frozen: black, blank or broken frames, a "VISUAL NEEDED" slot, or footage that freezes.
- audio: the voice is cut off, garbled, too quiet under the music, or a sound effect is out of place.
Leave out taste and anything you are unsure of. An empty issues list is a good result.`;

function frame(video: string, atSec: number, width: number, out: string): string | null {
  try {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', atSec.toFixed(2), '-i', video, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', out], { timeout: 60_000 });
    return fs.readFileSync(out).toString('base64');
  } catch {
    return null;
  }
}

export async function reviewVideo(project: Project, result: RenderResult, reviewerInput: Reviewer, options: { baseDir?: string } = {}): Promise<Review> {
  const reviewer = ReviewerSchema.parse(reviewerInput);
  const apiKey = process.env[reviewer.apiKeyEnv];
  if (!apiKey) throw new Error(`No reviewer key: set the ${reviewer.apiKeyEnv} environment variable`);
  const provider = createOpenAI({ name: 'cutsmith-review', baseURL: reviewer.baseURL, apiKey });
  const baseDir = path.resolve(options.baseDir ?? process.cwd());
  const width = project.format === 'landscape' ? 640 : 360;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutsmith-review-'));

  try {
    const content: UserContent = [];
    if (reviewer.brief) content.push({ type: 'text', text: `About this video: ${reviewer.brief}` });
    for (const [i, ref] of reviewer.references.entries()) {
      const data = frame(path.resolve(baseDir, ref.file), 0, 720, path.join(dir, `ref-${i}.jpg`));
      if (data) content.push({ type: 'text', text: `Reference photo: ${ref.label}` }, { type: 'file', data, mediaType: 'image/jpeg' });
    }
    if (reviewer.audio) {
      const audio = path.join(dir, 'audio.mp3');
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', result.video, '-vn', '-ac', '1', '-ar', '22050', '-b:a', '48k', audio], { timeout: 120_000 });
      content.push({ type: 'text', text: 'Soundtrack of the whole video:' }, { type: 'file', data: fs.readFileSync(audio).toString('base64'), mediaType: 'audio/mpeg' });
    }

    for (const time of result.scenes) {
      const scene = project.scenes.find((s) => s.id === time.id);
      if (!scene) continue;
      const source = scene.audio ? 'own footage' : scene.visual ? `file ${path.basename(scene.visual)}` : 'no visual yet';
      content.push({
        type: 'text',
        text: `Scene ${scene.id} (${time.start}-${time.end}s). Narration: "${scene.text}"${scene.hookText ? ` · hook text: "${scene.hookText}"` : ''} · should show: ${scene.visualNeeded ?? '(not given)'} · visual: ${source}`,
      });
      const length = time.end - time.start;
      const first = time.id === result.scenes[0].id;
      const times = [...new Set([...(first ? HOOK_FRAMES_SEC : []), length * 0.2, length * 0.55, length * 0.9].map((t) => +(time.start + t).toFixed(1)))].sort((a, b) => a - b);
      for (const at of times.filter((t) => t < time.end)) {
        const data = frame(result.video, at, width, path.join(dir, `frame-${at}.jpg`));
        if (data) content.push({ type: 'text', text: `Frame at ${at}s:` }, { type: 'file', data, mediaType: 'image/jpeg' });
      }
    }

    const { output } = await generateText({
      model: provider.chat(reviewer.model),
      output: Output.object({ schema: ReviewSchema }),
      instructions: SYSTEM,
      messages: [{ role: 'user', content }],
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(300_000),
    });
    return output;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
