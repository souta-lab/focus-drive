import { hasDrive, hasTarget, RULES } from '../config/rules';
import type { CompositeIndex, FrameTiming, MissionRecord, MissionSummary, MultitaskCost, NavigationEvent, NavigationMetrics, NavigationSample, NavigationThreshold, PerformanceSummary, QualityFlag, StimulusEvent, TargetMetrics, TaskMode, TaskSummary, ThresholdObservation } from './types';

export function quantile(values: readonly number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(1, fraction)) * (sorted.length - 1);
  const low = Math.floor(index); const high = Math.ceil(index);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (index - low);
}
/** FPS is total rendered intervals / actual interval time, not an average of instantaneous FPS. */
export function performanceMetrics(frameTimings: readonly FrameTiming[]): PerformanceSummary {
  const gaps = frameTimings.map((frame) => frame.deltaMs).filter((gap) => Number.isFinite(gap) && gap > 0);
  const totalMs = gaps.reduce((sum, gap) => sum + gap, 0);
  return { meanFps: totalMs ? 1000 * gaps.length / totalMs : null,
    p95FrameMs: quantile(gaps, 0.95), p99FrameMs: quantile(gaps, 0.99),
    frameCount: gaps.length, longFrameCount: gaps.filter((gap) => gap >= RULES.longFrameMs).length };
}
/** Acklam inverse-normal approximation, finite after the specified half-trial correction. */
export function normalInverseCDF(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  if (p < 0.02425 || p > 1 - 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p < 0.5 ? p : 1 - p));
    const value = (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
    return p < 0.5 ? value : -value;
  }
  const q = p - 0.5; const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}
