import { missionTokens, targetForTime, type MissionTokens } from '../config/worlds';
import { hasDrive, hasTarget, normalizeConfig, RULES, taskAt } from '../config/rules';
import { ContinuousAdapter, responseWindow, roadSpeed, updateClassic } from './adaptation';
import { blendDriveScore, calculateSummary, performanceMetrics, targetingMetrics } from './metrics';
import { allowedHalfWidth, CAR_HALF_WIDTH, generateNavigationEvents, navigationEventCrossing, navigationEventEffect, MAX_SPEED_BONUS, ROAD_HALF_WIDTH, roadCenter, steeringForce } from './road';
import { generateSchedule, seededRandom } from './schedule';
import type { AdaptiveChange, CoinBreakdown, Feedback, FrameTiming, GuideCapture, GuideSnapshot, InputEvent, InputSource, MissionConfig, MissionRecord, MissionSnapshot, NavigationEvent, NavigationSample, QualityFlag, ScheduledTrial, SessionConfig, StimulusEvent } from './types';

const EPS = 1e-6;
/**
 * DOM-free mission clock. The host supplies rAF timestamps AND acknowledges actual
 * renderer submission. Calling advance alone is never evidence of presentation.
 */
export class MissionEngine {
  readonly config: SessionConfig;
  private readonly schedule: ScheduledTrial[];
  private readonly tokens: MissionTokens;
  private readonly adapter: ContinuousAdapter;
  private readonly random: () => number;
  private scheduleIndex = 0;
  private current: StimulusEvent | null = null;
  private trials: StimulusEvent[] = [];
  private samples: NavigationSample[] = [];
  // Sliding window for Guide; each sample enters/leaves once, not an O(N²) full-history filter.
  private guideNavStartIndex = 0;
  private guideNavValidCount = 0;
  private guideNavInsideCount = 0;
  private events: NavigationEvent[];
  private inputs: InputEvent[] = [];
  private flags: QualityFlag[] = [];
  private changes: AdaptiveChange[] = [];
  private captures: GuideCapture[] = [];
  private notifiedTrials = new Set<string>();
  private elapsed = 0;
  private played = 0;
  private simElapsed = 0;
  private accumulator = 0;
  private origin: number | null = null;
  private initialOrigin: number | null = null;
  private paused = false;
  private needsResumeAnchor = false;
  private pauses: { startedTimestampMs: number; endedTimestampMs: number | null }[] = [];
  private lastFrameTimestamp: number | null = null;
  private frames: number[] = [];
  private frameTimings: FrameTiming[] = [];
  private lastRafTimestamp: number | null = null;
  private progress = 0;
  private x: number;
  private vx = 0;
  private steering = 0;
  private roadLevel: number;
  private signLevel: number;
  private validNavMs = 0;
  private insideNavMs = 0;
  private paceFactor = 1;
  /** Persistent speed bonus earned by clearing events; only a collision takes it away. */
  private speedBonus = 0;
  private dipFactor = 1;
  private dipUntil = 0;
  private eventStreak = 0;
  private bestEventStreak = 0;
  private wallCooldownUntil = 0;
  /** Play time covered by frames too long to measure; excluded rather than voiding the run. */
  private invalidMs = 0;
  private nextObservationMs = 1000;
  private navObservationStart = 0;
  private invalid = false;
  private nextIntervalInvalid = false;
  private feedback: Feedback | null = null;
  private guide: GuideSnapshot = { phase: 'HIDDEN', progress: 0, offset: 0, countCaptured: 0 };
  private guidePhaseAt = 0;
  private lastCaptureAt = -Infinity;
  private finalRecord: MissionRecord | null = null;

  constructor(config: MissionConfig = {}) {
    this.config = normalizeConfig(config);
    this.roadLevel = this.config.roadLevel; this.signLevel = this.config.signLevel;
    // Classic keeps the published cadence exactly; the game profile shortens and randomises it.
    const gamePacing = this.config.challengeMode && this.config.mode === 'OTC_HIGH_FIDELITY';
    this.schedule = generateSchedule(this.config.seed, this.config.durationMs, this.config.targetRatio, gamePacing ? 'GAME' : 'PUBLISHED', [RULES.stimulus.otcMinIntervalMs, RULES.stimulus.otcMaxIntervalMs]);
    this.random = seededRandom(this.config.seed ^ 0x91ba75);
    this.adapter = new ContinuousAdapter({ roadLevel: this.roadLevel, signLevel: this.signLevel }, this.config.challengeMode);
    // Classic has no arcade gates/boosts/impacts: its fixed-speed road must stay comparable across runs.
    this.tokens = missionTokens(this.config.worldId, this.config.seed);
    this.events = this.config.mode === 'NEURORACER_CLASSIC' ? [] : generateNavigationEvents(this.config.seed, this.config.worldId, roadSpeed(200) * 1.25 * this.config.durationMs / 1000, this.config.challengeMode);
    this.x = roadCenter(0, this.config.seed);
  }

