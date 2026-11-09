import { describe, expect, it } from 'vitest';
import { classicStep, ContinuousAdapter, responseWindow, roadSpeed, updateClassic } from '../../src/core/adaptation';
import { RESPONSE_WINDOWS_MS, ROAD_SPEEDS_MPS } from '../../src/config/difficulty';
import { fixtureRecord } from './helpers';

describe('explicit54/200 lookup and reconstructed Classic staircase', () => {
  it('clamps endpoints and keeps both lookup tables monotonic', () => {
    expect(RESPONSE_WINDOWS_MS).toHaveLength(54); expect(ROAD_SPEEDS_MPS).toHaveLength(200);
    expect(responseWindow(-1)).toBe(1000); expect(responseWindow(999)).toBe(250);
    expect(roadSpeed(-1)).toBe(22); expect(roadSpeed(999)).toBe(87.67);
    for (let i = 1; i < 54; i++) expect(RESPONSE_WINDOWS_MS[i]).toBeLessThan(RESPONSE_WINDOWS_MS[i - 1]!);
    for (let i = 1; i < 200; i++) expect(ROAD_SPEEDS_MPS[i]).toBeGreaterThan(ROAD_SPEEDS_MPS[i - 1]!);
  });
  it.each([0.775, 0.78, 0.8, 0.82, 0.825])('holds within inclusive deadband%s', (accuracy) => { expect(classicStep(accuracy)).toBe(0); expect(classicStep(accuracy, 'ROAD')).toBe(0); });
  it('matches the published90% -40ms and55% +100ms examples at initial29', () => {
    expect(classicStep(0.9)).toBe(4); expect(responseWindow(29 + classicStep(0.9)) - responseWindow(29)).toBe(-40);
    expect(classicStep(0.55)).toBe(-10); expect(responseWindow(29 + classicStep(0.55)) - responseWindow(29)).toBe(100);
    expect(classicStep(0.9, 'ROAD')).toBe(13); expect(classicStep(null)).toBe(0); expect(classicStep(NaN)).toBe(0);
  });
  it('updates only sufficient independent evidence and never invalid measurements', () => {
    const summary = fixtureRecord().summary;
    const levels = { roadLevel: 200, signLevel: 54 };
    expect(updateClassic(levels, summary, 180000)).toEqual(levels);
    const bad = structuredClone(summary); bad.targeting.targetTrials = 7; bad.navigation.validTimeMs = 161000;
    expect(updateClassic({ roadLevel: 20, signLevel: 29 }, bad, 180000)).toEqual({ roadLevel: 20, signLevel: 29 });
    expect(updateClassic({ roadLevel: 20, signLevel: 29 }, summary, 180000, true)).toEqual({ roadLevel: 20, signLevel: 29 });
    const low = structuredClone(summary); low.targeting.accuracy = 0; low.navigation.accuracy = 0;
    expect(updateClassic({ roadLevel: 1, signLevel: 1 }, low, 180000)).toEqual({ roadLevel: 1, signLevel: 1 });
  });
});
describe('independent inferred continuous controllers', () => {
  it('requires20s navigation evidence, then caps1 step and10s cooldown', () => {
    const adapter = new ContinuousAdapter({ roadLevel: 20, signLevel: 29 });
    for (let second = 1; second <= 19; second++) { adapter.observeNavigation(second * 1000, 1, 1000); expect(adapter.update(second * 1000)).toEqual([]); }
    adapter.observeNavigation(20000, 1, 1000);
    expect(adapter.update(20000).map((event) => [event.axis, event.oldLevel, event.newLevel])).toEqual([['ROAD',20,21]]);
    for (let second = 21; second <= 29; second++) { adapter.observeNavigation(second * 1000, 1, 1000); expect(adapter.update(second * 1000)).toEqual([]); }
    adapter.observeNavigation(30000, 1, 1000); expect(adapter.update(30000)[0]?.newLevel).toBe(22);
    expect(adapter.skill.target.level).toBe(29);
  });
  it('requires8 target trials and evidence of both classes; road unaffected', () => {
    const adapter = new ContinuousAdapter({ roadLevel: 20, signLevel: 29 });
    for (let i = 1; i <= 7; i++) { adapter.observeTarget(i * 2500, true, i % 2 === 0); expect(adapter.update(i * 2500)).toEqual([]); }
    adapter.observeTarget(20000, true, true);
    expect(adapter.update(20000).map((event) => [event.axis, event.newLevel])).toEqual([['SIGN',30]]);
    expect(adapter.skill.road.level).toBe(20);
    const biased = new ContinuousAdapter({ roadLevel: 20, signLevel: 29 });
    for (let i = 0; i < 10; i++) biased.observeTarget(i * 2500, true, false);
    expect(biased.update(25000)).toEqual([]);
  });
  it('does not adapt invalid runs and clamps axes at their independent bounds', () => {
    const adapter = new ContinuousAdapter({ roadLevel: 200, signLevel: 54 });
    for (let i = 1; i <= 20; i++) { adapter.observeNavigation(i * 1000, 1, 1000); adapter.observeTarget(i * 1000, true, i % 2 === 0); }
    expect(adapter.update(20000, true)).toEqual([]); expect(adapter.update(20000)).toEqual([]);
    expect(adapter.skill.road.level).toBe(200); expect(adapter.skill.target.level).toBe(54);
  });
  it('closed-loop simulated subject settles near80% rather than increasing endlessly', () => {
    const adapter = new ContinuousAdapter({ roadLevel: 20, signLevel: 29 });
    for (let second = 1; second <= 600; second++) {
      const probability = Math.max(0, Math.min(1, 0.8 - (adapter.skill.road.level - 40) * 0.02));
      adapter.observeNavigation(second * 1000, probability, 1000); adapter.update(second * 1000);
    }
    expect(adapter.skill.road.level).toBeGreaterThanOrEqual(38); expect(adapter.skill.road.level).toBeLessThanOrEqual(42);
    expect(adapter.skill.road.mu).toBeGreaterThanOrEqual(0.775); expect(adapter.skill.road.mu).toBeLessThanOrEqual(0.825);
  });
});
