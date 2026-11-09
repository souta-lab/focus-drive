import type { PlayerProfile, MissionRecord } from '../core/types';

export interface AppSettings {
  sound: boolean;
  reducedMotion: boolean;
  sensitivity: number;
  quality: 'low' | 'high';
  inputMode: 'keyboard' | 'touch' | 'tilt' | 'gamepad';
  mode: 'OTC_HIGH_FIDELITY' | 'NEURORACER_CLASSIC' | 'ARCADE_DRIVE';
  classicRatio: number;
  challengeMode: boolean;
  tiltNeutral: number;
  /** Night lighting in every world. On by default; it also measured lighter than daylight. */
  nightDriving: boolean;
  /** Events build a lasting speed bonus; can be switched off for a fixed pace. */
  eventPaceEffects: boolean;
  /** Mission length for OTC modes: 3, 10 or 30 minutes. Classic is always 180s. */
  missionDurationMs: number;
  /** 'full' follows the road for you, 'center' only self-centres, 'manual' is raw. */
  steeringAssist: 'full' | 'center' | 'manual';
}
export const DEFAULT_SETTINGS: AppSettings = {
  nightDriving: true,
  eventPaceEffects: true,
  missionDurationMs: 180_000,
  steeringAssist: 'center',
  sound: true, reducedMotion: false, sensitivity: 1, quality: 'high', inputMode: 'keyboard',
  mode: 'OTC_HIGH_FIDELITY', classicRatio: 1 / 3, challengeMode: true, tiltNeutral: 0,
};
const DB_NAME = 'focus-drive-v1';
let dbPromise: Promise<IDBDatabase> | null = null;
export let storageMode: 'indexeddb' | 'fallback' = 'indexeddb';
function database(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile');
      if (!db.objectStoreNames.contains('missions')) db.createObjectStore('missions', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('別のタブでデータベースを使用中です。'));
  });
  return dbPromise;
}
async function transact<T>(store: string, mode: IDBTransactionMode, operation: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = operation(tx.objectStore(store));
    let result: T;
    req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result!);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('保存を中止しました。'));
  });
}
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const finiteOrNull = (v: unknown): boolean => v === null || typeof v === 'number' && Number.isFinite(v);
function isRecord(value: unknown): value is MissionRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as MissionRecord;
  const t = r.summary?.targeting, n = r.summary?.navigation;
  return r.schemaVersion === 1 && typeof r.id === 'string' && Number.isFinite(Date.parse(r.startedAt))
    && [1, 2, 3, 4].includes(r.config?.worldId)
    && ['OTC_HIGH_FIDELITY', 'NEURORACER_CLASSIC', 'ARCADE_DRIVE'].includes(r.config?.mode)
    && ['BASELINE', 'TRAINING', 'CHALLENGE', 'CALIBRATION', 'ARCADE'].includes(r.config?.missionType)
    && Number.isFinite(r.elapsedMs) && Number.isFinite(r.playedMs) && Array.isArray(r.trials)
    && r.trials.every(trial => trial && typeof trial.id === 'string' && isStrings(trial.qualityFlags))
    && Array.isArray(r.inputs) && Array.isArray(r.navigationSamples) && Array.isArray(r.navigationEvents)
    && Array.isArray(r.adaptiveChanges) && Array.isArray(r.qualityFlags) && Array.isArray(r.guideCaptures)
    && isStrings(r.goals) && Number.isFinite(r.coins?.total) && !!t && !!n && !!r.summary.threshold
    && ['GOOD', 'LIMITED', 'INVALID'].includes(r.summary.measurementQuality)
    && finiteOrNull(r.summary.navigationAccuracy) && finiteOrNull(r.summary.targetingAccuracy)
    && finiteOrNull(r.summary.dPrime) && finiteOrNull(r.summary.hitReactionTimeMedianMs)
    && Number.isFinite(t.hits) && Number.isFinite(t.misses) && Number.isFinite(t.falseAlarms)
    && Number.isFinite(t.correctRejections) && Number.isFinite(t.validTrials)
    && !!t.reactionTime && finiteOrNull(t.reactionTime.medianMs) && finiteOrNull(t.reactionTime.p90Ms)
    && Number.isFinite(n.eventsSucceeded) && Number.isFinite(n.eventsPassed) && !!r.summary.multitaskCost;
}
export function isProfile(value: unknown): value is PlayerProfile {
  try {
    if (!value || typeof value !== 'object') return false;
    const p = value as PlayerProfile;
    return p.schemaVersion === 1 && typeof p.id === 'string' && Number.isFinite(p.coins) && p.coins >= 0
      && [1, 2, 3, 4].includes(p.selectedWorld) && Array.isArray(p.history) && p.history.every(isRecord)
      && isStrings(p.ownedPaints) && isStrings(p.ownedCars) && isStrings(p.ownedWheels) && isStrings(p.ownedDecals)
      && isStrings(p.appliedMissionIds) && isStrings(p.completedGoals) && Array.isArray(p.indexHistory)
      && (p.progressedMissionIds === undefined || isStrings(p.progressedMissionIds))
      && [p.selectedCar, p.selectedPaint, p.selectedWheels, p.selectedDecal].every(v => typeof v === 'string')
      && Number.isInteger(p.completedMissions) && p.completedMissions >= 0 && Number.isFinite(p.totalPlayedMs)
      && Number.isInteger(p.indexMissionProgress) && p.indexMissionProgress >= 0 && p.indexMissionProgress < 15
      && (p.focusIndex === null || !!p.focusIndex && finiteOrNull(p.focusIndex.score))
      && p.indexHistory.every(i => i && finiteOrNull(i.score))
      && !!p.missionMinutesByDay && typeof p.missionMinutesByDay === 'object'
      && Object.values(p.missionMinutesByDay).every(v => Number.isFinite(v) && v >= 0)
      && [1, 2, 3, 4].every(id => {
        const w = p.worlds?.[id as 1 | 2 | 3 | 4];
        return !!w && typeof w.unlocked === 'boolean' && typeof w.baselineComplete === 'boolean'
          && Number.isInteger(w.guides) && w.guides >= 0 && w.guides <= 15
          && Number.isFinite(w.roadLevel) && w.roadLevel >= 1 && w.roadLevel <= 200
          && Number.isFinite(w.signLevel) && w.signLevel >= 1 && w.signLevel <= 54
          && Number.isFinite(w.trainingSinceChallenge) && Number.isFinite(w.trainingCompleted)
          && Number.isFinite(w.challengesCompleted) && Array.isArray(w.guideCollection);
      });
  } catch { return false; }
}
export async function loadProfile(): Promise<PlayerProfile | null> {
  try {
    const profile = await transact<unknown>('profile', 'readonly', s => s.get('player'));
    return isProfile(profile) ? profile : null;
  } catch {
    storageMode = 'fallback';
    try {
      const profile: unknown = JSON.parse(localStorage.getItem('focus-drive-profile') || 'null');
      return isProfile(profile) ? profile : null;
    } catch { return null; }
  }
}
export async function saveProfile(profile: PlayerProfile): Promise<void> {
  if (storageMode === 'fallback') { localStorage.setItem('focus-drive-profile', JSON.stringify(profile)); return; }
  await transact('profile', 'readwrite', s => s.put(profile, 'player'));
}
export async function saveMission(record: MissionRecord): Promise<void> {
  if (storageMode === 'fallback') return; // Full raw history is also in the profile fallback.
  await transact('missions', 'readwrite', s => s.put(record));
}
export function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(localStorage.getItem('focus-drive-settings') || '{}') as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      // Sound is on by default; only an explicit opt-out stored by the player disables it.
      nightDriving: raw.nightDriving !== false,
      eventPaceEffects: raw.eventPaceEffects !== false,
      missionDurationMs: [180_000, 600_000, 1_800_000].includes(Number(raw.missionDurationMs)) ? Number(raw.missionDurationMs) : 180_000,
      steeringAssist: raw.steeringAssist === 'full' || raw.steeringAssist === 'manual' ? raw.steeringAssist : 'center',
      sound: raw.sound !== false,
      reducedMotion: raw.reducedMotion === true,
      sensitivity: Math.min(2, Math.max(0.4, Number(raw.sensitivity) || 1)),
      quality: raw.quality === 'low' ? 'low' : 'high',
      inputMode: ['keyboard', 'touch', 'tilt', 'gamepad'].includes(raw.inputMode || '') ? raw.inputMode! : 'keyboard',
      mode: ['OTC_HIGH_FIDELITY', 'NEURORACER_CLASSIC', 'ARCADE_DRIVE'].includes(raw.mode || '') ? raw.mode! : 'OTC_HIGH_FIDELITY',
      classicRatio: raw.classicRatio === 0.5 ? 0.5 : 1 / 3,
      challengeMode: raw.challengeMode !== false,
      tiltNeutral: Number.isFinite(raw.tiltNeutral) ? raw.tiltNeutral! : 0,
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(settings: AppSettings): void {
  localStorage.setItem('focus-drive-settings', JSON.stringify(settings));
}
export function downloadJson(filename: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadCsv(filename: string, records: MissionRecord[]): void {
  const columns = ['missionId', 'world', 'mode', 'task', 'trialId', 'scheduledAtMs', 'visibleFrameTimestampMs', 'hiddenFrameTimestampMs', 'responseAtMs', 'responseWindowMs', 'displayMs', 'isTarget', 'outcome', 'reactionTimeMs', 'roadLevel', 'signLevel', 'qualityFlags'];
  const rows = records.flatMap(r => r.trials.map(t => [r.id, r.config.worldId, r.config.mode, t.taskMode, t.id, t.scheduledAtMs, t.visibleFrameTimestampMs, t.hiddenFrameTimestampMs, t.responseAtMs, t.responseWindowMs, t.displayMs, t.isTarget, t.outcome, t.reactionTimeMs, t.roadLevel, t.signLevel, t.qualityFlags.join(';')]));
  const text = [columns, ...rows].map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function localDayKey(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
