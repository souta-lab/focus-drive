import { describe, expect, it } from 'vitest';
import { applyMission, classicKey, classicLevelsFor, createProfile, nextMission } from '../../src/core/progression';
import { fixtureRecord } from './helpers';
import type { MissionRecord, PlayerProfile, WorldId } from '../../src/core/types';

function nextRecord(profile: PlayerProfile, id: string, world: WorldId = 1): MissionRecord { return fixtureRecord(id, nextMission(profile, world)); }
function addGuides(record: MissionRecord, count: number): MissionRecord { record.guideCaptures = Array.from({ length: count }, (_, i) => ({ tMs: (i + 1) * 10000, ordinal: i + 1, roadLevel: 20, signLevel: 29 })); return record; }

describe('pure profile mission state machine and rewards', () => {
  it('has simple cosmetic ownership defaults and onlyWorld1 unlocked', () => {
    const profile = createProfile('2026-10-18T00:00:00Z');
    expect(profile.ownedCars).toEqual(['roadster']); expect(profile.selectedPaint).toBe('silver'); expect(profile.ownedWheels).toEqual(['standard']); expect(profile.ownedDecals).toEqual(['none']);
    expect(profile.worlds[1].unlocked).toBe(true); expect(profile.worlds[2].unlocked).toBe(false); expect(() => nextMission(profile, 2)).toThrow();
  });
  it('enforces Baseline → at least5Training → Challenge and repeats training after it', () => {
    let profile = createProfile(); expect(nextMission(profile).missionType).toBe('BASELINE'); expect(nextMission(profile).taskMode).toBe('DUAL');
    profile = applyMission(profile, nextRecord(profile, 'baseline'));
    for (let i = 0; i < 5; i++) { expect(nextMission(profile).missionType).toBe('TRAINING'); profile = applyMission(profile, nextRecord(profile, `training-${i}`)); }
    expect(nextMission(profile).missionType).toBe('CHALLENGE'); expect(profile.worlds[1].trainingCompleted).toBe(5);
    profile = applyMission(profile, nextRecord(profile, 'challenge'));
    expect(profile.worlds[1].challengesCompleted).toBe(1); expect(profile.worlds[1].trainingSinceChallenge).toBe(0); expect(nextMission(profile).missionType).toBe('TRAINING');
  });
  it('cannot bypass Baseline or5Training with out-of-order results', () => {
    let profile = createProfile(); const wrong = fixtureRecord('wrong', { missionType: 'CHALLENGE' });
    profile = applyMission(profile, wrong); expect(profile.completedMissions).toBe(0);
    profile = applyMission(profile, nextRecord(profile, 'baseline'));
    profile = applyMission(profile, fixtureRecord('early-challenge', { missionType: 'CHALLENGE' }));
    expect(profile.completedMissions).toBe(1); expect(profile.worlds[1].challengesCompleted).toBe(0);
    profile = applyMission(profile, fixtureRecord('practice-baseline', { missionType: 'BASELINE', taskMode: 'SIGN_ONLY' }));
    expect(profile.completedMissions).toBe(1);
  });
  it('never advances incomplete, aborted, invalid, short testHarness or single-task practice records', () => {
    const original = createProfile();
    const records = [nextRecord(original, 'incomplete'), nextRecord(original, 'aborted'), nextRecord(original, 'invalid'), nextRecord(original, 'test-harness'), fixtureRecord('single', { missionType: 'BASELINE', taskMode: 'SIGN_ONLY' })];
    records[0]!.elapsedMs = 179999; records[0]!.playedMs = 179999;
    records[1]!.completed = false; records[1]!.aborted = true;
    records[2]!.measurementInvalid = true;
    records[3]!.config.testHarness = true;
    for (const record of records) { const profile = applyMission(original, addGuides(record, 15)); expect(profile.worlds[1].baselineComplete).toBe(false); expect(profile.completedMissions).toBe(0); expect(profile.worlds[2].unlocked).toBe(false); }
    expect(original.history).toEqual([]);
  });
  it('keeps15-Guide gates independent per world, not aggregate missions/time', () => {
    let profile = createProfile();
    profile = applyMission(profile, addGuides(nextRecord(profile, 'baseline-14'), 14));
    expect(profile.worlds[2].unlocked).toBe(false);
    profile = applyMission(profile, addGuides(nextRecord(profile, 'training-last'), 1));
    expect(profile.worlds[2].unlocked).toBe(true); expect(profile.worlds[3].unlocked).toBe(false);
    profile = applyMission(profile, addGuides(nextRecord(profile, 'extra-world1'), 10));
    expect(profile.worlds[1].guides).toBe(15); expect(profile.worlds[3].unlocked).toBe(false);
    profile = applyMission(profile, addGuides(nextRecord(profile, 'world2-baseline', 2), 15));
    expect(profile.worlds[3].unlocked).toBe(true); expect(profile.expert).toBe(false);
    profile = applyMission(profile, addGuides(nextRecord(profile, 'world3-baseline', 3), 15));
    expect(profile.worlds[4].unlocked).toBe(true); expect(profile.expert).toBe(true); expect(profile.worlds[4].guides).toBe(0);
    expect(nextMission(profile, 4).missionType).toBe('BASELINE');
  });
  it('unlocks an explicitly estimated FocusDrive Index every15 qualifying missions only', () => {
    let profile = createProfile();
    for (let i = 1; i <= 14; i++) profile = applyMission(profile, nextRecord(profile, `mission-${i}`));
    expect(profile.indexMissionProgress).toBe(14); expect(profile.focusIndex).toBeNull(); expect(profile.indexHistory).toEqual([]);
    profile = applyMission(profile, nextRecord(profile, 'mission-15'));
    expect(profile.completedMissions).toBe(15); expect(profile.indexMissionProgress).toBe(0); expect(profile.indexHistory).toHaveLength(1);
    expect(profile.focusIndex?.estimated).toBe(true); expect(profile.focusIndex?.score).not.toBeNull();
    profile = applyMission(profile, nextRecord(profile, 'mission-16')); expect(profile.indexMissionProgress).toBe(1); expect(profile.indexHistory).toHaveLength(1);
  });
  it('does not mint real currency or minutes from explicit testHarness records', () => {
    const profile = createProfile(); const record = nextRecord(profile, 'qa'); record.config.testHarness = true;
    const updated = applyMission(profile, record);
    expect(updated.history).toHaveLength(1); expect(updated.coins).toBe(0); expect(updated.totalPlayedMs).toBe(0); expect(updated.completedMissions).toBe(0);
  });
  it('credits only actual played milliseconds and actual earned coins; applies once immutably', () => {
    const profile = createProfile(); const record = nextRecord(profile, 'aborted'); record.completed = false; record.aborted = true; record.elapsedMs = 30000; record.playedMs = 15000; record.coins.total = 7;
    const updated = applyMission(profile, record);
    expect(updated.totalPlayedMs).toBe(15000); expect(updated.missionMinutesByDay['2026-10-18']).toBe(0.25); expect(updated.coins).toBe(0);
    expect(updated.completedMissions).toBe(0); expect(profile.coins).toBe(0); expect(profile.totalPlayedMs).toBe(0);
    expect(applyMission(updated, record)).toBe(updated);
    record.trials[0]!.outcome = 'MISS'; expect(updated.history[0]?.trials[0]?.outcome).toBe('HIT');
  });
});
describe('persistent independent Classic calibration', () => {
  it('stores only relevant axis by world/task/device and seeds Dual from matching singles', () => {
    let profile = createProfile();
    const drive = fixtureRecord('drive', { mode: 'NEURORACER_CLASSIC', missionType: 'CALIBRATION', taskMode: 'DRIVE_ONLY', worldId: 1, deviceCalibrationId: 'keyboard-v1' });
    drive.finalRoadLevel = 45; drive.finalSignLevel = 54;
    profile = applyMission(profile, drive);
    const sign = fixtureRecord('sign', { mode: 'NEURORACER_CLASSIC', missionType: 'CALIBRATION', taskMode: 'SIGN_ONLY', worldId: 1, deviceCalibrationId: 'keyboard-v1' });
    sign.finalRoadLevel = 200; sign.finalSignLevel = 38;
    profile = applyMission(profile, sign);
    expect(classicLevelsFor(profile, 1, 'DUAL', 'keyboard-v1')).toMatchObject({ roadLevel: 45, signLevel: 38, protocol: 'CLASSIC_180S_NOT_RESEARCH' });
    expect(classicLevelsFor(profile, 2, 'DUAL', 'keyboard-v1')).toMatchObject({ roadLevel: 20, signLevel: 29 });
    expect(classicLevelsFor(profile, 1, 'DUAL', 'gamepad-v1')).toMatchObject({ roadLevel: 20, signLevel: 29 });
    expect(profile.worlds[1].roadLevel).toBe(20); expect(profile.worlds[1].signLevel).toBe(29); expect(profile.completedMissions).toBe(0);
    expect(profile.classicLevels?.[classicKey(1, 'DRIVE_ONLY', 'keyboard-v1')]?.signLevel).toBe(29);
    expect(profile.classicLevels?.[classicKey(1, 'SIGN_ONLY', 'keyboard-v1')]?.roadLevel).toBe(20);
  });
  it('newer Dual runs supersede single calibration; new single calibration replaces that axis only', () => {
    let profile = createProfile();
    const dual = fixtureRecord('dual', { mode: 'NEURORACER_CLASSIC', taskMode: 'DUAL' }); dual.finalRoadLevel = 50; dual.finalSignLevel = 36;
    profile = applyMission(profile, dual);
    expect(classicLevelsFor(profile, 1)).toMatchObject({ roadLevel: 50, signLevel: 36, completedRuns: 1, quality: 'LOW' });
    const sign = fixtureRecord('new-sign', { mode: 'NEURORACER_CLASSIC', taskMode: 'SIGN_ONLY' }); sign.finalSignLevel = 31;
    profile = applyMission(profile, sign);
    expect(classicLevelsFor(profile, 1)).toMatchObject({ roadLevel: 50, signLevel: 31 });
    const invalid = fixtureRecord('invalid', { mode: 'NEURORACER_CLASSIC' }); invalid.measurementInvalid = true; invalid.finalSignLevel = 54;
    profile = applyMission(profile, invalid); expect(classicLevelsFor(profile, 1).signLevel).toBe(31);
    const aborted = fixtureRecord('aborted', { mode: 'NEURORACER_CLASSIC' }); aborted.completed = false; aborted.aborted = true;
    profile = applyMission(profile, aborted); expect(profile.classicLevels?.[classicKey(1, 'DUAL')]?.completedRuns).toBe(1);
  });
});
