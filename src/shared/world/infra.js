// Civil and transport infrastructure: airports, stations, border posts,
// fuel stations, oil fields, power lines, downtown towers, monasteries.
import { MAT } from './materials.js';
import { BF } from './builder.js';
import { house, lamp, flagpole, crates, fuelTanks, concreteBarrier, sandbagWall, hangar, controlTower, silo } from './prefabs.js';
import { officeBuilding, LVL } from './buildings.js';

const S = BF.SOLID | BF.RENDER;
const COVER = S | BF.COVER;
const SMALL = S | BF.SMALL;
const SMALLCOVER = S | BF.SMALL | BF.COVER;
const DECO = BF.RENDER | BF.SMALL;

// Runway along local X, centred on the origin.
export function runway(b, len, width = 42) {
  b.box(-len / 2, 0, -width / 2, len / 2, 0.08, width / 2, MAT.ASPHALT, S);
  for (let x = -len / 2 + 30; x < len / 2 - 30; x += 24) b.box(x, 0.08, -0.4, x + 12, 0.09, 0.4, MAT.PAINT_WHITE, DECO);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const z = -width / 2 + 5 + k * ((width - 10) / 5);
      b.box(s * (len / 2 - 22) - 8, 0.08, z - 0.7, s * (len / 2 - 22) + 8, 0.09, z + 0.7, MAT.PAINT_WHITE, DECO);
    }
    b.box(-len / 2, 0.08, s * (width / 2 - 1.2) - 0.25, len / 2, 0.09, s * (width / 2 - 1.2) + 0.25, MAT.PAINT_WHITE, DECO);
  }
  for (let x = -len / 2; x <= len / 2; x += 60) {
    for (const s of [-1, 1]) b.box(x - 0.2, 0, s * (width / 2 + 1.5) - 0.2, x + 0.2, 0.5, s * (width / 2 + 1.5) + 0.2, MAT.LAMP, DECO);
  }
}

// Full airport: runway, taxiway, apron, terminal, tower, hangars, fuel.
// Returns local positions of parking spots for aircraft.
export function airport(b, len, name) {
  runway(b, len, 42);
  // taxiway parallel to the runway and apron in front of the terminal
  b.box(-len / 2 + 60, 0, 44, len / 2 - 60, 0.07, 62, MAT.ASPHALT, S);
  for (const x of [-len / 2 + 80, len / 2 - 80]) b.box(x - 9, 0, 20, x + 9, 0.07, 44, MAT.ASPHALT, S);
  b.box(-110, 0, 62, 110, 0.07, 130, MAT.CONCRETE_DARK, S);
  const spots = [];
  for (let i = 0; i < 4; i++) {
    const x = -80 + i * 50;
    b.box(x - 0.3, 0.07, 70, x + 0.3, 0.08, 112, MAT.HAZARD, DECO);
    spots.push({ x, z: 95, yaw: Math.PI, kind: i % 2 ? 'plane' : 'transport' });
  }
  b.push(0, 0, 150, 2);
  b.building('terminal', () => officeBuilding(b, {
    name, w: 60, d: 22, wall: MAT.WINDOW, entrance: LVL.PUBLIC,
    front: [{ name: 'Check-in Hall', w: 22, kind: 'mess' }, { name: 'Terminal Entrance', w: 12, lobby: true }, { name: 'Departures', w: 26, kind: 'briefing' }],
    back: [{ name: 'Operations', w: 20, kind: 'office', level: LVL.OFFICER }, { name: 'Baggage Hall', w: 40, kind: 'storage' }],
  }), { name });
  b.pop();
  b.push(140, 0, 110, 0);
  controlTower(b);
  b.pop();
  for (const x of [-190, -150]) {
    b.push(x, 0, 96, 0);
    b.building('hangar', () => hangar(b, 34, 28), { name: 'Hangar' });
    b.pop();
  }
  b.push(200, 0, 100, 0);
  fuelTanks(b);
  b.pop();
  b.marker('airport', 0, 0.2, 95, 120, { name });
  return spots;
}

