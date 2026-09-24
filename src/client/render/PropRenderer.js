// Dynamic props & projectiles: supply crates, ammo packs, rally points,
// destructible mission targets, grenades, rockets, shells, charges.
import * as THREE from 'three';
import { PROP_KIND, FACTION } from '../../shared/constants.js';
import { PROJECTILE_CODES } from '../../shared/combat.js';

const B = (w, h, d, y = 0) => new THREE.BoxGeometry(w, h, d).translate(0, y + h / 2, 0);

export class PropRenderer {
  constructor(scene) {
    this.scene = scene;
    this.objs = new Map();
    this.mats = {
      crate: new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.9 }),
      olive: new THREE.MeshStandardMaterial({ color: 0x4a5230, roughness: 0.85 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.6, metalness: 0.4 }),
      light: new THREE.MeshStandardMaterial({ color: 0xc9c7bd, roughness: 0.6 }),
      red: new THREE.MeshStandardMaterial({ color: 0x9a2a22, roughness: 0.7 }),
      chute: new THREE.MeshStandardMaterial({ color: 0x7a8060, roughness: 0.95, side: THREE.DoubleSide }),
      blink: new THREE.MeshBasicMaterial({ color: 0xff3020 }),
      flagB: new THREE.MeshStandardMaterial({ color: 0x3d6fc0, side: THREE.DoubleSide }),
      rocket: new THREE.MeshStandardMaterial({ color: 0x3b4230, roughness: 0.6 }),
      glow: new THREE.MeshBasicMaterial({ color: 0xffc070 }),
    };
  }

  make(item) {
    const g = new THREE.Group();
    const M = this.mats;
    if (item.k === 3) {
      const type = PROJECTILE_CODES[item.type];
      if (type === 'rocket' || type === 'shell' || type === 'mortar') {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 8).rotateX(Math.PI / 2), M.rocket);
        const tail = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), M.glow);
        tail.position.z = 0.45;
        g.add(body, tail);
        g.userData.trail = true;
      } else if (type === 'charge') {
        g.add(new THREE.Mesh(B(0.22, 0.12, 0.16), M.olive));
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), M.blink);
        l.position.y = 0.14;
        g.add(l);
        g.userData.blink = l;
      } else {
        const gr = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), type === 'smoke' ? M.light : M.olive);
        gr.scale.set(1, 1.3, 1);
        g.add(gr);
      }
      return g;
    }
    switch (item.type) {
      case PROP_KIND.SUPPLY_CRATE: {
        g.add(new THREE.Mesh(B(0.9, 0.7, 0.7), M.crate));
        const band = new THREE.Mesh(B(0.92, 0.1, 0.72, 0.3), M.dark);
        g.add(band);
        const chute = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.5), M.chute);
        chute.position.y = 4.2;
        chute.visible = false;
        g.add(chute);
        g.userData.chute = chute;
        break;
      }
      case PROP_KIND.AMMO_BAG:
        g.add(new THREE.Mesh(B(0.45, 0.3, 0.3), M.olive));
        g.add(new THREE.Mesh(B(0.47, 0.06, 0.32, 0.2), M.dark));
        break;
      case PROP_KIND.RALLY_POINT: {
        g.add(new THREE.Mesh(B(0.5, 0.4, 0.35), M.olive));
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.8, 5).translate(0, 0.9, 0), M.dark);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.35).translate(0.3, 1.6, 0), M.flagB);
        g.add(pole, flag);
        break;
      }
      case PROP_KIND.TARGET: {
        const v = item.variant;
        if (v === 0) {
          // artillery piece
          g.add(new THREE.Mesh(B(2.2, 0.5, 3.2), M.dark));
          const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 4.2, 10).rotateX(Math.PI / 2 - 0.4), M.dark);
          barrel.position.set(0, 1.6, -1.2);
          g.add(barrel);
          g.add(new THREE.Mesh(B(1.4, 1.0, 0.1, 0.5), M.olive).translateZ(-0.6));
          for (const x of [-1.2, 1.2]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.3, 12).rotateZ(Math.PI / 2), M.dark).translateX(x).translateY(0.55));
        } else if (v === 1) {
          // radar array
          g.add(new THREE.Mesh(B(2.4, 1.6, 2.0), M.olive));
          const dish = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.8, 0.2), M.light);
          dish.position.y = 3.2;
          g.add(dish);
          g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.8, 6).translate(0, 2.2, 0), M.dark));
          g.userData.spin = dish;
        } else if (v === 2) {
          // fuel tank
          g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 5, 14).rotateX(Math.PI / 2).translate(0, 1.5, 0), M.light));
          g.add(new THREE.Mesh(B(0.3, 1.5, 4.5), M.dark));
        } else if (v === 3) {
          // comms tower
          g.add(new THREE.Mesh(B(1.6, 1.4, 1.6), M.olive));
          g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 9, 6).translate(0, 5.6, 0), M.dark));
          const l = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 4), M.blink);
          l.position.y = 10.1;
          g.add(l);
          g.userData.blink = l;
        } else {
          // ammo dump
          for (let i = 0; i < 6; i++) g.add(new THREE.Mesh(B(0.9, 0.6, 0.6), M.olive).translateX((i % 3) * 1 - 1).translateZ(Math.floor(i / 3) * 0.7 - 0.35).translateY((i % 2) * 0.6));
          g.add(new THREE.Mesh(B(3.4, 0.08, 2.2, 1.6), M.chute));
        }
        g.userData.target = true;
        break;
      }
      default:
        g.add(new THREE.Mesh(B(0.5, 0.5, 0.5), M.crate));
    }
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return g;
  }

  update(list, dt, time, effects) {
    const seen = new Set();
    for (const it of list) {
      const key = `${it.k}:${it.id}`;
      seen.add(key);
      let o = this.objs.get(key);
      if (!o) {
        o = { g: this.make(it), last: { x: it.x, y: it.y, z: it.z }, trailAcc: 0 };
        this.objs.set(key, o);
        this.scene.add(o.g);
      }
      const g = o.g;
      const dx = it.x - o.last.x;
      const dy = it.y - o.last.y;
      const dz = it.z - o.last.z;
      g.position.set(it.x, it.y, it.z);
      if (it.k === 3 && Math.hypot(dx, dy, dz) > 0.01) {
        g.lookAt(it.x + dx, it.y + dy, it.z + dz);
        g.rotateY(Math.PI);
        if (g.userData.trail && effects) {
          o.trailAcc += dt;
          if (o.trailAcc > 0.02) {
            o.trailAcc = 0;
            effects.trail(it.x, it.y, it.z);
          }
        }
      }
      o.last.x = it.x;
      o.last.y = it.y;
      o.last.z = it.z;
      if (g.userData.chute) g.userData.chute.visible = dy < -0.005;
      if (g.userData.blink) g.userData.blink.visible = Math.sin(time * 10) > 0;
      if (g.userData.spin) g.userData.spin.rotation.y += dt * 0.8;
      if (g.userData.target) {
        const dead = it.health <= 0;
        g.visible = true;
        if (dead && !o.burnt) {
          o.burnt = true;
          g.traverse((m) => {
            if (m.isMesh) m.material = new THREE.MeshStandardMaterial({ color: 0x1b1918, roughness: 1 });
          });
        }
        if (dead && effects) {
          o.trailAcc += dt;
          if (o.trailAcc > 0.15) {
            o.trailAcc = 0;
            effects.vehicleSmoke(it.x, it.y + 1.5, it.z, true);
          }
        }
      }
      if (it.k === 4 && it.faction !== this.myFaction && it.type === PROP_KIND.RALLY_POINT) g.visible = false;
    }
    for (const [key, o] of this.objs) {
      if (!seen.has(key)) {
        this.scene.remove(o.g);
        this.objs.delete(key);
      }
    }
  }
}
