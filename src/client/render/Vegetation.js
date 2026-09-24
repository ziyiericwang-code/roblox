// Streamed, instanced vegetation for the big world.
//  near: full trees (trunk + crown, wind sway) within `treesNear` metres
//  far:  low-poly stand-ins out to `treesFar` metres, so forests read from afar
// Trees are indexed in 128 m chunks with precomputed matrices; the instance
// buffers are refilled only when the camera has moved far enough.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash2 } from '../../shared/math.js';
import { WORLD_HALF } from '../../shared/constants.js';

const CHUNK = 128;
const NCH = Math.ceil((WORLD_HALF * 2) / CHUNK);

function windMaterial(color, uniforms, sway, map) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, map: map || null });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uWind = uniforms.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float h = max(0.0, position.y);
          float w = sin(uTime * 1.3 + ip.x * 0.15 + ip.z * 0.11) * 0.5 + sin(uTime * 2.9 + ip.x * 0.4) * 0.2;
          transformed.x += w * h * ${sway.toFixed(3)} * (0.35 + uWind);
          transformed.z += w * h * ${(sway * 0.6).toFixed(3)} * (0.35 + uWind);
        #endif`,
      );
  };
  return mat;
}

function cone(r, h, y, seg = 7) {
  const g = new THREE.ConeGeometry(r, h, seg, 1);
  g.translate(0, y + h / 2, 0);
  return g;
}

function blob(r, x, y, z, detail = 0) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  g.scale(1, 0.8, 1);
  g.translate(x, y, z);
  return g;
}

function trunk(r0, r1, h) {
  const g = new THREE.CylinderGeometry(r1, r0, h, 6, 1);
  g.translate(0, h / 2, 0);
  return g;
}

