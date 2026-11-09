import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

/**
 * Real-time 3-minute OTC High Challenge play.
 * 0-70s: skilled driver (follows events, answers every target)
 * 70-140s: passive driver (no steering, no answers)
 * 140-180s: skilled again
 * Verifies that difficulty rises, falls and recovers through the real rAF loop.
 */
const base = process.env.FOCUS_DRIVE_URL || 'http://127.0.0.1:4173';
const output = new URL('../docs/verification/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(`${base}?test=1`);
await page.waitForFunction(() => document.querySelector('#world')?.dataset.engine, null, { timeout: 60_000 });
await page.evaluate(() => window.__FOCUS_DRIVE_TEST__.start({
  mode: 'OTC_HIGH_FIDELITY', missionType: 'TRAINING', taskMode: 'DUAL', durationMs: 180_000,
  testHarness: true, challengeMode: true, roadLevel: 45, signLevel: 35,
}));
await page.locator('#countdown').waitFor({ state: 'detached', timeout: 45_000 });
await page.evaluate(() => {
  const api = window.__FOCUS_DRIVE_TEST__;
  const engine = api.getEngine();
  const seed = engine.config.seed;
  const phase = (((seed % 997) + 997) % 997) * 0.001;
  const center = (s) => Math.sin(s * 0.006 + phase) * 5.4 + Math.sin(s * 0.013 + phase * 0.7) * 1.8;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  window.__PLAY_MODE__ = 'skilled';
  window.__PLAY_LOG__ = { samples: [], pressErrors: [] };
  let lastPressed = null;
  api.setControl((snap) => {
    if (window.__PLAY_MODE__ === 'failing') return 0;
    const upcoming = snap.navEvents
      .filter((event) => !event.passed && event.atDistance > snap.progressS + 1 && event.atDistance < snap.progressS + 170)
      .sort((a, b) => a.atDistance - b.atDistance);
    const next = upcoming[0];
    let target = center(snap.progressS + 30);
    if (next) {
      const obstacleX = center(next.atDistance) + next.roadOffset;
      if (next.kind === 'OBSTACLE') {
        const side = Math.sign(next.roadOffset) || (Math.sign(snap.carX - obstacleX) || 1);
        target = obstacleX - side * (next.width / 2 + 0.8 + 0.55);
      } else target = obstacleX;
    }
    const desiredVx = clamp((target - snap.carX) * 3.2, -4.8, 4.8);
    return clamp((desiredVx - snap.carVX) * 2.2, -1, 1);
  });
  window.__PLAY_RESPONDER__ = setInterval(() => {
    if (window.__PLAY_MODE__ === 'failing') return;
    try {
      const snap = api.getSnapshot();
      if (!snap || snap.finished) return;
      const stimulus = snap.currentStimulus;
      if (!stimulus || !stimulus.visible || !stimulus.isTarget || lastPressed === stimulus.id) return;
      lastPressed = stimulus.id;
      api.getEngine().press(window.performance.now(), 'keyboard');
    } catch (error) { window.__PLAY_LOG__.pressErrors.push(String(error)); }
  }, 25);
  window.__PLAY_SAMPLER__ = setInterval(() => {
    const snap = api.getSnapshot();
    if (!snap) return;
    window.__PLAY_LOG__.samples.push({
      t: Math.round(snap.elapsedMs / 1000), mode: window.__PLAY_MODE__,
      road: snap.roadLevel, sign: snap.signLevel, nav: snap.navAccuracy, event: snap.eventAccuracy,
      drive: snap.driveScore, pace: Number(snap.paceFactor.toFixed(3)),
    });
  }, 5000);
});

const phases = [];
let phase = 'skilled';
for (;;) {
  const state = await page.evaluate(() => {
    const snap = window.__FOCUS_DRIVE_TEST__.getSnapshot();
    return snap ? { elapsed: snap.elapsedMs, finished: snap.finished, road: snap.roadLevel, sign: snap.signLevel, nav: snap.navAccuracy, event: snap.eventAccuracy } : null;
  });
  if (!state) break;
  if (state.elapsed >= 70_000 && phase === 'skilled') {
    phases.push({ phase: 'skilled', atMs: Math.round(state.elapsed), road: state.road, sign: state.sign, nav: state.nav, event: state.event });
    await page.screenshot({ path: new URL('difficulty-rising.png', output).pathname });
    await page.evaluate(() => { window.__PLAY_MODE__ = 'failing'; });
    phase = 'failing';
  } else if (state.elapsed >= 140_000 && phase === 'failing') {
    phases.push({ phase: 'failing', atMs: Math.round(state.elapsed), road: state.road, sign: state.sign, nav: state.nav, event: state.event });
    await page.screenshot({ path: new URL('difficulty-falling.png', output).pathname });
    await page.evaluate(() => { window.__PLAY_MODE__ = 'skilled'; });
    phase = 'recovered';
  }
  if (state.finished) break;
  await page.waitForTimeout(1_500);
}
await page.locator('.result-screen').waitFor({ timeout: 30_000 });
await page.screenshot({ path: new URL('difficulty-result.png', output).pathname });
const record = await page.evaluate(() => window.__FOCUS_DRIVE_TEST__.getRecord());
const log = await page.evaluate(() => {
  clearInterval(window.__PLAY_RESPONDER__); clearInterval(window.__PLAY_SAMPLER__); window.__FOCUS_DRIVE_TEST__.setControl(null);
  return window.__PLAY_LOG__;
});
const summary = {
  sampledAt: new Date().toISOString(), testHarness: true, challengeMode: true,
  durationMs: record?.elapsedMs, completed: record?.completed, quality: record?.summary?.measurementQuality,
  phases,
  finalLevels: { road: record?.finalRoadLevel, sign: record?.finalSignLevel },
  startLevels: { road: 45, sign: 35 },
  summary: record?.summary ? {
    navigationAccuracy: record.summary.navigationAccuracy,
    driveScore: record.summary.navigation.driveScore,
    eventSuccessRate: record.summary.navigation.eventSuccessRate,
    eventsPassed: record.summary.navigation.eventsPassed,
    eventsSucceeded: record.summary.navigation.eventsSucceeded,
    hitRate: record.summary.targeting.hitRate,
    targetingAccuracy: record.summary.targetingAccuracy,
    medianHitRt: record.summary.targeting.reactionTime.medianMs,
  } : null,
  adaptiveChanges: record?.adaptiveChanges?.map((c) => ({ t: Math.round(c.tMs / 1000), axis: c.axis, old: c.oldLevel, new: c.newLevel })) ?? [],
  samples: log.samples, pressErrors: log.pressErrors,
  coins: record?.coins, goals: record?.goals ?? [],
  pageErrors,
};
await writeFile(new URL('difficulty-play.json', output), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ phases, finalLevels: summary.finalLevels, summary: summary.summary, adaptiveChanges: summary.adaptiveChanges.slice(0, 6), lastChanges: summary.adaptiveChanges.slice(-6), pressErrors: summary.pressErrors, pageErrors, quality: summary.quality }, null, 2));
await browser.close();
