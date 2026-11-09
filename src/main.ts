import './ui/style.css';
import { MissionEngine, createProfile, nextMission, applyMission, getWorld, allowedHalfWidth, classicLevelsFor } from './core';
import type { MissionConfig, MissionRecord, MissionSnapshot, MissionType, PlayerProfile, TaskMode, WorldId } from './core';
import type { DriveRenderer, RenderState } from './render';
import { DEFAULT_SETTINGS, downloadCsv, downloadJson, isProfile, loadProfile, loadSettings, localDayKey, saveMission, saveProfile, saveSettings, storageMode } from './persistence/store';
import type { AppSettings } from './persistence/store';
import { account, validateCredentials, type AccountState } from './persistence/account';
import { DriveAudio, InputController, type AudioCue } from './ui/input';
import { icon, esc } from './ui/icons';
import { briefModal, collectionView, detailMarkup, garageView, homeView, insightsView, missionHud, modal, PAINTS, pct, resultView, settingsModal, shell, taskNames, tokenMarkup } from './ui/views';

type View = 'home' | 'garage' | 'collection' | 'insights' | 'mission' | 'result';
const app = document.querySelector<HTMLDivElement>('#app')!;
const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
let profile: PlayerProfile = await loadProfile() ?? createProfile();
// One-time grant: the open-wheel Focus F-01 is the free default machine since v0.1.1.
if (!profile.ownedCars.includes('roadster')) { profile.ownedCars.push('roadster'); profile.selectedCar = 'roadster'; }
let settings = loadSettings();
let view: View = 'home';
let renderer: DriveRenderer | null = null;
let engine: MissionEngine | null = null;
let lastRecord: MissionRecord | null = null;
let paused = false;
let isFinishing = false;
let lastFrame: number | null = null;
let lastVisibleId: string | null = null;
let lastStimulusKey = '';
let lastTargetKey = '';
let lastTask = '';
let taskNoticeUntil = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let previousFocus: HTMLElement | null = null;
let activeCalibration = false;
let animationTime = 0;
let diagnosticControl: ((snapshot: MissionSnapshot, timestamp: number) => number) | null = null;
let preparingUntil: number | null = null;
let preparationFrames = 0;
let pendingConfig: MissionConfig | null = null;
// Accounts are optional: this stays empty unless the player signs in from the settings panel.
let accountState: AccountState = { user: null, busy: false, error: null, notice: null };
// Generated when the brief opens so the briefing can name the exact token this run asks for.
let preparedSeed: number | null = null;
let calibrationDeviceId = 'keyboard-uncalibrated';
try { calibrationDeviceId = localStorage.getItem('focus-drive-calibration-id') ?? calibrationDeviceId; } catch { /* Private browsing may deny optional settings storage. */ }
const input = new InputController(() => settings);
const audio = new DriveAudio();
const modeLabel = () => settings.mode === 'NEURORACER_CLASSIC' ? 'NeuroRacer Classic' : settings.mode === 'ARCADE_DRIVE' ? 'Arcade Drive' : 'OTC High Fidelity';
const nextType = (): MissionType => nextMission(profile).missionType!;

function toast(message: string): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message; el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}
async function persist(record?: MissionRecord): Promise<void> {
  try {
    if (record) await saveMission(record);
    await saveProfile(profile);
  } catch (error) { console.error('Local save failed', error); toast('保存できませんでした。バックアップJSONをダウンロードしてください。'); }
}
function sceneFor(current: View): 'hub' | 'mission' | 'garage' { return current === 'mission' ? 'mission' : current === 'garage' ? 'garage' : 'hub'; }
function applyCosmetics(): void {
  renderer?.setPaint((PAINTS.find(x => x.id === profile.selectedPaint) ?? PAINTS[0]).hex);
  renderer?.setCar(profile.selectedCar === 'roadster' ? 'roadster' : 'concept');
  renderer?.setWheels(profile.selectedWheels === 'sport' ? 'sport' : 'standard');
  renderer?.setDecal(profile.selectedDecal === 'stripe' ? 'stripe' : 'none');
  renderer?.setNight(settings.nightDriving);
}
function renderView(): void {
  document.body.dataset.view = view;
  document.body.dataset.reduced = String(settings.reducedMotion);
  if (view !== 'mission') { document.body.classList.remove('fx-surge', 'fx-power', 'fx-impact', 'fx-wall', 'fx-gate', 'fx-hit', 'fx-miss'); lastCueTMs = -1; }
  input.active = view === 'mission' && !paused && preparingUntil === null;
  if (view === 'mission') {
    app.innerHTML = missionHud(); canvas.hidden = false;
    if (preparingUntil !== null) app.insertAdjacentHTML('beforeend', '<div class="countdown" id="countdown"><strong id="countdown-number">3</strong><span>SETTLE IN. FIND YOUR FLOW.</span><p>描画を準備中 · ミッション時間には含まれません</p></div>');
    renderer?.setScene('mission');
    lastStimulusKey = ''; lastTargetKey = ''; lastTask = ''; lastVisibleId = null;
  } else {
    const content = view === 'home' ? homeView(profile, nextType(), settings)
      : view === 'garage' ? garageView(profile)
      : view === 'collection' ? collectionView(profile)
      : view === 'insights' ? insightsView(profile)
      : lastRecord ? resultView(lastRecord, profile) : homeView(profile, nextType(), settings);
    app.innerHTML = shell(profile, view === 'result' ? 'home' : view, content);
    canvas.hidden = !['home', 'garage'].includes(view);
    renderer?.setScene(view === 'garage' ? 'garage' : 'hub');
  }
  renderer?.setWorld(profile.selectedWorld); applyCosmetics();
  requestAnimationFrame(() => renderer?.resize());
}
function navigate(next: View): void {
  if (view === 'mission') return;
  view = next; closeModal(); renderView(); window.scrollTo({ top: 0 });
}
function showModal(markup: string): void {
  const root = document.getElementById('modal-root'); if (!root) return;
  previousFocus = document.activeElement as HTMLElement;
  root.innerHTML = markup;
  requestAnimationFrame(() => root.querySelector<HTMLElement>('button:not(.modal-close),select,input,a')?.focus());
}
function closeModal(): void {
  const root = document.getElementById('modal-root'); if (root) root.innerHTML = '';
  previousFocus?.focus(); previousFocus = null;
}
function showBrief(calibration = false): void {
  activeCalibration = calibration;
  preparedSeed = crypto.getRandomValues(new Uint32Array(1))[0]!;
  showModal(briefModal(profile, nextType(), settings, calibration, preparedSeed));
}
function deviceFingerprint(): string {
  return `${settings.inputMode}-${screen.width}x${screen.height}-${devicePixelRatio}-${settings.quality}-${calibrationDeviceId}`;
}

