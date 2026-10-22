import { describe, expect, it } from 'vitest';
import { evenlySpaced, groupSizes, midTime } from './sampleFrames';

describe('midTime', () => {
  it('is the middle of the scene', () => {
    expect(midTime(4, 5.5)).toBe(4.75);
    expect(midTime(0, 2.92)).toBe(1.46);
  });
});

describe('groupSizes', () => {
  it('packs scenes into at most two images of up to four, as evenly as possible, keeping the total', () => {
    expect(groupSizes(1)).toEqual([1]);
    expect(groupSizes(4)).toEqual([4]);
    expect(groupSizes(5)).toEqual([3, 2]);
    expect(groupSizes(7)).toEqual([4, 3]);
    expect(groupSizes(8)).toEqual([4, 4]);
    for (let n = 1; n <= 8; n++) {
      const sizes = groupSizes(n);
      expect(sizes.length).toBeLessThanOrEqual(2);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(4);
    }
  });
});

describe('evenlySpaced', () => {
  it('returns every index when there are few, otherwise spreads them over the reel', () => {
    expect(evenlySpaced(4, 8)).toEqual([0, 1, 2, 3]);
    const picks = evenlySpaced(30, 8);
    expect(picks).toHaveLength(8);
    expect(picks[0]).toBe(0);
    expect(picks[7]).toBe(29);
    expect(new Set(picks).size).toBe(8);
  });
});
