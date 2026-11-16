/**
 * Where things sit on the canvas, for both formats. Vertical keeps clear of the Reels/Shorts UI (the
 * caption and username at the bottom, the like/comment column at the right edge); landscape keeps
 * clear of YouTube's progress bar and controls at the bottom.
 */
export interface Geometry {
  /** The box visuals other than full-bleed ones sit in. */
  stage: { top: number; left: number; width: number; height: number };
  /** Distance from the bottom edge to the bottom of the subtitle pill. */
  subtitleBottom: number;
  subtitleMaxWidth: number;
  subtitleFontSize: number;
  badgeTop: number;
  badgeFontSize: number;
  /** Hook text: its box top in each position, its height and the base font size. */
  hookTop: { top: number; center: number };
  hookHeight: number;
  hookFontSize: number;
  /** Bottom fade under the subtitles on full-bleed visuals. */
  bottomFade: number;
  /** End card: top padding and scale of everything on it. */
  endCardTop: number;
  endCardScale: number;
}

export function geometryFor(width: number, height: number): Geometry {
  if (height >= width) {
    // 1080x1920
    return {
      stage: { top: 180, left: 110, width: 860, height: 1240 },
      subtitleBottom: 380,
      subtitleMaxWidth: 860,
      subtitleFontSize: 44,
      badgeTop: 70,
      badgeFontSize: 24,
      hookTop: { top: 180, center: 560 },
      hookHeight: 440,
      hookFontSize: 124,
      bottomFade: 520,
      endCardTop: 400,
      endCardScale: 1,
    };
  }
  // 1920x1080: screenshots and photos sit in the middle, subtitles in the lower band.
  return {
    stage: { top: 90, left: 160, width: 1600, height: 760 },
    subtitleBottom: 90,
    subtitleMaxWidth: 1500,
    subtitleFontSize: 52,
    badgeTop: 36,
    badgeFontSize: 26,
    hookTop: { top: 120, center: 300 },
    hookHeight: 420,
    hookFontSize: 132,
    bottomFade: 320,
    endCardTop: 120,
    endCardScale: 0.8,
  };
}