export function targetingMetrics(trials: readonly StimulusEvent[]): TargetMetrics {
  const count = (outcome: StimulusEvent['outcome']): number => trials.filter((trial) => trial.outcome === outcome).length;
  const hits = count('HIT'); const misses = count('MISS'); const falseAlarms = count('FALSE_ALARM'); const correctRejections = count('CORRECT_REJECTION');
  const invalid = count('INVALID_PRESENTATION');
  const targetTrials = hits + misses; const nonTargetTrials = falseAlarms + correctRejections; const validTrials = targetTrials + nonTargetTrials;
  const hitRate = targetTrials ? hits / targetTrials : null; const falseAlarmRate = nonTargetTrials ? falseAlarms / nonTargetTrials : null;
  const hitRTs = trials.filter((trial) => trial.outcome === 'HIT' && trial.reactionTimeMs !== null && trial.reactionTimeMs >= 0).map((trial) => trial.reactionTimeMs!);
  const mean = hitRTs.length ? hitRTs.reduce((sum, value) => sum + value, 0) / hitRTs.length : null;
  return { hits, misses, falseAlarms, correctRejections, invalid, validTrials, targetTrials, nonTargetTrials,
    hitRate, falseAlarmRate, accuracy: validTrials ? (hits + correctRejections) / validTrials : null,
    dPrime: targetTrials && nonTargetTrials ? normalInverseCDF((hits + 0.5) / (targetTrials + 1)) - normalInverseCDF((falseAlarms + 0.5) / (nonTargetTrials + 1)) : null,
    reactionTime: { count: hitRTs.length, meanMs: mean, medianMs: quantile(hitRTs, 0.5), p90Ms: quantile(hitRTs, 0.9), varianceMs2: mean === null ? null : hitRTs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / hitRTs.length },
  };
}
export const DRIVE_PATH_WEIGHT = 0.55;
/** Game-only composite. The research metric (`accuracy`) keeps measuring path holding alone. */
export function blendDriveScore(pathAccuracy: number | null, eventSuccessRate: number | null): number | null {
  if (pathAccuracy === null && eventSuccessRate === null) return null;
  if (eventSuccessRate === null) return pathAccuracy;
  if (pathAccuracy === null) return eventSuccessRate;
  return DRIVE_PATH_WEIGHT * pathAccuracy + (1 - DRIVE_PATH_WEIGHT) * eventSuccessRate;
}
export function navigationMetrics(samples: readonly NavigationSample[], events: readonly NavigationEvent[] = []): NavigationMetrics {
  const valid = samples.filter((sample) => sample.measurementValid && hasDrive(sample.taskMode));
  const validTimeMs = valid.reduce((sum, sample) => sum + sample.dtMs, 0);
  const insideTimeMs = valid.reduce((sum, sample) => sum + (sample.insideRoad ? sample.dtMs : 0), 0);
  const passed = events.filter((event) => event.passed && event.success !== null);
  const eventsSucceeded = passed.filter((event) => event.success).length;
  const accuracy = validTimeMs ? insideTimeMs / validTimeMs : null;
  const eventSuccessRate = passed.length ? eventsSucceeded / passed.length : null;
  return { accuracy, validTimeMs, insideTimeMs,
    meanAbsError: validTimeMs ? valid.reduce((sum, sample) => sum + Math.abs(sample.lateralOffset) * sample.dtMs, 0) / validTimeMs : null,
    p95AbsError: quantile(valid.map((sample) => Math.abs(sample.lateralOffset)), 0.95),
    eventSuccessRate, eventsPassed: passed.length, eventsSucceeded, driveScore: blendDriveScore(accuracy, eventSuccessRate) };
}
function wilson(p: number, n: number): [number, number] {
  if (n <= 0) return [0, 1];
  const z = 1.96; const denominator = 1 + z * z / n;
  const mid = (p + z * z / (2 * n)) / denominator;
  const radius = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
  return [Math.max(0, mid - radius), Math.min(1, mid + radius)];
}
/** Weighted decreasing PAVA. Weight is independent valid seconds, NOT rendered frames. */
export function navigation80Threshold(observations: readonly ThresholdObservation[]): NavigationThreshold {
  const groups = new Map<number, { success: number; weight: number }>();
  for (const point of observations) {
    if (!Number.isFinite(point.level) || !Number.isFinite(point.accuracy) || point.weight <= 0 || point.accuracy < 0 || point.accuracy > 1) continue;
    const level = Math.max(1, Math.min(200, point.level)); const prior = groups.get(level) ?? { success: 0, weight: 0 };
    prior.success += point.accuracy * point.weight; prior.weight += point.weight; groups.set(level, prior);
  }
  const rows = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([level, x]) => ({ level, accuracy: x.success / x.weight, weight: x.weight }));
  const blocks: { start: number; end: number; success: number; weight: number }[] = [];
  rows.forEach((point, index) => {
    blocks.push({ start: index, end: index, success: point.accuracy * point.weight, weight: point.weight });
    while (blocks.length >= 2) {
      const b = blocks[blocks.length - 1]!; const a = blocks[blocks.length - 2]!;
      if (a.success / a.weight >= b.success / b.weight) break;
      blocks.splice(blocks.length - 2, 2, { start: a.start, end: b.end, success: a.success + b.success, weight: a.weight + b.weight });
    }
  });
  const fitted = rows.map((point) => ({ ...point }));
  for (const block of blocks) for (let i = block.start; i <= block.end; i++) fitted[i]!.accuracy = block.success / block.weight;
  const sampleCount = rows.reduce((sum, point) => sum + point.weight, 0);
  const empty: NavigationThreshold = { estimate: null, lower: null, upper: null, sampleCount, confidence: 'LOW', method: 'weighted-isotonic-80-v1', fitted };
  if (!rows.length || sampleCount < 10) return empty;
  const cross = (points: { level: number; accuracy: number }[]): number => {
    if (points[0]!.accuracy < 0.8) return points[0]!.level;
    for (let i = 1; i < points.length; i++) {
      const left = points[i - 1]!; const right = points[i]!;
      if (right.accuracy <= 0.8 && left.accuracy >= 0.8) return left.accuracy === right.accuracy ? (left.level + right.level) / 2 : left.level + (right.level - left.level) * (left.accuracy - 0.8) / (left.accuracy - right.accuracy);
    }
    return points[points.length - 1]!.level;
  };
  const estimate = cross(fitted);
  const lowCurve = fitted.map((point) => ({ level: point.level, accuracy: wilson(point.accuracy, point.weight)[0] }));
  const highCurve = fitted.map((point) => ({ level: point.level, accuracy: wilson(point.accuracy, point.weight)[1] }));
  const bracketed = fitted.length >= 2 && fitted[0]!.accuracy >= 0.8 && fitted[fitted.length - 1]!.accuracy <= 0.8;
  const lower = lowCurve[0]!.accuracy < 0.8 ? 1 : cross(lowCurve);
  const upper = highCurve[highCurve.length - 1]!.accuracy > 0.8 ? 200 : cross(highCurve);
  return { ...empty, estimate, lower: Math.min(lower, estimate), upper: Math.max(upper, estimate), confidence: bracketed && fitted.length >= 3 && sampleCount >= 120 ? 'HIGH' : bracketed && sampleCount >= 60 ? 'MODERATE' : 'LOW' };
}
function dPrimeVariance(metric: TargetMetrics): number {
  const h = (metric.hits + 0.5) / (metric.targetTrials + 1); const f = (metric.falseAlarms + 0.5) / (metric.nonTargetTrials + 1);
  const density = (p: number): number => Math.exp(-(normalInverseCDF(p) ** 2) / 2) / Math.sqrt(2 * Math.PI);
  return h * (1 - h) / ((metric.targetTrials + 1) * density(h) ** 2) + f * (1 - f) / ((metric.nonTargetTrials + 1) * density(f) ** 2);
}
export function multitaskCost(signOnly: TaskSummary | undefined, dual: TaskSummary | undefined, driveOnly?: TaskSummary, matchingConditions = true): MultitaskCost {
  const sign = signOnly?.targeting; const multi = dual?.targeting;
  const difference = sign?.dPrime !== null && sign?.dPrime !== undefined && multi?.dPrime !== null && multi?.dPrime !== undefined ? multi.dPrime - sign.dPrime : null;
  const roadDifference = dual?.navigation.accuracy !== null && dual?.navigation.accuracy !== undefined && driveOnly?.navigation.accuracy !== null && driveOnly?.navigation.accuracy !== undefined ? dual.navigation.accuracy - driveOnly.navigation.accuracy : null;
  let reason: string | null = null;
  if (!matchingConditions) reason = 'World, difficulty, or display conditions do not match';
  else if (!sign || !multi || difference === null) reason = 'Paired single-task and dual evidence required';
  else if (sign.targetTrials < 8 || sign.nonTargetTrials < 8 || multi.targetTrials < 8 || multi.nonTargetTrials < 8) reason = 'Insufficient paired target/non-target evidence';
  else if (sign.dPrime! <= 0.2) reason = 'Single-task d-prime is near zero or non-positive';
  const variance = sign && multi && difference !== null ? dPrimeVariance(sign) + dPrimeVariance(multi) : null;
  const confidenceInterval: [number, number] | null = variance !== null && difference !== null ? [difference - 1.96 * Math.sqrt(variance), difference + 1.96 * Math.sqrt(variance)] : null;
  if (!reason && sign && sign.dPrime! - 1.96 * Math.sqrt(dPrimeVariance(sign)) <= 0) reason = 'Single-task d-prime denominator is unstable';
  return { costPct: reason || !sign || difference === null ? null : 100 * difference / sign.dPrime!, dPrimeDifference: difference, roadAccuracyDifference: roadDifference, confidenceInterval, reason, roadTradeoff: roadDifference !== null && roadDifference < 0 };
}
export interface RawMetricInput {
  trials: readonly StimulusEvent[]; navigationSamples: readonly NavigationSample[]; navigationEvents: readonly NavigationEvent[];
  qualityFlags: readonly QualityFlag[]; measurementInvalid?: boolean;
  /** Play time spent in frames too long to measure. */
  invalidMs?: number; elapsedMs?: number;
}
/** A run survives brief stalls; it is voided only when unmeasurable time is a real share of it. */
export const INVALID_TIME_FRACTION = 0.1;
export const INVALID_TIME_FLOOR_MS = 5000;
export function calculateSummary(raw: RawMetricInput): MissionSummary {
  const targetTrials = raw.trials.filter((trial) => hasTarget(trial.taskMode));
  const targeting = targetingMetrics(targetTrials); const navigation = navigationMetrics(raw.navigationSamples, raw.navigationEvents);
  const observations = raw.navigationSamples.filter((sample) => sample.measurementValid && hasDrive(sample.taskMode)).map((sample) => ({ level: sample.roadLevel, accuracy: sample.insideRoad ? 1 : 0, weight: sample.dtMs / 1000 }));
  const threshold = navigation80Threshold(observations);
  const modes: TaskMode[] = ['DRIVE_ONLY', 'SIGN_ONLY', 'DUAL', 'DRIVE_WITH_SIGNS', 'SIGN_WITH_ROAD'];
  const byTask = modes.filter((mode) => raw.trials.some((trial) => trial.taskMode === mode) || raw.navigationSamples.some((sample) => sample.taskMode === mode)).map((taskMode): TaskSummary => ({ taskMode,
    targeting: targetingMetrics(hasTarget(taskMode) ? raw.trials.filter((trial) => trial.taskMode === taskMode) : []),
    navigation: navigationMetrics(raw.navigationSamples.filter((sample) => sample.taskMode === taskMode), raw.navigationEvents.filter((event) => event.passedAtMs !== null && raw.navigationSamples.some((sample) => sample.taskMode === taskMode && Math.abs(sample.tMs - event.passedAtMs!) < sample.dtMs / 2))),
  }));
  const single = raw.trials.filter((trial) => trial.taskMode === 'SIGN_ONLY' && trial.outcome !== 'INVALID_PRESENTATION');
  const dual = raw.trials.filter((trial) => trial.taskMode === 'DUAL' && trial.outcome !== 'INVALID_PRESENTATION');
  // Do not compare differently weighted mixtures of adaptive levels as if paired.
  const reference = single[0];
  const conditions = !!reference && dual.length > 0 && [...single, ...dual].every((trial) => trial.signLevel === reference.signLevel && trial.responseWindowMs === reference.responseWindowMs && trial.displayMs === reference.displayMs);
  const cost = multitaskCost(byTask.find((x) => x.taskMode === 'SIGN_ONLY'), byTask.find((x) => x.taskMode === 'DUAL'), byTask.find((x) => x.taskMode === 'DRIVE_ONLY'), conditions);
  const closed = targetTrials.filter((trial) => trial.outcome !== null).length;
  const invalidBudget = Math.max(INVALID_TIME_FLOOR_MS, (raw.elapsedMs ?? 0) * INVALID_TIME_FRACTION);
  const invalid = raw.measurementInvalid || raw.qualityFlags.some((flag) => flag.severe)
    || (raw.invalidMs ?? 0) > invalidBudget
    || (closed > 0 && targeting.invalid / closed > RULES.maxInvalidTrialFraction);
  return { totalValidTrials: targeting.validTrials, hitRate: targeting.hitRate, falseAlarmRate: targeting.falseAlarmRate, targetingAccuracy: targeting.accuracy, dPrime: targeting.dPrime,
    hitReactionTimeMedianMs: targeting.reactionTime.medianMs, navigationAccuracy: navigation.accuracy, navigation80Threshold: threshold.estimate,
    multitaskingCostPct: cost.costPct, measurementQuality: invalid ? 'INVALID' : raw.qualityFlags.length || targeting.invalid > 0 || targeting.validTrials < 16 || navigation.validTimeMs < 20_000 ? 'LIMITED' : 'GOOD',
    targeting, navigation, threshold, byTask, multitaskCost: cost, metricVersion: RULES.metricVersion };
}
function solve(matrix: number[][], vector: number[]): number[] {
  const n = vector.length; const a = matrix.map((row, i) => [...row, vector[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const divisor = Math.abs(a[col]![col]!) < 1e-12 ? 1e-12 : a[col]![col]!;
    for (let j = col; j <= n; j++) a[col]![j] = a[col]![j]! / divisor;
    for (let row = 0; row < n; row++) if (row !== col) { const factor = a[row]![col]!; for (let j = col; j <= n; j++) a[row]![j] = a[row]![j]! - factor * a[col]![j]!; }
  }
  return a.map((row) => row[n]!);
}
/** Estimated local regression/normalization. Never presented as the commercial Focus Score. */
export function compositeIndex(records: readonly MissionRecord[]): CompositeIndex {
  const rows = records.map((record, i) => {
    const dual = record.summary.byTask.find((task) => task.taskMode === 'DUAL');
    const nav = navigation80Threshold(record.navigationSamples.filter((sample) => sample.taskMode === 'DUAL' && sample.measurementValid).map((sample) => ({ level: sample.roadLevel, accuracy: sample.insideRoad ? 1 : 0, weight: sample.dtMs / 1000 })));
    const rt = dual?.targeting.reactionTime.medianMs;
    return { record, order: i + 1, nav: nav.estimate, speed: rt && rt > 0 ? 1000 / rt : null, selectivity: dual?.targeting.dPrime ?? null };
  }).filter((row) => row.record.completed && !row.record.measurementInvalid && row.record.summary.measurementQuality !== 'INVALID' && row.nav !== null && row.speed !== null && row.selectivity !== null);
  const explanation = '推定の独自指標。Dualのみ／World×Mission×Challenge設定補正＋log学習項維持／1.5 IQR winsorize／中央値・IQR正規化／logistic境界／Target2次元ノルム。メーカーの基準分布・係数とは未照合。';
  const empty: CompositeIndex = { score: null, missionCount: rows.length, submetrics: null, firstScore: null, change: null, trend: null, method: 'estimated-robust-world-mission-v1', estimated: true, explanation };
  if (rows.length < 3) return empty;
  const conditionKey = (record: MissionRecord): string =>
    `${record.config.worldId}:${record.config.missionType}:${record.config.challengeMode === true ? 'high' : 'standard'}`;
  const conditions = [...new Set(rows.map((row) => conditionKey(row.record)))];
  const design = rows.map((row) => [1, Math.log(row.order), ...conditions.slice(1).map((condition) => condition === conditionKey(row.record) ? 1 : 0)]);
  const adjust = (values: number[]): number[] => {
    const dimension = design[0]!.length;
    const matrix = Array.from({ length: dimension }, (_, i) => Array.from({ length: dimension }, (_, j) => design.reduce((sum, row) => sum + row[i]! * row[j]!, 0) + (i === j ? 1e-3 : 0)));
    const vector = Array.from({ length: dimension }, (_, i) => design.reduce((sum, row, index) => sum + row[i]! * values[index]!, 0));
    const beta = solve(matrix, vector);
    const effects = design.map((row) => row.slice(2).reduce((sum, x, index) => sum + x * beta[index + 2]!, 0));
    const average = effects.reduce((sum, value) => sum + value, 0) / effects.length;
    return values.map((value, index) => value - effects[index]! + average);
  };
  const scale = (values: number[]): number[] => {
    const adjusted = adjust(values); const q1 = quantile(adjusted, 0.25)!; const q3 = quantile(adjusted, 0.75)!; const iqr = q3 - q1;
    const winsorized = adjusted.map((value) => Math.max(q1 - 1.5 * iqr, Math.min(q3 + 1.5 * iqr, value)));
    const center = quantile(winsorized, 0.5)!; const spread = quantile(winsorized, 0.75)! - quantile(winsorized, 0.25)!;
    return winsorized.map((value) => spread <= 1e-9 ? 0.5 : 1 / (1 + Math.exp(-Math.max(-8, Math.min(8, (value - center) / spread)))));
  };
  const nav = scale(rows.map((row) => row.nav!)); const speed = scale(rows.map((row) => row.speed!)); const selectivity = scale(rows.map((row) => row.selectivity!));
  const scores = nav.map((value, i) => 100 * (value + Math.hypot(speed[i]!, selectivity[i]!) / Math.SQRT2) / 2);
  const xs = rows.map((row) => Math.log(row.order)); const xbar = xs.reduce((s, x) => s + x, 0) / xs.length; const ybar = scores.reduce((s, y) => s + y, 0) / scores.length;
  const denominator = xs.reduce((s, x) => s + (x - xbar) ** 2, 0);
  const slope = denominator ? xs.reduce((s, x, i) => s + (x - xbar) * (scores[i]! - ybar), 0) / denominator : 0;
  const intercept = ybar - slope * xbar;
  const last = scores.length - 1; const score = scores[last]!;
  return { ...empty, score, submetrics: { navigation: nav[last]! * 100, speed: speed[last]! * 100, selectivity: selectivity[last]! * 100 }, firstScore: intercept, change: score - intercept, trend: { intercept, slope } };
}
