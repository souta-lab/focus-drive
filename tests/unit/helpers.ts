import { MissionEngine } from '../../src/core/engine';
import { calculateSummary } from '../../src/core/metrics';
import { roadCenter } from '../../src/core/road';
import { normalizeConfig } from '../../src/config/rules';
import type { MissionConfig, MissionRecord, MissionSnapshot, NavigationSample, StimulusEvent, TrialOutcome } from '../../src/core/types';

export function trial(outcome: TrialOutcome, isTarget: boolean, index = 0, rt = 300): StimulusEvent {
  return { id: `trial-${index}`, scheduledAtMs: index * 2500, intervalMs: 2500, isTarget, stimulusId: 'fixture', shape: 'circle', color: '#51efbc', taskMode: 'DUAL', roadLevel: 20, signLevel: 29, displayMs: 400, responseWindowMs: 500,
    state: 'CLOSED', outcome, scheduledTimestampMs: 1000 + index * 2500, onsetDelayMs: 0, submittedToGPUAtMs: 1000 + index * 2500, visibleFrameTimestampMs: outcome === 'INVALID_PRESENTATION' ? null : 1000 + index * 2500,
    visibleAtMs: outcome === 'INVALID_PRESENTATION' ? null : 1000 + index * 2500, hiddenFrameTimestampMs: outcome === 'INVALID_PRESENTATION' ? null : 1400 + index * 2500,
    responseAtMs: outcome === 'HIT' || outcome === 'FALSE_ALARM' ? 1000 + index * 2500 + rt : null,
    reactionTimeMs: outcome === 'HIT' || outcome === 'FALSE_ALARM' ? rt : null, qualityFlags: [] };
}
export function fixtureRecord(id = 'fixture', config: MissionConfig = {}): MissionRecord {
  const normalized = normalizeConfig({ sessionId: id, startedAt: '2026-10-18T10:00:00.000Z', ...config });
  const trials = Array.from({ length: 36 }, (_, i) => trial(i < 18 ? 'HIT' : 'CORRECT_REJECTION', i < 18, i, 300 + i));
  const samples: NavigationSample[] = Array.from({ length: 180 }, (_, i) => ({ tMs: (i + 1) * 1000, dtMs: 1000, taskMode: 'DUAL', roadLevel: i < 90 ? 20 : 40, roadCenterX: 0, carX: i % 10 === 0 ? 5 : 0, lateralOffset: i % 10 === 0 ? 5 : 0, insideRoad: i % 10 !== 0, measurementValid: true }));
  const summary = calculateSummary({ trials, navigationSamples: samples, navigationEvents: [], qualityFlags: [] });
  return { id, schemaVersion: 1, config: normalized, startedAt: normalized.startedAt, endedAt: '2026-10-18T10:03:00.000Z', elapsedMs: normalized.durationMs, playedMs: normalized.durationMs,
    completed: true, aborted: false, measurementInvalid: false, performanceOriginMs: 1000, pauses: [], trials, inputs: [], navigationSamples: samples, navigationEvents: [], adaptiveChanges: [], qualityFlags: [], guideCaptures: [], summary,
    coins: { navigation: 0, targeting: 18, guides: 0, goals: 0, completion: 10, total: 28 }, finalRoadLevel: 20, finalSignLevel: 29, goals: [] };
}
export function botSteer(snapshot: MissionSnapshot, seed: number): number {
  const center = roadCenter(snapshot.progressS, seed);
  const centerVelocity = (roadCenter(snapshot.progressS + snapshot.forwardSpeed * 0.05, seed) - center) / 0.05;
  const desiredVX = centerVelocity + (center - snapshot.carX) * 3;
  return Math.max(-1, Math.min(1, (desiredVX * 4 + (desiredVX - snapshot.carVX) * 6) / 18));
}
export interface BotOptions { hz?: number; targets?: boolean; drive?: boolean; acknowledge?: boolean; pressDistractors?: boolean; stopAtMs?: number }
export function runEngine(engine: MissionEngine, options: BotOptions = {}): MissionRecord {
  const hz = options.hz ?? 60;
  let t = 0;
  let priorVisible: string | null = null;
  const pressed = new Set<string>();
  const renderAndRespond = (snapshot: MissionSnapshot): void => {
    const stimulus = snapshot.currentStimulus;
    if (priorVisible && (!stimulus?.visible || stimulus.id !== priorVisible)) engine.acknowledgeHidden(priorVisible, 1000 + t);
    if (stimulus?.visible && options.acknowledge !== false) engine.acknowledgePresentation(stimulus.id, 1000 + t);
    priorVisible = stimulus?.visible ? stimulus.id : null;
    const after = engine.snapshot.currentStimulus;
    if (after && after.visibleFrameTimestampMs !== null && !pressed.has(after.id) && t + 1000 - after.visibleFrameTimestampMs >= 150) {
      if (options.targets !== false && after.isTarget || options.pressDistractors && !after.isTarget) { engine.press(1000 + t, 'bot'); pressed.add(after.id); }
    }
  };
  renderAndRespond(engine.advance(0, 0, 1000));
  const end = options.stopAtMs ?? engine.config.durationMs;
  const frameCount = Math.ceil(end * hz / 1000);
  for (let frame = 1; frame <= frameCount; frame++) {
    const next = Math.min(end, frame * 1000 / hz);
    const steer = options.drive === false ? 1 : botSteer(engine.snapshot, engine.config.seed);
    const snapshot = engine.advance(next - t, steer, 1000 + next);
    t = next;
    renderAndRespond(snapshot);
  }
  return engine.finish(end < engine.config.durationMs);
}
export function advanceTo(engine: MissionEngine, tMs: number): MissionSnapshot {
  let t = engine.snapshot.elapsedMs;
  while (t < tMs - 1e-7) { const next = Math.min(tMs, t + 1000 / 60); engine.advance(next - t, 0, 1000 + next); t = next; }
  return engine.snapshot;
}
