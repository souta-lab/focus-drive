import { ROAD_CURVE_A, ROAD_CURVE_B, ROAD_FREQ_A, ROAD_FREQ_B } from '../core/road';

/** Identical to core roadCenter(s, seed); visual-only, never adjusts difficulty. */
export function centerX(s: number, seed = 0): number {
  const phase = (((seed % 997) + 997) % 997) * 0.001;
  return Math.sin(s * ROAD_FREQ_A + phase) * ROAD_CURVE_A + Math.sin(s * ROAD_FREQ_B + phase * 0.7) * ROAD_CURVE_B;
}

/** World-space dx/ds, useful for smooth road, car and prop orientation. */
export function roadTangent(s: number, seed = 0): number {
  const phase = (((seed % 997) + 997) % 997) * 0.001;
  return Math.cos(s * ROAD_FREQ_A + phase) * (ROAD_CURVE_A * ROAD_FREQ_A) + Math.cos(s * ROAD_FREQ_B + phase * 0.7) * (ROAD_CURVE_B * ROAD_FREQ_B);
}

export const EVALUATION_HALF_WIDTH = 3.2;
export const ROAD_HALF_WIDTH = 4.2;

/** A modest shoulder varies visually; evaluation lines remain at exactly ±3.2m. */
export function visualHalfWidth(s: number): number {
  return ROAD_HALF_WIDTH + (1 + Math.sin(s * 0.009)) * 0.18;
}
