/** Props of the Remotion composition. Built by src/render.ts; everything is resolved and timed already. */

export interface WordTimestamp {
  word: string;
  /** Seconds from the start of the scene. */
  start: number;
  end: number;
}

export interface RenderScene {
  id: number;
  text: string;
  /** File name in the render's public dir (staticFile), or a data:/http(s) URI. '' while the visual is missing. */
  assetUri: string;
  /** Blurred, darkened copy of a fitted/framed still that fills the canvas behind it (made once by ffmpeg). */
  backdropUri?: string;
  audioUri?: string;
  isVideo?: boolean;
  /** A clip's own length; when it is shorter than the scene, its last frame is held to the end. */
  clipDurationInFrames?: number;
  layout?: 'fullbleed' | 'framed' | 'fitted';
  panY?: [number, number];
  missing?: boolean;
  neededVisual?: string;
  badge?: string;
  badgeStartSec?: number;
  panRangeSec?: [number, number];
  durationSec: number;
  durationInFrames: number;
  words?: WordTimestamp[];
  hookText?: string;
  hookTone?: 'alert' | 'curiosity' | 'proof';
  hookPosition?: 'top' | 'center';
  sfx?: { src: string; volume: number; startSec: number };
  hideSubtitles?: boolean;
}

export interface Theme {
  colors: {
    background: string;
    backgroundDeep: string;
    accent: string;
    onAccent: string;
    text: string;
    frame: string;
  };
  /** CSS font-family stack. */
  fontStack: string;
  /** Font files to load before the first frame: the family name and files in the public dir. */
  fontFaces: Array<{ family: string; uri: string; weight: string; style: string }>;
  /** Google Fonts stylesheet URL to load before the first frame. */
  fontCss?: string;
  logoUri?: string;
}

export interface EndCardProps {
  headline?: string;
  button?: string;
  url?: string;
  subline?: string;
  tagline?: string;
  seconds: number;
}

export interface VideoProps extends Record<string, unknown> {
  width: number;
  height: number;
  fps: number;
  scenes: RenderScene[];
  theme: Theme;
  musicUri?: string;
  musicVolume: number;
  endCard?: EndCardProps;
  whooshUri?: string;
  progressBar: boolean;
  subtitles: { wordsPerChunk: number; uppercase: boolean };
}
