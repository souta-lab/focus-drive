import { chromium } from '@playwright/test';
const base = 'http://127.0.0.1:4173';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(base + '?test=1');
await page.waitForFunction(() => document.querySelector('#world')?.dataset.engine, null, { timeout: 60_000 });
await page.evaluate(() => window.__FOCUS_DRIVE_TEST__.start({ missionType: 'TRAINING', taskMode: 'DUAL', durationMs: 26000, testHarness: true, challengeMode: true }));
await page.locator('#countdown').waitFor({ state: 'detached', timeout: 45_000 });

async function installController(kind) {
  await page.evaluate((wanted) => {
    const api = window.__FOCUS_DRIVE_TEST__;
    const seed = api.getEngine().config.seed;
    const phase = (((seed % 997) + 997) % 997) * 0.001;
    const center = (s) => Math.sin(s * 0.006 + phase) * 5.4 + Math.sin(s * 0.013 + phase * 0.7) * 1.8;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    api.setControl((snap) => {
      const event = snap.navEvents.find((e) => !e.passed && (wanted === 'obstacle' ? e.kind === 'OBSTACLE' : true)) ?? snap.navEvents.find((e) => !e.passed);
      if (!event) return 0;
      const target = center(event.atDistance) + event.roadOffset;
      const desiredVx = clamp((target - snap.carX) * 3, -4.6, 4.6);
      return clamp((desiredVx - snap.carVX) * 2.2, -1, 1);
    });
  }, kind);
}

async function waitForSnapshot(predicate, timeout = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const state = await page.evaluate(() => {
      const s = window.__FOCUS_DRIVE_TEST__.getSnapshot();
      return { paceFactor: s.paceFactor, forwardSpeed: s.forwardSpeed, driveScore: s.driveScore, eventAccuracy: s.eventAccuracy, feedback: s.lastFeedback, elapsedMs: s.elapsedMs, elapsedSinceFeedback: s.lastFeedback ? s.elapsedMs - s.lastFeedback.tMs : null };
    });
    if (predicate(state)) return state;
    await page.waitForTimeout(60);
  }
  return null;
}

await installController('next');
const surge = await waitForSnapshot((s) => s.paceFactor > 1.1 && s.elapsedSinceFeedback !== null && s.elapsedSinceFeedback < 900);
console.log('SURGE:', JSON.stringify(surge));
await page.screenshot({ path: 'docs/verification/events-surge.png' });

await installController('obstacle');
const impact = await waitForSnapshot((s) => s.paceFactor < 0.95 && s.elapsedSinceFeedback !== null && s.elapsedSinceFeedback < 900);
console.log('IMPACT:', JSON.stringify(impact));
await page.screenshot({ path: 'docs/verification/events-impact.png' });

const final = await page.evaluate(() => {
  const s = window.__FOCUS_DRIVE_TEST__.getSnapshot();
  return { driveScore: s.driveScore, eventAccuracy: s.eventAccuracy, paceFactor: s.paceFactor, level: s.roadLevel };
});
console.log('FINAL:', JSON.stringify(final), 'errors:', JSON.stringify(errors));
await page.evaluate(() => window.__FOCUS_DRIVE_TEST__.abort());
await browser.close();
