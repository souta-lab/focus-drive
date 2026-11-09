import * as pc from 'playcanvas';
import { appendBeam, appendBox, appendCone, material, emissiveMaterial, meshData, meshEntity, primitive, type MeshData } from './geometry';
import { centerX, EVALUATION_HALF_WIDTH, roadTangent, visualHalfWidth } from './road';

export interface WorldTheme { sky: string; horizon: string; fog: string; sun: string; ambient: string; sea: string; land: string; mountain: string; asphalt: string; night: boolean }
export const WORLD_THEMES: Record<number, WorldTheme> = {
  1: { sky: '#bacbc9', horizon: '#eddfc6', fog: '#d6d7c8', sun: '#fff0d4', ambient: '#9ba6a0', sea: '#6c8c8b', land: '#787f65', mountain: '#8b9d93', asphalt: '#444c47', night: false },
  2: { sky: '#b8cccf', horizon: '#e2e6da', fog: '#c7d2cc', sun: '#fff0d7', ambient: '#99aaa8', sea: '#7b9294', land: '#596c56', mountain: '#80928b', asphalt: '#414944', night: false },
  3: { sky: '#182a35', horizon: '#687d83', fog: '#42585d', sun: '#c4d9d6', ambient: '#657f88', sea: '#2a444e', land: '#34484a', mountain: '#3a535e', asphalt: '#303d3e', night: true },
  4: { sky: '#9bbfc5', horizon: '#f0e6d5', fog: '#d3e1dc', sun: '#fff2d9', ambient: '#a4bfbc', sea: '#d5e0d9', land: '#a6b2a2', mountain: '#b9cbc3', asphalt: '#4f6563', night: false },
};

function noise(seed: number): number {
  const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function textureFromCanvas(device: pc.GraphicsDevice, canvas: HTMLCanvasElement, name: string): pc.Texture {
  const texture = new pc.Texture(device, { name, mipmaps: true, addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR, anisotropy: 8 });
  texture.setSource(canvas);
  return texture;
}

export function createSurfaceTextures(device: pc.GraphicsDevice): { asphalt: pc.Texture; water: pc.Texture; normal: pc.Texture } {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const a = 175 + Math.round(noise(i + 73) * 63);
    image.data[i * 4] = a; image.data[i * 4 + 1] = a; image.data[i * 4 + 2] = a - 3; image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const asphalt = textureFromCanvas(device, canvas, 'Original fine aggregate asphalt');
  const waterCanvas = document.createElement('canvas'); waterCanvas.width = waterCanvas.height = 256;
  const wctx = waterCanvas.getContext('2d')!;
  const waterImage = wctx.createImageData(256, 256), normalImage = wctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4;
    const wave = Math.sin(y * 0.74 + Math.sin(x * 0.04) * 2) * 0.5 + Math.sin(y * 1.9 + x * 0.08) * 0.25;
    const value = 215 + wave * 24;
    waterImage.data[i] = value; waterImage.data[i + 1] = value + 4; waterImage.data[i + 2] = value + 5; waterImage.data[i + 3] = 255;
    normalImage.data[i] = 128 + Math.sin(x * 0.17 + y * 0.18) * 7; normalImage.data[i + 1] = 128 + wave * 18; normalImage.data[i + 2] = 253; normalImage.data[i + 3] = 255;
  }
  wctx.putImageData(waterImage, 0, 0);
  const water = textureFromCanvas(device, waterCanvas, 'Original still coastal wavelets');
  const normalCanvas = document.createElement('canvas'); normalCanvas.width = normalCanvas.height = 256;
  normalCanvas.getContext('2d')!.putImageData(normalImage, 0, 0);
  const normal = textureFromCanvas(device, normalCanvas, 'Original fine wave normal');
  return { asphalt, water, normal };
}

