import type { AppSettings } from '../persistence/store';

type PermissionOrientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };
export class InputController {
  private keys = new Set<string>();
  private heldPointers = new Map<number, number>();
  private gamepadWasDown = false;
  private gamepadAxis = 0;
  private gamma = 0;
  private tiltAvailable = false;
  private tiltListening = false;
  active = false;
  source = 'keyboard';
  onPress: (timestampMs: number, source: string) => void = () => {};
  onPause: () => void = () => {};
  onDeviceChange: (reason: string) => void = () => {};
  constructor(private settings: () => AppSettings) {
    window.addEventListener('keydown', e => {
      if (!this.active || (e.target as HTMLElement)?.matches('input,select,textarea')) return;
      if (['ArrowLeft', 'ArrowRight', 'Space', 'KeyA', 'KeyD', 'KeyJ', 'Escape'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.source = 'keyboard';
      if (e.code === 'Space' || e.code === 'KeyJ') this.onPress(performance.now(), 'keyboard');
      if (e.code === 'Escape') this.onPause();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.reset());
    window.addEventListener('pointerdown', e => {
      if (!this.active) return;
      const el = e.target as HTMLElement;
      const steering = el.closest<HTMLElement>('[data-steer]');
      if (steering) {
        e.preventDefault();
        const amount = Number(steering.dataset.steer);
        this.heldPointers.set(e.pointerId, amount);
        steering.setPointerCapture(e.pointerId);
        this.source = 'touch';
      } else if (!el.closest('[data-ui],button,input,select,a')) {
        e.preventDefault();
        this.onPress(performance.now(), e.pointerType === 'mouse' ? 'mouse' : 'touch');
        this.source = e.pointerType === 'mouse' ? 'mouse' : 'touch';
      }
    });
    window.addEventListener('pointerup', e => this.heldPointers.delete(e.pointerId));
    window.addEventListener('pointercancel', e => this.heldPointers.delete(e.pointerId));
    window.addEventListener('gamepadconnected', () => this.onDeviceChange('GAMEPAD_CONNECTED'));
    window.addEventListener('gamepaddisconnected', () => { this.gamepadAxis = 0; this.gamepadWasDown = false; this.onDeviceChange('GAMEPAD_DISCONNECTED'); });
  }
  reset(): void { this.keys.clear(); this.heldPointers.clear(); this.gamepadWasDown = false; }
  poll(timestamp: number): number {
    const pad = Array.from(navigator.getGamepads?.() ?? []).find(Boolean);
    if (pad && this.active) {
      const x = pad.axes[0] ?? 0;
      this.gamepadAxis = Math.abs(x) < 0.12 ? 0 : Math.sign(x) * (Math.abs(x) - 0.12) / 0.88;
      const down = !!(pad.buttons[0]?.pressed || pad.buttons[2]?.pressed || pad.buttons[5]?.pressed);
      if (down && !this.gamepadWasDown) { this.onPress(timestamp, 'gamepad'); this.source = 'gamepad'; }
      this.gamepadWasDown = down;
      if (Math.abs(x) > 0.12) this.source = 'gamepad';
    } else { this.gamepadAxis = 0; }
    const keyboard = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    let touch = 0; for (const value of this.heldPointers.values()) touch += value;
    const tilt = this.settings().inputMode === 'tilt' && this.tiltAvailable ? (this.gamma - this.settings().tiltNeutral) / 18 : 0;
    const deadzonedTilt = Math.abs(tilt) < 0.06 ? 0 : tilt;
    const raw = keyboard || touch || this.gamepadAxis || deadzonedTilt;
    return Math.min(1, Math.max(-1, raw * this.settings().sensitivity));
  }
  get neutral(): number { return this.gamma; }
  async enableTilt(): Promise<boolean> {
    if (typeof DeviceOrientationEvent === 'undefined') return false;
    try {
      const permission = (DeviceOrientationEvent as PermissionOrientation).requestPermission;
      if (permission && await permission.call(DeviceOrientationEvent) !== 'granted') return false;
      if (!this.tiltListening) {
        window.addEventListener('deviceorientation', e => {
          if (e.gamma !== null) { this.gamma = e.gamma; this.tiltAvailable = true; }
        });
        this.tiltListening = true;
      }
      return true;
    } catch { return false; }
  }
}

export type AudioCue = 'HIT' | 'MISS' | 'FALSE_ALARM' | 'POWER' | 'GATE' | 'IMPACT' | 'GUIDE' | 'WALL' | 'NAV';

/** Procedural engine / wind / tyre bed plus short synthesized gameplay cues. No audio files. */
/**
 * Engine, wind and tyre sound.
 *
 * The engine is four real recorded loops (CC BY 4.0, see CREDITS.md) at increasing engine
 * speeds. At runtime the two layers bracketing the current RPM are crossfaded in log space
 * and each is pitched by playbackRate, so the note follows the revs instead of a fixed
 * oscillator drone. Layer list comes from /audio/engine-layers.json.
 */
export class DriveAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineBus: GainNode | null = null;
  private windGain: GainNode | null = null;
  private tyreGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private layers: { baseRpm: number; gain: GainNode; filter: BiquadFilterNode; source: AudioBufferSourceNode | null; rate: number }[] = [];
  private enabled = false;
  private engineLoaded = false;

  async start(): Promise<void> {
    try {
      if (!this.ctx) {
        const ctx = new AudioContext();
        this.ctx = ctx;
        this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(ctx.destination);
        this.engineBus = ctx.createGain(); this.engineBus.gain.value = 0.9; this.engineBus.connect(this.master);
        const sampleRate = ctx.sampleRate;
        const buffer = ctx.createBuffer(1, Math.floor(sampleRate * 2), sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this.noiseBuffer = buffer;
        const wind = ctx.createBufferSource(); wind.buffer = buffer; wind.loop = true;
        const windFilter = ctx.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.frequency.value = 700; windFilter.Q.value = 0.55;
        this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
        wind.connect(windFilter); windFilter.connect(this.windGain); this.windGain.connect(this.master); wind.start();
        const tyre = ctx.createBufferSource(); tyre.buffer = buffer; tyre.loop = true;
        const tyreFilter = ctx.createBiquadFilter(); tyreFilter.type = 'bandpass'; tyreFilter.frequency.value = 2200; tyreFilter.Q.value = 1.4;
        this.tyreGain = ctx.createGain(); this.tyreGain.gain.value = 0;
        tyre.connect(tyreFilter); tyreFilter.connect(this.tyreGain); this.tyreGain.connect(this.master); tyre.start();
      }
      await this.ctx.resume(); this.enabled = true;
      await this.loadEngineLayers();
    } catch { /* Audio is optional and never gates gameplay. */ }
  }

  /** Decode the recorded loops and start them silently; gains fade them in as RPM rises. */
  private async loadEngineLayers(): Promise<void> {
    if (this.engineLoaded || !this.ctx) return;
    const index = await fetch('/audio/engine-layers.json').then((response) => {
      if (!response.ok) throw new Error(`engine-layers.json: HTTP ${response.status}`);
      return response.json() as Promise<{ layers: { file: string; baseRpm: number }[] }>;
    });
    const buffers = await Promise.all(index.layers.map(async (layer) => {
      const response = await fetch(layer.file);
      if (!response.ok) throw new Error(`${layer.file}: HTTP ${response.status}`);
      return this.ctx!.decodeAudioData(await response.arrayBuffer());
    }));
    index.layers.forEach((entry, i) => {
      const buffer = buffers[i];
      if (!buffer || !this.ctx) return;
      const gain = this.ctx.createGain(); gain.gain.value = 0;
      const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 3200; filter.Q.value = 0.7;
      gain.connect(filter); filter.connect(this.engineBus!);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer; source.loop = true; source.loopStart = 0; source.loopEnd = buffer.duration;
      source.connect(gain); source.start();
      this.layers.push({ baseRpm: entry.baseRpm, gain, filter, source, rate: 1 });
    });
    this.engineLoaded = this.layers.length > 0;
  }

  /**
   * @param speed metres per second (drives wind and tyre noise)
   * @param rpm   engine speed used for the note, layer crossfade and filter opening
   */
  update(speed: number, on: boolean, lateral = 0, rpm = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const active = on && this.enabled && this.ctx.state === 'running';
    this.master.gain.setTargetAtTime(active ? 0.55 : 0, t, 0.07);
    this.windGain?.gain.setTargetAtTime(active ? Math.min(0.14, speed / 1000) : 0, t, 0.25);
    this.tyreGain?.gain.setTargetAtTime(active ? Math.min(0.1, Math.abs(lateral) / 50) : 0, t, 0.08);
    if (!this.engineLoaded || this.layers.length === 0) return;
    const revs = Math.max(600, Math.min(9000, rpm));
    const load = Math.max(0, Math.min(1, speed / 60));
    // Blend the two layers bracketing this RPM; log spacing keeps each pitch shift modest.
    const index = this.layers.findIndex((layer) => revs <= layer.baseRpm);
    const upper = index === -1 ? this.layers.length - 1 : index;
    const lower = Math.max(0, upper - (index === -1 ? 0 : 1));
    const lowRpm = this.layers[lower]!.baseRpm;
    const highRpm = this.layers[upper]!.baseRpm;
    const blend = lower === upper || highRpm === lowRpm ? 0 : Math.max(0, Math.min(1,
      Math.log(revs / lowRpm) / Math.log(highRpm / lowRpm)));
    this.layers.forEach((layer, i) => {
      const weight = i === lower ? 1 - blend : i === upper ? blend : 0;
      const level = active ? weight * (0.45 + load * 0.55) : 0;
      layer.gain.gain.setTargetAtTime(level, t, 0.06);
      layer.filter.frequency.setTargetAtTime(1100 + revs * 0.6, t, 0.1);
      const rate = Math.max(0.4, Math.min(2.2, revs / layer.baseRpm));
      layer.rate = rate;
      layer.source?.playbackRate.setTargetAtTime(rate, t, 0.04);
    });
  }

  cue(cue: AudioCue): void {
    if (!this.ctx || !this.enabled) return;
    switch (cue) {
      case 'HIT': this.tone('sine', 880, 1320, 0.11, 0.14); this.tone('sine', 1320, 1760, 0.09, 0.06, 0.035); break;
      case 'MISS': this.tone('sine', 240, 150, 0.2, 0.12); break;
      case 'FALSE_ALARM': this.tone('square', 180, 140, 0.16, 0.07); break;
      case 'POWER': this.tone('sawtooth', 220, 900, 0.42, 0.08); this.burst(0.34, 0.05, 1900, 'highpass'); break;
      case 'GATE': this.tone('triangle', 660, 990, 0.17, 0.09); break;
      case 'IMPACT': this.burst(0.26, 0.2, 420, 'lowpass'); this.tone('sine', 90, 48, 0.3, 0.14); break;
      case 'WALL': this.burst(0.12, 0.12, 700, 'bandpass'); break;
      case 'GUIDE': this.tone('sine', 523, 523, 0.12, 0.06); this.tone('sine', 659, 659, 0.12, 0.06, 0.09); this.tone('sine', 784, 784, 0.16, 0.06, 0.18); break;
      case 'NAV': this.tone('sine', 520, 520, 0.06, 0.04); break;
    }
  }

  private tone(type: OscillatorType, from: number, to: number, duration: number, level: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator(); osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, from), t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain); gain.connect(this.master); osc.start(t); osc.stop(t + duration + 0.04);
  }

  private burst(duration: number, level: number, frequency: number, type: BiquadFilterType): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const source = this.ctx.createBufferSource(); source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = frequency; filter.Q.value = 0.9;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter); filter.connect(gain); gain.connect(this.master);
    source.start(t); source.stop(t + duration + 0.03);
  }

  quiet(): void { this.enabled = false; if (this.master && this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); }
  get status(): { state: string; enabled: boolean; engineSamples: boolean; layers: number; rates: { baseRpm: number; rate: number; gain: number }[] } {
    return {
      state: this.ctx?.state ?? 'none', enabled: this.enabled, engineSamples: this.engineLoaded, layers: this.layers.length,
      rates: this.layers.map((layer) => ({ baseRpm: layer.baseRpm, rate: Number(layer.rate.toFixed(3)), gain: Number(layer.gain.gain.value.toFixed(3)) })),
    };
  }
}
