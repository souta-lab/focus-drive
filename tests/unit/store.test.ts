import { describe, expect, it } from 'vitest';
import { MissionEngine, createProfile, applyMission } from '../../src/core';
import { isProfile } from '../../src/persistence/store';

describe('local backup schema validation', () => {
  it('accepts a fresh canonical profile', () => {
    expect(isProfile(createProfile())).toBe(true);
  });
  it('accepts full raw mission history with null metrics and an interrupted run', () => {
    const engine = new MissionEngine({ seed: 73 });
    engine.advance(1000 / 60, 0, 1000 / 60);
    const profile = applyMission(createProfile(), engine.finish(true));
    expect(isProfile(JSON.parse(JSON.stringify(profile)))).toBe(true);
  });
  it('rejects malformed raw history rather than restoring a crashing profile', () => {
    const profile = createProfile();
    (profile.history as unknown[]) = [{ id: 'bad-record', summary: {} }];
    expect(isProfile(profile)).toBe(false);
  });
  it('rejects non-numeric score, negative coins and malformed world state', () => {
    const profile = createProfile();
    expect(isProfile({ ...profile, coins: -100 })).toBe(false);
    expect(isProfile({ ...profile, focusIndex: { score: 'not-a-number' } })).toBe(false);
    expect(isProfile({ ...profile, worlds: { 1: {} } })).toBe(false);
  });
  it('rejects invalid mission progress and non-array ownership', () => {
    const profile = createProfile();
    expect(isProfile({ ...profile, indexMissionProgress: 16 })).toBe(false);
    expect(isProfile({ ...profile, ownedPaints: ['silver', {}] })).toBe(false);
  });
});
