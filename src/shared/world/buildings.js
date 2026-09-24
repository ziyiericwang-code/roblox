// Enterable military buildings with interior rooms and access control.
// Every room can require a clearance level (see config/ranks.js ACCESS); the
// builder records those rooms as zones the simulation enforces, so a Private
// physically cannot walk into the General's office.
import { MAT } from './materials.js';
import { BF } from './builder.js';
import { sandbagWall, flagpole, lamp, crates, bunker as smallBunker } from './prefabs.js';

const S = BF.SOLID | BF.RENDER;
const COVER = S | BF.COVER;
const SMALL = S | BF.SMALL;
const SMALLCOVER = S | BF.SMALL | BF.COVER;
const DECO = BF.RENDER | BF.SMALL;
const WALL_H = 4.2;

// Access levels (mirrors config/ranks.js ACCESS; duplicated to avoid a cycle).
export const LVL = { PUBLIC: 0, NCO: 1, OFFICER: 2, COMMAND: 3, REGIONAL: 4, HIGH: 5, GENERAL: 6 };

function windows(len, spacing = 3.6) {
  const out = [];
  const count = Math.max(0, Math.floor((len - 1.5) / spacing));
  const step = len / (count + 1);
  for (let i = 1; i <= count; i++) out.push({ c: step * i, w: 1.4, y0: 1.1, y1: 2.7 });
  return out;
}

// ---------------------------------------------------------------- furniture
function desk(b, x, z, rot = 0) {
  if (rot) b.cbox(x, 0.2, z, 0.9, 0.78, 1.8, MAT.WOOD_DARK, SMALLCOVER);
  else b.cbox(x, 0.2, z, 1.8, 0.78, 0.9, MAT.WOOD_DARK, SMALLCOVER);
  b.cbox(x + (rot ? 0.2 : 0), 0.98, z + (rot ? 0 : 0.2), 0.5, 0.35, 0.35, MAT.BLACK, DECO); // radio/terminal
}

