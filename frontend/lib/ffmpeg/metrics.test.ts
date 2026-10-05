import { describe, expect, it } from 'vitest';
import { parseMetrics } from './metrics';

// Real ffmpeg log shapes (metadata=print + detector logs).
const LOG = [
  '[Parsed_metadata_5 @ 0000020] frame:0    pts:0       pts_time:0',
  '[Parsed_metadata_5 @ 0000020] lavfi.blur=7.250000',
  '[Parsed_metadata_5 @ 0000020] lavfi.signalstats.YMIN=16',
  '[Parsed_metadata_5 @ 0000020] lavfi.signalstats.YAVG=101.5',
  '[Parsed_metadata_5 @ 0000020] lavfi.signalstats.YDIF=0.0',
  '[Parsed_metadata_5 @ 0000020] frame:1    pts:1       pts_time:0.1',
  '[Parsed_metadata_5 @ 0000020] lavfi.blur=7.500000',
  '[Parsed_metadata_5 @ 0000020] lavfi.signalstats.YAVG=102.5',
  '[Parsed_metadata_5 @ 0000020] lavfi.signalstats.YDIF=3.5',
  '[scdet @ 000001] lavfi.scd.score: 45.2, lavfi.scd.time: 4',
  '[Parsed_metadata_5 @ 0000020] frame:40   pts:40      pts_time:4',
  '[Parsed_metadata_5 @ 0000020] lavfi.scd.score=45.2',
  '[Parsed_metadata_5 @ 0000020] lavfi.scd.time=4',
  '[blackdetect @ 000002] black_start:4 black_end:5.5 black_duration:1.5',
  '[freezedetect @ 000003] lavfi.freezedetect.freeze_start: 8.5',
  '[Parsed_metadata_5 @ 0000020] lavfi.freezedetect.freeze_start=8.5',
  '[freezedetect @ 000003] lavfi.freezedetect.freeze_duration: 3.5',
  '[freezedetect @ 000003] lavfi.freezedetect.freeze_end: 12',
  'frame=  120 fps=0.0 q=-0.0 size=N/A time=00:00:12.00 bitrate=N/A',
];

describe('parseMetrics', () => {
  const m = parseMetrics(LOG, 12);

  it('collects per-frame samples with time, luma, motion and blur', () => {
    expect(m.samples).toEqual([
      { t: 0, blur: 7.25, yavg: 101.5, ydif: 0 },
      { t: 0.1, blur: 7.5, yavg: 102.5, ydif: 3.5 },
      { t: 4 },
    ]);
  });

  it('de-duplicates scene changes seen in both the info log and the metadata', () => {
    expect(m.sceneChanges).toEqual([4]);
  });

  it('reads black intervals', () => {
    expect(m.black).toEqual([{ start: 4, end: 5.5 }]);
  });

  it('pairs freeze start/end once even though both log forms appear', () => {
    expect(m.freeze).toEqual([{ start: 8.5, end: 12 }]);
  });

  it('closes a freeze that never ended at the clip duration', () => {
    const open = parseMetrics(['[freezedetect @ 1] lavfi.freezedetect.freeze_start: 2.5'], 10);
    expect(open.freeze).toEqual([{ start: 2.5, end: 10 }]);
  });

  it('ignores unrelated lines', () => {
    const none = parseMetrics(['Input #0, mov,mp4', '  Duration: 00:00:12.00, start: 0.000000'], 12);
    expect(none).toEqual({ samples: [], sceneChanges: [], black: [], freeze: [] });
  });
});
