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

export async function synthesizeLine(
  text: string,
  opts: { voiceId: VoiceId; speed: number; onModelProgress?: (fraction: number) => void },
): Promise<SynthesizedLine> {
  const tts = await loadModel(opts.onModelProgress);
  const audio = await tts.generate(text.trim(), { voice: opts.voiceId, speed: opts.speed });
  return { wav: new Uint8Array(audio.toWav()), durationSec: audio.audio.length / audio.sampling_rate };
}

/** Short sample so the user can hear a voice before rendering. Returns an object URL. */
export async function previewVoice(voiceId: VoiceId, speed: number, onModelProgress?: (f: number) => void) {
  const tts = await loadModel(onModelProgress);
  const audio = await tts.generate('Salt air, zero plans. Let us go.', { voice: voiceId, speed });
  return URL.createObjectURL(new Blob([audio.toWav()], { type: 'audio/wav' }));
}
