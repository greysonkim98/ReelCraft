// Drives the real frontend (dev servers on :3000 / :4010, Auth emulator on :9099) in headless Edge:
//   A. Does a style picked in the Style library reach the editor (signed in / signed out)?
//   B. Import real clips -> pick style -> analyse -> own captions -> render -> download, then
//      measure the output video to see whether the style was actually applied.
// AI captions are NOT called (the "Write captions myself" path), so no Groq quota is used.
//
//   node scripts/audit/style-flow.mjs            (needs: firebase auth emulator, backend, frontend running)
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const BROWSER = process.env.BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SRC = path.join(root, '.scratch', 'real');
const OUT = path.join(root, '.scratch', 'style-flow');
mkdirSync(OUT, { recursive: true });
const CLIPS = readdirSync(SRC)
  .filter((f) => /\.(mp4|mov|m4v)$/i.test(f))
  .sort()
  .map((f) => path.join(SRC, f));

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};
const log = (...a) => console.log('   ', ...a);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => {});

async function signIn(page) {
  await page.goto(`${BASE}/login`);
  await page.getByTestId('dev-sign-in').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {});
  return new URL(page.url()).pathname + new URL(page.url()).search;
}

// Clicks the three cards on /styles. Names are the lowercase ids used by shared COLOR_LOOKS etc.
async function pickInLibrary(page, { color, subtitle, tempo }) {
  await page.goto(`${BASE}/styles`);
  await page.locator('.look-grid button', { hasText: color }).first().click();
  await page.locator('.subtitle-grid button', { hasText: subtitle }).first().click();
  await page.locator('.tempo-grid button', { hasText: tempo }).first().click();
}

// What the editor's Style step shows as selected (aria-pressed=true) in each fieldset.
async function selectedStyle(page) {
  const pick = async (legend) =>
    (
      await page
        .locator(`fieldset:has(legend:text-is("${legend}")) button[aria-pressed="true"]`)
        .first()
        .innerText()
    )
      .trim()
      .split('\n')[0]
      .toLowerCase();
  return { color: await pick('Color look'), subtitle: await pick('Caption style'), tempo: await pick('Editing pace') };
}

const next = (page, label) => page.getByRole('button', { name: new RegExp(`^Continue to ${label}`, 'i') });

async function importClips(page) {
  await page.locator('input[type="file"]').setInputFiles(CLIPS);
  await page.waitForFunction(
    (n) => document.querySelectorAll('input[aria-label$=" note"]').length >= n,
    CLIPS.length,
    { timeout: 180000 },
  );
}

