import { RESPONSE_WINDOWS_MS, ROAD_SPEEDS_MPS } from '../config/difficulty';
import { RULES } from '../config/rules';
import type { AdaptiveChange, MissionSummary } from './types';

export const clampLevel = (level: number, max: number): number => Math.max(1, Math.min(max, Math.round(Number.isFinite(level) ? level : 1)));
export function responseWindow(level: number): number { return RESPONSE_WINDOWS_MS[clampLevel(level, 54) - 1]!; }
export function roadSpeed(level: number): number { return ROAD_SPEEDS_MPS[clampLevel(level, 200) - 1]!; }
/** Reconstructed proportional staircase. Bounds are inclusive (77.5–82.5%). */
export function classicStep(accuracy: number | null, axis: 'SIGN' | 'ROAD' = 'SIGN'): number {
  if (accuracy === null || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1) return 0;
  const pct = accuracy * 100;
  if (pct >= 77.5 - 1e-10 && pct <= 82.5 + 1e-10) return 0;
  const above = pct > 82.5;
  const raw = Math.round(Math.abs(pct - (above ? 82.5 : 77.5)) / (axis === 'SIGN' ? RULES.signPercentPerLevel : RULES.roadPercentPerLevel));
  return (above ? 1 : -1) * Math.min(axis === 'SIGN' ? RULES.maxSignStep : RULES.maxRoadStep, Math.max(1, raw));
}
export function updateClassic(levels: { roadLevel: number; signLevel: number }, summary: MissionSummary, durationMs: number, invalid = false): { roadLevel: number; signLevel: number } {
  const unchanged = { roadLevel: clampLevel(levels.roadLevel, 200), signLevel: clampLevel(levels.signLevel, 54) };
  if (invalid || summary.measurementQuality === 'INVALID') return unchanged;
  const targeting = summary.targeting;
  const signDelta = targeting.targetTrials >= RULES.minTargets && targeting.nonTargetTrials >= RULES.minNonTargets ? classicStep(targeting.accuracy, 'SIGN') : 0;
  const roadDelta = summary.navigation.validTimeMs + 1e-6 >= durationMs * RULES.minNavValidFraction ? classicStep(summary.navigation.accuracy, 'ROAD') : 0;
  return { signLevel: clampLevel(unchanged.signLevel + signDelta, 54), roadLevel: clampLevel(unchanged.roadLevel + roadDelta, 200) };
}
interface NavObservation { tMs: number; accuracy: number; validMs: number }
interface TargetObservation { tMs: number; correct: boolean; isTarget: boolean }
export interface SkillAxis { mu: number; variance: number; level: number }
/** Independent bounded evidence controllers; these OTC coefficients are estimated, not SSME. */
export class ContinuousAdapter {
  readonly skill: { road: SkillAxis; target: SkillAxis };
  private nav: NavObservation[] = [];
  private target: TargetObservation[] = [];
  private lastChange = { ROAD: -Infinity, SIGN: -Infinity };
  constructor(levels: { roadLevel: number; signLevel: number }, private readonly challengeMode = false) {
    this.skill = { road: { mu: 0.8, variance: 0.04, level: clampLevel(levels.roadLevel, 200) }, target: { mu: 0.8, variance: 0.04, level: clampLevel(levels.signLevel, 54) } };
  }
  observeNavigation(tMs: number, accuracy: number, validMs: number): void {
    if (!Number.isFinite(accuracy) || validMs <= 0) return;
    this.nav.push({ tMs, accuracy: Math.max(0, Math.min(1, accuracy)), validMs });
  }
  observeTarget(tMs: number, correct: boolean, isTarget: boolean): void { this.target.push({ tMs, correct, isTarget }); }
  update(tMs: number, invalid = false): AdaptiveChange[] {
    this.nav = this.nav.filter((x) => x.tMs > tMs - RULES.continuous.navWindowMs + 1e-5);
    this.target = this.target.filter((x) => x.tMs > tMs - RULES.continuous.targetWindowMs);
    const output: AdaptiveChange[] = [];
    if (invalid) return output;
    const validMs = this.nav.reduce((sum, x) => sum + x.validMs, 0);
    const navSuccess = this.nav.reduce((sum, x) => sum + x.validMs * x.accuracy, 0);
    if (validMs > 0) {
      const n = validMs / 1000;
      this.skill.road.mu = (navSuccess / 1000 + 4) / (n + 5);
      this.skill.road.variance = this.skill.road.mu * (1 - this.skill.road.mu) / (n + 6);
    }
    const n = this.target.length;
    const targetSuccess = this.target.filter((x) => x.correct).length;
    if (n > 0) {
      this.skill.target.mu = (targetSuccess + 4) / (n + 5);
      this.skill.target.variance = this.skill.target.mu * (1 - this.skill.target.mu) / (n + 6);
    }
    const consider = (axis: 'ROAD' | 'SIGN', accuracy: number, start: number): void => {
      const cooldown = this.challengeMode ? (axis === 'ROAD' ? 5000 : 7500) : RULES.continuous.sameAxisCooldownMs;
      if (tMs - this.lastChange[axis] < cooldown - 1e-6) return;
      const direction = accuracy > RULES.upperDeadband ? 1 : accuracy < RULES.lowerDeadband ? -1 : 0;
      if (!direction) return;
      const state = axis === 'ROAD' ? this.skill.road : this.skill.target;
      const oldLevel = state.level;
      const step = !this.challengeMode ? RULES.continuous.stepCap
        : direction > 0 ? (accuracy >= 0.925 ? (axis === 'ROAD' ? 6 : 3) : accuracy >= 0.85 ? (axis === 'ROAD' ? 3 : 2) : 1)
        : accuracy <= 0.65 ? (axis === 'ROAD' ? 4 : 3) : 2;
      state.level = clampLevel(oldLevel + direction * step, axis === 'ROAD' ? 200 : 54);
      if (state.level === oldLevel) return;
      this.lastChange[axis] = tMs;
      output.push({ tMs, axis, oldLevel, newLevel: state.level, metricWindowStartMs: start, metricWindowEndMs: tMs, evidence: 'INFERRED_OTC', reason: `independent posterior=${accuracy.toFixed(4)}; evidence=${axis === 'ROAD' ? `${(validMs / 1000).toFixed(1)}s` : n}; change=${direction * step}; profile=${this.challengeMode ? 'challenge' : 'standard'}` });
    };
    if (validMs >= (this.challengeMode ? 8000 : RULES.continuous.navWindowMs) - 1e-4) consider('ROAD', this.skill.road.mu, Math.max(0, tMs - RULES.continuous.navWindowMs));
    const targets = this.target.filter((x) => x.isTarget).length;
    if (n >= (this.challengeMode ? 6 : RULES.continuous.targetMinTrials) && targets >= 2 && n - targets >= 2) consider('SIGN', this.skill.target.mu, this.target[0]!.tMs);
    return output;
  }
}