  get snapshot(): MissionSnapshot {
    const now = this.lastFrameTimestamp;
    const current = this.current;
    const isVisible = current !== null && current.outcome !== 'INVALID_PRESENTATION'
      && (current.visibleFrameTimestampMs === null || now === null || now < current.visibleFrameTimestampMs + current.displayMs - EPS);
    const keepCurrent = current !== null && (isVisible || current.outcome === null);
    const targeting = targetingMetrics(this.trials.filter((trial) => hasTarget(trial.taskMode)));
    const pathAccuracy = this.validNavMs ? this.insideNavMs / this.validNavMs : null;
    const resolved = this.events.filter((event) => event.passed && event.success !== null);
    const eventAccuracy = resolved.length ? resolved.filter((event) => event.success).length / resolved.length : null;
    return { elapsedMs: this.elapsed, durationMs: this.config.durationMs, finished: this.elapsed >= this.config.durationMs - EPS || this.finalRecord !== null, paused: this.paused,
      taskMode: taskAt(this.config, Math.min(this.elapsed, this.config.durationMs - EPS)),
      progressS: this.progress, carX: this.x, carVX: this.vx, roadCenterX: roadCenter(this.progress, this.config.seed), steer: this.steering,
      forwardSpeed: roadSpeed(this.roadLevel) * this.paceFactor, roadLevel: this.roadLevel, signLevel: this.signLevel, worldId: this.config.worldId,
      navEvents: this.events.filter((event) => event.atDistance >= this.progress - 35 && event.atDistance < this.progress + 700).map((event) => ({ ...event })),
      currentStimulus: keepCurrent && current ? { id: current.id, shape: current.shape, color: current.color, isTarget: current.isTarget,
        visible: isVisible, scheduledAtMs: current.scheduledAtMs, displayMs: current.displayMs, responseWindowMs: current.responseWindowMs,
        visibleFrameTimestampMs: current.visibleFrameTimestampMs, state: current.state } : null,
      target: targetForTime(this.config.worldId, this.elapsed, this.config.seed), guide: { ...this.guide },
      navAccuracy: pathAccuracy, targetAccuracy: targeting.accuracy, eventAccuracy,
      driveScore: blendDriveScore(pathAccuracy, eventAccuracy), paceFactor: this.paceFactor,
      lastFeedback: this.feedback ? { ...this.feedback } : null,
      fps: this.frames.length ? 1000 * this.frames.length / this.frames.reduce((sum, dt) => sum + dt, 0) : 0,
      coins: this.coinBreakdown(false).total, measurementInvalid: this.invalid };
  }

  advance(deltaMs: number, steer: number, frameTimestampMs: number): MissionSnapshot {
    return this.advanceFrame(deltaMs, steer, frameTimestampMs, true);
  }

