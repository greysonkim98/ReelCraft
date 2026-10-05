import { describe, expect, it } from 'vitest';
import { buildCandidates, exposureScore, motionScore, scoreCandidates, splitScene } from './candidates';
import type { ClipMetrics } from './metrics';

const empty: ClipMetrics = { samples: [], sceneChanges: [], black: [], freeze: [] };

describe('splitScene', () => {
  it('drops scenes shorter than 0.8s', () => {
    expect(splitScene(0.7, 'energetic')).toEqual([]);
  });
  it('keeps a short scene whole', () => {
    expect(splitScene(1.2, 'energetic')).toEqual([1.2]);
    expect(splitScene(3.2, 'calm')).toEqual([3.2]);
  });
  it('splits long scenes into pieces within the tempo range', () => {
    const energetic = splitScene(9, 'energetic');
    expect(energetic.length).toBe(6);
    energetic.forEach((p) => {
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(2);
    });
    const calm = splitScene(20, 'calm');
    calm.forEach((p) => {
      expect(p).toBeGreaterThanOrEqual(3);
      expect(p).toBeLessThanOrEqual(5);
    });
    expect(calm.reduce((a, b) => a + b, 0)).toBeCloseTo(20);
  });
});

describe('scoring helpers', () => {
  it('exposure is 1 inside 60..190 and decays outside', () => {
    expect(exposureScore(60)).toBe(1);
    expect(exposureScore(190)).toBe(1);
    expect(exposureScore(16)).toBe(0);
    expect(exposureScore(235)).toBe(0);
    expect(exposureScore(30)).toBeLessThan(exposureScore(50));
    expect(exposureScore(220)).toBeLessThan(exposureScore(200));
  });
  it('motion peaks at a moderate frame difference', () => {
    expect(motionScore(4)).toBe(1);
    expect(motionScore(0)).toBeLessThan(motionScore(3));
    expect(motionScore(30)).toBeLessThan(motionScore(6));
  });
});

describe('buildCandidates', () => {
  it('cuts at scene changes and flags the first piece of each scene', () => {
    const metrics: ClipMetrics = { ...empty, sceneChanges: [4, 10] };
    const c = buildCandidates(0, 14, metrics, 'calm');
    // scenes 0–4, 4–10, 10–14 → one piece (4s), two pieces (3s each), one piece (4s)
    expect(c.map((x) => [x.start, x.end])).toEqual([
      [0, 4],
      [4, 7],
      [7, 10],
      [10, 14],
    ]);
    expect(c.map((x) => x.sceneStart)).toEqual([true, true, false, true]);
  });

  it('measures black and freeze coverage per candidate', () => {
    const metrics: ClipMetrics = {
      ...empty,
      sceneChanges: [],
      black: [{ start: 0, end: 1 }],
      freeze: [{ start: 1.5, end: 2 }],
    };
    const [c] = buildCandidates(0, 2, metrics, 'energetic');
    expect(c!.blackFraction).toBeCloseTo(0.5);
    expect(c!.freezeFraction).toBeCloseTo(0.25);
  });

  it('uses negated blur as sharpness, else the edge fallback', () => {
    const blurry: ClipMetrics = { ...empty, samples: [{ t: 0.1, blur: 8 }, { t: 0.2, blur: 12 }] };
    expect(buildCandidates(0, 1.5, blurry, 'energetic')[0]!.sharp).toBe(-10);
    const edge: ClipMetrics = { ...empty, samples: [{ t: 0.1, yavg: 30 }, { t: 0.2, yavg: 50 }] };
    expect(buildCandidates(0, 1.5, empty, 'energetic', edge)[0]!.sharp).toBe(40);
  });
});

describe('scoreCandidates', () => {
  it('ranks the sharper candidate higher within a clip', () => {
    const base = { clipIndex: 0, sceneStart: false, yavg: 120, ydif: 4, blackFraction: 0, freezeFraction: 0, score: 0 };
    const [soft, sharp] = scoreCandidates([
      { ...base, start: 0, end: 1.5, sharp: -12 },
      { ...base, start: 3, end: 4.5, sharp: -2 },
    ]);
    expect(sharp!.score).toBeGreaterThan(soft!.score);
    expect(sharp!.score).toBeCloseTo(0.45 + 0.25 + 0.2);
    expect(soft!.score).toBeCloseTo(0.25 + 0.2);
  });
});
