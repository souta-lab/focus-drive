import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

/**
 * Third-audit follow-up: does OTC adaptive difficulty converge for a fixed-skill player?
 *
 * Each profile is a bot whose skill never changes:
 *   focus      - probability it actually lines up the next Power Zone / Gate / Obstacle
 *   reactionMs - fixed target reaction time (misses when the response window is shorter)
 * Because aiming at events pulls the car off centre while the evaluation band narrows with
 * level, a stronger bot pushes the level up until it can no longer do both tasks cleanly.
 * A converged controller stops moving the level and holds the observed accuracy near 80%.
 */
const base = process.env.FOCUS_DRIVE_URL || 'http://127.0.0.1:4173';
const durationMs = Number(process.env.FOCUS_DURATION_MS || 180_000);
const challengeMode = process.env.FOCUS_CHALLENGE !== '0';
const mode = process.env.FOCUS_MODE || 'OTC_HIGH_FIDELITY';
const profiles = (process.env.FOCUS_PROFILES || 'strong,mid,weak').split(',');
// noiseM is a human-like lateral aiming error, resampled about once a second. It is what
// makes a narrower evaluation band actually cost accuracy, which is the only way the
// controller can find an interior equilibrium instead of climbing to the ceiling.
const skill = {
  strong: { focus: 0.95, reactionMs: 250, jitterMs: 40, noiseM: 0.55 },
  mid: { focus: 0.80, reactionMs: 320, jitterMs: 65, noiseM: 1.15 },
  weak: { focus: 0.60, reactionMs: 400, jitterMs: 90, noiseM: 1.90 },
};
const output = new URL('../docs/verification/', import.meta.url);
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
await page.goto(`${base}/?test=1`);
await page.waitForFunction(() => !!window.__FOCUS_DRIVE_TEST__?.getRenderer(), null, { timeout: 60_000 });

