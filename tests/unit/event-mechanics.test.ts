import { describe, expect, it } from 'vitest';
import { MissionEngine } from '../../src/core';
import { MAX_SPEED_BONUS, navigationEventEffect, roadCenter } from '../../src/core/road';
import { blendDriveScore, navigationMetrics } from '../../src/core/metrics';
import type { MissionConfig, MissionSnapshot, NavigationEvent, NavigationSample } from '../../src/core/types';

const STEP = 1000 / 60;

function makeEngine(overrides: Partial<MissionConfig> = {}): MissionEngine {
  return new MissionEngine({ testHarness: true, mode: 'OTC_HIGH_FIDELITY', challengeMode: true, durationMs: 30_000, worldId: 1, seed: 123, roadLevel: 20, signLevel: 29, ...overrides });
}

function steerToward(snapshot: MissionSnapshot, targetX: number): number {
  const desiredVx = Math.max(-4.6, Math.min(4.6, (targetX - snapshot.carX) * 3));
  return Math.max(-1, Math.min(1, (desiredVx - snapshot.carVX) * 1.6));
}

/** Drives to one event's centre so tests hit or clear it deterministically. */
function driveToEvent(engine: MissionEngine, eventId: string): { snapshot: MissionSnapshot; event: NavigationEvent; timeMs: number } {
  let timeMs = 0;
  for (let i = 0; i < 4000; i++) {
    const snapshot = engine.snapshot;
    const event = snapshot.navEvents.find((entry) => entry.id === eventId);
    if (!event) {
      timeMs += STEP;
      engine.advance(STEP, 0, timeMs);
      continue;
    }
    const center = roadCenter(event.atDistance, engine.config.seed) + event.roadOffset;
    timeMs += STEP;
    const after = engine.advance(STEP, steerToward(snapshot, center), timeMs);
    const resolved = after.navEvents.find((entry) => entry.id === eventId);
    if (resolved?.passed) return { snapshot: after, event: resolved, timeMs };
  }
  throw new Error(`event ${eventId} was not reached`);
}

function advanceFrames(engine: MissionEngine, timeMs: number, frames: number, steer = 0): { snapshot: MissionSnapshot; timeMs: number } {
  let time = timeMs;
  for (let i = 0; i < frames; i++) { time += STEP; engine.advance(STEP, steer, time); }
  return { snapshot: engine.snapshot, timeMs: time };
}

