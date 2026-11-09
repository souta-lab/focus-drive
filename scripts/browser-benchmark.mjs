import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.FOCUS_DRIVE_URL || 'http://127.0.0.1:4173';
const durationMs = Number(process.env.FOCUS_DURATION_MS || 180000);
const output = new URL('../docs/verification/', import.meta.url);
await mkdir(output, { recursive: true });
const gpuArgs = ['--no-sandbox', '--enable-webgl', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: gpuArgs });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`${base}/?test=1`);
  await page.waitForFunction(() => !!window.__FOCUS_DRIVE_TEST__?.getRenderer(), null, { timeout: 60_000 });
  await page.screenshot({ path: new URL('hub.png', output).pathname, fullPage: true });
  await page.evaluate(async (duration) => {
    const diagnostic = window.__FOCUS_DRIVE_TEST__;
    const road = await import('/src/core/road.ts');
    window.__benchmark = { frameDeltas: [], lastFrame: null, sent: new Set(), maxGuideProgress: 0, phases: new Set() };
    diagnostic.start({ mode: 'OTC_HIGH_FIDELITY', missionType: 'TRAINING', taskMode: 'DUAL', seed: 20261018, testHarness: true, durationMs: duration });
    diagnostic.setControl((s, timestamp) => {
      const b = window.__benchmark;
      if (b.lastFrame !== null) b.frameDeltas.push(timestamp - b.lastFrame);
      b.lastFrame = timestamp;
      b.phases.add(s.guide.phase); b.maxGuideProgress = Math.max(b.maxGuideProgress, s.guide.progress);
      const trial = s.currentStimulus;
      if (trial?.isTarget && trial.visibleFrameTimestampMs !== null && timestamp - trial.visibleFrameTimestampMs >= 180 && !b.sent.has(trial.id)) {
        diagnostic.getEngine().press(timestamp, 'bot'); b.sent.add(trial.id);
      }
      const upcoming = s.navEvents.find(e => !e.passed && e.atDistance - s.progressS < 65 && e.atDistance >= s.progressS);
      let offset = 0;
      if (upcoming) {
        if (upcoming.kind === 'OBSTACLE') offset = upcoming.roadOffset >= 0 ? -1.8 : 1.8;
        else offset = upcoming.roadOffset;
      }
      const center = road.roadCenter(s.progressS, 20261018);
      const future = road.roadCenter(s.progressS + s.forwardSpeed * 0.2, 20261018);
      const desiredVelocity = (future - center) / .2 + (center + offset - s.carX) * 2.3;
      return Math.max(-1, Math.min(1, (desiredVelocity * 4 + (desiredVelocity - s.carVX) * 5) / 18));
    });
  }, durationMs);
  await page.waitForFunction(() => (window.__FOCUS_DRIVE_TEST__?.getSnapshot()?.elapsedMs ?? 0) >= 15000, null, { timeout: 35_000 });
  await page.screenshot({ path: new URL('mission.png', output).pathname });
  await page.waitForFunction(() => !!window.__FOCUS_DRIVE_TEST__?.getRecord(), null, { timeout: 240_000 });
  await page.screenshot({ path: new URL('result.png', output).pathname, fullPage: true });
  const data = await page.evaluate(() => {
    const r = window.__FOCUS_DRIVE_TEST__.getRecord();
    const b = window.__benchmark;
    const sorted = [...b.frameDeltas].sort((a, b) => a - b);
    const percentile = p => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? null;
    const display = r.trials.filter(t => t.hiddenFrameTimestampMs !== null && t.visibleFrameTimestampMs !== null).map(t => t.hiddenFrameTimestampMs - t.visibleFrameTimestampMs);
    const onset = r.trials.map(t => t.onsetDelayMs).filter(x => x !== null).sort((a,b) => a-b);
    return {
      sampledAt: new Date().toISOString(), environment: { userAgent: navigator.userAgent, viewport: `${innerWidth}x${innerHeight}`, webglRenderer: (() => { try { const gl = document.createElement('canvas').getContext('webgl2'); const ext = gl?.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) ?? null; } catch { return null; } })() },
      elapsedMs: r.elapsedMs, playedMs: r.playedMs, completed: r.completed, aborted: r.aborted, testHarness: r.config.testHarness,
      frameCount: sorted.length, meanFps: sorted.length * 1000 / sorted.reduce((a,b)=>a+b,0), frameP95Ms: percentile(.95), frameP99Ms: percentile(.99),
      trials: r.trials.length, trialOutcomes: r.trials.reduce((a,t) => { a[t.outcome] = (a[t.outcome] ?? 0)+1; return a; }, {}),
      stimulusDisplayMs: { count: display.length, min: Math.min(...display), max: Math.max(...display), mean: display.reduce((a,b)=>a+b,0)/display.length },
      onsetDelayMs: { max: onset.at(-1), p95: onset[Math.ceil(onset.length*.95)-1] },
      summary: r.summary, guides: r.guideCaptures.length, guidePhases: [...b.phases], maxGuideProgress: b.maxGuideProgress,
      adaptationChanges: r.adaptiveChanges, qualityFlags: r.qualityFlags, coins: r.coins,
      storageCompletedMissions: window.__FOCUS_DRIVE_TEST__.getProfile().completedMissions,
    };
  });
  data.pageErrors = errors;
  await writeFile(new URL('browser-benchmark.json', output), `${JSON.stringify(data, null, 2)}\n`);
  console.log(JSON.stringify(data, null, 2));
} finally { await browser.close(); }
