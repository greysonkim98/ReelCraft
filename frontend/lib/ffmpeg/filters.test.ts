import { COLOR_LOOKS } from '@reelcraft/shared';
import { describe, expect, it } from 'vitest';
import { COLOR_FILTERS, RGB_ONLY_FILTERS, colorFilter } from './filters';

describe('colour looks', () => {
  it('defines every look from the shared list', () => {
    expect(Object.keys(COLOR_FILTERS).sort()).toEqual([...COLOR_LOOKS].sort());
    for (const look of COLOR_LOOKS) expect(colorFilter(look).length).toBeGreaterThan(0);
  });

  // Regression guard: RGB conversions leak memory per frame in ffmpeg.wasm (see filters.ts).
  it.each(COLOR_LOOKS)('"%s" does not force an RGB conversion', (look) => {
    for (const banned of RGB_ONLY_FILTERS) {
      expect(colorFilter(look)).not.toContain(banned);
    }
  });
});
