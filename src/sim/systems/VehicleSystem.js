// Vehicles: depot spawning/respawn, seats & rank gating, validated driver
// state, turret gunnery, damage & destruction, repair, cargo, AI convoys,
// AI armour in battles and the gunship air-support platform.
import { FACTION, LIFE, STANCE, PROP_KIND, areHostile, SEA_LEVEL } from '../../shared/constants.js';
import { VEHICLES } from '../../shared/config/vehicles.js';
import { WEAPONS } from '../../shared/config/weapons.js';
import { XP } from '../../shared/config/economy.js';
import { rankOf, isWarrant } from '../../shared/config/ranks.js';
import { stepVehicle, seatWorld } from '../../shared/physics.js';
import { WEAPON_CODE, spreadDir } from '../../shared/combat.js';
import { MSG, V } from '../../shared/protocol.js';
import { dist2D, dist3, yawFromDir, angleDiff, clamp, wrapAngle, dirFromYawPitch, angleBetween, Rng } from '../../shared/math.js';

export class VehicleSystem {
  constructor(game) {
    this.game = game;
    this.slots = [];
    this.rng = new Rng(555);
    this.armorTimer = 30;
  }

  init() {
    const g = this.game;
    for (const m of g.world.vehicleSpawns) {
      const slot = { type: m.vtype, x: m.x, y: m.y, z: m.z, yaw: m.yaw || 0, base: m.base || null, territory: m.territory || null, faction: m.faction || 0, vehicle: 0, respawnAt: 0 };
      this.slots.push(slot);
    }
    this.slotTimer = 0;
  }

  // Parked vehicles only exist near players (vehicle level of detail).
  playerNear(x, z, r) {
    return this.game.npc.nearPlayer(x, z, r);
  }

  slotFaction(slot) {
    if (slot.base) return slot.faction;
    return this.game.war.ownerOf(slot.territory);
  }

  spawnAtSlot(slot) {
    const g = this.game;
    const f = this.slotFaction(slot);
    if (!f) return null;
    const def = VEHICLES[slot.type];
    let y = slot.y;
    if (def.water) y = SEA_LEVEL + def.rideHeight;
    else if (def.air) y = g.world.colliders.groundHeight(slot.x, slot.z, slot.y + 2) + 0.1;
    else y = g.world.colliders.groundHeight(slot.x, slot.z, slot.y + 2) + def.rideHeight;
    const v = g.addVehicle(slot.type, { x: slot.x, y, z: slot.z, yaw: slot.yaw, faction: f, slot });
    slot.vehicle = v.id;
    v.lastUsedAt = g.time;
    return v;
  }

  // Sandbox / scripted spawn of a vehicle at a free spot.
  spawnVehicle(type, x, z, yaw, faction) {
    const g = this.game;
    const def = VEHICLES[type];
    if (!def) return null;
    let y;
    if (def.water) y = SEA_LEVEL + def.rideHeight;
    else y = g.world.colliders.groundHeight(x, z, 800) + (def.air ? 0.1 : def.rideHeight);
    const v = g.addVehicle(type, { x, y, z, yaw, faction });
    v.lastUsedAt = g.time;
    return v;
  }

  // ------------------------------------------------------------------ seats
  onMessage(session, msg) {
    const g = this.game;
    const s = session.soldier;
    if (!s || s.life !== LIFE.ALIVE) return;
    if (msg.a === 'exit') {
      this.ejectSoldier(s, false);
      return;
    }
    if (msg.a === 'seat') {
      const v = g.get(s.vehicle);
      if (!v || !V.int(msg.seat, 0, 9)) return;
      if (v.seats[msg.seat]) return;
      if (!this.seatAllowed(session, v, msg.seat)) return;
      v.seats[s.seat] = 0;
      if (s.seat === 0) this.onDriverLeft(v);
      this.seat(s, v, msg.seat);
      return;
    }
    if (msg.a === 'enter') {
      if (s.vehicle || s.carrying) return;
      const v = V.int(msg.id, 1, 65535) ? g.get(msg.id) : null;
      if (!v || v.k !== 2 || v.state === 3) return;
      if (v.faction !== s.faction) return;
      if (dist3(s, v) > Math.max(...v.def.halfSize) + 4) return;
      let seatIdx = V.int(msg.seat, 0, 9) && !v.seats[msg.seat] && this.seatAllowed(session, v, msg.seat) ? msg.seat : -1;
      if (seatIdx < 0) {
        for (let i = 0; i < v.seats.length; i++) {
          if (!v.seats[i] && this.seatAllowed(session, v, i)) {
            seatIdx = i;
            break;
          }
        }
      }
      if (seatIdx < 0) {
        const needs = v.def.seats.some((sd, i) => !v.seats[i]);
        g.notify(session, needs ? `${v.def.name}: driver and gunner seats require ${rankOf(v.def.minRank).name}.` : 'Vehicle is full.', 'warn');
        return;
      }
      this.seat(s, v, seatIdx);
    }
  }

