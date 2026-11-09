import { describe, expect, it } from 'vitest';
import { homeView, insightsView } from '../../src/ui/views';
import { DEFAULT_SETTINGS } from '../../src/persistence/store';
import { createProfile } from '../../src/core/progression';
import { compositeIndex } from '../../src/core/metrics';
import { fixtureRecord } from './helpers';

describe('second audit interface and score mode isolation', () => {
  it('offers immediate dual-task practice only in OTC mode', () => {
    expect(DEFAULT_SETTINGS.sound).toBe(true);
    const profile = createProfile('2026-10-18T10:00:00Z');
    expect(homeView(profile, 'BASELINE', DEFAULT_SETTINGS)).toContain('data-action="quick-dual"');
    expect(homeView(profile, 'TRAINING', { ...DEFAULT_SETTINGS, mode: 'NEURORACER_CLASSIC' })).not.toContain('data-action="quick-dual"');
    expect(homeView(profile, 'BASELINE', { ...DEFAULT_SETTINGS, mode: 'ARCADE_DRIVE' })).not.toContain('data-action="quick-dual"');
  });
  it('excludes training-only practice from valid mission counts and trend charts', () => {
    const profile = createProfile();
    profile.history = [fixtureRecord('practice', { testHarness: true })];
    const html = insightsView(profile);
    expect(html).toContain('VALID MISSIONS</div><strong>0</strong>');
  });
  it('shows a momentum panel with streak, bests and the next unlock', () => {
    const profile = createProfile();
    const first = fixtureRecord('one'); const second = fixtureRecord('two');
    second.summary.navigation.driveScore = 0.91;
    profile.history = [first, second];
    const key = (offset: number): string => { const d = new Date(); d.setDate(d.getDate() - offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    profile.missionMinutesByDay = { [key(0)]: 3, [key(1)]: 6, [key(2)]: 4, [key(4)]: 5 };
    profile.worlds[1].guides = 9;
    const html = insightsView(profile);
    expect(html).toContain('YOUR MOMENTUM');
    expect(html).toContain('あと6個');
    expect(html).toContain('3日連続で運転しています');
    expect(html).toContain('PLAY STREAK');
    expect(html).toContain('91%');
  });
  it('computes finite indices for a mix of standard and high-challenge results', () => {
    const records = Array.from({ length: 6 }, (_, i) => fixtureRecord('mode-'+i, {
      mode: 'OTC_HIGH_FIDELITY',
      missionType: i === 0 ? 'BASELINE' : 'TRAINING',
      challengeMode: i % 2 === 0,
    }));
    const result = compositeIndex(records);
    expect(result.missionCount).toBe(6);
    expect(result.score).not.toBeNull();
    expect(Number.isFinite(result.score!)).toBe(true);
    expect(result.explanation).toContain('Challenge');
  });
});