/** Refreshes the settings dialog in place after an account action completes. */
function refreshAccountModal(): void {
  if (document.getElementById('account-panel')) showModal(settingsModal(settings, accountState));
}
async function runAccountAction(action: () => Promise<string>): Promise<void> {
  accountState = { ...accountState, busy: true, error: null, notice: null, draftEmail: accountCredentials().email };
  refreshAccountModal();
  try {
    const notice = await action();
    accountState = { ...accountState, busy: false, notice };
  } catch (error) {
    accountState = { ...accountState, busy: false, error: error instanceof Error ? error.message : '通信に失敗しました' };
  }
  refreshAccountModal();
}
function accountCredentials(): { email: string; password: string } {
  const email = (document.getElementById('account-email') as HTMLInputElement | null)?.value ?? '';
  const password = (document.getElementById('account-password') as HTMLInputElement | null)?.value ?? '';
  return { email, password };
}
async function startMission(calibration: boolean, quickDual = false): Promise<void> {
  if (view === 'mission' || isFinishing) return;
  if (!renderer) { toast('3Dシーンを準備中です。WebGL2が利用可能なブラウザでお待ちください。'); return; }
  const choice = document.getElementById('task-choice') as HTMLSelectElement | null;
  const requestedTask = (choice?.value || 'DUAL') as TaskMode;
  const config: MissionConfig = {
    ...nextMission(profile),
    mode: settings.mode, startedAt: new Date().toISOString(), dayKey: localDayKey(),
    deviceCalibrationId: deviceFingerprint(), targetRatio: settings.classicRatio, challengeMode: settings.challengeMode, eventPaceEffects: settings.eventPaceEffects, steeringAssist: settings.steeringAssist,
    // Classic ignores this and stays at the published 180s run.
    durationMs: settings.mode === 'NEURORACER_CLASSIC' ? undefined : settings.missionDurationMs,
    // A new actual play attempt must not repeat the previous one after an abort.
    // The chosen seed is persisted in MissionRecord for deterministic replay/debugging.
    seed: preparedSeed ?? crypto.getRandomValues(new Uint32Array(1))[0]!,
  };
  if (settings.mode === 'NEURORACER_CLASSIC') { config.missionType = calibration ? 'CALIBRATION' : 'TRAINING'; config.taskMode = requestedTask; }
  if (settings.mode === 'ARCADE_DRIVE') { config.missionType = 'ARCADE'; config.taskMode = 'DRIVE_ONLY'; }
  if (calibration) { config.mode = 'NEURORACER_CLASSIC'; config.missionType = 'CALIBRATION'; config.taskMode = requestedTask; }
  if (config.mode === 'NEURORACER_CLASSIC') {
    const levels = classicLevelsFor(profile, profile.selectedWorld, config.taskMode ?? 'DUAL', config.deviceCalibrationId);
    config.roadLevel = levels.roadLevel; config.signLevel = levels.signLevel;
  }
  if (quickDual) {
    // Immediate advanced dual-task practice. No progression/coins; Baseline protocol untouched.
    config.mode = 'OTC_HIGH_FIDELITY'; config.missionType = 'TRAINING';
    config.taskMode = 'DUAL'; config.testHarness = true; config.challengeMode = true;
    config.roadLevel = Math.max(45, config.roadLevel ?? 20);
    config.signLevel = Math.max(35, config.signLevel ?? 29);
  }
  pendingConfig = config;
  engine = new MissionEngine(config);
  preparingUntil = performance.now() + 3000; preparationFrames = 0; diagnosticControl = null;
  paused = false; lastFrame = null; isFinishing = false; input.reset();
  view = 'mission'; closeModal(); renderView();
  preparedSeed = null;
  if (settings.sound) await audio.start();
  canvas.focus();
}
function setText(id: string, value: string): void { const el = document.getElementById(id); if (el && el.textContent !== value) el.textContent = value; }
let lastCueTMs = -1;
let fxTimer = 0;
const cueFor = (kind: string): AudioCue => kind === 'HIT' ? 'HIT' : kind === 'MISS' ? 'MISS' : kind === 'FALSE_ALARM' ? 'FALSE_ALARM'
  : kind === 'POWER' ? 'POWER' : kind === 'IMPACT' ? 'IMPACT' : kind === 'WALL' ? 'WALL' : kind === 'GUIDE' ? 'GUIDE'
  : kind === 'NAV_SUCCESS' ? 'GATE' : 'NAV';
