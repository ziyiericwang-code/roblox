// Simulation entities. Plain classes with minimal behaviour; systems operate on them.
import { ENTITY, LIFE, STANCE, HEALTH, FACTION } from '../shared/constants.js';
import { WEAPONS } from '../shared/config/weapons.js';
import { VEHICLES } from '../shared/config/vehicles.js';

const HISTORY = 24; // ~1.2 s at 20 Hz for lag compensation

export class Soldier {
  constructor(id, opts) {
    this.id = id;
    this.k = ENTITY.SOLDIER;
    this.faction = opts.faction ?? FACTION.COALITION;
    this.name = opts.name || 'Soldier';
    this.rank = opts.rank ?? 1;
    this.role = opts.role || 'rifleman';
    this.player = opts.player || null; // PlayerSession for humans
    this.isPlayer = !!opts.player;
    this.squadId = opts.squadId || 0;
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.z = opts.z || 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.yaw = opts.yaw || 0;
    this.pitch = 0;
    this.stance = STANCE.STAND;
    this.lean = 0;
    this.sprint = false;
    this.ads = false;
    this.grounded = true;
    this.swimming = false;
    this.health = HEALTH.max;
    this.maxArmor = opts.armor ?? 30;
    this.armor = this.maxArmor;
    this.life = LIFE.ALIVE;
    this.downedAt = 0;
    this.bleedoutAt = 0;
    this.lastDamageAt = -99;
    this.lastFireAt = -99;
    this.lastShotSeq = 0;
    this.damagers = new Map(); // attackerId -> {dmg, t}
    this.weapons = (opts.weapons || ['ar7', 'p9']).map((id) => makeWeaponState(id, opts.grenadeBonus));
    this.slot = 0;
    this.switchUntil = 0;
    this.reloadUntil = 0;
    this.bloom = 0;
    this.burstLeft = 0;
    this.suppression = 0;
    this.spottedUntil = 0;
    this.vehicle = 0;
    this.seat = -1;
    this.carrying = 0; // prop id of supply crate
    this.emote = 0;
    this.emoteUntil = 0;
    this.activity = 0; // ambient animation hint
    this.invulnerableUntil = 0;
    this.camo = opts.camo || 'woodland';
    this.headgear = opts.headgear || 'helmet';
    this.ambient = !!opts.ambient;
    this.captive = !!opts.captive;
    this.npc = null; // AI brain for NPCs
    this.spawnTime = 0;
    this.history = new Array(HISTORY);
    this.histIdx = 0;
    this.histCount = 0;
    this.infoVersion = 1;
    this.lastInputAt = 0;
    this.firingUntil = 0;
    this.action = null; // timed action in progress
    this.nextAmmoBagAt = 0;
    this.nextSpotAt = 0;
  }

  get alive() {
    return this.life === LIFE.ALIVE;
  }
  get downed() {
    return this.life === LIFE.DOWNED;
  }
  get dead() {
    return this.life === LIFE.DEAD;
  }
  get weapon() {
    return this.weapons[this.slot] || null;
  }
  get weaponDef() {
    const w = this.weapon;
    return w ? WEAPONS[w.id] : null;
  }

  recordHistory(t) {
    let h = this.history[this.histIdx];
    if (!h) h = this.history[this.histIdx] = {};
    h.t = t;
    h.x = this.x;
    h.y = this.y;
    h.z = this.z;
    h.yaw = this.yaw;
    h.stance = this.stance;
    h.lean = this.lean;
    h.downed = this.life === LIFE.DOWNED;
    this.histIdx = (this.histIdx + 1) % HISTORY;
    this.histCount = Math.min(HISTORY, this.histCount + 1);
  }

  // State at time t (interpolated), for lag-compensated hit tests.
  stateAt(t) {
    if (this.histCount === 0) return this;
    let newer = null;
    for (let i = 0; i < this.histCount; i++) {
      const idx = (this.histIdx - 1 - i + HISTORY) % HISTORY;
      const h = this.history[idx];
      if (h.t <= t) {
        if (!newer) return h;
        const span = newer.t - h.t || 1;
        const a = (t - h.t) / span;
        return {
          x: h.x + (newer.x - h.x) * a,
          y: h.y + (newer.y - h.y) * a,
          z: h.z + (newer.z - h.z) * a,
          yaw: a < 0.5 ? h.yaw : newer.yaw,
          stance: a < 0.5 ? h.stance : newer.stance,
          lean: a < 0.5 ? h.lean : newer.lean,
          downed: h.downed,
        };
      }
      newer = h;
    }
    return newer || this;
  }
}

