// Terrain, water and road meshes built from the shared world data.
import * as THREE from 'three';
import { WORLD_HALF, SEA_LEVEL } from '../../shared/constants.js';
import { TMAT_COLORS } from '../../shared/world/terrain.js';
import { MAT_INFO } from '../../shared/world/materials.js';
import { hash2 } from '../../shared/math.js';

const CHUNKS = 8;

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function buildTerrain(world, detailTex, step = 1) {
  const t = world.terrain;
  const n = t.n;
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detailTex, roughness: 0.96, metalness: 0 });
  // slope-aware darkening + distance fade of the detail texture
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vDist;');
    sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\nvDist = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vDist;');
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 texel = texture2D(map, vMapUv);
        vec4 texel2 = texture2D(map, vMapUv * 0.13);
        float fade = smoothstep(60.0, 260.0, vDist);
        vec3 det = mix(texel.rgb * 0.7 + texel2.rgb * 0.3, texel2.rgb, fade);
        diffuseColor.rgb *= mix(det * 1.35, vec3(0.92), fade * 0.6);
      #endif`,
    );
  };
  const cellsPerChunk = (n - 1) / CHUNKS;
  const colors = TMAT_COLORS.map((c) => c.map(srgbToLinear));
  for (let cz = 0; cz < CHUNKS; cz++) {
    for (let cx = 0; cx < CHUNKS; cx++) {
      const i0 = cx * cellsPerChunk;
      const j0 = cz * cellsPerChunk;
      const cnt = Math.floor(cellsPerChunk / step);
      const vn = cnt + 1;
      const pos = new Float32Array(vn * vn * 3);
      const col = new Float32Array(vn * vn * 3);
      const uv = new Float32Array(vn * vn * 2);
      let p = 0;
      for (let j = 0; j < vn; j++) {
        for (let i = 0; i < vn; i++) {
          const gi = Math.min(n - 1, i0 + i * step);
          const gj = Math.min(n - 1, j0 + j * step);
          const k = gj * n + gi;
          const x = -WORLD_HALF + gi * t.res;
          const z = -WORLD_HALF + gj * t.res;
          const y = t.heights[k];
          pos[p * 3] = x;
          pos[p * 3 + 1] = y;
          pos[p * 3 + 2] = z;
          const m = t.materials[k];
          const base = colors[m] || colors[0];
          const v = 0.88 + hash2(gi, gj, 3) * 0.2;
          // underwater terrain darkens with depth
          const wet = y < SEA_LEVEL ? Math.max(0.35, 1 + y * 0.08) : 1;
          col[p * 3] = base[0] * v * wet;
          col[p * 3 + 1] = base[1] * v * wet;
          col[p * 3 + 2] = base[2] * v * wet * (y < SEA_LEVEL ? 1.05 : 1);
          uv[p * 2] = x / 7;
          uv[p * 2 + 1] = z / 7;
          p++;
        }
      }
      const idx = new Uint32Array(cnt * cnt * 6);
      let q = 0;
      for (let j = 0; j < cnt; j++) {
        for (let i = 0; i < cnt; i++) {
          const a = j * vn + i;
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
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }
  return group;
}

// ---------------------------------------------------------------- water
const waterVert = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const waterFrag = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform vec3 uDeep;
uniform float uRain;
varying vec3 vWorld;
vec2 wave(vec2 p, float t) {
  float a = sin(p.x * 0.11 + t * 0.9) * 0.6 + sin(p.y * 0.13 - t * 0.7) * 0.6;
  float b = sin((p.x + p.y) * 0.31 + t * 1.7) * 0.25 + sin((p.x - p.y) * 0.53 - t * 2.3) * 0.12;
  float c = sin(p.x * 1.7 + t * 3.1) * 0.05 + sin(p.y * 2.3 - t * 2.9) * 0.05;
  return vec2(
    cos(p.x * 0.11 + t * 0.9) * 0.066 + cos((p.x + p.y) * 0.31 + t * 1.7) * 0.078 + cos((p.x - p.y) * 0.53 - t * 2.3) * 0.064 + cos(p.x * 1.7 + t * 3.1) * 0.085,
    cos(p.y * 0.13 - t * 0.7) * 0.078 + cos((p.x + p.y) * 0.31 + t * 1.7) * 0.078 - cos((p.x - p.y) * 0.53 - t * 2.3) * 0.064 + cos(p.y * 2.3 - t * 2.9) * 0.115
  ) * (1.0 + uRain * 0.8) + vec2(a + b + c) * 0.0;
}
void main() {
  vec2 g = wave(vWorld.xz, uTime);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  vec3 col = mix(uDeep, uSky * 0.9, 0.15 + fres * 0.75);
  vec3 r = reflect(-uSunDir, n);
  float spec = pow(max(dot(r, v), 0.0), 180.0);
  col += uSunColor * spec * 2.5;
  gl_FragColor = vec4(col, mix(0.78, 0.96, fres));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function buildWater() {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSky: { value: new THREE.Color(0.5, 0.6, 0.7) },
      uDeep: { value: new THREE.Color(0.02, 0.07, 0.09) },
      uRain: { value: 0 },
    },
  ]);
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: waterVert, fragmentShader: waterFrag, transparent: true, fog: true, depthWrite: false });
  const geo = new THREE.PlaneGeometry(20000, 20000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = SEA_LEVEL;
  mesh.renderOrder = 2;
  return mesh;
}

// ---------------------------------------------------------------- roads & bridges
function roadTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6a6a6a';
  ctx.fillRect(0, 0, S, S);
  const img = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 90 + Math.random() * 60;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(230,220,180,0.85)';
  ctx.fillRect(S / 2 - 3, 0, 6, S * 0.5);
  ctx.fillStyle = 'rgba(235,235,235,0.7)';
  ctx.fillRect(10, 0, 4, S);
  ctx.fillRect(S - 14, 0, 4, S);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, 6, S);
  ctx.fillRect(S - 6, 0, 6, S);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function buildRoads(world) {
  const group = new THREE.Group();
  const tex = roadTexture();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const pos = [];
  const uv = [];
  const idx = [];
  const t = world.terrain;
  for (const r of world.roads) {
    const s = r.samples;
    const half = r.width / 2;
    let along = 0;
    const base = pos.length / 3;
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
      for (const side of [-1, 1]) {
        const x = s[i].x + nx * half * side;
        const z = s[i].z + nz * half * side;
        const y = s[i].bridge ? s[i].h + 0.02 : Math.max(t.heightAt(x, z), s[i].h) + 0.06;
        pos.push(x, y, z);
        uv.push(side < 0 ? 0 : 1, along / 12);
      }
      if (i > 0) {
        const k = base + i * 2;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  group.add(mesh);
  // bridges: deck underside, railings, pillars
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
      for (const side of [-1, 1]) addBox(mx + nx * side * (p.w / 2), p.deck + 0.5, mz + nz * side * (p.w / 2), 0.35, 1.0, len, yaw);
      if (i % 4 === 0) {
        const gy = t.heightAt(mx, mz);
        const h = p.deck - 0.7 - gy + 2;
        if (h > 1) addBox(mx, gy - 2 + h / 2, mz, p.w * 0.6, h, 1.4, yaw);
      }
    }
  }
  if (bpos.length) {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3));
    bg.setIndex(bidx);
    bg.computeVertexNormals();
    const bm = new THREE.Mesh(bg, concrete);
    bm.castShadow = true;
    bm.receiveShadow = true;
    group.add(bm);
  }
  return group;
}

export { srgbToLinear };
