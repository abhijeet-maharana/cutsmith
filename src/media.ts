import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** ffmpeg/ffprobe helpers. Both must be on PATH. */

const VIDEO_EXT = ['.mp4', '.mov', '.webm', '.m4v'];

export function isVideoFile(file: string): boolean {
  return VIDEO_EXT.includes(path.extname(file).toLowerCase());
}

export function ffmpeg(args: string[], input?: Buffer): void {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { input, maxBuffer: 64 * 1024 * 1024 });
}

export function probeDuration(file: string): number {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { encoding: 'utf-8' }).trim();
  const duration = parseFloat(out);
  if (!(duration > 0)) throw new Error(`Could not read the length of ${file} (ffprobe said "${out}")`);
  return duration;
}

export function probeSize(file: string): { width: number; height: number } | null {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file], { encoding: 'utf-8' }).trim();
    const [width, height] = out.split('x').map(Number);
    return width > 0 && height > 0 ? { width, height } : null;
  } catch {
    return null;
  }
}

export type Layout = 'fullbleed' | 'framed' | 'fitted';

/**
 * Picks the layout from the visual's shape against the canvas: about the canvas's shape fills it
 * (fullbleed), taller than the canvas and taller than wide goes in the phone frame (framed, e.g. an app
 * screenshot), anything else is shown whole over a blurred copy (fitted), so a product photo is never
 * cropped or put in a phone.
 */
export function layoutFor(visual: { width: number; height: number }, canvas: { width: number; height: number }): Layout {
  const ratio = visual.width / visual.height;
  const target = canvas.width / canvas.height;
  if (ratio >= target * 0.92 && ratio <= target * 1.07) return 'fullbleed';
  if (ratio < target && ratio < 1) return 'framed';
  return 'fitted';
}

export function detectLayout(file: string, canvas: { width: number; height: number }): Layout {
  const size = probeSize(file);
  return size ? layoutFor(size, canvas) : 'framed';
}

/** Copies a file into the render's public dir; returns the name staticFile() serves it under. */
export function stage(file: string, publicDir: string, name: string): string {
  const rel = `${name}${path.extname(file).toLowerCase()}`;
  fs.copyFileSync(file, path.join(publicDir, rel), fs.constants.COPYFILE_FICLONE);
  return rel;
}

/**
 * The blurred, darkened backdrop behind a fitted or framed still. Blurring a small copy once looks the
 * same as a CSS blur on the full canvas, which was redrawn on every frame and took ~40% of a render.
 */
export function stageBackdrop(file: string, publicDir: string, name: string): string {
  const rel = `${name}.jpg`;
  ffmpeg([
    '-i', file, '-frames:v', '1',
    '-vf', 'format=rgb24,scale=120:-2,gblur=sigma=12,eq=saturation=1.2,colorchannelmixer=rr=0.45:gg=0.45:bb=0.45',
    '-q:v', '3', path.join(publicDir, rel),
  ]);
  return rel;
}

/** A silent MP3 of the given length (scenes with voice provider "none"). */
export function silence(seconds: number, outFile: string): void {
  ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', seconds.toFixed(3), '-c:a', 'libmp3lame', '-b:a', '64k', outFile]);
}

/**
 * Brings the master to the loudness Reels, Shorts and YouTube play at (-14 LUFS, -1.5 dBTP), so the
 * video isn't quieter than the ones around it. The video stream is copied untouched.
 */
export function normalizeLoudness(videoPath: string): void {
  // A silent soundtrack (a draft with no voice, music or effects) has no loudness to measure: ffmpeg's
  // loudnorm turns it into NaN and the encoder fails, so it is left as it is.
  const peak = spawnSync('ffmpeg', ['-hide_banner', '-i', videoPath, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf-8' }).stderr.match(/max_volume:\s*(-?[\d.]+|-inf) dB/);
  if (!peak || peak[1] === '-inf' || parseFloat(peak[1]) < -60) return;
  const tmp = `${videoPath}.loudnorm.mp4`;
  ffmpeg(['-i', videoPath, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', tmp]);
  fs.renameSync(tmp, videoPath);
}
