// Tiny static server for the component audit: COOP/COEP on every response so SharedArrayBuffer works.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const mounts = {
  '/ffmpeg/': path.join(root, 'frontend', 'public', 'ffmpeg'),
  '/ffmpeg-esm/': path.join(root, 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'esm'),
  '/vid/': path.join(root, '.scratch', 'codec'),
  '/': here,
};
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.json': 'application/json',
};

export function start(port = 4173) {
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const mount = Object.keys(mounts).find((m) => url.startsWith(m) && m !== '/') ?? '/';
    const file = path.join(mounts[mount], url.slice(mount.length) || 'index.html');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      return res.end('not found ' + url);
    }
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
