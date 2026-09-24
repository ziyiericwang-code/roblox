// Hitbox geometry and ray tests shared by simulation (authoritative hits) and
// client (visual prediction such as impact effects).
import { STANCE } from './constants.js';
import { rayCapsule, raySphere } from './math.js';
import { WEAPONS } from './config/weapons.js';
import { VEHICLES } from './config/vehicles.js';

export const ZONE = { NONE: 0, HEAD: 1, TORSO: 2, LIMB: 3 };

// Stable numeric codes for binary snapshots.
export const WEAPON_CODES = ['none', ...Object.keys(WEAPONS)];
export const WEAPON_CODE = Object.fromEntries(WEAPON_CODES.map((id, i) => [id, i]));
export const VEHICLE_CODES = Object.keys(VEHICLES);
export const VEHICLE_CODE = Object.fromEntries(VEHICLE_CODES.map((id, i) => [id, i]));
export const ROLE_CODES = ['rifleman', 'medic', 'engineer', 'support', 'scout', 'leader'];
export const ROLE_CODE = Object.fromEntries(ROLE_CODES.map((id, i) => [id, i]));
export const EMOTE_CODES = ['none', 'salute', 'attention', 'point', 'wave', 'at_ease', 'cheer'];
export const EMOTE_CODE = Object.fromEntries(EMOTE_CODES.map((id, i) => [id, i]));
export const PROJECTILE_CODES = ['none', 'frag', 'smoke', 'rocket', 'shell', 'charge', 'mortar'];
export const PROJECTILE_CODE = Object.fromEntries(PROJECTILE_CODES.map((id, i) => [id, i]));

const A = { x: 0, y: 0, z: 0 };
const B = { x: 0, y: 0, z: 0 };
const H = { x: 0, y: 0, z: 0 };

// Fill capsule endpoints for a soldier at (x,y,z) (feet), facing yaw.
function bodyGeometry(s) {
  const fx = -Math.sin(s.yaw);
  const fz = -Math.cos(s.yaw);
  const lean = s.lean || 0;
  const rx = Math.cos(s.yaw);
  const rz = -Math.sin(s.yaw);
  if (s.stance === STANCE.PRONE || s.downed) {
    // lying along facing direction; feet behind, head in front
    A.x = s.x - fx * 0.8;
    A.y = s.y + 0.25;
    A.z = s.z - fz * 0.8;
    B.x = s.x + fx * 0.55;
    B.y = s.y + 0.28;
    B.z = s.z + fz * 0.55;
    H.x = s.x + fx * 0.85;
    H.y = s.y + 0.35;
    H.z = s.z + fz * 0.85;
    return 0.26;
  }
  const crouch = s.stance === STANCE.CROUCH;
  // Torso capsule top (shoulder + radius) stays just below the head sphere so
  // aimed headshots register as headshots. Matches the rendered model.
  const shoulder = crouch ? 0.95 : 1.3;
  const head = crouch ? 1.25 : 1.62;
  const lx = rx * lean * 0.35;
  const lz = rz * lean * 0.35;
  A.x = s.x;
  A.y = s.y + 0.25;
  A.z = s.z;
  B.x = s.x + lx * 0.7;
  B.y = s.y + shoulder;
  B.z = s.z + lz * 0.7;
  H.x = s.x + lx;
  H.y = s.y + head;
  H.z = s.z + lz;
  return crouch ? 0.27 : 0.26;
}

/**
 * Ray vs soldier. o,d: ray (d normalized). s: {x,y,z,yaw,stance,lean,downed}
 * Returns {t, zone} or null.
 */
