import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
const mock = vi.hoisted(() => ({ generate: vi.fn(), load: vi.fn() }));
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: mock.load } }));
let disk: Map<string, Response>;
let cache: {
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  keys: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};
const opts = { voiceId: 'af_heart' as const, speed: 1 };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mock.generate.mockReset().mockImplementation(async () => ({
    toWav: () => new Uint8Array([1, 2, 3]).buffer,
    audio: new Float32Array(24000),
    sampling_rate: 24000,
  }));
  mock.load.mockReset().mockImplementation(async () => ({ generate: mock.generate }));
  disk = new Map();
  cache = {
    match: vi.fn(async (key: string) => disk.get(key)?.clone()),
    put: vi.fn(async (key: string, value: Response) => {
      disk.set(key, value.clone());
    }),
    keys: vi.fn(async () => [...disk.keys()].map((key) => new Request(key))),
    delete: vi.fn(async (key: string | Request) =>
      disk.delete(typeof key === 'string' ? key : key.url),
    ),
  };
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
});
afterEach(() => vi.unstubAllGlobals());

describe('voice reuse', () => {
  it('deduplicates concurrent synthesis and loads one model for different captions', async () => {
    const { synthesizeLine } = await import('./tts');
    const [first, second] = await Promise.all([
      synthesizeLine('Hello', opts),
      synthesizeLine(' Hello ', opts),
    ]);
    expect(mock.load).toHaveBeenCalledTimes(1);
    expect(mock.generate).toHaveBeenCalledTimes(1);
    expect(first.wav.buffer).not.toBe(second.wav.buffer);
    await synthesizeLine('Different caption', opts);
    expect(mock.generate).toHaveBeenCalledTimes(2);
    expect(mock.load).toHaveBeenCalledTimes(1);
  });
  it('reuses persisted audio after a fresh module/session without loading the model', async () => {
    const firstSession = await import('./tts');
    await firstSession.synthesizeLine('Private caption', opts);
    expect(disk.size).toBe(1);
    expect([...disk.keys()][0]).not.toContain('Private');
    vi.resetModules();
    mock.load.mockClear();
    mock.generate.mockClear();
    const nextSession = await import('./tts');
    const result = await nextSession.synthesizeLine('Private caption', opts);
    expect([...result.wav]).toEqual([1, 2, 3]);
    expect(result.durationSec).toBe(1);
    expect(mock.load).not.toHaveBeenCalled();
    expect(mock.generate).not.toHaveBeenCalled();
  });
  it('keeps different voices and speeds separate', async () => {
    const { synthesizeLine } = await import('./tts');
    await synthesizeLine('Hello', opts);
    await synthesizeLine('Hello', { ...opts, voiceId: 'af_bella' });
    await synthesizeLine('Hello', { ...opts, speed: 1.2 });
    expect(mock.generate).toHaveBeenCalledTimes(3);
  });
  it('keeps cached audio intact after a caller transfers its buffer', async () => {
    const { synthesizeLine } = await import('./tts');
    const first = await synthesizeLine('Hello', opts);
    structuredClone(first.wav, { transfer: [first.wav.buffer as ArrayBuffer] });
    expect(first.wav.byteLength).toBe(0);
    expect([...(await synthesizeLine('Hello', opts)).wav]).toEqual([1, 2, 3]);
    expect(mock.generate).toHaveBeenCalledTimes(1);
  });
  it('continues when browser storage is blocked or full', async () => {
    vi.stubGlobal('caches', {
      open: vi.fn(async () => {
        throw new Error('Storage blocked');
      }),
    });
    const { synthesizeLine } = await import('./tts');
    await expect(synthesizeLine('Hello', opts)).resolves.toMatchObject({ durationSec: 1 });
    await synthesizeLine('Hello', opts);
    expect(mock.generate).toHaveBeenCalledTimes(1);
  });
  it('retries after a model load failure', async () => {
    mock.load.mockRejectedValueOnce(new Error('Network failed'));
    const { synthesizeLine } = await import('./tts');
    await expect(synthesizeLine('Hello', opts)).rejects.toThrow('Network failed');
    await expect(synthesizeLine('Hello', opts)).resolves.toMatchObject({ durationSec: 1 });
    expect(mock.load).toHaveBeenCalledTimes(2);
  });
  it('regenerates malformed cache entries instead of returning broken audio', async () => {
    cache.match.mockResolvedValueOnce(
      new Response(new Uint8Array([1]), { headers: { 'X-ReelCraft-Duration': 'invalid' } }),
    );
    const { synthesizeLine } = await import('./tts');
    expect((await synthesizeLine('Hello', opts)).durationSec).toBe(1);
    expect(cache.delete).toHaveBeenCalledTimes(1);
    expect(mock.generate).toHaveBeenCalledTimes(1);
  });
});