  seatAllowed(session, v, i) {
    const sd = v.def.seats[i];
    if (!sd) return false;
    if (sd.role === 'passenger') return true;
    return session.rankIndex >= v.def.minRank || (!!v.def.warrant && isWarrant(session.rankIndex));
  }

  seat(s, v, i) {
    v.asleep = false;
    const g = this.game;
    v.seats[i] = s.id;
    s.vehicle = v.id;
    s.seat = i;
    s.stance = STANCE.STAND;
    s.lean = 0;
    s.sprint = false;
    s.action = null;
    s.emote = 0;
    v.lastUsedAt = g.time;
    if (i === 0) {
      v.engine = true;
      v.lastDriverUpdate = g.time;
      v.driverSince = g.time;
      if (s.player) {
        const skin = s.player.profile.cosmetics.vehicle;
        v.skin = ['standard', 'sand', 'winter', 'urban'].indexOf(skin);
        if (v.skin < 0) v.skin = 0;
      }
    }
    const p = seatWorld(v, v.def.seats[i].offset);
    s.x = p.x;
    s.y = p.y;
    s.z = p.z;
    if (s.player) {
      s.player.send({ t: MSG.NOTICE, kind: 'vehicle', id: v.id, seat: i });
      g.training.onVehicle(s.player, v);
    }
  }

  onDriverLeft(v) {
    v.input = { throttle: 0, steer: 0, up: 0 };
    if (!v.def.air) v.engine = false;
    v.driverLeftAt = this.game.time;
  }

  ejectSoldier(s, silent) {
    const g = this.game;
    if (!s.vehicle) return;
    const v = g.get(s.vehicle);
    const seatIdx = s.seat;
    s.vehicle = 0;
    s.seat = -1;
    if (!v) return;
    if (v.seats[seatIdx] === s.id) v.seats[seatIdx] = 0;
    if (seatIdx === 0) this.onDriverLeft(v);
    // find an exit spot beside the vehicle
    const hs = v.def.halfSize;
    const col = g.world.colliders;
    const off = v.def.seats[seatIdx] ? v.def.seats[seatIdx].offset : [0, 0, 0];
    let placed = false;
    for (const side of [-1, 1, 0]) {
      const lx = side === 0 ? 0 : side * (hs[0] + 1.1);
      const lz = side === 0 ? hs[2] + 1.4 : off[2];
      const p = seatWorld(v, [lx, 0, lz]);
      const gy = col.groundHeight(p.x, p.z, v.y + 2);
      if (!col.pointInSolid(p.x, gy + 0.9, p.z) && (v.def.air || gy > SEA_LEVEL - 1.0 || v.def.water)) {
        s.x = p.x;
        s.z = p.z;
        s.y = v.def.air ? Math.max(gy, v.y) : gy;
        placed = true;
        break;
      }
    }
    if (!placed) {
      s.y = v.y + hs[1] * 2 + 0.2;
    }
    s.vx = 0;
    s.vy = 0;
    s.vz = 0;
    if (s.player && !silent) {
      s.player.send({ t: MSG.NOTICE, kind: 'vehicle', id: 0, seat: -1, p: [s.x, s.y, s.z] });
    }
  }

