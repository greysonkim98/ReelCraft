import type { ColorLook } from '@reelcraft/shared';

// Colour looks stay in YUV on purpose. The ffmpeg.wasm 0.12 builds leak ~2.6 MB for every frame
// that goes through a YUV→RGB-planar (gbrp) conversion, so any RGB-only filter (colorbalance,
// curves, colorchannelmixer, lutrgb, colorlevels, ...) kills a long render with `Aborted(OOM)`
// at roughly 26 s of 1080×1920 output. Measured in Edge: even a bare
// `format=gbrp,format=yuv420p` round trip does it, while eq/hue/lutyuv render 60 s fine.
//
// The specification's original definitions were:
//   warm: colorbalance=rs=0.08:gs=0.02:bs=-0.08,eq=saturation=1.1
//   cool: colorbalance=rs=-0.06:bs=0.08,eq=saturation=1.05
//   film: curves=preset=vintage,eq=saturation=0.9
// The three below are YUV approximations of the same looks (chroma shifts / lifted blacks).
export const COLOR_FILTERS: Record<ColorLook, string> = {
  natural: 'eq=contrast=1.03:saturation=1.05',
  warm: "lutyuv=u='val-5':v='val+6',eq=saturation=1.1",
  cool: "lutyuv=u='val+6':v='val-4',eq=saturation=1.05",
  vivid: 'eq=contrast=1.1:saturation=1.35',
  film: "lutyuv=y='val*0.88+14':u='val-2':v='val+3',eq=saturation=0.9",
  mono: 'hue=s=0,eq=contrast=1.1',
};

/** Filters that force an RGB conversion; banned from the looks above (see the note on top). */
export const RGB_ONLY_FILTERS = [
  'colorbalance',
  'colorchannelmixer',
  'colorlevels',
  'colortemperature',
  'curves',
  'lutrgb',
  'gbrp',
  'rgb24',
  'rgba',
] as const;

export function colorFilter(look: ColorLook): string {
  return COLOR_FILTERS[look];
}
