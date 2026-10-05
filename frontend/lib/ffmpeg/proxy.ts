import { proxyArgs } from './chain';
import { execWithLogs, type FFmpegHandle } from './loader';
import { parseProgressTime } from './render';

export interface ProxyResult {
  proxyPath: string;
  hasAudio: boolean;
  /** Duration reported by ffmpeg for the source (seconds), if seen. */
  duration?: number;
}

export function parseDuration(line: string): number | undefined {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export const proxyPathFor = (index: number) => `/tmp/proxy_${index}.mp4`;

/**
 * Builds the low-res analysis proxy (also used for the in-editor preview) and detects whether
 * the source has an audio track from ffmpeg's input description.
 */
export async function makeProxy(
  handle: FFmpegHandle,
  inputPath: string,
  index: number,
  onProgress?: (fraction: number) => void,
): Promise<ProxyResult> {
  const proxyPath = proxyPathFor(index);
  let hasAudio = false;
  let duration: number | undefined;
  const code = await execWithLogs(
    handle,
    proxyArgs(inputPath, proxyPath),
    (line) => {
      if (/Stream #\d+:\d+.*Audio:/.test(line)) hasAudio = true;
      duration ??= parseDuration(line);
      const t = parseProgressTime(line);
      if (t !== undefined && duration) onProgress?.(Math.min(1, t / duration));
    },
  );
  if (code !== 0) throw new Error(`Could not read clip ${index + 1} (ffmpeg exit ${code}).`);
  onProgress?.(1);
  return { proxyPath, hasAudio, duration };
}
