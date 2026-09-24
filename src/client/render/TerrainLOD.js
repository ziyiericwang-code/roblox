// Quadtree level-of-detail terrain for the 6 km continent.
// Every node is a 48x48 cell grid regardless of its size, so resolution halves
// with each level: 4 m cells next to the camera, 128 m cells on the horizon.
// Skirts (short vertical strips around each node) hide cracks between levels.
// Nodes are built lazily with a per-frame budget and cached (LRU).
import * as THREE from 'three';
import { WORLD_HALF, SEA_LEVEL } from '../../shared/constants.js';
import { TMAT_COLORS } from '../../shared/world/terrain.js';
import { hash2 } from '../../shared/math.js';

const CELLS = 48;
const MAX_LEVEL = 5; // leaves: 6144 / 32 = 192 m, stride 1 (4 m cells)
const MAX_CACHE = 420;

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function terrainMaterial(detailTex) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detailTex, roughness: 0.96, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vDist;');
    sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\nvDist = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vDist;');
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 texel = texture2D(map, vMapUv);
        vec4 texel2 = texture2D(map, vMapUv * 0.13);
        vec4 texel3 = texture2D(map, vMapUv * 0.011);
        float fade = smoothstep(60.0, 260.0, vDist);
        float fade2 = smoothstep(500.0, 1800.0, vDist);
        vec3 det = mix(texel.rgb * 0.7 + texel2.rgb * 0.3, texel2.rgb * 0.6 + texel3.rgb * 0.4, fade);
        det = mix(det, vec3(0.74), fade2);
        diffuseColor.rgb *= mix(det * 1.35, vec3(0.95), fade * 0.55);
      #endif`,
    );
  };
  return mat;
}

