import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.FOCUS_DRIVE_URL || 'http://127.0.0.1:4173';
const output = new URL('../docs/verification/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const pageErrors = []; page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(`${base}?test=1`);
await page.waitForFunction(() => document.querySelector('#world')?.dataset.engine, null, { timeout: 60_000 });
const quickDual = await page.getByRole('button', { name: /いきなり高負荷で遊ぶ/ }).isVisible();
await page.getByRole('button', { name: 'ドライブをはじめる', exact: true }).click();
await page.getByRole('button', { name: '準備できた', exact: true }).click();
const audioAfterGesture = await page.evaluate(() => window.__FOCUS_DRIVE_TEST__.getAudio());
await page.locator('#countdown').waitFor({ state: 'detached', timeout: 45_000 });
await page.evaluate(() => {
  const api = window.__FOCUS_DRIVE_TEST__;
  const engine = api.getEngine();
  const seed = engine.config.seed;
  const phase = (((seed % 997) + 997) % 997) * 0.001;
  const center = (s) => Math.sin(s * 0.006 + phase) * 5.4 + Math.sin(s * 0.013 + phase * 0.7) * 1.8;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  window.__WALL_MODE__ = false;
  api.setControl((snap) => {
    if (window.__WALL_MODE__) return 1;
    const next = snap.navEvents.filter((event) => !event.passed && event.atDistance > snap.progressS + 1).sort((a, b) => a.atDistance - b.atDistance)[0];
    if (!next) return 0;
    const target = center(next.atDistance) + next.roadOffset;
    const desiredVx = clamp((target - snap.carX) * 3.2, -4.8, 4.8);
    return clamp((desiredVx - snap.carVX) * 2.2, -1, 1);
  });
});
let power = null;
for (let i = 0; i < 200; i++) {
  const state = await page.evaluate(() => {
    const snap = window.__FOCUS_DRIVE_TEST__.getSnapshot();
    return { elapsed: snap.elapsedMs, pace: snap.paceFactor, fx: document.body.className, feedback: snap.lastFeedback };
  });
  if (state.pace > 1.08 && state.fx.includes('fx-power')) { power = state; break; }
  await page.waitForTimeout(50);
}
await page.screenshot({ path: new URL('feedback-power.png', output).pathname });
let guide = null;
for (let i = 0; i < 300; i++) {
  const state = await page.evaluate(() => {
    const snap = window.__FOCUS_DRIVE_TEST__.getSnapshot();
    return { elapsed: snap.elapsedMs, phase: snap.guide.phase, progress: snap.guide.progress };
  });
  if (['APPROACH', 'LOCKABLE', 'LOCKING'].includes(state.phase)) { guide = state; break; }
  await page.waitForTimeout(100);
}
await page.screenshot({ path: new URL('feedback-guide.png', output).pathname });
await page.evaluate(() => { window.__WALL_MODE__ = true; });
let wall = null; let maxLateral = 0;
for (let i = 0; i < 120; i++) {
  const state = await page.evaluate(() => {
    const snap = window.__FOCUS_DRIVE_TEST__.getSnapshot();
    return { lateral: Math.abs(snap.carX - snap.roadCenterX), feedback: snap.lastFeedback, fx: document.body.className };
  });
  maxLateral = Math.max(maxLateral, state.lateral);
  if (state.feedback?.kind === 'WALL' && state.fx.includes('fx-wall')) { wall = state; break; }
  await page.waitForTimeout(50);
}
await page.screenshot({ path: new URL('feedback-guardrail.png', output).pathname });
const audioAtEnd = await page.evaluate(() => window.__FOCUS_DRIVE_TEST__.getAudio());
await page.evaluate(() => window.__FOCUS_DRIVE_TEST__.abort());
await page.locator('.result-screen').waitFor();
const result = { sampledAt: new Date().toISOString(), quickDualVisible: quickDual, audioAfterGesture, audioAtEnd, power, guide, wall, maxLateral, pageErrors };
await writeFile(new URL('feedback-verification.json', output), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
