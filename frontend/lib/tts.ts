import type { VoiceId } from '@reelcraft/shared';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

type KokoroModel = import('kokoro-js').KokoroTTS;
let modelPromise: Promise<KokoroModel> | null = null;

/** Loads Kokoro once (about 90 MB, cached by the browser after the first download). */
function loadModel(onProgress?: (fraction: number) => void): Promise<KokoroModel> {
  modelPromise ??= (async () => {
    const { KokoroTTS } = await import('kokoro-js');
    const files = new Map<string, number>();
    return KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p: { file?: string; progress?: number; status?: string }) => {
        if (p.status !== 'progress' || !p.file || p.progress === undefined) return;
        files.set(p.file, p.progress);
        // The model file dominates the download; report the largest file's progress.
        onProgress?.(Math.max(...files.values()) / 100);
      },
    });
  })().catch((err) => {
    modelPromise = null;
    throw err;
  });
  return modelPromise;
}

export interface SynthesizedLine {
  wav: Uint8Array;
  durationSec: number;
}

const AUDIO_CACHE = 'reelcraft-narration-v1';
const MAX_ENTRIES = 100;
const MAX_MEMORY_BYTES = 32 * 1024 * 1024;
const memory = new Map<string, SynthesizedLine>();
const pending = new Map<string, Promise<SynthesizedLine>>();
let memoryBytes = 0;

function remember(key: string, audio: SynthesizedLine) {
  if (audio.wav.byteLength > MAX_MEMORY_BYTES) return;
  while (
    memory.size &&
    (memory.size >= MAX_ENTRIES || memoryBytes + audio.wav.byteLength > MAX_MEMORY_BYTES)
  ) {
    const oldest = memory.keys().next().value!;
    memoryBytes -= memory.get(oldest)!.wav.byteLength;
    memory.delete(oldest);
  }
  memory.set(key, audio);
  memoryBytes += audio.wav.byteLength;
}

async function cacheAddress(key: string): Promise<string | undefined> {
  try {
    if (typeof caches === 'undefined' || !globalThis.crypto?.subtle) return undefined;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    const hash = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    // Cache API lookup only: this URL is never fetched. Caption text stays out of URLs.
    return `${globalThis.location?.origin ?? 'https://reelcraft.invalid'}/__voice-cache/${hash}`;
  } catch {
    return undefined;
  }
}

async function readCached(address?: string): Promise<SynthesizedLine | undefined> {
  if (!address) return undefined;
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const response = await cache.match(address);
    if (!response) return undefined;
    const durationSec = Number(response.headers.get('X-ReelCraft-Duration'));
    const wav = new Uint8Array(await response.arrayBuffer());
    if (wav.byteLength && Number.isFinite(durationSec) && durationSec > 0)
      return { wav, durationSec };
    await cache.delete(address);
  } catch {
    /* Private browsing or storage eviction must not prevent narration. */
  }
  return undefined;
}

async function writeCached(address: string | undefined, audio: SynthesizedLine) {
  if (!address) return;
  try {
    const cache = await caches.open(AUDIO_CACHE);
    await cache.put(
      address,
      new Response(audio.wav.slice() as Uint8Array<ArrayBuffer>, {
        headers: { 'Content-Type': 'audio/wav', 'X-ReelCraft-Duration': String(audio.durationSec) },
      }),
    );
    const entries = await cache.keys();
    for (const old of entries.slice(0, Math.max(0, entries.length - MAX_ENTRIES)))
      await cache.delete(old);
  } catch {
    /* Quota/storage failures fall back to the in-memory audio and model cache. */
  }
}

export async function synthesizeLine(
  text: string,
  opts: { voiceId: VoiceId; speed: number; onModelProgress?: (fraction: number) => void },
): Promise<SynthesizedLine> {
  const trimmed = text.trim();
  const key = JSON.stringify([MODEL_ID, 'q8', 'audio-v1', opts.voiceId, opts.speed, trimmed]);
  let result = memory.get(key);
  if (!result) {
    let work = pending.get(key);
    if (!work) {
      work = (async () => {
        const address = await cacheAddress(key);
        let audio = await readCached(address);
        if (!audio) {
          const tts = await loadModel(opts.onModelProgress);
          const generated = await tts.generate(trimmed, { voice: opts.voiceId, speed: opts.speed });
          audio = {
            wav: new Uint8Array(generated.toWav()),
            durationSec: generated.audio.length / generated.sampling_rate,
          };
          await writeCached(address, audio);
        }
        remember(key, audio);
        return audio;
      })();
      pending.set(key, work);
    }
    try {
      result = await work;
    } finally {
      if (pending.get(key) === work) pending.delete(key);
    }
  }
  // Callers/FFmpeg can transfer or modify their copy without damaging either cache.
  return { wav: result.wav.slice(), durationSec: result.durationSec };
}

/** Samples share the same persistent audio cache as narration. */
export async function previewVoice(
  voiceId: VoiceId,
  speed: number,
  onModelProgress?: (f: number) => void,
) {
  const audio = await synthesizeLine('Salt air, zero plans. Let us go.', {
    voiceId,
    speed,
    onModelProgress,
  });
  return URL.createObjectURL(
    new Blob([audio.wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }),
  );
}
