import type { ColorLook, Quality } from '@reelcraft/shared';
import { RENDER } from './constants';
import { colorFilter } from './filters';
import { encoderThreadArgs, filterThreadArgs, inputThreadArgs } from './threads';

// Pure command builder (no ffmpeg.wasm import) so it can be verified with a native ffmpeg too.

export interface RenderClip {
  inputPath: string;
  hasAudio: boolean;
}

export interface RenderSegment {
  clipIndex: number;
  start: number;
  end: number;
}

export interface NarrationLine {
  /** WAV file of the narration for the segment at `segmentIndex`. */
  path: string;
  segmentIndex: number;
  durationSec: number;
}

export interface RenderPlan {
  clips: RenderClip[];
  segments: RenderSegment[];
  color: ColorLook;
  quality: Quality;
  narration?: NarrationLine[];
  assPath: string;
  fontsDir: string;
  outputPath: string;
}

export interface RenderCommand {
  args: string[];
  filterComplex: string;
  totalSeconds: number;
}

const f3 = (n: number) => n.toFixed(3);
const AUDIO_NORMALISE = `aresample=${RENDER.audioRate},aformat=sample_fmts=fltp:channel_layouts=stereo`;

/** Escapes a path for use as a filter option value inside -filter_complex. */
function filterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\\\:').replace(/'/g, "\\\\'");
}

export function buildRenderCommand(plan: RenderPlan): RenderCommand {
  const { width: W, height: H } = RENDER.sizes[plan.quality];
  const segs = plan.segments;
  if (segs.length === 0) throw new Error('Nothing to render: no segments.');

  // One input per source clip actually used, in order of first use.
  const inputIndexByClip = new Map<number, number>();
  const inputClips: RenderClip[] = [];
  for (const s of segs) {
    if (!inputIndexByClip.has(s.clipIndex)) {
      const clip = plan.clips[s.clipIndex];
      if (!clip) throw new Error(`Segment refers to missing clip ${s.clipIndex}.`);
      inputIndexByClip.set(s.clipIndex, inputClips.length);
      inputClips.push(clip);
    }
  }

  const segIdxByInput = new Map<number, number[]>();
  segs.forEach((s, i) => {
    const j = inputIndexByClip.get(s.clipIndex)!;
    segIdxByInput.set(j, [...(segIdxByInput.get(j) ?? []), i]);
  });

  const parts: string[] = [];
  const vIn: string[] = [];
  const aIn: string[] = [];

  // Fan each clip's streams out to the segments cut from it.
  for (const [j, idxs] of segIdxByInput) {
    const clip = inputClips[j]!;
    if (idxs.length === 1) {
      vIn[idxs[0]!] = `${j}:v`;
      if (clip.hasAudio) aIn[idxs[0]!] = `${j}:a`;
    } else {
      parts.push(`[${j}:v]split=${idxs.length}${idxs.map((i) => `[vx${i}]`).join('')}`);
      idxs.forEach((i) => (vIn[i] = `vx${i}`));
      if (clip.hasAudio) {
        parts.push(`[${j}:a]asplit=${idxs.length}${idxs.map((i) => `[ax${i}]`).join('')}`);
        idxs.forEach((i) => (aIn[i] = `ax${i}`));
      }
    }
  }

  const durations = segs.map((s) => s.end - s.start);
  segs.forEach((s, i) => {
    parts.push(
      `[${vIn[i]}]trim=start=${f3(s.start)}:end=${f3(s.end)},setpts=PTS-STARTPTS,` +
        `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${RENDER.fps}[v${i}]`,
    );
    if (aIn[i]) {
      parts.push(
        `[${aIn[i]}]atrim=start=${f3(s.start)}:end=${f3(s.end)},asetpts=PTS-STARTPTS,${AUDIO_NORMALISE}[a${i}]`,
      );
    } else {
      parts.push(
        `anullsrc=r=${RENDER.audioRate}:cl=stereo,atrim=duration=${f3(durations[i]!)},asetpts=PTS-STARTPTS[a${i}]`,
      );
    }
  });

  const concatInputs = segs.map((_, i) => `[v${i}][a${i}]`).join('');
  parts.push(`${concatInputs}concat=n=${segs.length}:v=1:a=1[vc][ac]`);
  parts.push(
    `[vc]${colorFilter(plan.color)},subtitles=${filterPath(plan.assPath)}:fontsdir=${filterPath(plan.fontsDir)}[vout]`,
  );

  // Narration inputs come after the clip inputs.
  // Thread caps matter: core-mt has a fixed worker pool (see threads.ts).
  const inputs: string[] = [];
  for (const clip of inputClips) inputs.push(...inputThreadArgs, '-i', clip.inputPath);
  let audioLabel = 'ac';
  const lines = plan.narration ?? [];
  if (lines.length > 0) {
    const starts: number[] = [];
    let cursor = 0;
    for (const d of durations) {
      starts.push(cursor);
      cursor += d;
    }
    lines.forEach((line, k) => {
      const inputIdx = inputClips.length + k;
      inputs.push(...inputThreadArgs, '-i', line.path);
      const segDur = durations[line.segmentIndex];
      if (segDur === undefined) throw new Error(`Narration refers to missing segment ${line.segmentIndex}.`);
      const tempo = Math.min(RENDER.maxAtempo, Math.max(1, line.durationSec / segDur));
      const effective = line.durationSec / tempo;
      let chain = `[${inputIdx}:a]${AUDIO_NORMALISE}`;
      if (tempo > 1.0001) chain += `,atempo=${tempo.toFixed(4)}`;
      if (effective > segDur) {
        const fade = RENDER.narrationFadeSeconds;
        chain += `,atrim=end=${f3(segDur)},afade=t=out:st=${f3(Math.max(0, segDur - fade))}:d=${fade}`;
      }
      chain += `,adelay=${Math.round(starts[line.segmentIndex]! * 1000)}:all=1[n${k}]`;
      parts.push(chain);
    });
    const n = lines.length;
    if (n === 1) {
      parts.push('[n0]anull[nar]');
    } else {
      // amix divides by the input count; the huge dropout transition keeps that constant, volume=n undoes it.
      parts.push(`${lines.map((_, k) => `[n${k}]`).join('')}amix=inputs=${n}:dropout_transition=1000,volume=${n}[nar]`);
    }
    parts.push(`[ac]volume=${RENDER.narrationOriginalVolume}[bg]`);
    parts.push('[bg][nar]amix=inputs=2:duration=first:dropout_transition=1000,volume=2[aout]');
    audioLabel = 'aout';
  }

  const filterComplex = parts.join(';');
  const args = [
    '-y',
    ...inputs,
    ...filterThreadArgs,
    '-filter_complex',
    filterComplex,
    '-map',
    '[vout]',
    '-map',
    `[${audioLabel}]`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(RENDER.fps),
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    ...encoderThreadArgs,
    plan.outputPath,
  ];
  return { args, filterComplex, totalSeconds: durations.reduce((a, b) => a + b, 0) };
}

/** Parses `time=HH:MM:SS.xx` from an ffmpeg progress log line into seconds. */
export function parseProgressTime(line: string): number | undefined {
  const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
