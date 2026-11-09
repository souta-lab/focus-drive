/** DOM-independent public contracts. All *TimestampMs values share rAF/performance time. */
export type WorldId = 1 | 2 | 3 | 4;
export type ProductMode = 'OTC_HIGH_FIDELITY' | 'NEURORACER_CLASSIC' | 'ARCADE_DRIVE';
export type TaskMode = 'DRIVE_ONLY' | 'SIGN_ONLY' | 'DUAL' | 'DRIVE_WITH_SIGNS' | 'SIGN_WITH_ROAD';
export type MissionType = 'CALIBRATION' | 'BASELINE' | 'TRAINING' | 'CHALLENGE' | 'ARCADE';
export type Shape = 'circle' | 'triangle' | 'square' | 'diamond' | 'pentagon' | 'hexagon';
export type InputSource = 'keyboard' | 'gamepad' | 'touch' | 'tilt' | 'bot' | string;
export interface StimulusToken { id: string; shape: Shape; color: string; label: string }
export interface WorldDefinition {
  id: WorldId; name: string; subtitle: string; theme: string; target: StimulusToken;
  distractors: readonly StimulusToken[]; alternateTarget?: StimulusToken;
  rule: string; evidence: 'PUBLISHED' | 'INFERRED';
}
export interface MissionConfig {
  mode?: ProductMode;
  missionType?: MissionType;
  taskMode?: TaskMode;
  worldId?: WorldId;
  seed?: number;
  roadLevel?: number;
  signLevel?: number;
  targetRatio?: number;
  /** Game-only intensified controller, never used for Classic calibration. */
  challengeMode?: boolean;
  /** Game-only: let Power Zone / Gate / Obstacle change the car's pace. Off by default. */
  eventPaceEffects?: boolean;
  /**
   * Steering assistance.
   *  - 'full'   curvature feed-forward: the car follows the road with no input (design spec
   *             forbids this as the default, offered as an easy option)
   *  - 'center' self-centering only: releasing the stick settles the car, but curves still
   *             have to be steered (spec default)
   *  - 'manual' the raw prototype model
   * Classic always behaves as 'manual' so its reconstructed physics stay comparable.
   */
  steeringAssist?: 'full' | 'center' | 'manual';
  /** OTC only; a short duration must explicitly opt into testHarness. Classic is always 180s. */
  durationMs?: number;
  testHarness?: boolean;
  guidesCollected?: number;
  sessionId?: string;
  startedAt?: string;
  dayKey?: string;
  deviceCalibrationId?: string;
}
export interface SessionConfig {
  schemaVersion: 1; mode: ProductMode; missionType: MissionType; taskMode: TaskMode;
  segmentedBaseline: boolean; worldId: WorldId; seed: number; durationMs: number;
  plannedDurationMs: number; displayMs: number; targetRatio: number; roadLevel: number;
  signLevel: number; guidesCollected: number; sessionId: string; startedAt: string;
  dayKey: string; deviceCalibrationId: string; algorithmVersion: string;
  stimulusSetVersion: string; testHarness: boolean; challengeMode: boolean; eventPaceEffects: boolean; steeringAssist: 'full' | 'center' | 'manual';
}
export interface ScheduledTrial {
  id: string; scheduledAtMs: number; intervalMs: number; isTarget: boolean;
}
export type TrialState = 'SCHEDULED' | 'SHOWN' | 'HIDDEN' | 'CLOSED';
export type TrialOutcome = 'HIT' | 'MISS' | 'FALSE_ALARM' | 'CORRECT_REJECTION' | 'INVALID_PRESENTATION';
export interface StimulusEvent extends ScheduledTrial {
  stimulusId: string; shape: Shape; color: string; taskMode: TaskMode;
  signLevel: number; roadLevel: number; displayMs: number; responseWindowMs: number;
  state: TrialState; outcome: TrialOutcome | null;
  /** scheduledAtMs is mission time; these timestamps are performance/rAF time. */
  scheduledTimestampMs: number; onsetDelayMs: number | null;
  submittedToGPUAtMs: number | null; visibleFrameTimestampMs: number | null;
  hiddenFrameTimestampMs: number | null; visibleAtMs: number | null;
  responseAtMs: number | null; reactionTimeMs: number | null; qualityFlags: string[];
}
export interface StimulusSnapshot {
  id: string; shape: Shape; color: string; isTarget: boolean; visible: boolean;
  scheduledAtMs: number; displayMs: number; responseWindowMs: number;
  visibleFrameTimestampMs: number | null; state: TrialState;
}
export type NavigationKind = 'POWER_ZONE' | 'GATE' | 'OBSTACLE';
export interface NavigationEvent {
  id: string; kind: NavigationKind; atDistance: number; roadOffset: number; width: number;
  difficultyWeight: number; worldId: WorldId; seed: number; passed: boolean;
  success: boolean | null; passedAtMs: number | null;
}
export interface NavigationSample {
  tMs: number; dtMs: number; taskMode: TaskMode; roadLevel: number; roadCenterX: number;
  carX: number; lateralOffset: number; insideRoad: boolean; measurementValid: boolean;
}
export interface InputEvent {
  timestampMs: number; tMs: number; source: InputSource; trialId: string | null;
  outcome: 'HIT' | 'FALSE_ALARM' | 'PREMATURE' | 'REPEATED' | 'LATE' | 'IGNORED';
}
export interface QualityFlag { tMs: number; reason: string; severe: boolean }
export interface AdaptiveChange {
  tMs: number; axis: 'ROAD' | 'SIGN'; oldLevel: number; newLevel: number;
  metricWindowStartMs: number; metricWindowEndMs: number;
  evidence: 'RECONSTRUCTED_CLASSIC' | 'INFERRED_OTC'; reason: string;
}
export type GuidePhase = 'HIDDEN' | 'APPROACH' | 'LOCKABLE' | 'LOCKING' | 'CAPTURED' | 'LOST';
export interface GuideSnapshot { phase: GuidePhase; progress: number; offset: number; countCaptured: number; /** Why the lock is not progressing, for HUD guidance. */ blockedBy?: string | null }
export interface GuideCapture { tMs: number; ordinal: number; roadLevel: number; signLevel: number }
export interface Feedback { tMs: number; kind: 'HIT' | 'MISS' | 'FALSE_ALARM' | 'NAV_SUCCESS' | 'NAV_FAILURE' | 'POWER' | 'IMPACT' | 'WALL' | 'GUIDE'; text: string }
export interface MissionSnapshot {
  elapsedMs: number; durationMs: number; finished: boolean; paused: boolean; taskMode: TaskMode;
  progressS: number; carX: number; carVX: number; roadCenterX: number; steer: number;
  forwardSpeed: number; roadLevel: number; signLevel: number; worldId: WorldId;
  navEvents: readonly NavigationEvent[]; currentStimulus: StimulusSnapshot | null;
  target: StimulusToken; guide: GuideSnapshot; navAccuracy: number | null;
  targetAccuracy: number | null; lastFeedback: Feedback | null; fps: number;
  coins: number; measurementInvalid: boolean;
  /** Game-facing blend of path holding and event outcomes (0..1). Research path accuracy stays `navAccuracy`. */
  driveScore: number | null;
  /** Success rate of navigation events resolved so far (0..1). */
  eventAccuracy: number | null;
  /** Temporary pace multiplier earned/lost from Power Zone, Gate and Obstacle outcomes. */
  paceFactor: number;
}
export interface ConfusionMatrix { hits: number; misses: number; falseAlarms: number; correctRejections: number; invalid: number; validTrials: number; targetTrials: number; nonTargetTrials: number }
export interface ReactionTimeMetrics { count: number; meanMs: number | null; medianMs: number | null; p90Ms: number | null; varianceMs2: number | null }
export interface TargetMetrics extends ConfusionMatrix {
  hitRate: number | null; falseAlarmRate: number | null; accuracy: number | null;
  dPrime: number | null; reactionTime: ReactionTimeMetrics;
}
export interface NavigationMetrics {
  accuracy: number | null; validTimeMs: number; insideTimeMs: number;
  meanAbsError: number | null; p95AbsError: number | null;
  eventSuccessRate: number | null; eventsPassed: number; eventsSucceeded: number;
  /** Game-facing blend: 55% path holding + 45% event success. `accuracy` remains the research metric. */
  driveScore: number | null;
}
export interface ThresholdObservation { level: number; accuracy: number; weight: number }
export interface NavigationThreshold {
  estimate: number | null; lower: number | null; upper: number | null; sampleCount: number;
  confidence: 'LOW' | 'MODERATE' | 'HIGH'; method: 'weighted-isotonic-80-v1';
  fitted: { level: number; accuracy: number; weight: number }[];
}
export interface TaskSummary { taskMode: TaskMode; targeting: TargetMetrics; navigation: NavigationMetrics }
export interface MultitaskCost {
  costPct: number | null; dPrimeDifference: number | null; roadAccuracyDifference: number | null;
  confidenceInterval: [number, number] | null; reason: string | null; roadTradeoff: boolean;
}
export interface MissionSummary {
  totalValidTrials: number; hitRate: number | null; falseAlarmRate: number | null;
  targetingAccuracy: number | null; dPrime: number | null; hitReactionTimeMedianMs: number | null;
  navigationAccuracy: number | null; navigation80Threshold: number | null;
  multitaskingCostPct: number | null; measurementQuality: 'GOOD' | 'LIMITED' | 'INVALID';
  targeting: TargetMetrics; navigation: NavigationMetrics; threshold: NavigationThreshold;
  byTask: TaskSummary[]; multitaskCost: MultitaskCost; metricVersion: string;
}
export interface CoinBreakdown { navigation: number; targeting: number; guides: number; goals: number; completion: number; total: number }
/** Positive host rAF gaps only; simulation steps and manual-pause intervals are not frames. */
export interface FrameTiming { timestampMs: number; tMs: number; deltaMs: number; measurementValid: boolean }
export interface PerformanceSummary {
  /** All positive rAF gaps, including invalid long frames, are included to avoid hiding stalls. */
  meanFps: number | null; p95FrameMs: number | null; p99FrameMs: number | null;
  frameCount: number; longFrameCount: number;
}
export interface MissionRecord {
  id: string; schemaVersion: 1; config: SessionConfig; startedAt: string; endedAt: string;
  elapsedMs: number; playedMs: number; completed: boolean; aborted: boolean; measurementInvalid: boolean;
  performanceOriginMs: number | null; pauses: { startedTimestampMs: number; endedTimestampMs: number | null }[];
  /** Optional for compatibility with older backups and fixtures. */
  frameTimings?: FrameTiming[]; performance?: PerformanceSummary;
  trials: StimulusEvent[]; inputs: InputEvent[]; navigationSamples: NavigationSample[];
  navigationEvents: NavigationEvent[]; adaptiveChanges: AdaptiveChange[]; qualityFlags: QualityFlag[];
  guideCaptures: GuideCapture[]; summary: MissionSummary; coins: CoinBreakdown;
  finalRoadLevel: number; finalSignLevel: number; goals: string[];
}
export interface WorldProgress {
  worldId: WorldId; unlocked: boolean; baselineComplete: boolean; trainingCompleted: number;
  trainingSinceChallenge: number; challengesCompleted: number; guides: number;
  guideCollection: { ordinal: number; acquiredAt: string; missionId: string }[];
  roadLevel: number; signLevel: number;
}
export interface CompositeSubmetrics { navigation: number; speed: number; selectivity: number }
export interface CompositeIndex {
  score: number | null; missionCount: number; submetrics: CompositeSubmetrics | null;
  firstScore: number | null; change: number | null;
  trend: { intercept: number; slope: number } | null;
  method: 'estimated-robust-world-mission-v1'; estimated: true; explanation: string;
}
export interface IndexEntry extends CompositeIndex { unlockedAt: string; throughMission: number }
export interface ClassicCalibrationState {
  roadLevel: number; signLevel: number; completedRuns: number;
  quality: 'LOW' | 'MODERATE'; updatedAt: string; runOrder: number;
  protocol: 'CLASSIC_180S_NOT_RESEARCH';
}
export interface PlayerProfile {
  schemaVersion: 1; id: string; createdAt: string; selectedWorld: WorldId; expert: boolean;
  coins: number; worlds: Record<WorldId, WorldProgress>; completedMissions: number;
  classicLevels?: Record<string, ClassicCalibrationState>;
  indexMissionProgress: number; focusIndex: CompositeIndex | null; indexHistory: IndexEntry[];
  missionMinutesByDay: Record<string, number>; totalPlayedMs: number;
  ownedCars: string[]; ownedPaints: string[]; ownedWheels: string[]; ownedDecals: string[];
  selectedCar: string; selectedPaint: string; selectedWheels: string; selectedDecal: string;
  completedGoals: string[]; appliedMissionIds: string[]; progressedMissionIds: string[]; history: MissionRecord[];
}
