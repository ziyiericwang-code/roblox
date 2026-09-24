// Instanced soldiers with procedural animation.
// Every body part type is one InstancedMesh shared by all soldiers, so a
// battle with 150 soldiers costs ~25 draw calls. Poses are computed with
// forward kinematics plus a two-bone IK that puts the hands on the weapon.
import * as THREE from 'three';
import { STANCE, LIFE, FACTION } from '../../shared/constants.js';
import { WEAPONS } from '../../shared/config/weapons.js';
import { WEAPON_CODES, EMOTE_CODES } from '../../shared/combat.js';
import { CAMOS, DOMINION_CAMO } from '../../shared/config/cosmetics.js';
import { buildCamoMask } from './Textures.js';
import { lerp, clamp } from '../../shared/math.js';

const MAX = 180;
const tmpM = new THREE.Matrix4();
const tmpM2 = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const E = new THREE.Euler();

function box(w, h, d, cy = 0, cz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, cy, cz);
  return g;
}

// Camo material: grayscale mask picks one of three per-instance colours.
function camoMaterial(mask) {
  const mat = new THREE.MeshStandardMaterial({ map: mask, roughness: 0.92 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 camoB;\nattribute vec3 camoC;\nvarying vec3 vCamoB;\nvarying vec3 vCamoC;\nvarying vec3 vCamoA;\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCamoB = camoB;\nvCamoC = camoC;\nvObjPos = position;\n#ifdef USE_INSTANCING_COLOR\nvCamoA = instanceColor;\n#else\nvCamoA = vec3(1.0);\n#endif');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCamoB;\nvarying vec3 vCamoC;\nvarying vec3 vCamoA;\nvarying vec3 vObjPos;')
      .replace(
        '#include <map_fragment>',
        `float cm = texture2D(map, vObjPos.xy * 2.1 + vObjPos.zy * 1.7).r;
         vec3 camo = cm < 0.3 ? vCamoC : (cm < 0.7 ? vCamoB : vCamoA);
         diffuseColor.rgb = camo;`,
      )
      .replace('#include <color_fragment>', '');
  };
  mat.customProgramCacheKey = () => 'camo-v2';
  return mat;
}

function weaponGeometry(model) {
  const parts = [];
  const add = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(g);
  };
  switch (model) {
    case 'rifle':
      add(0.06, 0.1, 0.46, 0, 0.03, -0.12);
      add(0.03, 0.03, 0.34, 0, 0.05, -0.52);
      add(0.05, 0.1, 0.24, 0, 0.0, 0.2);
      add(0.04, 0.15, 0.07, 0, -0.07, -0.14);
      add(0.03, 0.05, 0.1, 0, 0.1, -0.08);
      add(0.035, 0.1, 0.04, 0, -0.06, 0.02);
      break;
    case 'battle':
      add(0.065, 0.11, 0.5, 0, 0.03, -0.14);
      add(0.035, 0.035, 0.4, 0, 0.05, -0.58);
      add(0.055, 0.12, 0.26, 0, 0.0, 0.22);
      add(0.045, 0.12, 0.08, 0, -0.06, -0.16);
      add(0.04, 0.06, 0.16, 0, 0.11, -0.1);
      add(0.035, 0.1, 0.04, 0, -0.06, 0.02);
      break;
    case 'smg':
      add(0.06, 0.1, 0.32, 0, 0.03, -0.08);
      add(0.03, 0.03, 0.14, 0, 0.04, -0.3);
      add(0.04, 0.05, 0.2, 0, 0.02, 0.16);
      add(0.035, 0.2, 0.05, 0, -0.1, -0.1);
      add(0.035, 0.1, 0.04, 0, -0.06, 0.02);
      break;
    case 'lmg':
      add(0.08, 0.13, 0.55, 0, 0.03, -0.15);
      add(0.045, 0.045, 0.45, 0, 0.05, -0.62);
      add(0.06, 0.12, 0.26, 0, 0.0, 0.22);
      add(0.1, 0.12, 0.12, 0.06, -0.06, -0.12);
      add(0.02, 0.2, 0.02, 0.05, -0.12, -0.72);
      add(0.02, 0.2, 0.02, -0.05, -0.12, -0.72);
      add(0.035, 0.1, 0.04, 0, -0.06, 0.02);
      break;
    case 'dmr':
    case 'sniper':
      add(0.06, 0.1, 0.55, 0, 0.03, -0.14);
      add(0.03, 0.03, model === 'sniper' ? 0.6 : 0.45, 0, 0.05, model === 'sniper' ? -0.72 : -0.64);
      add(0.06, 0.12, 0.3, 0, 0.0, 0.24);
      add(0.05, 0.05, 0.28, 0, 0.13, -0.12);
      add(0.04, 0.1, 0.06, 0, -0.06, -0.12);
      add(0.035, 0.1, 0.04, 0, -0.06, 0.02);
      break;
    case 'shotgun':
      add(0.06, 0.09, 0.4, 0, 0.03, -0.1);
      add(0.04, 0.04, 0.42, 0, 0.05, -0.5);
      add(0.05, 0.05, 0.2, 0, 0.0, -0.38);
      add(0.05, 0.1, 0.24, 0, 0.0, 0.2);
      add(0.035, 0.1, 0.04, 0, -0.06, 0.02);
      break;
    case 'pistol':
    case 'revolver':
      add(0.035, 0.05, 0.2, 0, 0.04, -0.07);
      add(0.03, 0.12, 0.05, 0, -0.03, 0.01);
      break;
    case 'launcher':
      add(0.12, 0.12, 1.1, 0, 0.08, -0.2);
      add(0.03, 0.12, 0.05, 0, -0.03, 0.0);
      add(0.05, 0.08, 0.1, 0.06, 0.16, -0.1);
      break;
    case 'medkit':
      add(0.22, 0.16, 0.08, 0, 0, -0.05);
      break;
    case 'binoculars':
      add(0.07, 0.07, 0.14, 0.045, 0, -0.07);
      add(0.07, 0.07, 0.14, -0.045, 0, -0.07);
      break;
    case 'tool':
      add(0.05, 0.05, 0.35, 0, 0.02, -0.15);
      add(0.12, 0.08, 0.06, 0, 0.02, -0.34);
      break;
    case 'grenade':
      add(0.07, 0.09, 0.07, 0, 0, -0.03);
      break;
    default:
      add(0.05, 0.05, 0.1, 0, 0, 0);
  }
  const merged = new THREE.BufferGeometry();
  const pos = [];
  const nor = [];
  const idx = [];
  for (const g of parts) {
    const b = pos.length / 3;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    for (const i of g.index.array) idx.push(b + i);
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  merged.setIndex(idx);
  return merged;
}

const WEAPON_MODEL_FOR = (id) => {
  const w = WEAPONS[id];
  if (!w) return 'rifle';
  if (w.model && w.model !== 'none') return w.model;
  if (id === 'medkit') return 'medkit';
  if (id === 'binoculars') return 'binoculars';
  if (id === 'repair' || id === 'ammobag' || id === 'charge') return 'tool';
  if (w.kind === 'throwable') return 'grenade';
  return 'rifle';
};
const WEAPON_MODELS = ['rifle', 'battle', 'smg', 'lmg', 'dmr', 'sniper', 'shotgun', 'pistol', 'revolver', 'launcher', 'medkit', 'binoculars', 'tool', 'grenade'];
const TWO_HANDED = new Set(['rifle', 'battle', 'smg', 'lmg', 'dmr', 'sniper', 'shotgun', 'launcher']);
// foregrip positions along the weapon (weapon local, forward is -z)
const FOREGRIP = { rifle: -0.32, battle: -0.36, smg: -0.2, lmg: -0.42, dmr: -0.36, sniper: -0.4, shotgun: -0.38, launcher: -0.45 };

const HEADGEAR = ['helmet', 'helmet_net', 'boonie', 'beanie', 'headset', 'beret', 'cap'];

function linColor(hex) {
  return new THREE.Color(hex);
}

export class SoldierRenderer {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);
    const mask = buildCamoMask();
    this.camoMat = camoMaterial(mask);
    this.gearMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    this.skinMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
    this.weaponMat = new THREE.MeshStandardMaterial({ color: 0x25272a, roughness: 0.5, metalness: 0.5 });
    const camoParts = {
      pelvis: box(0.34, 0.2, 0.22),
      torso: box(0.4, 0.5, 0.24, 0.25),
      upperArm: box(0.12, 0.3, 0.12, -0.15),
      forearm: box(0.11, 0.28, 0.11, -0.14),
      thigh: box(0.17, 0.43, 0.17, -0.21),
      shin: box(0.14, 0.41, 0.14, -0.2),
    };
    const gearParts = {
      vest: box(0.46, 0.34, 0.3, 0.26),
      pack: box(0.32, 0.38, 0.16, 0.28, 0.2),
      boot: box(0.14, 0.11, 0.26, -0.04, -0.05),
      band: box(0.13, 0.07, 0.13, -0.08),
      helmet: (() => {
        const g = new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 1.9);
        g.scale(1, 0.85, 1.12);
        g.translate(0, 0.07, 0);
        return g;
      })(),
      helmet_net: (() => {
        const g = new THREE.SphereGeometry(0.18, 8, 5, 0, Math.PI * 2, 0, Math.PI / 1.9);
        g.scale(1.05, 0.9, 1.15);
        g.translate(0, 0.07, 0);
        return g;
      })(),
      boonie: (() => {
        const g = new THREE.CylinderGeometry(0.15, 0.27, 0.13, 10);
        g.translate(0, 0.1, 0);
        return g;
      })(),
      beanie: box(0.23, 0.12, 0.24, 0.12),
      headset: (() => {
        const g = new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 1.9);
        g.scale(1, 0.85, 1.12);
        g.translate(0, 0.07, 0);
        const e1 = new THREE.BoxGeometry(0.05, 0.1, 0.1);
        e1.translate(0.13, 0.0, 0);
        const e2 = e1.clone();
        e2.translate(-0.26, 0, 0);
        const merged = new THREE.BufferGeometry();
        const geos = [g.toNonIndexed(), e1.toNonIndexed(), e2.toNonIndexed()];
        const pos = [];
        const nor = [];
        for (const x of geos) {
          pos.push(...x.attributes.position.array);
          nor.push(...x.attributes.normal.array);
        }
        merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        return merged;
      })(),
      beret: (() => {
        const g = new THREE.CylinderGeometry(0.15, 0.14, 0.06, 12);
        g.rotateZ(0.2);
        g.translate(-0.02, 0.16, 0);
        return g;
      })(),
      cap: (() => {
        const g = box(0.24, 0.1, 0.26, 0.15);
        const v = box(0.24, 0.02, 0.1, 0.1, -0.16);
        const merged = new THREE.BufferGeometry();
        const pos = [...g.toNonIndexed().attributes.position.array, ...v.toNonIndexed().attributes.position.array];
        const nor = [...g.toNonIndexed().attributes.normal.array, ...v.toNonIndexed().attributes.normal.array];
        merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        return merged;
      })(),
    };
    this.meshes = {};
    const mk = (name, geo, mat, count, camo = false) => {
      if (camo) {
        geo.setAttribute('camoB', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
        geo.setAttribute('camoC', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
      }
      const im = new THREE.InstancedMesh(geo, mat, count);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, new THREE.Color(1, 1, 1));
      im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = quality.shadows > 0;
      im.receiveShadow = false;
      im.frustumCulled = false;
      im.count = 0;
      this.group.add(im);
      this.meshes[name] = { im, n: 0, camo, cap: count };
      return im;
    };
    mk('pelvis', camoParts.pelvis, this.camoMat, MAX, true);
    mk('torso', camoParts.torso, this.camoMat, MAX, true);
    mk('upperArm', camoParts.upperArm, this.camoMat, MAX * 2, true);
    mk('forearm', camoParts.forearm, this.camoMat, MAX * 2, true);
    mk('thigh', camoParts.thigh, this.camoMat, MAX * 2, true);
    mk('shin', camoParts.shin, this.camoMat, MAX * 2, true);
    mk('vest', gearParts.vest, this.gearMat, MAX);
    mk('pack', gearParts.pack, this.gearMat, MAX);
    mk('boot', gearParts.boot, this.gearMat, MAX * 2);
    mk('band', gearParts.band, this.gearMat, MAX);
    mk('head', box(0.2, 0.24, 0.22, 0.1), this.skinMat, MAX);
    mk('hand', box(0.08, 0.09, 0.08, -0.03), this.skinMat, MAX * 2);
    for (const hg of HEADGEAR) mk(`hg_${hg}`, gearParts[hg], this.gearMat, MAX);
    for (const wm of WEAPON_MODELS) mk(`w_${wm}`, weaponGeometry(wm), this.weaponMat, MAX);
    this.state = new Map(); // per-soldier animation state
    this.colors = {};
    this.muzzle = [];
  }

  camoColors(camo, faction) {
    const key = `${camo}:${faction}`;
    if (this.colors[key]) return this.colors[key];
    const def = faction === FACTION.DOMINION ? DOMINION_CAMO : CAMOS[camo] || CAMOS.woodland;
    const cols = def.colors.map((c) => linColor(c));
    this.colors[key] = cols;
    return cols;
  }

  begin() {
    for (const m of Object.values(this.meshes)) m.n = 0;
  }

  put(name, matrix, color, camo) {
    const m = this.meshes[name];
    if (!m || m.n >= m.cap) return;
    const i = m.n++;
    m.im.setMatrixAt(i, matrix);
    if (color) m.im.setColorAt(i, color);
    if (m.camo && camo) {
      const b = m.im.geometry.attributes.camoB;
      const c = m.im.geometry.attributes.camoC;
      b.setXYZ(i, camo[1].r, camo[1].g, camo[1].b);
      c.setXYZ(i, camo[2].r, camo[2].g, camo[2].b);
    }
  }

  end() {
    for (const m of Object.values(this.meshes)) {
      m.im.count = m.n;
      m.im.instanceMatrix.needsUpdate = true;
      if (m.im.instanceColor) m.im.instanceColor.needsUpdate = true;
      if (m.camo) {
        m.im.geometry.attributes.camoB.needsUpdate = true;
        m.im.geometry.attributes.camoC.needsUpdate = true;
      }
    }
  }

  // Place a limb box (hangs along local -y) from joint a to joint b (world).
  limb(name, a, b, color, camo) {
    tmpV3.subVectors(b, a);
    const len = tmpV3.length() || 1;
    tmpV3.divideScalar(len);
    tmpQ.setFromUnitVectors(DOWN, tmpV3);
    tmpM.compose(a, tmpQ, ONE);
    this.put(name, tmpM, color, camo);
  }

  /**
   * Render all soldiers. list: [{e (interp state), info, isSelf, hidden}]
   */
  update(list, dt, time, camPos) {
    this.begin();
    const seen = new Set();
    for (const item of list) {
      const e = item.e;
      seen.add(e.id);
      let st = this.state.get(e.id);
      if (!st) {
        st = { phase: Math.random() * 6, deadT: 0, flinch: 0, kick: 0, crouch: e.stance === 1 ? 1 : 0, prone: e.stance === 2 ? 1 : 0, lean: 0, px: e.x, pz: e.z, speed: 0, skin: 0.55 + Math.random() * 0.4 };
        this.state.set(e.id, st);
      }
      if (item.hidden) continue;
      const d = Math.hypot(e.x - camPos.x, e.z - camPos.z);
      if (d > this.quality.draw * 0.55) continue;
      this.pose(e, item.info, st, dt, time, d);
    }
    for (const id of this.state.keys()) if (!seen.has(id)) this.state.delete(id);
    this.end();
  }

  flinch(id) {
    const st = this.state.get(id);
    if (st) st.flinch = 1;
  }

  kick(id) {
    const st = this.state.get(id);
    if (st) st.kick = 1;
  }

  pose(e, info, st, dt, time, dist) {
    const faction = e.faction;
    const camo = this.camoColors(info ? info.camo : 'woodland', faction);
    const gearCol = faction === FACTION.DOMINION ? tmpColor(0.09, 0.095, 0.1) : tmpColor(0.12, 0.13, 0.08);
    const bandCol = faction === FACTION.DOMINION ? tmpColor2(0.6, 0.05, 0.04) : tmpColor2(0.08, 0.2, 0.6);
    const skin = tmpColor3(st.skin * 0.95, st.skin * 0.72, st.skin * 0.58);
    // speed estimate from interpolated motion
    const sp = dt > 0 ? Math.hypot(e.x - st.px, e.z - st.pz) / dt : 0;
    st.px = e.x;
    st.pz = e.z;
    st.speed = lerp(st.speed, Math.min(sp, 9), Math.min(1, dt * 8));
    const moving = st.speed > 0.4;
    st.phase += dt * st.speed * (e.sprint ? 1.55 : 1.9);
    st.crouch = lerp(st.crouch, e.stance === STANCE.CROUCH ? 1 : 0, Math.min(1, dt * 10));
    st.prone = lerp(st.prone, e.stance === STANCE.PRONE || e.life === LIFE.DOWNED ? 1 : 0, Math.min(1, dt * 6));
    st.lean = lerp(st.lean, e.lean || 0, Math.min(1, dt * 10));
    st.flinch = Math.max(0, st.flinch - dt * 4);
    st.kick = Math.max(0, st.kick - dt * 12);
    if (e.life === LIFE.DEAD) st.deadT = Math.min(1, st.deadT + dt * 2.2);
    else st.deadT = 0;
    const seated = e.vehicle > 0 && e.seat !== 255;
    const wmodel = WEAPON_MODEL_FOR(WEAPON_CODES[e.weapon]);
    const emote = EMOTE_CODES[e.emote] || 'none';
    const detail = dist < 110;

    // ---------------- root & body
    const root = tmpRoot.makeRotationY(e.yaw).setPosition(e.x, e.y, e.z);
    const pelvis = tmpPelvis.copy(root);
    let pelvisY = lerp(0.95, 0.6, st.crouch);
    if (seated) pelvisY = 0.05;
    const bob = moving && !seated ? Math.abs(Math.sin(st.phase)) * 0.04 : Math.sin(time * 1.6 + e.id) * 0.006;
    E.set(0, 0, 0);
    if (st.deadT > 0) {
      // topple sideways then lie flat
      const t = st.deadT;
      pelvisY = lerp(pelvisY, 0.18, t);
      E.set(lerp(0, -Math.PI / 2, t), 0, lerp(0, 0.35, t));
    } else if (st.prone > 0.01) {
      pelvisY = lerp(pelvisY, 0.2, st.prone);
      E.set(-Math.PI / 2 * st.prone, 0, e.life === LIFE.DOWNED ? 0.25 * st.prone : 0);
    }
    tmpM2.makeRotationFromEuler(E);
    pelvis.multiply(tmpM.makeTranslation(st.lean * 0.12, pelvisY + bob, 0)).multiply(tmpM2);
    this.put('pelvis', pelvis, camo[0], camo);

    // ---------------- spine / torso
    const aimPitch = clamp(e.pitch || 0, -1.2, 1.2) * (1 - st.prone * 0.5);
    let spinePitch = -0.12 * st.crouch - (e.sprint ? 0.22 : 0) + aimPitch * 0.35 - st.flinch * 0.25;
    if (st.prone > 0.5) spinePitch = aimPitch * 0.5 + 0.25;
    const spine = tmpSpine.copy(pelvis).multiply(tmpM.makeTranslation(0, 0.08, 0));
    E.set(spinePitch, 0, -st.lean * 0.32);
    spine.multiply(tmpM2.makeRotationFromEuler(E));
    this.put('torso', spine, camo[0], camo);
    this.put('vest', spine, gearCol);
    if (!info || !info.vip) this.put('pack', spine, gearCol);
    // head
    const head = tmpHead.copy(spine).multiply(tmpM.makeTranslation(0, 0.52, 0));
    const headPitch = st.prone > 0.5 ? 1.2 + aimPitch * 0.5 : aimPitch * 0.55;
    E.set(headPitch, 0, 0);
    head.multiply(tmpM2.makeRotationFromEuler(E));
    this.put('head', head, skin);
    const hg = info && HEADGEAR.includes(info.hg) ? info.hg : 'helmet';
    const hgCol = hg === 'beret' ? tmpColor4(0.35, 0.05, 0.06) : hg === 'cap' ? tmpColor4(0.18, 0.2, 0.16) : hg === 'beanie' ? tmpColor4(0.08, 0.08, 0.08) : camo[1];
    this.put(`hg_${hg}`, tmpM.copy(head).multiply(tmpM2.makeTranslation(0, 0.12, 0)), hgCol);

    // ---------------- arms
    // shoulders in world space
    const shR = tmpV.set(0.25, 0.44, 0).applyMatrix4(spine).clone();
    const shL = tmpV.set(-0.25, 0.44, 0).applyMatrix4(spine).clone();
    let handR;
    let handL;
    let weaponM = null;
    const carrying = e.carrying;
    const holding = !seated || e.seat === 0 ? false : true;
    void holding;
    if (st.deadT > 0 || e.life === LIFE.DOWNED) {
      handR = tmpV.set(0.35, 0.1, -0.35).applyMatrix4(spine).clone();
      handL = tmpV.set(-0.4, 0.2, -0.2).applyMatrix4(spine).clone();
    } else if (emote !== 'none') {
      const wave = Math.sin(time * 9) * 0.12;
      const poses = {
        salute: [[0.14, 0.64, -0.12], [-0.3, 0.02, 0.02]],
        attention: [[0.3, 0.0, 0.02], [-0.3, 0.0, 0.02]],
        wave: [[0.38 + wave, 0.95, -0.1], [-0.3, 0.02, 0.02]],
        point: [[0.22, 0.5, -0.66], [-0.3, 0.02, 0.02]],
        at_ease: [[0.1, 0.18, 0.2], [-0.1, 0.18, 0.2]],
        cheer: [[0.3, 0.98 + wave * 0.5, -0.05], [-0.3, 0.98 - wave * 0.5, -0.05]],
      };
      const p = poses[emote] || poses.attention;
      handR = tmpV.set(...p[0]).applyMatrix4(spine).clone();
      handL = tmpV.set(...p[1]).applyMatrix4(spine).clone();
    } else if (carrying) {
      handR = tmpV.set(0.2, 0.2, -0.36).applyMatrix4(spine).clone();
      handL = tmpV.set(-0.2, 0.2, -0.36).applyMatrix4(spine).clone();
    } else if (e.activity === 2) {
      // talking: gestures
      handR = tmpV.set(0.22 + Math.sin(time * 3 + e.id) * 0.08, 0.3 + Math.sin(time * 2.2 + e.id) * 0.1, -0.3).applyMatrix4(spine).clone();
      handL = tmpV.set(-0.3, 0.02, 0.02).applyMatrix4(spine).clone();
    } else if (e.activity === 3) {
      handR = tmpV.set(0.15 + Math.sin(time * 6) * 0.05, 0.05, -0.5).applyMatrix4(spine).clone();
      handL = tmpV.set(-0.15, 0.05, -0.48).applyMatrix4(spine).clone();
    } else {
      // weapon frame in spine space
      const two = TWO_HANDED.has(wmodel);
      const ads = e.ads;
      const sprint = e.sprint && moving;
      let wx = two ? 0.12 : 0.18;
      let wy = ads ? 0.46 : 0.36;
      let wz = two ? -0.3 : -0.42;
      let wpitch = aimPitch * 0.65;
      let wyaw = 0;
      if (sprint || e.activity === 6) {
        wy = 0.3;
        wz = -0.26;
        wpitch = -0.5;
        wyaw = 0.7;
        wx = 0.05;
      }
      if (e.activity === 1) {
        wpitch = -0.6;
        wy = 0.25;
      }
      if (seated && e.seat === 0) {
        wpitch = -1.2;
        wy = 0.2;
      }
      if (st.prone > 0.5) {
        wy = 0.42;
        wz = -0.34;
      }
      if (e.reloading) wpitch -= 0.35;
      wz += st.kick * 0.06;
      const W = tmpW.copy(spine).multiply(tmpM.makeTranslation(wx, wy, wz));
      E.set(wpitch, wyaw, 0);
      W.multiply(tmpM2.makeRotationFromEuler(E));
      weaponM = W;
      handR = tmpV.set(0, -0.04, 0).applyMatrix4(W).clone();
      if (two) {
        const fg = FOREGRIP[wmodel] ?? -0.3;
        handL = e.reloading ? tmpV.set(0, -0.12, -0.12 + Math.sin(time * 8) * 0.04).applyMatrix4(W).clone() : tmpV.set(0, -0.03, fg).applyMatrix4(W).clone();
      } else if (wmodel === 'pistol' || wmodel === 'revolver') {
        handL = tmpV.set(-0.03, -0.06, 0.02).applyMatrix4(W).clone();
      } else {
        handL = tmpV.set(-0.3, 0.05, 0).applyMatrix4(spine).clone();
      }
    }
    // swing arms when not holding anything specific (sprinting unarmed etc.)
    this.arm(shR, handR, spine, 1, camo, detail, skin);
    this.arm(shL, handL, spine, -1, camo, detail, skin);
    if (weaponM && !seated) {
      this.put(`w_${wmodel}`, weaponM, null);
      if (e.firing && detail && Math.sin(time * 60 + e.id) > 0.3) this.muzzle.push(tmpV.set(0, 0.05, -0.9).applyMatrix4(weaponM).clone());
    } else if (weaponM && seated && e.seat !== 0) {
      this.put(`w_${wmodel}`, weaponM, null);
    }
    // armband on left upper arm
    const bandPos = tmpV.lerpVectors(shL, handL, 0.12);
    tmpM.makeRotationY(e.yaw).setPosition(bandPos);
    this.put('band', tmpM, bandCol);

    // ---------------- legs
    const legPhase = st.phase;
    const amp = moving && !seated ? (e.sprint ? 0.9 : 0.55) * (1 - st.prone * 0.8) : 0;
    for (const side of [1, -1]) {
      const ph = side > 0 ? legPhase : legPhase + Math.PI;
      let thighX = Math.sin(ph) * amp;
      let shinX = -Math.max(0, Math.sin(ph - 0.9)) * amp * 1.3;
      if (st.crouch > 0.01) {
        thighX = lerp(thighX, 1.25 + Math.sin(ph) * amp * 0.4, st.crouch);
        shinX = lerp(shinX, -1.9 + (side > 0 ? 0 : 0.3), st.crouch);
      }
      if (seated) {
        thighX = 1.45;
        shinX = -1.4;
      }
      if (st.prone > 0.5) {
        thighX = Math.sin(ph) * amp * 0.3;
        shinX = -0.1;
      }
      const hip = tmpHip.copy(pelvis).multiply(tmpM.makeTranslation(0.1 * side, -0.02, 0));
      E.set(thighX, 0, side * 0.03);
      hip.multiply(tmpM2.makeRotationFromEuler(E));
      this.put('thigh', hip, camo[0], camo);
      const knee = tmpKnee.copy(hip).multiply(tmpM.makeTranslation(0, -0.43, 0));
      E.set(shinX, 0, 0);
      knee.multiply(tmpM2.makeRotationFromEuler(E));
      this.put('shin', knee, camo[0], camo);
      this.put('boot', tmpM.copy(knee).multiply(tmpM2.makeTranslation(0, -0.41, 0)), gearCol);
    }
  }

  arm(sh, hand, spine, side, camo, detail, skin) {
    const L1 = 0.3;
    const L2 = 0.3;
    const d = tmpV2.subVectors(hand, sh);
    let len = d.length();
    const maxLen = L1 + L2 - 0.001;
    if (len > maxLen) {
      d.multiplyScalar(maxLen / len);
      hand = tmpV3.copy(sh).add(d).clone();
      len = maxLen;
    }
    // elbow: bend outward/down using a pole vector
    const a = (L1 * L1 - L2 * L2 + len * len) / (2 * len);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const dir = d.clone().normalize();
    const pole = new THREE.Vector3(side * 0.6, -1, 0.2).transformDirection(spine);
    const perp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const elbow = sh.clone().addScaledVector(dir, a).addScaledVector(perp, h);
    this.limb('upperArm', sh, elbow, camo[0], camo);
    this.limb('forearm', elbow, hand, camo[0], camo);
    if (detail) {
      tmpQ.setFromUnitVectors(DOWN, tmpV3.subVectors(hand, elbow).normalize());
      tmpM.compose(hand, tmpQ, ONE);
      this.put('hand', tmpM, skin);
    }
  }

  takeMuzzleFlashes() {
    const m = this.muzzle;
    this.muzzle = [];
    return m;
  }
}

const tmpRoot = new THREE.Matrix4();
const tmpPelvis = new THREE.Matrix4();
const tmpSpine = new THREE.Matrix4();
const tmpHead = new THREE.Matrix4();
const tmpHip = new THREE.Matrix4();
const tmpKnee = new THREE.Matrix4();
const tmpW = new THREE.Matrix4();
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _c3 = new THREE.Color();
const _c4 = new THREE.Color();
function tmpColor(r, g, b) {
  return _c1.setRGB(r, g, b);
}
function tmpColor2(r, g, b) {
  return _c2.setRGB(r, g, b);
}
function tmpColor3(r, g, b) {
  return _c3.setRGB(r, g, b);
}
function tmpColor4(r, g, b) {
  return _c4.setRGB(r, g, b);
}

export { WEAPON_MODEL_FOR };