  private advanceFrame(deltaMs: number, steer: number, frameTimestampMs: number, isRaf: boolean): MissionSnapshot {
    if (this.finalRecord || this.paused || this.elapsed >= this.config.durationMs - EPS) return this.snapshot;
    if (!Number.isFinite(deltaMs) || deltaMs < 0 || !Number.isFinite(frameTimestampMs)) throw new RangeError('Frame time must be finite and non-negative');
    if (this.needsResumeAnchor) {
      // Hosts commonly submit delta=0 on their first resumed rAF. Re-anchor
      // that unplayed frame fraction rather than accumulating onset drift.
      this.origin = frameTimestampMs - this.elapsed - deltaMs;
      this.lastFrameTimestamp = frameTimestampMs - deltaMs;
      this.needsResumeAnchor = false;
    }
    if (this.lastFrameTimestamp !== null && frameTimestampMs < this.lastFrameTimestamp - EPS) {
      this.flagQuality('non-monotonic-frame-clock');
      return this.snapshot;
    }
    if (this.origin === null) { this.origin = frameTimestampMs - deltaMs; this.initialOrigin = this.origin; }
    const actualFrameGap = this.lastFrameTimestamp === null ? deltaMs : frameTimestampMs - this.lastFrameTimestamp;
    const longFrame = Math.max(deltaMs, actualFrameGap) >= RULES.longFrameMs;
    if (longFrame) {
      this.invalidMs += Math.max(deltaMs, actualFrameGap);
      this.addFlag('long-frame>=1000ms', false);
    } else if (actualFrameGap > RULES.frameDropMs) this.addFlag('frame-drop>50ms', false);
    if (this.lastFrameTimestamp !== null && Math.abs(actualFrameGap - deltaMs) > 100) this.addFlag('frame-delta-clock-mismatch', false);
    const measurementValid = !longFrame && !this.nextIntervalInvalid;
    this.nextIntervalInvalid = false;
    const usedDelta = Math.min(deltaMs, this.config.durationMs - this.elapsed);
    if (measurementValid) this.played += usedDelta;
    this.elapsed = Math.min(this.config.durationMs, this.elapsed + usedDelta);
    this.lastFrameTimestamp = frameTimestampMs;
    if (isRaf) {
      const rafGap = this.lastRafTimestamp === null ? deltaMs : frameTimestampMs - this.lastRafTimestamp;
      if (rafGap > 0) {
        this.frameTimings.push({ timestampMs: frameTimestampMs, tMs: this.elapsed, deltaMs: rafGap,
          measurementValid: measurementValid && rafGap < RULES.longFrameMs && Math.abs(actualFrameGap - deltaMs) <= 100 });
        this.frames.push(rafGap); if (this.frames.length > 120) this.frames.shift();
      }
      this.lastRafTimestamp = frameTimestampMs;
    }
    this.steering = hasDrive(taskAt(this.config, this.elapsed - EPS)) ? Math.max(-1, Math.min(1, Number.isFinite(steer) ? steer : 0)) : 0;
    this.accumulator += usedDelta;
    while (this.accumulator + EPS >= RULES.fixedStepMs) {
      this.accumulator = Math.max(0, this.accumulator - RULES.fixedStepMs);
      this.fixedStep(measurementValid, steer);
    }
    this.updateTrial(frameTimestampMs);
    while (this.scheduleIndex < this.schedule.length && this.schedule[this.scheduleIndex]!.scheduledAtMs <= this.elapsed + EPS) {
      const scheduled = this.schedule[this.scheduleIndex++]!;
      if (scheduled.scheduledAtMs >= this.config.durationMs - EPS) continue;
      const mode = taskAt(this.config, scheduled.scheduledAtMs);
      if (mode === 'DRIVE_ONLY') continue;
      if (this.current && this.current.outcome === null) this.invalidateTrial(this.current, 'superseded-without-presentation');
      const target = targetForTime(this.config.worldId, scheduled.scheduledAtMs, this.config.seed);
      const alternatives = this.tokens.distractors.filter((entry) => entry.id !== target.id);
      const pool = alternatives.length ? alternatives : this.tokens.distractors;
      const token = scheduled.isTarget ? target : pool[Math.floor(this.random() * pool.length)]!;
      const trial: StimulusEvent = { ...scheduled, stimulusId: token.id, shape: token.shape, color: token.color,
        taskMode: mode, roadLevel: this.roadLevel, signLevel: this.signLevel, displayMs: this.displayMsFor(this.signLevel),
        responseWindowMs: responseWindow(this.signLevel), state: 'SCHEDULED', outcome: null,
        scheduledTimestampMs: this.origin + scheduled.scheduledAtMs, onsetDelayMs: null,
        submittedToGPUAtMs: frameTimestampMs, visibleFrameTimestampMs: null, hiddenFrameTimestampMs: null,
        visibleAtMs: null, responseAtMs: null, reactionTimeMs: null, qualityFlags: [] };
      this.trials.push(trial);
      const scheduledTimestamp = this.origin + scheduled.scheduledAtMs;
      if (frameTimestampMs - scheduledTimestamp > RULES.maxPresentationDelayMs + EPS || !measurementValid) {
        this.invalidateTrial(trial, 'missed-visible-frame');
        this.current = null;
      } else this.current = trial;
    }
    this.updateTrial(frameTimestampMs);
    return this.snapshot;
  }

  /** Call immediately AFTER rendering this stimulus, with the supplied rAF timestamp. */
  acknowledgePresentation(id: string, frameTimestampMs: number): void {
    const trial = this.current;
    if (!trial || trial.id !== id || trial.outcome === 'INVALID_PRESENTATION' || trial.visibleFrameTimestampMs !== null) return;
    const scheduledTimestamp = (this.origin ?? frameTimestampMs) + trial.scheduledAtMs;
    if (!Number.isFinite(frameTimestampMs) || frameTimestampMs < (trial.submittedToGPUAtMs ?? frameTimestampMs) - EPS || frameTimestampMs - scheduledTimestamp > RULES.maxPresentationDelayMs + EPS) {
      this.invalidateTrial(trial, 'late-or-invalid-presentation-ack'); return;
    }
    trial.visibleFrameTimestampMs = frameTimestampMs; trial.visibleAtMs = frameTimestampMs; trial.onsetDelayMs = frameTimestampMs - trial.scheduledTimestampMs; trial.state = 'SHOWN';
  }
  /** Records the first rendered frame WITHOUT this stimulus (not a photon timestamp). */
  acknowledgeHidden(id: string, frameTimestampMs: number): void {
    const trial = this.trials.find((entry) => entry.id === id);
    if (!trial || trial.visibleFrameTimestampMs === null || trial.hiddenFrameTimestampMs !== null || !Number.isFinite(frameTimestampMs)) return;
    if (frameTimestampMs < trial.visibleFrameTimestampMs + trial.displayMs - EPS) { trial.qualityFlags.push('premature-hide'); this.addFlag('stimulus-hidden-before-display-duration', true); return; }
    trial.hiddenFrameTimestampMs = frameTimestampMs;
    trial.state = trial.outcome === null ? 'HIDDEN' : 'CLOSED';
  }

