// Instanced vegetation (pines, broadleaf trees, birches, dead trees, bushes)
// with a vertex-shader wind sway. One draw call per tree part type.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash2 } from '../../shared/math.js';

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
    const U = this.uniforms;
    const kinds = [
      { // 0 pine
        parts: [
          { geo: trunk(0.28, 0.12, 7.5), mat: windMaterial(0x4a3626, U, 0.004) },
          { geo: mergeGeometries([cone(2.3, 3.4, 1.8), cone(1.8, 3.0, 3.8), cone(1.2, 2.6, 5.6), cone(0.6, 1.8, 7.3)]), mat: windMaterial(0x1f3a26, U, 0.012, leavesTex) },
        ],
      },
      { // 1 broadleaf
        parts: [
          { geo: trunk(0.32, 0.2, 4.6), mat: windMaterial(0x523b28, U, 0.004) },
          { geo: mergeGeometries([blob(2.4, 0, 5.2, 0, 1), blob(1.8, 1.2, 4.4, 0.6), blob(1.7, -1.1, 4.6, -0.5), blob(1.5, 0.2, 6.4, -0.4)]), mat: windMaterial(0x34522a, U, 0.016, leavesTex) },
        ],
      },
      { // 2 birch
        parts: [
          { geo: trunk(0.16, 0.1, 6), mat: windMaterial(0xd8d4c8, U, 0.006) },
          { geo: mergeGeometries([blob(1.4, 0, 5.2, 0, 1), blob(1.1, 0.6, 4.2, 0.3)]), mat: windMaterial(0x5d7a38, U, 0.02, leavesTex) },
        ],
      },
      { // 3 dead tree
        parts: [
          {
            geo: mergeGeometries([trunk(0.22, 0.08, 5.5), (() => { const g = trunk(0.08, 0.03, 2.4); g.rotateZ(0.9); g.translate(0.2, 3, 0); return g; })(), (() => { const g = trunk(0.07, 0.03, 2); g.rotateZ(-0.8); g.translate(-0.2, 3.8, 0); return g; })()]),
            mat: windMaterial(0x5b4c3e, U, 0.003),
          },
        ],
      },
      { // 4 bush
        parts: [{ geo: mergeGeometries([blob(1.1, 0, 0.7, 0), blob(0.8, 0.7, 0.5, 0.2), blob(0.7, -0.6, 0.5, -0.3)]), mat: windMaterial(0x3f5a2c, U, 0.03, leavesTex) }],
      },
    ];
    const byKind = kinds.map(() => []);
    for (const t of world.trees) {
      if (hash2(Math.floor(t.x), Math.floor(t.z), 17) > quality.trees) continue;
      byKind[t.k].push(t);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    kinds.forEach((kind, ki) => {
      const list = byKind[ki];
      if (!list.length) return;
      for (const part of kind.parts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
        list.forEach((t, i) => {
          q.setFromAxisAngle(up, t.r);
          s.setScalar(t.s);
          p.set(t.x, t.y - 0.2, t.z);
          m.compose(p, q, s);
          im.setMatrixAt(i, m);
          const v = 0.85 + hash2(Math.floor(t.x * 3), Math.floor(t.z * 3), 5) * 0.3;
          col.setRGB(v, v * (0.95 + hash2(Math.floor(t.x), 1, 2) * 0.1), v);
          im.setColorAt(i, col);
        });
        im.castShadow = quality.shadows >= 2048;
        im.receiveShadow = true;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        this.group.add(im);
      }
    });
  }

  update(time, wind) {
    this.uniforms.uTime.value = time;
    this.uniforms.uWind.value = wind;
  }
}
