import { staticFile } from 'remotion';

/**
 * Bare file names live in the render's public dir and are served with staticFile(), so large images,
 * videos and audio never travel inside the input props. data:, blob: and http(s) URIs pass through.
 */
export const resolveSrc = (uri?: string): string => {
  if (!uri) return '';
  if (/^(data:|blob:|https?:)/i.test(uri)) return uri;
  return staticFile(uri);
};