  // ------------------------------------------------------------------ driver state
  onDriverState(session, msg) {
    const g = this.game;
    const s = session.soldier;
    if (!s || !s.vehicle || s.seat !== 0) return;
    const v = g.get(s.vehicle);
    if (!v || v.id !== msg.id || v.state === 3) return;
    if (!V.vec(msg.p) || !V.num(msg.yaw, -10, 10) || !V.num(msg.sp, -100, 100)) return;
    const dt = clamp(g.time - v.lastDriverUpdate, 0.02, 1.0);
    const d = v.def;
    const horiz = dist2D(msg.p[0], msg.p[2], v.x, v.z);
    const allowed = (d.maxSpeed * 1.35 + 3) * dt + 1.5;
    const col = g.world.colliders;
    let bad = horiz > allowed;
    if (!bad && d.air) {
      const ground = g.world.terrain.heightAt(msg.p[0], msg.p[2]);
      if (msg.p[1] - ground > d.maxAltitude + 15) bad = true;
    }
    if (!bad && !d.air && col.pointInSolid(msg.p[0], msg.p[1] + 1.2, msg.p[2])) bad = true;
    v.lastDriverUpdate = g.time;
    if (bad) {
      session.violations += 0.2;
      session.send({ t: MSG.CORRECT, v: v.id, p: [v.x, v.y, v.z], yaw: v.yaw });
      return;
    }
    v.x = msg.p[0];
    v.y = msg.p[1];
    v.z = msg.p[2];
    v.yaw = msg.yaw;
    v.pitch = V.num(msg.pi, -1.5, 1.5) ? msg.pi : 0;
    v.roll = V.num(msg.ro, -1.5, 1.5) ? msg.ro : 0;
    v.speed = clamp(msg.sp, -d.reverseSpeed * 1.3, d.maxSpeed * 1.3);
    v.vy = V.num(msg.vy, -80, 40) ? msg.vy : 0;
    v.input = { throttle: V.num(msg.th, -1, 1) ? msg.th : 0, steer: V.num(msg.st, -1, 1) ? msg.st : 0, up: V.num(msg.up, -1, 1) ? msg.up : 0 };
    v.engine = true;
    v.lastUsedAt = g.time;
    if (V.num(msg.imp, 0, 100) && msg.imp > 12) this.damage(v, (msg.imp - 12) * 18, null, 'crash');
    if (V.num(msg.land, -100, 0) && msg.land < -9) this.damage(v, (-msg.land - 9) * 40, null, 'crash');
  }

  onAim(session, msg) {
    const g = this.game;
    const s = session.soldier;
    if (!s || !s.vehicle) return;
    const v = g.get(s.vehicle);
    if (!v || !V.num(msg.yaw, -10, 10) || !V.num(msg.pitch, -1.6, 1.6)) return;
    const seatIdx = this.weaponSeat(v, s.seat);
    const tur = v.turrets[seatIdx];
    if (!tur) return;
    tur.yaw = msg.yaw;
    tur.pitch = clamp(msg.pitch, -0.35, 0.9);
  }

  // Driver of a tank operates the main gun when the gunner seat is empty.
  weaponSeat(v, seat) {
    const sd = v.def.seats[seat];
    if (!sd) return -1;
    if (sd.weapon) return seat;
    if (sd.driverWeapon) {
      const gi = v.def.seats.findIndex((x) => x.weapon === sd.driverWeapon);
      if (gi >= 0 && !v.seats[gi]) return gi;
    }
    return -1;
  }

  muzzle(v, seatIdx) {
    const sd = v.def.seats[seatIdx];
    const base = seatWorld(v, sd.offset);
    const tur = v.turrets[seatIdx];
    const d = dirFromYawPitch(tur.yaw, tur.pitch);
    const len = sd.weapon === 'cannon' ? 4.2 : 1.4;
    return { o: { x: base.x + d.x * len, y: base.y + 0.9 + d.y * len, z: base.z + d.z * len }, d };
  }

