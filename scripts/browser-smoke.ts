// Drives the real site in a headless Chromium-family browser with ffmpeg.wasm:
// sign in (Auth emulator) → import clips → analyse → AI captions → render → download → ffprobe.
//
// Prereqs (see docs/local-testing.md):
//   - `npm run verify:render` once (creates the synthetic clips in .scratch/verify)
//   - the static site built with NEXT_PUBLIC_AUTH_EMULATOR=127.0.0.1:9099 and NEXT_PUBLIC_API_URL
//     pointing at the backend, served by `firebase emulators:start --only auth,hosting` (:5000)
//   - the backend running with FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 and a GROQ_API_KEY
// MOCK_AI=1 answers /ai/script in the browser instead of calling Groq (no key needed).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Request } from 'playwright-core';

const root = path.resolve(__dirname, '..');
const clipsDir = path.join(root, '.scratch', 'verify');
const outDir = path.join(root, '.scratch', 'browser');
const BASE = process.env.BASE_URL ?? 'http://localhost:5000';
const BROWSER =
  process.env.BROWSER_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

async function main() {
  let clips = ['clipA.mp4', 'clipB.mp4', 'clipC.mp4'].map((c) => path.join(clipsDir, c));
  if (!clips.every(existsSync)) throw new Error('Run `npm run verify:render` first to create the sample clips.');
  mkdirSync(outDir, { recursive: true });
  // MANY=15 → stress the worker pool with that many clips (alternating the two moving samples).
  const many = Number(process.env.MANY ?? 0);
  if (many > 0) {
    const dir = path.join(outDir, 'many');
    mkdirSync(dir, { recursive: true });
    clips = Array.from({ length: many }, (_, i) => {
      const dest = path.join(dir, `clip_${String(i + 1).padStart(2, '0')}.mp4`);
      copyFileSync(path.join(clipsDir, i % 2 === 0 ? 'clipA.mp4' : 'clipB.mp4'), dest);
      return dest;
    });
  }
  const expected = clips.length;

  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.setDefaultTimeout(180_000);

  const uploads: string[] = [];
  const apiBodies: string[] = [];
  page.on('request', (req: Request) => {
    const size = req.postDataBuffer()?.length ?? 0;
    if (req.method() !== 'GET' && size > 100_000) uploads.push(`${req.method()} ${req.url()} ${size}B`);
    if (req.url().includes('/api/v1/ai/script') && req.method() === 'POST') apiBodies.push(req.postData() ?? '');
  });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 300));
  });

  if (process.env.MOCK_AI === '1') {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    await page.route('**/api/v1/ai/script', async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const body = req.postDataJSON() as { scenes: { scene_id: string; max_chars: number }[] };
      const text = ['Waves hit different', 'Salt air, zero plans', 'Ducks everywhere, honestly', 'Golden hour hits'];
      return route.fulfill({
        headers: cors,
        json: {
          projectId: 'mock',
          source: 'llm',
          model: 'mock',
          usage: { used: 1, limit: 3, remaining: 2, resetAt: new Date(Date.now() + 3600_000).toISOString() },
          script: {
            title: 'Mock',
            scenes: body.scenes.map((s, i) => ({
              scene_id: s.scene_id,
              caption: text[i % 4]!.slice(0, s.max_chars),
              voiceover: null,
              location_text: null,
            })),
          },
        },
      });
    });
  }

  // 0. sign in on the landing page (not cross-origin isolated, so the Google redirect can work)
  await page.goto(`${BASE}/`);
  const rootIsolated = await page.evaluate(() => window.crossOriginIsolated);
  check('/ (sign-in page) is NOT isolated, so the Google redirect keeps working', rootIsolated === false);
  await page.getByTestId('dev-sign-in').click();
  await page.waitForURL('**/editor', { timeout: 30_000 });

  const isolated = await page.evaluate(() => window.crossOriginIsolated);
  check('/editor is cross-origin isolated (COOP/COEP headers applied)', isolated === true);
  await page.getByText('Multi-thread ffmpeg').waitFor();
  await page.getByTestId('usage').waitFor({ timeout: 60_000 });
  check('usage badge shows the daily limit', /\d+ of \d+ AI caption runs left today/.test(await page.getByTestId('usage').innerText()));

  // 1. import
  const t0 = Date.now();
  await page.locator('input[type=file]').setInputFiles(clips);
  await page
    .locator('ol > li')
    .nth(expected - 1)
    .waitFor({ timeout: 120_000 })
    .catch(async () => {
      const alerts = await page.locator('[data-testid=analysis-error]').allInnerTexts();
      console.log('  import did not finish; alerts:', alerts.join(' | '));
    });
  const items = await page.locator('ol > li').count();
  check(`${expected} clips imported with thumbnails/metadata`, items === expected, `${items} items`);
  await page.getByLabel(/ note$/).first().fill('Santa Cruz, ducks and golden light');
  await page.screenshot({ path: path.join(outDir, '1-import.png') });
  await page.getByRole('button', { name: 'Next' }).click();

  // 2. style
  await page.getByRole('button', { name: /warm/i }).click();
  await page.getByRole('button', { name: /box/i }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  // 3. analysis (ffmpeg.wasm: proxy + metrics, mounted via WORKERFS)
  const ta = Date.now();
  await page.getByRole('button', { name: 'Start analysis' }).click();
  const poll = setInterval(async () => {
    const label = await page.locator('[role=progressbar]').locator('..').innerText().catch(() => '(no progress bar)');
    const alert = await page.locator('[data-testid=analysis-error]').allInnerTexts().catch(() => []);
    console.log(`   … ${((Date.now() - ta) / 1000).toFixed(0)}s  ${label.replace(/\s+/g, ' ')}  ${alert.join(' | ')}`);
  }, 10_000);
  try {
    await Promise.race([page.getByTestId('analysis-summary').waitFor(), page.locator('[data-testid=analysis-error]').first().waitFor()]);
  } finally {
    clearInterval(poll);
  }
  const alertText = await page.locator('[data-testid=analysis-error]').allInnerTexts();
  if (alertText.length) throw new Error(`analysis failed in the browser: ${alertText.join(' | ')}`);
  const summary = await page.getByTestId('analysis-summary').innerText();
  const notes = await page.locator('ul.bg-amber-50 li').allInnerTexts();
  console.log(`   analysis took ${((Date.now() - ta) / 1000).toFixed(1)}s: ${summary}`);
  console.log(`   notes: ${notes.length ? notes.join(' | ') : '(none — all filters available)'}`);
  check('analysis produced scenes', /^[1-9]\d* scenes?/.test(summary.trim()));
  if (many === 0) check('frozen clip 3 reported unused', /unused clips: 3/.test(summary), summary);
  await page.screenshot({ path: path.join(outDir, '3-analysis.png') });
  await page.getByRole('button', { name: 'Next' }).click();

  // 4. AI captions (real backend + Groq unless MOCK_AI=1)
  const aiButton = page.getByRole('button', { name: 'Write captions with AI' });
  check('AI button is disabled until the reel is described', await aiButton.isDisabled());
  await page.getByPlaceholder(/relaxing weekend trip/).fill('relaxing weekend trip with friends');
  await aiButton.click();
  await Promise.race([page.getByTestId('ai-done').waitFor({ timeout: 90_000 }), page.getByTestId('ai-fallback').waitFor({ timeout: 90_000 })]);
  const firstCaption = (await page.locator('ol li').first().innerText()).replace(/^\d+\./, '').trim();
  check('captions filled from the API response', firstCaption.length > 0 && firstCaption !== '(empty)', firstCaption);
  const usageAfter = await page.getByTestId('usage').innerText();
  console.log(`   usage badge after: ${usageAfter}`);
  check('usage badge went down after a successful run', /2 of 3/.test(usageAfter) || (await page.getByTestId('ai-fallback').count()) === 1, usageAfter);
  const sent = apiBodies[0] ?? '';
  check('request carried text only (no frames, no file names)', sent.length > 0 && !/\.mp4|\.mov|data:/.test(sent), `${sent.length} bytes`);
  await page.screenshot({ path: path.join(outDir, '4-captions.png'), fullPage: true });
  await page.getByRole('button', { name: 'Next' }).click();

  // 5. review
  const areas = await page.getByRole('textbox', { name: /caption$/ }).count();
  check('every scene has a caption box', areas > 0, `${areas}`);
  await page.screenshot({ path: path.join(outDir, '5-review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Next' }).click();

  // 6. render
  const tr = Date.now();
  await page.getByRole('button', { name: 'Start rendering' }).click();
  const renderPoll = setInterval(async () => {
    const label = await page.locator('[role=progressbar]').locator('..').innerText().catch(() => '(no progress bar)');
    const alert = await page.locator('[data-testid=render-error], [data-testid=analysis-error]').allInnerTexts().catch(() => []);
    console.log(`   … render ${((Date.now() - tr) / 1000).toFixed(0)}s  ${label.replace(/\s+/g, ' ')}  ${alert.join(' | ')}`);
  }, 15_000);
  try {
    await Promise.race([page.locator('video').waitFor({ timeout: Number(process.env.RENDER_TIMEOUT ?? 900_000) }), page.getByTestId('render-error').first().waitFor({ timeout: Number(process.env.RENDER_TIMEOUT ?? 900_000) })]);
  } finally {
    clearInterval(renderPoll);
  }
  const renderAlert = await page.getByTestId('render-error').allInnerTexts();
  if (renderAlert.length) throw new Error(`render failed in the browser: ${renderAlert.join(' | ')}`);
  console.log(`   render took ${((Date.now() - tr) / 1000).toFixed(1)}s`);

  // 7. result
  const dataUrl = await page.evaluate(async () => {
    const v = document.querySelector('video')!;
    const blob = await (await fetch(v.src)).blob();
    return await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsDataURL(blob);
    });
  });
  const mp4 = path.join(outDir, 'result.mp4');
  writeFileSync(mp4, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
  await page.screenshot({ path: path.join(outDir, '7-result.png') });

  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4], { encoding: 'utf8' });
  const info = JSON.parse(probe.stdout) as {
    streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string }[];
    format: { duration: string };
  };
  const v = info.streams.find((s) => s.codec_type === 'video')!;
  const dur = Number(info.format.duration);
  check('result is 720x1280 (9:16)', v.width === 720 && v.height === 1280, `${v.width}x${v.height}`);
  check('result is 30fps', v.r_frame_rate === '30/1', v.r_frame_rate);
  check('result ≤ 60s', dur <= 60, `${dur.toFixed(2)}s`);
  check('result has audio', info.streams.some((s) => s.codec_type === 'audio'));
  spawnSync('ffmpeg', ['-y', '-v', 'error', '-ss', '0.5', '-i', mp4, '-frames:v', '1', path.join(outDir, 'result-frame.png')]);

  check('no video bytes were uploaded anywhere', uploads.length === 0, uploads.join('; '));
  console.log(`   total ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  await browser.close();
  console.log(failures === 0 ? '\nBROWSER SMOKE PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
