import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from './server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const outDir = path.join(root, '.scratch', 'audit');
mkdirSync(outDir, { recursive: true });
const BROWSER = process.env.BROWSER_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const server = await start(4173);
const browser = await chromium.launch({
  executablePath: BROWSER,
  headless: !process.env.HEADED,
  args: ['--enable-unsafe-webgpu', '--enable-features=PlatformHEVCDecoderSupport'],
});
const page = await (await browser.newContext()).newPage();
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:4173/codec.html');
await page.waitForFunction(() => window.ready === true);

const result = { detect: await page.evaluate(() => window.detect()) };
console.log('ENV', JSON.stringify(result.detect.env));
const pick = (k) =>
  Object.entries(result.detect.webcodecs)
    .filter(([n]) => n.startsWith(k))
    .map(([n, v]) => `${n}: ${v.supported ?? v.error}`)
    .join('\n');
console.log(pick('dec'));
console.log(pick('enc'));

result.caps = await page.evaluate(() => window.ffCaps(false));
console.log('FFMPEG.WASM caps', JSON.stringify(result.caps));

const cases = [
  ['h264.mp4', false],
  ['hevc8.mp4', false],
  ['hevc10_hdr.mp4', false],
  ['rot90.mov', false],
  ['vfr.mp4', false],
  ['hevc8.mp4', true],
  ['rot90.mov', true],
];
result.normalise = [];
for (const [name, multi] of cases) {
  const r = await page.evaluate(([n, m]) => window.normalise(n, m), [name, multi]);
  const file = path.join(outDir, `${name.replace(/\W/g, '_')}_${multi ? 'mt' : 'st'}.mp4`);
  if (r.b64) writeFileSync(file, Buffer.from(r.b64, 'base64'));
  delete r.b64;
  if (r.size) {
    const p = spawnSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_name,profile,pix_fmt,width,height,avg_frame_rate,nb_frames,duration', '-of', 'compact=nk=0:p=0', file],
      { encoding: 'utf8' },
    );
    r.probe = p.stdout.trim().split('\n');
  }
  result.normalise.push(r);
  console.log(`${name} ${multi ? 'MT' : 'ST'} -> exit=${r.code} err=${r.err} ${r.ms}ms ${r.size}B`, r.probe ?? '', r.code ? r.tail : '');
}
writeFileSync(path.join(outDir, 'codec-result.json'), JSON.stringify(result, null, 1));
await browser.close();
server.close();