  onFire(session, msg) {
    const g = this.game;
    const s = session.soldier;
    if (!s || !s.vehicle || s.life !== LIFE.ALIVE) return;
    const v = g.get(s.vehicle);
    if (!v || v.state === 3) return;
    const seatIdx = this.weaponSeat(v, s.seat);
    if (seatIdx < 0) return;
    if (!V.vec(msg.d, 2)) return;
    let d = { x: msg.d[0], y: msg.d[1], z: msg.d[2] };
    const l = Math.hypot(d.x, d.y, d.z);
    if (l < 0.9 || l > 1.1) return;
    d = { x: d.x / l, y: d.y / l, z: d.z / l };
    const tur = v.turrets[seatIdx];
    const aim = dirFromYawPitch(tur.yaw, tur.pitch);
    if (angleBetween(aim, d) > 0.35) return;
    this.fireTurret(v, seatIdx, s, d);
  }

  fireTurret(v, seatIdx, shooter, dir) {
    const g = this.game;
    const sd = v.def.seats[seatIdx];
    const w = WEAPONS[sd.weapon];
    const tur = v.turrets[seatIdx];
    if (!w || !tur) return false;
    if (tur.reloadUntil > g.time) return false;
    if (g.time - tur.lastFire < (60 / w.rpm) * 0.85) return false;
    if (tur.mag <= 0) {
      tur.reloadUntil = g.time + w.reload;
      tur.mag = w.mag;
      return false;
    }
    tur.mag--;
    tur.lastFire = g.time;
    const m = this.muzzle(v, seatIdx);
    const d = spreadDir(dir, w.spreadHip, () => this.rng.next());
    if (w.kind === 'launcher') {
      g.combat.fireProjectile(shooter, w.projectile, m.o, d, w, { faction: v.faction, ignoreVehicle: v.id });
      g.emit(['shot', shooter ? shooter.id : 0, WEAPON_CODE[w.id], r1(m.o.x), r1(m.o.y), r1(m.o.z), r1(m.o.x + d.x * 30), r1(m.o.y + d.y * 30), r1(m.o.z + d.z * 30), 8, v.id], { pos: m.o, range: 900 });
    } else {
      g.combat.fireHitscan(shooter, m.o, d, w, { faction: v.faction, ignoreVehicle: v.id, vehicleId: v.id, session: shooter && shooter.player });
    }
    if (shooter && shooter.player && (tur.mag <= 0)) g.notify(shooter.player, 'Reloading...', 'info');
    return true;
  }

  // ------------------------------------------------------------------ damage
  damage(v, amount, attacker, type) {
    v.asleep = false;
    const g = this.game;
    if (v.state === 3 || amount <= 0) return;
    v.health -= amount;
    if (attacker) v.lastAttacker = attacker.id;
    this.updateState(v);
    if (v.health <= 0) this.destroy(v, attacker);
    void type;
  }

  updateState(v) {
    if (v.state === 3) return;
    const f = v.health / v.def.hp;
    v.state = f < 0.25 ? 2 : f < 0.5 ? 1 : 0;
  }

  repair(v, amt) {
    v.health = Math.min(v.def.hp, v.health + amt);
    this.updateState(v);
  }

  destroy(v, attacker) {
    const g = this.game;
    v.state = 3;
    v.health = 0;
    v.engine = false;
    v.wreckUntil = g.time + 25;
    g.emit(['boom', r1(v.x), r1(v.y + 1), r1(v.z), 7, 2], { pos: v, range: 1400 });
    const killer = attacker || (v.lastAttacker ? g.get(v.lastAttacker) : null);
    for (let i = 0; i < v.seats.length; i++) {
      const sid = v.seats[i];
      if (!sid) continue;
      const s = g.get(sid);
      if (!s) continue;
      this.ejectSoldier(s, true);
      g.combat.applyDamage(s, 130, killer, { explosive: true, weaponId: 'rl3', session: killer && killer.player });
    }
    if (killer && killer.player && areHostile(killer.faction, v.faction)) {
      g.progression.award(killer.player, { xp: XP.vehicleDestroyed, reason: `${v.def.name} destroyed`, cat: 'combat', pos: v, stats: { vehicleKills: 1 } });
    }
    if (v.slot) v.slot.respawnAt = g.time + v.def.respawn;
  }

