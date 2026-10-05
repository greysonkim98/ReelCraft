// End-to-end check of the pure pipeline code against a NATIVE ffmpeg:
//   synthetic clips → proxy → analysis → candidates/selection → ASS → render command → ffprobe.
// This validates filter strings, log parsing and the filter graph; the ffmpeg.wasm layer
// (loader/mount/worker) can only be exercised in a browser.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { COLOR_LOOKS, SUBTITLE_STYLES, type Segment, type Style } from '@reelcraft/shared';
import { buildAss } from '../frontend/lib/ffmpeg/ass';
import { buildCandidates, scoreCandidates, type Candidate } from '../frontend/lib/ffmpeg/candidates';
import { EDGE_FALLBACK_CHAIN, analysisFilterChain, metricsArgs, proxyArgs } from '../frontend/lib/ffmpeg/chain';
import { SUBTITLE_RENDER } from '../frontend/lib/ffmpeg/constants';
import { parseMetrics, type ClipMetrics } from '../frontend/lib/ffmpeg/metrics';
import { buildRenderCommand, type RenderPlan } from '../frontend/lib/ffmpeg/render';
import { selectSegments } from '../frontend/lib/ffmpeg/select';

const root = path.resolve(__dirname, '..');
const work = path.join(root, '.scratch', 'verify');
const fontSrc = path.join(root, 'frontend', 'public', 'fonts', SUBTITLE_RENDER.fontFile);

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

function ff(args: string[], bin = 'ffmpeg') {
  const base = bin === 'ffmpeg' ? ['-hide_banner', '-nostdin'] : ['-v', 'error'];
  const r = spawnSync(bin, [...base, ...args], { cwd: work, encoding: 'utf8', maxBuffer: 1 << 28 });
  const lines = `${r.stderr ?? ''}`.split(/\r?\n|\r/).filter(Boolean);
  return { code: r.status ?? -1, lines, stdout: r.stdout ?? '' };
}

function probe(file: string) {
  const r = ff(['-show_streams', '-show_format', '-of', 'json', file], 'ffprobe');
  return JSON.parse(r.stdout) as {
    streams: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; duration?: string }[];
    format: { duration: string };
  };
}

function makeClips() {
  const L = (s: string) => ['-f', 'lavfi', '-i', s];
  const enc = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast'];
  // A: landscape + audio; moving / black / moving / moving  (scene cuts at 4.0, 5.5, 8.5)
  let r = ff([
    '-y',
    ...L('testsrc2=s=1280x720:r=30:d=4'),
    ...L('color=c=black:s=1280x720:r=30:d=1.5'),
    ...L('mandelbrot=s=1280x720:r=30:end_scale=0.1'),
    ...L('testsrc=s=1280x720:r=30:d=3.5'),
    ...L('sine=frequency=440:sample_rate=48000:d=12'),
    '-filter_complex',
    '[0:v]format=yuv420p,setsar=1[a0];[1:v]format=yuv420p,setsar=1[a1];' +
      '[2:v]trim=duration=3,setpts=PTS-STARTPTS,format=yuv420p,setsar=1[a2];' +
      '[3:v]format=yuv420p,setsar=1[a3];[a0][a1][a2][a3]concat=n=4:v=1:a=0[v]',
    '-map', '[v]', '-map', '4:a', ...enc, '-c:a', 'aac', '-t', '12', 'clipA.mp4',
  ]);
  if (r.code !== 0) throw new Error(`clipA failed:\n${r.lines.slice(-8).join('\n')}`);
  // B: portrait, no audio, two moving halves
  r = ff([
    '-y',
    ...L('testsrc2=s=720x1280:r=30:d=4'),
    ...L('testsrc=s=720x1280:r=30:d=4'),
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map', '[v]', ...enc, 'clipB.mp4',
  ]);
  if (r.code !== 0) throw new Error(`clipB failed:\n${r.lines.slice(-8).join('\n')}`);
  // C: completely static (freeze) + audio
  r = ff([
    '-y',
    ...L('color=c=blue:s=1280x720:r=30:d=5'),
    ...L('sine=frequency=330:sample_rate=48000:d=5'),
    ...enc, '-c:a', 'aac', '-shortest', 'clipC.mp4',
  ]);
  if (r.code !== 0) throw new Error(`clipC failed:\n${r.lines.slice(-8).join('\n')}`);
}

