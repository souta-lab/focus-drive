import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { MissionEngine } from '../../src/core/engine';
import { generateSchedule } from '../../src/core/schedule';
import { roadCenter, steeringForce } from '../../src/core/road';
import { missionTokens, targetForTime } from '../../src/config/worlds';
import { normalizeConfig, RULES } from '../../src/config/rules';

const STEP = 1000 / 60;

/** A deliberately imperfect player: aims at events with noisy precision and misses some targets. */
function playImperfectly(engine: MissionEngine, options: { noiseM: number; hitChance: number; seconds: number; focus: number }): void {
  let seed = 987654321;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const gauss = () => { const u = Math.max(1e-9, random()), v = random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  let offset = 0; let nextOffsetAt = 0; let focusedEventId: string | null = null; let focused = false;
  let timestamp = 1000; let priorVisible: string | null = null;
  const total = Math.round(options.seconds * 1000 / STEP);
  // The host must acknowledge real presentation, exactly like main.ts does each rAF; without
  // it every trial would be invalidated and no target evidence could ever exist.
  const present = (snapshot: ReturnType<MissionEngine['snapshot'] extends never ? never : () => any> | any): void => {
    const stimulus = engine.snapshot.currentStimulus;
    if (priorVisible && (!stimulus?.visible || stimulus.id !== priorVisible)) engine.acknowledgeHidden(priorVisible, timestamp);
    if (stimulus?.visible) engine.acknowledgePresentation(stimulus.id, timestamp);
    priorVisible = stimulus?.visible ? stimulus.id : null;
  };
  present(engine.advance(0, 0, timestamp));
  for (let frame = 0; frame < total; frame++) {
    const snapshot = engine.snapshot;
    if (snapshot.elapsedMs >= nextOffsetAt) { offset = gauss() * options.noiseM; nextOffsetAt = snapshot.elapsedMs + 900; }
    const trial = snapshot.currentStimulus;
    if (trial && trial.isTarget && trial.visibleFrameTimestampMs !== null
      && timestamp - trial.visibleFrameTimestampMs >= 320 && random() < options.hitChance) {
      engine.press(timestamp, 'keyboard');
    }
    const upcoming = snapshot.navEvents
      .filter((event) => !event.passed && event.atDistance > snapshot.progressS - 2)
      .sort((a, b) => a.atDistance - b.atDistance)[0] ?? null;
    if (upcoming?.id !== focusedEventId) {
      focusedEventId = upcoming?.id ?? null;
      focused = !!upcoming && random() < options.focus;
    }
    const centre = roadCenter(snapshot.progressS, engine.config.seed);
    let target = centre;
    if (upcoming && focused) {
      const eventX = roadCenter(upcoming.atDistance, engine.config.seed) + upcoming.roadOffset;
      target = upcoming.kind === 'OBSTACLE'
        ? eventX - Math.sign(upcoming.roadOffset || 1) * (upcoming.width / 2 + 0.8 + 0.6)
        : eventX;
    }
    const desired = (target + offset - snapshot.carX) * 2.8;
    const steer = Math.max(-1, Math.min(1, (desired - snapshot.carVX) * 0.8));
    timestamp += STEP;
    engine.advance(STEP, steer, timestamp);
    present(snapshot);
    if (engine.snapshot.finished) break;
  }
}

describe('game feel: Guide reachability, pacing and high-speed steering', () => {
  it('lets an imperfect player capture Guides instead of scoring zero across a whole run', () => {
    // Full 180s mission, matching real play. Before the rebalance this exact profile captured
    // zero Guides; it now captures several.
    const engine = new MissionEngine({ mode: 'OTC_HIGH_FIDELITY', missionType: 'TRAINING', taskMode: 'DUAL', challengeMode: true, testHarness: true, durationMs: 180_000, seed: 4242 });
    playImperfectly(engine, { noiseM: 1.15, hitChance: 0.85, seconds: 180, focus: 0.85 });
    const record = engine.finish(true);
    expect(record.guideCaptures.length).toBeGreaterThanOrEqual(2);
    expect(record.guideCaptures.length).toBeLessThanOrEqual(15);
    expect(record.summary.navigation.accuracy!).toBeGreaterThan(0.85);
    expect(record.summary.navigation.eventSuccessRate!).toBeGreaterThan(0.55);
  });

  it('still refuses Guides for a player who only drives or only answers', () => {
    const drivingOnly = new MissionEngine({ mode: 'OTC_HIGH_FIDELITY', missionType: 'TRAINING', taskMode: 'DUAL', challengeMode: true, testHarness: true, durationMs: 90_000, seed: 4242 });
    let timestamp = 1000;
    for (let frame = 0; frame < Math.round(90_000 / STEP); frame++) {
      timestamp += STEP;
      drivingOnly.advance(STEP, 0, timestamp);
      if (drivingOnly.snapshot.finished) break;
    }
    expect(drivingOnly.finish(true).guideCaptures).toEqual([]);
  });

  it('keeps the published Classic cadence while the game profile is shorter and randomised', () => {
    const classic = generateSchedule(99, 180_000, 1 / 3, 'PUBLISHED');
    expect(classic).toHaveLength(72);
    for (const interval of [2000, 2500, 3000]) expect(classic.filter((trial) => trial.intervalMs === interval)).toHaveLength(24);

    const game = generateSchedule(99, 180_000, 1 / 3, 'GAME', [RULES.stimulus.otcMinIntervalMs, RULES.stimulus.otcMaxIntervalMs]);
    expect(game.length).toBeGreaterThan(72);
    for (const trial of game) {
      expect(trial.intervalMs).toBeGreaterThanOrEqual(RULES.stimulus.otcMinIntervalMs);
      expect(trial.intervalMs).toBeLessThanOrEqual(RULES.stimulus.otcMaxIntervalMs);
    }
    expect(new Set(game.map((trial) => trial.intervalMs)).size).toBeGreaterThan(40);
    expect(game).toEqual(generateSchedule(99, 180_000, 1 / 3, 'GAME', [RULES.stimulus.otcMinIntervalMs, RULES.stimulus.otcMaxIntervalMs]));
  });

  it('shortens the game display duration as the Sign level rises and leaves Classic at400ms', () => {
    const classic = new MissionEngine({ mode: 'NEURORACER_CLASSIC', taskMode: 'DUAL', seed: 3 });
    classic.advance(0, 0, 1000);
    expect(classic.snapshot.currentStimulus?.displayMs).toBe(400);

    const readDisplay = (signLevel: number): number => {
      const engine = new MissionEngine({ mode: 'OTC_HIGH_FIDELITY', missionType: 'TRAINING', taskMode: 'DUAL', challengeMode: true, testHarness: true, durationMs: 30_000, seed: 5, signLevel });
      engine.advance(0, 0, 1000);
      return engine.snapshot.currentStimulus!.displayMs;
    };
    const low = readDisplay(1); const high = readDisplay(54);
    expect(low).toBe(RULES.stimulus.otcDisplayMaxMs);
    expect(high).toBe(RULES.stimulus.otcDisplayMinMs);
    expect(low).toBeGreaterThan(high);
  });

  it('preserves steering authority well above the steepest curve demand at top speed', () => {
    const topSpeed = 87.67;
    const maxSlope = 3.0 * 0.006 + 1.0 * 0.013;
    const lateralAuthority = steeringForce(topSpeed, true) / 4;
    expect(lateralAuthority).toBeGreaterThan(topSpeed * maxSlope * 1.8);
    // Classic and the standard research profile keep the original fixed authority.
    expect(steeringForce(topSpeed, false)).toBe(18);
    expect(steeringForce(40, true)).toBe(18);
  });
});

describe('target variety while keeping the published rule structure', () => {
  it('rotates the designated token per mission in the published worlds', () => {
    const seen1 = new Set(Array.from({ length: 40 }, (_, i) => missionTokens(1, i).target.id));
    expect(seen1.size).toBe(3);
    const seen2 = new Set(Array.from({ length: 40 }, (_, i) => missionTokens(2, i).target.id));
    expect(seen2.size).toBe(6);
    for (const seed of [0, 1, 5, 17]) {
      const first = missionTokens(1, seed);
      expect(first.distractors).toHaveLength(2);
      expect([first.target, ...first.distractors].every((token) => token.shape === 'circle')).toBe(true);
      expect(new Set([first.target, ...first.distractors].map((token) => token.color)).size).toBe(3);
      const second = missionTokens(2, seed);
      expect(second.distractors).toHaveLength(5);
      expect(new Set([second.target, ...second.distractors].map((token) => token.shape)).size).toBe(6);
    }
  });
  it('keeps the inferred conjunction world fixed and the alternating world alternating', () => {
    expect(new Set(Array.from({ length: 12 }, (_, i) => missionTokens(3, i).target.id))).toEqual(new Set(['w3-mint-triangle']));
    expect(targetForTime(4, 29_999, 3)).not.toEqual(targetForTime(4, 30_000, 3));
    expect(targetForTime(4, 60_000, 3)).toEqual(targetForTime(4, 0, 3));
    expect(missionTokens(4, 0).alternate).toBeDefined();
  });
  it('scores against the token named in the brief, not a fixed default', () => {
    for (const seed of [0, 1, 2, 3, 4, 5]) {
      const engine = new MissionEngine({ mode: 'OTC_HIGH_FIDELITY', missionType: 'TRAINING', taskMode: 'DUAL', testHarness: true, durationMs: 40_000, seed, worldId: 1 });
      const expected = missionTokens(1, seed).target.id;
      // Trials only exist once the host has stepped and acknowledged presentation.
      let time = 1000; let prior: string | null = null;
      for (let frame = 0; frame < Math.round(40_000 / STEP); frame++) {
        time += STEP;
        const snapshot = engine.advance(STEP, 0, time);
        const stimulus = snapshot.currentStimulus;
        if (prior && (!stimulus?.visible || stimulus.id !== prior)) engine.acknowledgeHidden(prior, time);
        if (stimulus?.visible) engine.acknowledgePresentation(stimulus.id, time);
        prior = stimulus?.visible ? stimulus.id : null;
        if (snapshot.finished) break;
      }
      const targets = engine.finish(true).trials.filter((trial) => trial.isTarget);
      expect(targets.length).toBeGreaterThan(0);
      expect(new Set(targets.map((trial) => trial.stimulusId))).toEqual(new Set([expected]));
    }
  });
});

describe('offline service worker and the account API', () => {
  it('never caches API responses, which would pin a stale sign-in state', async () => {
    const source = await readFile(new URL('../../scripts/build-sw.mjs', import.meta.url), 'utf8');
    expect(source).toContain("pathname.startsWith('/api/')");
  });
});

describe('steady speed by default', () => {
  it('honours an explicit request for a fixed pace', () => {
    // Events build speed by default, but a player can switch that off in settings.
    expect(normalizeConfig({ challengeMode: true }).eventPaceEffects).toBe(true);
    expect(normalizeConfig({ challengeMode: true, eventPaceEffects: false }).eventPaceEffects).toBe(false);
    const engine = new MissionEngine({ mode: 'OTC_HIGH_FIDELITY', missionType: 'TRAINING', taskMode: 'DUAL', challengeMode: true, eventPaceEffects: false, testHarness: true, durationMs: 60_000, seed: 31, roadLevel: 40, signLevel: 30 });
    let time = 1000; let prior: string | null = null; const speeds = new Set<number>();
    for (let frame = 0; frame < Math.round(60_000 / STEP); frame++) {
      time += STEP;
      const snapshot = engine.advance(STEP, 1, time);
      speeds.add(Number(snapshot.paceFactor.toFixed(6)));
      const stimulus = snapshot.currentStimulus;
      if (prior && (!stimulus?.visible || stimulus.id !== prior)) engine.acknowledgeHidden(prior, time);
      if (stimulus?.visible) engine.acknowledgePresentation(stimulus.id, time);
      prior = stimulus?.visible ? stimulus.id : null;
      if (snapshot.finished) break;
    }
    const record = engine.finish(true);
    expect(record.navigationEvents.some((event) => event.passed)).toBe(true);
    expect([...speeds]).toEqual([1]);
  });
});

describe('steering assistance levels', () => {
  it('full assist holds the lane with zero input', () => {
    const engine = new MissionEngine({ mode: 'OTC_HIGH_FIDELITY', missionType: 'TRAINING', taskMode: 'DRIVE_ONLY', challengeMode: true, steeringAssist: 'full', testHarness: true, durationMs: 60_000, seed: 8, roadLevel: 60 });
    let time = 1000; let worst = 0;
    for (let frame = 0; frame < Math.round(60_000 / STEP); frame++) {
      time += STEP;
      const snapshot = engine.advance(STEP, 0, time);
      worst = Math.max(worst, Math.abs(snapshot.carX - snapshot.roadCenterX));
      if (snapshot.finished) break;
    }
    const record = engine.finish(true);
    // No input at all must stay inside the evaluation band rather than drifting to the rail.
    expect(worst).toBeLessThan(1.0);
    expect(record.summary.navigation.accuracy!).toBeGreaterThan(0.98);
  });

  it('default assist self-centres but still requires steering through curves', () => {
    // The design spec forbids full auto-follow as the default: the road must still be driven.
    expect(normalizeConfig({}).steeringAssist).toBe('center');
    const engine = new MissionEngine({ mode: 'OTC_HIGH_FIDELITY', missionType: 'TRAINING', taskMode: 'DRIVE_ONLY', challengeMode: true, testHarness: true, durationMs: 60_000, seed: 8, roadLevel: 60 });
    let time = 1000; let worst = 0;
    for (let frame = 0; frame < Math.round(60_000 / STEP); frame++) {
      time += STEP;
      const s = engine.advance(STEP, 0, time);
      worst = Math.max(worst, Math.abs(s.carX - s.roadCenterX));
      if (s.finished) break;
    }
    // It must not simply track the road for the player...
    expect(worst).toBeGreaterThan(1.2);
    // ...but releasing after a correction settles rather than drifting away for good.
    expect(Math.abs(engine.snapshot.carX - engine.snapshot.roadCenterX)).toBeLessThan(engine.snapshot.roadCenterX + 3.4);
  });

  it('still lets the driver move off-centre on purpose', () => {
    const engine = new MissionEngine({ mode: 'OTC_HIGH_FIDELITY', missionType: 'TRAINING', taskMode: 'DRIVE_ONLY', challengeMode: true, testHarness: true, durationMs: 20_000, seed: 8, roadLevel: 60 });
    let time = 1000;
    for (let frame = 0; frame < 240; frame++) { time += STEP; engine.advance(STEP, 1, time); }
    const held = engine.snapshot;
    expect(Math.abs(held.carX - held.roadCenterX)).toBeGreaterThan(1.0);
  });

  it('leaves Classic physics untouched', () => {
    // The assist is deliberately excluded from the reconstructed Classic profile.
    const classic = new MissionEngine({ mode: 'NEURORACER_CLASSIC', taskMode: 'DRIVE_ONLY', seed: 8 });
    expect(classic.config.steeringAssist).toBe('manual');
    let time = 1000; let worst = 0;
    for (let frame = 0; frame < 1800; frame++) { time += STEP; const s = classic.advance(STEP, 0, time); worst = Math.max(worst, Math.abs(s.carX - s.roadCenterX)); }
    expect(worst).toBeGreaterThan(1.5);
    expect(normalizeConfig({ mode: 'NEURORACER_CLASSIC', steeringAssist: 'full' }).steeringAssist).toBe('manual');
  });
});

describe('selectable mission lengths', () => {
  it('accepts the long drives for OTC, keeps Classic at180s and rejects arbitrary values', () => {
    for (const durationMs of [180_000, 600_000, 1_800_000]) {
      expect(normalizeConfig({ durationMs }).durationMs).toBe(durationMs);
    }
    // Anything else falls back to the standard run rather than silently honouring it.
    expect(normalizeConfig({ durationMs: 123_456 }).durationMs).toBe(180_000);
    // Classic ignores the request entirely: the published run is 180s.
    expect(normalizeConfig({ mode: 'NEURORACER_CLASSIC', durationMs: 600_000 }).durationMs).toBe(180_000);
    // The test harness may still ask for short runs.
    expect(normalizeConfig({ testHarness: true, durationMs: 5_000 }).durationMs).toBe(5_000);
  });

  it('runs a 10-minute mission with a matching event track and schedule', () => {
    const engine = new MissionEngine({ mode: 'OTC_HIGH_FIDELITY', missionType: 'TRAINING', taskMode: 'DUAL', durationMs: 600_000, seed: 4 });
    expect(engine.config.durationMs).toBe(600_000);
    const record = engine.finish(true);
    expect(record.config.durationMs).toBe(600_000);
    // Events and stimuli must cover the longer run, not stop at the 3-minute mark.
    const lastEvent = record.navigationEvents.at(-1)!;
    expect(lastEvent.atDistance).toBeGreaterThan(600 * 30);
  });
});
