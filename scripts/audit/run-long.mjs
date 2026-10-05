// Speed baseline: normalise a 30 s 1080p HEVC clip with ffmpeg.wasm (single- and multi-thread core).
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from './server.mjs';

const BROWSER = process.env.BROWSER_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const clip = process.argv[2] ?? 'long_hevc_1080p.mp4';
const server = await start(4174);
const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
const page = await (await browser.newContext()).newPage();
page.setDefaultTimeout(600000);
await page.goto('http://localhost:4174/codec.html');
await page.waitForFunction(() => window.ready === true);
for (const multi of [false, true]) {
  const r = await page.evaluate(([n, m]) => window.normalise(n, m), [clip, multi]);
  delete r.b64;
  console.log(`${clip} ${multi ? 'MT' : 'ST'}: exit=${r.code} err=${r.err} ${r.ms} ms for 30 s of video (${(30000 / r.ms).toFixed(2)}x realtime) out=${r.size} B`);
}
await browser.close();
server.close();
void path; void fileURLToPath;