// Station platform beside a straight rail segment along local X at z=0.
export function station(b, len, name) {
  b.box(-len / 2, 0, 3.2, len / 2, 1.05, 9, MAT.CONCRETE, S); // platform
  b.box(-len / 2, 1.05, 3.2, len / 2, 1.1, 3.5, MAT.HAZARD, DECO);
  for (let x = -len / 2 + 4; x <= len / 2 - 4; x += 8) b.box(x - 0.2, 1.05, 7.8, x + 0.2, 5.4, 8.2, MAT.DARK_METAL, S);
  b.box(-len / 2 + 2, 5.4, 3.6, len / 2 - 2, 5.7, 9.2, MAT.ROOF_METAL, S);
  b.push(0, 0, 17, 2);
  b.building('station', () => house(b, 22, 9, 2, { wall: MAT.BRICK, roof: MAT.ROOF_TILE, backDoor: true }), { name });
  b.pop();
  lamp(b, -len / 3, 11, 5);
  lamp(b, len / 3, 11, 5);
  b.marker('station', 0, 1.2, 6, len / 2, { name });
}

// Border crossing across a road running along local Z through x=0.
export function borderPost(b, roadW, flagsKey) {
  const half = roadW / 2 + 1;
  // canopy over the lanes
  for (const x of [-half - 0.6, half + 0.6]) for (const z of [-5, 5]) b.box(x - 0.3, 0, z - 0.3, x + 0.3, 5.2, z + 0.3, MAT.DARK_METAL, S);
  b.box(-half - 1.2, 5.2, -6, half + 1.2, 5.7, 6, MAT.PAINT_WHITE, S);
  // booths and barrier arms (both directions)
  for (const s of [-1, 1]) {
    b.box(s * (half + 3) - 1.3, 0, -1.3 * s - 1, s * (half + 3) + 1.3, 2.7, -1.3 * s + 1, MAT.PAINT_WHITE, COVER);
    b.box(s * (half + 3) - 1.1, 1.1, -1.3 * s - 1.05, s * (half + 3) + 1.1, 2.1, -1.3 * s + 1.05, MAT.WINDOW, DECO);
    b.box(s * half - 0.2, 0, s * 8 - 0.2, s * half + 0.2, 1.2, s * 8 + 0.2, MAT.HAZARD, SMALL);
    b.box(Math.min(s * half, 0), 1.0, s * 8 - 0.08, Math.max(s * half, 0), 1.15, s * 8 + 0.08, MAT.HAZARD, DECO);
  }
  // customs office beside the road
  b.push(half + 12, 0, 0, 3);
  b.building('customs', () => house(b, 12, 8, 1, { wall: MAT.CONCRETE, roof: MAT.ROOF_METAL, flatRoof: true, backDoor: true }), { name: 'Customs House' });
  b.pop();
  for (const z of [-14, 14]) {
    concreteBarrier(b, -half - 2, z, 1);
    concreteBarrier(b, half + 2, z, 1);
  }
  sandbagWall(b, -half - 6, -3, 4, 1);
  flagpole(b, `${flagsKey}:a`, -half - 4, -9, 8);
  flagpole(b, `${flagsKey}:b`, -half - 4, 9, 8);
  lamp(b, half + 4, -12, 6);
  lamp(b, -half - 4, 12, 6);
  b.marker('border', 0, 0.2, 0, 12);
}

export function gasStation(b) {
  b.box(-11, 0, -8, 11, 0.1, 8, MAT.CONCRETE, S);
  for (const x of [-6, 6]) for (const z of [-3, 3]) b.box(x - 0.25, 0.1, z - 0.25, x + 0.25, 4.6, z + 0.25, MAT.PAINT_WHITE, S);
  b.box(-8, 4.6, -4.5, 8, 5.1, 4.5, MAT.FLAG_RED, S);
  for (const x of [-3, 3]) b.box(x - 0.4, 0.1, -0.6, x + 0.4, 1.6, 0.6, MAT.PAINT_WHITE, SMALLCOVER);
  b.push(0, 0, 13, 2);
  b.building('shop', () => house(b, 12, 7, 1, { wall: MAT.PLASTER, roof: MAT.ROOF_METAL, flatRoof: true }), { name: 'Fuel Station' });
  b.pop();
  lamp(b, -10, -7, 6);
}

