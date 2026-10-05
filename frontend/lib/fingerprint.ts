const MB = 1024 * 1024;

/**
 * SHA-256(name | size | first 1MB | last 1MB) as hex. Cheap enough to run on import,
 * and never reads the whole file.
 */
export async function computeFingerprint(file: File): Promise<string> {
  const head = new Uint8Array(await file.slice(0, MB).arrayBuffer());
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - MB)).arrayBuffer());
  const prefix = new TextEncoder().encode(`${file.name}|${file.size}|`);
  const sep = new TextEncoder().encode('|');

  const data = new Uint8Array(prefix.length + head.length + sep.length + tail.length);
  data.set(prefix, 0);
  data.set(head, prefix.length);
  data.set(sep, prefix.length + head.length);
  data.set(tail, prefix.length + head.length + sep.length);

  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
