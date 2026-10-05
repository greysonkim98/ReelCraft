import { describe, expect, it } from 'vitest';
import { colorFilter } from './filters';
import { buildRenderCommand, parseProgressTime, type RenderPlan } from './render';

const plan: RenderPlan = {
  clips: [
    { inputPath: '/in/c0.mp4', hasAudio: true },
    { inputPath: '/in/c1.mp4', hasAudio: false },
    { inputPath: '/in/c2.mp4', hasAudio: true },
  ],
  segments: [
    { clipIndex: 0, start: 0.5, end: 2 },
    { clipIndex: 1, start: 1, end: 2.5 },
    { clipIndex: 0, start: 6, end: 8 },
  ],
  color: 'warm',
  quality: '720p',
  assPath: '/subs.ass',
  fontsDir: '/fonts',
  outputPath: '/out.mp4',
};

describe('buildRenderCommand', () => {
  const cmd = buildRenderCommand(plan);
  const fg = cmd.filterComplex;

  it('uses one input per used clip (unused clip 2 is not opened)', () => {
    const inputs = cmd.args.flatMap((a, i) => (a === '-i' ? [cmd.args[i + 1]] : []));
    expect(inputs).toEqual(['/in/c0.mp4', '/in/c1.mp4']);
  });

  it('reports the total timeline length', () => {
    expect(cmd.totalSeconds).toBeCloseTo(5);
  });

  it('splits a clip that feeds several segments', () => {
    expect(fg).toContain('[0:v]split=2[vx0][vx2]');
    expect(fg).toContain('[0:a]asplit=2[ax0][ax2]');
    // clip 1 feeds one segment: referenced directly, and it has no audio track
    expect(fg).toContain('[1:v]trim=start=1.000:end=2.500');
    expect(fg).not.toContain('[1:a]');
  });

  it('scales to fill 720x1280, crops, fixes SAR and fps for every segment', () => {
    for (const i of [0, 1, 2]) {
      expect(fg).toMatch(
        new RegExp(`trim=start=[\\d.]+:end=[\\d.]+,setpts=PTS-STARTPTS,scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30\\[v${i}\\]`),
      );
    }
  });

  it('substitutes silence for a clip without audio', () => {
    expect(fg).toContain('anullsrc=r=48000:cl=stereo,atrim=duration=1.500,asetpts=PTS-STARTPTS[a1]');
  });

  it('concatenates all segments, then colour grade and subtitles', () => {
    expect(fg).toContain('[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[vc][ac]');
    expect(fg).toContain(`[vc]${colorFilter('warm')},subtitles=/subs.ass:fontsdir=/fonts[vout]`);
  });

  it('maps video and original audio and uses the specified encoder settings', () => {
    expect(cmd.args).toEqual(expect.arrayContaining(['-map', '[vout]', '[ac]']));
    const tail = cmd.args.slice(cmd.args.indexOf('-c:v')).join(' ');
    expect(tail).toBe('-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -r 30 -c:a aac -b:a 128k -movflags +faststart -threads 2 /out.mp4');
  });

  it('renders 720p at 720x1280', () => {
    expect(buildRenderCommand(plan).filterComplex).toContain('scale=720:1280');
  });

  it('rejects empty plans and dangling clip references', () => {
    expect(() => buildRenderCommand({ ...plan, segments: [] })).toThrow();
    expect(() => buildRenderCommand({ ...plan, segments: [{ clipIndex: 9, start: 0, end: 1 }] })).toThrow();
  });
});

describe('narration mixing', () => {
  const withNarration = buildRenderCommand({
    ...plan,
    narration: [
      { path: '/tmp/tts_0.wav', segmentIndex: 0, durationSec: 1.0 }, // fits the 1.5s segment
      { path: '/tmp/tts_1.wav', segmentIndex: 1, durationSec: 3.0 }, // too long for 1.5s
    ],
  });
  const fg = withNarration.filterComplex;

  it('adds narration inputs after the clip inputs', () => {
    const inputs = withNarration.args.flatMap((a, i) => (a === '-i' ? [withNarration.args[i + 1]] : []));
    expect(inputs.slice(-2)).toEqual(['/tmp/tts_0.wav', '/tmp/tts_1.wav']);
  });

  it('delays each line to its segment start', () => {
    expect(fg).toMatch(/\[2:a\][^;]*adelay=0:all=1\[n0\]/);
    expect(fg).toMatch(/\[3:a\][^;]*adelay=1500:all=1\[n1\]/);
  });

  it('leaves a fitting line alone but speeds up (max 1.3x) and fades out a long one', () => {
    const [line0, line1] = [fg.match(/\[2:a\][^;]*/)![0], fg.match(/\[3:a\][^;]*/)![0]];
    expect(line0).not.toContain('atempo');
    expect(line0).not.toContain('afade');
    expect(line1).toContain('atempo=1.3000');
    expect(line1).toContain('atrim=end=1.500,afade=t=out:st=1.300:d=0.2');
  });

  it('ducks the original to 0.25 and maps the mix', () => {
    expect(fg).toContain('[ac]volume=0.25[bg]');
    expect(fg).toContain('[bg][nar]amix=inputs=2:duration=first');
    expect(withNarration.args).toEqual(expect.arrayContaining(['[aout]']));
  });

  it('rejects narration for a missing segment', () => {
    expect(() =>
      buildRenderCommand({ ...plan, narration: [{ path: 'x.wav', segmentIndex: 7, durationSec: 1 }] }),
    ).toThrow(/missing segment/);
  });
});

describe('parseProgressTime', () => {
  it('reads time= from ffmpeg progress lines', () => {
    expect(parseProgressTime('frame= 150 fps= 30 time=00:00:05.12 bitrate=')).toBeCloseTo(5.12);
    expect(parseProgressTime('time=01:02:03.50')).toBeCloseTo(3723.5);
    expect(parseProgressTime('no progress here')).toBeUndefined();
  });
});