  retire(v, delay = 0) {
    v.retireAt = this.game.time + delay;
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const g = this.game;
    const col = g.world.colliders;
    this.slotTimer -= dt;
    if (this.slotTimer <= 0) {
      this.slotTimer = 1;
      for (const slot of this.slots) {
        const v = slot.vehicle ? g.get(slot.vehicle) : null;
        const near = this.playerNear(slot.x, slot.z, v ? 900 : 700);
        if (!v) {
          slot.vehicle = 0;
          if (!near) continue;
          if (slot.respawnAt && g.time < slot.respawnAt) continue;
          slot.respawnAt = 0;
          if (this.slotFaction(slot)) this.spawnAtSlot(slot);
          else slot.respawnAt = g.time + 30;
        } else if (!near && !v.occupants().length && v.state !== 3 && dist2D(v.x, v.z, slot.x, slot.z) < 30) {
          // nobody around: park it back into the abstract world
          g.removeEntity(v);
          slot.vehicle = 0;
          slot.respawnAt = 0;
        }
      }
    }
    this.armorTimer -= dt;
    if (this.armorTimer <= 0) {
      this.armorTimer = 45;
      this.directArmor();
    }
    for (const v of [...g.vehicles]) {
      if (v.retireAt && g.time >= v.retireAt && !v.occupants().some((id) => {
        const s = g.get(id);
        return s && s.isPlayer;
      })) {
        for (const id of v.occupants()) {
          const s = g.get(id);
          if (s) {
            this.ejectSoldier(s, true);
            if (s.npc && s.npc.driver) g.npc.despawn(s);
          }
        }
        if (v.slot && v.slot.vehicle === v.id) v.slot.respawnAt = g.time + 10;
        g.removeEntity(v);
        continue;
      }
      if (v.state === 3) {
        if (g.time >= v.wreckUntil) g.removeEntity(v);
        continue;
      }
      const driver = v.seats[0] ? g.get(v.seats[0]) : null;
      if (v.ai) this.aiDrive(v, dt);
      else if (!driver || !driver.player || g.time - v.lastDriverUpdate > 1.0) {
        // unmanned (or driver lagging): coast to a stop with physics, then sleep
        if (!driver) v.input = { throttle: 0, steer: 0, up: v.def.air ? -1 : 0 };
        if (driver || !v.asleep || v.state >= 2) {
          stepVehicle(v, v.input, dt, col);
          v.stillT = !driver && Math.abs(v.speed) < 0.05 && Math.abs(v.vy || 0) < 0.05 ? (v.stillT || 0) + dt : 0;
          v.asleep = v.stillT > 2;
        }
      } else v.asleep = false;
      // fire & water damage
      if (v.state === 2) this.damage(v, 7 * dt, null, 'fire');
      if (v.def.ground && v.flooded) {
        v.floodTime += dt;
        if (v.floodTime > 6) this.destroy(v, null);
      } else v.floodTime = 0;
      if (v.impact > 12 && !driver) this.damage(v, (v.impact - 12) * 15, null, 'crash');
      v.impact = 0;
      if (v.landVel && v.landVel < -9 && v.def.air && (!driver || !driver.player)) this.damage(v, (-v.landVel - 9) * 40, null, 'crash');
      v.landVel = 0;
      // occupants ride along
      for (let i = 0; i < v.seats.length; i++) {
        const sid = v.seats[i];
        if (!sid) continue;
        const s = g.get(sid);
        if (!s || s.life === LIFE.DEAD || s.vehicle !== v.id) {
          v.seats[i] = 0;
          if (i === 0) this.onDriverLeft(v);
          continue;
        }
        const p = seatWorld(v, v.def.seats[i].offset);
        s.x = p.x;
        s.y = p.y;
        s.z = p.z;
        s.vx = -Math.sin(v.yaw) * v.speed;
        s.vz = -Math.cos(v.yaw) * v.speed;
        if (!v.def.seats[i].weapon) s.yaw = v.yaw;
        if (s.life === LIFE.DOWNED) this.ejectSoldier(s, true);
      }
      // run-over damage for ground vehicles moving fast
      if (v.def.ground && Math.abs(v.speed) > 7) {
        const hs = v.def.halfSize;
        for (const s of g.soldiersNear(v.x, v.z, hs[2] + 1)) {
          if (s.vehicle || s.life === LIFE.DEAD) continue;
          const lx = (s.x - v.x) * Math.cos(v.yaw) - (s.z - v.z) * Math.sin(v.yaw);
          const lz = (s.x - v.x) * Math.sin(v.yaw) + (s.z - v.z) * Math.cos(v.yaw);
          if (Math.abs(lx) > hs[0] + 0.3 || Math.abs(lz) > hs[2] + 0.3) continue;
          if (areHostile(s.faction, v.faction)) {
            const drv = v.seats[0] ? g.get(v.seats[0]) : null;
            g.combat.applyDamage(s, 40 + Math.abs(v.speed) * 5, drv, { weaponId: 'none', session: drv && drv.player });
          } else if (s.npc) {
            s.x += Math.sign(lx || 1) * (hs[0] + 1 - Math.abs(lx)) * Math.cos(v.yaw);
            s.z -= Math.sign(lx || 1) * (hs[0] + 1 - Math.abs(lx)) * Math.sin(v.yaw);
          }
        }
      }
      // abandoned vehicles return to their depots eventually
      if (!v.occupants().length && v.slot && g.time - v.lastUsedAt > 240 && dist2D(v.x, v.z, v.slot.x, v.slot.z) > 40) {
        if (!g.soldiersNear(v.x, v.z, 90, (s) => s.isPlayer).length) this.retire(v);
      }
      if (v.occupants().length) v.lastUsedAt = g.time;
    }
  }

