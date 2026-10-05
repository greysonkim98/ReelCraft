// Static export for Firebase Hosting: copies the ffmpeg cores, then `next build` with NEXT_EXPORT=1.
// Output goes to frontend/out (the Hosting "public" directory in /firebase.json).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('node', ['scripts/copy-ffmpeg.mjs']);
run('npx', ['next', 'build'], { NEXT_EXPORT: '1' });
