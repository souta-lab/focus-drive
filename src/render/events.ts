import * as pc from 'playcanvas';
import { emissiveMaterial, material, meshEntity, primitive, torusData } from './geometry';
import { centerX, roadTangent } from './road';
import type { RenderNavigationEvent, RenderState } from './types';

export class NavigationVisuals {
  readonly root = new pc.Entity('Navigation events / not Targeting stimuli');
  private readonly entries = new Map<string, { root: pc.Entity; kind: RenderNavigationEvent['kind'] }>();
  private readonly zone = emissiveMaterial('Power zone / restrained lime', '#b3c573', 0.22);
  private readonly cream = material('Gate ceramic frame', '#e5e7cd', 0.25, 0.6);
  private readonly graphite = material('Soft graphite obstacle', '#34453c', 0.05, 0.45);
  private readonly amber = emissiveMaterial('Obstacle warm safety accent', '#c6a66b', 0.12);
  private readonly guideRoot = new pc.Entity('Automatic Guide focus ring');
  private readonly guideRing: pc.Entity;
  private guideArc: pc.Entity | null = null;
  private guideTick = -1;
  private readonly guideMaterial = emissiveMaterial('Guide lock ivory', '#d8e8c7', 0.7);
  private readonly goFrame = material('Go frame lime', '#9fc46a', 0.12, 0.5);
  private readonly goGlow = emissiveMaterial('Go signal glow', '#cdf08a', 1.6);
  private readonly hazardStripe = material('Hazard red', '#c4472f', 0.05, 0.42);
  private readonly hazardStripeAlt = material('Hazard white', '#f2f1e6', 0.05, 0.5);
  private readonly warnLamp = emissiveMaterial('Obstacle warning lamp', '#ffb43a', 1.7);
  private readonly guideColumnMaterial = emissiveMaterial('Guide light column', '#cfe4b4', 0.25);

  constructor(private readonly app: pc.Application) {
    app.root.addChild(this.root);
    this.root.addChild(this.guideRoot);
    this.zone.opacity = 0.42; this.zone.blendType = pc.BLEND_NORMAL; this.zone.depthWrite = false; this.zone.update();
    // A flat ring painted on the tarmac plus a faint column: a target on the road,
    // never a floating creature or a tether across the screen.
    const halo = meshEntity(app.graphicsDevice, 'Guide lock ring on tarmac', torusData(0.9, 0.035, 64, 8), emissiveMaterial('Guide lock ring glow', '#c4db72', 1.7), false);
    halo.setLocalPosition(0, 0.09, 0);
    halo.setLocalEulerAngles(90, 0, 0);
    this.guideRoot.addChild(halo);
    this.guideRing = halo;
    for (const [x, z] of [[1.16, 0], [-1.16, 0], [0, 1.16], [0, -1.16]]) {
      const tick = primitive(this.guideRoot, 'Guide ring alignment tick', 'box', this.guideMaterial, [x, 0.11, z], [0.34, 0.025, 0.07]);
      if (tick.render) tick.render.castShadows = false;
      tick.setLocalEulerAngles(0, Math.atan2(x, z) * pc.math.RAD_TO_DEG, 0);
    }
    this.guideColumnMaterial.opacity = 0.16;
    this.guideColumnMaterial.blendType = pc.BLEND_ADDITIVE;
    this.guideColumnMaterial.depthWrite = false;
    this.guideColumnMaterial.update();
    const column = primitive(this.guideRoot, 'Guide thin light column', 'cylinder', this.guideColumnMaterial, [0, 0.7, 0], [0.16, 1.4, 0.16]);
    if (column.render) { column.render.castShadows = false; column.render.receiveShadows = false; }
    this.guideRoot.enabled = false;
  }

