// Local player: predicted movement, weapons, gadgets, interactions, vehicles
// and camera. Sends intents to the authoritative simulation and reconciles
// with its corrections.
import * as THREE from 'three';
import { STANCE, LIFE, STAMINA, BODY, FACTION, PROP_KIND, SEA_LEVEL, ENTITY } from '../../shared/constants.js';
import { WEAPONS, computeSpread } from '../../shared/config/weapons.js';
import { VEHICLES } from '../../shared/config/vehicles.js';
import { stepCharacter, stepVehicle, eyeHeight, seatWorld } from '../../shared/physics.js';
import { raySoldier, rayVehicle, pelletDirs, spreadDir, VEHICLE_CODES, WEAPON_CODES } from '../../shared/combat.js';
import { MSG } from '../../shared/protocol.js';
import { clamp, dirFromYawPitch, lerp, wrapAngle, yawFromDir, dist3 } from '../../shared/math.js';
import { MAT_INFO } from '../../shared/world/materials.js';
import { TMAT } from '../../shared/world/terrain.js';

const DEG = Math.PI / 180;
const SEND_INTERVAL = 0.05;

export class LocalPlayer {
  constructor(app) {
    this.app = app;
    this.id = 0; // entity id
    this.alive = false;
    this.pos = { x: 0, y: 0, z: 0 };
    this.s = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, stance: STANCE.STAND, grounded: true };
    this.yaw = 0;
    this.pitch = 0;
    this.lean = 0;
    this.sprint = false;
    this.ads = false;
    this.adsT = 0;
    this.stamina = STAMINA.max;
    this.staminaDelay = 0;
    this.weapons = [];
    this.slot = 0;
    this.reloadUntil = 0;
    this.switchUntil = 0;
    this.nextFireAt = 0;
    this.burst = 0;
    this.bloom = 0;
    this.recoilP = 0;
    this.recoilY = 0;
    this.suppression = 0;
    this.seq = 1;
    this.fireSeq = 1;
    this.sendAcc = 0;
    this.firstPerson = false;
    this.health = 100;
    this.armor = 0;
    this.life = LIFE.ALIVE;
    this.vehicle = 0;
    this.seat = -1;
    this.veh = null; // predicted driven vehicle state
    this.interact = null;
    this.cookStart = 0;
    this.actionHeld = null;
    this.stepAcc = 0;
    this.camOrbit = 0;
    this.camPitchV = 0.15;
    this.shake = 0;
    this.fovKick = 0;
    this.lastSentVs = 0;
    this.role = 'rifleman';
    this.redeployHold = 0;
    this.fireMode = 'auto';
    this.landVel = 0;
  }

  get weapon() {
    return this.weapons[this.slot] || null;
  }
  get wdef() {
    const w = this.weapon;
    return w ? WEAPONS[w.id] : null;
  }
  get now() {
    return performance.now() / 1000;
  }

  // ------------------------------------------------------------------ server messages
  onSpawned(msg) {
    this.id = msg.id;
    this.alive = true;
    this.life = LIFE.ALIVE;
    this.s.x = msg.p[0];
    this.s.y = msg.p[1];
    this.s.z = msg.p[2];
    this.s.vx = this.s.vy = this.s.vz = 0;
    this.s.stance = STANCE.STAND;
    this.yaw = msg.yaw;
    this.pitch = 0;
    this.stamina = STAMINA.max;
    this.vehicle = 0;
    this.seat = -1;
    this.veh = null;
    this.role = msg.role;
    this.ads = false;
    this.reloadUntil = 0;
    this.bloom = 0;
    this.suppression = 0;
  }

  onLoadout(msg) {
    this.weapons = msg.weapons;
    if (msg.slot !== undefined && this.now > this.switchUntil) this.slot = msg.slot;
    this.armor = msg.armor;
    this.maxArmor = msg.maxArmor;
    if (this.slot >= this.weapons.length) this.slot = 0;
  }

  onCorrect(msg) {
    if (msg.v) {
      if (this.veh && this.veh.id === msg.v) {
        this.veh.x = msg.p[0];
        this.veh.y = msg.p[1];
        this.veh.z = msg.p[2];
        this.veh.yaw = msg.yaw;
        this.veh.speed = 0;
      }
      return;
    }
    this.s.x = msg.p[0];
    this.s.y = msg.p[1];
    this.s.z = msg.p[2];
    this.s.vx = this.s.vz = 0;
  }

  onVehicleNotice(msg) {
    if (msg.id) {
      this.vehicle = msg.id;
      this.seat = msg.seat;
      this.veh = null;
      this.sprint = false;
      this.ads = false;
      const e = this.app.cw.ents.get(msg.id);
      if (e && msg.seat === 0) {
        const st = e.latest;
        const def = VEHICLES[VEHICLE_CODES[st.type]];
        this.veh = { id: msg.id, def, x: st.x, y: st.y, z: st.z, yaw: st.yaw, pitch: st.pitch, roll: st.roll, speed: 0, vy: 0, engine: true };
      }
      this.camOrbit = 0;
    } else {
      this.vehicle = 0;
      this.seat = -1;
      this.veh = null;
      if (msg.p) {
        this.s.x = msg.p[0];
        this.s.y = msg.p[1];
        this.s.z = msg.p[2];
        this.s.vx = this.s.vy = this.s.vz = 0;
      }
    }
  }

  // Sync authoritative fields from our own snapshot entry.
  syncFromSnapshot(me) {
    if (!me) return;
    this.health = me.health;
    this.life = me.life;
    if (me.armor !== undefined) this.armor = me.armor;
    if (me.life === LIFE.DOWNED) this.s.stance = STANCE.PRONE;
    if (me.vehicle && !this.vehicle) this.onVehicleNotice({ id: me.vehicle, seat: me.seat });
    if (!me.vehicle && this.vehicle) this.onVehicleNotice({ id: 0 });
    if (this.vehicle && me.vehicle) {
      this.seat = me.seat;
      if (this.seat !== 0) this.veh = null;
      else if (!this.veh) this.onVehicleNotice({ id: me.vehicle, seat: 0 });
      if (this.seat !== 0 || !this.veh) {
        this.s.x = me.x;
        this.s.y = me.y;
        this.s.z = me.z;
      }
    }
  }

  // ------------------------------------------------------------------ update
  update(dt, input) {
    const app = this.app;
    if (!this.id || !this.alive) return;
    const lookScale = this.ads ? (this.wdef && this.wdef.adsFov ? this.wdef.adsFov / 72 : 0.7) : 1;
    const lk = input.look(lookScale);
    if (this.vehicle && this.seat === 0 && this.veh && !this.veh.def.air) {
      this.camOrbit = wrapAngle(this.camOrbit - lk.dx);
      this.camPitchV = clamp(this.camPitchV - lk.dy, -0.4, 1.0);
    } else {
      this.yaw = wrapAngle(this.yaw - lk.dx);
      this.pitch = clamp(this.pitch - lk.dy, -1.45, 1.45);
    }
    // recoil recovery
    const w = this.wdef;
    if (this.recoilP > 0) {
      const rec = Math.min(this.recoilP, dt * (w ? w.recoilRecover || 7 : 7) * DEG * 3);
      this.recoilP -= rec;
      this.pitch -= rec * 0.6;
    }
    this.bloom = Math.max(0, this.bloom - dt * (w ? w.bloomRecover || 6 : 6));
    this.suppression = Math.max(0, this.suppression - dt * 0.4);
    this.shake = Math.max(0, this.shake - dt * 3);

    if (input.pressed('camera')) this.firstPerson = !this.firstPerson;
    if (this.vehicle) this.updateVehicle(dt, input);
    else this.updateOnFoot(dt, input);
    this.sendAcc += dt;
    if (this.sendAcc >= SEND_INTERVAL) {
      this.sendAcc = 0;
      this.sendInput(input);
    }
    app.hud.setInteract(this.interact);
  }

  updateOnFoot(dt, input) {
    const app = this.app;
    const s = this.s;
    const now = this.now;
    const downed = this.life === LIFE.DOWNED;
    const w = this.wdef;
    // stance
    if (!downed) {
      if (input.pressed('crouch')) s.stance = s.stance === STANCE.CROUCH ? STANCE.STAND : STANCE.CROUCH;
      if (input.pressed('prone')) s.stance = s.stance === STANCE.PRONE ? STANCE.CROUCH : STANCE.PRONE;
      if (input.pressed('jump') && s.stance !== STANCE.STAND) s.stance = STANCE.STAND;
    } else s.stance = STANCE.PRONE;
    const mv = input.move();
    const moving = Math.hypot(mv.fwd, mv.right) > 0.1;
    // sprint & stamina
    const wantSprint = input.isDown('sprint') && mv.fwd > 0.3 && !downed && !input.isDown('fire');
    if (wantSprint && s.stance !== STANCE.STAND && s.stance !== STANCE.PRONE) s.stance = STANCE.STAND;
    this.sprint = wantSprint && s.stance === STANCE.STAND && this.stamina > (this.sprint ? 0 : STAMINA.minToSprint) && !this.carrying;
    if (this.sprint) {
      this.stamina = Math.max(0, this.stamina - STAMINA.sprintDrain * dt);
      this.staminaDelay = STAMINA.regenDelay;
      if (this.reloadUntil > now) this.sprint = true;
    } else if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else this.stamina = Math.min(STAMINA.max, this.stamina + STAMINA.regen * dt);
    // ADS
    const canAds = !this.sprint && !downed && w && (w.kind === 'gun' || w.kind === 'launcher' || w.id === 'binoculars');
    this.ads = canAds && input.isDown('aim');
    this.adsT = lerp(this.adsT, this.ads ? 1 : 0, Math.min(1, dt * 12));
    // lean
    const leanTarget = downed || this.sprint || s.stance === STANCE.PRONE ? 0 : input.isDown('leanL') ? -1 : input.isDown('leanR') ? 1 : 0;
    this.lean = lerp(this.lean, leanTarget, Math.min(1, dt * 10));
    // jump
    let jump = false;
    if (input.pressed('jump') && s.grounded && s.stance === STANCE.STAND && this.stamina > STAMINA.jumpCost && !downed) {
      jump = true;
      this.stamina -= STAMINA.jumpCost;
      this.staminaDelay = STAMINA.regenDelay;
    }
    s.yaw = this.yaw;
    const prevVy = s.vy;
    // sub-step so slow frames cannot tunnel through thin walls
    const steps = Math.ceil(dt / 0.034);
    const inp = { fwd: mv.fwd, right: mv.right, sprint: this.sprint, jump, ads: this.ads, downed, carrying: this.carrying };
    for (let i = 0; i < steps; i++) {
      stepCharacter(s, inp, dt / steps, app.world.colliders);
      inp.jump = false;
    }
    if (s.grounded && prevVy < -13) this.landVel = prevVy;
    this.swimming = s.swimming;
    // footsteps
    const hs = Math.hypot(s.vx, s.vz);
    if (s.grounded && hs > 1) {
      this.stepAcc += hs * dt;
      const stride = this.sprint ? 2.4 : s.stance === STANCE.CROUCH ? 1.4 : 1.9;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        app.audio.footstep(s, this.surface(), this.sprint ? 1.3 : s.stance === STANCE.STAND ? 1 : 0.5, true);
      }
    }
    // weapons
    this.handleWeapons(dt, input, downed);
    // interactions
    this.updateInteract(input, downed);
    // emote
    if (input.pressed('emote') && !moving) app.send({ t: MSG.EMOTE, id: 'salute' });
    // spot
    if (input.pressed('spot')) {
      const d = this.aimDir();
      app.send({ t: MSG.GADGET, g: 'spot', d: [d.x, d.y, d.z] });
    }
    // redeploy / give up (hold X)
    if (input.isDown('redeploy')) {
      this.redeployHold += dt;
      app.hud.setHold('redeploy', this.redeployHold / 1.2, downed ? 'Giving up' : 'Redeploying');
      if (this.redeployHold > 1.2) {
        this.redeployHold = -99;
        app.send({ t: MSG.RETURN });
      }
    } else if (this.redeployHold !== 0) {
      this.redeployHold = 0;
      app.hud.setHold(null);
    }
  }

  surface() {
    const app = this.app;
    const s = this.s;
    const t = app.world.terrain;
    const g = t.heightAt(s.x, s.z);
    if (s.y < SEA_LEVEL + 0.2 && g < SEA_LEVEL) return 'water';
    if (s.y - g > 0.1) {
      const hit = app.world.colliders.raycast(s.x, s.y + 0.3, s.z, 0, -1, 0, 1);
      if (hit && !hit.terrain) {
        const info = MAT_INFO[hit.mat];
        return info ? info.surface : 'concrete';
      }
    }
    const m = t.materialAt(s.x, s.z);
    if (m === TMAT.ROAD || m === TMAT.CONCRETE) return 'concrete';
    if (m === TMAT.SNOW || m === TMAT.ICE) return 'snow';
    return 'dirt';
  }

  eye() {
    const s = this.s;
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    return { x: s.x + rx * this.lean * 0.35, y: s.y + eyeHeight(s.stance), z: s.z + rz * this.lean * 0.35 };
  }

  aimDir() {
    return dirFromYawPitch(this.yaw, this.pitch + this.recoilP * 0.4);
  }

  // ------------------------------------------------------------------ weapons
  handleWeapons(dt, input, downed) {
    const app = this.app;
    const now = this.now;
    // slot switching
    const slots = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5'];
    let want = -1;
    slots.forEach((a, i) => {
      if (input.pressed(a) && this.weapons[i]) want = i;
    });
    if (input.wheel) want = (this.slot + (input.wheel > 0 ? 1 : this.weapons.length - 1)) % Math.max(1, this.weapons.length);
    if (input.touch && input.touch.pressed('slot2')) want = (this.slot + 1) % Math.max(1, this.weapons.length);
    if (want >= 0 && want !== this.slot && !downed) {
      this.slot = want;
      const w = WEAPONS[this.weapons[want].id];
      this.switchUntil = now + (w ? w.equipTime || 0.4 : 0.4);
      this.reloadUntil = 0;
      this.burst = 0;
      app.send({ t: MSG.SWITCH, slot: want });
      app.audio.reload(0);
    }
    const ws = this.weapon;
    const w = this.wdef;
    if (!ws || !w || downed || this.swimming) return;
    if (input.pressed('firemode') && w.auto) {
      this.fireMode = this.fireMode === 'auto' ? 'semi' : 'auto';
      app.hud.toast(`Fire mode: ${this.fireMode.toUpperCase()}`);
    }
    // reload
    const reloadable = w.kind === 'gun' || w.kind === 'launcher';
    if (reloadable && input.pressed('reload') && ws.mag < w.mag && ws.reserve > 0 && this.reloadUntil <= now) this.startReload();
    if (this.reloadUntil && now >= this.reloadUntil) {
      const take = Math.min(w.mag - ws.mag, ws.reserve);
      ws.mag += take;
      ws.reserve -= take;
      this.reloadUntil = 0;
      app.audio.reload(1);
    }
    // grenades: G cooks while held, throws on release
    const nadeSlot = this.weapons.findIndex((x) => WEAPONS[x.id] && WEAPONS[x.id].kind === 'throwable' && x.count > 0);
    if (input.pressed('grenade') && nadeSlot >= 0 && !this.carrying) this.cookStart = now;
    if (this.cookStart && (input.released('grenade') || now - this.cookStart > 3.0)) {
      const cook = now - this.cookStart;
      this.cookStart = 0;
      if (nadeSlot >= 0) {
        const d = dirFromYawPitch(this.yaw, this.pitch + 0.12);
        app.send({ t: MSG.THROW, slot: nadeSlot, d: [d.x, d.y, d.z], cook: Math.min(cook, 2.8) });
        this.weapons[nadeSlot].count--;
        app.audio.reload(0);
      }
    }
    if (this.sprint || this.carrying) {
      this.burst = 0;
      return;
    }
    if (now < this.switchUntil) return;
    const fireDown = input.isDown('fire');
    const firePressed = input.pressed('fire');
    if (w.kind === 'gadget') {
      if (firePressed) this.useGadget(w, ws);
      return;
    }
    if (w.kind === 'throwable') {
      if (firePressed && ws.count > 0) {
        const d = dirFromYawPitch(this.yaw, this.pitch + 0.12);
        app.send({ t: MSG.THROW, slot: this.slot, d: [d.x, d.y, d.z], cook: 0 });
        ws.count--;
      }
      return;
    }
    if (this.reloadUntil > now) return;
    if (ws.mag <= 0) {
      if (firePressed) {
        app.audio.dryFire();
        if (ws.reserve > 0) this.startReload();
      }
      return;
    }
    const auto = w.auto && this.fireMode === 'auto';
    let shoot = false;
    if (w.burst) {
      if (firePressed && this.burst <= 0 && now >= this.nextFireAt) this.burst = w.burst;
      shoot = this.burst > 0 && now >= this.nextFireAt;
    } else if (auto) shoot = fireDown && now >= this.nextFireAt;
    else shoot = firePressed && now >= this.nextFireAt;
    if (shoot) this.fire(w, ws);
  }

  startReload() {
    const w = this.wdef;
    if (!w) return;
    this.reloadUntil = this.now + w.reload;
    this.app.send({ t: MSG.RELOAD });
    this.app.audio.reload(0);
    this.burst = 0;
  }

  fire(w, ws) {
    const app = this.app;
    const now = this.now;
    const interval = 60 / w.rpm;
    this.nextFireAt = now + interval;
    if (w.burst) {
      this.burst--;
      if (this.burst <= 0) this.nextFireAt = now + interval + 0.28;
    }
    ws.mag--;
    const s = this.s;
    const eye = this.eye();
    // aim point: what the crosshair looks at (from the camera)
    const cam = app.camera;
    const cd = new THREE.Vector3();
    cam.getWorldDirection(cd);
    const range = w.range || 300;
    const camHit = app.raycastScene(cam.position, cd, range, { ignore: this.id });
    const target = camHit ? camHit.point : { x: cam.position.x + cd.x * range, y: cam.position.y + cd.y * range, z: cam.position.z + cd.z * range };
    const fwd = dirFromYawPitch(this.yaw, this.pitch);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const muzzle = { x: eye.x + fwd.x * 0.7 + rx * 0.12, y: eye.y - 0.12 + fwd.y * 0.7, z: eye.z + fwd.z * 0.7 + rz * 0.12 };
    let d = { x: target.x - muzzle.x, y: target.y - muzzle.y, z: target.z - muzzle.z };
    const dl = Math.hypot(d.x, d.y, d.z) || 1;
    d = { x: d.x / dl, y: d.y / dl, z: d.z / dl };
    // keep the shot within a sane cone of the aim (server validates this too)
    const ad = fwd.x * d.x + fwd.y * d.y + fwd.z * d.z;
    if (ad < Math.cos(10 * DEG)) d = fwd;
    const spread = computeSpread(w, { ads: this.ads, speed: Math.hypot(s.vx, s.vz), stance: s.stance, grounded: s.grounded, bloom: this.bloom, suppression: this.suppression });
    const seq = this.fireSeq++;
    const dirs = w.pellets > 1 ? pelletDirs(d, w.pellets, w.spreadHip * 0.8, (seq >>> 0) ^ this.id) : [spreadDir(d, spread, Math.random)];
    const sendDir = w.pellets > 1 ? d : dirs[0];
    app.send({ t: MSG.FIRE, slot: this.slot, o: [r3(muzzle.x), r3(muzzle.y), r3(muzzle.z)], d: [r4(sendDir.x), r4(sendDir.y), r4(sendDir.z)], y: r3(this.yaw), pi: r3(this.pitch), seq });
    // local feedback
    this.bloom = Math.min(w.bloomMax, this.bloom + w.bloomPerShot);
    const kick = w.recoilV * (this.ads ? 0.75 : 1) * (s.stance === STANCE.PRONE ? 0.6 : s.stance === STANCE.CROUCH ? 0.85 : 1) * DEG;
    this.recoilP += kick * 0.5;
    this.pitch = clamp(this.pitch + kick, -1.45, 1.45);
    this.yaw += (Math.random() - 0.5) * w.recoilH * DEG * 2;
    this.shake = Math.min(1, this.shake + (w.cls === 'sniper' || w.cls === 'shotgun' ? 0.5 : 0.12));
    app.audio.gunshot(w.sound || 'rifle', muzzle, true);
    app.effects.muzzle(muzzle, fwd, w.kind === 'launcher');
    app.soldiers.kick(this.id);
    if (w.kind === 'launcher') return;
    for (const pd of dirs) {
      const hit = app.raycastScene(muzzle, pd, range, { ignore: this.id });
      const end = hit ? hit.point : { x: muzzle.x + pd.x * range, y: muzzle.y + pd.y * range, z: muzzle.z + pd.z * range };
      if (Math.random() < 1 / (w.tracerEvery || 3) || w.pellets > 1) app.effects.tracer(muzzle, end);
      if (hit) {
        app.effects.impact(end, hit.kind, hit.mat);
        app.audio.impact(end, hit.kind);
      }
    }
    if (ws.mag <= 0 && ws.reserve > 0) setTimeout(() => {
      if (this.weapon === ws && this.reloadUntil <= this.now) this.startReload();
    }, 250);
  }

  useGadget(w, ws) {
    const app = this.app;
    if (w.id === 'ammobag') {
      if (ws.count > 0) app.send({ t: MSG.GADGET, g: 'ammobag' });
    } else if (w.id === 'binoculars') {
      const d = this.aimDir();
      app.send({ t: MSG.GADGET, g: 'spot', d: [d.x, d.y, d.z] });
    } else if (w.id === 'medkit') {
      // heal the soldier in front, or yourself
      const tgt = this.interact && (this.interact.type === 'heal' || this.interact.type === 'revive') ? this.interact.id : this.id;
      app.send({ t: MSG.ACTION, a: 'start', type: this.interact && this.interact.type === 'revive' ? 'revive' : 'heal', target: tgt });
      this.actionHeld = 'fire';
    } else if (w.id === 'repair' || w.id === 'charge') {
      if (this.interact && (this.interact.type === 'repair' || this.interact.type === 'plant')) {
        app.send({ t: MSG.ACTION, a: 'start', type: this.interact.type, target: this.interact.id });
        this.actionHeld = 'fire';
      }
    }
  }

  // ------------------------------------------------------------------ interactions
  updateInteract(input, downed) {
    const app = this.app;
    const s = this.s;
    this.interact = downed ? null : this.findInteract();
    const it = this.interact;
    if (it && input.pressed('interact')) {
      if (it.type === 'enter') app.send({ t: MSG.VEHICLE, a: 'enter', id: it.id });
      else if (it.type === 'load' || it.type === 'unload' || it.type === 'drop') app.send({ t: MSG.ACTION, a: 'start', type: it.type, target: it.id || 0 });
      else if (it.type === 'board') app.menu.open('missions');
      else if (it.type === 'armory') app.send({ t: MSG.RETURN });
      else {
        app.send({ t: MSG.ACTION, a: 'start', type: it.type, target: it.id });
        this.actionHeld = 'interact';
      }
    }
    if (this.actionHeld && input.released(this.actionHeld)) {
      app.send({ t: MSG.ACTION, a: 'stop' });
      this.actionHeld = null;
    }
    // drop a carried crate with G
    if (this.carrying && input.pressed('grenade')) app.send({ t: MSG.ACTION, a: 'start', type: 'drop' });
    void s;
  }

  findInteract() {
    const app = this.app;
    const s = this.s;
    const f = app.store.get('faction');
    const fwd = dirFromYawPitch(this.yaw, 0);
    let best = null;
    let bs = Infinity;
    const consider = (type, id, x, y, z, range, label, hold = true) => {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d > range || Math.abs(y - s.y) > 3) return;
      const facing = ((x - s.x) * fwd.x + (z - s.z) * fwd.z) / (d || 1);
      const score = d - facing * 1.5;
      if (score < bs) {
        bs = score;
        best = { type, id, label, hold };
      }
    };
    const has = (id) => this.weapons.some((w) => w.id === id && (w.count === undefined || w.count > 0 || w.mag > 0 || WEAPONS[id].kind === 'gadget'));
    const hasMedkit = this.weapons.some((w) => w.id === 'medkit' && w.count > 0);
    for (const e of app.cw.ents.values()) {
      const st = e.latest;
      if (!st || e.id === this.id) continue;
      if (e.k === ENTITY.SOLDIER) {
        if (st.faction !== f || st.vehicle) continue;
        const info = app.cw.infos.get(e.id) || {};
        const name = info.name || 'soldier';
        if (st.life === LIFE.DOWNED) consider('revive', e.id, st.x, st.y, st.z, 2.6, `Revive ${name}`);
        else if (st.captive) consider('rescue', e.id, st.x, st.y, st.z, 2.6, `Free ${name}`);
        else if (hasMedkit && st.life === LIFE.ALIVE && st.health < 95 && !st.ambient) consider('heal', e.id, st.x, st.y, st.z, 3, `Heal ${name}`);
      } else if (e.k === ENTITY.VEHICLE) {
        const def = VEHICLES[VEHICLE_CODES[st.type]];
        if (!def || (st.state & 7) === 3) continue;
        const r = Math.max(def.halfSize[0], def.halfSize[2]) + 2.5;
        if (st.faction === f) {
          if (this.carrying && def.cargo) consider('load', e.id, st.x, st.y, st.z, r, 'Load crate', false);
          else if (!this.carrying && def.cargo && st.cargo > 0) consider('unload', e.id, st.x, st.y, st.z, r - 0.5, `Unload crate (${st.cargo})`, false);
          if (!this.carrying) consider('enter', e.id, st.x, st.y, st.z, r, `Enter ${def.name}`, false);
          if (has('repair') && st.health < 250) consider('repair', e.id, st.x, st.y, st.z, r + 1, `Repair ${def.name}`);
        } else if (has('charge')) consider('plant', e.id, st.x, st.y, st.z, r + 1, `Plant charge on ${def.name}`);
      } else if (e.k === ENTITY.PROP) {
        if (st.type === PROP_KIND.SUPPLY_CRATE && !this.carrying && (!st.faction || st.faction === f)) consider('pickup', e.id, st.x, st.y, st.z, 2.6, 'Pick up supplies');
        if (st.type === PROP_KIND.TARGET && st.faction !== f && st.health > 0 && has('charge')) consider('plant', e.id, st.x, st.y, st.z, 3.5, 'Plant demolition charge');
      }
    }
    if (this.carrying && !best) best = { type: 'drop', id: 0, label: 'Drop crate (G)', hold: false };
    // base facilities
    const base = app.world.bases[f];
    if (base && !best) {
      for (const m of base.markers) {
        if (m.type === 'mission_board') consider('board', 0, m.x, m.y, m.z, 3, 'Mission board', false);
        if (m.type === 'armory') consider('armory', 0, m.x, m.y, m.z, 5, 'Armory: change role / loadout', false);
      }
    }
    return best;
  }

  get carrying() {
    const me = this.app.cw.ents.get(this.id);
    return !!(me && me.latest && me.latest.carrying);
  }

  // ------------------------------------------------------------------ vehicles
  updateVehicle(dt, input) {
    const app = this.app;
    const e = app.cw.ents.get(this.vehicle);
    if (!e) return;
    const st = e.latest;
    const def = VEHICLES[VEHICLE_CODES[st.type]];
    const seatDef = def.seats[this.seat] || {};
    if (input.pressed('interact')) {
      app.send({ t: MSG.VEHICLE, a: 'exit' });
      return;
    }
    // seat switching with number keys
    ['slot1', 'slot2', 'slot3', 'slot4', 'slot5'].forEach((a, i) => {
      if (input.pressed(a) && i !== this.seat && i < def.seats.length) app.send({ t: MSG.VEHICLE, a: 'seat', seat: i });
    });
    this.interact = { type: 'exit', label: `Exit ${def.name}`, hold: false };
    if (this.seat === 0 && this.veh) {
      const mv = input.move();
      const v = this.veh;
      const up = def.air ? (input.isDown('jump') ? 1 : input.isDown('descend') ? -1 : 0) : 0;
      const inputs = { throttle: mv.fwd, steer: mv.right, up };
      // helicopters: mouse steers yaw
      if (def.air) inputs.steer = mv.right * 0.5;
      const steps = Math.ceil(dt / 0.034);
      for (let i = 0; i < steps; i++) stepVehicle(v, inputs, dt / steps, app.world.colliders);
      if (def.air) {
        // helicopter heading follows the camera yaw
        const dy = wrapAngle(this.yaw - v.yaw);
        v.yaw = wrapAngle(v.yaw + clamp(dy, -def.turnRate * dt, def.turnRate * dt));
      }
      this.s.x = v.x;
      this.s.y = v.y;
      this.s.z = v.z;
      if (app.now - this.lastSentVs > 0.05) {
        this.lastSentVs = app.now;
        app.send({ t: MSG.VSTATE, id: v.id, p: [r2(v.x), r2(v.y), r2(v.z)], yaw: r3(v.yaw), pi: r3(v.pitch || 0), ro: r3(v.roll || 0), sp: r2(v.speed), vy: r2(v.vy || 0), th: inputs.throttle, st: inputs.steer, up: inputs.up, imp: v.impact || 0, land: v.landVel || 0 });
        v.impact = 0;
        v.landVel = 0;
      }
      // tank driver also aims the main gun when no gunner is aboard
      if (seatDef.driverWeapon) this.turretControl(dt, input, def, v);
    } else if (seatDef.weapon) {
      this.turretControl(dt, input, def, st);
    }
  }

  turretControl(dt, input, def, v) {
    const app = this.app;
    const now = this.now;
    if (now - (this.lastAim || 0) > 0.066) {
      this.lastAim = now;
      app.send({ t: MSG.VAIM, yaw: r3(this.yaw), pitch: r3(this.pitch) });
    }
    const seatIdx = def.seats[this.seat].weapon ? this.seat : def.seats.findIndex((x) => x.weapon === def.seats[this.seat].driverWeapon);
    const w = WEAPONS[def.seats[seatIdx].weapon];
    if (!w) return;
    const fire = w.auto ? input.isDown('fire') : input.pressed('fire');
    if (fire && now >= this.nextFireAt) {
      this.nextFireAt = now + 60 / w.rpm;
      const d = dirFromYawPitch(this.yaw, this.pitch);
      app.send({ t: MSG.VFIRE, d: [r4(d.x), r4(d.y), r4(d.z)] });
      this.shake = Math.min(1, this.shake + (w.id === 'cannon' ? 0.8 : 0.1));
    }
  }

  sendInput(input) {
    const app = this.app;
    const s = this.s;
    const mv = input.move();
    app.send({
      t: MSG.INPUT,
      s: this.seq++,
      p: [r2(s.x), r2(s.y), r2(s.z)],
      v: [r2(s.vx), r2(this.landVel || s.vy), r2(s.vz)],
      y: r3(this.yaw),
      pi: r3(this.pitch),
      st: s.stance,
      ln: Math.round(this.lean),
      sp: this.sprint ? 1 : 0,
      ad: this.ads ? 1 : 0,
      g: s.grounded ? 1 : 0,
      mv: Math.hypot(mv.fwd, mv.right) > 0.1 ? 1 : 0,
    });
    this.landVel = 0;
  }

  // ------------------------------------------------------------------ camera
  updateCamera(camera, dt) {
    const app = this.app;
    const w = this.wdef;
    let fov = 72;
    const scoped = this.ads && w && (w.scoped || w.id === 'binoculars');
    this.scoped = scoped && this.adsT > 0.7;
    if (this.vehicle) {
      const e = app.cw.ents.get(this.vehicle);
      const st = this.veh || (e && app.cw.sample(e));
      if (!st) return;
      const def = VEHICLES[VEHICLE_CODES[st.type]] || (this.veh && this.veh.def);
      const size = Math.max(...def.halfSize);
      const seatDef = def.seats[this.seat] || {};
      if (seatDef.weapon || seatDef.driverWeapon || this.seat !== 0 || def.air) {
        // gunner / passenger / pilot: orbit camera around the seat looking where we aim
        const seatPos = seatWorld({ ...st, def }, seatDef.offset || [0, 1, 0]);
        const d = dirFromYawPitch(this.yaw, this.pitch);
        const dist = seatDef.weapon ? 2.5 : size * 2.2;
        camera.position.set(seatPos.x - d.x * dist, seatPos.y + 1.4 - d.y * dist, seatPos.z - d.z * dist);
        camera.lookAt(seatPos.x + d.x * 50, seatPos.y + 1.2 + d.y * 50, seatPos.z + d.z * 50);
      } else {
        const yaw = st.yaw + this.camOrbit;
        const d = dirFromYawPitch(yaw, -this.camPitchV);
        const dist = size * 2.4 + 2;
        const piv = { x: st.x, y: st.y + def.halfSize[1] * 1.6 + 1, z: st.z };
        camera.position.set(piv.x - d.x * dist, piv.y - d.y * dist + 1.2, piv.z - d.z * dist);
        camera.lookAt(piv.x + d.x * 20, piv.y + 0.5, piv.z + d.z * 20);
        this.yaw = yaw;
      }
      fov = 75;
    } else {
      const eye = this.eye();
      const d = dirFromYawPitch(this.yaw, this.pitch);
      const fp = this.firstPerson || this.scoped;
      if (fp) {
        camera.position.set(eye.x + d.x * 0.1, eye.y + 0.02, eye.z + d.z * 0.1);
      } else {
        const rx = Math.cos(this.yaw);
        const rz = -Math.sin(this.yaw);
        const side = 0.55 + this.lean * 0.3;
        const dist = lerp(this.s.stance === STANCE.PRONE ? 2.0 : 2.7, 1.25, this.adsT);
        const piv = { x: eye.x + rx * side, y: eye.y + 0.12, z: eye.z + rz * side };
        let cx = piv.x - d.x * dist;
        let cy = piv.y - d.y * dist + 0.1;
        let cz = piv.z - d.z * dist;
        // keep the camera out of walls
        const dx = cx - eye.x;
        const dy = cy - eye.y;
        const dz = cz - eye.z;
        const L = Math.hypot(dx, dy, dz);
        const hit = app.world.colliders.raycast(eye.x, eye.y, eye.z, dx / L, dy / L, dz / L, L + 0.2);
        if (hit) {
          const t = Math.max(0.2, hit.t - 0.25);
          cx = eye.x + (dx / L) * t;
          cy = eye.y + (dy / L) * t;
          cz = eye.z + (dz / L) * t;
        }
        camera.position.set(cx, cy, cz);
      }
      camera.lookAt(camera.position.x + d.x * 100, camera.position.y + d.y * 100, camera.position.z + d.z * 100);
      if (this.ads && w) fov = lerp(72, w.adsFov || 55, this.adsT);
      if (this.sprint) fov += 5;
    }
    // shake
    const sh = this.shake * 0.02 + (app.effects ? app.effects.shake : 0) * 0.03;
    if (sh > 0.0005) {
      camera.rotation.x += (Math.random() - 0.5) * sh;
      camera.rotation.y += (Math.random() - 0.5) * sh;
    }
    camera.fov = lerp(camera.fov, fov, Math.min(1, dt * 14));
    camera.updateProjectionMatrix();
  }

  hideSelf() {
    return (this.firstPerson || this.scoped) && !this.vehicle;
  }
}

function r2(v) {
  return Math.round(v * 100) / 100;
}
function r3(v) {
  return Math.round(v * 1000) / 1000;
}
function r4(v) {
  return Math.round(v * 10000) / 10000;
}

export { FACTION, dist3, yawFromDir, raySoldier, rayVehicle, BODY, WEAPON_CODES };
