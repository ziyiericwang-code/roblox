// Military bases: country headquarters (High Command, training grounds,
// barracks, restricted command buildings) and regional garrisons.
// Everything is authored in a local frame (front = -Z = main gate).
import { MAT } from './materials.js';
import { BF } from './builder.js';
import * as P from './prefabs.js';
import { highCommand, regionalHQ, officersQuarters, ncoHall, operationsCenter, messHall, medicalCenter, guardhouse, artilleryPiece, LVL } from './buildings.js';
import { clamp } from '../math.js';

// Base footprints (half extents, local frame).
export const HQ_HALF = [190, 150];
export const GARRISON_HALF = [115, 92];

function perimeter(b, W, D, gates, dom) {
  const side = (ax, az, bx, bz, list) => {
    const alongX = az === bz;
    const len = alongX ? Math.abs(bx - ax) : Math.abs(bz - az);
    const start = alongX ? Math.min(ax, bx) : Math.min(az, bz);
    const cuts = list.map((g) => [g - 10, g + 10]).sort((p, q) => p[0] - q[0]);
    let cur = start;
    const segs = [];
    for (const [g0, g1] of cuts) {
      if (g0 > cur) segs.push([cur, g0]);
      cur = Math.max(cur, g1);
    }
    if (cur < start + len) segs.push([cur, start + len]);
    for (const [s0, s1] of segs) {
      const mid = (s0 + s1) / 2;
      const l = s1 - s0;
      if (l < 1.5) continue;
      b.push(alongX ? mid : ax, 0, alongX ? az : mid, 0);
      P.hescoLine(b, l, alongX ? 0 : 1);
      b.pop();
    }
    for (const g of list) {
      const gx = alongX ? g : ax;
      const gz = alongX ? az : g;
      for (const s of [-1, 1]) {
        const px = alongX ? gx + s * 10.5 : gx;
        const pz = alongX ? gz : gz + s * 10.5;
        b.cbox(px, 0, pz, 1.8, 3.4, 1.8, dom ? MAT.CONCRETE_DARK : MAT.CONCRETE, BF.SOLID | BF.RENDER | BF.COVER);
      }
      b.marker('guard', alongX ? gx + 7 : gx + (ax > 0 ? -5 : 5), 0, alongX ? gz + (az > 0 ? -5 : 5) : gz + 7, 2, { gate: true, lookX: gx, lookZ: gz + (az > 0 ? 40 : -40) });
      b.light(gx, 4.5, gz, 20);
    }
  };
  side(-W, -D, W, -D, gates.N || []);
  side(-W, D, W, D, gates.S || []);
  side(-W, -D, -W, D, gates.W || []);
  side(W, -D, W, D, gates.E || []);
  for (const [cx, cz] of [[-W + 5, -D + 5], [W - 5, -D + 5], [-W + 5, D - 5], [W - 5, D - 5]]) {
    b.push(cx, 0, cz, 0);
    P.watchtower(b);
    b.pop();
    b.marker('guard', cx, 5.45, cz, 1.5, { tower: true });
  }
}

