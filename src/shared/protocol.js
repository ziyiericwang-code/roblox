// Network protocol. Control messages are small JSON objects {t: type, ...};
// high frequency entity state goes in a compact binary snapshot.
import { ENTITY } from './constants.js';

export const MSG = {
  // client -> server
  HELLO: 'hello',
  INPUT: 'in',
  FIRE: 'fire',
  RELOAD: 'reload',
  SWITCH: 'switch',
  THROW: 'throw',
  ACTION: 'act', // timed/continuous actions: revive, heal, repair, plant, pickup, rescue
  GADGET: 'gadget', // instant gadgets: ammo bag, binocular spot
  DEPLOY: 'deploy',
  RETURN: 'return', // give up (downed) / return to deploy screen
  SQUAD: 'squad',
  ORDER: 'order',
  ABILITY: 'ability',
  MISSION: 'mission',
  VEHICLE: 'veh',
  VSTATE: 'vs', // driver vehicle state
  VAIM: 'vaim',
  VFIRE: 'vfire',
  EMOTE: 'emote',
  COSMETIC: 'cosmetic',
  SETTINGS: 'settings',
  TRAINING: 'training',
  PING: 'ping',
  REQUEST: 'req', // request a state resync (profile, war...)
  ENLIST: 'enlist', // choose / change country {country}
  PROMOTE: 'promote', // accept a promotion {to}
  MAPCMD: 'mapcmd', // strategic world-map command {cmd, target, from}
  TALK: 'talk', // interact with an NPC {id}
  ADMIN: 'admin', // sandbox / admin command (server checks permission)
  // server -> client
  WELCOME: 'welcome',
  REJECT: 'reject',
  INFO: 'info',
  GONE: 'gone',
  EVENTS: 'ev',
  PROFILE: 'profile',
  WAR: 'war',
  MISSIONS: 'missions',
  SQUADS: 'squads',
  ORDERS: 'orders',
  WORLDSTATE: 'world',
  DEPLOYINFO: 'deployinfo',
  SPAWNED: 'spawned',
  CORRECT: 'correct',
  TRAININGSTATE: 'trainstate',
  CMDSTATE: 'cmdstate',
  PONG: 'pong',
  SQUADPOS: 'squadpos',
  NOTICE: 'notice',
  LOADOUT: 'loadout',
  KICK: 'kick',
  BUILDINGS: 'bld', // building destruction states [[id, state], ...]
  PERF: 'perf', // developer performance monitor (admins only)
  ADMINSTATE: 'adminstate',
  DIALOG: 'dialog', // NPC conversation
};

// ------------------------------------------------------------------ snapshot
const POS_SCALE = 10; // 10 cm precision, +-3276 m range (the world is +-3072 m)
const YAW_SCALE = 65535 / (Math.PI * 2);

export const SNAP = { HEADER: 9 };

function wYaw(dv, o, yaw) {
  let a = yaw % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  dv.setUint16(o, Math.round(a * YAW_SCALE) & 0xffff);
}
function rYaw(dv, o) {
  return dv.getUint16(o) / YAW_SCALE;
}
function wPos(dv, o, v) {
  dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(v * POS_SCALE))));
}
function rPos(dv, o) {
  return dv.getInt16(o) / POS_SCALE;
}
function wAng8(dv, o, a, range) {
  dv.setInt8(o, Math.max(-127, Math.min(127, Math.round((a / range) * 127))));
}
function rAng8(dv, o, range) {
  return (dv.getInt8(o) / 127) * range;
}

export const SOLDIER_BYTES = 25;
export const VEHICLE_BYTES = 24;
export const PROJECTILE_BYTES = 10;
export const PROP_BYTES = 13;

/**
 * Encode entities into an ArrayBuffer.
 * items: array of plain objects produced by the simulation's snapshot view.
 */