  press(performanceTimestampMs: number, source: InputSource = 'keyboard'): void {
    if (this.finalRecord || this.paused || !Number.isFinite(performanceTimestampMs)) return;
    const event: InputEvent = { timestampMs: performanceTimestampMs, tMs: this.origin === null ? 0 : performanceTimestampMs - this.origin, source, trialId: null, outcome: 'PREMATURE' };
    const trial = this.current;
    if (!hasTarget(taskAt(this.config, this.elapsed)) || this.elapsed >= this.config.durationMs - EPS) event.outcome = 'IGNORED';
    else if (trial && trial.visibleFrameTimestampMs !== null && trial.outcome !== 'INVALID_PRESENTATION') {
      const onset = trial.visibleFrameTimestampMs; const end = onset + trial.responseWindowMs;
      const stillVisible = performanceTimestampMs < onset + trial.displayMs - EPS;
      if (performanceTimestampMs >= onset - EPS && performanceTimestampMs <= end + EPS) {
        event.trialId = trial.id;
        if (trial.responseAtMs !== null || trial.outcome !== null) event.outcome = 'REPEATED';
        else {
          trial.responseAtMs = performanceTimestampMs; trial.reactionTimeMs = Math.max(0, performanceTimestampMs - onset);
          trial.outcome = trial.isTarget ? 'HIT' : 'FALSE_ALARM'; event.outcome = trial.outcome;
          this.feedback = { tMs: event.tMs, kind: trial.outcome, text: trial.isTarget ? 'TARGET HIT' : 'DISTRACTOR' };
        }
      } else if (performanceTimestampMs > end + EPS && stillVisible) { event.outcome = 'LATE'; event.trialId = trial.id; }
    }
    this.inputs.push(event);
  }

  /** User pause is not a background-tab quality failure. The active trial alone is discarded. */
  pause(performanceTimestampMs: number): void {
    if (this.finalRecord || this.paused || !Number.isFinite(performanceTimestampMs)) return;
    if (this.lastFrameTimestamp !== null && performanceTimestampMs > this.lastFrameTimestamp + EPS) {
      // Account for the active fraction between the last rAF and the pause event,
      // so repeated pauses cannot accumulate an unlogged schedule-origin drift.
      this.advanceFrame(performanceTimestampMs - this.lastFrameTimestamp, this.steering, performanceTimestampMs, false);
    }
    this.paused = true;
    this.pauses.push({ startedTimestampMs: performanceTimestampMs, endedTimestampMs: null });
    if (this.current && (this.current.outcome === null || performanceTimestampMs <= (this.current.visibleFrameTimestampMs ?? performanceTimestampMs) + Math.max(this.current.displayMs, this.current.responseWindowMs))) {
      this.invalidateTrial(this.current, 'manual-pause');
    }
    this.current = null;
  }
  resume(performanceTimestampMs: number): void {
    if (this.finalRecord || !this.paused || !Number.isFinite(performanceTimestampMs)) return;
    const pause = this.pauses[this.pauses.length - 1]!;
    const gap = Math.max(0, performanceTimestampMs - pause.startedTimestampMs);
    pause.endedTimestampMs = performanceTimestampMs;
    if (this.origin !== null) this.origin += gap;
    this.lastFrameTimestamp = performanceTimestampMs;
    this.lastRafTimestamp = null;
    this.nextIntervalInvalid = false;
    this.paused = false;
    this.needsResumeAnchor = true;
  }

  flagQuality(reason: string): void {
    // A single slow frame is excluded from measurement rather than voiding the mission; only
    // events that genuinely break the measurement (hidden tab, lost GPU, clock jumps) are severe.
    const severe = /tab|hidden|invisible|context|gpu|resume|non.monotonic/i.test(reason);
    this.addFlag(reason, severe);
    if (severe) { this.nextIntervalInvalid = true; if (this.current && this.current.outcome === null) this.invalidateTrial(this.current, reason); }
  }
  private addFlag(reason: string, severe: boolean): void {
    if (!this.flags.some((flag) => flag.reason === reason && Math.abs(flag.tMs - this.elapsed) < 1000)) this.flags.push({ tMs: this.elapsed, reason, severe });
    if (severe) this.invalid = true;
  }
  private invalidateTrial(trial: StimulusEvent, reason: string): void {
    trial.outcome = 'INVALID_PRESENTATION'; trial.state = 'CLOSED';
    if (!trial.qualityFlags.includes(reason)) trial.qualityFlags.push(reason);
    this.addFlag(`invalid-presentation:${reason}`, false);
    // Final invalid-fraction classification uses the complete denominator.
    // Missing/paused trials never enter either task's adaptive evidence.
  }
  private updateTrial(now: number): void {
    const trial = this.current;
    if (!trial || trial.outcome === 'INVALID_PRESENTATION') return;
    if (trial.visibleFrameTimestampMs === null) {
      if (now - ((this.origin ?? now) + trial.scheduledAtMs) > RULES.maxPresentationDelayMs + EPS) this.invalidateTrial(trial, 'missing-presentation-ack');
      return;
    }
    const onset = trial.visibleFrameTimestampMs;
    if (now >= onset + trial.displayMs - EPS && trial.state === 'SHOWN') trial.state = trial.outcome === null ? 'HIDDEN' : 'CLOSED';
    if (now > onset + trial.responseWindowMs + EPS) {
      if (trial.outcome === null) {
        trial.outcome = trial.isTarget ? 'MISS' : 'CORRECT_REJECTION';
        if (trial.isTarget && hasTarget(trial.taskMode)) this.feedback = { tMs: this.elapsed, kind: 'MISS', text: 'MISSED TARGET' };
      }
      if (!this.notifiedTrials.has(trial.id) && hasTarget(trial.taskMode)) {
        this.notifiedTrials.add(trial.id);
        this.adapter.observeTarget(this.elapsed, trial.outcome === 'HIT' || trial.outcome === 'CORRECT_REJECTION', trial.isTarget);
      }
      if (now >= onset + trial.displayMs - EPS) trial.state = 'CLOSED';
    }
  }