function furnish(b, room) {
  const { x0, z0, x1, z1, kind } = room;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const w = x1 - x0;
  const d = z1 - z0;
  switch (kind) {
    case 'maptable':
      b.cbox(cx, 0.2, cz, Math.min(w - 3, 7), 0.85, Math.min(d - 3, 4), MAT.WOOD_DARK, SMALLCOVER);
      b.prop('maptable', cx, 1.06, cz, { w: Math.min(w - 3.2, 6.8), d: Math.min(d - 3.2, 3.8) });
      b.marker('map_table', cx, 0.2, cz, 4.5, { level: room.level, room: room.name });
      for (let i = -1; i <= 1; i += 2) b.cbox(cx + i * (Math.min(w - 3, 7) / 2 + 0.7), 0.2, cz, 0.5, 0.5, 0.5, MAT.DARK_METAL, DECO);
      break;
    case 'war':
      b.cbox(cx, 0.2, cz, Math.min(w - 4, 6), 0.85, Math.min(d - 4, 2.6), MAT.WOOD_DARK, SMALLCOVER);
      b.prop('maptable', cx, 1.06, cz, { w: Math.min(w - 4.2, 5.8), d: Math.min(d - 4.2, 2.4) });
      b.marker('map_table', cx, 0.2, cz, 4, { level: room.level, room: room.name });
      // wall of screens
      b.box(x0 + 1, 1.2, z1 - 0.45, x1 - 1, 3.2, z1 - 0.3, MAT.WINDOW, DECO);
      break;
    case 'comms':
      for (let x = x0 + 1.4; x < x1 - 1; x += 1.8) {
        b.box(x - 0.7, 0.2, z1 - 1.1, x + 0.7, 1.9, z1 - 0.35, MAT.DARK_METAL, SMALL);
        b.box(x - 0.5, 1.2, z1 - 1.15, x + 0.5, 1.6, z1 - 1.1, MAT.LAMP, DECO);
      }
      desk(b, cx, cz, 0);
      b.marker('radio', cx, 0.2, cz, 3, { level: room.level });
      break;
    case 'general':
      b.cbox(cx, 0.2, cz + d * 0.15, 3.2, 0.8, 1.4, MAT.WOOD_DARK, SMALLCOVER);
      b.cbox(cx, 0.2, cz + d * 0.15 + 1.4, 0.8, 1.2, 0.8, MAT.CANVAS, DECO); // chair
      for (const s of [-1, 1]) b.box(cx + s * 2.6 - 0.05, 0.2, z1 - 0.8, cx + s * 2.6 + 0.05, 2.8, z1 - 0.7, MAT.DARK_METAL, DECO);
      b.cbox(x0 + 0.8, 0.2, cz, 0.6, 2.0, 2.6, MAT.WOOD_DARK, SMALL); // bookcase
      b.marker('general_desk', cx, 0.2, cz + d * 0.15 + 1.2, 2, { level: room.level });
      break;
    case 'briefing':
      for (let z = cz - d / 2 + 2.2; z < cz + d / 2 - 1.8; z += 1.6) {
        for (let x = x0 + 1.5; x < x1 - 1.2; x += 1.3) b.cbox(x, 0.2, z, 0.5, 0.5, 0.5, MAT.OLIVE, DECO);
      }
      b.box(x0 + 1, 1.0, z0 + 0.35, x1 - 1, 2.6, z0 + 0.5, MAT.PAINT_WHITE, DECO); // board
      b.marker('briefing', cx, 0.2, cz, 3, { level: room.level });
      break;
    case 'mess':
      for (let z = z0 + 2; z < z1 - 1.5; z += 2.6) b.box(x0 + 1.5, 0.2, z - 0.45, x1 - 1.5, 0.95, z + 0.45, MAT.WOOD, SMALLCOVER);
      break;
    case 'dorm':
      for (let x = x0 + 1.2; x < x1 - 0.8; x += 2.2) b.box(x - 0.45, 0.2, z1 - 2.3, x + 0.45, 0.75, z1 - 0.4, MAT.OLIVE, SMALL);
      break;
    case 'storage':
      crates(b, cx, cz, 4);
      break;
    default: // office
      desk(b, cx - w * 0.2, cz, 0);
      if (w > 7) desk(b, cx + w * 0.22, cz, 0);
      b.cbox(x1 - 0.6, 0.2, z0 + 0.8, 0.8, 1.8, 0.6, MAT.DARK_METAL, SMALL); // cabinet
      b.marker('desk', cx - w * 0.2, 0.2, cz + 1, 1.5, { level: room.level });
  }
  b.light(cx, WALL_H - 0.4, cz, Math.max(w, d) * 0.9);
}