describe('gameplay consequences for navigation events', () => {
  it('defines a bounded, game-only effect table that builds speed instead of swinging it', () => {
    // Clearing events adds to a lasting bonus, so speed trends up rather than snapping back.
    expect(navigationEventEffect('POWER_ZONE', true).bonusDelta).toBeGreaterThan(navigationEventEffect('GATE', true).bonusDelta);
    expect(navigationEventEffect('GATE', true).bonusDelta).toBeGreaterThan(0);
    expect(navigationEventEffect('OBSTACLE', true).bonusDelta).toBeGreaterThan(0);
    expect(navigationEventEffect('POWER_ZONE', true).dip).toBe(1);
    // Only a collision costs speed, and only briefly.
    expect(navigationEventEffect('OBSTACLE', false).bonusDelta).toBeLessThan(0);
    expect(navigationEventEffect('OBSTACLE', false).dip).toBeLessThan(1);
    expect(navigationEventEffect('OBSTACLE', false).dipMs).toBeLessThanOrEqual(1000);
    expect(navigationEventEffect('OBSTACLE', false).lateralImpulse).toBeGreaterThan(0);
    // A missed boost is not a punishment.
    expect(navigationEventEffect('GATE', false).bonusDelta).toBe(0);
    expect(navigationEventEffect('GATE', false).dip).toBe(1);
    expect(navigationEventEffect('POWER_ZONE', false).lateralImpulse).toBe(0);
    let total = 0;
    for (let i = 0; i < 100; i++) total = Math.min(MAX_SPEED_BONUS, total + navigationEventEffect('POWER_ZONE', true).bonusDelta);
    expect(total).toBeLessThanOrEqual(MAX_SPEED_BONUS);
  });

  it('blends path holding with event success while leaving the research metric alone', () => {
    const samples: NavigationSample[] = Array.from({ length: 60 }, (_, i) => ({
      tMs: (i + 1) * 1000, dtMs: 1000, taskMode: 'DUAL', roadLevel: 20, roadCenterX: 0, carX: 0, lateralOffset: 0, insideRoad: true, measurementValid: true,
    }));
    const failed: NavigationEvent[] = Array.from({ length: 3 }, (_, i) => ({
      id: `event-${i}`, kind: 'OBSTACLE', atDistance: 100 * (i + 1), roadOffset: 0, width: 1.4, difficultyWeight: 1,
      worldId: 1, seed: 1, passed: true, success: false, passedAtMs: 1000 * (i + 1),
    }));
    const nav = navigationMetrics(samples, failed);
    expect(nav.accuracy).toBe(1);
    expect(nav.eventSuccessRate).toBe(0);
    expect(nav.driveScore).toBeCloseTo(0.55, 10);
    const clean = navigationMetrics(samples, failed.map((event) => ({ ...event, success: true })));
    expect(clean.driveScore).toBe(1);
    expect(navigationMetrics(samples, []).driveScore).toBe(1);
    expect(blendDriveScore(null, null)).toBeNull();
    expect(blendDriveScore(0.8, null)).toBe(0.8);
    expect(blendDriveScore(null, 0.5)).toBe(0.5);
  });

  it('applies a real pace surge when the car clears a Power Zone', () => {
    const engine = makeEngine({ eventPaceEffects: true });
    const cleared = driveToEvent(engine, 'nav-1');
    expect(cleared.event.kind).toBe('POWER_ZONE');
    expect(cleared.event.success).toBe(true);
    const cruise = cleared.snapshot.paceFactor;
    const surged = advanceFrames(engine, cleared.timeMs, 90);
    expect(surged.snapshot.paceFactor).toBeGreaterThan(1.03);
    expect(surged.snapshot.paceFactor).toBeGreaterThan(cruise);
    expect(surged.snapshot.forwardSpeed).toBeGreaterThan(28.8);
    expect(surged.snapshot.eventAccuracy).toBe(1);
    expect(surged.snapshot.driveScore).not.toBeNull();
    // The bonus is kept, not handed back: a second later the car is still faster than baseline
    // (only a later collision may take it away, which is covered by the obstacle test).
    const later = advanceFrames(engine, surged.timeMs, 60);
    expect(later.snapshot.paceFactor).toBeGreaterThan(1.03);
  });

  it('clamps the car to the physical guardrails instead of letting it leave the road', () => {
    const engine = new MissionEngine({ mode: 'OTC_HIGH_FIDELITY', missionType: 'TRAINING', taskMode: 'DRIVE_ONLY', testHarness: true, durationMs: 20_000, roadLevel: 20, challengeMode: true, eventPaceEffects: true });
    let timeMs = 0; let sawWall = false; let maxLateral = 0;
    for (let i = 0; i < 700; i++) {
      timeMs += STEP;
      const snapshot = engine.advance(STEP, 1, timeMs);
      maxLateral = Math.max(maxLateral, Math.abs(snapshot.carX - snapshot.roadCenterX));
      if (snapshot.lastFeedback?.kind === 'WALL') sawWall = true;
    }
    expect(sawWall).toBe(true);
    expect(maxLateral).toBeLessThanOrEqual(3.4001);
    const record = engine.finish(true);
    expect(Math.max(...record.navigationSamples.map((sample) => Math.abs(sample.lateralOffset)))).toBeLessThanOrEqual(3.4001);
  });

  it('slows the car and breaks the event streak when it hits an Obstacle', () => {
    const engine = makeEngine({ eventPaceEffects: true });
    const hit = driveToEvent(engine, 'nav-3');
    expect(hit.event.kind).toBe('OBSTACLE');
    expect(hit.event.success).toBe(false);
    // Sample inside the 700ms dip; the pace eases toward it rather than snapping.
    const after = advanceFrames(engine, hit.timeMs, 24);
    expect(after.snapshot.paceFactor).toBeLessThan(0.95);
    // ...and it recovers rather than staying slow for the rest of the run.
    const recovered = advanceFrames(engine, after.timeMs, 240);
    expect(recovered.snapshot.paceFactor).toBeGreaterThan(after.snapshot.paceFactor);
    expect(after.snapshot.eventAccuracy).not.toBeNull();
    expect(after.snapshot.eventAccuracy!).toBeLessThan(1);
    expect(after.snapshot.driveScore!).toBeLessThan(1);
  });
});
