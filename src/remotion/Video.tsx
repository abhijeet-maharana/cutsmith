import React, { useEffect, useState } from 'react';
import { Audio, cancelRender, continueRender, delayRender, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { EndCard } from './EndCard';
import { geometryFor } from './geometry';
import { resolveSrc } from './resolve-src';
import { Scene } from './Scene';
import type { Theme, VideoProps } from './types';

/** Waits for the brand fonts before the first frame, so no frame is drawn with a fallback font. */
function useFonts(theme: Theme): void {
  const [handle] = useState(() => delayRender('Loading fonts'));
  useEffect(() => {
    const jobs: Promise<unknown>[] = theme.fontFaces.map(async (f) => {
      const face = new FontFace(f.family, `url(${resolveSrc(f.uri)})`, { weight: f.weight, style: f.style });
      document.fonts.add(await face.load());
    });
    if (theme.fontCss) {
      const family = theme.fontStack.split(',')[0].trim();
      jobs.push(
        new Promise<void>((resolve, reject) => {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = theme.fontCss!;
          link.onload = () => resolve();
          link.onerror = () => reject(new Error(`Could not load ${theme.fontCss}`));
          document.head.appendChild(link);
        }).then(() => Promise.all(['700', '800', '900'].map((w) => document.fonts.load(`${w} 1em ${family}`))))
      );
    }
    Promise.all(jobs)
      .then(() => continueRender(handle))
      .catch((err) => cancelRender(err));
    // Once per render tab: the props never change while it runs, and continueRender may only run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export const Video: React.FC<VideoProps> = ({ scenes, theme, musicUri, musicVolume, endCard, whooshUri, progressBar, subtitles }) => {
  useFonts(theme);
  const frame = useCurrentFrame();
  const { durationInFrames, fps, width, height } = useVideoConfig();
  const geometry = geometryFor(width, height);
  const total = durationInFrames || 1;
  const progress = Math.min(100, Math.max(0, (frame / total) * 100));

  // The end card covers the tail of the last scene (never more than 60% of it) while its last line is spoken.
  const last = scenes[scenes.length - 1];
  const endCardFrames = endCard && last ? Math.min(Math.round(endCard.seconds * fps), Math.round(last.durationInFrames * 0.6)) : 0;

  let from = 0;
  return (
    <div style={{ flex: 1, backgroundColor: '#000000', width, height, position: 'relative' }}>
      {progressBar && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 8, backgroundColor: 'rgba(255, 255, 255, 0.2)', zIndex: 100 }}>
          <div style={{ width: `${progress}%`, height: '100%', backgroundColor: theme.colors.accent, boxShadow: `0 0 16px ${theme.colors.accent}` }} />
        </div>
      )}

      {/* Loops: a video can run longer than its track. */}
      {musicUri && <Audio src={resolveSrc(musicUri)} volume={musicVolume} loop />}

      {scenes.map((scene) => {
        const start = from;
        from += scene.durationInFrames;
        return (
          <Sequence key={scene.id} from={start} durationInFrames={scene.durationInFrames} name={`Scene ${scene.id}`}>
            {scene.audioUri && <Audio src={resolveSrc(scene.audioUri)} volume={1} />}
            <Scene scene={scene} theme={theme} geometry={geometry} whooshUri={whooshUri} subtitles={subtitles} />
          </Sequence>
        );
      })}

      {endCard && endCardFrames > 0 && (
        <Sequence from={total - endCardFrames} durationInFrames={endCardFrames} name="End card">
          <EndCard content={endCard} theme={theme} geometry={geometry} />
        </Sequence>
      )}
    </div>
  );
};
