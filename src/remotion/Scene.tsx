import React from 'react';
import { Audio, Img, interpolate, OffthreadVideo, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Geometry } from './geometry';
import { resolveSrc } from './resolve-src';
import { Subtitles } from './Subtitles';
import type { RenderScene, Theme } from './types';

interface SceneProps {
  scene: RenderScene;
  theme: Theme;
  geometry: Geometry;
  whooshUri?: string;
  subtitles: { wordsPerChunk: number; uppercase: boolean };
}

/** Stills punch in or out every BEAT_SECONDS, like a jump cut, so a still never sits unchanged for long. */
const BEAT_SECONDS = 2.5;
const BEAT_ZOOM = 1.12;
const BEAT_EASE_FRAMES = 5;

/** The hook text shows for the first HOOK_SECONDS of the scene. */
const HOOK_SECONDS = 2.2;
const HOOK_TONES = {
  alert: { accent: '#f43f5e', glow: 'rgba(244, 63, 94, 0.8)' },
  curiosity: { accent: '#facc15', glow: 'rgba(250, 204, 21, 0.75)' },
  proof: { accent: '#22c55e', glow: 'rgba(34, 197, 94, 0.75)' },
} as const;

/** Phone-frame width/height for framed screenshots. */
const PHONE_RATIO = 0.69;