  /**
   * Classic shows each stimulus for exactly the published 400ms. The game profile shortens
   * the display as the Sign level rises (520ms -> 300ms) so the token disappears sooner and
   * progressively faster, while the separate response window stays unchanged.
   */
  private displayMsFor(signLevel: number): number {
    if (this.config.mode !== 'OTC_HIGH_FIDELITY' || !this.config.challengeMode) return this.config.displayMs;
    const t = (Math.max(1, Math.min(RULES.signLevelCount, Math.round(signLevel))) - 1) / (RULES.signLevelCount - 1);
    return Math.round(RULES.stimulus.otcDisplayMaxMs - t * (RULES.stimulus.otcDisplayMaxMs - RULES.stimulus.otcDisplayMinMs));
  }

  private fixedStep(measurementValid: boolean, rawSteer: number): void {
    this.simElapsed += RULES.fixedStepMs;
    const taskMode = taskAt(this.config, this.simElapsed - RULES.fixedStepMs / 2);
    const steer = hasDrive(taskMode) ? Math.max(-1, Math.min(1, Number.isFinite(rawSteer) ? rawSteer : 0)) : 0;
    const dt = RULES.fixedStepMs / 1000;
    // Cleared events raise a lasting bonus; a collision adds a brief dip. Everything eases
    // in and out so the car never snaps between speeds.
    if (this.simElapsed >= this.dipUntil) this.dipFactor += (1 - this.dipFactor) * Math.min(1, dt * 6);
    const paceTarget = this.config.eventPaceEffects ? (1 + this.speedBonus) * this.dipFactor : 1;
    this.paceFactor += (paceTarget - this.paceFactor) * Math.min(1, dt * 4);
    const speed = roadSpeed(this.roadLevel) * this.paceFactor;
    const previousX = this.x;
    const previousProgress = this.progress;
    if (hasDrive(taskMode)) {
      const force = steeringForce(speed, this.config.challengeMode);
      const centreNow = roadCenter(this.progress, this.config.seed);
      if (this.config.steeringAssist === 'full') {
        // Opt-in easy mode: add the centre line's own lateral rate, so no input tracks the road.
        const follow = (roadCenter(this.progress + speed * 0.05, this.config.seed) - centreNow) / 0.05;
        const desiredVx = follow + steer * (force / 4) + (centreNow - this.x) * 1.2;
        this.vx += (desiredVx - this.vx) * Math.min(1, dt * 12);
      } else if (this.config.steeringAssist === 'center') {
        // Self-centering only: releasing the stick settles the car without steering curves for
        // you. The steady state is vx = steer*force/4 + 0.9*(offset), so the pull is gentle.
        this.vx += (steer * force + (centreNow - this.x) * 0.9 * 4 - this.vx * 4) * dt;
      } else {
        // The raw prototype model, kept for Classic comparability.
        this.vx += (steer * force - this.vx * 4) * dt;
      }
      this.x += this.vx * dt;
    }
    this.progress += speed * dt;
    const center = roadCenter(this.progress, this.config.seed);
    if (!hasDrive(taskMode)) { this.x = center; this.vx = 0; }
    let error = this.x - center;
    // Visual guardrails are a real boundary: the car cannot leave the road surface.
    // The scoring band stays narrower than the rail, so this only stops off-road driving.
    const railLimit = ROAD_HALF_WIDTH - CAR_HALF_WIDTH;
    if (this.config.mode !== 'NEURORACER_CLASSIC' && Math.abs(error) > railLimit) {
      this.x = center + (error > 0 ? railLimit : -railLimit);
      if (Math.sign(this.vx) === Math.sign(error)) this.vx *= -0.2;
      if (this.simElapsed >= this.wallCooldownUntil) {
        this.feedback = { tMs: this.simElapsed, kind: 'WALL', text: 'GUARDRAIL' };
        this.wallCooldownUntil = this.simElapsed + 900;
      }
      error = this.x - center;
    }
    const insideRoad = Math.abs(error) <= allowedHalfWidth(this.roadLevel, this.config.challengeMode);
    this.samples.push({ tMs: this.simElapsed, dtMs: RULES.fixedStepMs, taskMode, roadLevel: this.roadLevel, roadCenterX: center, carX: this.x, lateralOffset: error, insideRoad, measurementValid });
    if (measurementValid && taskMode === 'DUAL') {
      this.guideNavValidCount++;
      if (insideRoad) this.guideNavInsideCount++;
    }
    while (this.guideNavStartIndex < this.samples.length &&
      this.samples[this.guideNavStartIndex]!.tMs < this.simElapsed - RULES.guide.recentWindowMs) {
      const expired = this.samples[this.guideNavStartIndex++]!;
      if (expired.measurementValid && expired.taskMode === 'DUAL') {
        this.guideNavValidCount--;
        if (expired.insideRoad) this.guideNavInsideCount--;
      }
    }
    if (measurementValid && hasDrive(taskMode)) { this.validNavMs += RULES.fixedStepMs; if (insideRoad) this.insideNavMs += RULES.fixedStepMs; }
    for (const event of this.events) {
      if (event.passed || event.atDistance > this.progress) continue;
      const crossed = navigationEventCrossing(event, previousProgress, this.progress, previousX, this.x, this.config.seed);
      event.passed = true; event.passedAtMs = this.simElapsed - RULES.fixedStepMs * (1 - crossed.fraction);
      event.success = hasDrive(taskMode) && measurementValid ? crossed.success : null;
      if (event.success === null) continue;
      if (event.success) { this.eventStreak += 1; this.bestEventStreak = Math.max(this.bestEventStreak, this.eventStreak); }
      else this.eventStreak = 0;
      const effect = navigationEventEffect(event.kind, event.success);
      if (this.config.eventPaceEffects) {
        this.speedBonus = Math.max(0, Math.min(MAX_SPEED_BONUS, this.speedBonus + effect.bonusDelta));
        if (effect.dip < 1) { this.dipFactor = Math.min(this.dipFactor, effect.dip); this.dipUntil = this.simElapsed + effect.dipMs; }
        if (effect.lateralImpulse > 0) {
          const obstacleCenter = roadCenter(event.atDistance, this.config.seed) + event.roadOffset;
          const side = Math.sign(this.x - obstacleCenter) || 1;
          this.vx += side * effect.lateralImpulse;
        }
      }
      this.feedback = { tMs: this.simElapsed, kind: effect.feedback, text: effect.text };
    }
    if (this.simElapsed + EPS >= this.nextObservationMs) {
      const recent = this.samples.slice(this.navObservationStart); this.navObservationStart = this.samples.length;
      const valid = recent.filter((sample) => sample.measurementValid && hasDrive(sample.taskMode));
      const validMs = valid.reduce((sum, sample) => sum + sample.dtMs, 0);
      if (validMs) {
        const pathAccuracy = valid.reduce((sum, sample) => sum + (sample.insideRoad ? sample.dtMs : 0), 0) / validMs;
        // In the arcade challenge, successfully staying on the road but ignoring every
        // obstacle/gate is not mastery. Keep the published-style path-only metric separate.
        const recentEvents = this.config.challengeMode ? this.events.filter((event) =>
          event.success !== null && event.passedAtMs !== null &&
          event.passedAtMs <= this.nextObservationMs &&
          event.passedAtMs > this.nextObservationMs - RULES.continuous.navWindowMs
        ) : [];
        const eventRate = recentEvents.length >= 3 ?
          recentEvents.filter((event) => event.success).length / recentEvents.length : null;
        const observed = this.config.challengeMode ? (blendDriveScore(pathAccuracy, eventRate) ?? pathAccuracy) : pathAccuracy;
        this.adapter.observeNavigation(this.nextObservationMs, observed, validMs);
      }
      if (this.config.mode === 'OTC_HIGH_FIDELITY') {
        const changes = this.adapter.update(this.nextObservationMs, this.invalid);
        this.changes.push(...changes);
        this.roadLevel = this.adapter.skill.road.level; this.signLevel = this.adapter.skill.target.level;
      }
      this.nextObservationMs += RULES.continuous.samplingMs;
    }
    this.updateGuide(dt, insideRoad, measurementValid, taskMode);
  }