export class TerrainLOD {
  constructor(world, detailTex, quality) {
    this.world = world;
    this.t = world.terrain;
    this.group = new THREE.Group();
    this.material = terrainMaterial(detailTex);
    this.colors = TMAT_COLORS.map((c) => c.map(srgbToLinear));
    this.cache = new Map(); // key -> {mesh, used}
    this.queue = [];
    this.frame = 0;
    this.split = quality.lodSplit ?? 1.8;
    this.visible = new Set();
    // pre-build the coarse levels so there is never a hole in the world
    for (let level = 0; level <= 2; level++) {
      const n = 1 << level;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) this.build(level, i, j);
    }
  }

  key(level, i, j) {
    return (level << 20) | (i << 10) | j;
  }

  nodeSize(level) {
    return (WORLD_HALF * 2) / (1 << level);
  }

  build(level, i, j) {
    const k = this.key(level, i, j);
    const hit = this.cache.get(k);
    if (hit) return hit;
    const t = this.t;
    const n = t.n;
    const size = this.nodeSize(level);
    const stride = Math.round(size / CELLS / t.res);
    const i0 = Math.round((i * size) / t.res);
    const j0 = Math.round((j * size) / t.res);
    const vn = CELLS + 1;
    const total = vn * vn + 4 * vn;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const H = t.heights;
    const colors = this.colors;
    let minY = Infinity;
    let maxY = -Infinity;
    const at = (gi, gj) => H[Math.min(n - 1, Math.max(0, gj)) * n + Math.min(n - 1, Math.max(0, gi))];
    const vert = (p, gi, gj, yOff) => {
      const x = -WORLD_HALF + gi * t.res;
      const z = -WORLD_HALF + gj * t.res;
      const y = at(gi, gj);
      pos[p * 3] = x;
      pos[p * 3 + 1] = y + yOff;
      pos[p * 3 + 2] = z;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      // normal from central differences at this node's spacing
      const dx = at(gi + stride, gj) - at(gi - stride, gj);
      const dz = at(gi, gj + stride) - at(gi, gj - stride);
      const s2 = 2 * stride * t.res;
      const nl = Math.hypot(dx, s2, dz);
      nor[p * 3] = -dx / nl;
      nor[p * 3 + 1] = s2 / nl;
      nor[p * 3 + 2] = -dz / nl;
      const m = t.materials[Math.min(n - 1, gj) * n + Math.min(n - 1, gi)];
      const base = colors[m] || colors[0];
      const v = 0.88 + hash2(gi, gj, 3) * 0.2;
      const wet = y < SEA_LEVEL ? Math.max(0.35, 1 + y * 0.08) : 1;
      col[p * 3] = base[0] * v * wet;
      col[p * 3 + 1] = base[1] * v * wet;
      col[p * 3 + 2] = base[2] * v * wet * (y < SEA_LEVEL ? 1.05 : 1);
      uv[p * 2] = x / 7;
      uv[p * 2 + 1] = z / 7;
    };
    let p = 0;
    for (let jj = 0; jj < vn; jj++) for (let ii = 0; ii < vn; ii++) vert(p++, i0 + ii * stride, j0 + jj * stride, 0);
    // skirts: N, S, W, E edges dropped down
    const drop = -(2 + stride * t.res * 0.9);
    const skirtStart = p;
    for (let ii = 0; ii < vn; ii++) vert(p++, i0 + ii * stride, j0, drop);
    for (let ii = 0; ii < vn; ii++) vert(p++, i0 + ii * stride, j0 + CELLS * stride, drop);
    for (let jj = 0; jj < vn; jj++) vert(p++, i0, j0 + jj * stride, drop);
    for (let jj = 0; jj < vn; jj++) vert(p++, i0 + CELLS * stride, j0 + jj * stride, drop);
    const idx = new Uint16Array(CELLS * CELLS * 6 + 4 * CELLS * 6);
    let q = 0;
    for (let jj = 0; jj < CELLS; jj++) {
      for (let ii = 0; ii < CELLS; ii++) {
        const a = jj * vn + ii;
        const b = a + 1;
        const c = a + vn;
        const d = c + 1;
        // same triangle split as Terrain.heightAt(): (a,b,c) and (b,d,c)
        idx[q++] = a;
        idx[q++] = c;
        idx[q++] = b;
        idx[q++] = b;
        idx[q++] = c;
        idx[q++] = d;
      }
    }
    const edge = (topIdx, skirtIdx, flip) => {
      for (let e = 0; e < CELLS; e++) {
        const a = topIdx(e);
        const b = topIdx(e + 1);
        const c = skirtIdx(e);
        const d = skirtIdx(e + 1);
        if (flip) {
          idx[q++] = a;
          idx[q++] = b;
          idx[q++] = c;
          idx[q++] = b;
          idx[q++] = d;
          idx[q++] = c;
        } else {
          idx[q++] = a;
          idx[q++] = c;
          idx[q++] = b;
          idx[q++] = b;
          idx[q++] = c;
          idx[q++] = d;
        }
      }
    };
    // winding chosen so every skirt faces outwards
    edge((e) => e, (e) => skirtStart + e, true); // north
    edge((e) => CELLS * vn + e, (e) => skirtStart + vn + e, false); // south
    edge((e) => e * vn, (e) => skirtStart + 2 * vn + e, false); // west
    edge((e) => e * vn + CELLS, (e) => skirtStart + 3 * vn + e, true); // east
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const cx = -WORLD_HALF + (i + 0.5) * size;
    const cz = -WORLD_HALF + (j + 0.5) * size;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, (minY + maxY) / 2, cz), Math.hypot(size * 0.71, (maxY - minY) / 2 + 4));
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = level >= MAX_LEVEL - 1;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    const entry = { mesh, used: 0, level, minY, maxY, cx, cz, size };
    this.cache.set(k, entry);
    this.group.add(mesh);
    return entry;
  }

  // Choose the node set for this camera; queue missing nodes.
  update(camera, budgetMs = 6) {
    this.frame++;
    const cam = camera.position;
    const want = [];
    const missing = [];
    const visit = (level, i, j) => {
      const size = this.nodeSize(level);
      const x0 = -WORLD_HALF + i * size;
      const z0 = -WORLD_HALF + j * size;
      const dx = Math.max(x0 - cam.x, 0, cam.x - (x0 + size));
      const dz = Math.max(z0 - cam.z, 0, cam.z - (z0 + size));
      const entry = this.cache.get(this.key(level, i, j));
      const dy = entry ? Math.max(0, cam.y - entry.maxY, entry.minY - cam.y) : 0;
      const d = Math.sqrt(dx * dx + dz * dz + dy * dy);
      if (level < MAX_LEVEL && d < size * this.split) {
        const kids = [];
        let ready = true;
        for (let cj = 0; cj < 2; cj++) {
          for (let ci = 0; ci < 2; ci++) {
            const ck = this.key(level + 1, i * 2 + ci, j * 2 + cj);
            if (!this.cache.has(ck)) {
              ready = false;
              missing.push({ level: level + 1, i: i * 2 + ci, j: j * 2 + cj, d });
            }
            kids.push([level + 1, i * 2 + ci, j * 2 + cj]);
          }
        }
        if (ready) {
          for (const [l, a, b] of kids) visit(l, a, b);
          return;
        }
      }
      want.push(entry || this.build(level, i, j));
    };
    visit(0, 0, 0);
    const nextVisible = new Set();
    for (const e of want) {
      e.mesh.visible = true;
      e.used = this.frame;
      nextVisible.add(e);
    }
    for (const e of this.visible) if (!nextVisible.has(e)) e.mesh.visible = false;
    this.visible = nextVisible;
    // build missing nodes, closest first, within the time budget
    if (missing.length) {
      missing.sort((a, b) => a.d - b.d);
      const t0 = performance.now();
      for (const m of missing) {
        this.build(m.level, m.i, m.j);
        if (performance.now() - t0 > budgetMs) break;
      }
    }
    // evict least recently used nodes
    if (this.cache.size > MAX_CACHE) {
      const entries = [...this.cache.entries()].filter(([, e]) => e.level > 2 && !this.visible.has(e)).sort((a, b) => a[1].used - b[1].used);
      for (let x = 0; x < entries.length && this.cache.size > MAX_CACHE * 0.85; x++) {
        const [k, e] = entries[x];
        this.group.remove(e.mesh);
        e.mesh.geometry.dispose();
        this.cache.delete(k);
      }
    }
    return want.length;
  }
}
