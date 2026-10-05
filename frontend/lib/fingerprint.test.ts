import { describe, expect, it } from 'vitest';
import { computeFingerprint } from './fingerprint';

const MB = 1024 * 1024;
const file = (name: string, bytes: Uint8Array) => new File([bytes as BlobPart], name);

describe('computeFingerprint', () => {
  it('is a 64-char hex SHA-256 and deterministic', async () => {
    const f = file('a.mp4', new Uint8Array([1, 2, 3]));
    const a = await computeFingerprint(f);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await computeFingerprint(file('a.mp4', new Uint8Array([1, 2, 3])))).toBe(a);
  });

  it('changes with the name, size and content at either end', async () => {
    const base = new Uint8Array(3 * MB).fill(7);
    const ref = await computeFingerprint(file('a.mp4', base));
    expect(await computeFingerprint(file('b.mp4', base))).not.toBe(ref);
    expect(await computeFingerprint(file('a.mp4', new Uint8Array(3 * MB + 1).fill(7)))).not.toBe(ref);

    const head = base.slice();
    head[10] = 9;
    expect(await computeFingerprint(file('a.mp4', head))).not.toBe(ref);

    const tail = base.slice();
    tail[3 * MB - 10] = 9;
    expect(await computeFingerprint(file('a.mp4', tail))).not.toBe(ref);
  });

  it('only reads the first and last MB (a middle edit is not detected by design)', async () => {
    const base = new Uint8Array(3 * MB).fill(7);
    const ref = await computeFingerprint(file('a.mp4', base));
    const mid = base.slice();
    mid[Math.floor(1.5 * MB)] = 9;
    expect(await computeFingerprint(file('a.mp4', mid))).toBe(ref);
  });
});