// Single-storey building: rooms either side of a central corridor running
// along X, lobby at the front centre with the main entrance. Front is -Z.
// spec: {w, d, wall, front:[{name,w,kind,level,lobby}], back:[...], entrance (level), name}
export function officeBuilding(b, spec) {
  const { w, d } = spec;
  const wallM = spec.wall ?? MAT.CONCRETE;
  const cw = spec.corridor ?? 3;
  const t = 0.35;
  const H = WALL_H;
  const rooms = [];
  b.foundation(w, d);
  b.box(-w / 2, 0, -d / 2, w / 2, 0.2, d / 2, MAT.CONCRETE_DARK, S | BF.BUILDING);
  // outer walls: front with entrance at the lobby, windows per room
  const frontOpen = [];
  const backOpen = [];
  const addSide = (list, side) => {
    let x = -w / 2;
    for (const r of list) {
      const rx0 = x;
      const rx1 = x + r.w;
      x = rx1;
      const room = side < 0
        ? { name: r.name, kind: r.kind || 'office', level: r.level ?? spec.entrance ?? 0, x0: rx0, x1: rx1, z0: -d / 2, z1: -cw / 2, lobby: !!r.lobby }
        : { name: r.name, kind: r.kind || 'office', level: r.level ?? spec.entrance ?? 0, x0: rx0, x1: rx1, z0: cw / 2, z1: d / 2 };
      rooms.push(room);
      const outer = side < 0 ? frontOpen : backOpen;
      if (room.lobby) outer.push({ c: rx0 + r.w / 2 + w / 2, w: 2.4, y0: 0, y1: 2.9 });
      for (const o of windows(r.w)) {
        if (room.lobby && Math.abs(o.c - r.w / 2) < 2.4) continue;
        outer.push({ ...o, c: o.c + rx0 + w / 2 });
      }
    }
  };
  addSide(spec.front, -1);
  addSide(spec.back, 1);
  b.wall(-w / 2, -d / 2, w / 2, -d / 2, 0, H, t, wallM, frontOpen, BF.COVER);
  b.wall(-w / 2, d / 2, w / 2, d / 2, 0, H, t, wallM, backOpen, BF.COVER);
  // side walls: corridor end doors (west end is an exit, east end windows)
  b.wall(-w / 2, -d / 2, -w / 2, d / 2, 0, H, t, wallM, [{ c: d / 2, w: 1.6, y0: 0, y1: 2.5 }], BF.COVER);
  b.wall(w / 2, -d / 2, w / 2, d / 2, 0, H, t, wallM, [{ c: d / 2, w: 1.4, y0: 1.1, y1: 2.7 }], BF.COVER);
  // corridor walls with a door per room (lobby opens wide)
  for (const side of [-1, 1]) {
    const zc = side * cw / 2;
    const ops = [];
    for (const r of rooms) {
      if ((side < 0) !== (r.z0 < 0)) continue;
      const c = (r.x0 + r.x1) / 2 + w / 2;
      ops.push(r.lobby ? { c, w: Math.min(r.x1 - r.x0 - 1, 6), y0: 0, y1: H } : { c, w: 1.4, y0: 0, y1: 2.4 });
    }
    b.wall(-w / 2, zc, w / 2, zc, 0, H, 0.25, wallM, ops, 0);
  }
  // partitions between rooms
  for (const r of rooms) {
    if (r.x1 >= w / 2 - 0.01) continue;
    b.wall(r.x1, r.z0, r.x1, r.z1, 0, H, 0.25, wallM, [], 0);
  }
  // roof with parapet
  b.box(-w / 2 - 0.3, H, -d / 2 - 0.3, w / 2 + 0.3, H + 0.35, d / 2 + 0.3, MAT.CONCRETE_DARK, S | BF.BUILDING);
  for (const [ax, az, bx, bz] of [[-w / 2, -d / 2, w / 2, -d / 2], [-w / 2, d / 2, w / 2, d / 2], [-w / 2, -d / 2, -w / 2, d / 2], [w / 2, -d / 2, w / 2, d / 2]]) {
    b.wall(ax, az, bx, bz, H + 0.35, 0.7, 0.3, wallM);
  }
  for (const r of rooms) if (!r.lobby) furnish(b, r);
  // lobby: reception desk and a board
  const lobby = rooms.find((r) => r.lobby);
  if (lobby) {
    b.cbox((lobby.x0 + lobby.x1) / 2 + 1.5, 0.2, (lobby.z0 + lobby.z1) / 2, 2.4, 1.0, 0.7, MAT.WOOD_DARK, SMALLCOVER);
    b.light((lobby.x0 + lobby.x1) / 2, H - 0.4, (lobby.z0 + lobby.z1) / 2, 10);
  }
  b.light(0, H - 0.4, 0, w * 0.6);
  // access zones: the whole interior at entrance level, stricter rooms on top
  const lvl = spec.entrance ?? 0;
  if (lvl > 0) b.zone(`${spec.name || 'Building'}`, lvl, -w / 2 + 0.2, -d / 2 + 0.2, w / 2 - 0.2, d / 2 - 0.2, -0.5, H, { building: spec.name || '' });
  for (const r of rooms) {
    if (r.level > lvl) b.zone(r.name, r.level, r.x0 + 0.15, r.z0 + 0.15, r.x1 - 0.15, r.z1 - 0.15, -0.5, H, { building: spec.name || '', room: true });
  }
  // guard / receptionist at the entrance and a room marker per room (personas walk between them)
  b.marker('door', 0, 0.2, -d / 2 - 1.6, 2, { level: lvl, building: spec.name || '' });
  for (const r of rooms) b.marker('room', (r.x0 + r.x1) / 2, 0.2, (r.z0 + r.z1) / 2, Math.min(r.x1 - r.x0, r.z1 - r.z0) / 2 - 0.6, { name: r.name, level: r.level, kind: r.kind, building: spec.name || '' });
  return rooms;
}