  private updateGuide(dt: number, insideRoad: boolean, measurementValid: boolean, taskMode: MissionSnapshot['taskMode']): void {
    if (this.config.mode !== 'OTC_HIGH_FIDELITY' || this.config.guidesCollected + this.captures.length >= RULES.guidesPerWorld) return;
    const now = this.simElapsed;
    const ordinal = this.config.guidesCollected + this.captures.length + 1;
    this.guide.offset = Math.sin(this.progress * 0.004) * (0.4 + ordinal * 0.025);
    if (this.guide.phase === 'CAPTURED') {
      if (now - this.guidePhaseAt > 1200) { this.guide.phase = 'HIDDEN'; this.guide.progress = 0; }
      return;
    }
    if (this.guide.phase === 'HIDDEN') {
      if (taskMode === 'DUAL' && now >= RULES.guide.firstApproachMs && now - this.lastCaptureAt >= RULES.guide.cooldownMs) { this.guide.phase = 'APPROACH'; this.guidePhaseAt = now; }
      return;
    }
    if (this.guide.phase === 'APPROACH') {
      if (now - this.guidePhaseAt >= RULES.guide.approachMs) this.guide.phase = 'LOCKABLE';
      return;
    }
    // Recent independent task evidence, not aggregate mission accuracy alone.
    const targetTrials = this.trials.filter((trial) => trial.taskMode === 'DUAL' && trial.scheduledAtMs >= now - RULES.guide.recentWindowMs && trial.outcome !== null && trial.outcome !== 'INVALID_PRESENTATION');
    const metric = targetingMetrics(targetTrials);
    const navMs = this.guideNavValidCount * RULES.fixedStepMs;
    const navAccuracy = this.guideNavValidCount ? this.guideNavInsideCount / this.guideNavValidCount : 0;
    const recentEvents = this.events.filter((event) => event.passedAtMs !== null && event.passedAtMs >= now - RULES.guide.recentWindowMs && event.success !== null);
    const eventsOkay = recentEvents.length === 0 || recentEvents.filter((event) => event.success).length / recentEvents.length >= (this.config.challengeMode ? RULES.guide.challengeMinEventRate : 0.5);
    const inRange = Math.abs(this.x - roadCenter(this.progress, this.config.seed) - this.guide.offset) <= RULES.guide.lockRange;
    const requiredNav = this.config.challengeMode ? RULES.guide.challengeMinNavAccuracy : RULES.guide.minAccuracy;
    // Report the single most relevant blocker so the HUD can tell the player what to fix.
    const blockers: string[] = [];
    if (taskMode !== 'DUAL') blockers.push('DUAL_TASK_ONLY');
    else if (!measurementValid || this.invalid) blockers.push('MEASUREMENT');
    else if (!insideRoad) blockers.push('OFF_LINE');
    else if (navMs < RULES.guide.minimumNavMs || navAccuracy < requiredNav) blockers.push('HOLD_YOUR_LINE');
    else if (!eventsOkay) blockers.push('CLEAR_THE_EVENTS');
    else if (metric.validTrials < RULES.guide.minimumTargetTrials || metric.targetTrials < RULES.guide.minimumTargets
      || metric.nonTargetTrials < RULES.guide.minimumNonTargets || (metric.accuracy ?? 0) < RULES.guide.minAccuracy
      || (metric.hitRate ?? 0) < RULES.guide.minAccuracy || (metric.falseAlarmRate ?? 1) > 1 - RULES.guide.minAccuracy + EPS) blockers.push('ANSWER_THE_SIGNS');
    else if (!inRange) blockers.push('STEER_TO_THE_RING');
    this.guide.blockedBy = blockers[0] ?? null;
    const eligible = blockers.length === 0;
    if (eligible) {
      this.guide.phase = 'LOCKING';
      this.guide.progress = Math.min(1, this.guide.progress + dt * 1000 / (RULES.guide.baseLockMs + (ordinal - 1) * RULES.guide.addedLockMs));
      if (this.guide.progress >= 1 - EPS) {
        this.guide.phase = 'CAPTURED'; this.guide.progress = 1; this.guidePhaseAt = now; this.lastCaptureAt = now;
        this.captures.push({ tMs: now, ordinal, roadLevel: this.roadLevel, signLevel: this.signLevel });
        this.guide.countCaptured = this.captures.length;
        this.feedback = { tMs: now, kind: 'GUIDE', text: 'GUIDE CAPTURED' };
      }
    } else if (this.guide.progress > 0) { this.guide.phase = 'LOST'; this.guide.progress = Math.max(0, this.guide.progress - dt * RULES.guide.decayPerSecond); }
    else this.guide.phase = 'LOCKABLE';
  }