// Country headquarters. Returns base info (spawns, vehicle slots...).
export function buildHQ(b, base, faction, fname) {
  const [W, D] = HQ_HALF;
  const info = { id: base.id, name: base.name, faction, spawns: [], x: base.x, z: base.z, y: base.y, rot: base.rot, rect: base.rot & 1 ? [D, W] : [W, D] };
  b.push(base.x, 0, base.z, base.rot);
  b.oy = base.y;
  perimeter(b, W, D, { N: [0], E: [-40] }, faction === 2);
  guardhouse(b);
  b.push(16, 0, -D + 14, 0);
  guardhouse(b);
  b.pop();

  // --- central avenue, parade ground, flag, assignment board
  b.box(-7, 0, -D, 7, 0.06, 60, MAT.ASPHALT, BF.RENDER | BF.SOLID);
  b.push(0, 0, -92, 0);
  P.paradeGround(b, 44, 34);
  b.pop();
  P.flagpole(b, 'country', 0, -118, 14);
  b.push(-20, 0, -70, 0);
  P.missionBoard(b);
  b.pop();
  b.marker('assign', -20, 0.2, -72, 3, { name: 'Assignment Office' });

  // --- spawn yard (deploy point) next to the parade ground
  const spawnC = [34, -118];
  b.box(spawnC[0] - 16, 0, spawnC[1] - 12, spawnC[0] + 16, 0.06, spawnC[1] + 12, MAT.GRAVEL, BF.RENDER);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const [wx, wz] = b.toWorld(spawnC[0] + Math.cos(a) * 9, spawnC[1] + Math.sin(a) * 7);
    info.spawns.push({ x: wx, z: wz, y: base.y + 0.1 });
  }
  b.marker('spawn_yard', spawnC[0], 0.2, spawnC[1], 14);

  // --- training grounds (front left): obstacle course, shooting range, recruit barracks
  b.push(-150, 0, -135, 0);
  P.obstacleCourse(b);
  b.pop();
  b.marker('drill', -150, 0.2, -110, 10, { persona: 'drill_sergeant' });
  b.push(-95, 0, -60, 1);
  P.shootingRange(b, 6);
  b.pop();
  b.marker('range_pos', -95, 0.2, -60, 14);
  b.zone('Training Grounds', LVL.PUBLIC, -185, -148, -70, -30, -1, 8, { training: true });
  for (const z of [-20, 0]) {
    b.push(-150, 0, z, 0);
    b.building('barracks', () => P.barracks(b, 30, 10), { name: 'Recruit Barracks' });
    b.pop();
  }

  // --- motor pool and helipads (front right)
  const pads = [
    ['tank', 175, -120], ['apc', 175, -100], ['apc', 175, -80], ['truck', 155, -120], ['truck', 155, -100],
    ['jeep', 135, -120], ['jeep', 135, -100], ['recon', 115, -120], ['car', 115, -100], ['truck', 155, -80],
  ];
  for (const [type, x, z] of pads) {
    b.push(x, 0, z, 0);
    P.vehiclePad(b, type === 'tank' ? 7 : 6, type === 'tank' ? 12 : 10);
    b.pop();
    b.marker('vehicle', x, 0.3, z, 4, { vtype: type, yaw: b.yawWorld(0), faction, base: base.id });
  }
  for (const x of [95, 72]) {
    b.push(x, 0, -65, 0);
    b.building('garage', () => P.garage(b, 16, 11), { name: 'Garage' });
    b.pop();
  }
  b.marker('work', 95, 0.2, -65, 3, { activity: 'repair', persona: 'mechanic' });
  b.marker('work', 155, 0.2, -90, 3, { activity: 'repair' });
  for (const [x, z] of [[120, -30], [160, -30]]) {
    b.push(x, 0, z, 0);
    P.helipad(b, 10);
    b.pop();
    b.marker('vehicle', x, 0.3, z, 6, { vtype: 'heli', yaw: b.yawWorld(0), faction, base: base.id });
  }
  b.marker('pilot', 140, 0.2, -12, 3, { persona: 'pilot' });
  b.push(170, 0, 20, 0);
  P.fuelTanks(b);
  b.pop();

  // --- life of the base (middle band): barracks, mess, medical, armory
  for (const z of [30, 52]) {
    b.push(-150, 0, z, 0);
    b.building('barracks', () => P.barracks(b, 30, 10), { name: 'Barracks' });
    b.pop();
  }
  b.push(-80, 0, -10, 0);
  messHall(b);
  b.pop();
  b.push(-40, 0, 38, 2);
  medicalCenter(b);
  b.pop();
  b.push(60, 0, 12, 0);
  b.building('armory', () => P.armory(b), { name: 'Armory' });
  b.pop();
  b.marker('armory', 60, 0.2, 5, 4, { persona: 'quartermaster' });

  // --- leadership buildings (back): NCO hall, officers, operations, High Command
  b.push(-110, 0, 95, 0);
  ncoHall(b);
  b.pop();
  b.push(-55, 0, 125, 0);
  officersQuarters(b);
  b.pop();
  b.push(90, 0, 100, 0);
  operationsCenter(b);
  b.pop();
  b.push(0, 0, 88, 0);
  highCommand(b, `${fname} High Command`);
  b.pop();
  // courtyard in front of High Command where senior officers are seen
  b.box(-26, 0, 50, 26, 0.07, 66, MAT.STONE, BF.RENDER | BF.SOLID);
  for (const x of [-18, 18]) P.lamp(b, x, 58, 5);
  b.marker('courtyard', 0, 0.2, 58, 14);
  // staff cars
  for (const x of [34, 40]) b.marker('vehicle', x, 0.3, 60, 3, { vtype: 'car', yaw: b.yawWorld(Math.PI / 2), faction, base: base.id, staff: true });

  // --- lamps, tents, clutter
  for (const [x, z] of [[-30, -120], [40, -60], [-60, 20], [60, 60], [-100, 70], [130, 40], [0, -30]]) P.lamp(b, x, z);
  for (const [x, z] of [[-40, -130], [-52, -130]]) {
    b.push(x, 0, z, 0);
    P.tent(b, 6, 5, faction === 2 ? MAT.OLIVE : MAT.CANVAS);
    b.pop();
  }
  P.crates(b, 70, -20, 4);
  // ambient life markers
  b.marker('talk', -20, 0.2, -40, 2);
  b.marker('talk', 30, 0.2, 20, 2);
  b.marker('talk', -60, 0.2, 70, 2);
  b.marker('carry_a', 60, 0.2, 0, 2);
  b.marker('carry_b', 150, 0.2, -60, 2);
  b.marker('patrol', -W + 12, 0.2, -D + 12, 2);
  b.marker('patrol', W - 12, 0.2, -D + 12, 2);
  b.marker('patrol', W - 12, 0.2, D - 12, 2);
  b.marker('patrol', -W + 12, 0.2, D - 12, 2);
  b.pop();
  return info;
}

