import { describe, expect, it } from 'vitest';
import { generateSchedule } from '../../src/core/schedule';
import { getWorld, targetForTime, WORLDS } from '../../src/config/worlds';
import { normalizeConfig, taskAt } from '../../src/config/rules';

describe('published stimulus schedule and world rules', () => {
  it.each([1 / 3, 0.5])('produces exactly72 trials and exact target ratio %s', (ratio) => {
    const schedule = generateSchedule(123, 180000, ratio);
    expect(schedule).toHaveLength(72);
    expect(schedule.filter((trial) => trial.isTarget)).toHaveLength(ratio === 0.5 ? 36 : 24);
    for (const interval of [2000, 2500, 3000]) expect(schedule.filter((trial) => trial.intervalMs === interval)).toHaveLength(24);
    expect(schedule.reduce((sum, trial) => sum + trial.intervalMs, 0)).toBe(180000);
    expect(schedule.at(-1)!.scheduledAtMs).toBeLessThan(180000);
    for (let i = 1; i < schedule.length; i++) expect([2000, 2500, 3000]).toContain(schedule[i]!.scheduledAtMs - schedule[i - 1]!.scheduledAtMs);
  });
  it('is seeded, nonoverlapping and not frontloaded with excessive target runs', () => {
    expect(generateSchedule(7)).toEqual(generateSchedule(7));
    expect(generateSchedule(7)).not.toEqual(generateSchedule(8));
    for (let seed = 0; seed < 100; seed++) {
      const flags = generateSchedule(seed).map((entry) => entry.isTarget);
      expect(flags.map((flag) => flag ? 'T' : '_').join('')).not.toContain('TTTT');
      expect(new Set(generateSchedule(seed).map((entry) => entry.scheduledAtMs)).size).toBe(72);
    }
  });
  it('has published W1 three colours and W2 six same-colour shapes', () => {
    const w1 = getWorld(1); const w2 = getWorld(2);
    expect(new Set([w1.target, ...w1.distractors].map((token) => token.color)).size).toBe(3);
    expect(new Set([w2.target, ...w2.distractors].map((token) => token.color)).size).toBe(1);
    expect(new Set([w2.target, ...w2.distractors].map((token) => token.shape)).size).toBe(6);
    expect(WORLDS.map((world) => world.evidence)).toEqual(['PUBLISHED', 'PUBLISHED', 'INFERRED', 'INFERRED']);
    expect(targetForTime(4, 29999).id).not.toBe(targetForTime(4, 30000).id);
    expect(targetForTime(4, 60000)).toEqual(targetForTime(4, 0));
  });
  it('defaults OTC to180s and forces Classic180s regardless of test overrides', () => {
    expect(normalizeConfig().mode).toBe('OTC_HIGH_FIDELITY');
    expect(normalizeConfig({ durationMs: 1000 }).durationMs).toBe(180000);
    expect(normalizeConfig({ durationMs: 1000, testHarness: true }).durationMs).toBe(1000);
    expect(normalizeConfig({ mode: 'NEURORACER_CLASSIC', durationMs: 1000, testHarness: true }).durationMs).toBe(180000);
    expect(normalizeConfig({ mode: 'ARCADE_DRIVE' }).taskMode).toBe('DRIVE_ONLY');
  });
  it('segments production Baseline60s per task; explicit task mode is practice', () => {
    const config = normalizeConfig({ missionType: 'BASELINE' });
    expect([0, 59999, 60000, 119999, 120000, 179999].map((t) => taskAt(config, t))).toEqual(['DRIVE_ONLY', 'DRIVE_ONLY', 'SIGN_ONLY', 'SIGN_ONLY', 'DUAL', 'DUAL']);
    expect(normalizeConfig({ missionType: 'BASELINE', taskMode: 'SIGN_ONLY' }).segmentedBaseline).toBe(false);
  });
});