/** Static world art. Only corridor translation follows the authoritative distance. */
export class ScenicWorld {
  readonly root = new pc.Entity('Scenic world');
  private corridor: pc.Entity | null = null;
  private readonly backdrop = new pc.Entity('Distant landscape');
  private readonly coast = new pc.Entity('Coastal sea');
  private readonly clouds = new pc.Entity('Cloud sea');
  private readonly city = new pc.Entity('Night skyline');
  private readonly bridge = new pc.Entity('Dawn suspension bridge');
  private worldId = 1;
  private seed: number;
  private bucket = Number.NaN;
  private progress = 0;
  private allowedHalfWidth = EVALUATION_HALF_WIDTH;
  private readonly roadMat = material('Fine graphite asphalt', '#444c47', 0.08, 0.25);
  private readonly lineMat = material('Warm white road paint', '#f3f0dc', 0.02, 0.33);
  private readonly edgeMat = material('Outer road shoulder', '#b2b2a1', 0.0, 0.25);
  private readonly landMat = material('Coastal scrubland', '#787f65', 0, 0.15);
  private readonly cliffMat = material('Weathered limestone', '#9b9b85', 0, 0.12);
  private readonly foliageMat = material('Mediterranean pine foliage', '#3e5746', 0, 0.13);
  private readonly trunkMat = material('Warm tree bark', '#665c48', 0, 0.12);
  private readonly railMat = material('Satin guardrail', '#9aa69c', 0.65, 0.66);
  private readonly lampMat = material('Roadside light graphite', '#3c4c45', 0.55, 0.5);
  private readonly lightMat = emissiveMaterial('Warm steady lamp diffuser', '#fff0cd', 0.5);
  private readonly waterMat = material('Quiet coastal water', '#6c8c8b', 0.3, 0.88);
  private readonly boardMat = material('Sector board off-white', '#e9e6d4', 0.05, 0.45);
  private readonly inkMat = material('Sector board ink', '#36443b', 0.05, 0.4);
  private readonly flagMatA = material('Lime sector flag', '#c3d59a', 0.05, 0.5);
  private readonly flagMatB = material('Paper sector flag', '#e8e3d0', 0.05, 0.5);
  private readonly turbineMat = material('Pale wind turbine', '#d7dcd0', 0.15, 0.42);
  private readonly sectorMat = material('Resurfaced road sector', '#4c554f', 0.06, 0.3);
  private readonly curbMatA = material('Warm shoulder curb', '#c9b9a2', 0.02, 0.3);
  private readonly curbMatB = material('Pale shoulder curb', '#e8e5d6', 0.02, 0.3);
  private readonly farMat = material('Distant atmospheric mountains', '#a7b5a7', 0, 0.1);
  private readonly nearMat = material('Coastal ridge', '#82968b', 0, 0.1);
  private readonly snowMat = material('Alpine snow / cloud highlights', '#e7e8db', 0, 0.3);

  constructor(private readonly app: pc.Application, seed: number) {
    this.seed = seed;
    app.root.addChild(this.root);
    this.root.addChild(this.backdrop);
    this.root.addChild(this.coast);
    this.root.addChild(this.clouds);
    this.root.addChild(this.city);
    this.root.addChild(this.bridge);
    const textures = createSurfaceTextures(app.graphicsDevice);
    this.roadMat.diffuseMap = textures.asphalt;
    this.roadMat.update();
    this.waterMat.diffuseMap = textures.water; this.waterMat.normalMap = textures.normal;
    this.waterMat.diffuseMapTiling.set(48, 80); this.waterMat.normalMapTiling.set(48, 80); this.waterMat.bumpiness = 0.33; this.waterMat.update();
    primitive(this.coast, 'Actual reflective sea surface', 'plane', this.waterMat, [-905, -6.1, -400], [1800, 1, 2400]);
    this.createBackdrop();
    this.createBridge();
    this.createCity();
    this.createClouds();
    this.setWorld(1);
  }