function ff(args, bin = 'ffmpeg') {
  const r = spawnSync(bin, bin === 'ffmpeg' ? ['-hide_banner', '-nostdin', ...args] : ['-v', 'error', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

// Mean saturation (signalstats SATAVG) and size of the rendered file.
function measure(file) {
  const probe = ff(['-show_entries', 'format=duration:stream=codec_name,width,height,r_frame_rate', '-of', 'json', file], 'ffprobe');
  const info = JSON.parse(probe.out || '{}');
  const r = ff(['-i', file, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.SATAVG', '-an', '-f', 'null', '-']);
  const vals = [...r.err.matchAll(/SATAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  const satavg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
  return { duration: Number(info.format?.duration), streams: info.streams, satavg: Math.round(satavg * 10) / 10 };
}

// One full pass: style via the library, via URL params, or defaults -> render -> saved mp4.
async function runFlow(browser, label, { via, style }) {
  console.log(`\n=== ${label}: ${via} ${JSON.stringify(style ?? {})}`);
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  const result = { label, via, requested: style };
  try {
    await signIn(page);
    if (via === 'library') {
      await pickInLibrary(page, style);
      await Promise.all([page.waitForURL(/\/editor/), page.getByRole('link', { name: /Create with this style/i }).click()]);
    } else if (via === 'url') {
      await page.goto(`${BASE}/editor?look=${style.color}&subtitle=${style.subtitle}&tempo=${style.tempo}`);
    } else {
      await page.goto(`${BASE}/editor`);
    }
    result.editorUrl = new URL(page.url()).pathname + new URL(page.url()).search;
    await page.locator('input[type="file"]').waitFor({ state: 'attached', timeout: 90000 });
    result.isolated = await page.evaluate(() => window.crossOriginIsolated);
    await importClips(page);
    await next(page, 'style').click();
    await page.waitForURL(/\/editor\/style/);
    result.selected = await selectedStyle(page);
    await shot(page, `${label}-1-style-step`);

    await next(page, 'analyze').click();
    await page.getByRole('button', { name: /Start analysis|Analyze again/ }).click();
    const t0 = Date.now();
    await page.getByTestId('analysis-summary').waitFor({ timeout: 420000 });
    result.analysisSeconds = Math.round((Date.now() - t0) / 100) / 10;
    result.summary = (await page.getByTestId('analysis-summary').innerText()).replace(/\s+/g, ' ').trim();
    result.notes = await page.locator('ul.bg-amber-50 li').allInnerTexts().catch(() => []);
    await shot(page, `${label}-2-analysis`);

    await next(page, 'captions').click();
    await page.getByRole('button', { name: /Write captions myself/ }).click();
    await page.waitForURL(/\/editor\/review/);
    result.steps = [page.url()];
    const caps = page.locator('input[aria-label^="Scene "][aria-label$=" caption"]');
    result.sceneCount = await caps.count();
    for (let i = 0; i < result.sceneCount; i++) await caps.nth(i).fill(`Style test ${i + 1}`);
    await shot(page, `${label}-3-review`);

    await next(page, 'render').click();
    await page.waitForURL(/\/editor\/render/);
    await page.getByRole('button', { name: /Start rendering/ }).click();
    const r0 = Date.now();
    // the app moves to the Share step by itself when the render finishes
    const outcome = await Promise.race([
      page.waitForURL(/\/editor\/share/, { timeout: 600000 }).then(() => 'done'),
      page.getByTestId('render-error').waitFor({ timeout: 600000 }).then(() => 'error'),
    ]);
    result.renderSeconds = Math.round((Date.now() - r0) / 100) / 10;
    if (outcome === 'error') throw new Error(`render error: ${await page.getByTestId('render-error').innerText()}`);
    await page.locator('video').first().waitFor();
    const b64 = await page.evaluate(async () => {
      const v = document.querySelector('video');
      const buf = new Uint8Array(await (await fetch(v.src)).arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return btoa(s);
    });
    const file = path.join(OUT, `${label}.mp4`);
    writeFileSync(file, Buffer.from(b64, 'base64'));
    result.file = file;
    result.video = measure(file);
    // frame during the first caption, for a visual check of the caption style
    ff(['-y', '-ss', '0.6', '-i', file, '-frames:v', '1', path.join(OUT, `${label}-frame.png`)]);
    await shot(page, `${label}-4-share`);
  } catch (e) {
    result.error = String(e).slice(0, 400);
    await shot(page, `${label}-error`);
  }
  result.pageErrors = errors;
  await ctx.close();
  return result;
}

const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
console.log(`clips: ${CLIPS.length} from ${SRC}`);

// ---- A. does the library's choice reach the editor? ----
console.log('\n=== A1. style library -> editor, SIGNED IN');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  log('after dev sign-in landed on:', await signIn(page));
  await pickInLibrary(page, { color: 'vivid', subtitle: 'pop', tempo: 'calm' });
  await Promise.all([page.waitForURL(/\/editor/), page.getByRole('link', { name: /Create with this style/i }).click()]);
  const url = new URL(page.url());
  log('editor URL:', url.pathname + url.search);
  check('library link carries look/subtitle/tempo in the URL', url.searchParams.get('look') === 'vivid' && url.searchParams.get('subtitle') === 'pop' && url.searchParams.get('tempo') === 'calm');
  await ctx.close();
}

console.log('\n=== A2. style library -> editor, SIGNED OUT (fresh browser profile)');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  await pickInLibrary(page, { color: 'vivid', subtitle: 'pop', tempo: 'calm' });
  await Promise.all([page.waitForURL(/\/editor/), page.getByRole('link', { name: /Create with this style/i }).click()]);
  await page.waitForTimeout(1500);
  const gate = (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ').slice(0, 220);
  log('editor while signed out shows:', gate);
  await shot(page, 'A2-signed-out-editor');
  const signInLink = page.getByRole('link', { name: /^Sign in$/i }).first();
  if (await signInLink.count()) {
    await signInLink.click();
    const landed = await signIn(page).catch((e) => `sign-in failed: ${e}`);
    log('after sign-in landed on:', landed);
    const keep = /look=vivid/.test(landed) && /subtitle=pop/.test(landed) && /tempo=calm/.test(landed);
    check('style survives the sign-in detour (signed-out user)', keep, `landed ${landed}`);
  } else {
    check('signed-out user sees a sign-in link on the editor', false, 'no "Sign in" link found');
  }
  await ctx.close();
}

// ---- B. full flow with three different styles ----
const results = [];
results.push(await runFlow(browser, 'runA-library-vivid-pop-calm', { via: 'library', style: { color: 'vivid', subtitle: 'pop', tempo: 'calm' } }));
results.push(await runFlow(browser, 'runB-default', { via: 'default' }));
results.push(await runFlow(browser, 'runC-url-mono-box-energetic', { via: 'url', style: { color: 'mono', subtitle: 'box', tempo: 'energetic' } }));
await browser.close();

console.log('\n=== B. results');
const expected = {
  A: { color: 'vivid', subtitle: 'pop', tempo: 'calm' },
  B: { color: 'natural', subtitle: 'classic', tempo: 'energetic' },
  C: { color: 'mono', subtitle: 'box', tempo: 'energetic' },
};
for (const r of results) {
  const key = r.label.slice(3, 4);
  console.log(`\n-- ${r.label}`);
  if (r.error) {
    check(`${r.label} completed`, false, r.error);
    continue;
  }
  check(`${r.label}: editor Style step shows the requested style`, JSON.stringify(r.selected) === JSON.stringify(expected[key]), `shown ${JSON.stringify(r.selected)}`);
  log('isolated:', r.isolated, '| analysis', r.analysisSeconds, 's | render', r.renderSeconds, 's');
  log('summary:', r.summary, '| notes:', JSON.stringify(r.notes));
  log('video:', JSON.stringify(r.video));
  if (r.pageErrors.length) log('page errors:', r.pageErrors.join(' || '));
}
const by = Object.fromEntries(results.map((r) => [r.label.slice(3, 4), r]));
if (by.A?.video && by.B?.video && by.C?.video) {
  check('color look applied: vivid is more saturated than natural', by.A.video.satavg > by.B.video.satavg, `vivid ${by.A.video.satavg} vs natural ${by.B.video.satavg}`);
  check('color look applied: mono is ~0 saturation', by.C.video.satavg < 5, `mono ${by.C.video.satavg}`);
  check('tempo applied: calm picks fewer/longer scenes than energetic', by.A.sceneCount < by.B.sceneCount, `calm ${by.A.sceneCount} scenes vs energetic ${by.B.sceneCount}`);
  for (const r of [by.A, by.B, by.C]) {
    const s = r.video.streams?.find((x) => x.codec_name === 'h264');
    check(`${r.label}: output is 720x1280 h264`, s?.width === 720 && s?.height === 1280, `${s?.width}x${s?.height}`);
  }
}
writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\n${failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'}   (screens/videos in ${OUT})`);
process.exit(failures ? 1 : 0);