export function oilDerrick(b) {
  b.box(-3, 0, -3, 3, 0.6, 3, MAT.CONCRETE_DARK, S);
  b.prop('mast', 0, 0.6, 0, { h: 18, w: 3, m: MAT.RUST });
  b.box(-1.2, 0.6, -1.2, 1.2, 18, 1.2, MAT.RUST, BF.SOLID);
  b.box(-0.5, 18, -0.5, 0.5, 19.5, 0.5, MAT.DARK_METAL, DECO);
  // pumpjack beside it
  b.box(4, 0, -1, 9, 0.5, 1, MAT.CONCRETE_DARK, S);
  b.box(5.5, 0.5, -0.4, 6.3, 3.4, 0.4, MAT.HAZARD, SMALL);
  b.box(3.8, 3.4, -0.3, 9.4, 3.9, 0.3, MAT.HAZARD, DECO);
  b.cylinder(-5, 0, 3, 1.6, 3.4, MAT.RUST, true, 10);
}

export function pipeline(b, len, rot = 0) {
  for (let o = -len / 2; o < len / 2; o += 8) {
    const x = rot ? 0 : o;
    const z = rot ? o : 0;
    b.box(x - 0.2, 0, z - 0.2, x + 0.2, 1.1, z + 0.2, MAT.DARK_METAL, DECO);
  }
  if (rot) b.box(-0.45, 1.1, -len / 2, 0.45, 2.0, len / 2, MAT.RUST, SMALLCOVER);
  else b.box(-len / 2, 1.1, -0.45, len / 2, 2.0, 0.45, MAT.RUST, SMALLCOVER);
}

export function pylon(b) {
  b.prop('mast', 0, 0, 0, { h: 24, w: 3.5, m: MAT.DARK_METAL });
  b.box(-0.8, 0, -0.8, 0.8, 24, 0.8, MAT.DARK_METAL, BF.SOLID);
  b.box(-6, 20.5, -0.2, 6, 21, 0.2, MAT.DARK_METAL, DECO);
}

// Downtown office tower: glass and concrete bands.
export function highrise(b, w, d, floors) {
  const FH = 3.4;
  b.building('tower', () => {
    b.foundation(w, d);
    for (let f = 0; f < floors; f++) {
      const y = f * FH;
      b.box(-w / 2, y, -d / 2, w / 2, y + 1.0, d / 2, MAT.CONCRETE, f === 0 ? COVER | BF.BUILDING : S | BF.BUILDING);
      b.box(-w / 2 + 0.25, y + 1.0, -d / 2 + 0.25, w / 2 - 0.25, y + FH, d / 2 - 0.25, MAT.WINDOW, S | BF.BUILDING);
    }
    const H = floors * FH;
    b.box(-w / 2 - 0.3, H, -d / 2 - 0.3, w / 2 + 0.3, H + 0.8, d / 2 + 0.3, MAT.CONCRETE_DARK, S | BF.BUILDING);
    b.cbox(0, H + 0.8, 0, w * 0.4, 3, d * 0.4, MAT.METAL, SMALL);
    if (floors > 10) b.box(-0.2, H + 3.8, -0.2, 0.2, H + 12, 0.2, MAT.DARK_METAL, DECO);
    b.prop('sphere', 0, H + (floors > 10 ? 12.2 : 4), 0, { r: 0.35, m: MAT.LAMP, blink: true });
  }, { name: 'Office Tower' });
  b.light(0, 3, -d / 2 - 0.6, 14);
}