// ---------------------------------------------------------------- variants
export function highCommand(b, name) {
  b.building('highcommand', () => {
    officeBuilding(b, {
      name, w: 48, d: 30, wall: MAT.STONE, entrance: LVL.COMMAND,
      front: [
        { name: 'Communications Room', w: 13, kind: 'comms', level: LVL.REGIONAL },
        { name: 'High Command Lobby', w: 12, lobby: true, level: LVL.COMMAND },
        { name: 'Officers’ Area', w: 12, kind: 'mess', level: LVL.COMMAND },
        { name: 'Liaison Office', w: 11, kind: 'office', level: LVL.COMMAND },
      ],
      back: [
        { name: 'General’s Office', w: 12, kind: 'general', level: LVL.GENERAL },
        { name: 'Strategy Room', w: 16, kind: 'maptable', level: LVL.HIGH },
        { name: 'War Room', w: 12, kind: 'war', level: LVL.HIGH },
        { name: 'Staff Office', w: 8, kind: 'office', level: LVL.REGIONAL },
      ],
    });
    // portico, steps and flags
    b.box(-8, 0, -15 - 5, 8, 0.4, -15, MAT.STONE, S);
    for (const x of [-7, -2.4, 2.4, 7]) b.cylinder(x, 0.4, -19, 0.45, 4.6, MAT.PAINT_WHITE, true, 10);
    b.box(-8.4, 5.0, -20.4, 8.4, 5.6, -15, MAT.STONE, S);
    b.box(-0.6, WALL_H + 1, 2, 0.6, WALL_H + 12, 3.2, MAT.DARK_METAL, DECO); // antenna
  }, { destructible: false, name });
  flagpole(b, 'country', -11, -21, 11);
  flagpole(b, 'country', 11, -21, 11);
  sandbagWall(b, -5, -23, 3, 0);
  sandbagWall(b, 5, -23, 3, 0);
  b.marker('guard', -3, 0.2, -22, 1.5, { level: LVL.COMMAND, door: true });
  b.marker('guard', 3, 0.2, -22, 1.5, { level: LVL.COMMAND, door: true });
  b.marker('highcommand', 0, 0.2, 0, 24, { name });
}

export function regionalHQ(b, name) {
  b.building('regionalhq', () => {
    officeBuilding(b, {
      name, w: 38, d: 24, wall: MAT.CONCRETE, entrance: LVL.OFFICER,
      front: [
        { name: 'Operations Room', w: 14, kind: 'maptable', level: LVL.COMMAND },
        { name: 'Headquarters Lobby', w: 10, lobby: true },
        { name: 'Briefing Room', w: 14, kind: 'briefing', level: LVL.OFFICER },
      ],
      back: [
        { name: 'Regional Command', w: 15, kind: 'war', level: LVL.REGIONAL },
        { name: 'Signals', w: 10, kind: 'comms', level: LVL.COMMAND },
        { name: 'Staff Offices', w: 13, kind: 'office', level: LVL.OFFICER },
      ],
    });
    b.box(-0.5, WALL_H, 4, 0.5, WALL_H + 14, 5, MAT.DARK_METAL, DECO);
  }, { destructible: false, name });
  flagpole(b, 'country', -8, -15, 10);
  b.marker('guard', 2.5, 0.2, -14, 1.5, { level: LVL.OFFICER, door: true });
  b.marker('regionalhq', 0, 0.2, 0, 18, { name });
}

