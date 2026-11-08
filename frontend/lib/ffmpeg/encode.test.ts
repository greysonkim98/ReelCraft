import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeVideo, type EncodeInput } from './encode';

const worker = vi.hoisted(() => ({
  writeFile: vi.fn(async (_path: string, data: string | Uint8Array) => {
    // Model ffmpeg.wasm's actual transferable-buffer behavior, not a no-op write.
    if (data instanceof Uint8Array)
      structuredClone(data, { transfer: [data.buffer as ArrayBuffer] });
  }),
  createDir: vi.fn(async () => {}),
  deleteFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));
const exec = vi.hoisted(() => vi.fn(async () => 0));
vi.mock('./loader', () => ({
  CancelledError: class extends Error {},
  cancelFFmpeg: vi.fn(),
  getFFmpeg: vi.fn(async () => ({
    ffmpeg: worker,
    multiThread: false,
    filters: { subtitles: true },
  })),
  execWithLogs: exec,
  withMountedFiles: async (
    _handle: unknown,
    _files: File[],
    run: (paths: string[]) => Promise<Blob>,
  ) => run(['/in/clip.mp4']),
}));

const makeInput = (): EncodeInput => ({
  files: [],
  hasAudio: [true],
  segments: [
    {
      id: 'one',
      clipIndex: 0,
      start: 0,
      end: 2,
      subtitle: 'Hello',
      maxChars: 20,
      editedByUser: false,
    },
    {
      id: 'two',
      clipIndex: 0,
      start: 2,
      end: 4,
      subtitle: 'Hello',
      maxChars: 20,
      editedByUser: false,
    },
  ],
  style: { color: 'natural', subtitle: 'classic', tempo: 'calm', quality: '720p' },
});

beforeEach(() => {
  vi.clearAllMocks();
  exec.mockResolvedValue(0);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array([0, 1]))),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('render buffer ownership', () => {
  it('supports repeated narration and re-rendering with changed/removed music without detaching cached audio', async () => {
    const wav = new Uint8Array([10, 20, 30]);
    const music = new Uint8Array([40, 50, 60]);
    const input = makeInput();
    input.narration = [
      { segmentId: 'one', wav, durationSec: 1 },
      { segmentId: 'two', wav, durationSec: 1 },
    ];
    await encodeVideo({ ...input, music: { bytes: music, volume: 0.18 } });
    await encodeVideo({ ...input, music: { bytes: music, volume: 0.7 } });
    await encodeVideo(input);
    expect([...wav]).toEqual([10, 20, 30]);
    expect([...music]).toEqual([40, 50, 60]);
    expect(exec).toHaveBeenCalledTimes(3);
    expect(
      worker.writeFile.mock.calls.filter(([path]) => path.startsWith('/tmp/tts_')),
    ).toHaveLength(6);
    expect(worker.writeFile.mock.calls.filter(([path]) => path === '/tmp/music.mp3')).toHaveLength(
      2,
    );
  });
  it('preserves cached narration after a failed render so retry works', async () => {
    const wav = new Uint8Array([10, 20, 30]);
    const input = { ...makeInput(), narration: [{ segmentId: 'one', wav, durationSec: 1 }] };
    exec.mockResolvedValueOnce(1);
    await expect(encodeVideo(input)).rejects.toThrow('Encoding failed');
    await expect(encodeVideo(input)).resolves.toBeInstanceOf(Blob);
    expect([...wav]).toEqual([10, 20, 30]);
  });
});
