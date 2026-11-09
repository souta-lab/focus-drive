import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
/**
 * Verifies the recorded engine loops load, that the mid/high layers crossfade with engine
 * speed, and that playbackRate tracks RPM. This environment has no speakers, so the check is
 * numeric (graph state) — it cannot confirm how the engine actually sounds.
 */
const base = process.env.FOCUS_DRIVE_URL || 'http://127.0.0.1:4173';
const output = new URL('../docs/verification/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox','--use-angle=gl-egl','--enable-gpu','--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errors = [], failed = [];
page.on('pageerror', e => errors.push(e.message));
page.on('requestfailed', r => failed.push(`${r.url()} ${r.failure()?.errorText}`));
await page.goto(`${base}/?test=1`);
await page.waitForFunction(() => !!window.__FOCUS_DRIVE_TEST__?.getRenderer(), null, { timeout: 60_000 });
await page.getByRole('button', { name: /いきなり高負荷で遊ぶ/ }).click();
await page.locator('#countdown').waitFor({ state: 'detached', timeout: 45_000 });
await page.waitForFunction(() => window.__FOCUS_DRIVE_TEST__.getAudio().engineSamples === true, null, { timeout: 30_000 });

// Hold a chosen speed by steering along the road; sample the audio graph as the gearbox shifts.
const samples = [];
for (let i = 0; i < 22; i++) {
  await page.evaluate(() => {
    const api = window.__FOCUS_DRIVE_TEST__; const seed = api.getEngine().config.seed;
    const ph = (((seed % 997) + 997) % 997) * 0.001;
    const centre = s => Math.sin(s*0.006+ph)*5.4 + Math.sin(s*0.013+ph*0.7)*1.8;
    api.setControl((snap) => { const e = snap.navEvents.find(x=>!x.passed); const t = e ? centre(e.atDistance)+e.roadOffset : centre(snap.progressS+20); const d=(t-snap.carX)*2.8; return Math.max(-1,Math.min(1,(d-snap.carVX)*0.8)); });
  });
  await page.waitForTimeout(900);
  samples.push(await page.evaluate(() => {
    const s = window.__FOCUS_DRIVE_TEST__.getSnapshot();
    const a = window.__FOCUS_DRIVE_TEST__.getAudio();
    // Compare the two loudest layers: those are what the ear actually hears. A third layer
    // may still be fading out at very low gain, which is not audible but skews a naive check.
    const audible = [...a.rates].sort((x, y) => y.gain - x.gain).slice(0, 2).filter(r => r.gain > 0.05);
    // rate x baseRpm recovers the RPM each layer is reproducing; they must agree.
    const implied = audible.map(r => Math.round(r.rate * r.baseRpm));
    return {
      kmh: Math.round(s.forwardSpeed * 3.6), gear: document.getElementById('gear-value')?.textContent,
      audibleLayers: audible.length, impliedRpm: implied,
      pitchAgreement: implied.length > 1 ? Math.abs(implied[0] - implied[1]) : 0,
      gains: a.rates.map(r => r.gain),
    };
  }));
}
const status = await page.evaluate(() => window.__FOCUS_DRIVE_TEST__.getAudio());
const allRates = samples.flatMap(s => s.impliedRpm);
const spread = {
  rpmSeen: [Math.min(...allRates), Math.max(...allRates)],
  maxPitchDisagreement: Math.max(...samples.map(s => s.pitchAgreement)),
  gears: [...new Set(samples.map(s => s.gear))],
};
const result = { sampledAt: new Date().toISOString(), status, spread, samples, pagesErrors: errors, failedRequests: failed };
await writeFile(new URL('audio-verification.json', output), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ status, spread, samples: samples.filter((_, i) => i % 3 === 0), errors, failed }, null, 2));
await browser.close();
