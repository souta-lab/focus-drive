import { describe, expect, it } from 'vitest';
import { MissionEngine } from '../../src/core/engine';
import { roadSpeed } from '../../src/core/adaptation';
import { applyMission, createProfile, nextMission } from '../../src/core/progression';
import { navigationEventCrossing, generateNavigationEvents } from '../../src/core/road';
import { fixtureRecord } from './helpers';

describe('second audit - strict isolation and anti-farming', () => {
  it('keeps Classic fixed speed and removes arcade gates, boosters and obstacles', () => {
    const engine = new MissionEngine({ mode: 'NEURORACER_CLASSIC', taskMode: 'DRIVE_ONLY', seed: 7 });
    expect(engine.snapshot.paceFactor).toBe(1);
    for (let i = 0; i <= 480; i++) {
      const snap = engine.advance(i ? 1000 / 60 : 0, 0, 1000 + i * 1000 / 60);
      expect(snap.forwardSpeed).toBe(roadSpeed(20));
      expect(snap.paceFactor).toBe(1);
      expect(snap.navEvents).toHaveLength(0);
    }
    expect(engine.finish(true).navigationEvents).toHaveLength(0);
  });

  it('does not award coins or goals for aborted, invalid, Arcade, Classic, or out-of-order runs', () => {
    const original = createProfile();
    const scenarios = [
      ['aborted', { completed: false, aborted: true }],
      ['invalid', { measurementInvalid: true }],
      ['arcade', {}, { mode: 'ARCADE_DRIVE' as const, missionType: 'ARCADE' as const }],
      ['classic', {}, { mode: 'NEURORACER_CLASSIC' as const, missionType: 'CALIBRATION' as const }],
      ['out-of-order', {}, { missionType: 'CHALLENGE' as const }],
    ] as const;
    for (const [id, overrides, config] of scenarios) {
      const record = fixtureRecord(id, config);
      Object.assign(record, overrides);
      record.coins.total = 999;
      record.goals = ['TEN_TARGET_STREAK'];
      const result = applyMission(original, record);
      expect(result.coins, id).toBe(0);
      expect(result.completedGoals, id).toEqual([]);
      expect(result.completedMissions, id).toBe(0);
    }
  });

  it('still awards a valid completed OTC baseline and prevents id replay', () => {
    const original = createProfile();
    const record = fixtureRecord('legitimate', nextMission(original));
    record.coins.total = 31;
    record.goals = ['TEN_TARGET_STREAK'];
    const result = applyMission(original, record);
    expect(result.coins).toBe(31);
    expect(result.completedGoals).toContain('TEN_TARGET_STREAK');
    expect(applyMission(result, record).coins).toBe(31);
  });

  it('reports zero earned coins on premature user abort even after earning raw score', () => {
    const engine = new MissionEngine({ mode: 'OTC_HIGH_FIDELITY', missionType: 'TRAINING', taskMode: 'DRIVE_ONLY' });
    let timestamp = 1000;
    engine.advance(0, 0, timestamp);
    for (let i = 0; i < 360; i++) {
      timestamp += 1000 / 60;
      engine.advance(1000 / 60, 0, timestamp);
    }
    const record = engine.finish(true);
    expect(record.aborted).toBe(true);
    expect(record.coins.total).toBe(0);
  });

  it('interpolates the exact event crossing instead of using the next simulation point', () => {
    const event = generateNavigationEvents(5, 1, 300)[0]!;
    const target = event.roadOffset;
    const oldProgress = event.atDistance - 1;
    const newProgress = event.atDistance + 1;
    // At crossing, car is exactly at the event's centre and passes.
    // By the frame end, car is outside a narrow event gate.
    const oldCenter = Math.sin(event.atDistance * 0.006 + (5 % 997) * .001) * 3.0
      + Math.sin(event.atDistance * .013 + (5 % 997) * .0007) * 1.0;
    const result = navigationEventCrossing(event, oldProgress, newProgress, oldCenter + target - 3, oldCenter + target + 3, 5);
    expect(result.fraction).toBeCloseTo(.5);
    expect(result.success).toBe(true);
  });

  it('generates enough event track for a 1.24x boosted max-speed mission', () => {
    const engine = new MissionEngine({ mode: 'OTC_HIGH_FIDELITY', testHarness: true, durationMs: 30_000, roadLevel: 200, challengeMode: true });
    const maxEvent = engine.finish(true).navigationEvents.at(-1)!;
    expect(maxEvent.atDistance).toBeGreaterThan(roadSpeed(200) * 1.24 * 30);
  });
});