export function encodeSnapshot(serverTime, ackSeq, items) {
  let size = SNAP.HEADER;
  for (const it of items) {
    size += it.k === ENTITY.SOLDIER ? SOLDIER_BYTES : it.k === ENTITY.VEHICLE ? VEHICLE_BYTES : it.k === ENTITY.PROJECTILE ? PROJECTILE_BYTES : PROP_BYTES;
  }
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  dv.setUint8(0, 1);
  dv.setUint32(1, serverTime >>> 0);
  dv.setUint16(5, ackSeq & 0xffff);
  dv.setUint16(7, items.length);
  let o = SNAP.HEADER;
  for (const it of items) {
    dv.setUint8(o, it.k);
    dv.setUint16(o + 1, it.id);
    if (it.k === ENTITY.SOLDIER) {
      wPos(dv, o + 3, it.x);
      wPos(dv, o + 5, it.y);
      wPos(dv, o + 7, it.z);
      wYaw(dv, o + 9, it.yaw);
      wAng8(dv, o + 11, it.pitch, Math.PI / 2);
      // flags1: stance(2) lean(2: 0 none,1 left,2 right) life(2) sprint(1) ads(1)
      const lean = it.lean < 0 ? 1 : it.lean > 0 ? 2 : 0;
      dv.setUint8(o + 12, (it.stance & 3) | (lean << 2) | ((it.life & 3) << 4) | (it.sprint ? 64 : 0) | (it.ads ? 128 : 0));
      // flags2: firing, reloading, carrying, spotted, captive, ambient, swimming, isPlayer
      dv.setUint8(o + 13, (it.firing ? 1 : 0) | (it.reloading ? 2 : 0) | (it.carrying ? 4 : 0) | (it.spotted ? 8 : 0) | (it.captive ? 16 : 0) | (it.ambient ? 32 : 0) | (it.swimming ? 64 : 0) | (it.isPlayer ? 128 : 0));
      dv.setUint8(o + 14, (it.faction & 3) | ((it.role & 7) << 2) | ((it.activity & 7) << 5));
      dv.setUint8(o + 15, it.weapon);
      dv.setUint8(o + 16, Math.max(0, Math.min(255, Math.round(it.health))));
      dv.setUint8(o + 17, it.rank);
      dv.setUint8(o + 18, it.squad);
      dv.setUint16(o + 19, it.vehicle || 0);
      dv.setUint8(o + 21, it.seat === undefined ? 255 : it.seat);
      dv.setUint8(o + 22, it.emote || 0);
      dv.setUint8(o + 23, Math.max(0, Math.min(255, Math.round(it.armor || 0))));
      dv.setUint8(o + 24, it.vx8 || 0);
      o += SOLDIER_BYTES;
    } else if (it.k === ENTITY.VEHICLE) {
      dv.setUint8(o + 3, it.type);
      wPos(dv, o + 4, it.x);
      wPos(dv, o + 6, it.y);
      wPos(dv, o + 8, it.z);
      wYaw(dv, o + 10, it.yaw);
      wAng8(dv, o + 12, it.pitch, Math.PI / 2);
      wAng8(dv, o + 13, it.roll, Math.PI / 2);
      wYaw(dv, o + 14, it.turretYaw || 0);
      wAng8(dv, o + 16, it.turretPitch || 0, Math.PI / 2);
      dv.setUint8(o + 17, Math.max(0, Math.min(255, Math.round(it.health))));
      dv.setUint8(o + 18, it.state);
      dv.setUint8(o + 19, it.faction);
      dv.setUint8(o + 20, it.seats & 0xff);
      dv.setInt8(o + 21, Math.max(-127, Math.min(127, Math.round(it.speed * 2))));
      dv.setUint8(o + 22, it.skin || 0);
      dv.setUint8(o + 23, it.cargo || 0);
      o += VEHICLE_BYTES;
    } else if (it.k === ENTITY.PROJECTILE) {
      dv.setUint8(o + 3, it.type);
      wPos(dv, o + 4, it.x);
      wPos(dv, o + 6, it.y);
      wPos(dv, o + 8, it.z);
      o += PROJECTILE_BYTES;
    } else {
      dv.setUint8(o + 3, it.type);
      wPos(dv, o + 4, it.x);
      wPos(dv, o + 6, it.y);
      wPos(dv, o + 8, it.z);
      dv.setUint8(o + 10, it.faction || 0);
      dv.setUint8(o + 11, Math.max(0, Math.min(255, Math.round(it.health ?? 255))));
      dv.setUint8(o + 12, it.variant || 0);
      o += PROP_BYTES;
    }
  }
  return buf;
}

