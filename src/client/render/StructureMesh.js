// Buildings, fortifications and props merged into chunked meshes that all
// share ONE atlas material (few draw calls, distance culled per chunk).
// Also owns animated props (windmills, radar dishes, beacons), sector flags
// and the night lighting pool.
import * as THREE from 'three';
import { WORLD_HALF } from '../../shared/constants.js';
import { MAT, MAT_INFO } from '../../shared/world/materials.js';
import { BF } from '../../shared/world/builder.js';
import { ATLAS_GRID, ATLAS_PAD, tileOffset } from './Textures.js';
import { srgbToLinear } from './TerrainMesh.js';
import { mulberry32 } from '../../shared/math.js';

const CHUNK = 128;
const NCH = Math.ceil((WORLD_HALF * 2) / CHUNK);

// metres covered by one texture tile per pattern: [u, v]
const TILE_M = {
  flat: [4, 4], concrete: [4, 4], brick: [2.4, 2.4], planks: [2, 2], corrugated: [2.2, 2.2], sandbag: [1.8, 1.1],
  tiles: [2, 2], asphalt: [4, 4], panel: [2.4, 2.4], windows: [3.4, 3.2], glass: [2, 2], crate: [1.1, 1.1],
  container: [2.44, 2.6], rock: [3, 3], canvas: [3, 3], net: [3, 3], hazard: [1.2, 1.2], rust: [3, 3], gravel: [3, 3],
  target: [0.9, 1.7], hesco: [1.5, 1.9], stone: [2.4, 2.4], redcross: [2.2, 2.2], leaves: [3, 3], bark: [2, 2],
};

export function atlasMaterial(atlas) {
  const mat = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.88, metalness: 0.02 });
  const T = (1 / ATLAS_GRID).toFixed(6);
  const P = ATLAS_PAD.toFixed(4);
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 atlasTile;\nvarying vec2 vTile;\nvarying vec2 vAUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTile = atlasTile;\nvAUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vTile;\nvarying vec2 vAUv;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec2 auv = fract(vAUv);
          vec2 tuv = vTile + (auv * (1.0 - 2.0 * ${P}) + ${P}) * ${T};
          vec4 sampledDiffuseColor = textureGrad(map, tuv, dFdx(vAUv) * ${T}, dFdy(vAUv) * ${T});
          diffuseColor *= sampledDiffuseColor;
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'atlas-v1';
  return mat;
}

class ChunkBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.tile = [];
    this.idx = [];
  }
  get count() {
    return this.pos.length / 3;
  }
  quad(p0, p1, p2, p3, n, uvs, color, tile) {
    const b = this.count;
    for (const p of [p0, p1, p2, p3]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) {
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color[0], color[1], color[2]);
      this.tile.push(tile[0], tile[1]);
    }
    for (const u of uvs) this.uv.push(u[0], u[1]);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  tri(p0, p1, p2, n, uvs, color, tile) {
    const b = this.count;
    for (const p of [p0, p1, p2]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 3; i++) {
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color[0], color[1], color[2]);
      this.tile.push(tile[0], tile[1]);
    }
    for (const u of uvs) this.uv.push(u[0], u[1]);
    this.idx.push(b, b + 1, b + 2);
  }
  // Smooth-shaded vertex list (for cylinders etc.)
  vert(p, n, u, color, tile) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(u[0], u[1]);
    this.col.push(color[0], color[1], color[2]);
    this.tile.push(tile[0], tile[1]);
    return this.count - 1;
  }
  build(material) {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('atlasTile', new THREE.Float32BufferAttribute(this.tile, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.matrixAutoUpdate = false;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

function matColor(m, rand) {
  const info = MAT_INFO[m] || MAT_INFO[0];
  const v = 0.9 + rand() * 0.18;
  return [srgbToLinear(info.color[0]) * v, srgbToLinear(info.color[1]) * v, srgbToLinear(info.color[2]) * v];
}

function matTile(m) {
  const info = MAT_INFO[m] || MAT_INFO[0];
  return tileOffset(info.pattern);
}

function matScale(m) {
  const info = MAT_INFO[m] || MAT_INFO[0];
  return TILE_M[info.pattern] || [3, 3];
}

function addBox(cb, b, color, tile, scale, skipBottom) {
  const { x0, y0, z0, x1, y1, z1 } = b;
  const [su, sv] = scale;
  // +x face
  cb.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [[z1 / su, y0 / sv], [z0 / su, y0 / sv], [z0 / su, y1 / sv], [z1 / su, y1 / sv]].map(flipV), color, tile);
  // -x
  cb.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[z0 / su, y0 / sv], [z1 / su, y0 / sv], [z1 / su, y1 / sv], [z0 / su, y1 / sv]].map(flipV), color, tile);
  // +z
  cb.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[x0 / su, y0 / sv], [x1 / su, y0 / sv], [x1 / su, y1 / sv], [x0 / su, y1 / sv]].map(flipV), color, tile);
  // -z
  cb.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[x1 / su, y0 / sv], [x0 / su, y0 / sv], [x0 / su, y1 / sv], [x1 / su, y1 / sv]].map(flipV), color, tile);
  // top
  const top = [color[0] * 0.95, color[1] * 0.95, color[2] * 0.95];
  cb.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[x0 / su, z1 / sv], [x1 / su, z1 / sv], [x1 / su, z0 / sv], [x0 / su, z0 / sv]], top, tile);
  if (!skipBottom) cb.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [[x0 / su, z0 / sv], [x1 / su, z0 / sv], [x1 / su, z1 / sv], [x0 / su, z1 / sv]], color, tile);
}

// canvas v goes down; flip so textures are upright on walls
function flipV(u) {
  return [u[0], -u[1]];
}

function rotY(x, z, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x * c + z * s, -x * s + z * c];
}

function addCylinder(cb, p, color, tile, scale, cone = false) {
  const seg = p.seg || 12;
  const r0 = p.r;
  const r1 = cone ? 0.0001 : p.r;
  const h = p.h;
  const lying = p.lying;
  const toW = (lx, ly, lz) => {
    if (lying) {
      const [rx, rz] = rotY(ly - h / 2, lz, p.yaw + Math.PI / 2);
      return [p.x + rx, p.y + lx + r0, p.z + rz];
    }
    return [p.x + lx, p.y + ly, p.z + lz];
  };
  const circ = 2 * Math.PI * r0;
  const ring = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    const slope = cone ? r0 / h : 0;
    const nl = Math.hypot(1, slope);
    const n = lying ? [0, 0, 0] : [cx / nl, slope / nl, cz / nl];
    const u = ((i / seg) * circ) / scale[0];
    const a0 = cb.vert(toW(cx * r0, 0, cz * r0), n, [u, 0], color, tile);
    const a1 = cb.vert(toW(cx * r1, h, cz * r1), n, [u, -h / scale[1]], color, tile);
    ring.push([a0, a1]);
  }
  for (let i = 0; i < seg; i++) {
    const [a0, a1] = ring[i];
    const [b0, b1] = ring[i + 1];
    cb.idx.push(a0, a1, b0, b0, a1, b1);
  }
  if (!cone) {
    // top cap
    const c = cb.vert(toW(0, h, 0), [0, 1, 0], [0, 0], color, tile);
    const caps = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      caps.push(cb.vert(toW(Math.cos(a) * r1, h, Math.sin(a) * r1), [0, 1, 0], [Math.cos(a) * r1 / scale[0], Math.sin(a) * r1 / scale[1]], color, tile));
    }
    for (let i = 0; i < seg; i++) cb.idx.push(c, caps[i + 1], caps[i]);
  }
  if (lying) {
    // recompute normals roughly for lying logs: use radial direction in world
    for (const [a0, a1] of ring) {
      for (const k of [a0, a1]) {
        const nx = cb.pos[k * 3] - p.x;
        const ny = cb.pos[k * 3 + 1] - (p.y + r0);
        const nz = cb.pos[k * 3 + 2] - p.z;
        const l = Math.hypot(nx, ny, nz) || 1;
        cb.nor[k * 3] = nx / l;
        cb.nor[k * 3 + 1] = ny / l;
        cb.nor[k * 3 + 2] = nz / l;
      }
    }
  }
}

