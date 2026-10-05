// Serves frontend/out the way firebase.json says Hosting will: cleanUrls plus the "headers" rules.
// The Firebase Hosting emulator does not apply custom headers, so this stands in for it locally.
// Only the header VALUES are verified here; how Hosting matches `source` globs is checked after a
// deploy (preview channel).  Usage: node scripts/audit/serve-out.mjs [port]
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = JSON.parse(readFileSync(path.join(root, 'firebase.json'), 'utf8')).hosting;
const publicDir = path.join(root, config.public);

// Firebase glob subset used here: "**" matches anything, "*" matches within one path segment.
const toRegex = (source) =>
  new RegExp(
    '^' +
      source
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '.*') +
      '$',
  );
const rules = (config.headers ?? []).map((h) => ({ re: toRegex(h.source), headers: h.headers }));

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const resolveFile = (urlPath) => {
  const clean = path.normalize(urlPath).replace(/^([/\\])+/, '');
  const direct = path.join(publicDir, clean);
  if (!direct.startsWith(publicDir)) return null;
  if (existsSync(direct) && statSync(direct).isFile()) return direct;
  if (config.cleanUrls && existsSync(direct + '.html')) return direct + '.html';
  const index = path.join(direct, 'index.html');
  return existsSync(index) ? index : null;
};

export function start(port = 5000) {
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = resolveFile(urlPath);
    for (const rule of rules) {
      if (rule.re.test(urlPath)) for (const h of rule.headers) res.setHeader(h.key, h.value);
    }
    if (!file) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 5000);
  await start(port);
  console.log(`serving ${config.public} on http://localhost:${port}`);
}