  private missionGoals(): string[] {
    const goals: string[] = [];
    let streak = 0; let best = 0;
    for (const trial of this.trials.filter((entry) => hasTarget(entry.taskMode))) {
      if (trial.outcome === 'HIT') { streak++; best = Math.max(best, streak); }
      else if (trial.outcome === 'MISS' || trial.outcome === 'FALSE_ALARM') streak = 0;
    }
    if (best >= 10) goals.push('TEN_TARGET_STREAK');
    if (this.bestEventStreak >= 8) goals.push('CLEAN_EIGHT_EVENTS');
    if (this.events.filter((event) => event.kind === 'POWER_ZONE' && event.success).length >= 5) goals.push('FIVE_POWER_ZONES');
    if (this.captures.length) goals.push('CAPTURE_GUIDE');
    return goals;
  }
  private coinBreakdown(completed: boolean): CoinBreakdown {
    const resolved = this.events.filter((event) => event.passed && event.success !== null);
    const eventRate = resolved.length ? resolved.filter((event) => event.success).length / resolved.length : null;
    const path = this.validNavMs ? this.insideNavMs / this.validNavMs : null;
    const navigation = Math.round(20 * (blendDriveScore(path, eventRate) ?? 0)) + resolved.filter((event) => event.success).length * 2;
    const targeting = this.trials.filter((trial) => hasTarget(trial.taskMode) && trial.outcome === 'HIT').length;
    const guides = this.captures.length * 25; const goals = this.missionGoals().length * 10;
    const targetingMetric = targetingMetrics(this.trials.filter((trial) => hasTarget(trial.taskMode)));
    const classicDualAchievement = this.config.mode !== 'NEURORACER_CLASSIC' || this.config.taskMode !== 'DUAL'
      || (this.validNavMs > 0 && this.insideNavMs / this.validNavMs > 0.8 && (targetingMetric.accuracy ?? 0) > 0.8);
    const completion = completed && !this.invalid && classicDualAchievement ? 10 : 0;
    return { navigation, targeting, guides, goals, completion, total: navigation + targeting + guides + goals + completion };
  }

