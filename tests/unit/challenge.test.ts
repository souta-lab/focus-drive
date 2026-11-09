import { describe, expect, it } from 'vitest';
import { ContinuousAdapter } from '../../src/core/adaptation';
import { allowedHalfWidth, generateNavigationEvents, roadCenter, steeringForce } from '../../src/core/road';
import { centerX, roadTangent } from '../../src/render/road';
import { normalizeConfig } from '../../src/config/rules';

describe('optional challenging play without changing Classic', () => {
  it('keeps fidelity settings unaffected when challenge is disabled or in Classic', () => {
    expect(normalizeConfig({ mode: 'NEURORACER_CLASSIC', challengeMode: true }).challengeMode).toBe(false);
    expect(normalizeConfig({ mode: 'OTC_HIGH_FIDELITY' }).challengeMode).toBe(false);
    expect(normalizeConfig({ mode: 'OTC_HIGH_FIDELITY', challengeMode: true }).challengeMode).toBe(true);
    expect(allowedHalfWidth(120)).toBe(3.2);
  });
  it('narrows the navigation tolerance with higher challenge levels', () => {
    expect(allowedHalfWidth(20, true)).toBeLessThan(3.2);
    expect(allowedHalfWidth(80, true)).toBeLessThan(allowedHalfWidth(20, true));
    expect(allowedHalfWidth(200, true)).toBeGreaterThanOrEqual(1.75);
  });
  it('creates denser and narrower challenge events without changing the standard seeded layout', () => {
    const normal = generateNavigationEvents(123, 1, 2500);
    const hard = generateNavigationEvents(123, 1, 2500, true);
    expect(hard.length).toBeGreaterThan(normal.length * 1.35);
    expect(hard[0]?.width).toBeLessThan(normal[0]!.width);
    expect(normal).toEqual(generateNavigationEvents(123, 1, 2500));
  });
  it('ramps quickly on repeated mastery and backs down when accuracy falls', () => {
    const standard = new ContinuousAdapter({ roadLevel: 20, signLevel: 29 });
    const hard = new ContinuousAdapter({ roadLevel: 20, signLevel: 29 }, true);
    for (let i = 1; i <= 30; i++) {
      standard.observeNavigation(i * 1000, 1, 1000);
      hard.observeNavigation(i * 1000, 1, 1000);
      standard.update(i * 1000);
      hard.update(i * 1000);
    }
    expect(hard.skill.road.level).toBeGreaterThan(standard.skill.road.level + 15);
    const peak = hard.skill.road.level;
    for (let i = 31; i <= 65; i++) {
      hard.observeNavigation(i * 1000, 0, 1000);
      hard.update(i * 1000);
    }
    expect(hard.skill.road.level).toBeLessThan(peak);
  });
  it('preserves enough high-speed steering authority for the steepest road curve', () => {
    const maxSlope = 3.0 * 0.006 + 1.0 * 0.013;
    expect(steeringForce(87.67, true) / 4).toBeGreaterThan(87.67 * maxSlope);
    expect(steeringForce(40, true)).toBe(18);
    expect(steeringForce(87.67, false)).toBe(18);
  });
  it('uses the precise road derivative for rendering', () => {
    for (const s of [0, 55, 312, 1000]) {
      expect(centerX(s, 123)).toBeCloseTo(roadCenter(s, 123), 10);
      const h = 0.001;
      expect(roadTangent(s, 123)).toBeCloseTo((centerX(s + h, 123) - centerX(s - h, 123)) / (2 * h), 6);
    }
  });
});