export function raySoldier(o, d, maxT, s) {
  const r = bodyGeometry(s);
  const th = raySphere(o, d, H, 0.18, maxT);
  // torso: from hip to shoulder; legs from feet to hip
  let best = null;
  if (th >= 0) best = { t: th, zone: ZONE.HEAD };
  if (s.stance === STANCE.PRONE || s.downed) {
    const tb = rayCapsule(o, d, A, B, r, maxT);
    if (tb >= 0 && (!best || tb < best.t)) best = { t: tb, zone: ZONE.TORSO };
    return best;
  }
  const hipY = A.y + (B.y - A.y) * 0.45;
  const mid = { x: (A.x + B.x) / 2, y: hipY, z: (A.z + B.z) / 2 };
  const tt = rayCapsule(o, d, mid, B, r, maxT);
  if (tt >= 0 && (!best || tt < best.t)) best = { t: tt, zone: ZONE.TORSO };
  const tl = rayCapsule(o, d, A, mid, r * 0.8, maxT);
  if (tl >= 0 && (!best || tl < best.t)) best = { t: tl, zone: ZONE.LIMB };
  return best;
}

// Approximate chest / head aim points for AI.
export function aimPoint(s, head = false) {
  bodyGeometry(s);
  if (head) return { x: H.x, y: H.y, z: H.z };
  return { x: (A.x + B.x) / 2 * 0.3 + B.x * 0.7, y: A.y + (B.y - A.y) * 0.75, z: (A.z + B.z) / 2 * 0.3 + B.z * 0.7 };
}

// Ray vs vehicle oriented box (yaw only). v: {x,y,z,yaw,def}
export function rayVehicle(o, d, maxT, v) {
  const def = v.def || VEHICLES[v.type];
  const [hx, hy, hz] = def.halfSize;
  const cy = Math.cos(v.yaw);
  const sy = Math.sin(v.yaw);
  // vehicle centre
  const baseY = def.ground ? v.y - def.rideHeight : v.y;
  const cx = v.x;
  const ccy = baseY + hy;
  const cz = v.z;
  // transform ray into local space: local x = right (cos,-sin), local z = backward (sin, cos)
  const ox = o.x - cx;
  const oy = o.y - ccy;
  const oz = o.z - cz;
  const lox = ox * cy - oz * sy;
  const loz = ox * sy + oz * cy;
  const ldx = d.x * cy - d.z * sy;
  const ldz = d.x * sy + d.z * cy;
  let tmin = 0;
  let tmax = maxT;
  const slab = (oo, dd, h) => {
    if (Math.abs(dd) < 1e-9) return oo >= -h && oo <= h;
    let t1 = (-h - oo) / dd;
    let t2 = (h - oo) / dd;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    return tmin <= tmax;
  };
  if (!slab(lox, ldx, hx)) return -1;
  if (!slab(oy, d.y, hy)) return -1;
  if (!slab(loz, ldz, hz)) return -1;
  return tmin;
}

// Deterministic pellet spread for shotguns (same on client & server).
export function pelletDirs(dir, count, spreadDeg, seed) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [];
  // basis
  const up = Math.abs(dir.y) > 0.95 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  let rx = up.y * dir.z - up.z * dir.y;
  let ry = up.z * dir.x - up.x * dir.z;
  let rz = up.x * dir.y - up.y * dir.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const ux = dir.y * rz - dir.z * ry;
  const uy = dir.z * rx - dir.x * rz;
  const uz = dir.x * ry - dir.y * rx;
  const sp = (spreadDeg * Math.PI) / 180;
  for (let i = 0; i < count; i++) {
    const ang = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * Math.tan(sp);
    const a1 = Math.cos(ang) * r;
    const a2 = Math.sin(ang) * r;
    let x = dir.x + rx * a1 + ux * a2;
    let y = dir.y + ry * a1 + uy * a2;
    let z = dir.z + rz * a1 + uz * a2;
    const l = Math.hypot(x, y, z) || 1;
    x /= l;
    y /= l;
    z /= l;
    out.push({ x, y, z });
  }
  return out;
}

// Apply a random cone offset to a direction.
export function spreadDir(dir, spreadDeg, rand) {
  return pelletDirs(dir, 1, spreadDeg, Math.floor(rand() * 4294967295))[0];
}