  finish(aborted = false): MissionRecord {
    if (this.finalRecord) return structuredClone(this.finalRecord);
    const completed = !aborted && this.elapsed >= this.config.durationMs - EPS;
    const now = this.lastFrameTimestamp ?? this.origin ?? 0;
    if (this.current) {
      this.updateTrial(now + (completed ? EPS * 2 : 0));
      if (this.current.outcome === null) this.invalidateTrial(this.current, completed ? 'missing-final-presentation' : 'mission-ended-before-response-window');
    }
    for (const trial of this.trials) {
      if (trial.outcome !== 'INVALID_PRESENTATION' && trial.visibleFrameTimestampMs !== null && trial.hiddenFrameTimestampMs === null) {
        trial.qualityFlags.push('hidden-frame-not-acknowledged');
        this.addFlag('hidden-frame-not-acknowledged', false);
      }
    }
    const summary = calculateSummary({ trials: this.trials, navigationSamples: this.samples, navigationEvents: this.events, qualityFlags: this.flags, measurementInvalid: this.invalid, invalidMs: this.invalidMs, elapsedMs: this.elapsed });
    this.invalid = summary.measurementQuality === 'INVALID';
    let finalRoadLevel = this.roadLevel; let finalSignLevel = this.signLevel;
    if (this.config.mode === 'NEURORACER_CLASSIC' && completed) {
      const next = updateClassic({ roadLevel: this.roadLevel, signLevel: this.signLevel }, summary, this.config.durationMs, this.invalid);
      const push = (axis: 'ROAD' | 'SIGN', oldLevel: number, newLevel: number): void => { if (oldLevel !== newLevel) this.changes.push({ tMs: this.elapsed, axis, oldLevel, newLevel, metricWindowStartMs: 0, metricWindowEndMs: this.elapsed, evidence: 'RECONSTRUCTED_CLASSIC', reason: 'end-of-run proportional staircase; sufficient valid evidence' }); };
      push('ROAD', this.roadLevel, next.roadLevel); push('SIGN', this.signLevel, next.signLevel);
      finalRoadLevel = next.roadLevel; finalSignLevel = next.signLevel;
    }
    const realRewards = completed && !this.invalid && this.config.mode === 'OTC_HIGH_FIDELITY'
      ? this.coinBreakdown(true)
      : { navigation: 0, targeting: 0, guides: 0, goals: 0, completion: 0, total: 0 };
    const start = Date.parse(this.config.startedAt);
    const wallElapsed = this.initialOrigin !== null && this.lastFrameTimestamp !== null ? Math.max(0, this.lastFrameTimestamp - this.initialOrigin) : this.elapsed;
    this.finalRecord = { id: this.config.sessionId, schemaVersion: 1, config: { ...this.config }, startedAt: this.config.startedAt,
      endedAt: Number.isFinite(start) ? new Date(start + wallElapsed).toISOString() : this.config.startedAt,
      elapsedMs: this.elapsed, playedMs: this.played, completed, aborted: !completed, measurementInvalid: this.invalid,
      performanceOriginMs: this.initialOrigin, pauses: structuredClone(this.pauses),
      frameTimings: structuredClone(this.frameTimings), performance: performanceMetrics(this.frameTimings),
      trials: structuredClone(this.trials), inputs: structuredClone(this.inputs), navigationSamples: structuredClone(this.samples),
      navigationEvents: structuredClone(this.events), adaptiveChanges: structuredClone(this.changes), qualityFlags: structuredClone(this.flags),
      guideCaptures: structuredClone(this.captures), summary, coins: realRewards, finalRoadLevel, finalSignLevel, goals: this.missionGoals() };
    return structuredClone(this.finalRecord);
  }
}