  // ------------------------------------------------------------------ AI driving
  aiDrive(v, dt) {
    const g = this.game;
    const ai = v.ai;
    const driver = v.seats[0] ? g.get(v.seats[0]) : null;
    if (ai.type === 'gunship') return this.aiGunship(v, dt);
    if (!driver || driver.life !== LIFE.ALIVE) {
      stepVehicle(v, { throttle: 0, steer: 0 }, dt, g.world.colliders);
      return;
    }
    let throttle = 0;
    let steer = 0;
    const pts = ai.route;
    if (pts && ai.idx < pts.length) {
      const p = pts[ai.idx];
      const d = dist2D(v.x, v.z, p.x, p.z);
      if (d < 7) ai.idx++;
      const want = yawFromDir(p.x - v.x, p.z - v.z);
      const diff = angleDiff(v.yaw, want);
      steer = clamp(-diff * 2, -1, 1);
      const limit = ai.speedLimit || v.def.maxSpeed * 0.7;
      throttle = Math.abs(diff) > 1.2 ? 0.25 : v.speed < limit ? 0.8 : 0;
      // wait for escorts on convoy duty if the lead gets far ahead
      if (ai.escortWait) {
        const players = g.soldiersNear(v.x, v.z, 120, (s) => s.isPlayer && s.faction === v.faction).length;
        if (!players && ai.idx > 3) throttle = 0;
      }
      if (ai.stopAt && ai.idx >= ai.stopAt) throttle = 0;
    }
    // avoid ramming friendlies ahead
    const fx = -Math.sin(v.yaw);
    const fz = -Math.cos(v.yaw);
    for (const o of g.vehiclesNear(v.x + fx * 8, v.z + fz * 8, 6)) {
      if (o !== v) throttle = Math.min(throttle, 0);
    }
    stepVehicle(v, { throttle, steer }, dt, g.world.colliders);
    v.input = { throttle, steer, up: 0 };
    // AI gunners
    this.aiGunners(v);
  }

