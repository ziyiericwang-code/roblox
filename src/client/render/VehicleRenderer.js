// Vehicle models built from primitives: trucks, jeeps, recon cars, APCs,
// tanks, helicopters, patrol boats and the gunship. Animated wheels,
// turrets, barrels and rotors; faction/skin colours; damage & wreck states.
import * as THREE from 'three';
import { VEHICLES } from '../../shared/config/vehicles.js';
import { VEHICLE_CODES } from '../../shared/combat.js';
import { FACTION } from '../../shared/constants.js';

const SKINS = [null, 0xa8936a, 0xcfd4d6, 0x62666b];
const FACTION_BODY = { [FACTION.COALITION]: 0x4d5530, [FACTION.DOMINION]: 0x45494d };

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function wheelGeo(r, w) {
  const g = new THREE.CylinderGeometry(r, r, w, 14);
  g.rotateZ(Math.PI / 2);
  return g;
}

class VehicleModel {
  constructor(type, faction, skin) {
    this.type = type;
    this.def = VEHICLES[type];
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const col = SKINS[skin] || FACTION_BODY[faction] || 0x4d5530;
    this.bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.75, metalness: 0.15 });
    this.darkMat = new THREE.MeshStandardMaterial({ color: 0x1e2022, roughness: 0.7, metalness: 0.3 });
    this.tireMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
    this.glassMat = new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.15, metalness: 0.6 });
    this.canvasMat = new THREE.MeshStandardMaterial({ color: faction === FACTION.DOMINION ? 0x3c3f42 : 0x5b5a3c, roughness: 0.95 });
    this.lightMat = new THREE.MeshStandardMaterial({ color: 0x777766, emissive: 0xfff2c0, emissiveIntensity: 0 });
    this.wheels = [];
    this.turret = null;
    this.barrel = null;
    this.rotors = [];
    this.build();
    this.root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
  }

  wheel(x, y, z, r, w) {
    const m = mesh(wheelGeo(r, w), this.tireMat, x, y, z);
    const hub = mesh(wheelGeo(r * 0.45, w * 1.05), this.darkMat);
    m.add(hub);
    this.body.add(m);
    this.wheels.push({ m, r });
  }

  mg(parent, x, y, z) {
    const t = new THREE.Group();
    t.position.set(x, y, z);
    const base = mesh(B(0.2, 0.25, 0.2), this.darkMat, 0, 0.12, 0);
    const shield = mesh(B(0.6, 0.35, 0.05), this.darkMat, 0, 0.35, -0.2);
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.35, 0);
    const gun = mesh(B(0.1, 0.12, 1.1), this.darkMat, 0, 0, -0.45);
    pivot.add(gun);
    t.add(base, shield, pivot);
    parent.add(t);
    return { turret: t, barrel: pivot };
  }

  build() {
    const b = this.body;
    const bm = this.bodyMat;
    const dm = this.darkMat;
    switch (this.type) {
      case 'truck': {
        b.add(mesh(B(2.5, 0.35, 7.4), dm, 0, 0.75, 0));
        b.add(mesh(B(2.4, 1.5, 1.9), bm, 0, 1.65, -2.6));
        b.add(mesh(B(2.3, 0.7, 0.05), this.glassMat, 0, 2.0, -3.56));
        b.add(mesh(B(2.4, 0.9, 1.0), bm, 0, 1.3, -3.9));
        b.add(mesh(B(2.5, 0.5, 4.8), bm, 0, 1.25, 1.2));
        const cover = mesh(B(2.5, 1.7, 4.8), this.canvasMat, 0, 2.35, 1.2);
        b.add(cover);
        for (const z of [-2.9, 0.9, 2.5]) for (const x of [-1.15, 1.15]) this.wheel(x, 0.5, z, 0.5, 0.35);
        const hl = mesh(B(0.3, 0.2, 0.05), this.lightMat, 0.8, 1.45, -4.42);
        const hl2 = hl.clone();
        hl2.position.x = -0.8;
        b.add(hl, hl2);
        break;
      }
      case 'jeep': {
        b.add(mesh(B(1.9, 0.55, 4.3), bm, 0, 0.85, 0));
        b.add(mesh(B(1.9, 0.35, 1.4), bm, 0, 1.2, -1.45));
        b.add(mesh(B(1.8, 0.55, 0.06), this.glassMat, 0, 1.55, -0.75));
        b.add(mesh(B(0.08, 0.9, 0.08), dm, -0.9, 1.6, 0.5));
        b.add(mesh(B(0.08, 0.9, 0.08), dm, 0.9, 1.6, 0.5));
        b.add(mesh(B(1.9, 0.08, 0.08), dm, 0, 2.05, 0.5));
        b.add(mesh(B(0.5, 0.5, 0.5), dm, 0, 1.35, 1.9));
        for (const z of [-1.4, 1.4]) for (const x of [-0.95, 0.95]) this.wheel(x, 0.45, z, 0.45, 0.32);
        const g = this.mg(b, 0, 1.55, 0.9);
        this.turret = g.turret;
        this.barrel = g.barrel;
        break;
      }
      case 'recon': {
        b.add(mesh(B(2.1, 0.8, 4.8), bm, 0, 1.0, 0));
        const nose = mesh(B(2.0, 0.6, 1.2), bm, 0, 1.05, -2.6);
        nose.rotation.x = 0.4;
        b.add(nose);
        b.add(mesh(B(1.6, 0.35, 0.05), this.glassMat, 0, 1.45, -1.3));
        for (const z of [-1.6, 1.6]) for (const x of [-1.1, 1.1]) this.wheel(x, 0.55, z, 0.55, 0.4);
        const g = this.mg(b, 0, 1.5, 0.4);
        this.turret = g.turret;
        this.barrel = g.barrel;
        break;
      }
      case 'apc': {
        b.add(mesh(B(3.0, 1.5, 6.8), bm, 0, 1.45, 0.1));
        const glacis = mesh(B(2.9, 0.08, 1.8), bm, 0, 1.75, -3.6);
        glacis.rotation.x = 0.55;
        b.add(glacis);
        b.add(mesh(B(3.0, 0.6, 0.8), bm, 0, 1.0, -3.4));
        for (const z of [-2.4, -0.8, 0.8, 2.4]) for (const x of [-1.5, 1.5]) this.wheel(x, 0.55, z, 0.55, 0.4);
        const t = new THREE.Group();
        t.position.set(0, 2.2, -0.6);
        t.add(mesh(B(1.4, 0.55, 1.6), bm, 0, 0.27, 0));
        const pivot = new THREE.Group();
        pivot.position.set(0, 0.3, -0.8);
        pivot.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.8, 8).rotateX(Math.PI / 2), dm, 0, 0, -0.9));
        t.add(pivot);
        b.add(t);
        this.turret = t;
        this.barrel = pivot;
        break;
      }
      case 'tank': {
        b.add(mesh(B(3.4, 1.0, 7.4), bm, 0, 1.15, 0));
        const glacis = mesh(B(3.3, 0.1, 1.6), bm, 0, 1.45, -3.9);
        glacis.rotation.x = 0.8;
        b.add(glacis);
        for (const x of [-1.6, 1.6]) {
          b.add(mesh(B(0.7, 0.85, 7.6), this.tireMat, x, 0.45, 0));
          for (let z = -3.1; z <= 3.1; z += 1.03) this.wheel(x * 1.02, 0.42, z, 0.36, 0.72);
        }
        const t = new THREE.Group();
        t.position.set(0, 1.65, 0.3);
        t.add(mesh(B(2.4, 0.75, 3.2), bm, 0, 0.38, 0));
        t.add(mesh(B(1.8, 0.5, 0.9), bm, 0, 0.35, 1.9));
        t.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.35, 10), dm, 0.6, 0.9, 0.5));
        const pivot = new THREE.Group();
        pivot.position.set(0, 0.4, -1.5);
        pivot.add(mesh(B(0.6, 0.5, 0.5), bm, 0, 0, 0));
        pivot.add(mesh(new THREE.CylinderGeometry(0.1, 0.11, 4.4, 10).rotateX(Math.PI / 2), dm, 0, 0.02, -2.4));
        t.add(pivot);
        b.add(t);
        this.turret = t;
        this.barrel = pivot;
        break;
      }
      case 'heli':
      case 'gunship': {
        const big = this.type === 'gunship';
        const s = big ? 1.15 : 1;
        b.add(mesh(B(2.4 * s, 2.2 * s, 5.2 * s), bm, 0, 1.6, -0.6));
        const nose = mesh(new THREE.SphereGeometry(1.2 * s, 12, 8), bm, 0, 1.65, -3.2 * s);
        nose.scale.set(1, 0.9, 1.1);
        b.add(nose);
        b.add(mesh(new THREE.SphereGeometry(1.0 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.glassMat, 0, 1.9, -3.4 * s));
        const boom = mesh(new THREE.CylinderGeometry(0.25, 0.55, 6.5 * s, 8).rotateX(Math.PI / 2), bm, 0, 2.0, 4.4 * s);
        b.add(boom);
        b.add(mesh(B(0.12, 1.4, 0.9), bm, 0, 2.6, 7.4 * s));
        for (const x of [-1.1, 1.1]) b.add(mesh(B(0.12, 0.12, 4.2), dm, x * s, 0.08, -0.6));
        for (const x of [-1.1, 1.1]) for (const z of [-1.8, 0.6]) b.add(mesh(B(0.08, 0.6, 0.08), dm, x * s, 0.35, z));
        if (big) {
          b.add(mesh(B(4.2, 0.12, 0.9), bm, 0, 1.2, -0.2));
          for (const x of [-1.9, 1.9]) b.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.4, 8).rotateX(Math.PI / 2), dm, x, 1.0, -0.2));
        }
        const rotor = new THREE.Group();
        rotor.position.set(0, 2.9 * s, -0.6);
        rotor.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.4, 8), dm, 0, -0.1, 0));
        for (let i = 0; i < 4; i++) {
          const blade = mesh(B(0.35, 0.05, 6.5 * s), dm, 0, 0.1, 3.25 * s);
          const arm = new THREE.Group();
          arm.rotation.y = (i * Math.PI) / 2;
          arm.add(blade);
          rotor.add(arm);
        }
        b.add(rotor);
        this.rotors.push({ obj: rotor, axis: 'y', speed: 22 });
        const tail = new THREE.Group();
        tail.position.set(0.15, 2.7, 7.4 * s);
        for (let i = 0; i < 2; i++) {
          const bl = mesh(B(0.05, 1.5, 0.18), dm, 0, 0, 0);
          bl.rotation.x = (i * Math.PI) / 2;
          tail.add(bl);
        }
        b.add(tail);
        this.rotors.push({ obj: tail, axis: 'x', speed: 40 });
        if (!big) {
          const g = this.mg(b, 1.35, 1.2, -0.4);
          g.turret.rotation.y = -Math.PI / 2;
          this.turret = g.turret;
          this.barrel = g.barrel;
        } else {
          const g = this.mg(b, 0, 0.3, -3.2);
          this.turret = g.turret;
          this.barrel = g.barrel;
        }
        break;
      }
      case 'boat': {
        b.add(mesh(B(3.3, 1.1, 7.2), bm, 0, 0.3, 0.9));
        const bow = mesh(new THREE.ConeGeometry(1.65, 2.8, 4, 1).rotateX(-Math.PI / 2).rotateZ(Math.PI / 4), bm, 0, 0.35, -3.9);
        bow.scale.set(1, 0.55, 1);
        b.add(bow);
        b.add(mesh(B(1.8, 1.1, 1.6), bm, 0, 1.4, 0.2));
        b.add(mesh(B(1.7, 0.5, 0.05), this.glassMat, 0, 1.7, -0.62));
        for (const x of [-0.6, 0.6]) b.add(mesh(B(0.35, 0.9, 0.4), dm, x, 0.5, 4.6));
        const g = this.mg(b, 0, 0.85, -3.0);
        this.turret = g.turret;
        this.barrel = g.barrel;
        break;
      }
      default:
        b.add(mesh(B(2, 1.5, 4), bm, 0, 1, 0));
    }
  }

  setWreck(on) {
    if (on === this.wrecked) return;
    this.wrecked = on;
    if (on) {
      const burnt = new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 1 });
      this.root.traverse((o) => {
        if (o.isMesh) o.material = burnt;
      });
    }
  }
}

