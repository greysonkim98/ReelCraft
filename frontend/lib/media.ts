import { execWithLogs, getFFmpeg, withMountedFiles } from './ffmpeg/loader';
import { parseDuration } from './ffmpeg/proxy';

export interface ClipInfo {
  duration: number;
  width: number;
  height: number;
  thumbnail?: string;
}

function readWithVideoElement(file: File): Promise<ClipInfo> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const done = () => URL.revokeObjectURL(url);

    video.onerror = () => {
      done();
      reject(new Error('This browser cannot decode the clip.'));
    };
    video.onloadedmetadata = () => {
      const { duration } = video;
      if (!Number.isFinite(duration) || duration <= 0) {
        done();
        reject(new Error('Clip has no readable duration.'));
        return;
      }
      video.currentTime = Math.min(0.5, duration / 2);
    };
    video.onseeked = () => {
      let thumbnail: string | undefined;
      try {
        const canvas = document.createElement('canvas');
        const scale = 160 / Math.max(video.videoWidth, 1);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        thumbnail = canvas.toDataURL('image/jpeg', 0.6);
      } catch {
        // thumbnail is optional
      }
      const info = { duration: video.duration, width: video.videoWidth, height: video.videoHeight, thumbnail };
      done();
      resolve(info);
    };
    video.src = url;
  });
}

/** Fallback for codecs the browser cannot decode (e.g. HEVC .MOV on desktop Chrome). */
async function probeWithFFmpeg(file: File): Promise<ClipInfo> {
  const handle = await getFFmpeg();
  let duration: number | undefined;
  await withMountedFiles(handle, [file], async ([path]) => {
    await execWithLogs(handle, ['-hide_banner', '-i', path!], (line) => {
      duration ??= parseDuration(line);
    });
  });
  if (!duration) throw new Error('Could not read this clip. Is it a valid video file?');
  return { duration, width: 0, height: 0 };
}

export async function readClipInfo(file: File): Promise<ClipInfo> {
  try {
    return await readWithVideoElement(file);
  } catch {
    return probeWithFFmpeg(file);
  }
}