  private addStrip(
    data: MeshData, start: number, end: number, step: number,
    left: (s: number) => number, right: (s: number) => number,
    height: (s: number, offset: number) => number = () => 0,
  ): void {
    const n = Math.max(1, Math.ceil((end - start) / step));
    const base = data.positions.length / 3;
    for (let i = 0; i <= n; i++) {
      const s = start + i / n * (end - start);
      const x = centerX(s, this.seed);
      const a = left(s), b = right(s);
      const l = Math.min(a, b), r = Math.max(a, b);
      data.positions.push(x + l, height(s, l), -(s - this.bucket), x + r, height(s, r), -(s - this.bucket));
      data.uvs.push(l * 0.18, s * 0.18, r * 0.18, s * 0.18);
      if (i < n) { const p = base + i * 2; data.indices.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
    }
  }

  private regenerate(): void {
    if (this.corridor) { this.destroyMeshes(this.corridor); this.corridor.destroy(); }
    const root = new pc.Entity('Streamed curved road / authoritative centre function');
    this.root.addChild(root); this.corridor = root;
    const start = this.bucket, end = start + 1200;
    const asphalt = meshData(), paint = meshData(), shoulder = meshData(), land = meshData(), cliff = meshData();
    this.addStrip(asphalt, start, end, 3, s => -visualHalfWidth(s), s => visualHalfWidth(s));
    for (const side of [-1, 1]) {
      const line = side * this.allowedHalfWidth;
      this.addStrip(paint, start, end, 3, () => line - 0.045, () => line + 0.045, () => 0.014);
      this.addStrip(shoulder, start, end, 3, s => side * visualHalfWidth(s) - 0.14, s => side * visualHalfWidth(s) + 0.14, () => -0.015);
      // Deliberately distinct, wider scenic tarmac and exact scoring boundaries.
      const outer = (s: number) => side * (visualHalfWidth(s) - 0.23);
      this.addStrip(paint, start, end, 3, s => outer(s) - 0.025, s => outer(s) + 0.025, () => 0.012);
    }
    for (let s = Math.ceil(start / 12) * 12; s < end; s += 12) this.addStrip(paint, s, s + 4.5, 2, () => -0.055, () => 0.055, () => 0.016);
    for (const [a, b] of [[4.5, 8], [8, 16], [16, 32], [32, 64], [64, 160]]) {
      this.addStrip(land, start, end, 7, () => a!, () => b!, (s, offset) => this.groundY(s, offset));
    }
    this.addStrip(cliff, start, end, 6, s => -visualHalfWidth(s) - 0.13, () => -10, (s, offset) => -Math.max(0, -offset - 4.4) * 0.65 + Math.sin(s * 0.08) * 0.15);
    this.addStrip(cliff, start, end, 6, () => -10, () => -21, (s, offset) => -3.6 - (-offset - 10) * 0.32 + Math.sin(s * 0.08) * 0.16);
    if (this.worldId === 2) {
      for (const [a, b] of [[-40, -21], [-90, -40], [-200, -90]]) this.addStrip(land, start, end, 9, () => a!, () => b!, (s, offset) => this.groundY(s + 50, -offset) - 5);
    }
    root.addChild(meshEntity(this.app.graphicsDevice, 'Continuous variable-width tarmac', asphalt, this.roadMat, false));
    root.addChild(meshEntity(this.app.graphicsDevice, 'White dashed line and precise evaluation edges', paint, this.lineMat, false));
    root.addChild(meshEntity(this.app.graphicsDevice, 'Fine gravel shoulders', shoulder, this.edgeMat, false));
    if (this.worldId !== 4) {
      root.addChild(meshEntity(this.app.graphicsDevice, 'Rolling coastal / alpine land', land, this.landMat, false));
      root.addChild(meshEntity(this.app.graphicsDevice, 'Limestone sea cliffs', cliff, this.cliffMat, false));
    }
    this.createRoadside(root, start, end);
    this.createLandmarks(root, start, end);
    root.setLocalPosition(0, 0, this.progress - this.bucket);
  }

  private groundY(s: number, offset: number): number {
    const rise = Math.max(0, offset - 7);
    return rise * (this.worldId === 2 ? 0.44 : 0.24) + Math.sin(s * 0.018 + offset * 0.02) * Math.min(5, rise * 0.16) - 0.1;
  }

  private createRoadside(root: pc.Entity, start: number, end: number): void {
    const rails = meshData(), trunks = meshData(), foliage = meshData(), poles = meshData(), lights = meshData();
    for (let s = Math.ceil(start / 8) * 8; s < end; s += 8) {
      const x = centerX(s, this.seed), z = -(s - this.bucket), yaw = -Math.atan(roadTangent(s, this.seed));
      if (this.worldId === 4) appendBox(rails, x, -0.23, z - 4, visualHalfWidth(s) * 2 + 0.4, 0.42, 8.2, yaw);
      for (const side of [-1, 1]) {
        const gx = x + side * (visualHalfWidth(s) + 0.38);
        appendBox(rails, gx, 0.4, z, 0.085, 0.8, 0.09, yaw);
        for (const y of [0.47, 0.82]) appendBox(rails, gx, y, z - 4, 0.09, 0.12, 8.2, yaw);
      }
    }
    for (let s = Math.ceil(start / 19) * 19; s < end; s += 19) {
      const n = noise(s + 8), offset = 8.5 + n * 13;
      const x = centerX(s, this.seed) + offset, z = -(s - this.bucket), ground = this.groundY(s, offset);
      const height = this.worldId === 2 ? 5 + n * 6 : 3.6 + n * 3.4;
      if (this.worldId !== 3 && this.worldId !== 4) {
        appendCone(trunks, x, ground, z, 0.15 + n * 0.09, height * 0.7, 7, 0.06);
        if (this.worldId === 2) {
          for (let layer = 0; layer < 3; layer++) appendCone(foliage, x, ground + height * (0.25 + layer * 0.2), z, height * (0.31 - layer * 0.06), height * 0.45, 8, 0.05);
        } else {
          appendCone(foliage, x, ground + height * 0.54, z, 1.5 + n * 1.3, height * 0.28, 9, 0.65);
          appendCone(foliage, x + 0.2, ground + height * 0.76, z, 1.2 + n, height * 0.2, 8, 0.1);
        }
      }
      if (noise(s + 120) > 0.45 && this.worldId === 1) {
        const bushOffset = 6.5 + n;
        appendCone(foliage, centerX(s + 7, this.seed) + bushOffset, this.groundY(s + 7, bushOffset), -(s + 7 - this.bucket), 0.85, 0.75, 7, 0.3);
      }
    }
    // Keep near-field poles outside product/chase sightlines; distant lamps still
    // establish road scale without ever cutting across the car or fixed stimuli.
    for (let s = Math.ceil((start + 144) / 48) * 48; s < end; s += 48) {
      const side = this.worldId === 3 ? (Math.floor(s / 48) % 2 ? -1 : 1) : 1;
      const x = centerX(s, this.seed) + side * 5.15, z = -(s - this.bucket);
      appendBox(poles, x, 2.7, z, 0.11, 5.4, 0.11);
      appendBox(poles, x - side * 0.6, 5.3, z, 1.3, 0.1, 0.12);
      appendBox(poles, x - side * 1.2, 5.25, z, 0.42, 0.1, 0.65);
      appendBox(lights, x - side * 1.2, 5.18, z, 0.32, 0.025, 0.55);
    }
    for (const [name, data, mat] of [['Continuous satin guardrails', rails, this.railMat], ['Pine trunks', trunks, this.trunkMat], ['Sculptural evergreen canopy', foliage, this.foliageMat], ['Slender road luminaires', poles, this.lampMat], ['Steady warm lamp surfaces', lights, this.lightMat]] as [string, MeshData, pc.Material][]) {
      if (data.positions.length) root.addChild(meshEntity(this.app.graphicsDevice, name, data, mat, name.includes('Pine') || name.includes('canopy')));
    }
    this.createCourseVariety(root, start, end);
  }

  /** Landmarks that break the endless-road look without touching the driven geometry. */
  private createCourseVariety(root: pc.Entity, start: number, end: number): void {
    const sector = meshData(), boards = meshData(), ink = meshData(), flagsA = meshData(), flagsB = meshData(), curbsA = meshData(), curbsB = meshData();
    for (let s = Math.ceil(start / 180) * 180; s < end; s += 180) this.addStrip(sector, s, s + 9, 2, () => -visualHalfWidth(s), () => visualHalfWidth(s), () => 0.003);
    for (let s = Math.ceil(start / 12) * 12; s < end; s += 12) {
      const x = centerX(s, this.seed), z = -(s - this.bucket), yaw = -Math.atan(roadTangent(s, this.seed)), even = Math.floor(s / 12) % 2 === 0;
      for (const side of [-1, 1]) {
        const cx = x + side * (visualHalfWidth(s) + 0.09);
        appendBox(even ? curbsA : curbsB, cx, 0.035, z, 0.2, 0.05, 1.5, yaw);
      }
    }
    if (this.worldId !== 4) {
      for (let s = Math.ceil((start + 30) / 100) * 100; s < end; s += 100) {
        const x = centerX(s, this.seed) + visualHalfWidth(s) + 1.5, z = -(s - this.bucket), yaw = -Math.atan(roadTangent(s, this.seed));
        appendBox(boards, x, 0.8, z, 0.09, 1.6, 0.09, yaw);
        appendBox(boards, x, 1.38, z, 1.0, 0.66, 0.06, yaw);
        appendBox(ink, x, 1.33, z + 0.035, 0.86, 0.14, 0.02, yaw);
        appendBox(ink, x, 1.49, z + 0.035, 0.54, 0.05, 0.02, yaw);
      }
      for (let s = Math.ceil((start + 60) / 120) * 120; s < end; s += 120) {
        const side = Math.floor(s / 120) % 2 === 0 ? 1 : -1;
        const x = centerX(s, this.seed) + side * (visualHalfWidth(s) + 1.05), z = -(s - this.bucket), yaw = -Math.atan(roadTangent(s, this.seed));
        appendBox(ink, x, 1.25, z, 0.05, 2.5, 0.05);
        appendBox(Math.floor(s / 120) % 2 === 0 ? flagsA : flagsB, x, 1.9, z, 1.5, 0.8, 0.05, yaw);
      }
      if (this.worldId === 1 || this.worldId === 2) {
        const towers = meshData(), blades = meshData();
        for (let s = Math.ceil((start + 200) / 640) * 640; s < end; s += 640) {
          const offset = 48 + noise(s + 3) * 26;
          const x = centerX(s, this.seed) - offset, z = -(s - this.bucket), ground = this.groundY(s, offset);
          appendCone(towers, x, ground, z, 0.55, 17, 8, 0.18);
          appendBox(towers, x, ground + 17.1, z, 1.1, 0.7, 2.2);
          for (let blade = 0; blade < 3; blade++) {
            const angle = blade / 3 * Math.PI * 2;
            appendBeam(blades, new pc.Vec3(x, ground + 17.1, z), new pc.Vec3(x, ground + 17.1 + Math.sin(angle) * 5.4, z - Math.cos(angle) * 5.4), 0.13, 4);
          }
        }
        if (towers.positions.length) {
          root.addChild(meshEntity(this.app.graphicsDevice, 'Cliff-top wind turbines', towers, this.turbineMat, false));
          root.addChild(meshEntity(this.app.graphicsDevice, 'Turbine blades', blades, this.turbineMat, false));
        }
      }
      for (let s = Math.ceil((start + 80) / 500) * 500; s < end; s += 500) {
        const x = centerX(s, this.seed) + visualHalfWidth(s) + 0.55, z = -(s - this.bucket), yaw = -Math.atan(roadTangent(s, this.seed));
        for (let block = 0; block < 9; block++) appendBox(block % 2 === 0 ? boards : ink, x, 0.65, z - block * 0.38, 0.12, 1.3, 0.38, yaw);
      }
      for (let s = Math.ceil((start + 120) / 500) * 500; s < end; s += 500) {
        const x0 = centerX(s, this.seed), z = -(s - this.bucket), yaw = -Math.atan(roadTangent(s, this.seed));
        for (let block = 0; block < 12; block++) {
          const offset = -4.04 + block * 0.735;
          appendBox(block % 2 === 0 ? boards : ink, x0 + offset, 0.02, z, 0.72, 0.02, 3.2, yaw);
        }
      }
      for (let s = Math.ceil((start + 180) / 360) * 360; s < end; s += 360) {
        const x = centerX(s, this.seed), z = -(s - this.bucket), yaw = -Math.atan(roadTangent(s, this.seed));
        const half = visualHalfWidth(s) + 0.9;
        for (const side of [-1, 1]) appendBox(ink, x + side * half, 3.2, z, 0.18, 6.4, 0.18, yaw);
        appendBox(ink, x, 6.35, z, half * 2 + 0.18, 0.24, 0.22, yaw);
        appendBox(boards, x + half * 0.55, 5.55, z, 2.5, 1.15, 0.07, yaw);
        appendBox(ink, x + half * 0.55, 5.05, z + 0.045, 2.15, 0.16, 0.02, yaw);
      }
      if (boards.positions.length) {
        root.addChild(meshEntity(this.app.graphicsDevice, 'Distance and sector boards', boards, this.boardMat, false));
        root.addChild(meshEntity(this.app.graphicsDevice, 'Board ink bands', ink, this.inkMat, false));
        root.addChild(meshEntity(this.app.graphicsDevice, 'Alternating lime flags', flagsA, this.flagMatA, false));
        root.addChild(meshEntity(this.app.graphicsDevice, 'Alternating paper flags', flagsB, this.flagMatB, false));
      }
    }
    if (sector.positions.length) root.addChild(meshEntity(this.app.graphicsDevice, 'Resurfaced road sectors', sector, this.sectorMat, false));
    if (curbsA.positions.length) root.addChild(meshEntity(this.app.graphicsDevice, 'Warm shoulder curb blocks', curbsA, this.curbMatA, false));
    if (curbsB.positions.length) root.addChild(meshEntity(this.app.graphicsDevice, 'Pale shoulder curb blocks', curbsB, this.curbMatB, false));
  }

  /** Per-world landmarks so the horizon is not only trees and sea. */
  private createLandmarks(root: pc.Entity, start: number, end: number): void {
    const stone = meshData(), warm = meshData(), glow = meshData(), water = meshData(), sky = meshData();
    if (this.worldId === 1 || this.worldId === 3) {
      // Harbour life: channel buoys, a lighthouse and moored hulls out on the water.
      for (let s = Math.ceil((start + 40) / 90) * 90; s < end; s += 90) {
        const side = Math.floor(s / 90) % 2 === 0 ? 1 : -1;
        appendCone(water, centerX(s, this.seed) + side * (26 + noise(s) * 22), -1.1, -(s - this.bucket), 1.1, 3.4, 7, 0.5);
      }
      for (let s = Math.ceil((start + 260) / 780) * 780; s < end; s += 780) {
        const x = centerX(s, this.seed) - 74, z = -(s - this.bucket);
        appendCone(stone, x, 0, z, 5.2, 16, 10, 3.4);
        appendCone(warm, x, 16, z, 3.0, 4.4, 9, 2.4);
        appendBox(glow, x, 20.9, z, 2.2, 1.1, 2.2);
      }
      for (let s = Math.ceil((start + 120) / 320) * 320; s < end; s += 320) {
        const x = centerX(s, this.seed) + 34 + noise(s + 5) * 16, z = -(s - this.bucket);
        appendBox(water, x, 0.5, z, 4.2, 1.0, 13);
        appendBox(warm, x, 1.6, z + 3.4, 2.4, 1.6, 3.4);
        appendBox(stone, x, 3.4, z + 2.6, 0.22, 5.0, 0.22);
      }
    } else if (this.worldId === 2) {
      // Alpine: rock outcrops, timber chalets and snow poles.
      for (let s = Math.ceil((start + 60) / 140) * 140; s < end; s += 140) {
        const offset = 26 + noise(s + 11) * 34, side = Math.floor(s / 140) % 2 === 0 ? 1 : -1;
        const x = centerX(s, this.seed) + side * offset, z = -(s - this.bucket), y = this.groundY(s, side * offset);
        for (let block = 0; block < 3; block++) appendBox(stone, x + block * 3.1, y + 1.4 + block * 0.7, z + block * 1.6, 4.4 - block, 3.2 + block * 1.4, 4.0 - block * 0.6, block * 0.4);
      }
      for (let s = Math.ceil((start + 200) / 420) * 420; s < end; s += 420) {
        const offset = 22 + noise(s + 3) * 12, x = centerX(s, this.seed) - offset, z = -(s - this.bucket), y = this.groundY(s, -offset);
        appendBox(warm, x, y + 2.2, z, 8.0, 4.4, 6.4);
        appendCone(stone, x, y + 4.4, z, 5.6, 3.2, 4, 0.1);
        appendBox(glow, x - 2.0, y + 2.4, z - 3.3, 1.5, 1.5, 0.14);
        appendBox(glow, x + 2.0, y + 2.4, z - 3.3, 1.5, 1.5, 0.14);
      }
      for (let s = Math.ceil((start + 10) / 22) * 22; s < end; s += 22) {
        const x = centerX(s, this.seed) - (visualHalfWidth(s) + 2.2);
        appendBox(warm, x, 0.85, -(s - this.bucket), 0.09, 1.7, 0.09);
      }
    } else {
      // Sky circuit: floating arches, ring beacons and drifting platforms.
      for (let s = Math.ceil((start + 180) / 300) * 300; s < end; s += 300) {
        const x = centerX(s, this.seed), z = -(s - this.bucket);
        const half = visualHalfWidth(s) + 5.5;
        appendBox(sky, x - half, 8.5, z, 1.0, 17, 1.0);
        appendBox(sky, x + half, 8.5, z, 1.0, 17, 1.0);
        appendBox(sky, x, 17.4, z, half * 2, 1.2, 1.2);
        appendBox(glow, x, 16.6, z, half * 1.7, 0.34, 0.4);
      }
      for (let i = 0; i < 26; i++) {
        const s = start + (i + 1) * (end - start) / 27;
        const side = i % 2 === 0 ? 1 : -1, offset = 30 + noise(i * 13) * 60;
        appendBox(sky, centerX(s, this.seed) + side * offset, -22 - noise(i) * 9, -(s - this.bucket), 26 + noise(i + 2) * 26, 3 + noise(i + 5) * 3, 20 + noise(i + 7) * 20, noise(i) * 0.5);
      }
    }
    for (const [name, data, mat] of [
      ['Landmark stonework', stone, this.cliffMat],
      ['Landmark painted shelters', warm, this.boardMat],
      ['Landmark lights', glow, this.lightMat],
      ['Harbour buoys and hulls', water, this.railMat],
      ['Sky circuit structures', sky, this.snowMat],
    ] as [string, MeshData, pc.Material][]) {
      if (data.positions.length) root.addChild(meshEntity(this.app.graphicsDevice, name, data, mat, false));
    }
  }

  private createBackdrop(): void {
    const far = meshData(), near = meshData(), snow = meshData();
    for (let i = 0; i < 16; i++) {
      const x = -540 + i * 72;
      const n = noise(i + 87), z = -680 - n * 160;
      const height = 56 + noise(i + 17) * 118;
      appendCone(far, x, -16, z, 100 + n * 65, height, 6, 3);
      if (i > 10) appendCone(near, 135 + (i - 11) * 80, -15, -340 - n * 130, 115, height * 1.1, 7, 0);
      appendCone(snow, x, -16 + height * 0.77, z, (100 + n * 65) * 0.23, height * 0.23, 6, 0);
    }
    this.backdrop.addChild(meshEntity(this.app.graphicsDevice, 'Layered distant mountain silhouettes', far, this.farMat, false));
    this.backdrop.addChild(meshEntity(this.app.graphicsDevice, 'Right-side coastal mountain range', near, this.nearMat, false));
    const caps = meshEntity(this.app.graphicsDevice, 'Alpine summit snow', snow, this.snowMat, false);
    caps.name = 'Alpine snow'; this.backdrop.addChild(caps);
  }

  private createBridge(): void {
    const concrete = material('Bridge limestone concrete', '#b5b6a1', 0, 0.3);
    const cableMat = material('Bridge cable satin metal', '#9fa99c', 0.55, 0.5);
    const deck = meshData(), cables = meshData();
    const z = -380;
    appendBox(deck, -206, 3.8, z, 342, 1.5, 12);
    appendBox(deck, -206, 4.8, z - 5.7, 342, 0.6, 0.35);
    appendBox(deck, -206, 4.8, z + 5.7, 342, 0.6, 0.35);
    for (const x of [-292, -132]) {
      for (const dz of [-6.2, 6.2]) appendBox(deck, x, 11, z + dz, 2.4, 39, 2.5);
      appendBox(deck, x, 27, z, 2.4, 2, 15);
      appendBox(deck, x, 13, z, 2.4, 1.1, 15);
    }
    const spans = [[-377, -292], [-292, -132], [-132, -35]];
    for (const [left, right] of spans) for (const dz of [-5.6, 5.6]) {
      let previous: pc.Vec3 | null = null;
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, x = left! + (right! - left!) * t;
        const y = left === -292 ? 8 + 21 * Math.pow(t * 2 - 1, 2) : (left === -377 ? 5 + t * 24 : 29 - t * 24);
        const next = new pc.Vec3(x, y, z + dz);
        if (previous) appendBeam(cables, previous, next, 0.17, 5);
        if (i % 2 === 0) appendBeam(cables, new pc.Vec3(x, 4.8, z + dz), next, 0.055, 4);
        previous = next;
      }
    }
    this.bridge.addChild(meshEntity(this.app.graphicsDevice, 'Long-span bridge and twin pylons', deck, concrete, false));
    this.bridge.addChild(meshEntity(this.app.graphicsDevice, 'Sweeping suspension cables and hangers', cables, cableMat, false));
  }