export class VehicleRenderer {
  constructor(scene) {
    this.scene = scene;
    this.models = new Map();
  }

  update(list, dt, time, daylight, effects, camPos) {
    const seen = new Set();
    for (const v of list) {
      seen.add(v.id);
      const type = VEHICLE_CODES[v.type];
      if (!type) continue;
      let m = this.models.get(v.id);
      if (!m || m.faction !== v.faction || m.skin !== v.skin) {
        if (m) this.scene.remove(m.model.root);
        const model = new VehicleModel(type, v.faction, v.skin);
        m = { model, faction: v.faction, skin: v.skin, spin: 0, smokeAcc: 0, dustAcc: 0 };
        this.models.set(v.id, m);
        this.scene.add(model.root);
      }
      const md = m.model;
      const def = md.def;
      const baseY = def.ground ? v.y - def.rideHeight : v.y;
      md.root.position.set(v.x, baseY, v.z);
      md.root.rotation.set(v.pitch || 0, v.yaw, -(v.roll || 0), 'YXZ');
      const wreck = (v.state & 7) === 3;
      md.setWreck(wreck);
      // wheels
      const spd = v.speed || 0;
      for (const w of md.wheels) w.m.rotation.x -= (spd / w.r) * dt;
      // turret
      if (md.turret && !wreck) {
        const baseTurretYaw = type === 'heli' ? -Math.PI / 2 : 0;
        md.turret.rotation.y = type === 'heli' ? baseTurretYaw + (v.turretYaw || 0) + Math.PI / 2 : v.turretYaw || 0;
        if (md.barrel) md.barrel.rotation.x = v.turretPitch || 0;
      }
      // rotors spin while the engine runs
      const engine = (v.state & 8) !== 0;
      m.spin = Math.max(0, Math.min(1, m.spin + (engine && !wreck ? dt * 0.5 : -dt * 0.3)));
      for (const r of md.rotors) r.obj.rotation[r.axis] += r.speed * m.spin * dt;
      md.lightMat.emissiveIntensity = engine ? (1 - daylight) * 3 : 0;
      // effects
      const near = Math.hypot(v.x - camPos.x, v.z - camPos.z) < 350;
      if (effects && near) {
        const st = v.state & 7;
        m.smokeAcc += dt;
        if ((st === 1 || st === 2 || wreck) && m.smokeAcc > (st === 2 ? 0.08 : 0.2)) {
          m.smokeAcc = 0;
          effects.vehicleSmoke(v.x, baseY + def.halfSize[1] * 2, v.z, st >= 2 || wreck);
        }
        if (def.ground && Math.abs(spd) > 6) {
          m.dustAcc += dt * Math.abs(spd) * 0.1;
          if (m.dustAcc > 1) {
            m.dustAcc = 0;
            const fx = -Math.sin(v.yaw);
            const fz = -Math.cos(v.yaw);
            effects.dust(v.x - fx * def.halfSize[2], baseY + 0.3, v.z - fz * def.halfSize[2], 0.8);
          }
        }
        if (def.water && Math.abs(spd) > 3) {
          m.dustAcc += dt * Math.abs(spd) * 0.15;
          if (m.dustAcc > 1) {
            m.dustAcc = 0;
            effects.splash(v.x, 0.2, v.z, 0.6);
          }
        }
        if (def.air && m.spin > 0.5 && baseY - (effects.groundAt ? effects.groundAt(v.x, v.z) : 0) < 12) {
          m.dustAcc += dt * 6;
          if (m.dustAcc > 1) {
            m.dustAcc = 0;
            effects.rotorWash(v.x, v.z);
          }
        }
      }
    }
    for (const [id, m] of this.models) {
      if (!seen.has(id)) {
        this.scene.remove(m.model.root);
        this.models.delete(id);
      }
    }
  }
}