  aiGunners(v) {
    const g = this.game;
    if (g.tickCount % 4 !== 0) return;
    for (let i = 0; i < v.seats.length; i++) {
      const sd = v.def.seats[i];
      if (!sd.weapon || !v.seats[i]) continue;
      const gunner = g.get(v.seats[i]);
      if (!gunner || gunner.player || gunner.life !== LIFE.ALIVE) continue;
      const w = WEAPONS[sd.weapon];
      const tur = v.turrets[i];
      const base = seatWorld(v, sd.offset);
      const range = sd.weapon === 'gunship' ? 250 : 170;
      let tgt = null;
      let bd = range;
      g.spatial.query(base.x, base.z, range, (e) => {
        if ((e.k !== 1 && e.k !== 2) || !areHostile(e.faction, v.faction)) return;
        if (e.k === 1 && (e.life !== LIFE.ALIVE || e.captive)) return;
        if (e.k === 2 && e.state === 3) return;
        if (e.k === 2 && w.kind !== 'launcher' && e.def.armor === 'heavy') return;
        const d = dist3(base, e);
        if (d < bd && g.combat.losClear(base.x, base.y + 1, base.z, e.x, e.y + 1, e.z)) {
          bd = d;
          tgt = e;
        }
      });
      if (!tgt) continue;
      const aimY = tgt.y + (tgt.k === 1 ? 1.1 : 1.2);
      const dx = tgt.x - base.x;
      const dy = aimY - (base.y + 0.9);
      const dz = tgt.z - base.z;
      tur.yaw = yawFromDir(dx, dz);
      tur.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const l = Math.hypot(dx, dy, dz) || 1;
      const skillErr = { x: (this.rng.next() - 0.5) * 0.04, y: (this.rng.next() - 0.5) * 0.03, z: (this.rng.next() - 0.5) * 0.04 };
      this.fireTurret(v, i, gunner, { x: dx / l + skillErr.x, y: dy / l + skillErr.y, z: dz / l + skillErr.z });
    }
  }

  aiGunship(v, dt) {
    const g = this.game;
    const ai = v.ai;
    if (g.time > ai.until) {
      // leave the area and despawn
      ai.center = { x: v.x + (v.x - ai.center.x) * 5, z: v.z + (v.z - ai.center.z) * 5 };
      if (!ai.leaving) {
        ai.leaving = true;
        this.retire(v, 12);
      }
    }
    ai.angle = (ai.angle || 0) + dt * 0.28;
    const tx = ai.center.x + Math.cos(ai.angle) * ai.radius;
    const tz = ai.center.z + Math.sin(ai.angle) * ai.radius;
    const want = yawFromDir(tx - v.x, tz - v.z);
    const diff = angleDiff(v.yaw, want);
    const ground = g.world.terrain.heightAt(v.x, v.z);
    const up = clamp((ground + 55 - v.y) * 0.2, -1, 1);
    stepVehicle(v, { throttle: 0.55, steer: clamp(-diff * 2, -1, 1), up }, dt, g.world.colliders);
    v.engine = true;
    if (!ai.leaving) this.aiGunners(v);
  }