export function decodeSnapshot(buf) {
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== 1) return null;
  const time = dv.getUint32(1);
  const ack = dv.getUint16(5);
  const n = dv.getUint16(7);
  const items = new Array(n);
  let o = SNAP.HEADER;
  for (let i = 0; i < n; i++) {
    const k = dv.getUint8(o);
    const id = dv.getUint16(o + 1);
    if (k === ENTITY.SOLDIER) {
      const f1 = dv.getUint8(o + 12);
      const f2 = dv.getUint8(o + 13);
      const f3 = dv.getUint8(o + 14);
      const leanCode = (f1 >> 2) & 3;
      items[i] = {
        k, id,
        x: rPos(dv, o + 3), y: rPos(dv, o + 5), z: rPos(dv, o + 7),
        yaw: rYaw(dv, o + 9), pitch: rAng8(dv, o + 11, Math.PI / 2),
        stance: f1 & 3, lean: leanCode === 1 ? -1 : leanCode === 2 ? 1 : 0, life: (f1 >> 4) & 3,
        sprint: !!(f1 & 64), ads: !!(f1 & 128),
        firing: !!(f2 & 1), reloading: !!(f2 & 2), carrying: !!(f2 & 4), spotted: !!(f2 & 8),
        captive: !!(f2 & 16), ambient: !!(f2 & 32), swimming: !!(f2 & 64), isPlayer: !!(f2 & 128),
        faction: f3 & 3, role: (f3 >> 2) & 7, activity: (f3 >> 5) & 7,
        weapon: dv.getUint8(o + 15), health: dv.getUint8(o + 16), rank: dv.getUint8(o + 17), squad: dv.getUint8(o + 18),
        vehicle: dv.getUint16(o + 19), seat: dv.getUint8(o + 21), emote: dv.getUint8(o + 22), armor: dv.getUint8(o + 23),
      };
      o += SOLDIER_BYTES;
    } else if (k === ENTITY.VEHICLE) {
      items[i] = {
        k, id, type: dv.getUint8(o + 3),
        x: rPos(dv, o + 4), y: rPos(dv, o + 6), z: rPos(dv, o + 8),
        yaw: rYaw(dv, o + 10), pitch: rAng8(dv, o + 12, Math.PI / 2), roll: rAng8(dv, o + 13, Math.PI / 2),
        turretYaw: rYaw(dv, o + 14), turretPitch: rAng8(dv, o + 16, Math.PI / 2),
        health: dv.getUint8(o + 17), state: dv.getUint8(o + 18), faction: dv.getUint8(o + 19), seats: dv.getUint8(o + 20),
        speed: dv.getInt8(o + 21) / 2, skin: dv.getUint8(o + 22), cargo: dv.getUint8(o + 23),
      };
      o += VEHICLE_BYTES;
    } else if (k === ENTITY.PROJECTILE) {
      items[i] = { k, id, type: dv.getUint8(o + 3), x: rPos(dv, o + 4), y: rPos(dv, o + 6), z: rPos(dv, o + 8) };
      o += PROJECTILE_BYTES;
    } else {
      items[i] = {
        k, id, type: dv.getUint8(o + 3), x: rPos(dv, o + 4), y: rPos(dv, o + 6), z: rPos(dv, o + 8),
        faction: dv.getUint8(o + 10), health: dv.getUint8(o + 11), variant: dv.getUint8(o + 12),
      };
      o += PROP_BYTES;
    }
  }
  return { time, ack, items };
}

// Vehicle state flags
export const VSTATE = { OK: 0, SMOKING: 1, BURNING: 2, WRECK: 3, ENGINE: 8 };

// Lightweight field validation helpers for incoming messages.
export const V = {
  num(v, lo = -1e6, hi = 1e6) {
    return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  },
  int(v, lo, hi) {
    return Number.isInteger(v) && v >= lo && v <= hi;
  },
  str(v, max = 64) {
    return typeof v === 'string' && v.length <= max;
  },
  vec(v, lim = 3500) {
    return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= lim);
  },
  bool(v) {
    return v === true || v === false || v === 0 || v === 1;
  },
};
