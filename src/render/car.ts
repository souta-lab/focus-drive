import * as pc from 'playcanvas';
import { emissiveMaterial, material, meshData, meshEntity, primitive, torusData } from './geometry';
import type { RendererOptions, RenderScene, RenderState } from './types';

interface WheelRig { steer: pc.Entity; spin: pc.Entity; front: boolean }

export class VehicleRig {
  readonly root = new pc.Entity('Precision vehicle / visual rig only');
  private readonly motion = new pc.Entity('Body roll');
  private readonly roadster = new pc.Entity('FOCUS F-01 / original procedural formula car');
  private readonly stripe = new pc.Entity('Racing stripe');
  private readonly wheels: WheelRig[] = [];
  private readonly paint = material('Pearl ceramic paint', '#eeeadd', 0.38, 0.82);
  private readonly accentPaint = material('Secondary paint', '#d4d6ca', 0.38, 0.8);
  private readonly rim = material('Diamond-cut wheel alloy', '#afbab7', 0.86, 0.84);
  private readonly carbon = material('Graphite composite', '#172020', 0.25, 0.52);
  private concept: pc.Entity | null = null;
  private conceptAsset: pc.Asset | null = null;
  private conceptWheels: { node: pc.Entity; front: boolean }[] = [];
  private primaryMaterials: pc.StandardMaterial[] = [];
  private secondaryMaterials: pc.StandardMaterial[] = [];
  private rimMaterials: pc.StandardMaterial[] = [];
  private carId: 'concept' | 'roadster' = 'concept';
  private scene: RenderScene = 'hub';
  private decal: 'none' | 'stripe' = 'none';
  private wheelStyle: 'standard' | 'sport' = 'standard';
  private paintHex = '#eeeadd';
  private disposed = false;

  constructor(private readonly app: pc.Application, private readonly options: RendererOptions) {
    this.paint.clearCoat = 0.95;
    this.paint.clearCoatGloss = 0.96;
    this.paint.update();
    this.accentPaint.clearCoat = 0.9;
    this.accentPaint.update();
    app.root.addChild(this.root);
    this.root.addChild(this.motion);
    this.motion.addChild(this.roadster);
    this.motion.addChild(this.stripe);
    this.createRoadster();
    this.createContactShadow();
    this.updateVisibility();
    this.loadConcept();
  }

