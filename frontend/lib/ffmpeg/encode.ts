import type { Segment, Style } from '@reelcraft/shared';
import { buildAss } from './ass';
import { SUBTITLE_RENDER } from './constants';
import { CancelledError, cancelFFmpeg, execWithLogs, getFFmpeg, withMountedFiles } from './loader';
import { buildRenderCommand, parseProgressTime, type NarrationLine } from './render';
import { THREADS } from './threads';

export interface NarrationInput {
  segmentId: string;
  wav: Uint8Array;
  durationSec: number;
}

export interface EncodeInput {
  files: File[];
  hasAudio: boolean[];
  segments: Segment[];
  style: Style;
  narration?: NarrationInput[];
  onProgress?: (info: { fraction: number; etaSeconds?: number }) => void;
  /** Heads-up for the UI, e.g. when a slower mode had to be used. */
  onNotice?: (message: string) => void;
  signal?: AbortSignal;
}

export class RenderMemoryError extends Error {
  constructor() {
    super('Out of memory while encoding. Try again at 720p.');
    this.name = 'RenderMemoryError';
  }
}

const OUT = '/out.mp4';
const ASS = '/subs.ass';
const FONTS_DIR = '/fonts';

async function tryDelete(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    // best effort cleanup
  }
}

/** Final single-pass encode from the original clips (never uploaded anywhere). */
export async function encodeVideo(input: EncodeInput): Promise<Blob> {
  const { files, hasAudio, segments, style, narration = [], onProgress, onNotice, signal } = input;
  if (signal?.aborted) throw new CancelledError();
  const onAbort = () => cancelFFmpeg();
  signal?.addEventListener('abort', onAbort);

  try {
    // Many source clips means many demux threads; past the verified limit the multi-thread
    // core's fixed worker pool would deadlock, so fall back to the single-thread core.
    const inputsUsed = new Set(segments.map((s) => s.clipIndex)).size + narration.length;
    const tooManyInputs = inputsUsed > THREADS.maxMultiThreadInputs;
    const handle = await getFFmpeg({ multiThread: !tooManyInputs });
    if (tooManyInputs && handle.multiThread === false) {
      onNotice?.(`Combining ${inputsUsed} clips at once, so this render uses slow mode (single thread).`);
    }
    if (!handle.filters.subtitles) {
      throw new Error('This ffmpeg build has no "subtitles" filter, so captions cannot be burned in.');
    }
    const { ffmpeg } = handle;

    const fontRes = await fetch(`/fonts/${SUBTITLE_RENDER.fontFile}`);
    if (!fontRes.ok) throw new Error(`Could not load the subtitle font (HTTP ${fontRes.status}).`);
    await tryDelete(() => ffmpeg.createDir(FONTS_DIR));
    await ffmpeg.writeFile(`${FONTS_DIR}/${SUBTITLE_RENDER.fontFile}`, new Uint8Array(await fontRes.arrayBuffer()));

    const ass = buildAss(
      segments.map((s) => ({ duration: s.end - s.start, subtitle: s.subtitle })),
      style.subtitle,
    );
    await ffmpeg.writeFile(ASS, ass);

    const narrationLines: NarrationLine[] = [];
    const ttsFiles: string[] = [];
    for (const [k, n] of narration.entries()) {
      const segmentIndex = segments.findIndex((s) => s.id === n.segmentId);
      if (segmentIndex < 0) continue;
      const path = `/tmp/tts_${k}.wav`;
      await ffmpeg.writeFile(path, n.wav);
      ttsFiles.push(path);
      narrationLines.push({ path, segmentIndex, durationSec: n.durationSec });
    }

    try {
      return await withMountedFiles(handle, files, async (paths) => {
        const { args, totalSeconds } = buildRenderCommand({
          clips: paths.map((p, i) => ({ inputPath: p, hasAudio: hasAudio[i] ?? false })),
          segments: segments.map((s) => ({ clipIndex: s.clipIndex, start: s.start, end: s.end })),
          color: style.color,
          quality: style.quality,
          narration: narrationLines,
          assPath: ASS,
          fontsDir: FONTS_DIR,
          outputPath: OUT,
        });
        const startedAt = Date.now();
        const lines: string[] = [];
        const code = await execWithLogs(handle, args, (line) => {
          lines.push(line);
          if (lines.length > 200) lines.shift();
          const t = parseProgressTime(line);
          if (t === undefined) return;
          const fraction = Math.min(1, t / totalSeconds);
          const elapsed = (Date.now() - startedAt) / 1000;
          onProgress?.({ fraction, etaSeconds: fraction > 0.02 ? (elapsed / fraction) * (1 - fraction) : undefined });
        });
        if (code !== 0) {
          if (lines.some((l) => /memory|Cannot enlarge|out of bounds/i.test(l))) throw new RenderMemoryError();
          throw new Error(`Encoding failed (ffmpeg exit ${code}). Last log: ${lines.slice(-3).join(' | ')}`);
        }
        onProgress?.({ fraction: 1, etaSeconds: 0 });
        const data = await ffmpeg.readFile(OUT);
        if (typeof data === 'string') throw new Error('Unexpected text output from ffmpeg.');
        return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'video/mp4' });
      });
    } finally {
      await tryDelete(() => ffmpeg.deleteFile(OUT));
      await tryDelete(() => ffmpeg.deleteFile(ASS));
      for (const p of ttsFiles) await tryDelete(() => ffmpeg.deleteFile(p));
    }
  } catch (err) {
    if (signal?.aborted) throw new CancelledError();
    if (err instanceof RangeError || (err instanceof Error && /memory/i.test(err.message) && !(err instanceof RenderMemoryError))) {
      throw new RenderMemoryError();
    }
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
