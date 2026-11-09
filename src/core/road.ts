import { seededRandom } from './schedule';
import type { NavigationEvent, WorldId } from './types';

export const ROAD_HALF_WIDTH = 4.2;
export const CAR_HALF_WIDTH = 0.8;
/** At high speeds the procedural curvature requires >4.5m/s lateral control.
 * Keep the challenge physically traversable rather than turning difficulty into an impossible track.
 * 18 + (speed-40)*0.42 yields ~9.5m/s of lateral authority at 315km/h, comfortably above the
 * ~4.9m/s the steepest curve demands, so high-speed steering stays responsive. */
export function steeringForce(speedMps: number, challengeMode = false): number {
  return challengeMode ? 18 + Math.max(0, speedMps - 40) * 0.42 : 18;
}
export function allowedHalfWidth(level = 20, challengeMode = false): number {
  return challengeMode ? Math.max(1.75, 3.2 - Math.max(0, level - 1) * 0.018) : 3.2;
}
/**
 * Shared exact renderer/simulation model, invariant across difficulty and world art.
 * Peak lateral excursion is 3.0 + 1.0 = 4.0m. The previous 5.4 + 1.8 = 7.2m was 2.5x the
 * evaluation half-width, so holding the lane demanded constant micro-correction rather than
 * following the road. Difficulty still comes from curvature and speed, just at a fair ratio.
 */
export const ROAD_CURVE_A = 3.0;
export const ROAD_CURVE_B = 1.0;
export const ROAD_FREQ_A = 0.006;
export const ROAD_FREQ_B = 0.013;
export function roadCenter(progressS: number, seed: number): number {
  const phase = (((seed % 997) + 997) % 997) * 0.001;
  return Math.sin(progressS * ROAD_FREQ_A + phase) * ROAD_CURVE_A + Math.sin(progressS * ROAD_FREQ_B + phase * 0.7) * ROAD_CURVE_B;
}
export function generateNavigationEvents(seed: number, worldId: WorldId, maxDistance: number, challengeMode = false): NavigationEvent[] {
  const random = seededRandom(seed ^ 0xa71e92);
  const kinds = ['POWER_ZONE', 'GATE', 'OBSTACLE'] as const;
  const events: NavigationEvent[] = [];
  let distance = 100;
  while (distance < maxDistance + 250) {
    const kind = kinds[events.length % 3]!;
    events.push({ id: `nav-${events.length + 1}`, kind, atDistance: distance,
      roadOffset: (random() - 0.5) * (challengeMode ? (kind === 'OBSTACLE' ? 3.2 : 2.6) : (kind === 'OBSTACLE' ? 4.4 : 2.8)),
      width: challengeMode ? (kind === 'OBSTACLE' ? 1.8 : kind === 'GATE' ? 3.6 : 3.0) : (kind === 'OBSTACLE' ? 1.4 : kind === 'GATE' ? 4.8 : 4.4),
      difficultyWeight: 1, worldId, seed, passed: false, success: null, passedAtMs: null });
    distance += challengeMode ? 62 + random() * 28 : 100 + random() * 30;
  }
  return events;
}
/** Evaluate at the exact distance crossing rather than the later fixed-step endpoint.
 * At high speeds a 60Hz step can cover more than a metre. */
export function navigationEventCrossing(event: NavigationEvent, oldProgress: number, newProgress: number, oldX: number, newX: number, seed: number): { success: boolean; fraction: number } {
  const delta = newProgress - oldProgress;
  const fraction = delta > 0 ? Math.max(0, Math.min(1, (event.atDistance - oldProgress) / delta)) : 1;
  return { success: navigationEventSuccess(event, oldX + (newX - oldX) * fraction, seed), fraction };
}
export function navigationEventSuccess(event: NavigationEvent, carX: number, seed: number): boolean {
  const error = Math.abs(carX - roadCenter(event.atDistance, seed) - event.roadOffset);
  return event.kind === 'OBSTACLE' ? error >= event.width / 2 + CAR_HALF_WIDTH : error <= event.width / 2 - CAR_HALF_WIDTH;
}
/**
 * Game-only consequences. These never touch the measured path metric.
 *
 * Speeds build up over a run instead of swinging: clearing events raises a persistent bonus,
 * and hitting an obstacle costs some of it plus a brief dip. The earlier design snapped the
 * pace up and back down on every event, which felt like the car was stuttering.
 */
export interface NavigationEventEffect {
  /** Persistent change to this run's speed bonus (added to 1.0, capped by the engine). */
  bonusDelta: number;
  /** Temporary multiplier after a collision, 1 when there is none. */
  dip: number; dipMs: number;
  lateralImpulse: number;
  feedback: 'POWER' | 'NAV_SUCCESS' | 'NAV_FAILURE' | 'IMPACT'; text: string;
}
export function navigationEventEffect(kind: NavigationEvent['kind'], success: boolean): NavigationEventEffect {
  if (success) {
    if (kind === 'POWER_ZONE') return { bonusDelta: 0.045, dip: 1, dipMs: 0, lateralImpulse: 0, feedback: 'POWER', text: 'POWER ZONE · SURGE' };
    if (kind === 'GATE') return { bonusDelta: 0.02, dip: 1, dipMs: 0, lateralImpulse: 0, feedback: 'NAV_SUCCESS', text: 'CLEAN GATE' };
    return { bonusDelta: 0.012, dip: 1, dipMs: 0, lateralImpulse: 0, feedback: 'NAV_SUCCESS', text: 'AVOIDED · CLEAN LINE' };
  }
  // Only a collision slows you down; a missed boost is simply a missed opportunity.
  if (kind === 'OBSTACLE') return { bonusDelta: -0.06, dip: 0.9, dipMs: 700, lateralImpulse: 1.6, feedback: 'IMPACT', text: 'IMPACT · RECOVER' };
  return { bonusDelta: 0, dip: 1, dipMs: 0, lateralImpulse: 0, feedback: 'NAV_FAILURE', text: 'KEEP YOUR LINE' };
}
/** Cap on the accumuluble speed bonus so a clean run cannot run away. */
export const MAX_SPEED_BONUS = 0.22;