  // ------------------------------------------------------------------ AI spawns
  spawnConvoy(faction, route, n, missionId) {
    const g = this.game;
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = route[Math.min(route.length - 1, i * 3)];
      const q = route[Math.min(route.length - 1, i * 3 + 2)];
      const yaw = yawFromDir(q.x - p.x, q.z - p.z);
      const y = g.world.colliders.groundHeight(p.x, p.z, 400) + VEHICLES.truck.rideHeight;
      const v = g.addVehicle('truck', { x: p.x, y, z: p.z, yaw, faction });
      v.ai = { type: 'convoy', route, idx: i * 3, speedLimit: 11, mission: missionId, escortWait: true };
      v.engine = true;
      v.cargo = 2;
      const driver = g.npc.spawnSoldier(faction, p.x + 3, p.z, { kit: 'rifleman', mission: missionId });
      if (driver) {
        driver.npc.driver = true;
        this.seat(driver, v, 0);
      }
      out.push(v);
    }
    return out;
  }

  spawnGunship(faction, x, z, duration, ownerId) {
    const g = this.game;
    if ([...g.vehicles].some((v) => v.ai && v.ai.type === 'gunship' && v.faction === faction)) return false;
    const base = g.world.bases[faction];
    const y = g.world.terrain.heightAt(base.x, base.z) + 60;
    const v = g.addVehicle('gunship', { x: base.x, y, z: base.z, yaw: yawFromDir(x - base.x, z - base.z), faction });
    v.ai = { type: 'gunship', center: { x, z }, radius: 70, until: g.time + duration + 25, ownerId, angle: 0 };
    v.engine = true;
    v.speed = 30;
    for (let i = 0; i < 2; i++) {
      const crew = g.npc.spawnSoldier(faction, base.x, base.z, { kit: 'rifleman' });
      if (crew) {
        crew.npc.driver = true;
        this.seat(crew, v, i);
      }
    }
    return true;
  }

  // Occasionally the AI commits armour to an active battle.
  directArmor() {
    const g = this.game;
    for (const b of g.war.battles.values()) {
      if (!b.live) continue;
      const t = g.world.tById[b.territory];
      if (!g.npc.nearPlayer(t.x, t.z, t.radius + 300)) continue;
      const f = this.rng.chance(0.5) ? b.attacker : b.defender;
      if (g.war.strengthAt(t.id, f) < 50) continue;
      const existing = [...g.vehicles].filter((v) => v.ai && v.ai.type === 'armor' && v.faction === f && v.state !== 3).length;
      if (existing >= 2 || !this.rng.chance(0.5)) continue;
      const type = this.rng.chance(0.4) ? 'tank' : 'apc';
      const o = g.npc.reinforcementOrigin(f, t.x, t.z);
      const y = g.world.colliders.groundHeight(o.x, o.z, 400) + VEHICLES[type].rideHeight;
      const v = g.addVehicle(type, { x: o.x, y, z: o.z, yaw: yawFromDir(t.x - o.x, t.z - o.z), faction: f });
      const target = this.rng.pick(t.sectors);
      let route = g.world.nav ? g.world.nav.findPath(o.x, o.z, target.x, target.z, 8000) : null;
      if (!route) route = [{ x: target.x, z: target.z }];
      v.ai = { type: 'armor', route, idx: 0, speedLimit: VEHICLES[type].maxSpeed * 0.6, stopAt: Math.max(1, route.length - 2) };
      v.engine = true;
      const seats = type === 'tank' ? [0, 1] : [0, 1];
      for (const si of seats) {
        const crew = g.npc.spawnSoldier(f, o.x, o.z, { kit: 'rifleman' });
        if (crew) {
          crew.npc.driver = true;
          this.seat(crew, v, si);
        }
      }
      for (const e of g.war.enemies(f)) g.radio(e, 'intel', 'Forward Observer', `Enemy ${type === 'tank' ? 'tank' : 'armoured carrier'} moving toward ${t.name}. Engineers, get ready.`, { priority: 1 });
    }
  }

  // ------------------------------------------------------------------ cargo
  cargoAction(s, target, type) {
    const g = this.game;
    if (!target || target.k !== 2 || !target.def.cargo || target.faction !== s.faction) return;
    if (dist3(s, target) > target.def.halfSize[2] + 3) return;
    if (type === 'load') {
      if (!s.carrying || target.cargo >= target.def.cargo) return;
      const p = g.get(s.carrying);
      s.carrying = 0;
      if (p) g.removeEntity(p);
      target.cargo++;
      if (s.player) g.notify(s.player, `Crate loaded (${target.cargo}/${target.def.cargo}).`, 'good');
    } else if (type === 'unload') {
      if (s.carrying || target.cargo <= 0) return;
      target.cargo--;
      const p = g.addProp(PROP_KIND.SUPPLY_CRATE, { x: s.x, y: s.y + 1.2, z: s.z, faction: s.faction });
      p.carriedBy = s.id;
      s.carrying = p.id;
    }
  }

  // ------------------------------------------------------------------ war hooks
  onTerritoryFlipped(w) {
    const g = this.game;
    for (const slot of this.slots) {
      if (slot.territory !== w.id) continue;
      const v = slot.vehicle ? g.get(slot.vehicle) : null;
      if (v && !v.occupants().length && v.faction !== w.owner) this.retire(v);
      slot.respawnAt = g.time + 30;
    }
  }

  onCampaignReset() {
    for (const v of this.game.vehicles) if (!v.occupants().length) this.retire(v);
  }
}

function r1(v) {
  return Math.round(v * 10) / 10;
}

export { wrapAngle };
