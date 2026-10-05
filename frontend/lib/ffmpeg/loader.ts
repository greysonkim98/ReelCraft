import { FFmpeg, type FFFSType } from '@ffmpeg/ffmpeg';

export type FilterName =
  | 'scdet'
  | 'blurdetect'
  | 'freezedetect'
  | 'blackdetect'
  | 'signalstats'
  | 'subtitles';

export type FilterSupport = Record<FilterName, boolean>;

export interface FFmpegHandle {
  ffmpeg: FFmpeg;
  /** false → single-thread core ("slow mode"). */
  multiThread: boolean;
  filters: FilterSupport;
}

const MOUNT_POINT = '/in';
const WANTED_FILTERS: FilterName[] = [
  'scdet',
  'blurdetect',
  'freezedetect',
  'blackdetect',
  'signalstats',
  'subtitles',
];

let handlePromise: Promise<FFmpegHandle> | null = null;
let current: FFmpeg | null = null;
let currentMultiThread: boolean | null = null;

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

/** Set localStorage "rc:debug" = "1" to mirror every ffmpeg log line into the console. */
function isDebug(): boolean {
  try {
    return localStorage.getItem('rc:debug') === '1';
  } catch {
    return false;
  }
}

export function canUseMultiThread(): boolean {
  return typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';
}

async function loadFFmpeg(multiThread: boolean): Promise<FFmpegHandle> {
  const dir = `${location.origin}/ffmpeg/${multiThread ? 'mt' : 'st'}`;
  const ffmpeg = new FFmpeg();
  current = ffmpeg;
  await ffmpeg.load({
    // Worker script and core are all same-origin (COEP forbids external CDNs).
    classWorkerURL: `${location.origin}/ffmpeg/lib/worker.js`,
    coreURL: `${dir}/ffmpeg-core.js`,
    wasmURL: `${dir}/ffmpeg-core.wasm`,
    ...(multiThread ? { workerURL: `${dir}/ffmpeg-core.worker.js` } : {}),
  });

  const lines: string[] = [];
  const onLog = ({ message }: { message: string }) => lines.push(message);
  ffmpeg.on('log', onLog);
  await ffmpeg.exec(['-hide_banner', '-filters']);
  ffmpeg.off('log', onLog);

  const available = new Set<string>();
  for (const line of lines) {
    const m = /^\s*[T.][S.][C.]\s+(\S+)\s/.exec(line);
    if (m) available.add(m[1]!);
  }
  const filters = Object.fromEntries(WANTED_FILTERS.map((n) => [n, available.has(n)])) as FilterSupport;
  return { ffmpeg, multiThread, filters };
}

export interface GetFFmpegOptions {
  /**
   * Prefer the multi-thread core (default). Pass false to force the single-thread core, which
   * has no worker-pool limit. A running instance of the other kind is replaced.
   */
  multiThread?: boolean;
}

/** Singleton ffmpeg.wasm instance. */
export function getFFmpeg(opts: GetFFmpegOptions = {}): Promise<FFmpegHandle> {
  const wantMulti = (opts.multiThread ?? true) && canUseMultiThread();
  if (handlePromise && currentMultiThread !== wantMulti) cancelFFmpeg();
  if (!handlePromise) {
    currentMultiThread = wantMulti;
    handlePromise = loadFFmpeg(wantMulti).catch((err) => {
      handlePromise = null;
      currentMultiThread = null;
      throw err;
    });
  }
  return handlePromise;
}

/** Cancels running work: terminates the worker; the next getFFmpeg() reloads. */
export function cancelFFmpeg(): void {
  current?.terminate();
  current = null;
  handlePromise = null;
  currentMultiThread = null;
}

/** Runs ffmpeg and streams each log line to `onLog`. Resolves with the exit code. */
export async function execWithLogs(
  handle: FFmpegHandle,
  args: string[],
  onLog?: (line: string) => void,
): Promise<number> {
  const debug = isDebug();
  if (debug) console.debug('[ffmpeg] exec', args.join(' '));
  const listener = ({ message }: { message: string }) => {
    if (debug) console.debug('[ffmpeg]', message);
    onLog?.(message);
  };
  handle.ffmpeg.on('log', listener);
  try {
    return await handle.ffmpeg.exec(args);
  } finally {
    handle.ffmpeg.off('log', listener);
  }
}

const extensionOf = (name: string) => {
  const m = /\.[A-Za-z0-9]{1,5}$/.exec(name);
  return m ? m[0].toLowerCase() : '';
};

/**
 * Mounts the user's files read-only (WORKERFS, no memory copy) under /in as c0.ext, c1.ext, ...
 * so duplicate or odd file names cannot clash. Always unmounts afterwards.
 */
export async function withMountedFiles<T>(
  handle: FFmpegHandle,
  files: File[],
  fn: (paths: string[]) => Promise<T>,
): Promise<T> {
  const named = files.map(
    (f, i) => new File([f], `c${i}${extensionOf(f.name)}`, { type: f.type, lastModified: f.lastModified }),
  );
  try {
    await handle.ffmpeg.createDir(MOUNT_POINT);
  } catch {
    // already exists
  }
  // Plain string, not the FFFSType enum: the enum is not exported from every bundle target.
  await handle.ffmpeg.mount('WORKERFS' as FFFSType, { files: named }, MOUNT_POINT);
  try {
    return await fn(named.map((f) => `${MOUNT_POINT}/${f.name}`));
  } finally {
    try {
      await handle.ffmpeg.unmount(MOUNT_POINT);
    } catch {
      // worker may have been terminated (cancel)
    }
  }
}
