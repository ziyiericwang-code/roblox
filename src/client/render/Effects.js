// Visual effects: GPU point particles (additive + alpha), tracers, muzzle
// flashes, explosions, impacts, smoke screens, dust, splashes and rain.
// Pools are fixed-size and CPU-simulated; counts scale with quality.
import * as THREE from 'three';
import { buildSoftSprite, buildSmokeSprite } from './Textures.js';

const pvert = /* glsl */ `
attribute float size;
attribute vec4 pcolor;
varying vec4 vColor;
#include <fog_pars_vertex>
uniform float uScale;
void main() {
  vColor = pcolor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(0.1, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const pfrag = /* glsl */ `
uniform sampler2D uTex;
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb, vColor.a * t.a * t.r);
  if (gl_FragColor.a < 0.004) discard;
  #include <fog_fragment>
}`;

class ParticlePool {
  constructor(cap, tex, additive) {
    this.cap = cap;
    this.n = 0;
    this.px = new Float32Array(cap);
    this.py = new Float32Array(cap);
    this.pz = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.vz = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.s0 = new Float32Array(cap);
    this.s1 = new Float32Array(cap);
    this.col = new Float32Array(cap * 3);
    this.a0 = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 3);
    this.rgba = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.rgba, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: tex }, uScale: { value: 600 } }]);
    this.uniforms.uTex.value = tex;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: pvert, fragmentShader: pfrag, transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
    this.geo = geo;
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, drag = 0.5, grav = 0) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else i = Math.floor(Math.random() * this.cap);
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.life[i] = 0;
    this.max[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
    this.a0[i] = a;
    this.drag[i] = drag;
    this.grav[i] = grav;
  }
  update(dt) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.max[i]) {
        // swap-remove
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= d;
      this.vy[i] = this.vy[i] * d - this.grav[i] * dt;
      this.vz[i] *= d;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
    }
    this.n = n;
    for (let i = 0; i < n; i++) {
      const t = this.life[i] / this.max[i];
      this.pos[i * 3] = this.px[i];
      this.pos[i * 3 + 1] = this.py[i];
      this.pos[i * 3 + 2] = this.pz[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
      this.rgba[i * 4] = this.col[i * 3];
      this.rgba[i * 4 + 1] = this.col[i * 3 + 1];
      this.rgba[i * 4 + 2] = this.col[i * 3 + 2];
      const fadeIn = Math.min(1, t * 8);
      this.rgba[i * 4 + 3] = this.a0[i] * fadeIn * (1 - t) * (1 - t * 0.3);
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
  copy(from, to) {
    if (from === to) return;
    for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'max', 's0', 's1', 'a0', 'drag', 'grav']) this[k][to] = this[k][from];
    this.col[to * 3] = this.col[from * 3];
    this.col[to * 3 + 1] = this.col[from * 3 + 1];
    this.col[to * 3 + 2] = this.col[from * 3 + 2];
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

export class Effects {
  constructor(scene, quality, groundAt) {
    this.scene = scene;
    this.q = quality;
    this.groundAt = groundAt;
    const scale = quality.particles;
    const soft = buildSoftSprite();
    const smokeTex = buildSmokeSprite();
    this.add = new ParticlePool(Math.floor(2500 * scale), soft, true);
    this.smoke = new ParticlePool(Math.floor(3500 * scale), smokeTex, false);
    this.debris = new ParticlePool(Math.floor(1200 * scale), buildSoftSprite(1), false);
    scene.add(this.add.points, this.smoke.points, this.debris.points);
    // tracers
    this.tracerCap = 160;
    const tg = new THREE.BufferGeometry();
    this.tpos = new Float32Array(this.tracerCap * 6);
    this.tcol = new Float32Array(this.tracerCap * 6);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tpos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tcol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerLines = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
    this.tracerLines.frustumCulled = false;
    scene.add(this.tracerLines);
    this.tracers = [];
    // muzzle flash sprites + a small light pool
    this.flashTex = buildSoftSprite();
    this.flashes = [];
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      scene.add(s);
      this.flashes.push({ s, t: 0 });
    }
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const L = new THREE.PointLight(0xffa050, 0, 30, 2);
      scene.add(L);
      this.lights.push({ L, t: 0, max: 0.1, peak: 0 });
    }
    this.smokeClouds = [];
    this.shake = 0;
    // rain
    this.rainCount = Math.floor(2400 * scale);
    const rg = new THREE.BufferGeometry();
    this.rainPos = new Float32Array(this.rainCount * 6);
    for (let i = 0; i < this.rainCount; i++) {
      const x = rnd(-35, 35);
      const y = rnd(-5, 30);
      const z = rnd(-35, 35);
      this.rainPos.set([x, y, z, x + 0.05, y + 0.9, z + 0.05], i * 6);
    }
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9fb0c0, transparent: true, opacity: 0.35, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
  }

  // ------------------------------------------------------------------ emitters
  muzzle(pos, dir, big = false) {
    const f = this.flashes.find((x) => x.t <= 0) || this.flashes[0];
    f.s.position.set(pos.x + dir.x * 0.1, pos.y + dir.y * 0.1, pos.z + dir.z * 0.1);
    const sc = big ? 1.6 : 0.55 + Math.random() * 0.25;
    f.s.scale.set(sc, sc, sc);
    f.s.material.rotation = Math.random() * 6;
    f.s.visible = true;
    f.t = 0.05;
    this.flashLight(pos.x, pos.y, pos.z, big ? 30 : 6, big ? 0.12 : 0.05);
    this.add.emit(pos.x + dir.x * 0.3, pos.y + dir.y * 0.3, pos.z + dir.z * 0.3, dir.x * 4, dir.y * 4 + 0.3, dir.z * 4, 0.35, 0.3, 1.2, 0.6, 0.55, 0.5, 0.15, 3);
  }

  flashLight(x, y, z, intensity, dur) {
    const l = this.lights.reduce((a, b) => (a.t < b.t ? a : b));
    l.L.position.set(x, y, z);
    l.L.intensity = intensity;
    l.peak = intensity;
    l.t = dur;
    l.max = dur;
  }

  tracer(o, hit, color = 0xffd27a) {
    const len = Math.hypot(hit.x - o.x, hit.y - o.y, hit.z - o.z);
    if (len < 2) return;
    this.tracers.push({ o, d: { x: (hit.x - o.x) / len, y: (hit.y - o.y) / len, z: (hit.z - o.z) / len }, len, t: 0, c: new THREE.Color(color) });
    if (this.tracers.length > this.tracerCap) this.tracers.shift();
  }

  impact(p, kind, mat) {
    // kind: 1 terrain, 2 structure, 3 flesh, 4 vehicle, 5 water
    const n = Math.floor(6 * this.q.particles) + 2;
    if (kind === 5) return this.splash(p.x, p.y, p.z, 0.4);
    if (kind === 3) {
      for (let i = 0; i < 4; i++) this.smoke.emit(p.x, p.y, p.z, rnd(-1, 1), rnd(0, 1.5), rnd(-1, 1), 0.5, 0.2, 0.7, 0.35, 0.18, 0.15, 0.55, 3);
      return;
    }
    const metal = kind === 4 || mat === 2 || mat === 8 || mat === 12 || mat === 13 || mat === 14;
    if (metal) for (let i = 0; i < n; i++) this.add.emit(p.x, p.y, p.z, rnd(-5, 5), rnd(0, 6), rnd(-5, 5), rnd(0.15, 0.4), 0.12, 0.04, 1, 0.75, 0.35, 1, 1, 14);
    const dusty = kind === 1 || mat === 4 || mat === 15;
    const c = dusty ? [0.45, 0.38, 0.28] : [0.55, 0.54, 0.5];
    for (let i = 0; i < n; i++) this.smoke.emit(p.x, p.y, p.z, rnd(-1.2, 1.2), rnd(0.5, 2.5), rnd(-1.2, 1.2), rnd(0.4, 0.9), 0.25, 1.1, c[0], c[1], c[2], 0.5, 2.5, 1.5);
    for (let i = 0; i < 3; i++) this.debris.emit(p.x, p.y, p.z, rnd(-3, 3), rnd(1, 4), rnd(-3, 3), 0.6, 0.08, 0.08, c[0] * 0.6, c[1] * 0.6, c[2] * 0.6, 1, 0.5, 14);
  }

  explosion(x, y, z, size, big) {
    const s = Math.max(1, size / 5);
    const P = this.q.particles;
    this.flashLight(x, y + 1, z, big ? 120 : 60, 0.25);
    for (let i = 0; i < 28 * P * s; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(2, 9) * s;
      this.add.emit(x, y + 0.5, z, Math.cos(a) * sp, rnd(2, 10) * s, Math.sin(a) * sp, rnd(0.25, 0.6), 1.5 * s, 4 * s, 1, rnd(0.45, 0.7), 0.15, 1, 3, -2);
    }
    for (let i = 0; i < 30 * P * s; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(0.5, 5) * s;
      const g = rnd(0.12, 0.25);
      this.smoke.emit(x + rnd(-1, 1), y + rnd(0, 2), z + rnd(-1, 1), Math.cos(a) * sp, rnd(1, 5) * s, Math.sin(a) * sp, rnd(2.5, 6), 2 * s, 9 * s, g, g * 0.95, g * 0.9, 0.85, 0.9, -0.4);
    }
    for (let i = 0; i < 24 * P * s; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(4, 16) * s;
      this.add.emit(x, y + 0.5, z, Math.cos(a) * sp, rnd(4, 16), Math.sin(a) * sp, rnd(0.4, 1.2), 0.18, 0.05, 1, 0.7, 0.3, 1, 0.4, 16);
      this.debris.emit(x, y + 0.5, z, Math.cos(a) * sp * 0.6, rnd(4, 12), Math.sin(a) * sp * 0.6, rnd(0.8, 1.6), 0.25, 0.2, 0.1, 0.09, 0.08, 1, 0.3, 18);
    }
    // dust ring
    for (let i = 0; i < 18 * P; i++) {
      const a = (i / 18) * Math.PI * 2;
      this.smoke.emit(x, y + 0.3, z, Math.cos(a) * 9 * s, 0.4, Math.sin(a) * 9 * s, 1.6, 1.5 * s, 5 * s, 0.42, 0.37, 0.3, 0.5, 2.2, 0);
    }
  }

  smallBoom(x, y, z) {
    for (let i = 0; i < 8; i++) this.add.emit(x, y, z, rnd(-3, 3), rnd(0, 4), rnd(-3, 3), 0.25, 0.8, 1.8, 1, 0.6, 0.2, 1, 3);
    for (let i = 0; i < 8; i++) this.smoke.emit(x, y, z, rnd(-1.5, 1.5), rnd(0.5, 2), rnd(-1.5, 1.5), 1.5, 1, 3, 0.3, 0.3, 0.28, 0.7, 1);
    this.flashLight(x, y, z, 25, 0.1);
  }

  smokeScreen(x, y, z, r, dur) {
    this.smokeClouds.push({ x, y, z, r, until: performance.now() / 1000 + dur, acc: 0 });
  }

  vehicleSmoke(x, y, z, fire) {
    if (fire) this.add.emit(x + rnd(-0.5, 0.5), y, z + rnd(-0.5, 0.5), rnd(-0.3, 0.3), rnd(1, 2.5), rnd(-0.3, 0.3), rnd(0.4, 0.8), 1.2, 2.2, 1, 0.5, 0.15, 0.9, 1, -1);
    const g = fire ? 0.08 : 0.25;
    this.smoke.emit(x + rnd(-0.4, 0.4), y, z + rnd(-0.4, 0.4), rnd(-0.4, 0.4), rnd(1.5, 3), rnd(-0.4, 0.4), rnd(3, 5), 1.2, 5, g, g, g, 0.7, 0.4, -0.2);
  }

  chimneySmoke(x, y, z) {
    this.smoke.emit(x + rnd(-0.5, 0.5), y, z + rnd(-0.5, 0.5), rnd(0.5, 1.2), rnd(1, 2), rnd(-0.2, 0.2), 8, 2, 10, 0.55, 0.55, 0.55, 0.4, 0.1, -0.1);
  }

  dust(x, y, z, amount = 1) {
    this.smoke.emit(x + rnd(-1, 1), y, z + rnd(-1, 1), rnd(-0.6, 0.6), rnd(0.3, 1), rnd(-0.6, 0.6), rnd(1.2, 2.2), 1, 3.5 * amount, 0.5, 0.44, 0.34, 0.35, 1.2, 0);
  }

  splash(x, y, z, amount = 1) {
    for (let i = 0; i < 6 * amount + 2; i++) this.smoke.emit(x + rnd(-0.4, 0.4), y + 0.1, z + rnd(-0.4, 0.4), rnd(-1.5, 1.5), rnd(2, 5), rnd(-1.5, 1.5), 0.7, 0.3, 1.2, 0.8, 0.86, 0.9, 0.6, 0.5, 9);
  }

  rotorWash(x, z) {
    const y = this.groundAt ? this.groundAt(x, z) : 0;
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.emit(x + Math.cos(a) * 3, y + 0.3, z + Math.sin(a) * 3, Math.cos(a) * 8, 0.5, Math.sin(a) * 8, 1.2, 1.5, 4, 0.5, 0.46, 0.38, 0.35, 1.5, 0);
    }
  }

  trail(x, y, z) {
    this.smoke.emit(x, y, z, rnd(-0.2, 0.2), rnd(0, 0.4), rnd(-0.2, 0.2), 1.5, 0.4, 2.2, 0.75, 0.75, 0.75, 0.5, 1, -0.2);
    this.add.emit(x, y, z, 0, 0, 0, 0.08, 0.5, 0.2, 1, 0.7, 0.3, 1, 0);
  }

  sparks(x, y, z) {
    for (let i = 0; i < 6; i++) this.add.emit(x, y, z, rnd(-2, 2), rnd(1, 4), rnd(-2, 2), rnd(0.2, 0.5), 0.08, 0.03, 1, 0.85, 0.5, 1, 0.5, 12);
  }

  // Battles far away are seen, not simulated: smoke columns and flashes over
  // every active battle, with detail by distance (near battles produce real
  // effects from real combat events instead).
  //   < 450 m  nothing extra   450-1500 m  columns + flashes
  //   1500-3500 m  one slow column + rare flashes   beyond: nothing
  updateBattles(battles, world, cam, dt) {
    if (!this.battleFx) this.battleFx = new Map();
    const seen = new Set();
    for (const b of battles || []) {
      const t = world.tById[b.t];
      if (!t) continue;
      seen.add(b.id);
      let st = this.battleFx.get(b.id);
      if (!st) {
        st = { acc: 0, flash: rnd(0, 2), pts: t.sectors.map((s) => ({ x: s.x + rnd(-25, 25), z: s.z + rnd(-25, 25) })) };
        this.battleFx.set(b.id, st);
      }
      const d = Math.hypot(t.x - cam.x, t.z - cam.z);
      if (d < 450 || d > 3500) continue;
      const far = d > 1500;
      const inten = Math.max(0.2, b.int || 0.5);
      st.acc += dt * inten * (far ? 0.8 : 2.5) * this.q.particles;
      while (st.acc > 1) {
        st.acc -= 1;
        const p = far ? st.pts[0] : st.pts[Math.floor(Math.random() * st.pts.length)];
        const y = this.groundAt ? this.groundAt(p.x, p.z) : 0;
        const g = rnd(0.16, 0.26);
        const sz = far ? 45 : 22;
        this.smoke.emit(p.x + rnd(-6, 6), y + 4, p.z + rnd(-6, 6), rnd(0.5, 2), rnd(3, 6), rnd(-0.5, 0.5), rnd(14, 22), sz * 0.5, sz * 2.2, g, g * 0.97, g * 0.94, 0.55, 0.05, -0.15);
      }
      st.flash -= dt * inten;
      if (st.flash <= 0) {
        st.flash = far ? rnd(1.5, 4) : rnd(0.3, 1.4);
        const p = st.pts[Math.floor(Math.random() * st.pts.length)];
        const y = (this.groundAt ? this.groundAt(p.x, p.z) : 0) + 2;
        const f = this.flashes.find((x) => x.t <= 0) || this.flashes[0];
        f.s.position.set(p.x + rnd(-30, 30), y, p.z + rnd(-30, 30));
        const sc = (far ? 26 : 14) * rnd(0.6, 1.2);
        f.s.scale.set(sc, sc, sc);
        f.s.visible = true;
        f.t = 0.12;
      }
    }
    for (const id of this.battleFx.keys()) if (!seen.has(id)) this.battleFx.delete(id);
  }

  // Recon drone circling a point (visual only).
  drone(x, z, secs) {
    this.drones = this.drones || [];
    this.drones.push({ x, z, until: performance.now() / 1000 + secs });
  }

  // ------------------------------------------------------------------ update
  update(dt, time, camera, weather) {
    this.add.uniforms.uScale.value = window.innerHeight * 0.9;
    this.smoke.uniforms.uScale.value = window.innerHeight * 0.9;
    this.debris.uniforms.uScale.value = window.innerHeight * 0.9;
    this.add.update(dt);
    this.smoke.update(dt);
    this.debris.update(dt);
    for (const f of this.flashes) {
      if (f.t > 0) {
        f.t -= dt;
        if (f.t <= 0) f.s.visible = false;
      }
    }
    for (const l of this.lights) {
      if (l.t > 0) {
        l.t -= dt;
        l.L.intensity = Math.max(0, (l.t / l.max) * l.peak);
      } else l.L.intensity = 0;
    }
    // tracers: streaks travelling at ~450 m/s
    let k = 0;
    const alive = [];
    for (const tr of this.tracers) {
      tr.t += dt;
      const head = tr.t * 450;
      if (head - 8 > tr.len) continue;
      alive.push(tr);
      const a = Math.max(0, head - 7);
      const b = Math.min(tr.len, head);
      if (k < this.tracerCap) {
        this.tpos.set([tr.o.x + tr.d.x * a, tr.o.y + tr.d.y * a, tr.o.z + tr.d.z * a, tr.o.x + tr.d.x * b, tr.o.y + tr.d.y * b, tr.o.z + tr.d.z * b], k * 6);
        const c = tr.c;
        this.tcol.set([c.r * 0.2, c.g * 0.2, c.b * 0.2, c.r * 2, c.g * 2, c.b * 2], k * 6);
        k++;
      }
    }
    this.tracers = alive;
    this.tracerLines.geometry.setDrawRange(0, k * 2);
    this.tracerLines.geometry.attributes.position.needsUpdate = true;
    this.tracerLines.geometry.attributes.color.needsUpdate = true;
    // smoke screens keep emitting
    const now = performance.now() / 1000;
    this.smokeClouds = this.smokeClouds.filter((c) => c.until > now);
    for (const c of this.smokeClouds) {
      c.acc += dt;
      const rate = 0.05 / this.q.particles;
      while (c.acc > rate) {
        c.acc -= rate;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * c.r;
        const g = rnd(0.72, 0.85);
        this.smoke.emit(c.x + Math.cos(a) * r, c.y + rnd(0, 2), c.z + Math.sin(a) * r, rnd(-0.3, 0.3), rnd(0.1, 0.5), rnd(-0.3, 0.3), rnd(5, 9), 3, 8, g, g, g * 1.02, 0.55, 0.1, -0.02);
      }
    }
    // rain box follows the camera
    const rain = weather ? weather.rain : 0;
    this.rain.visible = rain > 0.05;
    if (this.rain.visible) {
      const n = Math.floor(this.rainCount * Math.min(1, rain));
      const p = this.rainPos;
      const cx = camera.position.x;
      const cy = camera.position.y;
      const cz = camera.position.z;
      const fall = 22 * dt;
      const wind = (weather.wind || 0.3) * 4 * dt;
      for (let i = 0; i < n; i++) {
        const o = i * 6;
        p[o + 1] -= fall;
        p[o + 4] -= fall;
        p[o] += wind;
        p[o + 3] += wind;
        if (p[o + 1] < cy - 6 || Math.abs(p[o] - cx) > 36 || Math.abs(p[o + 2] - cz) > 36) {
          const x = cx + rnd(-35, 35);
          const y = cy + rnd(10, 26);
          const z = cz + rnd(-35, 35);
          p[o] = x;
          p[o + 1] = y;
          p[o + 2] = z;
          p[o + 3] = x - 0.06;
          p[o + 4] = y + 0.9;
          p[o + 5] = z;
        }
      }
      this.rain.geometry.setDrawRange(0, n * 2);
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.material.opacity = 0.18 + rain * 0.25;
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
    void time;
  }
}