export function officersQuarters(b, name = 'Officers’ Quarters') {
  b.building('officers', () => {
    officeBuilding(b, {
      name, w: 30, d: 18, wall: MAT.PLASTER, entrance: LVL.OFFICER,
      front: [
        { name: 'Planning Room', w: 12, kind: 'maptable', level: LVL.OFFICER },
        { name: 'Officers’ Entrance', w: 8, lobby: true },
        { name: 'Adjutant', w: 10, kind: 'office' },
      ],
      back: [
        { name: 'Officers’ Mess', w: 16, kind: 'mess' },
        { name: 'Officers’ Rooms', w: 14, kind: 'dorm' },
      ],
    });
  }, { name });
  b.marker('guard', 2.5, 0.2, -11, 1.5, { level: LVL.OFFICER, door: true });
}

export function ncoHall(b, name = 'Squad Leaders’ Hall') {
  b.building('nco', () => {
    officeBuilding(b, {
      name, w: 26, d: 16, wall: MAT.BRICK, entrance: LVL.NCO,
      front: [
        { name: 'Squad Briefing Room', w: 11, kind: 'briefing' },
        { name: 'NCO Entrance', w: 8, lobby: true },
        { name: 'First Sergeant', w: 7, kind: 'office' },
      ],
      back: [
        { name: 'Squad Command Room', w: 14, kind: 'maptable' },
        { name: 'NCO Lounge', w: 12, kind: 'mess' },
      ],
    });
  }, { name });
}

export function operationsCenter(b, name = 'Operations Center') {
  b.building('operations', () => {
    officeBuilding(b, {
      name, w: 30, d: 20, wall: MAT.CONCRETE_DARK, entrance: LVL.OFFICER,
      front: [
        { name: 'Operations Floor', w: 14, kind: 'war', level: LVL.COMMAND },
        { name: 'Operations Entrance', w: 8, lobby: true },
        { name: 'Signals Room', w: 8, kind: 'comms', level: LVL.COMMAND },
      ],
      back: [
        { name: 'Operations Planning', w: 18, kind: 'maptable', level: LVL.COMMAND },
        { name: 'Duty Office', w: 12, kind: 'office' },
      ],
    });
    b.box(-0.5, WALL_H, 5, 0.5, WALL_H + 10, 6, MAT.DARK_METAL, DECO);
  }, { name });
}

export function messHall(b) {
  b.building('mess', () => {
    officeBuilding(b, {
      name: 'Mess Hall', w: 28, d: 16, wall: MAT.CONCRETE, entrance: LVL.PUBLIC, corridor: 3,
      front: [{ name: 'Mess Hall', w: 10, kind: 'mess' }, { name: 'Mess Entrance', w: 8, lobby: true }, { name: 'Kitchen', w: 10, kind: 'storage' }],
      back: [{ name: 'Dining Room', w: 28, kind: 'mess' }],
    });
  }, { name: 'Mess Hall' });
  b.marker('mess', 0, 0.2, 0, 10);
}

export function medicalCenter(b) {
  b.building('medical', () => {
    officeBuilding(b, {
      name: 'Medical Center', w: 26, d: 16, wall: MAT.PAINT_WHITE, entrance: LVL.PUBLIC,
      front: [{ name: 'Triage', w: 9, kind: 'dorm' }, { name: 'Medical Entrance', w: 8, lobby: true }, { name: 'Surgery', w: 9, kind: 'office' }],
      back: [{ name: 'Ward', w: 26, kind: 'dorm' }],
    });
    b.prop('plane', 0, WALL_H + 0.4, 0, { w: 5, d: 5, m: MAT.RED_CROSS });
  }, { name: 'Medical Center' });
  b.marker('medical', 0, 0.2, -10, 8);
}

