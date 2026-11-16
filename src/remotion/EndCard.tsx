import React from 'react';
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Geometry } from './geometry';
import { resolveSrc } from './resolve-src';
import type { EndCardProps, Theme } from './types';

/**
 * Closing frame over the end of the last scene (its voice keeps playing underneath): logo, headline,
 * a pulsing button, the URL, a subline and a tagline. Every part is optional.
 */
export const EndCard: React.FC<{ content: EndCardProps; theme: Theme; geometry: Geometry }> = ({ content, theme, geometry }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { colors } = theme;
  const s = geometry.endCardScale;

  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  const logoPop = spring({ frame, fps, config: { damping: 12, stiffness: 180 } });
  const ctaPop = spring({ frame: Math.max(0, frame - 6), fps, config: { damping: 11, stiffness: 200 } });
  const pulse = 1 + 0.035 * Math.sin((frame / fps) * Math.PI * 2);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 90,
        opacity: fadeIn,
        background: `linear-gradient(160deg, ${colors.backgroundDeep} 0%, ${colors.background} 55%, ${colors.backgroundDeep} 100%)`,
        fontFamily: theme.fontStack,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: geometry.endCardTop,
        boxSizing: 'border-box',
      }}
    >
      {theme.logoUri && <Img src={resolveSrc(theme.logoUri)} style={{ width: 560 * s, maxHeight: 320 * s, objectFit: 'contain', transform: `scale(${0.8 + 0.2 * logoPop})` }} />}

      {content.headline && (
        <div
          style={{
            marginTop: (theme.logoUri ? 150 : 0) * s,
            fontSize: 92 * s,
            fontWeight: 800,
            color: colors.text,
            textAlign: 'center',
            lineHeight: 1.1,
            padding: '0 80px',
            transform: `scale(${0.85 + 0.15 * ctaPop})`,
            opacity: ctaPop,
          }}
        >
          {content.headline}
        </div>
      )}

      {content.button && (
        <div
          style={{
            marginTop: 60 * s,
            padding: `${28 * s}px ${72 * s}px`,
            borderRadius: 9999,
            backgroundColor: colors.accent,
            color: colors.onAccent,
            fontSize: 60 * s,
            fontWeight: 800,
            letterSpacing: 1,
            boxShadow: `0 0 60px ${colors.accent}`,
            transform: `scale(${ctaPop * pulse})`,
          }}
        >
          {content.button}
        </div>
      )}

      {content.url && <div style={{ marginTop: 56 * s, fontSize: 44 * s, fontWeight: 700, color: 'rgba(255, 255, 255, 0.85)' }}>{content.url}</div>}
      {content.subline && <div style={{ marginTop: 18 * s, fontSize: 34 * s, fontWeight: 700, color: 'rgba(255, 255, 255, 0.6)' }}>{content.subline}</div>}
      {content.tagline && <div style={{ marginTop: 64 * s, fontSize: 36 * s, fontWeight: 800, letterSpacing: 2, color: colors.accent }}>{content.tagline}</div>}
    </div>
  );
};
