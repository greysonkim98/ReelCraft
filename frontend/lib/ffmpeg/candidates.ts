import type { Tempo } from '@reelcraft/shared';
import { ANALYSIS } from './constants';
import type { ClipMetrics, FrameSample, Interval } from './metrics';

export interface Candidate {
  clipIndex: number;
  start: number;
  end: number;
  sceneStart: boolean;
  /** Raw sharpness (higher = sharper); normalised to a percentile within the clip when scoring. */
  sharp: number;
  yavg: number;
  ydif: number;
  blackFraction: number;
  freezeFraction: number;
  score: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function coverage(intervals: Interval[], start: number, end: number): number {
  const len = end - start;
  if (len <= 0) return 0;
  let covered = 0;
  for (const iv of intervals) covered += overlap(start, end, iv.start, iv.end);
  return Math.min(1, covered / len);
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function inWindow(samples: FrameSample[], start: number, end: number): FrameSample[] {
  return samples.filter((s) => s.t >= start && s.t < end);
}

/** Splits a scene of `length` seconds into pieces that fit the tempo's length range. */
export function splitScene(length: number, tempo: Tempo): number[] {
  const { min, max, target } = ANALYSIS.tempo[tempo];
  if (length < ANALYSIS.minCandidateSeconds) return [];
  if (length <= max) return [length];
  let n = Math.max(1, Math.round(length / target));
  if (length / n > max) n = Math.ceil(length / max);
  if (length / n < min) n = Math.max(1, Math.floor(length / min));
  return Array.from({ length: n }, () => length / n);
}

/**
 * Scene-aware candidate windows with raw measurements (score is filled by `scoreCandidates`).
 * `edge` is the optional fallback series (edgedetect+signalstats) used when blurdetect is absent.
 */
export function buildCandidates(
  clipIndex: number,
  duration: number,
  metrics: ClipMetrics,
  tempo: Tempo,
  edge?: ClipMetrics,
): Candidate[] {
  const cuts = metrics.sceneChanges.filter((t) => t > 0.05 && t < duration - 0.05);
  const bounds = [0, ...cuts, duration];
  const out: Candidate[] = [];

  for (let i = 0; i < bounds.length - 1; i++) {
    const sceneStart = bounds[i]!;
    const sceneLen = bounds[i + 1]! - sceneStart;
    const pieces = splitScene(sceneLen, tempo);
    let cursor = sceneStart;
    pieces.forEach((len, pieceIdx) => {
      const start = cursor;
      const end = cursor + len;
      cursor = end;

      const window = inWindow(metrics.samples, start, end);
      const blurMean = mean(window.flatMap((s) => (s.blur === undefined ? [] : [s.blur])));
      const edgeMean = edge
        ? mean(inWindow(edge.samples, start, end).flatMap((s) => (s.yavg === undefined ? [] : [s.yavg])))
        : undefined;
      // blur: lower is sharper → negate so "higher = sharper" for both sources.
      const sharp = blurMean !== undefined ? -blurMean : (edgeMean ?? 0);

      out.push({
        clipIndex,
        start,
        end,
        sceneStart: pieceIdx === 0,
        sharp,
        yavg: mean(window.flatMap((s) => (s.yavg === undefined ? [] : [s.yavg]))) ?? 128,
        ydif: mean(window.flatMap((s) => (s.ydif === undefined ? [] : [s.ydif]))) ?? 0,
        blackFraction: coverage(metrics.black, start, end),
        freezeFraction: coverage(metrics.freeze, start, end),
        score: 0,
      });
    });
  }
  return out;
}

export function exposureScore(yavg: number): number {
  const { goodMin, goodMax, floor, ceil } = ANALYSIS.exposure;
  if (yavg >= goodMin && yavg <= goodMax) return 1;
  if (yavg < goodMin) return clamp01((yavg - floor) / (goodMin - floor));
  return clamp01((ceil - yavg) / (ceil - goodMax));
}

export function motionScore(ydif: number): number {
  const { target, sigma } = ANALYSIS.motion;
  return Math.exp(-(((ydif - target) / sigma) ** 2));
}

/** Fills `score` in place using within-clip sharpness percentiles. */
export function scoreCandidates(candidates: Candidate[]): Candidate[] {
  const w = ANALYSIS.weights;
  const sharps = candidates.map((c) => c.sharp);
  for (const c of candidates) {
    let percentile = 0.5;
    if (candidates.length > 1) {
      const below = sharps.filter((s) => s < c.sharp).length;
      const equal = sharps.filter((s) => s === c.sharp).length;
      percentile = (below + (equal - 1) / 2) / (candidates.length - 1);
    }
    c.score =
      w.sharpness * percentile +
      w.exposure * exposureScore(c.yavg) +
      w.motion * motionScore(c.ydif) +
      w.sceneStart * (c.sceneStart ? 1 : 0);
  }
  return candidates;
}