  private createCity(): void {
    const buildings = meshData(), windows = meshData();
    for (let i = 0; i < 42; i++) {
      const side = i < 21 ? -1 : 1, n = noise(i * 71);
      const x = side * (48 + n * 190), z = -200 - noise(i + 31) * 550, h = 12 + noise(i + 4) * 75;
      appendBox(buildings, x, h / 2 - 8, z, 10 + n * 18, h, 12 + n * 16);
      for (let y = 3; y < h - 8; y += 5) for (let col = -1; col <= 1; col++) {
        if (noise(i * 137 + y * 7 + col) > 0.46) appendBox(windows, x + col * 4, y, z + 7 + n * 8, 1.4, 0.7, 0.05);
      }
    }
    this.city.addChild(meshEntity(this.app.graphicsDevice, 'Quiet night skyline', buildings, material('Night skyline stone', '#263c43', 0.25, 0.4), false));
    this.city.addChild(meshEntity(this.app.graphicsDevice, 'Non-flashing warm city windows', windows, emissiveMaterial('Warm office windows', '#b6c4a5', 0.35), false));
  }

  private createClouds(): void {
    for (let i = 0; i < 18; i++) {
      const x = -450 + noise(i + 50) * 900, z = -100 - noise(i + 11) * 850;
      primitive(this.clouds, 'Soft sculpted cloud island', 'sphere', this.snowMat, [x, -30 - noise(i + 42) * 35, z], [100 + noise(i + 8) * 180, 12 + noise(i + 7) * 20, 70 + noise(i + 26) * 160]);
    }
    primitive(this.clouds, 'Cloud horizon', 'plane', this.snowMat, [0, -62, -600], [2400, 1, 2400]);
  }