// Regional garrison (a capturable territory with a regional headquarters).
export function buildGarrison(b, t, rot) {
  const [W, D] = GARRISON_HALF;
  b.push(t.x, 0, t.z, rot);
  b.oy = t.y;
  perimeter(b, W, D, { N: [0], S: [30], E: [-20], W: [20] }, t.country === 2);
  guardhouse(b);
  b.box(-6, 0, -D, 6, 0.06, 40, MAT.ASPHALT, BF.RENDER | BF.SOLID);
  b.push(0, 0, 45, 0);
  regionalHQ(b, `${t.name} Headquarters`);
  b.pop();
  b.push(-70, 0, -40, 0);
  b.building('barracks', () => P.barracks(b, 28, 10), { name: 'Barracks' });
  b.pop();
  b.push(-70, 0, -15, 0);
  b.building('barracks', () => P.barracks(b, 28, 10), { name: 'Barracks' });
  b.pop();
  b.push(-68, 0, 40, 0);
  ncoHall(b, 'NCO Quarters');
  b.pop();
  b.push(70, 0, -45, 0);
  b.building('garage', () => P.garage(b, 16, 11), { name: 'Garage' });
  b.pop();
  for (const [type, x, z] of [['apc', 95, -20], ['truck', 80, -20], ['jeep', 65, -20], ['tank', 95, 5]]) {
    b.push(x, 0, z, 0);
    P.vehiclePad(b, 6, 10);
    b.pop();
    b.marker('vehicle', x, 0.3, z, 4, { vtype: type, yaw: b.yawWorld(0), faction: t.country, territory: t.id });
  }
  b.push(80, 0, 55, 0);
  P.helipad(b, 9);
  b.pop();
  b.marker('vehicle', 80, 0.3, 55, 6, { vtype: 'heli', yaw: b.yawWorld(0), faction: t.country, territory: t.id });
  // artillery park and trenches
  for (let i = 0; i < 4; i++) artilleryPiece(b, -95 + i * 12, 72);
  b.push(0, 0, -D - 28, 0);
  P.trench(b, 80, 0);
  b.pop();
  P.flagpole(b, 'country', 10, -D + 22, 11);
  b.marker('talk', -30, 0.2, 10, 2);
  b.marker('talk', 30, 0.2, 20, 2);
  b.marker('patrol', -W + 10, 0.2, -D + 10, 2);
  b.marker('patrol', W - 10, 0.2, D - 10, 2);
  b.pop();
}

// Rotation (0..3) of a local frame whose front (-Z) faces direction (dx,dz).
export function rotFacing(dx, dz) {
  if (Math.abs(dx) > Math.abs(dz)) return dx < 0 ? 1 : 3;
  return dz < 0 ? 0 : 2;
}

export function localToWorld(cx, cz, rot, lx, lz) {
  switch (rot & 3) {
    case 0: return [cx + lx, cz + lz];
    case 1: return [cx + lz, cz - lx];
    case 2: return [cx - lx, cz - lz];
    default: return [cx - lz, cz + lx];
  }
}

export function gatePoint(base, half, extra = 25) {
  const [x, z] = localToWorld(base.x, base.z, base.rot, 0, -half[1] - extra);
  return { x: clamp(x, -3000, 3000), z: clamp(z, -3000, 3000) };
}