export function guardhouse(b) {
  b.building('guardhouse', () => {
    b.foundation(5, 4);
    b.box(-2.5, 0, -2, 2.5, 0.15, 2, MAT.CONCRETE_DARK, S);
    b.wall(-2.5, -2, 2.5, -2, 0, 2.9, 0.3, MAT.CONCRETE, [{ c: 2.5, w: 3.2, y0: 1.1, y1: 2.2 }], BF.COVER);
    b.wall(-2.5, 2, 2.5, 2, 0, 2.9, 0.3, MAT.CONCRETE, [{ c: 1.2, w: 1.2, y0: 0, y1: 2.3 }], BF.COVER);
    b.wall(-2.5, -2, -2.5, 2, 0, 2.9, 0.3, MAT.CONCRETE, [{ c: 2, w: 1.2, y0: 1.1, y1: 2.2 }], BF.COVER);
    b.wall(2.5, -2, 2.5, 2, 0, 2.9, 0.3, MAT.CONCRETE, [{ c: 2, w: 1.2, y0: 1.1, y1: 2.2 }], BF.COVER);
    b.box(-3, 2.9, -2.5, 3, 3.2, 2.5, MAT.ROOF_METAL, S);
  }, { name: 'Guardhouse' });
  b.light(0, 3, -2.6, 12);
}

// ---------------------------------------------------------------- underground
// Bunker dug into the ground. The layout sinks the terrain first (a pad with
// sink:true over footprint + ramp); here we build floor, walls, roof and a stair
// ramp down from the front (-Z). Local y=0 is the surrounding ground level.
export const BUNKER_DEPTH = 4.4;
export function undergroundBunker(b, w, d, opts = {}) {
  const D = BUNKER_DEPTH;
  const t = 0.6;
  const name = opts.name || 'Bunker';
  b.building('bunker', () => {
    // floor, walls, roof
    b.box(-w / 2, -D - 0.4, -d / 2, w / 2, -D, d / 2, MAT.CONCRETE_DARK, S | BF.BUILDING);
    const door = [{ c: w / 2, w: 1.8, y0: 0, y1: 2.5 }];
    b.wall(-w / 2, -d / 2, w / 2, -d / 2, -D, D, t, MAT.CONCRETE, door, BF.COVER);
    b.wall(-w / 2, d / 2, w / 2, d / 2, -D, D, t, MAT.CONCRETE, [], BF.COVER);
    b.wall(-w / 2, -d / 2, -w / 2, d / 2, -D, D, t, MAT.CONCRETE, [], BF.COVER);
    b.wall(w / 2, -d / 2, w / 2, d / 2, -D, D, t, MAT.CONCRETE, [], BF.COVER);
    b.box(-w / 2 - 2.4, -0.05, -d / 2 - 0.3, w / 2 + 2.4, 0.45, d / 2 + 2.4, MAT.CONCRETE_DARK, S | BF.BUILDING); // roof slab
    // interior pillars and cover
    for (let x = -w / 2 + 5; x < w / 2 - 3; x += 6) {
      for (const z of [-d / 4, d / 4]) b.box(x - 0.4, -D, z - 0.4, x + 0.4, -0.05, z + 0.4, MAT.CONCRETE, COVER);
    }
    b.box(-w / 2 + 1, -D, d / 2 - 1.4, w / 2 - 1, -D + 1.9, d / 2 - 0.4, MAT.DARK_METAL, SMALL); // equipment racks
    crates(b, -w / 4, 0, 3);
    crates(b, w / 4, -d / 6, 2);
    if (opts.maptable) {
      b.cbox(0, -D, 0, 4, 0.85, 2.4, MAT.WOOD_DARK, SMALLCOVER);
      b.prop('maptable', 0, -D + 0.86, 0, { w: 3.8, d: 2.2 });
    }
    for (let x = -w / 2 + 3; x < w / 2; x += 7) b.light(x, -0.8, 0, 9, 0xffd8a0);
    // stair ramp: from the ground at z = -d/2 - L down to the floor at the door
    const L = 9;
    b.stairs(0, -d / 2 - 0.3, 0, -d / 2 - L, -D, 0.0, 2.4, MAT.CONCRETE, 'z'); // lowest step at the door
    for (const s of [-1, 1]) {
      b.box(s * 1.35 - 0.3, -D, -d / 2 - L - 0.2, s * 1.35 + 0.3, 0.9, -d / 2 - 0.3, MAT.CONCRETE, COVER);
    }
    b.box(-1.8, 2.3, -d / 2 - 2.4, 1.8, 2.5, -d / 2 - 0.3, MAT.CONCRETE_DARK, S); // entrance canopy
    b.box(-1.8, 0.45, -d / 2 - 0.5, -1.55, 2.3, -d / 2 - 0.3, MAT.CONCRETE, S);
    b.box(1.55, 0.45, -d / 2 - 0.5, 1.8, 2.3, -d / 2 - 0.3, MAT.CONCRETE, S);
  }, { destructible: false, name });
  if (opts.level) b.zone(name, opts.level, -w / 2 + 0.4, -d / 2 + 0.4, w / 2 - 0.4, d / 2 - 0.4, -D - 1, -0.1, { building: name, underground: true });
  b.marker('underground', 0, -D + 0.1, 0, Math.min(w, d) / 2, { name });
  return { floorY: -D };
}

