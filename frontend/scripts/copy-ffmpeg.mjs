// Copies the ffmpeg.wasm core and worker files into public/ffmpeg so they are served from
// the same origin (required: /editor runs with COEP, so no external CDN).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../public/ffmpeg');

// Packages may be hoisted to the repo root or live in frontend/node_modules.
const pkgDir = (name) => {
  for (const base of [path.resolve(here, '../node_modules'), path.resolve(here, '../../node_modules')]) {
    const dir = path.join(base, name);
    if (existsSync(dir)) return dir;
  }
  console.error(`copy-ffmpeg: cannot find ${name}; run npm install`);
  process.exit(1);
};

const jobs = [
  {
    from: path.join(pkgDir('@ffmpeg/ffmpeg'), 'dist/esm'),
    to: path.join(out, 'lib'),
    files: ['worker.js', 'const.js', 'errors.js'],
  },
  {
    from: path.join(pkgDir('@ffmpeg/core'), 'dist/esm'),
    to: path.join(out, 'st'),
    files: ['ffmpeg-core.js', 'ffmpeg-core.wasm'],
  },
  {
    from: path.join(pkgDir('@ffmpeg/core-mt'), 'dist/esm'),
    to: path.join(out, 'mt'),
    files: ['ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-core.worker.js'],
  },
];

for (const job of jobs) {
  mkdirSync(job.to, { recursive: true });
  for (const file of job.files) {
    const src = path.join(job.from, file);
    if (!existsSync(src)) {
      console.error(`copy-ffmpeg: missing ${src}`);
      process.exit(1);
    }
    cpSync(src, path.join(job.to, file));
  }
}
console.log('copy-ffmpeg: done');
