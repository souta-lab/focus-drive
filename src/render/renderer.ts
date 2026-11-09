import * as pc from 'playcanvas';
import { VehicleRig } from './car';
import { NavigationVisuals } from './events';
import { material, primitive } from './geometry';
import { centerX, EVALUATION_HALF_WIDTH } from './road';
import { ScenicWorld, WORLD_THEMES, type WorldTheme } from './world';
import type { DriveRenderer, RendererOptions, RendererStats, RenderScene, RenderState } from './types';

interface Environment { source: pc.Texture; lighting: pc.Texture; sky: pc.Texture; atlas: pc.Texture }

function createEnvironment(device: pc.GraphicsDevice, theme: WorldTheme): Environment {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, theme.sky);
  gradient.addColorStop(0.3, theme.sky);
  gradient.addColorStop(0.49, theme.horizon);
  gradient.addColorStop(0.54, theme.sea);
  gradient.addColorStop(1, theme.night ? '#14232b' : '#46584f');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 256);
  // Broad dawn illumination, away from the central road / fixed Targeting overlay.
  const sun = ctx.createRadialGradient(92, 102, 2, 92, 102, 62);
  sun.addColorStop(0, theme.sun); sun.addColorStop(0.1, theme.sun); sun.addColorStop(0.34, theme.night ? 'rgba(164,190,190,.1)' : 'rgba(255,236,191,.28)'); sun.addColorStop(1, 'rgba(255,238,205,0)');
  ctx.fillStyle = sun; ctx.fillRect(0, 0, 512, 256);
  // Soft light cards in the upper hemisphere add precise body/glass reflections.
  const card = ctx.createLinearGradient(0, 25, 0, 72);
  card.addColorStop(0, 'rgba(255,255,245,0)'); card.addColorStop(0.45, theme.night ? 'rgba(206,235,228,.32)' : 'rgba(255,255,246,.48)'); card.addColorStop(1, 'rgba(255,255,245,0)');
  ctx.fillStyle = card; ctx.fillRect(185, 25, 210, 47);
  const source = new pc.Texture(device, { name: 'Original procedural dawn radiance', format: pc.PIXELFORMAT_SRGBA8, mipmaps: true, projection: pc.TEXTUREPROJECTION_EQUIRECT });
  source.setSource(canvas);
  const sky = pc.EnvLighting.generateSkyboxCubemap(source, 128);
  const lighting = pc.EnvLighting.generateLightingSource(source, { size: 64 });
  const atlas = pc.EnvLighting.generateAtlas(lighting, { size: 256, numReflectionSamples: 64, numAmbientSamples: 128 });
  return { source, lighting, sky, atlas };
}

