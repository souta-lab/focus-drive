import type { ScheduledTrial } from './types';

/** Mulberry32: deterministic; seed and schedule do not depend on render rate/difficulty. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle<T>(array: T[], random: () => number): T[] {
  for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [array[i], array[j]] = [array[j]!, array[i]!]; }
  return array;
}
/**
 * Exactly 72 trials (24/48 or36/36) in 180s; 24 of each published interval.
 * `pacing: 'GAME'` is the high-challenge OTC profile: shorter, randomised intervals.
 * Classic and the standard OTC research profile keep the published cadence exactly.
 */
export function generateSchedule(seed: number, durationMs = 180_000, targetRatio = 1 / 3, pacing: 'PUBLISHED' | 'GAME' = 'PUBLISHED', gameIntervalMs: readonly [number, number] = [1400, 2600]): ScheduledTrial[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(targetRatio) || targetRatio < 0 || targetRatio > 1) throw new RangeError('Invalid schedule parameters');
  const random = seededRandom(seed);
  const game = pacing === 'GAME';
  const meanInterval = game ? (gameIntervalMs[0] + gameIntervalMs[1]) / 2 : 2500;
  const count = Math.max(1, Math.floor(durationMs / meanInterval));
  const intervals = game
    ? Array.from({ length: count }, () => Math.round(gameIntervalMs[0] + random() * (gameIntervalMs[1] - gameIntervalMs[0])))
    : shuffle(Array.from({ length: count }, (_, i) => [2000, 2500, 3000][i % 3]!), random);
  const targetCount = Math.round(count * targetRatio);
  let flags = Array.from({ length: count }, (_, i) => i < targetCount);
  // Reject excessive target runs; never alter the exact count to create an easy pattern.
  for (let attempt = 0; attempt < 200; attempt++) {
    flags = shuffle(flags, random);
    let run = 0; let worst = 0;
    for (const flag of flags) { run = flag ? run + 1 : 0; worst = Math.max(worst, run); }
    if (worst <= 3 || targetRatio > 0.75) break;
  }
  let at = 0;
  return intervals.map((intervalMs, i) => {
    const trial = { id: `trial-${String(i + 1).padStart(3, '0')}`, scheduledAtMs: at, intervalMs, isTarget: flags[i]! };
    at += intervalMs;
    return trial;
  }).filter((trial) => trial.scheduledAtMs < durationMs);
}