// Sink rectangle for undergroundBunker (in local coords, as pads in world frame).
export function bunkerSinkRects(w, d) {
  return [
    { cx: 0, cz: 0, hx: w / 2 + 2.2, hz: d / 2 + 2.2 },
    { cx: 0, cz: -d / 2 - 4.2, hx: 1.9, hz: 4.3 },
  ];
}

// ---------------------------------------------------------------- field works
export function artilleryPiece(b, x, z) {
  b.push(x, 0, z, 0);
  b.box(-1.2, 0, -1.6, 1.2, 1.0, 1.6, MAT.OLIVE, COVER);
  b.box(-0.15, 1.0, -4.6, 0.15, 1.3, 0, MAT.DARK_METAL, DECO);
  b.box(-0.9, 0, 1.4, -0.7, 0.5, 3.4, MAT.OLIVE, DECO);
  b.box(0.7, 0, 1.4, 0.9, 0.5, 3.4, MAT.OLIVE, DECO);
  sandbagWall(b, 0, -3.2, 5, 0, 0.9);
  b.pop();
}

export function dragonTeeth(b, len, rot = 0) {
  const n = Math.max(2, Math.round(len / 2.2));
  for (let i = 0; i < n; i++) {
    const o = -len / 2 + (i + 0.5) * (len / n);
    for (const row of [-1.1, 1.1]) {
      const x = rot ? row : o;
      const z = rot ? o : row;
      b.prop('cone', x, 0, z, { r: 0.75, h: 1.2, m: MAT.CONCRETE, seg: 4 });
      b.box(x - 0.55, 0, z - 0.55, x + 0.55, 0.9, z + 0.55, MAT.CONCRETE, BF.SOLID | BF.COVER);
    }
  }
}

export function pillbox(b) {
  smallBunker(b, 6, 5);
}

export function coastalGun(b) {
  b.building('battery', () => {
    b.foundation(10, 10);
    b.box(-5, 0, -5, 5, 1.6, 5, MAT.CONCRETE, COVER);
    b.cylinder(0, 1.6, 0, 2.6, 1.6, MAT.OLIVE, true, 12);
    b.box(-0.3, 2.4, -9.5, 0.3, 3.0, -1.5, MAT.DARK_METAL, S);
    sandbagWall(b, 0, 6, 8, 0);
  }, { name: 'Coastal Battery' });
  lamp(b, 6, 6, 5);
}