const runs = [];
for (const [index, name] of profiles.entries()) {
  const profile = skill[name] ?? skill.mid;
  const previousId = await page.evaluate(() => window.__FOCUS_DRIVE_TEST__.getRecord()?.id ?? null);
  await page.evaluate(async ({ profile, durationMs, challengeMode, mode, seedBase }) => {
    const api = window.__FOCUS_DRIVE_TEST__;
    const road = await import('/src/core/road.ts');
    let seed = seedBase;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
    const state = { focusedEventId: null, focused: false, sent: new Set(), samples: [], reaction: 0, nextReactionAt: 0, seenEvents: 0, focusedEvents: 0, aimNoise: 0, nextAimAt: 0 };
    window.__conv = state;
    api.start({ mode, missionType: 'TRAINING', taskMode: 'DUAL', testHarness: true, challengeMode, durationMs, seed: seedBase });
    api.setControl((snapshot, timestamp) => {
      const engine = api.getEngine();
      const elapsed = snapshot.elapsedMs;
      if (elapsed >= state.nextReactionAt) { state.reaction = profile.reactionMs + Math.abs(rand() * 2 - 1) * profile.jitterMs; state.nextReactionAt = elapsed + 2500; }
      if (elapsed >= state.nextAimAt) {
        const gauss = () => { const u = Math.max(1e-9, rand()), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
        state.aimNoise = gauss() * profile.noiseM; state.nextAimAt = elapsed + 950;
      }
      const trial = snapshot.currentStimulus;
      if (trial?.isTarget && trial.visibleFrameTimestampMs !== null && !state.sent.has(trial.id)
        && timestamp - trial.visibleFrameTimestampMs >= state.reaction) {
        engine.press(timestamp, 'bot'); state.sent.add(trial.id);
      }
      const centre = road.roadCenter(snapshot.progressS, engine.config.seed);
      const upcoming = snapshot.navEvents
        .filter(event => !event.passed && event.atDistance > snapshot.progressS - 2)
        .sort((a, b) => a.atDistance - b.atDistance)[0] ?? null;
      if (upcoming?.id !== state.focusedEventId) {
        state.focusedEventId = upcoming?.id ?? null;
        state.focused = !!upcoming && rand() < profile.focus;
        if (upcoming) { state.seenEvents++; if (state.focused) state.focusedEvents++; }
      }
      let target = centre;
      if (upcoming && state.focused) {
        const eventX = road.roadCenter(upcoming.atDistance, engine.config.seed) + upcoming.roadOffset;
        target = upcoming.kind === 'OBSTACLE'
          ? eventX - Math.sign(upcoming.roadOffset || 1) * (upcoming.width / 2 + 0.8 + 0.6)
          : eventX;
      }
      const future = road.roadCenter(snapshot.progressS + snapshot.forwardSpeed * 0.2, engine.config.seed);
      const desired = (future - centre) / 0.2 + (target + state.aimNoise - snapshot.carX) * 2.8;
      return Math.max(-1, Math.min(1, (desired * 4 + (desired - snapshot.carVX) * 5) / 18));
    });
    state.sampler = setInterval(() => {
      const snapshot = api.getSnapshot();
      if (!snapshot || snapshot.finished) return;
      state.samples.push({
        t: Math.round(snapshot.elapsedMs / 1000), road: snapshot.roadLevel, sign: snapshot.signLevel,
        path: snapshot.navAccuracy, event: snapshot.eventAccuracy, drive: snapshot.driveScore, target: snapshot.targetAccuracy,
      });
    }, 2000);
  }, { profile, durationMs, challengeMode, mode, seedBase: 777 + index * 1013 });

  await page.waitForFunction((previous) => {
    const record = window.__FOCUS_DRIVE_TEST__.getRecord();
    return !!record && record.id !== previous;
  }, previousId, { timeout: durationMs + 150_000 });
  // `finishMission` publishes the record before it awaits persistence and switches to the
  // result view; starting the next mission inside that window would be cancelled by it.
  await page.waitForSelector('.result-screen', { timeout: 20_000 });
  await page.waitForTimeout(600);

  const run = await page.evaluate(() => {
    clearInterval(window.__conv.sampler);
    window.__FOCUS_DRIVE_TEST__.setControl(null);
    const record = window.__FOCUS_DRIVE_TEST__.getRecord();
    return {
      samples: window.__conv.samples,
      seenEvents: window.__conv.seenEvents,
      focusedEvents: window.__conv.focusedEvents,
      record: {
        id: record.id, elapsedMs: record.elapsedMs, quality: record.summary.measurementQuality,
        finalRoadLevel: record.finalRoadLevel, finalSignLevel: record.finalSignLevel,
        changes: record.adaptiveChanges.map(change => ({ t: Math.round(change.tMs / 1000), axis: change.axis, from: change.oldLevel, to: change.newLevel })),
        navigation: record.summary.navigation, targetingAccuracy: record.summary.targetingAccuracy,
      },
    };
  });

  const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const std = (values) => { if (values.length < 2) return null; const m = mean(values); return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length); };
  const metricOf = (sample) => challengeMode ? sample.drive : sample.path;
  const tail = run.samples.filter(sample => sample.t >= durationMs / 1000 - 60);
  const observed = tail.map(metricOf).filter(value => value !== null);
  const roadTail = tail.map(sample => sample.road);
  const changesTail = run.record.changes.filter(change => change.t >= durationMs / 1000 - 60);
  const climb = run.record.changes.filter(change => change.axis === 'ROAD' && change.t <= durationMs / 1000 - 60).length;

  runs.push({
    profile: name, skill: profile, quality: run.record.quality,
    botLineup: { seenEvents: run.seenEvents, focusedEvents: run.focusedEvents },
    finalLevels: { road: run.record.finalRoadLevel, sign: run.record.finalSignLevel },
    totalChanges: run.record.changes.length, changesInLast60s: changesTail.length,
    last60s: {
      observedAccuracyMean: mean(observed), observedAccuracyStd: std(observed),
      roadLevelStd: std(roadTail), roadRange: roadTail.length ? [Math.min(...roadTail), Math.max(...roadTail)] : null,
      samples: tail.length,
    },
    measured: { path: run.record.navigation.accuracy, event: run.record.navigation.eventSuccessRate, drive: run.record.navigation.driveScore, target: run.record.targetingAccuracy, levelChangesBeforeLast60s: climb },
    trajectory: run.samples.filter((_, i) => i % 5 === 0).map(sample => ({ t: sample.t, road: sample.road, sign: sample.sign, drive: sample.drive === null ? null : Number(sample.drive.toFixed(3)), path: sample.path === null ? null : Number(sample.path.toFixed(3)) })),
  });
  console.log(`[${name}] R${run.record.finalRoadLevel}/T${run.record.finalSignLevel} changes=${run.record.changes.length} last60s drive=${(mean(observed) ?? -1).toFixed(3)} std=${(std(observed) ?? -1).toFixed(3)} roadRange=${JSON.stringify(runs.at(-1).last60s.roadRange)}`);
}
const result = { sampledAt: new Date().toISOString(), durationMs, challengeMode, mode, runs, pageErrors };
await writeFile(new URL('convergence.json', output), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ mode, challengeMode, summary: runs.map(({ profile, finalLevels, totalChanges, changesInLast60s, last60s, measured, botLineup, quality }) => ({ profile, finalLevels, totalChanges, changesInLast60s, last60s, measured, botLineup, quality })), pageErrors }, null, 2));
await browser.close();
