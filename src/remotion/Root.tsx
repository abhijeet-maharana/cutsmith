import React from 'react';
import { Composition, registerRoot } from 'remotion';
import type { VideoProps } from './types';
import { Video } from './Video';

/** Only used when the Remotion Studio or the renderer opens the bundle; real props come from src/render.ts. */
const preview: VideoProps = {
  width: 1080,
  height: 1920,
  fps: 30,
  scenes: [{ id: 1, text: 'Hello from cutsmith', assetUri: '', missing: true, durationSec: 3, durationInFrames: 90 }],
  theme: {
    colors: { background: '#111827', backgroundDeep: '#030712', accent: '#38BDF8', onAccent: '#030712', text: '#FFFFFF', frame: '#1F2937' },
    fontStack: 'sans-serif',
    fontFaces: [],
  },
  musicVolume: 0.025,
  progressBar: true,
  subtitles: { wordsPerChunk: 3, uppercase: true },
};

export const Root: React.FC = () => (
  <Composition
    id="cutsmith"
    component={Video as unknown as React.FC<Record<string, unknown>>}
    durationInFrames={90}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={preview}
    calculateMetadata={async ({ props }) => {
      const p = props as VideoProps;
      const frames = p.scenes.reduce((sum, s) => sum + s.durationInFrames, 0);
      return { durationInFrames: Math.max(1, frames), fps: p.fps, width: p.width, height: p.height };
    }}
  />
);

registerRoot(Root);
