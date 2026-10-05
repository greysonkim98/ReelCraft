// All tunable thresholds and weights for the browser video pipeline live here (spec ch.5).

export const ANALYSIS = {
  proxyHeight: 360,
  proxyFps: 10,
  proxyCrf: 32,
  scdetThreshold: 10,
  blackDetect: { minDuration: 0.3, pixTh: 0.1 },
  freezeDetect: { noise: 0.003, duration: 0.8 },
  /** Candidate length range (seconds) per tempo. */
  tempo: {
    energetic: { min: 1, max: 2, target: 1.5 },
    calm: { min: 3, max: 5, target: 4 },
  },
  /** Scenes/candidates shorter than this are dropped. */
  minCandidateSeconds: 0.8,
  weights: { sharpness: 0.45, exposure: 0.25, motion: 0.2, sceneStart: 0.1 },
  /** YAVG in [goodMin, goodMax] scores 1; falls to 0 at floor / ceil. */
  exposure: { goodMin: 60, goodMax: 190, floor: 16, ceil: 235 },
  /** Motion = bell curve on mean YDIF: best around `target`, width `sigma`. */
  motion: { target: 4, sigma: 4 },
  exclude: { blackFraction: 0.3, freezeFraction: 0.5, minScore: 0.25 },
  /** Two picks from the same clip must be at least this far apart. */
  minGapSeconds: 0.5,
} as const;

export const RENDER = {
  fps: 30,
  sizes: {
    '720p': { width: 720, height: 1280 },
  },
  audioRate: 48000,
  narrationOriginalVolume: 0.25,
  maxAtempo: 1.3,
  narrationFadeSeconds: 0.2,
} as const;

export const SUBTITLE_RENDER = {
  /** A line longer than this is wrapped at word boundaries. */
  wrapAt: 28,
  fontFile: 'NotoSans-Bold.ttf',
  fontFamily: 'Noto Sans',
} as const;