export function monastery(b) {
  b.building('monastery', () => {
    house(b, 12, 22, 2, { wall: MAT.STONE, roof: MAT.ROOF_TILE, backDoor: true });
    b.push(0, 0, -13.5, 0);
    b.foundation(5, 5);
    b.box(-2.5, 0, -2.5, 2.5, 16, 2.5, MAT.STONE, COVER | BF.BUILDING);
    b.prop('cone', 0, 16, 0, { r: 3.2, h: 6, m: MAT.ROOF_TILE, seg: 4 });
    b.pop();
  }, { name: 'Monastery' });
  for (const [x, z, len, r] of [[-12, 0, 30, 1], [12, 0, 30, 1], [0, 15, 24, 0]]) {
    b.push(x, 0, z, 0);
    if (r) b.box(-0.5, 0, -len / 2, 0.5, 2.4, len / 2, MAT.STONE, COVER);
    else b.box(-len / 2, 0, -0.5, len / 2, 2.4, 0.5, MAT.STONE, COVER);
    b.pop();
  }
}

export function farmstead(b) {
  b.building('farmhouse', () => house(b, 11, 9, 2, { wall: MAT.PLASTER_WARM, roof: MAT.ROOF_TILE, chimney: true }), { name: 'Farmhouse' });
  b.push(16, 0, 4, 1);
  b.building('barn', () => {
    const w = 12;
    const d = 16;
    b.foundation(w, d);
    b.box(-w / 2, 0, -d / 2, w / 2, 0.1, d / 2, MAT.WOOD_DARK, S);
    b.wall(-w / 2, -d / 2, w / 2, -d / 2, 0, 5.5, 0.3, MAT.WOOD, [{ c: w / 2, w: 4.2, y0: 0, y1: 4.2 }], BF.COVER);
    b.wall(-w / 2, d / 2, w / 2, d / 2, 0, 5.5, 0.3, MAT.WOOD, [], BF.COVER);
    b.wall(-w / 2, -d / 2, -w / 2, d / 2, 0, 5.5, 0.3, MAT.WOOD, [{ c: d / 2, w: 1.4, y0: 0, y1: 2.3 }], BF.COVER);
    b.wall(w / 2, -d / 2, w / 2, d / 2, 0, 5.5, 0.3, MAT.WOOD, [], BF.COVER);
    b.box(-w / 2 - 0.3, 5.5, -d / 2 - 0.3, w / 2 + 0.3, 5.7, d / 2 + 0.3, MAT.WOOD_DARK, S);
    b.prop('prism', 0, 5.7, 0, { w: w + 1, d: d + 0.6, h: 3.8, m: MAT.ROOF_METAL });
  }, { name: 'Barn' });
  b.pop();
  b.push(-10, 0, 10, 0);
  silo(b, 2.6, 12);
  b.pop();
  crates(b, 6, -8, 2);
}

export function shopRow(b, n, m) {
  for (let i = 0; i < n; i++) {
    b.push(-((n - 1) * 9) / 2 + i * 9, 0, 0, 0);
    b.building('shop', () => house(b, 8.6, 10, 2, { wall: m ?? b.rng.pick([MAT.PLASTER, MAT.PLASTER_WARM, MAT.BRICK]), flatRoof: true, backDoor: true }), { name: 'Shop' });
    b.box(-4, 2.8, -6.6, 4, 2.95, -5, MAT.CANVAS, DECO);
    b.pop();
  }
}

export function pier(b, len, w = 5) {
  b.box(-w / 2, -0.35, -len / 2, w / 2, 0.0, len / 2, MAT.WOOD_DARK, S | BF.WALKSURF);
  for (let z = -len / 2 + 2; z < len / 2; z += 5) {
    b.box(-w / 2, -5, z - 0.2, -w / 2 + 0.4, -0.35, z + 0.2, MAT.WOOD_DARK, DECO);
    b.box(w / 2 - 0.4, -5, z - 0.2, w / 2, -0.35, z + 0.2, MAT.WOOD_DARK, DECO);
  }
}