export function makeWeaponState(id, grenadeBonus = 0) {
  const w = WEAPONS[id];
  if (!w) return { id, mag: 0, reserve: 0, count: 0 };
  if (w.kind === 'throwable') return { id, mag: 0, reserve: 0, count: (w.count || 1) + (id === 'frag' ? grenadeBonus : 0) };
  if (w.kind === 'gadget') return { id, mag: 0, reserve: 0, count: w.count || w.uses || 0 };
  return { id, mag: w.mag, reserve: w.reserve, count: 0 };
}

export class Vehicle {
  constructor(id, type, opts = {}) {
    this.id = id;
    this.k = ENTITY.VEHICLE;
    this.type = type;
    this.def = VEHICLES[type];
    this.faction = opts.faction ?? FACTION.COALITION;
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.z = opts.z || 0;
    this.yaw = opts.yaw || 0;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.vy = 0;
    this.health = this.def.hp;
    this.state = 0; // 0 ok, 1 smoking, 2 burning, 3 wreck
    this.wreckUntil = 0;
    this.seats = new Array(this.def.seats.length).fill(0);
    this.turrets = this.def.seats.map((s) => (s.weapon ? { yaw: 0, pitch: 0, mag: WEAPONS[s.weapon].mag, lastFire: -99, reloadUntil: 0 } : null));
    this.input = { throttle: 0, steer: 0, up: 0 };
    this.engine = false;
    this.lastDriverUpdate = 0;
    this.slot = opts.slot || null; // spawn slot reference
    this.lastUsedAt = 0;
    this.cargo = 0;
    this.skin = 0;
    this.ai = null; // AI driver controller
    this.lastAttacker = 0;
    this.impact = 0;
    this.floodTime = 0;
    this.history = [];
  }
  get alive() {
    return this.state !== 3;
  }
  driverId() {
    return this.seats[0];
  }
  occupants() {
    return this.seats.filter((s) => s);
  }
  freeSeat(pred) {
    for (let i = 0; i < this.seats.length; i++) if (!this.seats[i] && (!pred || pred(this.def.seats[i], i))) return i;
    return -1;
  }
}

export class Projectile {
  constructor(id, type, opts) {
    this.id = id;
    this.k = ENTITY.PROJECTILE;
    this.type = type; // 'frag' | 'smoke' | 'rocket' | 'shell' | 'charge' | 'mortar'
    this.x = opts.x;
    this.y = opts.y;
    this.z = opts.z;
    this.vx = opts.vx || 0;
    this.vy = opts.vy || 0;
    this.vz = opts.vz || 0;
    this.ownerId = opts.ownerId || 0;
    this.faction = opts.faction || 0;
    this.weaponId = opts.weaponId;
    this.fuseAt = opts.fuseAt ?? Infinity;
    this.gravity = opts.gravity ?? 19;
    this.impact = !!opts.impact; // explode on contact
    this.attachedTo = opts.attachedTo || 0;
    this.ignoreVehicle = opts.ignoreVehicle || 0;
    this.bornAt = opts.bornAt || 0;
    this.rest = false;
  }
}

export class Prop {
  constructor(id, kind, opts) {
    this.id = id;
    this.k = ENTITY.PROP;
    this.kind = kind;
    this.x = opts.x;
    this.y = opts.y;
    this.z = opts.z;
    this.vy = opts.vy || 0;
    this.faction = opts.faction || 0;
    this.health = opts.health ?? 100;
    this.maxHealth = opts.health ?? 100;
    this.variant = opts.variant || 0;
    this.ownerId = opts.ownerId || 0;
    this.squadId = opts.squadId || 0;
    this.expiresAt = opts.expiresAt ?? Infinity;
    this.data = opts.data || {};
    this.carriedBy = 0;
    this.falling = !!opts.falling;
  }
}