function addPrism(cb, p, color, tile, scale) {
  // gable roof: base w (local x) by d (local z), ridge along local z unless axis === 'x'
  let w = p.w;
  let d = p.d;
  let yaw = p.yaw;
  if (p.axis === 'x') {
    w = p.d;
    d = p.w;
    yaw += Math.PI / 2;
  }
  const h = p.h;
  const P = (lx, ly, lz) => {
    const [rx, rz] = rotY(lx, lz, yaw);
    return [p.x + rx, p.y + ly, p.z + rz];
  };
  const a = P(-w / 2, 0, -d / 2);
  const b = P(w / 2, 0, -d / 2);
  const c = P(w / 2, 0, d / 2);
  const e = P(-w / 2, 0, d / 2);
  const r0 = P(0, h, -d / 2);
  const r1 = P(0, h, d / 2);
  const slope = Math.hypot(w / 2, h);
  const [n1x, n1z] = rotY(-h / slope, 0, yaw);
  const [n2x, n2z] = rotY(h / slope, 0, yaw);
  const s = scale;
  cb.quad(a, e, r1, r0, [n1x, (w / 2) / slope, n1z], [[0, 0], [d / s[0], 0], [d / s[0], -slope / s[1]], [0, -slope / s[1]]], color, tile);
  cb.quad(c, b, r0, r1, [n2x, (w / 2) / slope, n2z], [[0, 0], [d / s[0], 0], [d / s[0], -slope / s[1]], [0, -slope / s[1]]], color, tile);
  const [fnx, fnz] = rotY(0, -1, yaw);
  const [bnx, bnz] = rotY(0, 1, yaw);
  const gable = p.open ? color : [color[0] * 0.85, color[1] * 0.85, color[2] * 0.85];
  cb.tri(b, a, r0, [fnx, 0, fnz], [[0, 0], [w / s[0], 0], [w / 2 / s[0], -h / s[1]]], gable, tile);
  cb.tri(e, c, r1, [bnx, 0, bnz], [[0, 0], [w / s[0], 0], [w / 2 / s[0], -h / s[1]]], gable, tile);
}

function addSphere(cb, p, color, tile, scale, detail = 1, jitterSeed = 0, hemi = false) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const rand = mulberry32(jitterSeed || 1);
  const disp = new Map();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    if (!disp.has(key)) disp.set(key, jitterSeed ? 0.75 + rand() * 0.5 : 1);
    const k = disp.get(key);
    let yy = y * k;
    if (hemi && yy < 0) yy = 0;
    const sx = p.sx || p.r || p.s;
    const sy = p.sy || p.r || p.s * 0.7;
    const sz = p.sz || p.r || p.s;
    const vx = p.x + x * k * sx;
    const vy = p.y + yy * sy + (p.s && !p.r ? p.s * 0.35 : 0);
    const vz = p.z + z * k * sz;
    const l = Math.hypot(x, y, z) || 1;
    cb.vert([vx, vy, vz], [x / l, y / l, z / l], [(x + 1) * sx / scale[0], (y + 1) * sy / scale[1]], color, tile);
  }
  const base = cb.count - pos.count;
  for (let i = 0; i < pos.count; i += 3) cb.idx.push(base + i, base + i + 1, base + i + 2);
  geo.dispose();
}

// Distant buildings: one box per building in a single merged mesh. A per-chunk
// visibility texture hides the silhouette wherever the detailed chunk is loaded.
function silhouetteMaterial(visTex) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uVis = { value: visTex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 chunkUv;\nuniform sampler2D uVis;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nif (texture2D(uVis, chunkUv).r > 0.5) transformed = vec3(0.0, -99999.0, 0.0);');
  };
  mat.customProgramCacheKey = () => 'silhouette-v1';
  return mat;
}

