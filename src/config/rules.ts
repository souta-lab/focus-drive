import type { MissionConfig, SessionConfig, TaskMode } from '../core/types';

export const RULES = {
  fixedStepMs: 1000 / 60,
  missionDurationMs: 180_000,
  /** Selectable long-drive lengths for the OTC game modes; Classic stays at the published 180s. */
  selectableDurationsMs: [180_000, 600_000, 1_800_000] as const,
  displayMs: 400,
  stimulusIntervalsMs: [2000, 2500, 3000] as const,
  initialRoadLevel: 20,
  initialSignLevel: 29,
  roadLevelCount: 200,
  signLevelCount: 54,
  lowerDeadband: 0.775,
  upperDeadband: 0.825,
  signPercentPerLevel: 1.75,
  roadPercentPerLevel: 0.58,
  maxSignStep: 10,
  maxRoadStep: 20,
  minTargets: 8,
  minNonTargets: 8,
  minNavValidFraction: 0.9,
  continuous: { samplingMs: 1000, navWindowMs: 20_000, targetWindowMs: 30_000, targetMinTrials: 8, sameAxisCooldownMs: 10_000, stepCap: 1 },
  /**
   * Guide eligibility. These are game-balance values, not published protocol numbers:
   * a real player must be able to capture a Guide while doing both tasks. The earlier
   * numbers (8s of 88% path holding + 80% hit rate + 75% event success) were effectively
   * unreachable for a human, so two full plays could yield zero Guides.
   */
  guide: { firstApproachMs: 7000, approachMs: 1800, baseLockMs: 2600, addedLockMs: 150, cooldownMs: 4500, minimumTargetTrials: 6, minimumTargets: 2, minimumNonTargets: 2, recentWindowMs: 30_000, minimumNavMs: 4000, minAccuracy: 0.72, lockRange: 3.6, decayPerSecond: 0.18, challengeMinNavAccuracy: 0.8, challengeMinEventRate: 0.55 },
  /**
   * Game-only stimulus pacing. Classic keeps the published 400ms display and the exact
   * 2/2.5/3s cadence; the high-challenge OTC profile shortens and randomises both.
   */
  stimulus: { otcMinIntervalMs: 1400, otcMaxIntervalMs: 2600, otcDisplayMaxMs: 520, otcDisplayMinMs: 300 },
  maxInvalidTrialFraction: 0.1,
  maxPresentationDelayMs: 100,
  longFrameMs: 1000,
  frameDropMs: 50,
  minimumTrainingMissions: 5,
  guidesPerWorld: 15,
  missionsPerIndex: 15,
  dailyMissionMinuteGoal: 10,
  algorithmVersion: 'focus-drive-reconstruction-1.0',
  metricVersion: 'raw-v1-loglinear-half-trial-isotonic80',
} as const;
export const hasDrive = (mode: TaskMode): boolean => mode === 'DUAL' || mode === 'DRIVE_ONLY' || mode === 'DRIVE_WITH_SIGNS';
export const hasTarget = (mode: TaskMode): boolean => mode === 'DUAL' || mode === 'SIGN_ONLY' || mode === 'SIGN_WITH_ROAD';
export function normalizeConfig(input: MissionConfig = {}): SessionConfig {
  const mode = input.mode ?? 'OTC_HIGH_FIDELITY';
  const missionType = input.missionType ?? (mode === 'ARCADE_DRIVE' ? 'ARCADE' : 'TRAINING');
  // Classic is fixed to the published 180s run. OTC/Arcade may run the selectable long drives,
  // and the test harness may ask for any short length.
  const durationMs = mode === 'NEURORACER_CLASSIC'
    ? RULES.missionDurationMs
    : input.durationMs !== undefined && (input.testHarness || (RULES.selectableDurationsMs as readonly number[]).includes(input.durationMs))
      ? input.durationMs
      : RULES.missionDurationMs;
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 3_600_000) throw new RangeError('Invalid mission duration');
  const targetRatio = input.targetRatio ?? 1 / 3;
  if (!Number.isFinite(targetRatio) || targetRatio <= 0 || targetRatio >= 1) throw new RangeError('targetRatio must be in (0,1)');
  const startedAt = input.startedAt ?? new Date().toISOString();
  const seed = (input.seed ?? 20261018) >>> 0;
  const worldId = input.worldId ?? 1;
  if (![1, 2, 3, 4].includes(worldId)) throw new RangeError('Unknown world');
  const clampLevel = (n: number, max: number): number => Number.isFinite(n) ? Math.max(1, Math.min(max, Math.round(n))) : 1;
  return {
    schemaVersion: 1, mode, missionType, challengeMode: mode === 'OTC_HIGH_FIDELITY' && input.challengeMode === true,
    // On by default: events build a lasting speed bonus. Players can switch it off in settings.
    eventPaceEffects: input.eventPaceEffects !== false,
    // Classic keeps the reconstructed prototype physics; the game modes default to the
    // spec's self-centering (not full auto-follow).
    steeringAssist: mode === 'NEURORACER_CLASSIC'
      ? 'manual'
      : (['full', 'center', 'manual'] as const).includes(input.steeringAssist as 'full') ? input.steeringAssist! : 'center', taskMode: mode === 'ARCADE_DRIVE' ? 'DRIVE_ONLY' : input.taskMode ?? 'DUAL',
    segmentedBaseline: mode === 'OTC_HIGH_FIDELITY' && missionType === 'BASELINE' && input.taskMode === undefined,
    worldId, seed, durationMs, plannedDurationMs: durationMs, displayMs: RULES.displayMs, targetRatio,
    roadLevel: clampLevel(input.roadLevel ?? RULES.initialRoadLevel, RULES.roadLevelCount),
    signLevel: clampLevel(input.signLevel ?? RULES.initialSignLevel, RULES.signLevelCount),
    guidesCollected: Number.isFinite(input.guidesCollected ?? 0) ? Math.max(0, Math.min(RULES.guidesPerWorld, Math.floor(input.guidesCollected ?? 0))) : 0,
    sessionId: input.sessionId ?? `mission-${seed}-${startedAt}`,
    startedAt, dayKey: input.dayKey ?? startedAt.slice(0, 10),
    deviceCalibrationId: input.deviceCalibrationId ?? 'keyboard-uncalibrated',
    algorithmVersion: RULES.algorithmVersion, stimulusSetVersion: `world-${worldId}-v1`, testHarness: input.testHarness ?? false,
  };
}
export function taskAt(config: SessionConfig, elapsedMs: number): TaskMode {
  if (!config.segmentedBaseline) return config.taskMode;
  const third = config.durationMs / 3;
  return elapsedMs < third ? 'DRIVE_ONLY' : elapsedMs < third * 2 ? 'SIGN_ONLY' : 'DUAL';
}