  private nightOverride = false;

  /** Keep this world's scenery but light it as night. */
  setNight(on: boolean): void {
    if (this.nightOverride === on) return;
    this.nightOverride = on;
    this.setWorld(this.worldId);
  }

  setWorld(worldId: number): void {
    this.worldId = Math.max(1, Math.min(4, Math.round(worldId)));
    const theme = this.nightOverride ? WORLD_THEMES[3]! : WORLD_THEMES[this.worldId]!;
    for (const [mat, color] of [[this.roadMat, theme.asphalt], [this.landMat, theme.land], [this.waterMat, theme.sea], [this.farMat, theme.mountain], [this.nearMat, theme.land]] as [pc.StandardMaterial, string][]) { mat.diffuse = new pc.Color().fromString(color); mat.update(); }
    this.lightMat.emissiveIntensity = theme.night ? 1.4 : 0.35; this.lightMat.update();
    this.coast.enabled = this.worldId === 1 || this.worldId === 3;
    this.bridge.enabled = this.worldId === 1 || this.worldId === 3;
    this.backdrop.enabled = this.worldId !== 3 && this.worldId !== 4;
    const snow = this.backdrop.findByName('Alpine snow'); if (snow) snow.enabled = this.worldId === 2;
    this.city.enabled = this.worldId === 3;
    this.clouds.enabled = this.worldId === 4;
    this.bucket = Number.NaN;
    this.update(this.progress, this.seed, this.allowedHalfWidth);
  }

  update(progressS: number, seed = this.seed, allowedHalfWidth = EVALUATION_HALF_WIDTH): void {
    this.progress = progressS;
    const nextBucket = Math.floor((progressS - 120) / 120) * 120;
    if (nextBucket !== this.bucket || seed !== this.seed || allowedHalfWidth !== this.allowedHalfWidth) {
      this.seed = seed; this.bucket = nextBucket; this.allowedHalfWidth = allowedHalfWidth;
      this.regenerate();
    }
    this.corridor?.setLocalPosition(0, 0, progressS - this.bucket);
    // The distant scenery is deliberately stable: no head bob, FOV changes or animated ads.
    this.backdrop.setLocalPosition(-centerX(progressS, seed) * 0.12, 0, 0);
  }

  private destroyMeshes(entity: pc.Entity): void {
    for (const render of entity.findComponents('render') as pc.RenderComponent[]) for (const instance of render.meshInstances) instance.mesh?.destroy();
  }

  destroy(): void { if (this.corridor) this.destroyMeshes(this.corridor); this.root.destroy(); }
}
