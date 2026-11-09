import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
/** Compares the daylight and night lighting on the same run, since night was reported lighter. */
const base = process.env.FOCUS_DRIVE_URL || 'http://127.0.0.1:4173';
const output = new URL('../docs/verification/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox','--use-angle=gl-egl','--enable-gpu','--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const results = [];
for (const night of [false, true]) {
  await page.goto(`${base}/?test=1`);
  await page.waitForFunction(() => !!window.__FOCUS_DRIVE_TEST__?.getRenderer(), null, { timeout: 60_000 });
  await page.evaluate((nightDriving) => {
    const raw = JSON.parse(localStorage.getItem('focus-drive-settings') || '{}');
    localStorage.setItem('focus-drive-settings', JSON.stringify({ ...raw, nightDriving }));
  }, night);
  await page.reload();
  await page.waitForFunction(() => !!window.__FOCUS_DRIVE_TEST__?.getRenderer(), null, { timeout: 60_000 });
  await page.evaluate(async () => {
    const api = window.__FOCUS_DRIVE_TEST__;
    const road = await import('/src/core/road.ts');
    window.__perf = { frames: [], gpu: [], last: null };
    api.start({ mode: 'OTC_HIGH_FIDELITY', missionType: 'TRAINING', taskMode: 'DUAL', testHarness: true, durationMs: 40_000, challengeMode: true, roadLevel: 60, signLevel: 30, seed: 99 });
    api.setControl((snapshot, timestamp) => {
      const perf = window.__perf;
      if (perf.last !== null) perf.frames.push(timestamp - perf.last);
      perf.last = timestamp;
      const e = snapshot.navEvents.find((x) => !x.passed && x.atDistance >= snapshot.progressS);
      const centre = road.roadCenter(snapshot.progressS, api.getEngine().config.seed);
      const target = e ? road.roadCenter(e.atDistance, api.getEngine().config.seed) + e.roadOffset : centre;
      const d = (target - snapshot.carX) * 2.8;
      return Math.max(-1, Math.min(1, (d - snapshot.carVX) * 0.8));
    });
    window.__sampler = setInterval(() => { const s = api.getRendererStats(); const snap = api.getSnapshot(); if (s) window.__perf.gpu.push({ cpu: s.cpuFrameMs, calls: s.drawCalls, kmh: Math.round((snap?.forwardSpeed ?? 0) * 3.6) }); }, 400);
  });
  await page.waitForFunction(() => !!window.__FOCUS_DRIVE_TEST__?.getRecord(), null, { timeout: 180_000 });
  results.push(await page.evaluate((nightDriving) => {
    clearInterval(window.__sampler);
    const p = window.__perf;
    const frames = [...p.frames].sort((a, b) => a - b);
    const pick = (q) => frames[Math.min(frames.length - 1, Math.ceil(frames.length * q) - 1)] ?? null;
    const mean = (xs) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
    const record = window.__FOCUS_DRIVE_TEST__.getRecord();
    return { nightDriving, frames: frames.length, p50: pick(0.5), p95: pick(0.95), p99: pick(0.99), cpuMeanMs: mean(p.gpu.map((g) => g.cpu)), drawCalls: mean(p.gpu.map((g) => g.calls)), meanFps: record.performance?.meanFps ?? null, quality: record.summary.measurementQuality };
  }, night));
}
const result = { sampledAt: new Date().toISOString(), results };
await writeFile(new URL('night-vs-day.json', output), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