export class Vegetation {
  constructor(world, quality, leavesTex) {
    this.group = new THREE.Group();
    this.uniforms = { uTime: { value: 0 }, uWind: { value: 0.3 } };
    this.nearR = quality.treesNear ?? 300;
    this.farR = quality.treesFar ?? 1200;
    const U = this.uniforms;
    this.kinds = [
      { // 0 pine
        parts: [
          { geo: trunk(0.28, 0.12, 7.5), mat: windMaterial(0x4a3626, U, 0.004) },
          { geo: mergeGeometries([cone(2.3, 3.4, 1.8), cone(1.8, 3.0, 3.8), cone(1.2, 2.6, 5.6), cone(0.6, 1.8, 7.3)]), mat: windMaterial(0x1f3a26, U, 0.012, leavesTex) },
        ],
        far: { geo: cone(2.1, 7.4, 1.2, 5), color: 0x223d28 },
      },
      { // 1 broadleaf
        parts: [
          { geo: trunk(0.32, 0.2, 4.6), mat: windMaterial(0x523b28, U, 0.004) },
          { geo: mergeGeometries([blob(2.4, 0, 5.2, 0, 1), blob(1.8, 1.2, 4.4, 0.6), blob(1.7, -1.1, 4.6, -0.5), blob(1.5, 0.2, 6.4, -0.4)]), mat: windMaterial(0x34522a, U, 0.016, leavesTex) },
        ],
        far: { geo: blob(2.9, 0, 5.0, 0, 0), color: 0x3a5a2e },
      },
      { // 2 birch
        parts: [
          { geo: trunk(0.16, 0.1, 6), mat: windMaterial(0xd8d4c8, U, 0.006) },
          { geo: mergeGeometries([blob(1.4, 0, 5.2, 0, 1), blob(1.1, 0.6, 4.2, 0.3)]), mat: windMaterial(0x5d7a38, U, 0.02, leavesTex) },
        ],
        far: { geo: blob(1.7, 0, 4.8, 0, 0), color: 0x5d7a38 },
      },
      { // 3 dead tree
        parts: [
          {
            geo: mergeGeometries([trunk(0.22, 0.08, 5.5), (() => { const g = trunk(0.08, 0.03, 2.4); g.rotateZ(0.9); g.translate(0.2, 3, 0); return g; })(), (() => { const g = trunk(0.07, 0.03, 2); g.rotateZ(-0.8); g.translate(-0.2, 3.8, 0); return g; })()]),
            mat: windMaterial(0x5b4c3e, U, 0.003),
          },
        ],
        far: null,
      },
      { // 4 bush
        parts: [{ geo: mergeGeometries([blob(1.1, 0, 0.7, 0), blob(0.8, 0.7, 0.5, 0.2), blob(0.7, -0.6, 0.5, -0.3)]), mat: windMaterial(0x3f5a2c, U, 0.03, leavesTex) }],
        far: null,
      },
    ];
    // precompute matrices and colours, bucketed per chunk and kind
    const trees = world.trees.filter((t) => hash2(Math.floor(t.x), Math.floor(t.z), 17) <= quality.trees);
    this.count = trees.length;
    this.mats = new Float32Array(trees.length * 16);
    this.cols = new Float32Array(trees.length * 3);
    this.kind = new Uint8Array(trees.length);
    this.chunks = new Map();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    trees.forEach((t, i) => {
      q.setFromAxisAngle(up, t.r);
      s.setScalar(t.s);
      p.set(t.x, t.y - 0.2, t.z);
      m.compose(p, q, s);
      m.toArray(this.mats, i * 16);
      const v = 0.85 + hash2(Math.floor(t.x * 3), Math.floor(t.z * 3), 5) * 0.3;
      this.cols[i * 3] = v;
      this.cols[i * 3 + 1] = v * (0.95 + hash2(Math.floor(t.x), 1, 2) * 0.1);
      this.cols[i * 3 + 2] = v;
      this.kind[i] = t.k;
      const k = Math.min(NCH - 1, Math.max(0, Math.floor((t.z + WORLD_HALF) / CHUNK))) * NCH + Math.min(NCH - 1, Math.max(0, Math.floor((t.x + WORLD_HALF) / CHUNK)));
      let arr = this.chunks.get(k);
      if (!arr) this.chunks.set(k, (arr = []));
      arr.push(i);
    });
    // instanced meshes with fixed capacity
    const nearCap = Math.min(trees.length, quality.treesNearCap ?? 16000);
    const farCap = Math.min(trees.length, quality.treesFarCap ?? 40000);
    this.near = this.kinds.map((kind) => kind.parts.map((part) => {
      const im = new THREE.InstancedMesh(part.geo, part.mat, nearCap);
      im.count = 0;
      im.castShadow = (quality.shadows || 0) >= 2048;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nearCap * 3), 3);
      this.group.add(im);
      return im;
    }));
    this.farUniforms = { uCam: { value: new THREE.Vector3() }, uNearR: { value: this.nearR - 12 } };
    this.far = this.kinds.map((kind) => {
      if (!kind.far) return null;
      const mat = new THREE.MeshLambertMaterial({ color: kind.far.color });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uCam = this.farUniforms.uCam;
        sh.uniforms.uNearR = this.farUniforms.uNearR;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uCam;\nuniform float uNearR;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\nif (distance(instanceMatrix[3].xz, uCam.xz) < uNearR) transformed = vec3(0.0, -99999.0, 0.0);\n#endif');
      };
      const im = new THREE.InstancedMesh(kind.far.geo, mat, farCap);
      im.count = 0;
      im.castShadow = false;
      im.frustumCulled = false;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(farCap * 3), 3);
      this.group.add(im);
      return im;
    });
    this.lastNear = null;
    this.lastFar = null;
  }

  fill(meshes, cx, cz, r0, r1, parts) {
    const counts = meshes.map(() => 0);
    const ci = Math.floor((cx + WORLD_HALF) / CHUNK);
    const cj = Math.floor((cz + WORLD_HALF) / CHUNK);
    const rr = Math.ceil(r1 / CHUNK) + 1;
    const r0s = r0 * r0;
    const r1s = r1 * r1;
    for (let j = cj - rr; j <= cj + rr; j++) {
      for (let i = ci - rr; i <= ci + rr; i++) {
        if (i < 0 || j < 0 || i >= NCH || j >= NCH) continue;
        const arr = this.chunks.get(j * NCH + i);
        if (!arr) continue;
        for (const t of arr) {
          const x = this.mats[t * 16 + 12];
          const z = this.mats[t * 16 + 14];
          const d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
          if (d < r0s || d > r1s) continue;
          const k = this.kind[t];
          const target = meshes[k];
          if (!target) continue;
          const list = parts ? target : [target];
          const n = counts[k];
          if (n >= list[0].instanceMatrix.count) continue;
          for (const im of list) {
            im.instanceMatrix.array.set(this.mats.subarray(t * 16, t * 16 + 16), n * 16);
            im.instanceColor.array.set(this.cols.subarray(t * 3, t * 3 + 3), n * 3);
          }
          counts[k] = n + 1;
        }
      }
    }
    meshes.forEach((target, k) => {
      if (!target) return;
      for (const im of parts ? target : [target]) {
        im.count = counts[k];
        im.instanceMatrix.needsUpdate = true;
        im.instanceColor.needsUpdate = true;
      }
    });
  }

  update(time, wind, camera) {
    this.uniforms.uTime.value = time;
    this.uniforms.uWind.value = wind;
    if (!camera) return;
    const x = camera.position.x;
    const z = camera.position.z;
    if (!this.lastNear || Math.hypot(this.lastNear.x - x, this.lastNear.z - z) > 24) {
      this.lastNear = { x, z };
      this.fill(this.near, x, z, 0, this.nearR, true);
    }
    this.farUniforms.uCam.value.set(x, 0, z);
    if (!this.lastFar || Math.hypot(this.lastFar.x - x, this.lastFar.z - z) > 80) {
      // inner radius leaves room for camera movement; the shader hides the overlap
      this.lastFar = { x, z };
      this.fill(this.far, x, z, Math.max(0, this.nearR - 110), this.farR, false);
    }
  }
}
