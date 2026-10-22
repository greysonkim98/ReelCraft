import { REEL_IMAGES_MAX, REEL_IMAGE_MAX_BASE64_CHARS, REEL_IMAGE_SCENES_MAX } from '@reelcraft/shared';
import { execWithLogs, getFFmpeg, withMountedFiles } from './loader';

/** Side of one grid cell. A vision request is billed per image, not per pixel, so cells can be generous. */
export const CELL_SIZE = 384;
const JPEG_QUALITIES = [0.75, 0.6, 0.45, 0.3];
const SEEK_TIMEOUT_MS = 8000;

export interface SceneToSample {
  scene_id: string;
  clipIndex: number;
  start: number;
  end: number;
}

export interface SceneGrid {
  scene_ids: string[];
  /** base64 JPEG without the data: prefix */
  jpeg: string;
}

/** The frame that stands for a scene: its middle, never on a cut. */
export const midTime = (start: number, end: number) => Math.round(((start + end) / 2) * 100) / 100;

/** Splits `count` scenes into at most `maxImages` groups of nearly equal size, in order. */
export function groupSizes(count: number, maxImages = REEL_IMAGES_MAX): number[] {
  const groups = Math.min(maxImages, Math.max(1, Math.ceil(count / Math.ceil(REEL_IMAGE_SCENES_MAX / maxImages))));
  const base = Math.floor(count / groups);
  const extra = count % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0)).filter((n) => n > 0);
}

/** `count` indices spread evenly over 0..total-1 (all of them when total <= count). */
export const evenlySpaced = (total: number, count: number): number[] =>
  total <= count
    ? Array.from({ length: total }, (_, i) => i)
    : Array.from({ length: count }, (_, i) => Math.round((i * (total - 1)) / (count - 1)));

function drawCell(ctx: CanvasRenderingContext2D, source: CanvasImageSource, w: number, h: number, x: number, y: number, label: string) {
  const scale = Math.min(CELL_SIZE / Math.max(w, 1), CELL_SIZE / Math.max(h, 1));
  const dw = w * scale;
  const dh = h * scale;
  ctx.drawImage(source, x + (CELL_SIZE - dw) / 2, y + (CELL_SIZE - dh) / 2, dw, dh);
  // The label is how the model matches a cell to its scene_id.
  ctx.font = 'bold 28px sans-serif';
  const pad = 6;
  const width = ctx.measureText(label).width + pad * 2;
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, width, 40);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + pad, y + 21);
}

/** Labeled cells in a row (1-2 scenes) or a 2x2 grid (3-4), encoded at the best JPEG quality that fits. */
function encodeGrid(cells: { source: CanvasImageSource; w: number; h: number; label: string }[]): string | null {
  const cols = Math.min(2, cells.length);
  const rows = Math.ceil(cells.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = CELL_SIZE * cols;
  canvas.height = CELL_SIZE * rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  cells.forEach((c, i) => drawCell(ctx, c.source, c.w, c.h, (i % cols) * CELL_SIZE, Math.floor(i / cols) * CELL_SIZE, c.label));
  for (const quality of JPEG_QUALITIES) {
    const url = canvas.toDataURL('image/jpeg', quality);
    const b64 = url.slice(url.indexOf(',') + 1);
    if (b64.length <= REEL_IMAGE_MAX_BASE64_CHARS) return b64;
  }
  return null;
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('seek timed out')), SEEK_TIMEOUT_MS);
    video.onseeked = () => {
      clearTimeout(timer);
      resolve();
    };
    video.onerror = () => {
      clearTimeout(timer);
      reject(new Error('seek failed'));
    };
    video.currentTime = time;
  });
}

function loadVideo(file: File): Promise<{ video: HTMLVideoElement; release: () => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    const release = () => URL.revokeObjectURL(url);
    video.onerror = () => {
      release();
      reject(new Error('This browser cannot decode the clip.'));
    };
    video.onloadeddata = () => resolve({ video, release });
    video.src = url;
  });
}

interface Frame {
  source: CanvasImageSource;
  w: number;
  h: number;
}

async function framesFromVideo(file: File, times: number[]): Promise<(Frame | null)[]> {
  const { video, release } = await loadVideo(file);
  try {
    const out: Frame[] = [];
    for (const t of times) {
      await seek(video, Math.min(t, Math.max(0, video.duration - 0.05)));
      // Copy now: the video element moves on to the next time.
      const copy = document.createElement('canvas');
      copy.width = video.videoWidth;
      copy.height = video.videoHeight;
      copy.getContext('2d')?.drawImage(video, 0, 0);
      out.push({ source: copy, w: copy.width, h: copy.height });
    }
    return out;
  } finally {
    release();
  }
}

/** For codecs the browser cannot decode (HEVC .MOV on desktop Chrome). PNG, because JPEG crashes the wasm core. */
async function framesFromFFmpeg(file: File, times: number[]): Promise<(Frame | null)[]> {
  const handle = await getFFmpeg();
  return withMountedFiles(handle, [file], async ([path]) => {
    const out: (Frame | null)[] = [];
    for (const [i, t] of times.entries()) {
      const png = `/tmp/grid_${i}.png`;
      const code = await execWithLogs(handle, [
        '-hide_banner', '-ss', String(t), '-i', path!, '-frames:v', '1',
        '-vf', `scale=${CELL_SIZE}:${CELL_SIZE}:force_original_aspect_ratio=decrease`, '-y', png,
      ]);
      if (code !== 0) {
        out.push(null);
        continue;
      }
      const data = (await handle.ffmpeg.readFile(png)) as Uint8Array;
      await handle.ffmpeg.deleteFile(png).catch(() => undefined);
      const bitmap = await createImageBitmap(new Blob([data.slice().buffer], { type: 'image/png' }));
      out.push({ source: bitmap, w: bitmap.width, h: bitmap.height });
    }
    return out;
  });
}

/**
 * Takes the middle frame of each scene and packs the scenes into at most 2 grid images (labeled
 * with their scene_id), in the order given. Each clip is opened once. A scene whose frame cannot be
 * read is left out: the script then falls back to the scene tags for it.
 */
export async function buildSceneGrids(
  files: File[],
  scenes: SceneToSample[],
  opts: { signal?: AbortSignal } = {},
): Promise<SceneGrid[]> {
  const byClip = new Map<number, SceneToSample[]>();
  for (const s of scenes) byClip.set(s.clipIndex, [...(byClip.get(s.clipIndex) ?? []), s]);

  const frames = new Map<string, Frame>();
  for (const [clipIndex, clipScenes] of byClip) {
    const file = files[clipIndex];
    if (!file) continue;
    opts.signal?.throwIfAborted();
    const times = clipScenes.map((s) => midTime(s.start, s.end));
    let got: (Frame | null)[];
    try {
      got = await framesFromVideo(file, times);
    } catch {
      try {
        got = await framesFromFFmpeg(file, times);
      } catch {
        continue;
      }
    }
    clipScenes.forEach((s, i) => {
      const f = got[i];
      if (f) frames.set(s.scene_id, f);
    });
  }

  const ready = scenes.filter((s) => frames.has(s.scene_id));
  const grids: SceneGrid[] = [];
  let at = 0;
  for (const size of groupSizes(ready.length)) {
    const group = ready.slice(at, at + size);
    at += size;
    const jpeg = encodeGrid(group.map((s) => ({ ...frames.get(s.scene_id)!, label: s.scene_id })));
    if (jpeg) grids.push({ scene_ids: group.map((s) => s.scene_id), jpeg });
  }
  return grids;
}
