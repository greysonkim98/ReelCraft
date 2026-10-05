import { describe, expect, it } from 'vitest';
import type { Candidate } from './candidates';
import { selectSegments } from './select';

function cand(clipIndex: number, start: number, end: number, score: number, extra: Partial<Candidate> = {}): Candidate {
  return {
    clipIndex,
    start,
    end,
    sceneStart: false,
    sharp: 0,
    yavg: 120,
    ydif: 4,
    blackFraction: 0,
    freezeFraction: 0,
    score,
    ...extra,
  };
}

/** `perClip` evenly spaced 1.5s candidates per clip with descending scores. */
function clipsOf(count: number, perClip: number): Candidate[][] {
  return Array.from({ length: count }, (_, c) =>
    Array.from({ length: perClip }, (_, k) => cand(c, k * 3, k * 3 + 1.5, 0.9 - k * 0.05 - c * 0.001)),
  );
}

const total = (segs: { start: number; end: number }[]) => segs.reduce((s, x) => s + (x.end - x.start), 0);

describe('selectSegments', () => {
  it('includes every clip when they fit', () => {
    const { segments, unusedClips } = selectSegments(clipsOf(5, 10), { tempo: 'energetic', maxOutputSeconds: 60 });
    expect(new Set(segments.map((s) => s.clipIndex)).size).toBe(5);
    expect(unusedClips).toEqual([]);
  });

  it('never exceeds the output limit, even with ~15 clips of material', () => {
    const { segments } = selectSegments(clipsOf(15, 30), { tempo: 'energetic', maxOutputSeconds: 60 });
    expect(total(segments)).toBeLessThanOrEqual(60 + 1e-9);
    expect(total(segments)).toBeGreaterThan(55);
  });

  it('keeps only the best clips when there are too many for one pass, and reports the rest unused', () => {
    // 80 clips × 1.5s = 120s of "best" picks > 60s
    const { segments, unusedClips } = selectSegments(clipsOf(80, 1), { tempo: 'energetic', maxOutputSeconds: 60 });
    expect(total(segments)).toBeLessThanOrEqual(60 + 1e-9);
    expect(segments.length).toBe(40);
    expect(unusedClips.length).toBe(40);
    // clip 0 has the highest score (0.9 - 0 * 0.001) and must be kept
    expect(segments.some((s) => s.clipIndex === 0)).toBe(true);
    expect(unusedClips).not.toContain(0);
  });

  it('caps segments per clip at ceil(target / clips) + 1', () => {
    // energetic target = round(60/1.5) = 40; 2 clips → cap = 21
    const { segments } = selectSegments(clipsOf(2, 40), { tempo: 'energetic', maxOutputSeconds: 60 });
    for (const clip of [0, 1]) {
      expect(segments.filter((s) => s.clipIndex === clip).length).toBeLessThanOrEqual(21);
    }
  });

  it('never picks overlapping or near-touching segments from the same clip', () => {
    const list = [
      cand(0, 0, 1.5, 0.9),
      cand(0, 1.5, 3.0, 0.85), // touches the first → rejected
      cand(0, 1.8, 3.3, 0.84), // 0.3s gap < 0.5 → rejected
      cand(0, 2.1, 3.6, 0.8), // 0.6s gap → accepted
    ];
    const { segments } = selectSegments([list], { tempo: 'energetic', maxOutputSeconds: 60 });
    expect(segments.map((s) => [s.start, s.end])).toEqual([
      [0, 1.5],
      [2.1, 3.6],
    ]);
  });

  it('excludes mostly-black, mostly-frozen and low-score candidates', () => {
    const list = [
      cand(0, 0, 1.5, 0.9, { blackFraction: 0.3 }),
      cand(0, 3, 4.5, 0.9, { freezeFraction: 0.5 }),
      cand(0, 6, 7.5, 0.2),
      cand(0, 9, 10.5, 0.5, { blackFraction: 0.29, freezeFraction: 0.49 }),
    ];
    const { segments } = selectSegments([list], { tempo: 'energetic', maxOutputSeconds: 60 });
    expect(segments.map((s) => s.start)).toEqual([9]);
  });

  it('marks a clip with no usable candidates as unused', () => {
    const { unusedClips } = selectSegments([[cand(0, 0, 1.5, 0.8)], [cand(1, 0, 1.5, 0.8, { freezeFraction: 1 })]], {
      tempo: 'energetic',
      maxOutputSeconds: 60,
    });
    expect(unusedClips).toEqual([1]);
  });

  it('orders by clip, then time, and assigns ids and maxChars', () => {
    const { segments } = selectSegments(
      [[cand(0, 8, 9.5, 0.7), cand(0, 0, 1.5, 0.9)], [cand(1, 2, 3.5, 0.8)]],
      { tempo: 'energetic', maxOutputSeconds: 60 },
    );
    expect(segments.map((s) => [s.clipIndex, s.start])).toEqual([
      [0, 0],
      [0, 8],
      [1, 2],
    ]);
    expect(segments.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    // 1.5s × 15 chars/s = 22.5 → 23
    expect(segments[0]!.maxChars).toBe(23);
    expect(segments[0]!.editedByUser).toBe(false);
    expect(segments[0]!.subtitle).toBe('');
  });

  it('clamps maxChars to 12..80', () => {
    const { segments } = selectSegments([[cand(0, 0, 0.8, 0.9), cand(0, 5, 11, 0.8)]], {
      tempo: 'calm',
      maxOutputSeconds: 60,
    });
    expect(segments[0]!.maxChars).toBe(12);
    expect(segments[1]!.maxChars).toBe(80);
  });
});
