// @ffmpeg/core-mt preallocates a FIXED pool of 32 pthread workers. If ffmpeg asks for more
// threads than that, the encode DEADLOCKS (0% progress forever, eventually the tab crashes).
// ffmpeg's defaults (x264 ≈ 1.5×cores, decoders and filters = all cores, one demux thread per
// input) hung on a 20-core machine, and even `-threads 4/2/2` hung with 6 inputs. Measured in
// Edge: encoder 2 / filter 1 / decoder 1 renders 6 clips in ~1.1× realtime and 15 clips / 41
// segments (59 s of output, 1080p) in ~50 s. Do not raise these without re-testing with many clips.

export const THREADS = {
  /** Fixed by the prebuilt @ffmpeg/core-mt binary; cannot be raised at runtime. */
  poolSize: 32,
  /** libx264 frame threads (x264 adds a lookahead thread on top). */
  encoder: 2,
  /** Slice threads inside a filter graph. */
  filter: 1,
  /** Decoder threads per input. */
  decoder: 1,
  /**
   * ffmpeg starts one demux thread per input when a command has several, so inputs are the
   * unbounded term. Verified at 15; above this a render switches to the single-thread core.
   */
  maxMultiThreadInputs: 20,
} as const;

export const inputThreadArgs = ['-threads', String(THREADS.decoder)];

export const filterThreadArgs = [
  '-filter_threads',
  String(THREADS.filter),
  '-filter_complex_threads',
  String(THREADS.filter),
];

export const encoderThreadArgs = ['-threads', String(THREADS.encoder)];
