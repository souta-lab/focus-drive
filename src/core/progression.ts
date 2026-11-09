import { hasDrive, hasTarget, RULES } from '../config/rules';
import { clampLevel } from './adaptation';
import { compositeIndex } from './metrics';
import type { ClassicCalibrationState, MissionConfig, MissionRecord, PlayerProfile, TaskMode, WorldId, WorldProgress } from './types';

export function createProfile(now = new Date().toISOString()): PlayerProfile {
  const world = (worldId: WorldId): WorldProgress => ({ worldId, unlocked: worldId === 1, baselineComplete: false, trainingCompleted: 0, trainingSinceChallenge: 0, challengesCompleted: 0, guides: 0, guideCollection: [], roadLevel: RULES.initialRoadLevel, signLevel: RULES.initialSignLevel });
  return { schemaVersion: 1, id: `local-${now}`, createdAt: now, selectedWorld: 1, expert: false, coins: 0,
    worlds: { 1: world(1), 2: world(2), 3: world(3), 4: world(4) }, completedMissions: 0, classicLevels: {},
    indexMissionProgress: 0, focusIndex: null, indexHistory: [], missionMinutesByDay: {}, totalPlayedMs: 0,
    ownedCars: ['roadster'], ownedPaints: ['silver'], ownedWheels: ['standard'], ownedDecals: ['none'],
    selectedCar: 'roadster', selectedPaint: 'silver', selectedWheels: 'standard', selectedDecal: 'none',
    completedGoals: [], appliedMissionIds: [], progressedMissionIds: [], history: [] };
}
export function nextMission(profile: PlayerProfile, worldId: WorldId = profile.selectedWorld): MissionConfig {
  const world = profile.worlds[worldId];
  if (!world.unlocked) throw new Error('This world requires 15 Guides in the preceding world');
  // Dual task from the first mission: the player never has to wait through two single-task blocks.
  return { mode: 'OTC_HIGH_FIDELITY', missionType: !world.baselineComplete ? 'BASELINE' : world.trainingSinceChallenge >= RULES.minimumTrainingMissions ? 'CHALLENGE' : 'TRAINING',
    taskMode: 'DUAL', worldId, roadLevel: world.roadLevel, signLevel: world.signLevel, guidesCollected: world.guides,
    seed: (20261018 + profile.completedMissions * 7919 + worldId * 104729) >>> 0 };
}
/** Device/world/task separation is intentional: Classic calibration never changes OTC levels. */
export function classicKey(worldId: WorldId, taskMode: TaskMode, deviceCalibrationId = 'keyboard-uncalibrated'): string {
  return `${worldId}|${taskMode}|${encodeURIComponent(deviceCalibrationId)}`;
}
export function classicLevelsFor(profile: PlayerProfile, worldId: WorldId, taskMode: TaskMode = 'DUAL', deviceCalibrationId = 'keyboard-uncalibrated'): ClassicCalibrationState {
  const levels = profile.classicLevels ?? {};
  const own = levels[classicKey(worldId, taskMode, deviceCalibrationId)];
  const fallback: ClassicCalibrationState = { roadLevel: RULES.initialRoadLevel, signLevel: RULES.initialSignLevel, completedRuns: 0, quality: 'LOW', updatedAt: profile.createdAt, runOrder: -1, protocol: 'CLASSIC_180S_NOT_RESEARCH' };
  const result = { ...(own ?? fallback) };
  if (taskMode === 'DUAL') {
    const roadSingle = levels[classicKey(worldId, 'DRIVE_ONLY', deviceCalibrationId)];
    const signSingle = levels[classicKey(worldId, 'SIGN_ONLY', deviceCalibrationId)];
    // New single-axis calibration seeds Dual; later Dual runs supersede it independently.
    if (roadSingle && roadSingle.runOrder > (own?.runOrder ?? -1)) result.roadLevel = roadSingle.roadLevel;
    if (signSingle && signSingle.runOrder > (own?.runOrder ?? -1)) result.signLevel = signSingle.signLevel;
    if (!own) {
      result.completedRuns = Math.min(roadSingle?.completedRuns ?? 0, signSingle?.completedRuns ?? 0);
      result.quality = roadSingle?.quality === 'MODERATE' && signSingle?.quality === 'MODERATE' ? 'MODERATE' : 'LOW';
    }
  }
  return result;
}
/** Immutable, idempotent application. Aborted/practice/invalid runs never advance the mission state. */
export function applyMission(profile: PlayerProfile, record: MissionRecord): PlayerProfile {
  if (profile.appliedMissionIds.includes(record.id)) return profile;
  const result = structuredClone(profile);
  result.appliedMissionIds.push(record.id);
  result.history.push(structuredClone(record));
  // QA/test runs retain raw logs but must not mint real currency, minutes, or progression.
  if (record.config.testHarness) return result;
  const playedMs = Math.max(0, Math.min(record.elapsedMs, record.playedMs));
  result.totalPlayedMs += playedMs;
  result.missionMinutesByDay[record.config.dayKey] = (result.missionMinutesByDay[record.config.dayKey] ?? 0) + playedMs / 60_000;
  // Never grant rewards for unfinished, invalid, calibration or free-drive sessions.
  // The record remains available for diagnostics, and Classic calibration is independent.
  const world = result.worlds[record.config.worldId];
  if (record.config.mode === 'NEURORACER_CLASSIC') {
    const complete = record.completed && !record.aborted && !record.measurementInvalid && record.summary.measurementQuality !== 'INVALID' && record.elapsedMs + 1e-6 >= 180_000;
    if (complete) {
      const navValid = hasDrive(record.config.taskMode) && record.summary.navigation.validTimeMs >= record.config.durationMs * RULES.minNavValidFraction - 1e-6;
      const targetValid = hasTarget(record.config.taskMode) && record.summary.targeting.targetTrials >= RULES.minTargets && record.summary.targeting.nonTargetTrials >= RULES.minNonTargets;
      if (navValid || targetValid) {
        result.classicLevels ??= {};
        const key = classicKey(record.config.worldId, record.config.taskMode, record.config.deviceCalibrationId);
        const prior = result.classicLevels[key];
        const initial = classicLevelsFor(result, record.config.worldId, record.config.taskMode, record.config.deviceCalibrationId);
        const completedRuns = (prior?.completedRuns ?? 0) + 1;
        result.classicLevels[key] = { roadLevel: navValid ? clampLevel(record.finalRoadLevel, 200) : initial.roadLevel,
          signLevel: targetValid ? clampLevel(record.finalSignLevel, 54) : initial.signLevel,
          completedRuns, quality: completedRuns >= 3 ? 'MODERATE' : 'LOW', updatedAt: record.endedAt, runOrder: result.history.length,
          protocol: 'CLASSIC_180S_NOT_RESEARCH' };
      }
    }
    return result;
  }
  const production = record.completed && !record.aborted && !record.measurementInvalid && record.summary.measurementQuality !== 'INVALID'
    && record.elapsedMs + 1e-6 >= record.config.durationMs && record.config.mode === 'OTC_HIGH_FIDELITY' && !record.config.testHarness && world.unlocked;
  if (!production) return result;
  const type = record.config.missionType;
  // The production baseline is now a full dual-task run. Segmented baseline records (research
  // configuration) also use taskMode DUAL and remain accepted.
  const validBaseline = type === 'BASELINE' && !world.baselineComplete && record.config.taskMode === 'DUAL';
  const validTraining = type === 'TRAINING' && world.baselineComplete && record.config.taskMode === 'DUAL';
  const validChallenge = type === 'CHALLENGE' && world.baselineComplete && world.trainingSinceChallenge >= RULES.minimumTrainingMissions && record.config.taskMode === 'DUAL';
  if (!validBaseline && !validTraining && !validChallenge) return result;
  result.coins += Math.max(0, Math.floor(record.coins.total));
  result.completedGoals = [...new Set([...result.completedGoals, ...record.goals])];
  if (validBaseline) world.baselineComplete = true;
  if (validTraining) { world.trainingCompleted++; world.trainingSinceChallenge++; }
  if (validChallenge) { world.challengesCompleted++; world.trainingSinceChallenge = 0; }
  world.roadLevel = record.finalRoadLevel; world.signLevel = record.finalSignLevel;
  for (const _capture of record.guideCaptures) {
    if (world.guides >= RULES.guidesPerWorld) break;
    world.guides++;
    world.guideCollection.push({ ordinal: world.guides, acquiredAt: record.endedAt, missionId: record.id });
  }
  if (world.guides >= RULES.guidesPerWorld && world.worldId < 4) result.worlds[(world.worldId + 1) as WorldId].unlocked = true;
  result.expert = ([1, 2, 3, 4] as const).every((id) => result.worlds[id].unlocked);
  result.progressedMissionIds ??= [];
  result.progressedMissionIds.push(record.id);
  result.completedMissions++;
  result.indexMissionProgress = result.completedMissions % RULES.missionsPerIndex;
  if (result.indexMissionProgress === 0) {
    // Only state-machine-qualified missions contribute; single-task practice is never pooled.
    const ids = new Set(result.indexHistory.map((entry) => entry.throughMission));
    if (!ids.has(result.completedMissions)) {
      const qualifying = result.history.filter((item) => result.progressedMissionIds.includes(item.id));
      result.focusIndex = compositeIndex(qualifying.slice(-RULES.missionsPerIndex));
      result.indexHistory.push({ ...result.focusIndex, unlockedAt: record.endedAt, throughMission: result.completedMissions });
    }
  }
  return result;
}