function pulseFx(kind: string): void {
  const cls = kind === 'HIT' ? 'fx-hit' : kind === 'MISS' || kind === 'FALSE_ALARM' || kind === 'NAV_FAILURE' ? 'fx-miss'
    : kind === 'POWER' ? 'fx-power' : kind === 'IMPACT' ? 'fx-impact' : kind === 'WALL' ? 'fx-wall' : 'fx-gate';
  document.body.classList.remove('fx-hit', 'fx-miss', 'fx-power', 'fx-impact', 'fx-wall', 'fx-gate');
  void document.body.offsetWidth;
  document.body.classList.add(cls);
  window.clearTimeout(fxTimer);
  fxTimer = window.setTimeout(() => document.body.classList.remove(cls), 430);
}
function updateHud(s: MissionSnapshot, timestamp: number): void {
  const remaining = Math.max(0, Math.ceil((s.durationMs - s.elapsedMs) / 1000));
  setText('mission-time', `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`);
  setText('mission-stage', s.taskMode === 'DUAL' ? 'DUAL TASK' : s.taskMode === 'DRIVE_ONLY' ? 'DRIVE ONLY' : 'TARGET ONLY');
  const progress = document.getElementById('mission-progress'); if (progress) progress.style.width = `${s.elapsedMs / s.durationMs * 100}%`;
  if (lastTask !== s.taskMode) {
    lastTask = s.taskMode; taskNoticeUntil = timestamp + 3500;
    setText('task-notice', s.taskMode === 'DRIVE_ONLY' ? '運転のみ · A / D でPower ZoneとGateを通過、障害物を回避' : s.taskMode === 'SIGN_ONLY' ? 'ターゲットのみ · 車は自動追従。正しいTargetだけに反応' : '同時課題 · 運転しながら、正しいTargetだけに反応');
  }
  document.getElementById('task-notice')?.classList.toggle('show', timestamp < taskNoticeUntil);
  const targetKey = `${s.target.id}`;
  if (targetKey !== lastTargetKey) {
    const target = document.getElementById('target-mini'); if (target) target.innerHTML = tokenMarkup(s.target, 22);
    setText('target-label', s.target.label); lastTargetKey = targetKey;
  }
  const trial = s.currentStimulus; const show = trial?.visible === true;
  const stim = document.getElementById('stimulus');
  if (stim) {
    const key = show ? `${trial.id}-${trial.shape}-${trial.color}` : '';
    if (key !== lastStimulusKey) {
      if (show) stim.innerHTML = tokenMarkup(trial, 58);
      stim.dataset.visible = String(show);
      lastStimulusKey = key;
    }
  }
  setText('nav-live', pct(s.driveScore ?? s.navAccuracy)); setText('event-live', pct(s.eventAccuracy)); setText('target-live', pct(s.targetAccuracy));
  setText('levels-live', `R${s.roadLevel} · T${s.signLevel}${s.paceFactor > 1.04 ? ' · SURGE' : s.paceFactor < 0.96 ? ' · RECOVER' : ''}`);
  setText('fps-label', s.fps ? `${Math.round(s.fps)} FPS` : '');
  setText('quality-label', s.measurementInvalid ? 'QUALITY FLAG · 計測要確認' : engine?.config.testHarness ? 'PRACTICE · 報酬対象外' : 'RECORDING LOCALLY');
  const feedback = s.lastFeedback; const recent = feedback && s.elapsedMs - feedback.tMs < 800;
  if (feedback && feedback.tMs !== lastCueTMs) {
    lastCueTMs = feedback.tMs;
    audio.cue(cueFor(feedback.kind));
    pulseFx(feedback.kind);
  }
  document.body.classList.toggle('fx-surge', s.paceFactor > 1.05);
  const f = document.getElementById('feedback');
  if (f) {
    f.classList.toggle('visible', !!recent);
    f.classList.toggle('error', feedback?.kind === 'MISS' || feedback?.kind === 'FALSE_ALARM' || feedback?.kind === 'NAV_FAILURE' || feedback?.kind === 'IMPACT' || feedback?.kind === 'WALL');
    if (recent) f.textContent = feedback.text;
  }
  updateInstruments(s);
  const g = s.guide;
  document.getElementById('guide-hud')?.classList.toggle('active', !['HIDDEN'].includes(g.phase));
  const hint = (g.phase === 'LOCKING' || g.phase === 'LOCKABLE')
    ? ({ HOLD_YOUR_LINE: 'ラインを維持', ANSWER_THE_SIGNS: 'サインに反応', CLEAR_THE_EVENTS: 'イベントを通過', STEER_TO_THE_RING: 'リングへ寄る', OFF_LINE: '車線へ戻る' } as Record<string, string>)[g.blockedBy ?? ''] ?? ''
    : '';
  setText('guide-hint', hint);
  setText('guide-phase', ({ APPROACH: 'GUIDE APPROACHING', LOCKABLE: 'KEEP BOTH TASKS IN FOCUS', LOCKING: 'AUTO LOCK · HOLD YOUR LINE', CAPTURED: 'GUIDE CAPTURED', LOST: 'LOCK LOST · FIND YOUR FLOW', HIDDEN: '' })[g.phase]);
  const guideProgress = document.getElementById('guide-progress'); if (guideProgress) guideProgress.style.width = `${g.progress * 100}%`;
  setText('guide-percent', `${Math.round(g.progress * 100)}%`);
}
/** AT gearbox + tachometer. Purely presentational: it never feeds the simulation. */
const GEAR_COUNT = 8;
const TOP_KMH = 316;
const IDLE_RPM = 1250;
const REDLINE_RPM = 8200;
let lastGear = 0;
let currentRpm = IDLE_RPM;
function updateInstruments(s: MissionSnapshot): void {
  const kmh = Math.max(0, s.forwardSpeed * 3.6);
  const band = TOP_KMH / GEAR_COUNT;
  const gear = Math.min(GEAR_COUNT, Math.max(1, Math.floor(kmh / band) + 1));
  const inGear = Math.max(0, Math.min(1, (kmh - (gear - 1) * band) / band));
  // A small hysteresis keeps the readout from flickering on the boundary.
  const shownGear = Math.abs(kmh - lastGear * band) < 2 ? lastGear : gear;
  lastGear = shownGear;
  setText('speed-value', String(Math.round(kmh)));
  setText('gear-value', kmh < 1 ? 'N' : String(shownGear));
  const sweep = Math.max(0, Math.min(1, (kmh - (shownGear - 1) * band) / band));
  // Automatic gearbox: revs sweep up inside each gear and drop on the upshift.
  currentRpm = kmh < 1 ? IDLE_RPM : Math.round(IDLE_RPM + sweep * (REDLINE_RPM - IDLE_RPM));
  const fill = document.getElementById('tach-fill');
  if (fill) fill.style.strokeDashoffset = String(151 * (1 - sweep * 0.97));
  const needle = document.getElementById('tach-needle');
  if (needle) needle.style.transform = `rotate(${-90 + 180 * sweep}deg)`;
  document.getElementById('instrument-cluster')?.classList.toggle('redline', sweep > 0.86);
  document.body.classList.toggle('fx-velocity', kmh > 175);
  document.body.classList.toggle('fx-velocity-max', kmh > 265);
}