  /**
   * One visual language, no ambiguity:
   *   lime / green  = go through or drive over (Gate, Power Zone)
   *   red / white hazard stripes = do not touch (Obstacle)
   * The old amber "approach chevrons" looked like lane markings and made players steer toward
   * things they should avoid, so they are gone.
   */
  private create(event: RenderNavigationEvent): pc.Entity {
    const root = new pc.Entity(event.kind);
    const go = this.goFrame;
    const hazard = this.hazardStripe;
    const hazardAlt = this.hazardStripeAlt;
    if (event.kind === 'POWER_ZONE') {
      primitive(root, 'Power zone road ribbon', 'box', this.zone, [0, 0.026, 0], [1, 0.018, 8]);
      for (const side of [-1, 1]) primitive(root, 'Power zone lime edge', 'box', this.goGlow, [side * 0.495, 0.04, 0], [0.05, 0.03, 8]);
      // Forward-pointing arrows on the tarmac: "drive over this".
      for (const z of [-2.6, -0.6, 1.4]) {
        primitive(root, 'Power zone arrow left', 'box', this.goGlow, [-0.17, 0.05, z], [0.06, 0.016, 0.8], [0, -30, 0]);
        primitive(root, 'Power zone arrow right', 'box', this.goGlow, [0.17, 0.05, z], [0.06, 0.016, 0.8], [0, 30, 0]);
      }
      for (const side of [-1, 1]) {
        primitive(root, 'Power zone post', 'box', go, [side * 0.62, 0.85, -3.6], [0.09, 1.7, 0.09]);
        primitive(root, 'Power zone lamp', 'box', this.goGlow, [side * 0.62, 1.72, -3.6], [0.18, 0.42, 0.12]);
      }
    } else if (event.kind === 'GATE') {
      // An open lime archway with an arrow on the road: clearly something you drive through.
      for (const side of [-1, 1]) {
        primitive(root, 'Gate upright', 'box', go, [side * 0.53, 1.0, 0], [0.085, 2.0, 0.2]);
        primitive(root, 'Gate inner light strip', 'box', this.goGlow, [side * 0.48, 1.1, 0.1], [0.035, 1.5, 0.035]);
        primitive(root, 'Gate grounded base', 'box', this.graphite, [side * 0.53, 0.09, 0], [0.18, 0.18, 0.52]);
      }
      primitive(root, 'Gate header', 'box', go, [0, 2.05, 0], [1.15, 0.16, 0.2]);
      primitive(root, 'Gate header light bar', 'box', this.goGlow, [0, 1.94, 0.115], [1.04, 0.06, 0.02]);
      // Through-arrow painted on the tarmac under the arch.
      for (const z of [1.5, 0.4]) {
        primitive(root, 'Gate through arrow left', 'box', this.goGlow, [-0.18, 0.05, z], [0.07, 0.016, 0.7], [0, -32, 0]);
        primitive(root, 'Gate through arrow right', 'box', this.goGlow, [0.18, 0.05, z], [0.07, 0.016, 0.7], [0, 32, 0]);
      }
      primitive(root, 'Gate threshold bar', 'box', this.goGlow, [0, 0.04, -0.9], [1.0, 0.02, 0.12]);
    } else {
      // Solid red-and-white hazard barrier. Wide, low and obviously not passable.
      primitive(root, 'Obstacle body', 'box', this.graphite, [0, 0.46, 0], [1, 0.92, 0.75]);
      const blocks = 5;
      for (let i = 0; i < blocks; i++) {
        const x = -0.4 + i * 0.2;
        primitive(root, 'Obstacle hazard stripe', 'box', i % 2 === 0 ? hazard : hazardAlt, [x, 0.62, 0.38], [0.2, 0.42, 0.03], [0, 0, 0]);
      }
      primitive(root, 'Obstacle warning cap', 'box', hazard, [0, 0.94, 0], [1.02, 0.1, 0.78]);
      // Solid kerb blocks on the tarmac either side make the blocked corridor obvious.
      for (const side of [-1, 1]) {
        for (const z of [0.9, 0.3, -0.3]) {
          primitive(root, 'Obstacle kerb block', 'box', ((z * 10 | 0) + side) % 2 === 0 ? hazard : hazardAlt, [side * 0.85, 0.06, z], [0.34, 0.12, 0.5]);
        }
      }
      // Amber warning posts stay amber on purpose: yellow now means "danger", not "lane".
      for (const side of [-1, 1]) {
        primitive(root, 'Obstacle warning post', 'box', this.graphite, [side * 1.05, 0.55, 0.2], [0.07, 1.1, 0.07]);
        primitive(root, 'Obstacle warning lamp', 'sphere', this.warnLamp, [side * 1.05, 1.15, 0.2], [0.17, 0.17, 0.17]);
      }
    }
    this.root.addChild(root);
    return root;
  }

  update(state: RenderState, seed: number): void {
    const visibleIds = new Set<string>();
    for (const event of state.navEvents) {
      const ahead = event.atDistance - state.progressS;
      if (event.passed || ahead < -13 || ahead > 350) continue;
      visibleIds.add(event.id);
      let entry = this.entries.get(event.id);
      if (!entry || entry.kind !== event.kind) {
        if (entry) entry.root.destroy();
        entry = { root: this.create(event), kind: event.kind }; this.entries.set(event.id, entry);
      }
      entry.root.enabled = true;
      entry.root.setLocalPosition(centerX(event.atDistance, seed) + event.roadOffset, 0, -ahead);
      entry.root.setLocalEulerAngles(0, -Math.atan(roadTangent(event.atDistance, seed)) * pc.math.RAD_TO_DEG, 0);
      entry.root.setLocalScale(Math.max(0.35, event.width), 1, 1);
    }
    for (const [id, entry] of this.entries) if (!visibleIds.has(id)) { entry.root.destroy(); this.entries.delete(id); }
    const guide = state.guide;
    const active = !!guide && !['HIDDEN', 'CAPTURED', 'LOST'].includes(guide.phase.toUpperCase());
    this.guideRoot.enabled = active;
    if (!active || !guide) return;
    this.guideRoot.setLocalPosition(centerX(state.progressS + 20, seed) + guide.offset, 0.03, -20);
    this.guideRoot.setLocalEulerAngles(0, 0, 0);
    const pulse = 1 + Math.sin(state.time * 4.2) * 0.06;
    this.guideRing.setLocalScale(pulse, pulse, 1);
    const tick = Math.round(Math.max(0, Math.min(1, guide.progress)) * 100);
    if (tick !== this.guideTick) {
      if (this.guideArc) {
        for (const render of this.guideArc.findComponents('render') as pc.RenderComponent[]) for (const instance of render.meshInstances) instance.mesh?.destroy();
        this.guideArc.destroy(); this.guideArc = null;
      }
      if (tick > 0) {
        this.guideArc = meshEntity(this.app.graphicsDevice, 'Accumulating automatic Guide lock', torusData(0.9, 0.04, Math.max(3, tick), 8, Math.PI * 2 * tick / 100), this.guideMaterial, false);
        this.guideArc.setLocalEulerAngles(90, 0, 0);
        this.guideArc.setLocalPosition(0, 0.12, 0);
        this.guideRoot.addChild(this.guideArc);
      }
      this.guideTick = tick;
    }
    this.guideRing.enabled = true;
  }

  destroy(): void { this.root.destroy(); this.entries.clear(); }
}
