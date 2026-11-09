import { describe, expect, it } from 'vitest';
import { calculateSummary, compositeIndex, multitaskCost, navigation80Threshold, normalInverseCDF, targetingMetrics } from '../../src/core/metrics';
import { fixtureRecord, trial } from './helpers';
import type { TaskSummary } from '../../src/core/types';

describe('raw confusion, loglinear d-prime and hit-only reaction times', () => {
  it('corrects extreme0%/100% rates to finite d-prime and excludes invalid trials', () => {
    const good = targetingMetrics([trial('HIT', true, 0), trial('CORRECT_REJECTION', false, 1), trial('INVALID_PRESENTATION', true, 2)]);
    expect(good.validTrials).toBe(2); expect(good.invalid).toBe(1); expect(good.accuracy).toBe(1);
    expect(good.dPrime).toBeCloseTo(1.3489795, 5);
    const bad = targetingMetrics([trial('MISS', true), trial('FALSE_ALARM', false)]); expect(bad.dPrime).toBeCloseTo(-1.3489795, 5);
    expect(targetingMetrics([]).dPrime).toBeNull(); expect(targetingMetrics([]).accuracy).toBeNull(); expect(normalInverseCDF(0.5)).toBe(0);
  });
  it('RT summary includes only HIT, never false alarms/misses/invalids', () => {
    const metric = targetingMetrics([trial('HIT', true, 0, 200), trial('HIT', true, 1, 400), trial('FALSE_ALARM', false, 2, 10), trial('MISS', true, 3), trial('INVALID_PRESENTATION', true, 4)]);
    expect(metric.reactionTime).toEqual({ count: 2, meanMs: 300, medianMs: 300, p90Ms: 380, varianceMs2: 10000 });
    expect(metric.hits).toBe(2); expect(metric.misses).toBe(1); expect(metric.falseAlarms).toBe(1); expect(metric.correctRejections).toBe(0);
  });
  it('reconstructs summaries from raw logs and does not use stored rounded values', () => {
    const record = fixtureRecord(); expect(calculateSummary(record)).toEqual(record.summary);
    record.summary.targetingAccuracy = 0; expect(calculateSummary(record).targetingAccuracy).toBe(1);
  });
});
describe('Navigation80 monotonic model and uncertainty', () => {
  it('pools non-monotonic observations using weighted decreasing isotonic regression', () => {
    const threshold = navigation80Threshold([{ level: 20, accuracy: 0.95, weight: 100 }, { level: 40, accuracy: 0.65, weight: 100 }, { level: 60, accuracy: 0.7, weight: 100 }]);
    expect(threshold.fitted[1]?.accuracy).toBeCloseTo(0.675); expect(threshold.fitted[2]?.accuracy).toBeCloseTo(0.675);
    expect(threshold.estimate).toBeGreaterThan(20); expect(threshold.estimate).toBeLessThan(40);
    expect(threshold.lower).toBeLessThanOrEqual(threshold.estimate!); expect(threshold.upper).toBeGreaterThanOrEqual(threshold.estimate!);
    expect(threshold.sampleCount).toBe(300); expect(threshold.confidence).toBe('HIGH');
  });
  it('reports low-confidence censored boundaries and does not invent evidence from empty data', () => {
    expect(navigation80Threshold([]).estimate).toBeNull();
    expect(navigation80Threshold([{ level: 20, accuracy: 1, weight: 5 }]).estimate).toBeNull();
    const censored = navigation80Threshold([{ level: 20, accuracy: 1, weight: 30 }]);
    expect(censored.estimate).toBe(20); expect(censored.confidence).toBe('LOW'); expect(censored.upper).toBe(200);
  });
});
function task(mode: TaskSummary['taskMode'], hits: number, misses: number, falseAlarms: number, correct: number, nav = 0.9): TaskSummary {
  const events = [...Array.from({ length: hits }, (_, i) => trial('HIT', true, i)), ...Array.from({ length: misses }, (_, i) => trial('MISS', true, 100 + i)), ...Array.from({ length: falseAlarms }, (_, i) => trial('FALSE_ALARM', false, 200 + i)), ...Array.from({ length: correct }, (_, i) => trial('CORRECT_REJECTION', false, 300 + i))];
  return { taskMode: mode, targeting: targetingMetrics(events), navigation: { accuracy: nav, validTimeMs: 60000, insideTimeMs: 60000 * nav, meanAbsError: 0, p95AbsError: 0, eventSuccessRate: null, eventsPassed: 0, eventsSucceeded: 0, driveScore: nav } };
}
describe('paired multitasking cost guards', () => {
  it('gives N/A for missing, unmatched, near-zero/negative or unstable single-task baseline', () => {
    const dual = task('DUAL', 18, 2, 2, 18);
    expect(multitaskCost(undefined, dual).costPct).toBeNull();
    expect(multitaskCost(task('SIGN_ONLY', 10, 10, 10, 10), dual).costPct).toBeNull();
    expect(multitaskCost(task('SIGN_ONLY', 5, 15, 15, 5), dual).costPct).toBeNull();
    expect(multitaskCost(task('SIGN_ONLY', 18, 2, 2, 18), dual, undefined, false).costPct).toBeNull();
    const cost = multitaskCost(task('SIGN_ONLY', 18, 2, 2, 18), dual);
    expect(cost.costPct).toBeCloseTo(0); expect(cost.confidenceInterval).not.toBeNull();
  });
  it('never labels targeting gain as global improvement if road was sacrificed', () => {
    const cost = multitaskCost(task('SIGN_ONLY', 17, 3, 3, 17), task('DUAL', 19, 1, 1, 19, 0.7), task('DRIVE_ONLY', 0, 0, 0, 0, 0.95));
    expect(cost.dPrimeDifference).toBeGreaterThan(0); expect(cost.roadAccuracyDifference).toBeCloseTo(-0.25); expect(cost.roadTradeoff).toBe(true);
  });
});
describe('estimated robust, World×Mission-adjusted composite', () => {
  it('requires3 validDual missions, bounds score and exposes method/provenance', () => {
    expect(compositeIndex([fixtureRecord()]).score).toBeNull();
    const records = Array.from({ length: 15 }, (_, i) => {
      const record = fixtureRecord(`record-${i}`, { worldId: i < 8 ? 1 : 2, missionType: i % 3 === 0 ? 'CHALLENGE' : 'TRAINING' });
      record.navigationSamples.forEach((sample) => { sample.roadLevel += i; });
      const dual = record.summary.byTask.find((entry) => entry.taskMode === 'DUAL')!; dual.targeting.reactionTime.medianMs = i === 14 ? 1 : 400 - i * 5; dual.targeting.dPrime = 1 + i * 0.1;
      return record;
    });
    const composite = compositeIndex(records);
    expect(composite.missionCount).toBe(15); expect(composite.estimated).toBe(true);
    expect(composite.score).toBeGreaterThanOrEqual(0); expect(composite.score).toBeLessThanOrEqual(100);
    expect(composite.submetrics?.speed).toBeGreaterThanOrEqual(0); expect(composite.submetrics?.speed).toBeLessThanOrEqual(100);
    expect(composite.trend).not.toBeNull(); expect(composite.method).toBe('estimated-robust-world-mission-v1');
  });
  it('excludes single-task and invalid measurements rather than pooling tasks', () => {
    const records = [fixtureRecord('1'), fixtureRecord('2'), fixtureRecord('3')];
    records[0]!.summary.byTask = records[0]!.summary.byTask.filter((entry) => entry.taskMode !== 'DUAL');
    records[1]!.measurementInvalid = true;
    expect(compositeIndex(records).missionCount).toBe(1); expect(compositeIndex(records).score).toBeNull();
  });
});