  private createRoadster(): void {
    const device = this.app.graphicsDevice;
    const leather = material('Charcoal leather', '#202725', 0.05, 0.43);
    const trim = material('Satin titanium', '#899894', 0.8, 0.74);
    const rubber = material('Slick racing rubber', '#111715', 0.02, 0.22);
    const lime = material('Signature sage accent', '#bbc8a0', 0.32, 0.65);
    const red = emissiveMaterial('FIA rear rain light', '#ce493b', 1.6);

    // Lofted slim monocoque: pointed nose, open cockpit, engine cover. Wheels stay fully outside.
    const data = meshData();
    const sections = 90, rings = 40;
    for (let i = 0; i <= sections; i++) {
      const z = -2.3 + i / sections * 4.6;
      const width = this.bodyWidth(z);
      const top = this.bodyTop(z);
      const base = 0.14;
      for (let j = 0; j <= rings; j++) {
        const a = j / rings * Math.PI * 2;
        const sx = Math.sin(a), cy = Math.cos(a);
        const y = base + (top - base) * (0.5 + cy * 0.5);
        data.positions.push(width * sx, y, z);
        data.uvs.push(j / rings, i / sections);
        if (i < sections && j < rings) {
          const a0 = i * (rings + 1) + j;
          data.indices.push(a0, a0 + rings + 1, a0 + 1, a0 + 1, a0 + rings + 1, a0 + rings + 2);
        }
      }
    }
    this.roadster.addChild(meshEntity(device, 'Lofted formula monocoque', data, this.paint));

    // Flat underbody plank and venturi floor — the widest visual element.
    primitive(this.roadster, 'Flat reference floor', 'box', this.carbon, [0, 0.075, 0.15], [1.92, 0.035, 4.35]);
    primitive(this.roadster, 'Floor edge fence', 'capsule', this.carbon, [-0.94, 0.09, 0.15], [0.05, 4.1, 0.05], [90, 0, 0]);
    primitive(this.roadster, 'Floor edge fence', 'capsule', this.carbon, [0.94, 0.09, 0.15], [0.05, 4.1, 0.05], [90, 0, 0]);

    // Front wing: wide low main plane, flapped element behind, endplates.
    primitive(this.roadster, 'Front wing mainplane', 'box', this.carbon, [0, 0.11, -2.28], [2.02, 0.025, 0.55]);
    primitive(this.roadster, 'Front wing flap', 'box', this.paint, [0, 0.185, -2.06], [1.78, 0.018, 0.3], [9, 0, 0]);
    primitive(this.roadster, 'Front wing endplate L', 'box', this.paint, [-0.99, 0.17, -2.22], [0.025, 0.17, 0.62]);
    primitive(this.roadster, 'Front wing endplate R', 'box', this.paint, [0.99, 0.17, -2.22], [0.025, 0.17, 0.62]);
    for (const side of [-1, 1]) primitive(this.roadster, 'Cascade winglet', 'box', this.carbon, [side * 0.62, 0.24, -1.95], [0.24, 0.012, 0.3], [18, side * 12, 0]);

    // Open cockpit: dark well, driver helmet, headrest padding, halo, mirrors.
    primitive(this.roadster, 'Open cockpit well', 'box', leather, [0, this.bodyTop(0.35) - 0.02, 0.42], [0.56, 0.05, 1.05]);
    primitive(this.roadster, 'Driver helmet', 'sphere', this.accentPaint, [0, this.bodyTop(0.42) + 0.16, 0.42], [0.26, 0.28, 0.28]);
    primitive(this.roadster, 'Helmet visor', 'sphere', this.carbon, [0, this.bodyTop(0.42) + 0.155, 0.3], [0.24, 0.12, 0.2]);
    primitive(this.roadster, 'Headrest pad', 'box', leather, [0, this.bodyTop(0.62) + 0.05, 0.68], [0.44, 0.2, 0.22], [-14, 0, 0]);
    const halo = meshEntity(device, 'Safety halo', torusData(0.34, 0.032, 40, 10, Math.PI * 1.15), this.carbon);
    halo.setLocalPosition(0, this.bodyTop(0.35) + 0.1, 0.32);
    halo.setLocalEulerAngles(90, 0, -18);
    this.roadster.addChild(halo);
    primitive(this.roadster, 'Halo front pillar', 'capsule', this.carbon, [0, this.bodyTop(-0.05) + 0.16, -0.05], [0.035, 0.35, 0.035], [22, 0, 0]);
    for (const side of [-1, 1]) {
      primitive(this.roadster, 'Mirror stalk', 'capsule', this.carbon, [side * 0.42, this.bodyTop(0.05) + 0.17, 0.02], [0.025, 0.18, 0.025], [0, 0, side * 55]);
      primitive(this.roadster, 'Aero mirror', 'sphere', this.paint, [side * 0.5, this.bodyTop(0.05) + 0.23, 0.02], [0.12, 0.07, 0.1]);
      // Sidepod air intakes beside the cockpit.
      primitive(this.roadster, 'Sidepod inlet', 'box', this.carbon, [side * 0.42, 0.52, 0.75], [0.09, 0.2, 0.7], [-6, 0, 0]);
      primitive(this.roadster, 'Sidepod undercut', 'sphere', this.paint, [side * 0.42, 0.4, 1.0], [0.22, 0.26, 0.85]);
    }

    // Airbox and shark fin leading back to the rear wing.
    primitive(this.roadster, 'Engine airbox', 'sphere', this.paint, [0, 0.82, 1.05], [0.3, 0.34, 0.75]);
    primitive(this.roadster, 'Airbox inlet', 'box', this.carbon, [0, 0.95, 0.82], [0.2, 0.14, 0.28]);
    primitive(this.roadster, 'Shark fin', 'box', this.paint, [0, 0.72, 1.6], [0.02, 0.5, 0.9], [-12, 0, 0]);
    primitive(this.roadster, 'T-bar camera', 'capsule', this.carbon, [0, 0.98, 0.7], [0.03, 0.16, 0.03]);

    // Rear wing: pylons, mainplane, flap, endplates, DRS-style upper element.
    for (const side of [-1, 1]) primitive(this.roadster, 'Rear wing pylon', 'capsule', this.carbon, [side * 0.14, 0.72, 1.85], [0.05, 0.62, 0.05], [18, 0, 0]);
    primitive(this.roadster, 'Rear wing mainplane', 'box', this.carbon, [0, 1.02, 2.06], [1.34, 0.03, 0.44], [-8, 0, 0]);
    primitive(this.roadster, 'Rear wing upper flap', 'box', this.paint, [0, 1.14, 1.96], [1.2, 0.02, 0.26], [-14, 0, 0]);
    for (const side of [-1, 1]) {
      primitive(this.roadster, 'Rear wing endplate', 'box', this.paint, [side * 0.68, 1.02, 2.02], [0.02, 0.4, 0.6]);
      primitive(this.roadster, 'Rear wing louvre', 'box', this.carbon, [side * 0.69, 1.06, 1.9], [0.012, 0.2, 0.16], [-14, 0, 0]);
    }
    primitive(this.roadster, 'Beam wing', 'box', this.carbon, [0, 0.42, 2.1], [1.1, 0.02, 0.24], [-18, 0, 0]);
    primitive(this.roadster, 'FIA rain light', 'box', red, [0, 0.5, 2.22], [0.05, 0.14, 0.03]);

    // Rear crash structure, diffuser and strakes.
    primitive(this.roadster, 'Rear crash structure', 'box', this.carbon, [0, 0.35, 2.12], [0.5, 0.32, 0.2]);
    primitive(this.roadster, 'Rear diffuser', 'box', this.carbon, [0, 0.2, 2.12], [1.5, 0.24, 0.3], [-16, 0, 0]);
    for (let x = -0.55; x <= 0.55; x += 0.22) primitive(this.roadster, 'Diffuser strake', 'box', this.carbon, [x, 0.17, 2.16], [0.02, 0.18, 0.3], [-16, 0, 0]);
    primitive(this.roadster, 'Exhaust tailpipe', 'cylinder', trim, [0, 0.42, 2.1], [0.1, 0.16, 0.1], [90, 0, 0]);

    // Suspension: paired wishbones connect the monocoque to each exposed wheel.
    for (const side of [-1, 1]) {
      for (const [z, front] of [[-1.5, true], [1.45, false]] as [number, boolean][]) {
        for (const arm of [[0.5, -0.14], [0.34, 0.14]] as [number, number][]) {
          primitive(this.roadster, front ? 'Front wishbone' : 'Rear wishbone', 'capsule', this.carbon,
            [side * 0.68, arm[0], z + arm[1]], [0.028, 0.72, 0.028], [0, 0, side * 88]);
        }
        primitive(this.roadster, front ? 'Pushrod' : 'Rear pullrod', 'capsule', trim, [side * 0.62, 0.52, z + 0.02], [0.02, 0.5, 0.02], [0, 0, side * 62]);
        primitive(this.roadster, 'Brake duct inlet', 'box', this.carbon, [side * 0.8, 0.36, z], [0.14, 0.3, 0.24]);
      }
      for (const z of [-1.5, 1.45]) this.createWheel(side * 1.02, z, z < 0, rubber);
    }

    const steering = meshEntity(device, 'Steering wheel', torusData(0.14, 0.02, 32, 8), leather);
    steering.setLocalPosition(0, this.bodyTop(0.1) + 0.09, -0.02);
    steering.setLocalEulerAngles(-24, 0, 0);
    this.roadster.addChild(steering);
    primitive(this.roadster, 'Steering column', 'capsule', this.carbon, [0, this.bodyTop(0.05), -0.1], [0.035, 0.35, 0.035], [70, 0, 0]);

    this.createPlate();
    this.createStripe();
    this.stripe.enabled = false;
  }

