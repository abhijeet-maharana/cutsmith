import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Theme, WordTimestamp } from './types';

interface SubtitlesProps {
  words?: WordTimestamp[];
  fallbackText: string;
  theme: Theme;
  fontSize: number;
  wordsPerChunk: number;
  uppercase: boolean;
}

/** Karaoke subtitles: a few words at a time, the spoken word popping in the accent colour. */
export const Subtitles: React.FC<SubtitlesProps> = ({ words, fallbackText, theme, fontSize, wordsPerChunk, uppercase }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const now = frame / fps;
  const shadow = '0 4px 12px rgba(0, 0, 0, 0.95)';

  if (!words || words.length === 0) {
    return (
      <div style={{ fontFamily: theme.fontStack, color: theme.colors.text, fontSize: fontSize * 0.86, fontWeight: 900, lineHeight: 1.3, textShadow: shadow, textAlign: 'center' }}>
        {fallbackText}
      </div>
    );
  }

  let active = words.findIndex((w) => now >= w.start && now <= w.end);
  if (active === -1) {
    // Between words: keep the last word that started (or the first, before any word).
    active = Math.max(0, words.map((w) => now >= w.start).lastIndexOf(true));
  }
  const chunkStart = Math.floor(active / wordsPerChunk) * wordsPerChunk;
  const chunk = words.slice(chunkStart, chunkStart + wordsPerChunk);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: fontSize * 0.68, whiteSpace: 'nowrap', fontFamily: theme.fontStack, textAlign: 'center' }}>
      {chunk.map((w, i) => {
        const speaking = now >= w.start && now <= w.end;
        const spoken = now > w.end;
        const pop = speaking ? spring({ frame: Math.max(0, frame - Math.floor(w.start * fps)), fps, config: { damping: 10, stiffness: 240 } }) : 0;
        return (
          <span
            key={chunkStart + i}
            style={{
              display: 'inline-block',
              transform: `scale(${speaking ? 1 + pop * 0.1 : 1})`,
              color: speaking ? theme.colors.accent : spoken ? theme.colors.text : 'rgba(255, 255, 255, 0.75)',
              fontSize,
              fontWeight: 900,
              textTransform: uppercase ? 'uppercase' : 'none',
              letterSpacing: 0.5,
              textShadow: speaking ? `0 0 35px ${theme.colors.accent}, ${shadow}` : shadow,
            }}
          >
            {w.word}
          </span>
        );
      })}
    </div>
  );
};