function renderState(s: MissionSnapshot): RenderState {
  return { time: s.elapsedMs / 1000, progressS: s.progressS, carX: s.carX, carVX: settings.reducedMotion ? 0 : s.carVX,
    roadCenterX: s.roadCenterX, steer: s.steer, forwardSpeed: s.forwardSpeed,
    worldId: s.worldId, roadLevel: s.roadLevel, navEvents: s.navEvents, guide: s.guide,
    seed: engine!.config.seed, allowedHalfWidth: allowedHalfWidth(s.roadLevel, engine!.config.challengeMode) };
}
async function finishMission(aborted = false): Promise<void> {
  if (!engine || isFinishing) return;
  isFinishing = true; input.active = false; input.reset(); audio.quiet();
  const record = engine.finish(aborted);
  lastRecord = record;
  const previousWorlds = Object.values(profile.worlds).filter(w => w.unlocked).length;
  const previousIndex = profile.indexHistory.length;
  profile = applyMission(profile, record);
  engine = null; paused = false; lastFrame = null; preparingUntil = null; pendingConfig = null;
  await persist(record);
  view = 'result'; renderView(); window.scrollTo({ top: 0 }); isFinishing = false;
  if (Object.values(profile.worlds).filter(w => w.unlocked).length > previousWorlds) toast('新しいWorldを解放しました。次の景色へ！');
  else if (profile.indexHistory.length > previousIndex) toast('15ミッション達成。新しいFocusDrive Indexを更新しました。');
}
function pauseMission(reason = 'manual-pause'): void {
  if (!engine || paused || isFinishing) return;
  paused = true; input.active = false; input.reset(); audio.quiet();
  engine.pause(performance.now());
  if (reason !== 'manual-pause') engine.flagQuality(reason);
  const stim = document.getElementById('stimulus'); if (stim) stim.dataset.visible = 'false';
  lastStimulusKey = ''; lastVisibleId = null;
  showModal(modal('Take a breath.', `<div class="modal-eyebrow">PAUSED / 一時停止</div><p>${reason === 'manual-pause' ? '立ち止まっても、大丈夫。<br>一時停止中はミッション時間に含まれません。' : 'タブの非表示・描画状態の変化を検出しました。<br>再開できますが、このランは計測不成立として記録します。'}</p><div class="target-brief"><span>${tokenMarkup(engine.snapshot.target, 42)}</span><p>${esc(engine.snapshot.target.label)} だけに反応</p></div><div class="pause-actions"><button class="primary-button" data-action="resume">${icon('play')} ドライブを再開</button><button class="outline-button" data-action="abort">中断して記録する</button></div>`, '', 'pause-modal'));
}
function resumeMission(): void {
  if (!engine || !paused) return;
  closeModal(); engine.resume(performance.now()); paused = false; lastFrame = null; input.active = preparingUntil === null;
  lastVisibleId = null; lastStimulusKey = ''; canvas.focus();
  if (settings.sound) void audio.start();
}
input.onPress = (timestamp, source) => { if (engine && !paused && view === 'mission') engine.press(timestamp, source); };
input.onPause = () => pauseMission();
input.onDeviceChange = reason => { if (engine) engine.flagQuality(reason); toast(reason.includes('DISCONNECTED') ? 'ゲームパッドが切断されました。キーボード・タッチに切り替えられます。' : 'ゲームパッドを検出しました。'); };
window.addEventListener('blur', () => { if (engine && !paused && !document.hidden) pauseMission(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && engine) { if (!paused) pauseMission('tab-hidden'); else engine.flagQuality('tab-hidden'); } });
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); if (engine) { engine.flagQuality('gpu-context-lost'); pauseMission('gpu-context-lost'); } toast('GPUコンテキストが失われました。復旧後に再開してください。'); });
canvas.addEventListener('webglcontextrestored', () => { engine?.flagQuality('gpu-context-restored'); toast('描画を復元しました。再開するか中断してください。'); });
window.addEventListener('resize', () => { renderer?.resize(); if (engine && !paused) engine.flagQuality('viewport-resize'); });