class PlayCanvasDriveRenderer implements DriveRenderer {
  private readonly camera = new pc.Entity('Stable chase / product camera');
  private readonly sun = new pc.Entity('Soft coastal key');
  private readonly fill = new pc.Entity('Open-sky fill');
  private readonly world: ScenicWorld;
  private readonly vehicle: VehicleRig;
  private readonly events: NavigationVisuals;
  private readonly platform: pc.Entity;
  private readonly environments = new Map<string, Environment>();
  private readonly resizeObserver: ResizeObserver;
  private scene: RenderScene = 'hub';
  private worldId = 1;
  private destroyed = false;
  private failed = false;
  private seed: number;
  private night = false;
  private lastState: RenderState | null = null;
  private readonly onContextLost: (event: Event) => void;
  private readonly onContextRestored: () => void;
  private measured: RendererStats = { drawCalls: 0, cpuFrameMs: 0, fps: 0, pixelRatio: 1 };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly app: pc.Application, private readonly options: RendererOptions) {
    this.seed = options.seed ?? 0;
    app.autoRender = false;
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    this.camera.addComponent('camera', { fov: 43, nearClip: 0.08, farClip: 1500, clearColor: new pc.Color().fromString('#d6d7c8'), toneMapping: pc.TONEMAP_ACES, gammaCorrection: pc.GAMMA_SRGB });
    app.root.addChild(this.camera);
    // The real GLB uses KHR_materials_transmission for its glazing.
    this.camera.camera?.requestSceneColorMap(true);
    this.sun.addComponent('light', { type: 'directional', color: new pc.Color().fromString('#fff0d4'), intensity: 1.55, castShadows: true, shadowDistance: 85, shadowResolution: 2048, shadowBias: 0.16, normalOffsetBias: 0.025, shadowType: pc.SHADOW_PCF3 });
    this.sun.setLocalEulerAngles(39, -32, 0); app.root.addChild(this.sun);
    this.fill.addComponent('light', { type: 'directional', color: new pc.Color().fromString('#b7d2ca'), intensity: 0.32, castShadows: false });
    this.fill.setLocalEulerAngles(-18, 140, 0); app.root.addChild(this.fill);
    app.scene.clusteredLightingEnabled = false;
    app.scene.fog.type = pc.FOG_LINEAR;
    app.scene.fog.start = 85; app.scene.fog.end = 820;
    this.world = new ScenicWorld(app, this.seed);
    this.vehicle = new VehicleRig(app, options);
    this.events = new NavigationVisuals(app);
    this.platform = primitive(app.root, 'Garage precision turntable', 'cylinder', material('Satin stone display plinth', '#6a756b', 0.15, 0.48), [0, -0.05, 0], [6.2, 0.22, 6.2]);
    this.platform.enabled = false;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.onContextLost = (event: Event) => {
      event.preventDefault();
      this.failed = true;
      options.onError?.(new Error('WebGL2 context lost. Pause the mission and invalidate its presentation timing.'));
    };
    this.onContextRestored = () => {
      this.failed = false;
      options.onError?.(new Error('WebGL2 context restored. Start a new measured mission; do not silently resume scoring.'));
    };
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    canvas.dataset.engine = 'PlayCanvas / WebGL2';
    this.setWorld(1);
    this.resize();
    // No independent simulation / animation clock. The host submits authoritative states.
    app.systems.fire('initialize', app.root);
    app.systems.fire('postInitialize', app.root);
    this.render({ time: 0, progressS: 0, carX: centerX(0, this.seed), carVX: 0, roadCenterX: centerX(0, this.seed), steer: 0, forwardSpeed: 0, worldId: 1, roadLevel: 20, navEvents: [], guide: null, seed: this.seed });
  }

  setWorld(worldId: number): void {
    if (this.destroyed) return;
    this.worldId = Math.max(1, Math.min(4, Math.round(worldId)));
    this.world.setNight(this.night);
    this.world.setWorld(this.worldId);
    const theme = this.night ? WORLD_THEMES[3]! : WORLD_THEMES[this.worldId]!;
    this.app.scene.ambientLight = new pc.Color().fromString(theme.ambient).mulScalar(theme.night ? 0.38 : 0.52);
    this.app.scene.fog.color = new pc.Color().fromString(theme.fog);
    if (this.camera.camera) this.camera.camera.clearColor = new pc.Color().fromString(theme.fog);
    if (this.sun.light) { this.sun.light.color = new pc.Color().fromString(theme.sun); this.sun.light.intensity = theme.night ? 0.85 : 1.55; }
    if (this.fill.light) this.fill.light.intensity = theme.night ? 0.48 : 0.32;
    const environmentKey = `${this.worldId}-${this.night ? 'night' : 'day'}`;
    let environment = this.environments.get(environmentKey);
    if (!environment) { environment = createEnvironment(this.app.graphicsDevice, theme); this.environments.set(environmentKey, environment); }
    this.app.scene.skybox = environment.sky;
    this.app.scene.envAtlas = environment.atlas;
    this.app.scene.skyboxIntensity = theme.night ? 0.62 : 1.0;
    this.app.scene.skyboxRotation = new pc.Quat().setFromEulerAngles(0, -24, 0);
  }

  setScene(scene: RenderScene): void {
    if (this.destroyed) return;
    this.scene = scene; this.vehicle.setScene(scene);
    this.events.root.enabled = scene === 'mission';
    this.platform.enabled = scene === 'garage';
    this.canvas.dataset.scene = scene;
  }

  setNight(on: boolean): void {
    if (this.destroyed || this.night === on) return;
    this.night = on;
    this.setWorld(this.worldId);
  }

  setPaint(hex: string): void { if (!this.destroyed) this.vehicle.setPaint(hex); }
  setCar(id: 'concept' | 'roadster'): void { if (!this.destroyed) this.vehicle.setCar(id); }
  setWheels(style: 'standard' | 'sport'): void { if (!this.destroyed) this.vehicle.setWheels(style); }
  setDecal(style: 'none' | 'stripe'): void { if (!this.destroyed) this.vehicle.setDecal(style); }
  stats(): RendererStats { return { ...this.measured }; }

  render(state: RenderState): void {
    if (this.destroyed || this.failed) return;
    try {
      this.lastState = state;
      if (state.worldId !== this.worldId) this.setWorld(state.worldId);
      this.seed = state.seed ?? this.seed;
      const mission = this.scene === 'mission';
      const s = mission ? state.progressS : 0;
      const cx = mission ? state.carX : centerX(0, this.seed);
      this.world.update(s, this.seed, state.allowedHalfWidth ?? EVALUATION_HALF_WIDTH);
      this.vehicle.root.setLocalPosition(cx, this.scene === 'garage' ? 0.065 : 0, 0);
      this.vehicle.root.setLocalEulerAngles(0, mission ? 0 : (this.scene === 'hub' ? -16 : -23), 0);
      this.vehicle.update(state, this.scene);
      this.platform.setLocalPosition(cx, -0.05, 0);
      if (mission) {
        this.events.root.enabled = true;
        this.events.update(state, this.seed);
        const roadX = state.roadCenterX;
        this.camera.setLocalPosition(cx * 0.72 + roadX * 0.28, 2.25, 6.1);
        this.camera.lookAt(cx * 0.62 + centerX(s + 25, this.seed) * 0.38, 0.9, -20);
        // Widen slightly with actual pace so Power Zone surges read as speed.
        const speedT = Math.max(0, Math.min(1, (state.forwardSpeed - 40) / 130));
        if (this.camera.camera) this.camera.camera.fov = 55 + speedT * 7;
      } else {
        this.events.root.enabled = false;
        if (this.scene === 'hub') {
          // 96px nav + the left third remain useful for the host's editorial UI.
          this.camera.setLocalPosition(cx + 5.8, 2.5, 6.8);
          this.camera.lookAt(cx - 2.6, 0.68, -1.4);
          if (this.camera.camera) this.camera.camera.fov = 36;
        } else {
          this.camera.setLocalPosition(cx + 6.3, 3.05, 8.0);
          this.camera.lookAt(cx, 0.75, -0.25);
          if (this.camera.camera) this.camera.camera.fov = 39;
        }
      }
      // The host drives frames manually, so PlayCanvas's own tick() never runs.
      // Update its statistics ourselves so real GL draw calls are counted, and time
      // the CPU submission cost of this frame (not GPU execution time).
      const cpuStart = performance.now();
      this.app.update(0);
      this.app.render();
      const cpuFrameMs = performance.now() - cpuStart;
      try {
        this.app.stats.updateBasic(performance.now(), 0, cpuFrameMs, this.app.renderer, this.app.graphicsDevice);
        this.measured = {
          drawCalls: this.app.stats.drawCalls.total,
          cpuFrameMs,
          fps: this.app.stats.frame.fps,
          pixelRatio: this.app.graphicsDevice.maxPixelRatio ?? 1,
        };
      } catch {
        this.measured = { drawCalls: 0, cpuFrameMs, fps: 0, pixelRatio: this.app.graphicsDevice.maxPixelRatio ?? 1 };
      }
    } catch (reason) {
      this.failed = true;
      this.options.onError?.(reason instanceof Error ? reason : new Error(String(reason)));
    }
  }

  resize(): void {
    if (this.destroyed) return;
    const rect = this.canvas.getBoundingClientRect();
    this.app.graphicsDevice.resizeCanvas(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)));
    if (this.lastState) this.render(this.lastState);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.vehicle.destroy(); this.events.destroy(); this.world.destroy();
    for (const environment of this.environments.values()) for (const texture of [environment.source, environment.lighting, environment.sky, environment.atlas]) texture.destroy();
    this.environments.clear(); this.app.destroy();
  }
}

/** WebGL2 is the deliberate default. This promise rejects only for fatal renderer failure. */
export async function createRenderer(canvas: HTMLCanvasElement, options: RendererOptions = {}): Promise<DriveRenderer> {
  let app: pc.Application | undefined;
  try {
    const device = await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2], antialias: true, alpha: false, powerPreference: 'high-performance' });
    device.maxPixelRatio = Math.max(1, Math.min(options.pixelRatio ?? window.devicePixelRatio ?? 1, 1.5));
    app = new pc.Application(canvas, { graphicsDevice: device });
    const renderer = new PlayCanvasDriveRenderer(canvas, app, options);
    options.onReady?.();
    return renderer;
  } catch (reason) {
    app?.destroy();
    const error = reason instanceof Error ? reason : new Error(String(reason));
    options.onError?.(error);
    throw error;
  }
}
