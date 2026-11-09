import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

/**
 * Third-audit follow-up: measure real-GPU renderer cost.
 * Samples PlayCanvas draw calls / primitives / frame time, plus host rAF frame times,
 * while a full mission runs. Software GPU numbers are flagged, never claimed as 60 FPS.
 */
const base = process.env.FOCUS_DRIVE_URL || 'http://127.0.0.1:4173';
const durationMs = Number(process.env.FOCUS_DURATION_MS || 60_000);
const output = new URL('../docs/verification/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
await page.goto(`${base}/?test=1`);
await page.waitForFunction(() => !!window.__FOCUS_DRIVE_TEST__?.getRenderer(), null, { timeout: 60_000 });

const gpu = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) ?? null, maxTexture: gl?.getParameter(gl.MAX_TEXTURE_SIZE) ?? null };
});

await page.evaluate(async (duration) => {
  const api = window.__FOCUS_DRIVE_TEST__;
  const road = await import('/src/core/road.ts');
  window.__perf = { frames: [], gpu: [], lastFrame: null, sent: new Set() };
  api.start({ mode: 'OTC_HIGH_FIDELITY', missionType: 'TRAINING', taskMode: 'DUAL', testHarness: true, challengeMode: true, durationMs: duration, roadLevel: 45, signLevel: 35 });
  api.setControl((snapshot, timestamp) => {
    const perf = window.__perf;
    if (perf.lastFrame !== null) perf.frames.push(timestamp - perf.lastFrame);
    perf.lastFrame = timestamp;
    const trial = snapshot.currentStimulus;
    if (trial?.isTarget && trial.visibleFrameTimestampMs !== null && timestamp - trial.visibleFrameTimestampMs >= 180 && !perf.sent.has(trial.id)) {
      api.getEngine().press(timestamp, 'bot'); perf.sent.add(trial.id);
    }
    const upcoming = snapshot.navEvents.find(event => !event.passed && event.atDistance >= snapshot.progressS);
    const offset = upcoming ? (upcoming.kind === 'OBSTACLE' ? (upcoming.roadOffset >= 0 ? -1.8 : 1.8) : upcoming.roadOffset) : 0;
    const centre = road.roadCenter(snapshot.progressS, api.getEngine().config.seed);
    const future = road.roadCenter(snapshot.progressS + snapshot.forwardSpeed * 0.2, api.getEngine().config.seed);
    const desired = (future - centre) / 0.2 + (centre + offset - snapshot.carX) * 2.3;
    return Math.max(-1, Math.min(1, (desired * 4 + (desired - snapshot.carVX) * 5) / 18));
  });
  window.__perfSampler = setInterval(() => {
    const stats = api.getRendererStats();
    const snapshot = api.getSnapshot();
    if (stats) window.__perf.gpu.push({ t: Math.round((snapshot?.elapsedMs ?? 0) / 1000), ...stats, pose: snapshot?.progressS ? Math.round(snapshot.progressS) : 0 });
  }, 500);
}, durationMs);

await page.waitForFunction(() => !!window.__FOCUS_DRIVE_TEST__?.getRecord(), null, { timeout: durationMs + 120_000 });
const measured = await page.evaluate(() => {
  clearInterval(window.__perfSampler);
  window.__FOCUS_DRIVE_TEST__.setControl(null);
  const perf = window.__perf;
  const frames = [...perf.frames].sort((a, b) => a - b);
  const pick = (p) => frames[Math.min(frames.length - 1, Math.ceil(frames.length * p) - 1)] ?? null;
  const calls = perf.gpu.map(sample => sample.drawCalls);
  const ms = perf.gpu.map(sample => sample.cpuFrameMs).filter(value => value > 0);
  const engineFps = perf.gpu.map(sample => sample.fps).filter(value => value > 0);
  const record = window.__FOCUS_DRIVE_TEST__.getRecord();
  const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return {
    frameCount: frames.length,
    hostFrame: { p50: pick(0.5), p95: pick(0.95), p99: pick(0.99), max: frames.at(-1) ?? null },
    hostFps: frames.length ? 1000 / (frames.reduce((sum, value) => sum + value, 0) / frames.length) : null,
    renderer: {
      samples: perf.gpu.length,
      drawCalls: { min: Math.min(...calls), max: Math.max(...calls), mean: mean(calls) },
      cpuFrameMs: { mean: mean(ms), max: ms.length ? Math.max(...ms) : null },
      engineFps: { min: engineFps.length ? Math.min(...engineFps) : null, mean: mean(engineFps) },
      pixelRatio: perf.gpu[0]?.pixelRatio ?? null,
    },
    mission: { elapsedMs: record.elapsedMs, quality: record.summary.measurementQuality, level: record.finalRoadLevel, frames: record.performance?.frameCount ?? null, meanFps: record.performance?.meanFps ?? null },
    samples: perf.gpu.filter((_, index) => index % 8 === 0),
  };
});
await page.screenshot({ path: new URL('frame-cost-mission.png', output).pathname });
const result = { sampledAt: new Date().toISOString(), url: base, durationMs, gpu, ...measured, pageErrors };
await writeFile(new URL('frame-cost.json', output), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ gpu: result.gpu, hostFrame: result.hostFrame, hostFps: result.hostFps, renderer: result.renderer, mission: result.mission, pageErrors }, null, 2));
await browser.close();
