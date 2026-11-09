import * as pc from 'playcanvas';

export interface MeshData {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

export function meshData(): MeshData {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

export function material(name: string, color: string, metalness = 0, gloss = 0.35): pc.StandardMaterial {
  const result = new pc.StandardMaterial();
  result.name = name;
  result.diffuse = new pc.Color().fromString(color);
  result.useMetalness = true;
  result.metalness = metalness;
  result.gloss = gloss;
  result.update();
  return result;
}

export function emissiveMaterial(name: string, color: string, strength = 0.5): pc.StandardMaterial {
  const result = material(name, color, 0.1, 0.65);
  result.emissive = new pc.Color().fromString(color);
  result.emissiveIntensity = strength;
  result.update();
  return result;
}

export function makeMesh(device: pc.GraphicsDevice, data: MeshData): pc.Mesh {
  const mesh = new pc.Mesh(device);
  mesh.setPositions(data.positions);
  mesh.setNormals(data.normals.length ? data.normals : pc.calculateNormals(data.positions, data.indices));
  if (data.uvs.length) mesh.setUvs(0, data.uvs);
  mesh.setIndices(data.indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

export function meshEntity(
  device: pc.GraphicsDevice,
  name: string,
  data: MeshData,
  mat: pc.Material,
  shadows = true,
): pc.Entity {
  const entity = new pc.Entity(name);
  const instance = new pc.MeshInstance(makeMesh(device, data), mat);
  entity.addComponent('render', { meshInstances: [instance], castShadows: shadows, receiveShadows: true });
  return entity;
}

export function primitive(
  parent: pc.Entity,
  name: string,
  type: 'box' | 'sphere' | 'cylinder' | 'cone' | 'capsule' | 'plane',
  mat: pc.Material,
  position: [number, number, number],
  scale: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
): pc.Entity {
  const entity = new pc.Entity(name);
  entity.addComponent('render', { type, material: mat, castShadows: true, receiveShadows: true });
  entity.setLocalPosition(...position);
  // PlayCanvas's cached capsule is 2m tall; expose uniform 1m primitive dimensions.
  entity.setLocalScale(scale[0], type === 'capsule' ? scale[1] * 0.5 : scale[1], scale[2]);
  entity.setLocalEulerAngles(...rotation);
  parent.addChild(entity);
  return entity;
}

/** Merge repeated scenery into a few draw calls rather than hundreds of entities. */
export function appendBox(
  data: MeshData,
  x: number, y: number, z: number,
  width: number, height: number, depth: number,
  yaw = 0,
): void {
  const faces = [
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
    [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
    [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],
    [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
    [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]],
    [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
  ];
  const normals = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let f = 0; f < faces.length; f++) {
    const base = data.positions.length / 3;
    for (let v = 0; v < 4; v++) {
      const p = faces[f]![v]!;
      const px = p[0]! * width / 2, pz = p[2]! * depth / 2;
      data.positions.push(x + px * c + pz * s, y + p[1]! * height / 2, z + pz * c - px * s);
      const normal = normals[f]!;
      data.normals.push(normal[0]! * c + normal[2]! * s, normal[1]!, normal[2]! * c - normal[0]! * s);
      data.uvs.push(v === 1 || v === 2 ? 1 : 0, v > 1 ? 1 : 0);
    }
    data.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

export function appendCone(
  data: MeshData, x: number, y: number, z: number,
  radius: number, height: number, sides = 8, topRadius = 0,
): void {
  for (let i = 0; i < sides; i++) {
    const a = i / sides * Math.PI * 2, b = (i + 1) / sides * Math.PI * 2;
    const base = data.positions.length / 3;
    data.positions.push(
      x + Math.cos(a) * radius, y, z + Math.sin(a) * radius,
      x + Math.cos(b) * radius, y, z + Math.sin(b) * radius,
      x + Math.cos(a) * topRadius, y + height, z + Math.sin(a) * topRadius,
      x + Math.cos(b) * topRadius, y + height, z + Math.sin(b) * topRadius,
    );
    data.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
}

export function appendBeam(data: MeshData, from: pc.Vec3, to: pc.Vec3, radius: number, sides = 5): void {
  const direction = new pc.Vec3().sub2(to, from).normalize();
  const side = new pc.Vec3().cross(direction, Math.abs(direction.y) > 0.95 ? pc.Vec3.RIGHT : pc.Vec3.UP).normalize();
  const up = new pc.Vec3().cross(direction, side).normalize();
  for (let i = 0; i < sides; i++) {
    const base = data.positions.length / 3;
    for (const [point, angle] of [[from, i / sides * Math.PI * 2], [to, i / sides * Math.PI * 2], [from, (i + 1) / sides * Math.PI * 2], [to, (i + 1) / sides * Math.PI * 2]] as [pc.Vec3, number][]) {
      const a = Math.cos(angle) * radius, b = Math.sin(angle) * radius;
      data.positions.push(point.x + side.x * a + up.x * b, point.y + side.y * a + up.y * b, point.z + side.z * a + up.z * b);
      data.normals.push((side.x * a + up.x * b) / radius, (side.y * a + up.y * b) / radius, (side.z * a + up.z * b) / radius);
    }
    data.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
}

/** Elliptical tube with a real hole: wheels, trim, roll hoops and Guide rings. */
export function torusData(major: number, minor: number, segments = 48, tubeSegments = 8, arc = Math.PI * 2): MeshData {
  const data = meshData();
  for (let i = 0; i <= segments; i++) {
    const a = i / segments * arc;
    for (let j = 0; j <= tubeSegments; j++) {
      const b = j / tubeSegments * Math.PI * 2;
      const r = major + minor * Math.cos(b);
      data.positions.push(r * Math.cos(a), r * Math.sin(a), minor * Math.sin(b));
      data.normals.push(Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b));
      data.uvs.push(i / segments, j / tubeSegments);
      if (i < segments && j < tubeSegments) {
        const p = i * (tubeSegments + 1) + j;
        data.indices.push(p, p + tubeSegments + 1, p + 1, p + 1, p + tubeSegments + 1, p + tubeSegments + 2);
      }
    }
  }
  return data;
}

export function alignBeam(entity: pc.Entity, from: pc.Vec3, to: pc.Vec3, thickness: number): void {
  entity.setPosition(new pc.Vec3().add2(from, to).mulScalar(0.5));
  entity.setLocalScale(thickness, from.distance(to), thickness);
  const direction = new pc.Vec3().sub2(to, from).normalize();
  entity.setRotation(new pc.Quat().setFromDirections(pc.Vec3.UP, direction));
}
