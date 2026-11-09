import { describe, expect, it } from 'vitest';
import { MissionEngine } from '../../src/core/engine';
import { generateSchedule } from '../../src/core/schedule';
import { RULES } from '../../src/config/rules';
import { calculateSummary, performanceMetrics } from '../../src/core/metrics';
import { advanceTo, runEngine } from './helpers';

const targetSeed = Array.from({ length: 100 }, (_, seed) => seed).find((seed) => generateSchedule(seed)[0]!.isTarget)!;
function firstTarget(signLevel = 29): MissionEngine {
  const engine = new MissionEngine({ seed: targetSeed, mode: 'NEURORACER_CLASSIC', taskMode: 'SIGN_ONLY', signLevel });
  const stimulus = engine.advance(0, 0, 1000).currentStimulus!;
  expect(stimulus.isTarget).toBe(true); engine.acknowledgePresentation(stimulus.id, 1000);
  return engine;
}
describe('presentation-acknowledged Go/No-Go state machine', () => {
  it('hides at400ms but accepts a450ms response in500ms window', () => {
    const engine = firstTarget(); const id = engine.snapshot.currentStimulus!.id;
    expect(advanceTo(engine, 399).currentStimulus?.visible).toBe(true);
    expect(advanceTo(engine, 400).currentStimulus?.visible).toBe(false);
    engine.acknowledgeHidden(id, 1400);
    advanceTo(engine, 450); engine.press(1450, 'keyboard');
    const record = engine.finish(true);
    expect(record.trials[0]?.outcome).toBe('HIT'); expect(record.trials[0]?.reactionTimeMs).toBe(450);
    expect(record.trials[0]?.displayMs).toBe(400); expect(record.trials[0]?.responseWindowMs).toBe(500);
    expect(record.trials[0]?.hiddenFrameTimestampMs).toBe(1400);
  });
  it('accepts exact response boundary and rejects just outside it', () => {
    const onBoundary = firstTarget(); advanceTo(onBoundary, 500); onBoundary.press(1500, 'keyboard');
    expect(onBoundary.finish(true).trials[0]?.outcome).toBe('HIT');
    const outside = firstTarget(); advanceTo(outside, 501); outside.press(1501, 'keyboard');
    const record = outside.finish(true);
    expect(record.trials[0]?.outcome).toBe('MISS'); expect(record.inputs[0]?.outcome).toBe('PREMATURE'); expect(record.inputs[0]?.trialId).toBeNull();
  });
  it('has250ms response window independent of400ms visibility at level54', () => {
    const engine = firstTarget(54); advanceTo(engine, 251); engine.press(1251, 'touch');
    expect(engine.snapshot.currentStimulus?.visible).toBe(true);
    const record = engine.finish(true); expect(record.trials[0]?.outcome).toBe('MISS'); expect(record.inputs[0]?.outcome).toBe('LATE');
  });
  it('never double scores repeats and never attributes blank presses to past trials', () => {
    const engine = firstTarget(); engine.press(1150, 'keyboard'); engine.press(1160, 'keyboard');
    advanceTo(engine, 1200); engine.press(2200, 'keyboard');
    const record = engine.finish(true);
    expect(record.summary.targeting.hits).toBe(1); expect(record.inputs.map((event) => event.outcome)).toEqual(['HIT','REPEATED','PREMATURE']);
    expect(record.inputs[2]?.trialId).toBeNull();
  });
  it('does not silently score unacknowledged or missed presentations as rejection/miss', () => {
    const engine = new MissionEngine({ testHarness: true, durationMs: 10000, taskMode: 'SIGN_ONLY' });
    const record = runEngine(engine, { acknowledge: false, targets: false });
    expect(record.trials.length).toBeGreaterThan(0);
    expect(record.trials.every((trial) => trial.outcome === 'INVALID_PRESENTATION')).toBe(true);
    expect(record.summary.targeting.validTrials).toBe(0); expect(record.summary.targeting.correctRejections).toBe(0);
    expect(record.measurementInvalid).toBe(true);
  });
  it('uses acknowledged frame as RT origin, recording actual onset lag', () => {
    const engine = new MissionEngine({ seed: targetSeed, taskMode: 'SIGN_ONLY' });
    const snapshot = engine.advance(20, 0, 1020); engine.acknowledgePresentation(snapshot.currentStimulus!.id, 1020); engine.press(1220, 'bot');
    const record = engine.finish(true);
    expect(record.performanceOriginMs).toBe(1000); expect(record.trials[0]?.scheduledTimestampMs).toBe(1000);
    expect(record.trials[0]?.onsetDelayMs).toBe(20); expect(record.trials[0]?.reactionTimeMs).toBe(200);
  });
  it('retains false alarms separately from hit RT and scored once', () => {
    const seed = Array.from({ length: 100 }, (_, value) => value).find((value) => !generateSchedule(value)[0]!.isTarget)!;
    const engine = new MissionEngine({ seed, taskMode: 'SIGN_ONLY' });
    const stimulus = engine.advance(0, 0, 1000).currentStimulus!; engine.acknowledgePresentation(stimulus.id, 1000);
    engine.press(1100, 'touch'); engine.press(1110, 'touch');
    const record = engine.finish(true);
    expect(record.summary.targeting.falseAlarms).toBe(1); expect(record.summary.targeting.reactionTime.count).toBe(0);
  });
});
describe('fixed-step navigation, measurement quality and lifecycle', () => {
  it('60/120/144Hz produce identical driving samples and elapsed-time accuracy', () => {
    const records = [60,120,144].map((hz) => runEngine(new MissionEngine({ mode: 'NEURORACER_CLASSIC', taskMode: 'DRIVE_ONLY', seed: 77 }), { hz, drive: false, stopAtMs: 10000 }));
    expect(records[0]!.navigationSamples).toHaveLength(600);
    expect(records[1]!.navigationSamples).toEqual(records[0]!.navigationSamples);
    expect(records[2]!.navigationSamples).toEqual(records[0]!.navigationSamples);
    expect(records[2]!.summary.navigationAccuracy).toBe(records[0]!.summary.navigationAccuracy);
  });
  it('Classic levels do not adapt midrun, then change only after180s completion', () => {
    const engine = new MissionEngine({ mode: 'NEURORACER_CLASSIC', taskMode: 'DUAL', seed: 7 });
    const record = runEngine(engine);
    expect(record.trials).toHaveLength(72);
    expect(record.trials.filter((trial) => trial.isTarget)).toHaveLength(24);
    expect(new Set(record.navigationSamples.map((sample) => sample.roadLevel))).toEqual(new Set([20]));
    expect(new Set(record.trials.map((trial) => trial.signLevel))).toEqual(new Set([29]));
    expect(record.adaptiveChanges.every((change) => change.tMs === 180000)).toBe(true);
    expect(record.finalSignLevel).toBeGreaterThan(29);
    expect(record.summary).toEqual(calculateSummary(record));
  });
  it('Classic overall achievement reward requires both tasks above80%', () => {
    const record = runEngine(new MissionEngine({ mode: 'NEURORACER_CLASSIC', taskMode: 'DUAL', seed: 7 }), { targets: false });
    expect(record.summary.navigationAccuracy).toBeGreaterThan(0.8); expect(record.summary.targetingAccuracy).toBeLessThan(0.8); expect(record.coins.completion).toBe(0);
  });
  it('early finish is aborted, idempotent and cannot fabricate completed time', () => {
    const engine = new MissionEngine({ taskMode: 'DRIVE_ONLY' }); engine.advance(16, 0, 1016);
    const record = engine.finish(); expect(record.completed).toBe(false); expect(record.aborted).toBe(true); expect(record.elapsedMs).toBe(16);
    expect(engine.finish()).toEqual(record); engine.advance(10000, 0, 11016); expect(engine.finish()).toEqual(record);
    record.coins.total = 1000000; expect(engine.finish().coins.total).not.toBe(1000000);
  });
  it('long frame and hidden tab are severe; background time is not Mission Minutes', () => {
    const engine = firstTarget(); engine.flagQuality('tab-hidden'); engine.advance(1500, 0, 2500);
    const record = engine.finish(true);
    expect(record.measurementInvalid).toBe(true); expect(record.trials[0]?.outcome).toBe('INVALID_PRESENTATION');
    expect(record.playedMs).toBe(0); expect(record.qualityFlags.some((flag) => flag.reason.startsWith('long-frame'))).toBe(true);
  });
  it('exports actual rAF gaps and counts long frames in FPS but excludes them from played measurement', () => {
    const engine = new MissionEngine({ taskMode: 'DRIVE_ONLY' });
    engine.advance(0, 0, 1000);
    engine.advance(50, 0, 1050);
    engine.advance(1000, 0, 2050);
    engine.advance(50, 0, 2100);
    // The host delta differs from the actual rAF gap: FPS must use timestamps.
    engine.advance(10, 0, 2120);
    const record = engine.finish(true);
    expect(record.frameTimings).toEqual([
      { timestampMs: 1050, tMs: 50, deltaMs: 50, measurementValid: true },
      { timestampMs: 2050, tMs: 1050, deltaMs: 1000, measurementValid: false },
      { timestampMs: 2100, tMs: 1100, deltaMs: 50, measurementValid: true },
      { timestampMs: 2120, tMs: 1110, deltaMs: 20, measurementValid: true },
    ]);
    expect(record.performance?.frameCount).toBe(4); expect(record.performance?.longFrameCount).toBe(1);
    expect(record.performance?.meanFps).toBeCloseTo(4000 / 1120);
    expect(record.performance?.p95FrameMs).toBeCloseTo(857.5); expect(record.performance?.p99FrameMs).toBeCloseTo(971.5);
    expect(record.playedMs).toBe(110); expect(record.summary.navigation.validTimeMs).toBeCloseTo(100);
    expect(record.performance).toEqual(performanceMetrics(record.frameTimings!));
    // One stalled frame is excluded from measurement, not a reason to void the whole mission.
    // The earlier behaviour turned a single 1s hitch into an INVALID run, which players read as
    // "the game ended by itself and nothing counted".
    expect(record.measurementInvalid).toBe(false);
    expect(record.qualityFlags.map((flag) => flag.reason)).toContain('long-frame>=1000ms');
    expect(record.qualityFlags.every((flag) => !flag.severe)).toBe(true);
  });
  it('still voids a run when unmeasurable time dominates it', () => {
    const engine = new MissionEngine({ testHarness: true, durationMs: 10_000, taskMode: 'DRIVE_ONLY' });
    engine.advance(0, 0, 1000);
    // ~5.5s of stalls out of 10s: past the 5s floor and the 10% share.
    for (let i = 1; i <= 5; i++) engine.advance(1100, 0, 1000 + i * 1100);
    engine.advance(50, 0, 6600);
    const record = engine.finish(true);
    expect(record.summary.measurementQuality).toBe('INVALID');
    expect(record.measurementInvalid).toBe(true);
  });
  it('omits synthetic pause tails, paused frames, and the full manual-pause gap from FPS', () => {
    const engine = new MissionEngine({ taskMode: 'DRIVE_ONLY' });
    engine.advance(0, 0, 1000); engine.advance(20, 0, 1020);
    engine.pause(1025); // Five played milliseconds, but not an actual rAF.
    engine.advance(10000, 0, 11025); // Ignored while paused.
    engine.resume(11025); engine.advance(0, 0, 11040); // New rAF anchor, no paused gap.
    engine.advance(20, 0, 11060);
    const record = engine.finish(true);
    expect(record.frameTimings).toEqual([
      { timestampMs: 1020, tMs: 20, deltaMs: 20, measurementValid: true },
      { timestampMs: 11060, tMs: 45, deltaMs: 20, measurementValid: true },
    ]);
    expect(record.performance).toEqual({ meanFps: 50, p95FrameMs: 20, p99FrameMs: 20, frameCount: 2, longFrameCount: 0 });
    expect(record.playedMs).toBe(45); expect(record.qualityFlags.some((flag) => flag.severe)).toBe(false);
    const empty = new MissionEngine({ taskMode: 'DRIVE_ONLY' }).finish(true);
    expect(empty.performance).toEqual({ meanFps: null, p95FrameMs: null, p99FrameMs: null, frameCount: 0, longFrameCount: 0 });
  });
  it('manual pause discards only the active trial, excludes pause duration and shifts onset clock', () => {
    const engine = firstTarget(); engine.pause(1100); expect(engine.snapshot.paused).toBe(true);
    engine.advance(5000, 0, 6100); expect(engine.snapshot.elapsedMs).toBe(100);
    engine.resume(6100); expect(engine.snapshot.paused).toBe(false);
    for (let t = 1000 / 60; t <= 3500; t += 1000 / 60) {
      const state = engine.advance(1000 / 60, 0, 6100 + t);
      if (state.currentStimulus?.visible) engine.acknowledgePresentation(state.currentStimulus.id, 6100 + t);
    }
    const record = engine.finish(true);
    expect(record.trials[0]?.outcome).toBe('INVALID_PRESENTATION');
    expect(record.qualityFlags.some((flag) => flag.severe)).toBe(false);
    expect(record.pauses).toEqual([{ startedTimestampMs: 1100, endedTimestampMs: 6100 }]);
    expect(record.playedMs).toBeCloseTo(record.elapsedMs);
    expect(record.trials[1]?.onsetDelayMs).toBeLessThanOrEqual(1000 / 60 + 1e-5);
    expect(Date.parse(record.endedAt) - Date.parse(record.startedAt)).toBeCloseTo(record.elapsedMs + 5000, 0);
  });
  it('reanchors a host first resumed delta0 without stale presentation drift', () => {
    const engine = firstTarget(); engine.pause(1100); engine.resume(11100); engine.advance(0, 0, 11116);
    for (let i = 1; i <= 300; i++) {
      const state = engine.advance(1000 / 60, 0, 11116 + i * 1000 / 60);
      if (state.currentStimulus?.visible) engine.acknowledgePresentation(state.currentStimulus.id, 11116 + i * 1000 / 60);
    }
    const record = engine.finish(true);
    expect(record.trials.slice(1).every((trial) => trial.visibleFrameTimestampMs !== null)).toBe(true);
    expect(record.trials.slice(1).every((trial) => (trial.onsetDelayMs ?? Infinity) <= 1000 / 60 + 1e-5)).toBe(true);
    expect(record.qualityFlags.some((flag) => flag.severe)).toBe(false);
  });
  it('production Baseline captures all three independent60s task blocks', () => {
    const engine = new MissionEngine({ missionType: 'BASELINE', seed: 9 }); const record = runEngine(engine, { hz: 30 });
    expect(record.completed).toBe(true);
    for (const mode of ['DRIVE_ONLY','SIGN_ONLY','DUAL']) expect(record.navigationSamples.filter((sample) => sample.taskMode === mode)).toHaveLength(3600);
    expect(record.trials.every((trial) => trial.taskMode !== 'DRIVE_ONLY')).toBe(true);
    expect(record.summary.byTask.map((task) => task.taskMode)).toEqual(['DRIVE_ONLY','SIGN_ONLY','DUAL']);
    expect(record.summary.navigation.validTimeMs).toBeCloseTo(120000, 4);
    expect(record.playedMs).toBeCloseTo(180000, 4);
  });
});
describe('automatic Guide both-task gate', () => {
  it('captures through approach/lock with real target+navigation evidence', () => {
    const record = runEngine(new MissionEngine({ testHarness: true, durationMs: 60000, seed: 11 }));
    expect(record.guideCaptures.length).toBeGreaterThan(0);
    // Guide eligibility is deliberately reachable for a human: first approach 7s, 1.8s approach,
    // then a 2.6s lock held while both tasks stay valid.
    const earliest = RULES.guide.firstApproachMs + RULES.guide.approachMs + RULES.guide.baseLockMs;
    expect(record.guideCaptures[0]!.tMs).toBeGreaterThanOrEqual(earliest);
    expect(record.coins.guides).toBe(record.guideCaptures.length * 25);
    expect(record.navigationEvents.filter((event) => event.passed).map((event) => event.kind)).toEqual(expect.arrayContaining(['POWER_ZONE','GATE','OBSTACLE']));
  });
  it.each([{ targets: false }, { drive: false }])('cannot be farmed by succeeding at only one task %s', (options) => {
    const record = runEngine(new MissionEngine({ testHarness: true, durationMs: 40000, seed: 11 }), options);
    expect(record.guideCaptures).toEqual([]);
  });
  it('requires minimum target evidence and stops at15 Guides in a world', () => {
    const short = runEngine(new MissionEngine({ testHarness: true, durationMs: 15000, seed: 11 })); expect(short.guideCaptures).toEqual([]);
    const capped = runEngine(new MissionEngine({ testHarness: true, durationMs: 60000, seed: 11, guidesCollected: 14 }));
    expect(capped.guideCaptures).toHaveLength(1); expect(capped.guideCaptures[0]?.ordinal).toBe(15);
    const single = runEngine(new MissionEngine({ testHarness: true, durationMs: 30000, seed: 11, taskMode: 'SIGN_ONLY' })); expect(single.guideCaptures).toEqual([]);
  });
});
