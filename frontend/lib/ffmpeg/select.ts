import { computeMaxChars, type Segment, type Tempo } from '@reelcraft/shared';
import type { Candidate } from './candidates';
import { ANALYSIS } from './constants';

export interface SelectOptions {
  tempo: Tempo;
  maxOutputSeconds: number;
}

export interface SelectResult {
  segments: Segment[];
  /** Clips that did not make it into the draft (shown as "unused" for manual adding). */
  unusedClips: number[];
}

const len = (c: Candidate) => c.end - c.start;

function eligible(c: Candidate): boolean {
  const ex = ANALYSIS.exclude;
  return c.blackFraction < ex.blackFraction && c.freezeFraction < ex.freezeFraction && c.score >= ex.minScore;
}

function clashes(c: Candidate, picked: Candidate[]): boolean {
  const gap = ANALYSIS.minGapSeconds;
  return picked.some(
    (p) => p.clipIndex === c.clipIndex && c.start < p.end + gap && c.end > p.start - gap,
  );
}

/**
 * Picks the segment draft (spec 5.4):
 * 1. the best candidate of every clip, best-scoring clips first, while they fit;
 * 2. remaining candidates by score, capped per clip, no overlap / near-touching, stop at the limit;
 * 3. sorted by clip order, then time.
 */
export function selectSegments(
  candidatesByClip: Candidate[][],
  { tempo, maxOutputSeconds }: SelectOptions,
): SelectResult {
  const clipCount = candidatesByClip.length;
  const targetCount = Math.max(1, Math.round(maxOutputSeconds / ANALYSIS.tempo[tempo].target));
  const perClipCap = Math.ceil(targetCount / Math.max(1, clipCount)) + 1;

  const pool = candidatesByClip.map((list) => list.filter(eligible));
  const picked: Candidate[] = [];
  let total = 0;

  const bests = pool
    .map((list) => list.reduce<Candidate | undefined>((b, c) => (b === undefined || c.score > b.score ? c : b), undefined))
    .filter((c): c is Candidate => c !== undefined)
    .sort((a, b) => b.score - a.score);
  for (const c of bests) {
    if (total + len(c) <= maxOutputSeconds + 1e-9) {
      picked.push(c);
      total += len(c);
    }
  }

  const rest = pool
    .flat()
    .filter((c) => !picked.includes(c))
    .sort((a, b) => b.score - a.score);
  for (const c of rest) {
    if (picked.filter((p) => p.clipIndex === c.clipIndex).length >= perClipCap) continue;
    if (clashes(c, picked)) continue;
    if (total + len(c) > maxOutputSeconds + 1e-9) break;
    picked.push(c);
    total += len(c);
  }

  picked.sort((a, b) => a.clipIndex - b.clipIndex || a.start - b.start);
  const segments: Segment[] = picked.map((c, i) => ({
    id: `s${i + 1}`,
    clipIndex: c.clipIndex,
    start: round3(c.start),
    end: round3(c.end),
    score: round3(c.score),
    subtitle: '',
    maxChars: computeMaxChars(len(c)),
    editedByUser: false,
  }));

  const used = new Set(picked.map((c) => c.clipIndex));
  const unusedClips = candidatesByClip.map((_, i) => i).filter((i) => !used.has(i));
  return { segments, unusedClips };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
