// Roads, railways and bridges. Roads and rails are split into 256 m chunks
// that are only drawn near the camera (far away the terrain colour shows them);
// bridges are few and always drawn.
import * as THREE from 'three';
import { WORLD_HALF } from '../../shared/constants.js';
import { MAT_INFO } from '../../shared/world/materials.js';

const CHUNK = 256;
const NCH = Math.ceil((WORLD_HALF * 2) / CHUNK);

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function canvasTex(draw, w = 256, h = 256) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function noiseFill(ctx, w, h, lo, span) {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = lo + Math.random() * span;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

function roadTexture(kind) {
  return canvasTex((ctx, S) => {
    noiseFill(ctx, S, S, kind === 'street' ? 80 : 90, 55);
    if (kind === 'highway') {
      ctx.fillStyle = 'rgba(235,235,235,0.75)';
      ctx.fillRect(S / 2 - 3, 0, 6, S * 0.45);
      ctx.fillRect(12, 0, 5, S);
      ctx.fillRect(S - 17, 0, 5, S);
    } else if (kind === 'main') {
      ctx.fillStyle = 'rgba(230,220,180,0.8)';
      ctx.fillRect(S / 2 - 3, 0, 6, S * 0.5);
      ctx.fillStyle = 'rgba(235,235,235,0.6)';
      ctx.fillRect(10, 0, 4, S);
      ctx.fillRect(S - 14, 0, 4, S);
    } else {
      ctx.fillStyle = 'rgba(220,220,220,0.35)';
      ctx.fillRect(S / 2 - 2, 0, 4, S * 0.3);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, 0, 6, S);
    ctx.fillRect(S - 6, 0, 6, S);
  });
}

function ballastTexture() {
  return canvasTex((ctx, S) => {
    noiseFill(ctx, S, S, 70, 60);
    ctx.fillStyle = 'rgba(70,52,38,0.95)';
    for (let y = 0; y < S; y += 32) ctx.fillRect(S * 0.12, y + 4, S * 0.76, 14);
  });
}

class Strip {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.nor = [];
  }
  quad(a, b, c, d, ua, ub, v0, v1) {
    // a,b at v0 (left,right), c,d at v1 (left,right)
    this.pos.push(...a, ...b, ...d, ...a, ...d, ...c);
    this.uv.push(ua, v0, ub, v0, ub, v1, ua, v0, ub, v1, ua, v1);
    for (let i = 0; i < 6; i++) this.nor.push(0, 1, 0);
  }
  mesh(mat) {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    return m;
  }
}

