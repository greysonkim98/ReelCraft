import type { Segment, Tempo } from '@reelcraft/shared';
import { buildCandidates, scoreCandidates } from './candidates';
import { EDGE_FALLBACK_CHAIN, analysisFilterChain, metricsArgs } from './chain';
import { CancelledError, cancelFFmpeg, execWithLogs, getFFmpeg, withMountedFiles, type FFmpegHandle } from './loader';
import { MetricsParser, type ClipMetrics } from './metrics';
import { makeProxy } from './proxy';
import { parseProgressTime } from './render';
import { selectSegments } from './select';

export interface AnalyzeProgress {
  clipIndex: number;
  stage: 'proxy' | 'metrics';
  /** 0..1 for the clip currently being processed. */
  clipFraction: number;
  /** 0..1 across all clips. */
  overall: number;
}

export interface AnalyzeInput {
  files: File[];
  /** Duration per clip in seconds (from the import step). */
  durations: number[];
  tempo: Tempo;
  maxOutputSeconds: number;
  onProgress?: (p: AnalyzeProgress) => void;
  signal?: AbortSignal;
}

export interface AnalyzeResult {
  segments: Segment[];
  unusedClips: number[];
  hasAudio: boolean[];
  /** Human-readable notes, e.g. "blurdetect unavailable, using edge fallback". */
  notes: string[];
}

async function runMetricsPass(
  handle: FFmpegHandle,
  proxyPath: string,
  vf: string,
  duration: number,
  onProgress: (fraction: number) => void,
): Promise<ClipMetrics> {
  const parser = new MetricsParser();
  const code = await execWithLogs(handle, metricsArgs(proxyPath, vf), (line) => {
    parser.push(line);
    const t = parseProgressTime(line);
    if (t !== undefined && duration > 0) onProgress(Math.min(1, t / duration));
  });
  if (code !== 0) throw new Error(`Analysis pass failed (ffmpeg exit ${code}).`);
  return parser.finish(duration);
}

/** Proxy → scene/quality metrics → scored candidates → segment draft, all in the browser. */
export async function analyzeClips(input: AnalyzeInput): Promise<AnalyzeResult> {
  const { files, durations, tempo, maxOutputSeconds, onProgress, signal } = input;
  if (signal?.aborted) throw new CancelledError();
  const onAbort = () => cancelFFmpeg();
  signal?.addEventListener('abort', onAbort);

  try {
    const handle = await getFFmpeg();
    const notes: string[] = [];
    if (!handle.multiThread) notes.push('Slow mode: single-thread ffmpeg (page is not cross-origin isolated).');
    if (!handle.filters.scdet) notes.push('scdet unavailable: each clip is treated as one scene.');
    if (!handle.filters.blurdetect) notes.push('blurdetect unavailable: using edge-detect sharpness fallback.');
    if (!handle.filters.freezedetect) notes.push('freezedetect unavailable: freeze frames are not filtered.');

    const vf = analysisFilterChain(handle.filters);
    const hasAudio: boolean[] = [];
    const candidatesByClip = await withMountedFiles(handle, files, async (paths) => {
      const all = [];
      for (let i = 0; i < paths.length; i++) {
        const report = (stage: AnalyzeProgress['stage'], fraction: number) => {
          // Each clip is ~60% proxy, ~40% metrics.
          const clipFraction = stage === 'proxy' ? fraction * 0.6 : 0.6 + fraction * 0.4;
          onProgress?.({ clipIndex: i, stage, clipFraction, overall: (i + clipFraction) / paths.length });
        };
        const proxy = await makeProxy(handle, paths[i]!, i, (f) => report('proxy', f));
        hasAudio.push(proxy.hasAudio);
        const duration = durations[i] ?? proxy.duration ?? 0;
        const metrics = await runMetricsPass(handle, proxy.proxyPath, vf, duration, (f) => report('metrics', f));
        const edge = handle.filters.blurdetect
          ? undefined
          : await runMetricsPass(handle, proxy.proxyPath, EDGE_FALLBACK_CHAIN, duration, () => {});
        all.push(scoreCandidates(buildCandidates(i, duration, metrics, tempo, edge)));
        report('metrics', 1);
      }
      return all;
    });

    const { segments, unusedClips } = selectSegments(candidatesByClip, { tempo, maxOutputSeconds });
    return { segments, unusedClips, hasAudio, notes };
  } catch (err) {
    if (signal?.aborted) throw new CancelledError();
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