export const Scene: React.FC<SceneProps> = ({ scene, theme, geometry: g, whooshUri, subtitles }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const total = scene.durationInFrames;
  const { colors } = theme;
  const background = `linear-gradient(160deg, ${colors.backgroundDeep} 0%, ${colors.background} 55%, ${colors.backgroundDeep} 100%)`;

  // Hook: fast punch-in and a white flash on frame 0, then huge hook text that fades out after ~2 s.
  const hasHook = !!scene.hookText;
  const tone = HOOK_TONES[scene.hookTone || 'alert'];
  const hookFrames = Math.min(total, Math.round(HOOK_SECONDS * fps));
  const hookPunch = hasHook ? interpolate(frame, [0, 8], [1.12, 1.0], { extrapolateRight: 'clamp' }) : 1;
  const hookFlash = hasHook ? interpolate(frame, [0, 5], [0.6, 0], { extrapolateRight: 'clamp' }) : 0;
  const hookOpacity = hasHook
    ? interpolate(frame, [0, 4, Math.max(5, hookFrames - 8), Math.max(6, hookFrames)], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : 0;
  const hookPop = hasHook ? spring({ frame, fps, config: { damping: 11, stiffness: 220 } }) : 1;
  const hookWords = (scene.hookText || '').trim().split(/\s+/).filter(Boolean).length;
  const hookFontSize = g.hookFontSize * (hookWords <= 3 ? 1 : hookWords <= 5 ? 0.84 : 0.71);
  const hookAtTop = scene.hookPosition === 'top';

  const layout = scene.layout || (scene.isVideo ? 'fullbleed' : 'framed');
  const hasVisual = !scene.missing && !!scene.assetUri;

  // Full-bleed stills: a gentle push-in over the whole scene.
  const zoom = interpolate(frame, [0, total], [1.0, 1.04], { extrapolateRight: 'clamp' });

  const beatFrames = Math.round(BEAT_SECONDS * fps);
  const beat = Math.floor(frame / beatFrames);
  const beatScale = (n: number) => (n % 2 === 1 ? BEAT_ZOOM : 1);
  const beatZoom =
    beat === 0 ? 1 : interpolate(frame - beat * beatFrames, [0, BEAT_EASE_FRAMES], [beatScale(beat - 1), beatScale(beat)], { extrapolateRight: 'clamp' });

  // Framed screenshots: hold, then scroll to the part that matters (default top to bottom, so buttons at
  // the bottom of a tall screen are seen too). With cue words the scroll runs from one word to the other.
  const [panFrom, panTo] = scene.panY || [0, 100];
  const panStart = scene.panRangeSec ? Math.round(scene.panRangeSec[0] * fps) : 12;
  const panEnd = scene.panRangeSec ? Math.round(scene.panRangeSec[1] * fps) : Math.max(13, total - 30);
  const panY = interpolate(frame, [panStart, Math.max(panStart + 1, panEnd)], [panFrom, panTo], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Badge: appears on its cue word (default: scene start), stays ~2.7 s.
  const badgeStart = scene.badgeStartSec !== undefined ? Math.round(scene.badgeStartSec * fps) : 4;
  const badgeOpacity = interpolate(frame, [badgeStart, badgeStart + 8, badgeStart + 82, badgeStart + 94], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const { stage } = g;
  const phoneHeight = stage.height;
  const phoneWidth = Math.min(stage.width, Math.round(phoneHeight * PHONE_RATIO));
  const phone = { top: stage.top, left: Math.round((width - phoneWidth) / 2), width: phoneWidth, height: phoneHeight };
  const fill = { position: 'absolute' as const, inset: 0, width: '100%', height: '100%', objectFit: 'cover' as const };

  const renderStage = () => {
    // 1. Missing visual: a clearly labelled slot, so nobody posts it by mistake.
    if (!hasVisual) {
      return (
        <div
          style={{
            position: 'absolute',
            ...phone,
            width: Math.max(phoneWidth, Math.min(stage.width, 860)),
            left: Math.round((width - Math.max(phoneWidth, Math.min(stage.width, 860))) / 2),
            borderRadius: 44,
            border: `4px dashed ${colors.accent}`,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: 56,
            boxSizing: 'border-box',
          }}
        >
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 3, color: colors.accent }}>VISUAL NEEDED</div>
          <div style={{ fontSize: 120, fontWeight: 900, color: '#f8fafc', lineHeight: 1.1, marginTop: 14 }}>{scene.id}</div>
          {scene.neededVisual && (
            <div style={{ fontSize: 34, fontWeight: 600, color: '#cbd5e1', lineHeight: 1.35, marginTop: 24, maxWidth: 560 }}>{scene.neededVisual}</div>
          )}
        </div>
      );
    }

    // 2. Full bleed: the visual has the canvas's shape and fills it.
    if (layout === 'fullbleed') {
      // Footage is muted: the voice track carries the sound, so loudness stays under control.
      return scene.isVideo ? (
        <OffthreadVideo muted src={resolveSrc(scene.assetUri)} style={fill} />
      ) : (
        <Img src={resolveSrc(scene.assetUri)} style={{ ...fill, transform: `scale(${zoom * beatZoom})` }} />
      );
    }

    // 3. Fitted: a photo of another shape, shown whole across the stage band over a blurred copy.
    if (layout === 'fitted') {
      const box = { position: 'absolute' as const, top: stage.top, left: 0, width, height: stage.height, objectFit: 'contain' as const };
      return (
        <>
          {scene.backdropUri && <Img src={resolveSrc(scene.backdropUri)} style={fill} />}
          {scene.isVideo ? (
            <OffthreadVideo muted src={resolveSrc(scene.assetUri)} style={box} />
          ) : (
            <Img src={resolveSrc(scene.assetUri)} style={{ ...box, transform: `scale(${zoom * beatZoom})` }} />
          )}
        </>
      );
    }

    // 4. Framed: a tall screenshot in a phone frame, never covered, scrolling slowly.
    return (
      <>
        {scene.backdropUri && <Img src={resolveSrc(scene.backdropUri)} style={fill} />}
        <div
          style={{
            position: 'absolute',
            ...phone,
            borderRadius: 48,
            border: `10px solid ${colors.frame}`,
            boxShadow: '0 30px 80px rgba(0, 0, 0, 0.7)',
            overflow: 'hidden',
            boxSizing: 'border-box',
            backgroundColor: '#ffffff',
          }}
        >
          {scene.isVideo ? (
            <OffthreadVideo muted src={resolveSrc(scene.assetUri)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `50% ${panY}%` }} />
          ) : (
            <Img
              src={resolveSrc(scene.assetUri)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `50% ${panY}%`, transform: `scale(${beatZoom})`, transformOrigin: `50% ${panY}%` }}
            />
          )}
        </div>
      </>
    );
  };

  return (
    <div style={{ width, height, position: 'relative', background: layout === 'fullbleed' && hasVisual ? '#05070d' : background, fontFamily: theme.fontStack, overflow: 'hidden' }}>
      {scene.id > 1 && whooshUri && (
        <Sequence from={0} durationInFrames={Math.min(15, total)}>
          <Audio src={resolveSrc(whooshUri)} volume={0.1} />
        </Sequence>
      )}

      {scene.sfx && (
        <Sequence from={Math.round(scene.sfx.startSec * fps)}>
          <Audio src={resolveSrc(scene.sfx.src)} volume={scene.sfx.volume} />
        </Sequence>
      )}

      <div style={{ position: 'absolute', inset: 0, zIndex: 1, transform: `scale(${hookPunch})` }}>{renderStage()}</div>

      {hasHook && frame < hookFrames && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 40,
              opacity: hookOpacity,
              background: `radial-gradient(ellipse at ${hookAtTop ? '50% 21%' : 'center'}, rgba(5,7,13,0.8) 0%, rgba(5,7,13,0.4) 55%, rgba(5,7,13,0) 85%)`,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: hookAtTop ? g.hookTop.top : g.hookTop.center,
              height: g.hookHeight,
              zIndex: 45,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 60px',
              boxSizing: 'border-box',
              opacity: hookOpacity,
              transform: `scale(${0.7 + 0.3 * hookPop})`,
            }}
          >
            <div
              style={{
                fontSize: hookFontSize,
                fontWeight: 900,
                lineHeight: 1.15,
                textAlign: 'center',
                color: '#ffffff',
                maxWidth: width - 180,
                textShadow: `0 0 40px ${tone.glow}, 0 6px 18px rgba(0, 0, 0, 0.95)`,
                WebkitTextStroke: '2px rgba(0, 0, 0, 0.6)',
              }}
            >
              {scene.hookText}
            </div>
            <div style={{ marginTop: 28, width: 260, height: 12, borderRadius: 9999, backgroundColor: tone.accent, boxShadow: `0 0 28px ${tone.glow}` }} />
          </div>
          <div style={{ position: 'absolute', inset: 0, zIndex: 48, backgroundColor: '#ffffff', opacity: hookFlash }} />
        </>
      )}

      {/* Full-bleed visuals get darker edges so the badge and subtitles stay readable. */}
      {layout === 'fullbleed' && hasVisual && (
        <>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 240, background: 'linear-gradient(to bottom, rgba(5,7,13,0.55) 0%, rgba(5,7,13,0) 100%)', zIndex: 2 }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: g.bottomFade, background: 'linear-gradient(to top, rgba(5,7,13,0.7) 0%, rgba(5,7,13,0) 100%)', zIndex: 2 }} />
        </>
      )}

      {scene.badge && (
        <div style={{ position: 'absolute', top: g.badgeTop, left: 0, right: 0, display: 'flex', justifyContent: 'center', padding: '0 100px', zIndex: 50, opacity: badgeOpacity }}>
          <div
            style={{
              padding: '12px 28px',
              borderRadius: 9999,
              fontSize: g.badgeFontSize,
              fontWeight: 800,
              letterSpacing: 0.5,
              textAlign: 'center',
              lineHeight: 1.25,
              backgroundColor: 'rgba(6, 19, 32, 0.9)',
              color: colors.accent,
              border: `1.5px solid ${colors.accent}`,
              boxShadow: '0 12px 30px rgba(0, 0, 0, 0.55)',
              maxWidth: 800,
            }}
          >
            {scene.badge}
          </div>
        </div>
      )}

      {!scene.hideSubtitles && (
        <div style={{ position: 'absolute', bottom: g.subtitleBottom, left: 0, right: 0, zIndex: 60, display: 'flex', justifyContent: 'center', padding: '0 32px' }}>
          <div
            style={{
              backgroundColor: 'rgba(6, 19, 32, 0.92)',
              border: '2px solid rgba(255, 255, 255, 0.18)',
              borderRadius: 9999,
              padding: '14px 32px',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.9)',
              maxWidth: g.subtitleMaxWidth,
            }}
          >
            <Subtitles
              words={scene.words}
              fallbackText={scene.text}
              theme={theme}
              fontSize={g.subtitleFontSize}
              wordsPerChunk={subtitles.wordsPerChunk}
              uppercase={subtitles.uppercase}
            />
          </div>
        </div>
      )}
    </div>
  );
};