export class StructureMesh {
  constructor(world, atlas, quality) {
    this.world = world;
    this.group = new THREE.Group();
    this.material = atlasMaterial(atlas);
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffd9a0, emissiveIntensity: 0 });
    this.animated = [];
    this.flags = [];
    this.quality = quality;
    this.detail = quality.detail ?? quality.draw ?? 600;
    this.smallDetail = Math.min(260, this.detail * 0.45);
    this.built = new Map(); // chunk -> {big, small}
    this.visData = new Uint8Array(NCH * NCH);
    this.visTex = new THREE.DataTexture(this.visData, NCH, NCH, THREE.RedFormat, THREE.UnsignedByteType);
    this.visTex.magFilter = THREE.NearestFilter;
    this.visTex.minFilter = THREE.NearestFilter;
    this.visTex.needsUpdate = true;
    this.index();
    this.buildLamps();
    this.buildSilhouettes();
    this.buildAnimated();
    this.buildFlags();
    this.lightPool = [];
    for (let i = 0; i < quality.lights; i++) {
      const L = new THREE.PointLight(0xffd9a0, 0, 26, 1.6);
      L.castShadow = false;
      this.group.add(L);
      this.lightPool.push(L);
    }
    this.lightTimer = 0;
    this.frame = 0;
  }

  chunkOf(x, z) {
    const cx = Math.min(NCH - 1, Math.max(0, Math.floor((x + WORLD_HALF) / CHUNK)));
    const cz = Math.min(NCH - 1, Math.max(0, Math.floor((z + WORLD_HALF) / CHUNK)));
    return cz * NCH + cx;
  }

  // Bucket renderable boxes and props per chunk (indices only).
  index() {
    this.boxIdx = new Map();
    this.propIdx = new Map();
    const push = (map, k, i) => {
      let a = map.get(k);
      if (!a) map.set(k, (a = []));
      a.push(i);
    };
    const boxes = this.world.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!(b.f & BF.RENDER) || b.m === MAT.LAMP) continue;
      push(this.boxIdx, this.chunkOf((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2), i);
    }
    const props = this.world.props;
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (p.t === 'bridge' || p.t === 'blades' || p.t === 'dish' || p.t === 'smoke' || p.t === 'maptable') continue;
      if (p.t === 'sphere' && p.m === MAT.LAMP) continue;
      push(this.propIdx, this.chunkOf(p.x, p.z), i);
    }
    this.chunkKeys = new Set([...this.boxIdx.keys(), ...this.propIdx.keys()]);
  }

  buildChunk(k, wantSmall) {
    const world = this.world;
    const big = new ChunkBuilder();
    const small = wantSmall ? new ChunkBuilder() : null;
    const rand = mulberry32(k * 7 + 5);
    for (const i of this.boxIdx.get(k) || []) {
      const b = world.boxes[i];
      if (b.dead) continue;
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      const vol = (b.x1 - b.x0) * (b.y1 - b.y0) * (b.z1 - b.z0);
      const isSmall = (b.f & BF.SMALL) || vol < 1.5;
      if (isSmall && !small) continue;
      const ground = world.terrain.heightAt(cx, cz);
      addBox(isSmall ? small : big, b, matColor(b.m, rand), matTile(b.m), matScale(b.m), b.y0 <= ground + 0.05);
    }
    for (const i of this.propIdx.get(k) || []) {
      const p = world.props[i];
      const color = matColor(p.m ?? MAT.CONCRETE, rand);
      const tile = matTile(p.m ?? MAT.CONCRETE);
      const scale = matScale(p.m ?? MAT.CONCRETE);
      const pick = (isSmall) => (isSmall ? small : big);
      switch (p.t) {
        case 'cyl': { const cb = pick(p.r < 1); if (cb) addCylinder(cb, p, color, tile, scale); break; }
        case 'cone': addCylinder(big, p, color, tile, scale, true); break;
        case 'prism': addPrism(big, p, color, tile, scale); break;
        case 'sphere': if (small) addSphere(small, p, color, tile, scale, 1); break;
        case 'dome': addSphere(big, { ...p, r: p.r }, color, tile, scale, 2, 0, true); break;
        case 'rock': { const cb = pick(p.s <= 1.8); if (cb) addSphere(cb, { x: p.x, y: p.y, z: p.z, s: p.s, sx: p.s * 1.1, sy: p.s * 0.8, sz: p.s }, color, tile, scale, 1, p.seed || 7); break; }
        case 'plane': {
          if (!small) break;
          const hw = p.w / 2;
          const hd = p.d / 2;
          small.quad([p.x - hw, p.y, p.z + hd], [p.x + hw, p.y, p.z + hd], [p.x + hw, p.y, p.z - hd], [p.x - hw, p.y, p.z - hd], [0, 1, 0], [[0, 1], [1, 1], [1, 0], [0, 0]].map(([u, v]) => [u * 0.999, v * 0.999]), color, tile);
          break;
        }
        case 'hedgehog': {
          if (!small) break;
          for (let j = 0; j < 3; j++) {
            const yaw = p.yaw + (j * Math.PI) / 3;
            const [dx, dz] = rotY(0.7, 0, yaw);
            addCylinder(small, { x: p.x - dx, y: p.y, z: p.z - dz, r: 0.08, h: 1.4, seg: 4, yaw, lying: true }, color, tile, scale);
          }
          break;
        }
        case 'mast': {
          const cb = p.h > 16 ? big : small;
          if (!cb) break;
          const w = p.w / 2;
          for (const [ox, oz] of [[-w, -w], [w, -w], [w, w], [-w, w]]) addCylinder(cb, { x: p.x + ox * 0.6, y: p.y, z: p.z + oz * 0.6, r: 0.07, h: p.h, seg: 4 }, color, tile, scale);
          for (let y = 2; y < p.h; y += 3) addBox(cb, { x0: p.x - w * 0.6, y0: p.y + y, z0: p.z - w * 0.6, x1: p.x + w * 0.6, y1: p.y + y + 0.08, z1: p.z + w * 0.6 }, color, tile, scale, false);
          break;
        }
        default:
          break;
      }
    }
    const out = { big: big.build(this.material), small: small ? small.build(this.material) : null };
    if (out.big) this.group.add(out.big);
    if (out.small) {
      out.small.castShadow = this.quality.shadows >= 2048;
      this.group.add(out.small);
    }
    return out;
  }

  dropChunk(k, e) {
    for (const m of [e.big, e.small]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.built.delete(k);
    this.visData[k] = 0;
    this.visDirty = true;
  }

  // Rebuild a chunk (used by destruction when building states change).
  refreshAt(x, z) {
    const k = this.chunkOf(x, z);
    const e = this.built.get(k);
    if (e) {
      const small = !!e.small;
      this.dropChunk(k, e);
      this.built.set(k, this.buildChunk(k, small));
      this.visData[k] = 1;
      this.visDirty = true;
    }
    this.silDirty = true;
  }

  buildLamps() {
    const lamps = new ChunkBuilder();
    for (const b of this.world.boxes) if ((b.f & BF.RENDER) && b.m === MAT.LAMP) addBox(lamps, b, [1, 1, 1], [0, 0], [1, 1], true);
    for (const p of this.world.props) if (p.t === 'sphere' && p.m === MAT.LAMP && !p.blink && !p.beacon) addSphere(lamps, p, [1, 1, 1], [0, 0], [1, 1], 1);
    const lm = lamps.build(this.lampMat);
    if (lm) {
      lm.castShadow = false;
      this.group.add(lm);
    }
  }

  buildSilhouettes() {
    const world = this.world;
    const byId = new Map();
    for (const bd of world.buildings) byId.set(bd.id, { bd, area: new Map() });
    for (const b of world.boxes) {
      if (!b.bid || !(b.f & BF.RENDER)) continue;
      const e = byId.get(b.bid);
      if (!e) continue;
      const a = (b.x1 - b.x0) * (b.z1 - b.z0) + (b.y1 - b.y0) * ((b.x1 - b.x0) + (b.z1 - b.z0));
      e.area.set(b.m, (e.area.get(b.m) || 0) + a);
    }
    const pos = [];
    const nor = [];
    const col = [];
    const cuv = [];
    const rand = mulberry32(99);
    for (const { bd, area } of byId.values()) {
      if (bd.dead || bd.y1 - bd.y0 < 2.5 || !isFinite(bd.x0)) continue;
      let bestM = MAT.CONCRETE;
      let bestA = -1;
      for (const [m, a] of area) {
        if (m === MAT.WINDOW && area.size > 1) continue;
        if (a > bestA) {
          bestA = a;
          bestM = m;
        }
      }
      const c = matColor(bestM, rand);
      const k = this.chunkOf((bd.x0 + bd.x1) / 2, (bd.z0 + bd.z1) / 2);
      const u = ((k % NCH) + 0.5) / NCH;
      const v = (Math.floor(k / NCH) + 0.5) / NCH;
      const inset = 0.15;
      const x0 = bd.x0 + inset;
      const x1 = bd.x1 - inset;
      const z0 = bd.z0 + inset;
      const z1 = bd.z1 - inset;
      const y0 = bd.y0;
      const y1 = bd.y1;
      const quad = (a, b, cc, d, n, shade) => {
        for (const p of [a, b, cc, a, cc, d]) {
          pos.push(p[0], p[1], p[2]);
          nor.push(n[0], n[1], n[2]);
          col.push(c[0] * shade, c[1] * shade, c[2] * shade);
          cuv.push(u, v);
        }
      };
      quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], 0.95);
      quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], 0.95);
      quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], 0.9);
      quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], 0.9);
      quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], 0.8);
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('chunkUv', new THREE.Float32BufferAttribute(cuv, 2));
    g.computeBoundingSphere();
    if (this.silhouettes) {
      this.group.remove(this.silhouettes);
      this.silhouettes.geometry.dispose();
    }
    this.silhouettes = new THREE.Mesh(g, this.silMat || (this.silMat = silhouetteMaterial(this.visTex)));
    this.silhouettes.castShadow = false;
    this.silhouettes.receiveShadow = true;
    this.silhouettes.matrixAutoUpdate = false;
    this.group.add(this.silhouettes);
  }

  buildAnimated() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.6, metalness: 0.4 });
    for (const p of this.world.props) {
      if (p.t === 'blades') {
        const g = new THREE.Group();
        for (let i = 0; i < 4; i++) {
          const bl = new THREE.Mesh(new THREE.BoxGeometry(0.9, p.r, 0.08), mat);
          bl.position.y = p.r / 2;
          const arm = new THREE.Group();
          arm.rotation.z = (i * Math.PI) / 2;
          arm.add(bl);
          g.add(arm);
        }
        g.position.set(p.x, p.y, p.z);
        g.rotation.y = p.yaw;
        this.group.add(g);
        this.animated.push({ obj: g, type: 'blades', x: p.x, z: p.z });
      } else if (p.t === 'dish') {
        const g = new THREE.Group();
        const dish = new THREE.Mesh(new THREE.SphereGeometry(p.r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3.2), mat);
        dish.rotation.x = -Math.PI / 2.4;
        dish.material.side = THREE.DoubleSide;
        g.add(dish);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.2), dark);
        stem.position.y = -0.4;
        g.add(stem);
        g.position.set(p.x, p.y, p.z);
        this.group.add(g);
        this.animated.push({ obj: g, type: 'dish', speed: p.spin || 0.5, x: p.x, z: p.z });
      } else if (p.t === 'sphere' && (p.blink || p.beacon)) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(p.r * 1.3, 8, 6), new THREE.MeshBasicMaterial({ color: p.beacon ? 0xfff0b0 : 0xff3020, transparent: true, fog: true }));
        m.position.set(p.x, p.y, p.z);
        this.group.add(m);
        this.animated.push({ obj: m, type: p.beacon ? 'beacon' : 'blink', phase: Math.random() * 6, x: p.x, z: p.z });
      } else if (p.t === 'smoke') {
        this.animated.push({ type: 'chimney', x: p.x, y: p.y, z: p.z, acc: Math.random() });
      }
    }
  }

  buildFlags() {
    const poleCloth = new THREE.PlaneGeometry(1.8, 1.1, 8, 4);
    poleCloth.translate(0.9, -0.55, 0);
    for (const f of this.world.flags) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xdddddd, side: THREE.DoubleSide, roughness: 0.9 });
      const geo = poleCloth.clone();
      const m = new THREE.Mesh(geo, mat);
      m.position.set(f.x, f.y, f.z);
      m.castShadow = false;
      m.visible = false;
      this.group.add(m);
      this.flags.push({ key: f.key, mesh: m, base: geo.attributes.position.array.slice(), owner: -1, x: f.x, z: f.z });
    }
  }

  // war: client war view; used to colour flags by owner
  updateFlags(war, time, windDir = 0.6, camera) {
    const owners = new Map();
    const tOwner = new Map();
    if (war) {
      for (const t of war.territories) {
        tOwner.set(t.id, t.owner);
        for (const s of t.sectors) owners.set(`${t.id}:${s.id}`, s.owner);
      }
    }
    const cx = camera ? camera.position.x : 0;
    const cz = camera ? camera.position.z : 0;
    for (const fl of this.flags) {
      const near = !camera || Math.abs(fl.x - cx) + Math.abs(fl.z - cz) < 700;
      fl.mesh.visible = near;
      if (!near) continue;
      let owner;
      if (fl.key === 'country') owner = this.areaOwner(fl.x, fl.z, tOwner);
      else if (fl.key.startsWith('border:')) {
        const parts = fl.key.split(':');
        owner = Number(fl.key.endsWith(':a') ? parts[1] : parts[2]);
      } else owner = owners.get(fl.key) ?? 0;
      if (owner !== fl.owner) {
        fl.owner = owner;
        fl.mesh.material.color.set(FLAG_COLORS[owner] ?? 0xe8e8e8);
      }
      const pos = fl.mesh.geometry.attributes.position;
      const a = pos.array;
      const b = fl.base;
      for (let i = 0; i < pos.count; i++) {
        const x = b[i * 3];
        a[i * 3 + 2] = Math.sin(x * 2.5 - time * 5 + fl.mesh.position.x) * 0.12 * x;
      }
      pos.needsUpdate = true;
      fl.mesh.rotation.y = windDir;
    }
  }

  areaOwner(x, z, tOwner) {
    for (const hq of this.world.hqs) {
      const [hx, hz] = this.world.bases[hq.faction].rect;
      if (Math.abs(x - hq.x) < hx + 10 && Math.abs(z - hq.z) < hz + 10) return hq.faction;
    }
    const t = this.world.regions.territoryAt(x, z);
    return t ? tOwner.get(t.id) ?? t.country : 0;
  }

  update(camera, dt, time, daylight, effects) {
    this.frame++;
    const cx = camera.position.x;
    const cz = camera.position.z;
    // stream detailed chunks in and out
    const R = this.detail;
    const ci = Math.floor((cx + WORLD_HALF) / CHUNK);
    const cj = Math.floor((cz + WORLD_HALF) / CHUNK);
    const rr = Math.ceil(R / CHUNK) + 1;
    const todo = [];
    for (let j = cj - rr; j <= cj + rr; j++) {
      for (let i = ci - rr; i <= ci + rr; i++) {
        if (i < 0 || j < 0 || i >= NCH || j >= NCH) continue;
        const k = j * NCH + i;
        if (!this.chunkKeys.has(k)) continue;
        const ccx = (i + 0.5) * CHUNK - WORLD_HALF;
        const ccz = (j + 0.5) * CHUNK - WORLD_HALF;
        const d = Math.hypot(ccx - cx, ccz - cz);
        const e = this.built.get(k);
        const wantSmall = d < this.smallDetail + CHUNK * 0.7;
        if (d < R + CHUNK * 0.7) {
          if (!e || (wantSmall && !e.small)) todo.push({ k, d, wantSmall, e });
        }
      }
    }
    if (todo.length) {
      todo.sort((a, b) => a.d - b.d);
      const t0 = performance.now();
      for (const t of todo) {
        if (t.e) this.dropChunk(t.k, t.e);
        this.built.set(t.k, this.buildChunk(t.k, t.wantSmall));
        this.visData[t.k] = 1;
        this.visDirty = true;
        if (performance.now() - t0 > 5) break;
      }
    }
    if (this.frame % 30 === 0) {
      for (const [k, e] of this.built) {
        const i = k % NCH;
        const j = Math.floor(k / NCH);
        const d = Math.hypot((i + 0.5) * CHUNK - WORLD_HALF - cx, (j + 0.5) * CHUNK - WORLD_HALF - cz);
        if (d > R + CHUNK * 2.2) this.dropChunk(k, e);
        else if (e.small && d > this.smallDetail + CHUNK * 1.6) {
          this.group.remove(e.small);
          e.small.geometry.dispose();
          e.small = null;
        }
      }
    }
    if (this.visDirty) {
      this.visDirty = false;
      this.visTex.needsUpdate = true;
    }
    if (this.silDirty) {
      this.silDirty = false;
      this.buildSilhouettes();
    }
    for (const a of this.animated) {
      if (Math.abs(a.x - cx) + Math.abs(a.z - cz) > 900) {
        if (a.obj) a.obj.visible = false;
        continue;
      }
      if (a.obj) a.obj.visible = true;
      if (a.type === 'blades') a.obj.rotation.z += dt * 0.6;
      else if (a.type === 'dish') a.obj.rotation.y += dt * a.speed;
      else if (a.type === 'blink') a.obj.material.opacity = Math.sin(time * 3 + a.phase) > 0.2 ? 1 : 0.15;
      else if (a.type === 'beacon') a.obj.material.opacity = 0.4 + 0.6 * (1 - daylight) * (0.5 + 0.5 * Math.sin(time * 1.5));
      else if (a.type === 'chimney' && effects) {
        a.acc += dt;
        if (a.acc > 0.5 && Math.hypot(a.x - cx, a.z - cz) < 700) {
          a.acc = 0;
          effects.chimneySmoke(a.x, a.y, a.z);
        }
      }
    }
    // lamps glow at night; nearest lamps get real point lights
    const night = 1 - daylight;
    this.lampMat.emissiveIntensity = night * 2.2;
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.5;
      if (night > 0.2 && this.lightPool.length) {
        const near = [];
        for (const L of this.world.lights) {
          const d = (L.x - cx) * (L.x - cx) + (L.z - cz) * (L.z - cz);
          if (d < 160 * 160) near.push({ L, d });
        }
        near.sort((p, q) => p.d - q.d);
        this.lightPool.forEach((pl, i) => {
          const n = near[i];
          if (n) {
            pl.position.set(n.L.x, n.L.y, n.L.z);
            pl.color.setHex(n.L.color || 0xffd9a0);
            pl.intensity = night * 18;
            pl.distance = (n.L.r || 14) * 1.6;
          } else pl.intensity = 0;
        });
      } else for (const pl of this.lightPool) pl.intensity = 0;
    }
  }
}

const FLAG_COLORS = { 0: 0xe8e8e8, 1: 0x3a6bbd, 2: 0xb3302a, 3: 0xd69a2e };
