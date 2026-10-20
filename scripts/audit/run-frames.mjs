// Speed of "1 frame per second -> JPEG" extraction in ffmpeg.wasm (plan step 5).
// Usage: node scripts/audit/run-frames.mjs [clip.mp4 ...]   (clips live in .scratch/codec)
import { chromium } from 'playwright-core';
import { start } from './server.mjs';

const BROWSER = process.env.BROWSER_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const clips = process.argv.length > 2 ? process.argv.slice(2) : ['long_hevc_1080p.mp4', 'h264.mp4'];
const RUNS = 2;
// 384 high = readable by a vision-language model; 224x224 = SigLIP 2 base-224 input.
// JPEG at 384 high crashes the wasm core, so that size is PNG only.
const variants = [
  ['scale=-2:384', 'png'],
  ['scale=224:224:force_original_aspect_ratio=increase,crop=224:224', 'jpg'],
  ['scale=224:224:force_original_aspect_ratio=increase,crop=224:224', 'png'],
];

const server = await start(4175);
const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
const page = await (await browser.newContext()).newPage();
page.setDefaultTimeout(600000);
await page.goto('http://localhost:4175/frames.html');
await page.waitForFunction(() => window.ready === true);
for (const clip of clips) {
  for (const [vf, ext] of variants) {
    for (const multi of [false, true]) {
      const ms = [];
      let last;
      for (let i = 0; i < RUNS; i++) {
        last = await page.evaluate(([n, m, v, e]) => window.extract(n, m, v, e), [clip, multi, vf, ext]);
        ms.push(last.ms);
      }
      const median = [...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)];
      console.log(
        `${clip} ${multi ? 'MT' : 'ST'} ${ext} [${vf}]: exit=${last.code} err=${last.err} ` +
          `${median} ms (runs ${ms.join('/')}) frames=${last.frames} ` +
          `size=${(last.bytes / 1024).toFixed(0)}KB heap=${last.jsHeapMB}MB`,
      );
    }
  }
}
await browser.close();
server.close();