function sineWav(file: string, freq: number, seconds: number) {
  const r = ff(['-y', ...['-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=24000:d=${seconds}`], '-af', 'volume=6', '-ac', '1', file]);
  if (r.code !== 0) throw new Error(`wav failed:\n${r.lines.slice(-5).join('\n')}`);
}

function analyse(index: number, file: string, duration: number, useEdge: boolean) {
  const proxy = `proxy_${index}.mp4`;
  const p = ff(proxyArgs(file, proxy));
  if (p.code !== 0) throw new Error(`proxy ${file} failed:\n${p.lines.slice(-6).join('\n')}`);
  const hasAudio = p.lines.some((l) => /Stream #\d+:\d+.*Audio:/.test(l));
  const vf = analysisFilterChain({ scdet: true, blurdetect: !useEdge, freezedetect: true });
  const m = ff(metricsArgs(proxy, vf));
  if (m.code !== 0) throw new Error(`metrics ${file} failed:\n${m.lines.slice(-6).join('\n')}`);
  const metrics = parseMetrics(m.lines, duration);
  let edge: ClipMetrics | undefined;
  if (useEdge) {
    const e = ff(metricsArgs(proxy, EDGE_FALLBACK_CHAIN));
    if (e.code !== 0) throw new Error(`edge pass failed:\n${e.lines.slice(-6).join('\n')}`);
    edge = parseMetrics(e.lines, duration);
  }
  return { hasAudio, metrics, edge };
}

function main() {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(path.join(work, 'fonts'), { recursive: true });
  copyFileSync(fontSrc, path.join(work, 'fonts', SUBTITLE_RENDER.fontFile));
  if (ff(['-version']).code !== 0) throw new Error('ffmpeg not found on PATH');

  console.log('— generating synthetic clips');
  makeClips();
  const clips = [
    { file: 'clipA.mp4', duration: 12, audio: true },
    { file: 'clipB.mp4', duration: 8, audio: false },
    { file: 'clipC.mp4', duration: 5, audio: true },
  ];
  for (const c of clips) {
    const info = probe(c.file);
    c.duration = Number(info.format.duration);
  }

  for (const useEdge of [false, true]) {
    console.log(`\n— analysis (${useEdge ? 'edge fallback' : 'blurdetect'})`);
    const analyses = clips.map((c, i) => analyse(i, c.file, c.duration, useEdge));
    clips.forEach((c, i) => {
      const a = analyses[i]!;
      check(`clip ${i} audio detection`, a.hasAudio === c.audio);
      check(`clip ${i} sampled ~10fps`, Math.abs(a.metrics.samples.length - c.duration * 10) <= 12, `${a.metrics.samples.length} samples`);
      if (i === 0) {
        console.log('   scene changes:', a.metrics.sceneChanges.join(', '), '| black:', JSON.stringify(a.metrics.black));
        check('clip A: scene cut near 4.0s', a.metrics.sceneChanges.some((t) => Math.abs(t - 4) < 0.35));
        check('clip A: scene cut near 5.5s', a.metrics.sceneChanges.some((t) => Math.abs(t - 5.5) < 0.35));
        const blackLen = a.metrics.black.reduce((s, b) => s + (Math.min(b.end, 5.5) - Math.max(b.start, 4)), 0);
        check('clip A: black detected over 4.0–5.5s', blackLen > 1.0, `${blackLen.toFixed(2)}s`);
      }
      if (i === 2) {
        const frozen = a.metrics.freeze.reduce((s, f) => s + (f.end - f.start), 0);
        check('clip C: freeze covers most of the clip', frozen / c.duration > 0.7, `${frozen.toFixed(2)}s`);
      }
    });
    for (const tempo of ['energetic', 'calm'] as const) {
      const cands: Candidate[][] = analyses.map((a, i) =>
        scoreCandidates(buildCandidates(i, clips[i]!.duration, a.metrics, tempo, a.edge)),
      );
      const { segments, unusedClips } = selectSegments(cands, { tempo, maxOutputSeconds: 60 });
      const total = segments.reduce((s, x) => s + (x.end - x.start), 0);
      console.log(`   ${tempo}: ${segments.length} segments, ${total.toFixed(1)}s, unused clips: [${unusedClips}]`);
      check(`${tempo}: total ≤ 60s`, total <= 60 + 1e-6);
      check(`${tempo}: moving clips A and B are used`, [0, 1].every((i) => segments.some((s) => s.clipIndex === i)));
      check(`${tempo}: frozen clip C excluded`, unusedClips.includes(2));
      const overlap = segments.some((a, i) => segments.some((b, j) => i < j && a.clipIndex === b.clipIndex && a.start < b.end && b.start < a.end));
      check(`${tempo}: no overlapping segments in a clip`, !overlap);
    }
  }

  console.log('\n— render (manual plan: split clip A twice, portrait no-audio clip B, static clip C)');
  const segs: Segment[] = [
    { id: 's1', clipIndex: 0, start: 0.5, end: 2.0, subtitle: 'Waves hit different', maxChars: 22, editedByUser: false },
    { id: 's2', clipIndex: 1, start: 1.0, end: 2.5, subtitle: 'Salt air {and} zero plans 🌊 at the arboretum today', maxChars: 80, editedByUser: false },
    { id: 's3', clipIndex: 0, start: 6.0, end: 8.0, subtitle: 'Ducks everywhere', maxChars: 30, editedByUser: false },
    { id: 's4', clipIndex: 2, start: 1.0, end: 2.0, subtitle: 'Back\\slash test', maxChars: 30, editedByUser: false },
  ];
  const total = segs.reduce((s, x) => s + (x.end - x.start), 0);
  const base: Style = { color: 'warm', subtitle: 'classic', tempo: 'energetic', quality: '720p' };

  const planFor = (style: Style, segments: Segment[], narration?: RenderPlan['narration']): RenderPlan => ({
    clips: clips.map((c) => ({ inputPath: c.file, hasAudio: c.audio })),
    segments: segments.map((s) => ({ clipIndex: s.clipIndex, start: s.start, end: s.end })),
    color: style.color,
    quality: style.quality,
    narration,
    assPath: 'subs.ass',
    fontsDir: 'fonts',
    outputPath: 'out.mp4',
  });

  function render(style: Style, segments: Segment[], narration?: RenderPlan['narration']) {
    writeFileSync(
      path.join(work, 'subs.ass'),
      buildAss(segments.map((s) => ({ duration: s.end - s.start, subtitle: s.subtitle })), style.subtitle),
    );
    rmSync(path.join(work, 'out.mp4'), { force: true });
    const cmd = buildRenderCommand(planFor(style, segments, narration));
    const r = ff(cmd.args);
    return { ...r, cmd };
  }

  let r = render(base, segs);
  if (r.code !== 0) console.log(r.lines.slice(-12).join('\n'));
  check('render (720p, no narration) exits 0', r.code === 0);
  if (r.code === 0) {
    const info = probe('out.mp4');
    const v = info.streams.find((s) => s.codec_type === 'video')!;
    const a = info.streams.find((s) => s.codec_type === 'audio');
    check('output 720x1280', v.width === 720 && v.height === 1280, `${v.width}x${v.height}`);
    check('output 30 fps', v.r_frame_rate === '30/1', v.r_frame_rate);
    check('output h264 + aac', v.codec_name === 'h264' && a?.codec_name === 'aac');
    const dur = Number(info.format.duration);
    check('output duration matches plan', Math.abs(dur - total) < 0.2, `${dur.toFixed(2)}s vs ${total}s`);
  }

  console.log('\n— render with narration (line 2 too long for its 1.5s segment, line 1 fits)');
  sineWav(path.join(work, 'tts_0.wav'), 1000, 1.0);
  sineWav(path.join(work, 'tts_1.wav'), 1500, 3.0);
  const narration = [
    { path: 'tts_0.wav', segmentIndex: 0, durationSec: 1.0 },
    { path: 'tts_1.wav', segmentIndex: 1, durationSec: 3.0 },
  ];
  r = render(base, segs, narration);
  if (r.code !== 0) console.log(r.lines.slice(-12).join('\n'));
  check('render with narration exits 0', r.code === 0);
  if (r.code === 0) {
    const dur = Number(probe('out.mp4').format.duration);
    check('narration render keeps timeline length', Math.abs(dur - total) < 0.2, `${dur.toFixed(2)}s`);
    // Segment 2 sits at 1.5–3.0s on the timeline; narration must not leak past 3.0s into segment 3 (3.0–5.0s).
    const level = (from: number, len: number) => {
      const v = ff(['-ss', String(from), '-t', String(len), '-i', 'out.mp4', '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
      const m = v.lines.map((l) => /mean_volume:\s*(-?[\d.]+) dB/.exec(l)).find(Boolean);
      return m ? Number(m[1]) : -99;
    };
    const during = level(1.6, 1.2);
    const after = level(3.3, 1.2);
    console.log(`   mean volume while narrating: ${during} dB, after cut-off: ${after} dB`);
    check('narration audible in its segment', during > after + 3);
  }

  console.log('\n— all colour looks and subtitle styles render');
  for (const look of COLOR_LOOKS) {
    const out = render({ ...base, color: look }, segs.slice(0, 1));
    check(`color look "${look}"`, out.code === 0, out.code === 0 ? '' : out.lines.slice(-2).join(' | '));
  }
  for (const sub of SUBTITLE_STYLES) {
    const out = render({ ...base, subtitle: sub }, [segs[1]!]);
    check(`subtitle style "${sub}"`, out.code === 0);
    if (out.code === 0) {
      ff(['-y', '-ss', '0.7', '-i', 'out.mp4', '-frames:v', '1', `shot_${sub}.png`]);
      check(`frame extracted for "${sub}"`, existsSync(path.join(work, `shot_${sub}.png`)));
    }
  }

  const ass = readFileSync(path.join(work, 'subs.ass'), 'utf8');
  check('ASS escapes braces and strips emoji', !ass.includes('🌊'));

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