export class RoadMesh {
  constructor(world, quality) {
    this.world = world;
    this.group = new THREE.Group();
    this.chunks = new Map(); // k -> {meshes:[], cx, cz}
    this.radius = quality.roadDraw ?? 750;
    const po = { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 };
    this.mats = {
      highway: new THREE.MeshStandardMaterial({ map: roadTexture('highway'), roughness: 0.9, ...po }),
      main: new THREE.MeshStandardMaterial({ map: roadTexture('main'), roughness: 0.9, ...po }),
      street: new THREE.MeshStandardMaterial({ map: roadTexture('street'), roughness: 0.92, ...po }),
      local: new THREE.MeshStandardMaterial({ map: roadTexture('local'), roughness: 0.92, ...po }),
      ballast: new THREE.MeshStandardMaterial({ map: ballastTexture(), roughness: 0.97, ...po }),
      rail: new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.35, metalness: 0.8 }),
    };
    const strips = new Map();
    const get = (k, kind) => {
      let m = strips.get(k);
      if (!m) strips.set(k, (m = {}));
      if (!m[kind]) m[kind] = new Strip();
      return m[kind];
    };
    const t = world.terrain;
    const chunkOf = (x, z) => Math.min(NCH - 1, Math.max(0, Math.floor((z + WORLD_HALF) / CHUNK))) * NCH + Math.min(NCH - 1, Math.max(0, Math.floor((x + WORLD_HALF) / CHUNK)));
    const addRoute = (r, kind, half, lift, uScale = 12) => {
      const s = r.samples;
      let along = 0;
      let prev = null;
      for (let i = 0; i < s.length; i++) {
        const a = s[Math.max(0, i - 1)];
        const b = s[Math.min(s.length - 1, i + 1)];
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        const nx = -dz;
        const nz = dx;
        if (i > 0) along += Math.hypot(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z);
        const edge = (side) => {
          const x = s[i].x + nx * half * side;
          const z = s[i].z + nz * half * side;
          const y = s[i].bridge ? s[i].h + 0.02 : Math.max(t.heightAt(x, z), s[i].h) + lift;
          return [x, y, z];
        };
        const cur = { L: edge(-1), R: edge(1), v: along / uScale };
        if (prev) {
          const k = chunkOf(s[i].x, s[i].z);
          get(k, kind).quad(prev.L, prev.R, cur.L, cur.R, 0, 1, prev.v, cur.v);
        }
        prev = cur;
      }
    };
    for (const r of world.roads) addRoute(r, r.kind === 'highway' ? 'highway' : r.kind === 'street' ? 'street' : r.kind === 'main' ? 'main' : 'local', r.width / 2, 0.07);
    for (const r of world.rails || []) {
      addRoute(r, 'ballast', 2.4, 0.12, 8);
      // two rails, 1.43 m gauge, raised above the ballast
      for (const off of [-0.72, 0.72]) {
        const s = r.samples;
        let prev = null;
        for (let i = 0; i < s.length; i++) {
          const a = s[Math.max(0, i - 1)];
          const b = s[Math.min(s.length - 1, i + 1)];
          let dx = b.x - a.x;
          let dz = b.z - a.z;
          const l = Math.hypot(dx, dz) || 1;
          dx /= l;
          dz /= l;
          const nx = -dz;
          const nz = dx;
          const cx = s[i].x + nx * off;
          const cz = s[i].z + nz * off;
          const y = (s[i].bridge ? s[i].h : Math.max(t.heightAt(cx, cz), s[i].h)) + 0.3;
          const cur = { L: [cx - nx * 0.05, y, cz - nz * 0.05], R: [cx + nx * 0.05, y, cz + nz * 0.05] };
          if (prev) get(chunkOf(cx, cz), 'rail').quad(prev.L, prev.R, cur.L, cur.R, 0, 1, 0, 1);
          prev = cur;
        }
      }
    }
    for (const [k, kinds] of strips) {
      const cx = (k % NCH) * CHUNK - WORLD_HALF + CHUNK / 2;
      const cz = Math.floor(k / NCH) * CHUNK - WORLD_HALF + CHUNK / 2;
      const meshes = [];
      for (const kind of Object.keys(kinds)) {
        const m = kinds[kind].mesh(this.mats[kind]);
        if (m) {
          m.visible = false;
          this.group.add(m);
          meshes.push(m);
        }
      }
      this.chunks.set(k, { meshes, cx, cz });
    }
    this.group.add(buildBridges(world));
  }

  update(camera) {
    const x = camera.position.x;
    const z = camera.position.z;
    const r = this.radius + CHUNK * 0.71;
    for (const c of this.chunks.values()) {
      const v = Math.hypot(c.cx - x, c.cz - z) < r;
      for (const m of c.meshes) m.visible = v;
    }
  }
}

function buildBridges(world) {
  const t = world.terrain;
  const concrete = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...MAT_INFO[0].color.map(srgbToLinear)), roughness: 0.9 });
  const bpos = [];
  const bidx = [];
  const addBox = (cx, cy, cz, sx, sy, sz, yaw) => {
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const corners = [];
    for (const [ox, oy, oz] of [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]) {
      const lx = (ox * sx) / 2;
      const lz = (oz * sz) / 2;
      corners.push([cx + lx * c + lz * sn, cy + (oy * sy) / 2, cz - lx * sn + lz * c]);
    }
    const faces = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
    for (const f of faces) {
      const b0 = bpos.length / 3;
      for (const vi of f) bpos.push(...corners[vi]);
      bidx.push(b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2);
    }
  };
  for (const p of world.props) {
    if (p.t !== 'bridge') continue;
    const pts = p.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const yaw = Math.atan2(bx - ax, bz - az);
      const len = Math.hypot(bx - ax, bz - az) + 0.3;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      addBox(mx, p.deck - 0.35, mz, p.w * 0.98, 0.7, len, yaw);
      const nx = Math.cos(yaw);
      const nz = -Math.sin(yaw);
      if (!p.rail) for (const side of [-1, 1]) addBox(mx + nx * side * (p.w / 2), p.deck + 0.5, mz + nz * side * (p.w / 2), 0.35, 1.0, len, yaw);
      else if (i % 3 === 0) for (const side of [-1, 1]) addBox(mx + nx * side * (p.w / 2), p.deck + 2.2, mz + nz * side * (p.w / 2), 0.3, 4.4, 0.3, yaw);
      if (i % 4 === 0) {
        const gy = t.heightAt(mx, mz);
        const h = p.deck - 0.7 - gy + 3;
        if (h > 1) addBox(mx, gy - 3 + h / 2, mz, p.w * 0.6, h, 1.6, yaw);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3));
  g.setIndex(bidx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, concrete);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