  private bodyWidth(z: number): number {
    // Slim central body only — wheels live fully outboard.
    if (z < -0.4) return Math.max(0.045, 0.05 + (z + 2.3) / 1.9 * 0.3);            // pointed nose
    if (z < 1.3) return 0.36 + 0.09 * Math.exp(-Math.pow((z - 0.65) / 0.75, 2));      // cockpit + sidepods
    return Math.max(0.14, 0.4 * Math.exp(-Math.pow((z - 1.3) / 0.6, 2)) + 0.1);      // tapered tail
  }

  private bodyTop(z: number): number {
    if (z < -0.4) return 0.3 + (z + 2.3) / 1.9 * 0.22;                                // low nose rises to cockpit
    if (z < 0.9) return 0.56 + 0.09 * Math.exp(-Math.pow((z - 0.2) / 0.45, 2));       // cockpit rim
    return Math.max(0.44, 0.72 - 0.3 * ((z - 0.9) / 1.4));                            // engine cover slopes to tail
  }

  private createWheel(x: number, z: number, front: boolean, rubber: pc.Material): void {
    const steer = new pc.Entity(front ? 'Front steer axis' : 'Rear axle');
    steer.setLocalPosition(x, 0.36, z);
    const spin = new pc.Entity('Rolling wheel');
    steer.addChild(spin);
    this.roadster.addChild(steer);
    const assembly = new pc.Entity('Forged five-spoke wheel');
    assembly.setLocalEulerAngles(0, 90, 0);
    spin.addChild(assembly);
    const tire = meshEntity(this.app.graphicsDevice, 'Wide slick racing tire', torusData(0.285, 0.077, 48, 12), rubber);
    tire.setLocalScale(1, 1, 2.15);
    assembly.addChild(tire);
    for (const side of [-1, 1]) {
      const lip = meshEntity(this.app.graphicsDevice, 'Polished rim lip', torusData(0.235, 0.018, 48, 8), this.rim);
      lip.setLocalPosition(0, 0, side * 0.105);
      assembly.addChild(lip);
      primitive(assembly, 'Ventilated brake disc', 'cylinder', this.carbon, [0, 0, side * 0.072], [0.4, 0.02, 0.4], [90, 0, 0]);
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2;
        primitive(assembly, 'Forged alloy spoke', 'box', this.rim, [Math.sin(a) * 0.13, Math.cos(a) * 0.13, side * 0.108], [0.045, 0.24, 0.026], [0, 0, -a * pc.math.RAD_TO_DEG]);
      }
      primitive(assembly, 'Satin wheel hub', 'cylinder', this.rim, [0, 0, side * 0.115], [0.1, 0.04, 0.1], [90, 0, 0]);
    }
    this.wheels.push({ steer, spin, front });
  }

  private createStripe(): void {
    const data = meshData();
    for (const [start, end] of [[-2.08, -0.85], [1.05, 2.06]]) {
      for (const side of [-1, 1]) {
        const base = data.positions.length / 3;
        for (let i = 0; i <= 18; i++) {
          const z = start! + i / 18 * (end! - start!);
          for (const x of [side * 0.13 - 0.055, side * 0.13 + 0.055]) data.positions.push(x, this.bodyTop(z) + 0.007, z);
          if (i < 18) { const p = base + i * 2; data.indices.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
        }
      }
    }
    this.stripe.addChild(meshEntity(this.app.graphicsDevice, 'Twin fine racing stripes', data, this.carbon));
  }

  private createPlate(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#e7e6d9'; ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#26342f'; ctx.font = '500 34px monospace'; ctx.textAlign = 'center'; ctx.fillText('FOCUS 01', 128, 45);
    const texture = new pc.Texture(this.app.graphicsDevice, { name: 'Original FOCUS registration', mipmaps: true });
    texture.setSource(canvas);
    const mat = material('Focus registration', '#ffffff', 0.1, 0.5);
    mat.diffuseMap = texture; mat.update();
    primitive(this.roadster, 'Registration plate', 'box', mat, [0, 0.51, 2.199], [0.62, 0.155, 0.025]);
  }

  private createContactShadow(): void {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const gradient = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    gradient.addColorStop(0, 'rgba(10,18,17,.65)'); gradient.addColorStop(0.55, 'rgba(10,18,17,.32)'); gradient.addColorStop(1, 'rgba(10,18,17,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    const texture = new pc.Texture(this.app.graphicsDevice, { name: 'Procedural soft contact shadow', mipmaps: false });
    texture.setSource(canvas);
    const mat = material('Soft tyre / chassis contact', '#0d1715');
    mat.opacityMap = texture; mat.opacityMapChannel = 'a'; mat.blendType = pc.BLEND_NORMAL; mat.depthWrite = false; mat.useLighting = false; mat.update();
    const shadow = primitive(this.root, 'Grounded vehicle contact', 'plane', mat, [0, 0.018, 0], [3.2, 1, 5.8]);
    if (shadow.render) shadow.render.castShadows = false;
  }

  private loadConcept(): void {
    const url = this.options.vehicleUrl ?? '/assets/cars/concept/CarConcept.glb';
    this.app.assets.loadFromUrl(url, 'container', (error, asset) => {
      if (this.disposed) return;
      if (error || !asset?.resource) {
        this.options.onAssetFallback?.(`GLB unavailable; original procedural formula car active. ${String(error ?? 'Empty container')}`);
        return;
      }
      try {
        this.conceptAsset = asset;
        const container = asset.resource as pc.ContainerResource;
        const imported = container.instantiateRenderEntity({ castShadows: true, receiveShadows: true }) as pc.Entity;
        // instantiateRenderEntity returns the source root itself. Preserve its Z-up→Y-up
        // matrix; put our heading/scale on a separate parent rather than overwriting it.
        const model = new pc.Entity('Car Concept — Eric Chadwick / DGG — CC BY 4.0');
        model.addChild(imported);
        // Source is in metres and its nose points +Z. Both rigs expose a -Z nose.
        model.setLocalEulerAngles(0, 180, 0);
        model.setLocalScale(0.95, 0.95, 0.95);
        model.setLocalPosition(0, -0.02, 0);
        this.motion.addChild(model);
        this.concept = model;
        const clones = new Map<pc.Material, pc.StandardMaterial>();
        const renders = model.findComponents('render') as pc.RenderComponent[];
        for (const render of renders) {
          for (const instance of render.meshInstances) {
            const original = instance.material;
            if (!(original instanceof pc.StandardMaterial)) continue;
            let clone = clones.get(original);
            if (!clone) {
              clone = original.clone(); clones.set(original, clone);
              if (/^Paint 1/.test(original.name)) this.primaryMaterials.push(clone);
              if (/^Paint 2/.test(original.name)) this.secondaryMaterials.push(clone);
              if (/^Rim/.test(original.name)) this.rimMaterials.push(clone);
              if (/Interior 3/.test(original.name)) { clone.diffuse = new pc.Color().fromString('#a9b69c'); clone.update(); }
            }
            instance.material = clone;
          }
        }
        for (const name of ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR']) {
          const node = model.findByName(name) as pc.Entity | null;
          if (node) this.conceptWheels.push({ node, front: name.includes('Front') });
        }
        this.setPaint(this.paintHex);
        this.setWheels(this.wheelStyle);
        this.setDecal(this.decal);
        // Do not change a vehicle while a measured mission is already in progress.
        if (this.scene !== 'mission') this.updateVisibility();
        else {
          model.enabled = false; this.roadster.enabled = true; this.stripe.enabled = this.decal === 'stripe';
          (this.app.graphicsDevice.canvas as HTMLCanvasElement).dataset.vehicle = 'focus-f01-procedural';
        }
      } catch (reason) {
        this.options.onAssetFallback?.(`GLB decode failed; original procedural formula car active. ${String(reason)}`);
      }
    });
  }

  setScene(scene: RenderScene): void { this.scene = scene; this.updateVisibility(); }
  setCar(id: 'concept' | 'roadster'): void { this.carId = id; this.updateVisibility(); }

  private updateVisibility(): void {
    const showConcept = this.carId === 'concept' && this.concept !== null;
    if (this.concept) this.concept.enabled = showConcept;
    this.roadster.enabled = !showConcept;
    this.stripe.enabled = !showConcept && this.decal === 'stripe';
    (this.app.graphicsDevice.canvas as HTMLCanvasElement).dataset.vehicle = showConcept ? 'car-concept-cc-by-4' : 'focus-f01-procedural';
  }

  setPaint(hex: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    this.paintHex = hex;
    const color = new pc.Color().fromString(hex);
    this.paint.diffuse.copy(color); this.paint.update();
    this.accentPaint.diffuse.set(color.r * 0.87, color.g * 0.87, color.b * 0.87); this.accentPaint.update();
    for (const mat of this.primaryMaterials) {
      mat.diffuse.copy(color); mat.diffuseMap = null; mat.metalness = 0.35; mat.gloss = 0.8; mat.clearCoat = 0.95; mat.clearCoatGloss = 0.94; mat.update();
    }
    this.updateSecondaryPaint();
  }

  private updateSecondaryPaint(): void {
    const color = this.decal === 'stripe' ? new pc.Color().fromString('#25332f') : new pc.Color().fromString(this.paintHex);
    for (const mat of this.secondaryMaterials) { mat.diffuse.copy(color); mat.diffuseMap = null; mat.metalness = 0.35; mat.gloss = 0.8; mat.update(); }
  }

  setWheels(style: 'standard' | 'sport'): void {
    this.wheelStyle = style;
    const color = new pc.Color().fromString(style === 'sport' ? '#36443d' : '#b8c4c0');
    this.rim.diffuse.copy(color); this.rim.update();
    for (const mat of this.rimMaterials) { mat.diffuse.copy(color); mat.diffuseMap = null; mat.metalness = 0.84; mat.gloss = 0.8; mat.update(); }
  }

  setDecal(style: 'none' | 'stripe'): void {
    this.decal = style; this.updateSecondaryPaint(); this.updateVisibility();
  }

  update(state: RenderState, scene: RenderScene): void {
    const moving = scene === 'mission';
    const spin = moving ? state.progressS / 0.36 * pc.math.RAD_TO_DEG : 12;
    const steer = moving ? Math.max(-1, Math.min(1, state.steer)) : -0.18;
    const yaw = moving ? -Math.atan2(state.carVX, Math.max(5, state.forwardSpeed)) * pc.math.RAD_TO_DEG * 0.5 : 0;
    this.motion.setLocalEulerAngles(0, yaw, moving ? -steer * 1.8 - state.carVX * 0.18 : 0);
    for (const wheel of this.wheels) {
      wheel.steer.setLocalEulerAngles(0, wheel.front ? -steer * 23 : 0, 0);
      wheel.spin.setLocalEulerAngles(spin % 360, 0, 0);
    }
    // In the source's Blender frame, Z is up; its parent performs the Y-up conversion.
    for (const wheel of this.conceptWheels) wheel.node.setLocalEulerAngles(spin % 360, 0, wheel.front ? -steer * 23 : 0);
  }

  destroy(): void {
    this.disposed = true;
    this.root.destroy();
    if (this.conceptAsset) { this.conceptAsset.unload(); this.app.assets.remove(this.conceptAsset); }
  }
}
