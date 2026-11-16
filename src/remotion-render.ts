import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import type { VideoProps } from './remotion/types.js';

// __dirname when a CommonJS project loads this file through tsx; import.meta.url when it runs as ESM.
const HERE = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, 'remotion', 'Root.tsx');
const COMPOSITION = 'cutsmith';
/** The cover is the video at 1 s: the hook text on the first visual, after the white flash. */
const COVER_FRAME = 30;

export interface RemotionOptions {
  publicDir: string;
  coverPath?: string;
  /** Browser tabs rendering at once. Left out = Remotion's default (half the CPU cores). */
  concurrency?: number | null;
  /** Chrome/Chromium to use. Left out = $CHROMIUM_PATH, a system Chrome on Linux, else Remotion downloads its own. */
  browserExecutable?: string;
}

function findBrowser(explicit?: string): string | undefined {
  return [explicit, process.env.CHROMIUM_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find((c): c is string => !!c && fs.existsSync(c));
}

export async function renderWithRemotion(props: VideoProps, outputPath: string, options: RemotionOptions): Promise<void> {
  const serveUrl = await bundle({ entryPoint: ENTRY, publicDir: path.resolve(options.publicDir) });
  const browserExecutable = findBrowser(options.browserExecutable);
  const chromiumOptions = { enableMultiProcessOnLinux: true };
  const composition = await selectComposition({ serveUrl, id: COMPOSITION, inputProps: props, browserExecutable, chromiumOptions });

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  console.log(`[cutsmith] 🎬 Rendering ${composition.durationInFrames} frames (${(composition.durationInFrames / composition.fps).toFixed(1)} s, ${composition.width}x${composition.height})`);
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: path.resolve(outputPath),
    inputProps: props,
    browserExecutable,
    concurrency: options.concurrency ?? null,
    chromiumOptions,
  });

  if (options.coverPath) {
    fs.mkdirSync(path.dirname(path.resolve(options.coverPath)), { recursive: true });
    await renderStill({
      composition,
      serveUrl,
      output: path.resolve(options.coverPath),
      inputProps: props,
      frame: Math.min(COVER_FRAME, composition.durationInFrames - 1),
      imageFormat: 'jpeg',
      jpegQuality: 90,
      browserExecutable,
      chromiumOptions,
    });
  }
}
