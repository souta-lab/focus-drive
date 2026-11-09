/** Render-only state: cognition and simulation never depend on PlayCanvas. */
export interface RenderNavigationEvent {
  id: string;
  kind: 'POWER_ZONE' | 'GATE' | 'OBSTACLE';
  atDistance: number;
  roadOffset: number;
  width: number;
  passed?: boolean;
}

export interface RenderState {
  /** Monotonic simulation time, in seconds (not performance.now milliseconds). */
  time: number;
  /** Distance travelled in metres. */
  progressS: number;
  /** Absolute lateral world position, not offset from the road. */
  carX: number;
  carVX: number;
  roadCenterX: number;
  steer: number;
  forwardSpeed: number;
  worldId: number;
  roadLevel: number;
  navEvents: readonly RenderNavigationEvent[];
  guide: { phase: string; progress: number; offset: number } | null;
  /** Optional seed; must match the simulation's course seed. */
  seed?: number;
  /** Evaluation boundary; visual tarmac is deliberately wider. */
  allowedHalfWidth?: number;
}

export type RenderScene = 'hub' | 'mission' | 'garage';

export interface RendererOptions {
  onError?: (error: Error) => void;
  onReady?: () => void;
  /** GLB failure is non-fatal: the detailed procedural rig remains visible. */
  onAssetFallback?: (reason: string) => void;
  pixelRatio?: number;
  seed?: number;
  /** Optional same-origin container model; never required for play. */
  vehicleUrl?: string;
}

/** Measured renderer cost for the last submitted frame. Diagnostic only. */
export interface RendererStats {
  /** Real GL draw calls submitted for the last frame (PlayCanvas device counter). */
  drawCalls: number;
  /**
   * Host-side CPU time spent inside `app.update` + `app.render` for the last frame,
   * in milliseconds. This is submission cost, NOT GPU execution time.
   */
  cpuFrameMs: number;
  /** PlayCanvas rolling frame rate over its last one-second window. */
  fps: number;
  /** Device pixel ratio actually used. */
  pixelRatio: number;
}

export interface DriveRenderer {
  render(state: RenderState): void;
  stats(): RendererStats;
  setWorld(worldId: number): void;
  setPaint(hex: string): void;
  /** All visual options leave simulation/handling unchanged. */
  setCar(id: 'concept' | 'roadster'): void;
  setWheels(style: 'standard' | 'sport'): void;
  setDecal(style: 'none' | 'stripe'): void;
  setScene(scene: RenderScene): void;
  /** Night lighting for any world; purely visual. */
  setNight(on: boolean): void;
  resize(): void;
  destroy(): void;
}
