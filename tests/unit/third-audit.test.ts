import { describe, expect, it } from 'vitest';
import { MissionEngine } from '../../src/core/engine';
import { RULES } from '../../src/config/rules';
import type { NavigationSample } from '../../src/core/types';

const STEP = 1000 / 60;
type EngineInternals = {
  samples: NavigationSample[];
  guideNavStartIndex: number;
  guideNavInsideCount: number;
  guideNavValidCount: number;
};

describe('third audit - physics isolation and Guide window performance', () => {
  it('preserves the Classic off-road state and keeps rails physical in OTC', () => {
    const classic = new MissionEngine({ mode: 'NEURORACER_CLASSIC', taskMode: 'DRIVE_ONLY', seed: 5 });
    const otc = new MissionEngine({ mode: 'OTC_HIGH_FIDELITY', taskMode: 'DRIVE_ONLY', seed: 5, testHarness: true, durationMs: 15_000 });
    for (let frame = 1; frame <= 500; frame++) {
      const t = frame * STEP;
      classic.advance(STEP, 1, t);
      otc.advance(STEP, 1, t);
    }
    const classicError = Math.abs(classic.snapshot.carX - classic.snapshot.roadCenterX);
    const otcError = Math.abs(otc.snapshot.carX - otc.snapshot.roadCenterX);
    expect(classicError).toBeGreaterThan(3.4);
    expect(otcError).toBeLessThanOrEqual(3.40001);
  });

  it('sliding Guide navigation state exactly matches independently filtered history', () => {
    const engine = new MissionEngine({ mode: 'OTC_HIGH_FIDELITY', missionType: 'BASELINE',
      testHarness: true, durationMs: 90_000, seed: 11, challengeMode: true });
    const internal = engine as unknown as EngineInternals;
    for (let i = 1; i <= 4400; i++) {
      const t = i * STEP;
      const steering = i % 650 < 275 ? 1 : -1;
      engine.advance(STEP, steering, t);
      if (i % 137 === 0) {
        const now = engine.snapshot.elapsedMs;
        const independent = internal.samples.filter(s => s.tMs >= now - RULES.guide.recentWindowMs && s.taskMode === 'DUAL' && s.measurementValid);
        expect(internal.guideNavValidCount, 'valid at '+i).toBe(independent.length);
        expect(internal.guideNavInsideCount, 'inside at '+i).toBe(independent.filter(s => s.insideRoad).length);
        expect(internal.guideNavValidCount).toBeGreaterThanOrEqual(internal.guideNavInsideCount);
        expect(internal.guideNavStartIndex).toBeLessThanOrEqual(internal.samples.length);
      }
    }
  });
});