function showHow(): void {
  showModal(modal('Not a race. Your own pace.', `<div class="modal-eyebrow">HOW TO DRIVE / 遊び方</div>`
    + '<ol class="modal-content-list">'
    + '<li><strong>ハンドルは、曲がるためだけ。</strong>A / D または矢印で操舵。アクセル・ブレーキは不要です。何もしなくても車は道路のカーブについていくので、まっすぐ走るために操作し続ける必要はありません。</li>'
    + '<li><strong>色で意味が決まっています。</strong><b class="legend-go">ライム／緑</b>＝通ってよい（Gateのアーチ、Power Zoneの帯）。<b class="legend-stop">赤白のハザード</b>＝触れると衝突（Obstacle）。橙は危険の警告灯です。</li>'
    + '<li><strong>正しいサインにだけ、反応。</strong>指定TargetにSpace / Jで反応。それ以外は何も押しません。タッチは画面の左右どこでも。表示時間はレベルが上がるほど短くなり、反応期限は別に管理されます。</li>'
    + `<li><strong>Guideの捕り方。</strong>7秒ほどで路面に${'ライム'}のリングが現れます。<b>リングの中を走りながら</b>、同時に<b>標識の正解率を保ち</b>、<b>道路イベントも通過</b>していると、リングが自動で溜まって捕獲されます。条件が欠けると溜まりが止まり、HUDに理由（ラインを維持／サインに反応／イベントを通過／リングへ寄る）が出ます。止まっている理由が分かるので、それを直せば捕獲できます。</li>`
    + '<li><strong>難易度は、ふたつの課題で別々に。</strong>運転と識別は独立して調整されます。うまくいくと上がり、崩れると下がります。ミッションの長さは設定で3分・10分・30分から選べます（Classicは公開仕様の180秒固定）。</li>'
    + '<li><strong>次の景色へ。</strong>Baseline → Trainingを最低5回 → Challenge。15 Guidesで新World、15 MissionsごとにFocusDrive Indexを更新します。</li>'
    + '</ol><p class="small-note">キーボード・ゲームパッド・タッチ対応。傾き操作は設定で許可できます。独立した実験的ゲームであり、医療効果を検証した製品ではありません。</p>',
    '<button class="primary-button" data-action="brief">はじめてみる ' + icon('arrow') + '</button>'));
}
function showRoute(): void {
  const wp = profile.worlds[profile.selectedWorld];
  showModal(modal('The road ahead.', `<div class="modal-eyebrow">${esc(getWorld(profile.selectedWorld).name)} / MISSION ROUTE</div>${[
    ['BASELINE', '初回から二重課題で初期レベルを記録', wp.baselineComplete ? 'COMPLETE' : 'NEXT'],
    ['TRAINING × 5', '運転とTargetingを独立して継続適応', `${wp.trainingSinceChallenge} / 5`],
    ['CHALLENGE', '新しい難易度で、いまの力を試す', `${wp.challengesCompleted} COMPLETED`],
    ['15 GUIDES', '実際の捕獲でのみ次のWorldを解放', `${wp.guides} / 15`],
  ].map(([t,d,s])=>`<div class="route-modal-step">${icon(t === '15 GUIDES' ? 'guide' : 'wheel')}<div><strong>${t}</strong><p>${d}</p></div><span>${s}</span></div>`).join('')}<p class="small-note">Challengeの後は次のTrainingサイクルへ。Worldをすべて解放するとExpert Modeになります。経過日数だけでのWorld解放はありません。</p>`));
}
async function showCredits(): Promise<void> {
  let credits = '<p>モデル情報を読み込んでいます。</p>';
  try {
    const manifest = await fetch('/assets/credits.json').then(r => r.ok ? r.json() : null);
    if (manifest) credits = `<pre class="credits-json">${esc(JSON.stringify(manifest, null, 2))}</pre>`;
  } catch { credits = '<p>CarConcept — DGG / Eric Chadwick, CC BY 4.0。原著作・改変の詳細はプロジェクトのCREDITSを参照。</p>'; }
  showModal(modal('Built on good work.', `<div class="modal-eyebrow">CREDITS / SOURCES / FIDELITY</div><p>FOCUS DRIVEは独立した再構成です。原作のアート・音声・コードは使用していません。</p><p><strong>CarConcept</strong> — Darmstadt Graphics Group / Eric Chadwick<br><a href="https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept" target="_blank" rel="noopener">Khronos glTF Sample Assets</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a></p><p><strong>公開仕様・研究</strong><br><a href="https://www.endeavorotc.com/wp-content/uploads/2025/04/EndeavorOTC-IFU-5015-3.0.0.pdf" target="_blank" rel="noopener">EndeavorOTC IFU (2025)</a><br><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC3983066/" target="_blank" rel="noopener">Anguera et al. (2013) / NeuroRacer</a><br><a href="https://doi.org/10.1038/s41398-024-03045-0" target="_blank" rel="noopener">Stamatis et al. (2024)</a></p><p class="small-note">Classic: 180秒、400ms表示、2 / 2.5 / 3秒間隔、200 / 54段階。OTC内部係数・Guide捕獲秒数・W3/4規則・Indexの正規化は推定です。商用品と同一挙動や数値とは断定しません。</p><details class="credits-details"><summary>車両アセットの記録</summary>${credits}</details>`, '<button class="outline-button" data-action="fidelity">忠実度Manifestを保存 ' + icon('download') + '</button>'));
}
function exportBackup(): void { downloadJson(`focus-drive-backup-${localDayKey()}.json`, { app: 'FOCUS DRIVE', version: 1, exportedAt: new Date().toISOString(), profile, settings }); toast('端末内データを書き出しました。認知課題の生ログを含むため大切に保管してください。'); }
function buyPaint(id: string): void {
  const paint = PAINTS.find(p => p.id === id); if (!paint) return;
  if (!profile.ownedPaints.includes(id)) {
    if (profile.coins < paint.cost) { toast(`あと${paint.cost - profile.coins}コイン。ミッションで獲得できます。`); return; }
    showModal(modal('A fresh coat.', `<p>${esc(paint.name)} を ${paint.cost}コインで解放しますか？<br>性能は変わらず、ボディカラーのみ変更します。</p>`, `<button class="outline-button" data-action="close-modal">キャンセル</button><button class="primary-button" data-action="confirm-paint" data-paint="${id}">解放する ${icon('arrow')}</button>`)); return;
  }
  profile.selectedPaint = id; void persist(); applyCosmetics(); renderView();
}
function buyCar(id: string): void {
  if (!['concept', 'roadster'].includes(id)) return;
  if (!profile.ownedCars.includes(id)) {
    if (profile.coins < 650) { toast(`あと${650 - profile.coins}コインでConcept Oneを解放できます。`); return; }
    showModal(modal('Open up your world.', '<p>650コインでConcept Oneを解放しますか？<br>見た目だけが変わり、トレーニング時の性能は同じです。</p>', '<button class="outline-button" data-action="close-modal">キャンセル</button><button class="primary-button" data-action="confirm-car">解放する ' + icon('arrow') + '</button>')); return;
  }
  profile.selectedCar = id; void persist(); renderView();
}
async function action(target: HTMLElement): Promise<void> {
  const name = target.dataset.action;
  if (name === 'nav') { navigate(target.dataset.view as View); return; }
  if (name === 'brief') { showBrief(); return; }
  if (name === 'quick-dual') { await startMission(false, true); return; }
  if (name === 'begin') { await startMission(target.dataset.calibration === 'true'); return; }
  if (name === 'settings') { showModal(settingsModal(settings, accountState)); return; }
  if (name === 'close-modal') { if (view === 'mission' && paused) resumeMission(); else closeModal(); return; }
  if (name === 'how') { showHow(); return; }
  if (name === 'route') { showRoute(); return; }
  if (name === 'account-login' || name === 'account-register') {
    const { email, password } = accountCredentials();
    const invalid = validateCredentials(email, password);
    if (invalid) { accountState = { ...accountState, error: invalid, notice: null, draftEmail: email }; refreshAccountModal(); return; }
    await runAccountAction(async () => {
      const result = name === 'account-login' ? await account.signIn(email, password) : await account.register(email, password);
      accountState = { ...accountState, user: result.user };
      return name === 'account-login' ? 'サインインしました。' : 'アカウントを作成しました。';
    });
    return;
  }
  if (name === 'account-logout') {
    await runAccountAction(async () => { await account.signOut(); accountState = { ...accountState, user: null }; return 'サインアウトしました。端末内のデータはそのまま残ります。'; });
    return;
  }
  if (name === 'account-backup') {
    await runAccountAction(async () => {
      const result = await account.backup(profile);
      return `クラウドに保存しました（${new Date(result.updatedAt).toLocaleString('ja-JP')}）。`;
    });
    return;
  }
  if (name === 'account-restore') {
    await runAccountAction(async () => {
      const result = await account.restore();
      if (!result.profile || !isProfile(result.profile)) throw new Error('クラウドに保存されたデータがありません');
      profile = result.profile;
      await persist();
      renderView();
      return 'クラウドから復元しました。';
    });
    return;
  }
  if (name === 'credits') { await showCredits(); return; }
  if (name === 'world') {
    const id = Number(target.dataset.world) as WorldId;
    if (!profile.worlds[id]?.unlocked) { toast(`World 0${id - 1}で15 Guidesを集めると解放されます。`); return; }
    profile.selectedWorld = id; await persist(); renderView(); return;
  }
  if (name === 'pause') { pauseMission(); return; }
  if (name === 'resume') { resumeMission(); return; }
  if (name === 'abort') { closeModal(); await finishMission(true); return; }
  if (name === 'export') { exportBackup(); return; }
  if (name === 'csv') { if (!profile.history.length) toast('まだ試行ログがありません。'); else downloadCsv(`focus-drive-trials-${localDayKey()}.csv`, profile.history); return; }
  if (name === 'export-record') { if (lastRecord) downloadJson(`focus-drive-${lastRecord.id}.json`, lastRecord); return; }
  if (name === 'record') { const r = profile.history.find(x => x.id === target.dataset.record); if (r) showModal(modal('Behind the drive.', detailMarkup(r))); return; }
  if (name === 'result-detail') { if (lastRecord) showModal(modal('Behind the drive.', detailMarkup(lastRecord))); return; }
  if (name === 'index-info') {
    showModal(modal('An index. Not a diagnosis.', '<div class="modal-eyebrow">FOCUSDRIVE INDEX / 推定実装</div><ol class="modal-content-list"><li><strong>3つのサブ指標</strong>同時課題のNavigation80閾値、HIT反応速度、半試行補正d′を計算。</li><li><strong>Worldとミッションの差を調整</strong>log(mission order)＋mission type × world × 難易度設定の回帰で条件差を差し引きます。</li><li><strong>頑健に正規化、均等に統合</strong>1.5 IQRでWinsorize・robust scale。Targeting速度と弁別のベクトルノルムをNavigationと平均します。</li><li><strong>15 Missionsごとに解放</strong>十分なデータがない指標は欠測として扱います。元論文の商用正規化係数は非公開のため、独自推定です。</li></ol><p class="small-note">EndeavorOTCのFocus Scoreとは同一ではありません。研究用の正式な基準値・医療的な意味を持ちません。</p>')); return;
  }
  if (name === 'paint') { buyPaint(target.dataset.paint!); return; }
  if (name === 'confirm-paint') {
    const paint = PAINTS.find(x => x.id === target.dataset.paint); if (!paint || profile.ownedPaints.includes(paint.id) || profile.coins < paint.cost) return;
    profile.coins -= paint.cost; profile.ownedPaints.push(paint.id); profile.selectedPaint = paint.id; await persist(); closeModal(); renderView(); toast(`${paint.name} を解放しました。`); return;
  }
  if (name === 'wheels' || name === 'decal') {
    const kind = name; const id = target.dataset.item!;
    const owned = kind === 'wheels' ? profile.ownedWheels : profile.ownedDecals;
    if (!['standard', 'sport', 'none', 'stripe'].includes(id)) return;
    const cost = id === 'sport' ? 240 : id === 'stripe' ? 120 : 0;
    if (!owned.includes(id)) {
      if (profile.coins < cost) { toast(`あと${cost - profile.coins}コインで解放できます。`); return; }
      showModal(modal('The finishing touch.', `<p>${id === 'sport' ? 'Sportホイール' : 'Contrast外装'}を${cost}コインで解放しますか？<br>見た目だけが変わり、操作性能は同じです。</p>`, `<button class="outline-button" data-action="close-modal">キャンセル</button><button class="primary-button" data-action="confirm-accessory" data-kind="${kind}" data-item="${id}">解放する ${icon('arrow')}</button>`)); return;
    }
    if (kind === 'wheels') profile.selectedWheels = id; else profile.selectedDecal = id;
    await persist(); renderView(); return;
  }
  if (name === 'confirm-accessory') {
    const kind = target.dataset.kind; const id = target.dataset.item;
    if (kind !== 'wheels' && kind !== 'decal' || id !== 'sport' && id !== 'stripe') return;
    const owned = kind === 'wheels' ? profile.ownedWheels : profile.ownedDecals; const cost = id === 'sport' ? 240 : 120;
    if (owned.includes(id) || profile.coins < cost) return;
    profile.coins -= cost; owned.push(id);
    if (kind === 'wheels') profile.selectedWheels = id; else profile.selectedDecal = id;
    await persist(); closeModal(); renderView(); toast('新しいカスタムを解放しました。'); return;
  }
  if (name === 'car') { buyCar(target.dataset.car!); return; }
  if (name === 'confirm-car') {
    if (profile.ownedCars.includes('concept') || profile.coins < 650) return;
    profile.coins -= 650; profile.ownedCars.push('concept'); profile.selectedCar = 'concept'; await persist(); closeModal(); renderView(); toast('Concept Oneを解放しました。'); return;
  }
  if (name === 'tilt') {
    const allowed = await input.enableTilt();
    if (allowed) {
      settings.inputMode = 'tilt'; settings.tiltNeutral = input.neutral; saveSettings(settings);
      calibrationDeviceId = `tilt-${Date.now()}`; localStorage.setItem('focus-drive-calibration-id', calibrationDeviceId);
      toast('傾き操作を許可しました。端末が対応しない場合はタッチ操舵を使用できます。');
      showModal(settingsModal(settings, accountState));
    } else toast('このブラウザでは傾きを使用できません。タッチ操舵・ゲームパッドをご利用ください。'); return;
  }
  if (name === 'calibrate') { showBrief(true); return; }
  if (name === 'fidelity') {
    try { const fidelity = await fetch('/fidelity-manifest.json').then(r => r.json()); downloadJson('focus-drive-fidelity-manifest.json', fidelity); }
    catch { toast('Manifestを読み込めませんでした。'); } return;
  }
}
document.addEventListener('click', e => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (target) { e.preventDefault(); void action(target).catch(error => { console.error(error); toast('操作を完了できませんでした。もう一度お試しください。'); }); }
  else if ((e.target as HTMLElement).classList.contains('modal-backdrop') && view !== 'mission') closeModal();
});
document.addEventListener('keydown', e => {
  const root = document.getElementById('modal-root'); const dialog = root?.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (view === 'mission' && paused) resumeMission(); else closeModal(); }
  if (e.key === 'Tab') {
    const els = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not([hidden]),select,[tabindex="0"]')).filter(el => !el.hasAttribute('hidden'));
    const first = els[0], last = els.at(-1); if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
document.addEventListener('change', e => {
  const target = e.target as HTMLInputElement | HTMLSelectElement;
  if (target.id === 'import-file' && target instanceof HTMLInputElement) { void importBackup(target); return; }
  const key = target.dataset.setting as keyof AppSettings | undefined; if (!key) return;
  const value = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : ['sensitivity', 'classicRatio'].includes(key) ? Number(target.value) : target.value;
  const coerced = key === 'missionDurationMs' ? Number(value) : value;
  settings = { ...settings, [key]: coerced }; saveSettings(settings); document.body.dataset.reduced = String(settings.reducedMotion); applyCosmetics();
  if (key === 'quality') { toast('描画品質は次回のページ読み込みから反映されます。'); }
  if (key === 'inputMode' || key === 'sensitivity') toast('入力設定を変更しました。単独課題での再較正をおすすめします。');
  if (key === 'mode' && view !== 'mission') {
    const markup = settingsModal(settings, accountState); renderView(); showModal(markup); toast(`${modeLabel()} に切り替えました。`);
  }
});
document.addEventListener('input', e => {
  const target = e.target as HTMLInputElement;
  if (target.dataset.setting === 'sensitivity') setText('sensitivity-value', `${Number(target.value).toFixed(1)}×`);
});
async function importBackup(target: HTMLInputElement): Promise<void> {
  const file = target.files?.[0]; if (!file) return;
  if (file.size > 250_000_000) { toast('バックアップが大きすぎます（上限250MB）。'); return; }
  try {
    const raw = JSON.parse(await file.text());
    if (raw?.app !== 'FOCUS DRIVE' || raw.version !== 1 || !isProfile(raw.profile)) throw new Error('Unsupported backup');
    showModal(modal('Bring your journey back.', `<p>${esc(file.name)}<br>${raw.profile.completedMissions}ミッション・${raw.profile.coins}コインの記録で、この端末のデータを上書きします。現在の記録は先にバックアップしてください。</p>`, '<button class="outline-button" data-action="close-modal">キャンセル</button><button class="primary-button" id="confirm-import">上書きして復元</button>'));
    document.getElementById('confirm-import')?.addEventListener('click', async () => {
      profile = raw.profile; await persist(); closeModal(); view = 'home'; renderView(); toast('バックアップを復元しました。');
    }, { once: true });
  } catch { toast('FOCUS DRIVEの有効なバックアップJSONではありません。'); }
}
function frame(timestamp: number): void {
  requestAnimationFrame(frame);
  const delta = lastFrame === null ? 0 : Math.max(0, timestamp - lastFrame);
  lastFrame = timestamp;
  if (view === 'mission' && engine && !paused && !isFinishing) {
    if (preparingUntil !== null) {
      const snapshot = engine.snapshot;
      updateHud(snapshot, timestamp); renderer?.render(renderState(snapshot));
      preparationFrames = delta > 0 && delta < 250 ? preparationFrames + 1 : 0;
      setText('countdown-number', timestamp > preparingUntil ? '…' : String(Math.max(1, Math.ceil((preparingUntil - timestamp) / 1000))));
      if (timestamp >= preparingUntil && (preparationFrames >= 3 || timestamp >= preparingUntil + 7000)) {
        engine = new MissionEngine({ ...(pendingConfig ?? {}), startedAt: new Date().toISOString(), dayKey: localDayKey() });
        pendingConfig = null; preparingUntil = null; lastTask = ''; document.getElementById('countdown')?.remove(); lastFrame = null; input.active = true;
      }
      return;
    }
    const steer = import.meta.env.DEV && diagnosticControl ? diagnosticControl(engine.snapshot, timestamp) : input.poll(timestamp);
    const snapshot = engine.advance(delta, steer, timestamp);
    updateHud(snapshot, timestamp);
    renderer?.render(renderState(snapshot));
    const visible = snapshot.currentStimulus?.visible ? snapshot.currentStimulus.id : null;
    if (lastVisibleId && lastVisibleId !== visible) engine.acknowledgeHidden(lastVisibleId, timestamp);
    if (visible) engine.acknowledgePresentation(visible, timestamp);
    lastVisibleId = visible;
    audio.update(snapshot.forwardSpeed, settings.sound, snapshot.carVX, currentRpm);
    if (snapshot.finished) void finishMission();
  } else if (renderer && ['home', 'garage'].includes(view)) {
    animationTime += settings.reducedMotion ? 0 : Math.min(delta, 50) / 1000;
    renderer.render({ time: animationTime, progressS: 0, carX: 0, carVX: 0, roadCenterX: 0, steer: 0, forwardSpeed: 0, worldId: profile.selectedWorld, roadLevel: 20, navEvents: [], guide: null, seed: 20261018 });
  }
}
renderView();
requestAnimationFrame(frame);
// Reflect an existing session on load. Silently a no-op on a static-only deploy, so play is
// never blocked by the account service being absent.
void account.current().then((user) => {
  if (user && !accountState.user) { accountState = { ...accountState, user }; if (document.getElementById('account-panel')) refreshAccountModal(); }
}).catch(() => {});
const loading = document.createElement('div'); loading.className = 'loading-notice'; loading.textContent = 'PREPARING YOUR DRIVE'; document.body.append(loading);
try {
  const { createRenderer } = await import('./render');
  renderer = await createRenderer(canvas, {
    pixelRatio: settings.quality === 'low' ? 1 : Math.min(1.5, devicePixelRatio),
    onError: error => { console.error('Renderer error', error); if (engine) pauseMission('gpu-renderer-error'); },
    onAssetFallback: reason => { console.warn('Vehicle fallback', reason); toast('車両を読み込めなかったため、オリジナルのロードスターを表示しています。'); },
  });
  renderer.setScene(sceneFor(view)); renderer.setWorld(profile.selectedWorld); applyCosmetics(); renderer.resize();
} catch (error) {
  console.error(error);
  const el = document.createElement('div'); el.className = 'render-fallback'; el.textContent = '3D描画を開始できませんでした。WebGL2を有効にして、ページを再読み込みしてください。認知データは端末に保存されています。'; document.body.append(el);
  const start = document.getElementById('start-drive') as HTMLButtonElement | null; if (start) start.disabled = true;
} finally { loading.remove(); }
if (storageMode === 'fallback') toast('IndexedDBが利用できないため、代替のローカル保存を使用しています。定期的にバックアップしてください。');
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(error => console.warn('Offline cache unavailable', error));
}

// Development-only, opt-in diagnostic access. Never included in the production build.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('test')) {
  (window as unknown as Record<string, unknown>).__FOCUS_DRIVE_TEST__ = {
    getProfile: () => profile,
    getSnapshot: () => engine?.snapshot ?? null,
    getEngine: () => engine,
    getRenderer: () => renderer,
    getRecord: () => lastRecord,
    getAudio: () => audio.status,
    getRendererStats: () => renderer?.stats() ?? null,
    setControl: (control: ((snapshot: MissionSnapshot, timestamp: number) => number) | null) => { diagnosticControl = control; },
    start: (config: MissionConfig = {}) => {
      pendingConfig = { ...nextMission(profile), ...config, startedAt: new Date().toISOString(), dayKey: localDayKey() };
      engine = new MissionEngine(pendingConfig);
      preparingUntil = performance.now() + 3000; preparationFrames = 0;
      view = 'mission'; paused = false; isFinishing = false; lastFrame = null; renderView();
    },
    abort: () => finishMission(true),
    pause: () => pauseMission(), resume: resumeMission,
  };
}
