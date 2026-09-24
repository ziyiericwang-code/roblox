// Prefab library. Every function draws into a Builder in its local frame
// (origin at ground centre, front facing -Z).
import { MAT } from './materials.js';
import { BF } from './builder.js';

const S = BF.SOLID | BF.RENDER;
const COVER = S | BF.COVER;
const SMALL = S | BF.SMALL;
const SMALLCOVER = S | BF.SMALL | BF.COVER;
const DECO = BF.RENDER | BF.SMALL; // render only

const FLOOR_H = 3.2;

// Evenly spaced window openings along a wall of length `len`.
function windowRow(len, floors, spacing = 3.4, w = 1.2, sill = 1.0, top = 2.2, skipCentre = false) {
  const out = [];
  const count = Math.max(1, Math.floor((len - 1) / spacing));
  const step = len / (count + 1);
  for (let f = 0; f < floors; f++) {
    for (let i = 1; i <= count; i++) {
      const c = step * i;
      if (skipCentre && f === 0 && Math.abs(c - len / 2) < 1.6) continue;
      out.push({ c, w, y0: f * FLOOR_H + sill, y1: f * FLOOR_H + top });
    }
  }
  return out;
}

// ---------------------------------------------------------------- buildings

// Enterable house with 1-2 floors, windows, stairs, pitched or flat roof.
export function house(b, w, d, floors, style = {}) {
  const wallM = style.wall ?? MAT.PLASTER;
  const roofM = style.roof ?? MAT.ROOF_TILE;
  const t = 0.3;
  const H = floors * FLOOR_H;
  b.foundation(w, d);
  b.box(-w / 2, 0, -d / 2, w / 2, 0.15, d / 2, MAT.WOOD_DARK, S | BF.BUILDING); // floor
  const front = windowRow(w, floors, 3.4, 1.2, 1.0, 2.2, true);
  front.push({ c: w / 2, w: 1.8, y0: 0, y1: 2.4 });
  b.wall(-w / 2, -d / 2, w / 2, -d / 2, 0, H, t, wallM, front, BF.COVER);
  const back = windowRow(w, floors);
  if (style.backDoor) back.push({ c: w * 0.3, w: 1.6, y0: 0, y1: 2.3 });
  b.wall(-w / 2, d / 2, w / 2, d / 2, 0, H, t, wallM, back, BF.COVER);
  b.wall(-w / 2, -d / 2, -w / 2, d / 2, 0, H, t, wallM, windowRow(d, floors), BF.COVER);
  b.wall(w / 2, -d / 2, w / 2, d / 2, 0, H, t, wallM, windowRow(d, floors), BF.COVER);
  if (floors >= 2) {
    // upper floor slab with stairwell along the right wall
    const sw = 1.3;
    b.box(-w / 2 + t / 2, FLOOR_H - 0.2, -d / 2 + t / 2, w / 2 - t / 2 - sw, FLOOR_H, d / 2 - t / 2, MAT.WOOD_DARK, S | BF.BUILDING);
    b.box(w / 2 - t / 2 - sw, FLOOR_H - 0.2, -d / 2 + t / 2, w / 2 - t / 2, FLOOR_H, -d / 2 + 3.4, MAT.WOOD_DARK, S | BF.BUILDING);
    b.stairs(w / 2 - t / 2 - sw / 2, d / 2 - 0.6, w / 2 - t / 2 - sw / 2, -d / 2 + 3.4, 0.15, FLOOR_H, sw - 0.1, MAT.WOOD);
  }
  // roof
  b.box(-w / 2 - 0.2, H, -d / 2 - 0.2, w / 2 + 0.2, H + 0.25, d / 2 + 0.2, roofM === MAT.ROOF_TILE ? MAT.CONCRETE_DARK : roofM, S | BF.BUILDING);
  if (style.flatRoof) {
    b.wall(-w / 2, -d / 2, w / 2, -d / 2, H + 0.25, 0.8, 0.25, wallM);
    b.wall(-w / 2, d / 2, w / 2, d / 2, H + 0.25, 0.8, 0.25, wallM);
    b.wall(-w / 2, -d / 2, -w / 2, d / 2, H + 0.25, 0.8, 0.25, wallM);
    b.wall(w / 2, -d / 2, w / 2, d / 2, H + 0.25, 0.8, 0.25, wallM);
  } else {
    b.prop('prism', 0, H + 0.25, 0, { w: w + 0.8, d: d + 0.6, h: Math.min(3.2, w * 0.3), m: style.snow ? MAT.SNOW_ROOF : roofM });
  }
  if (style.chimney) b.box(w / 4, H, d / 4, w / 4 + 0.8, H + 2.6, d / 4 + 0.8, MAT.BRICK, SMALL);
  // a little interior clutter for cover
  if (b.rng.chance(0.7)) b.cbox(-w / 4, 0.15, 0, 1.4, 0.8, 0.8, MAT.WOOD, SMALLCOVER);
  if (b.rng.chance(0.5)) b.cbox(w / 5, 0.15, d / 4, 0.9, 0.9, 0.9, MAT.CRATE, SMALLCOVER);
  b.light(0, 2.6, -d / 2 - 0.4, 10);
}

// Solid multi-storey city block building.
export function apartment(b, w, d, floors, m = MAT.PLASTER) {
  const H = floors * FLOOR_H + 0.4;
  b.foundation(w, d);
  b.box(-w / 2, 0, -d / 2, w / 2, H, d / 2, m, COVER | BF.BUILDING);
  // cornice + ground floor band
  b.box(-w / 2 - 0.25, H, -d / 2 - 0.25, w / 2 + 0.25, H + 0.35, d / 2 + 0.25, MAT.CONCRETE_DARK, S | BF.BUILDING);
  b.box(-w / 2 - 0.12, 0, -d / 2 - 0.12, w / 2 + 0.12, 1.0, d / 2 + 0.12, MAT.CONCRETE_DARK, S);
  // storefront awning on the street side
  if (b.rng.chance(0.6)) b.box(-w / 2 + 1, 2.8, -d / 2 - 1.6, w / 2 - 1, 2.95, -d / 2, MAT.CANVAS, DECO);
  // rooftop clutter
  if (b.rng.chance(0.7)) b.cbox(b.rng.float(-w / 4, w / 4), H + 0.35, b.rng.float(-d / 4, d / 4), 2.4, 1.6, 1.8, MAT.METAL, SMALL);
  if (b.rng.chance(0.4)) b.cylinder(w / 3, H + 0.35, -d / 4, 1.1, 2.4, MAT.RUST, false, 10);
  b.light(0, 3.2, -d / 2 - 0.5, 12);
}

// Partially destroyed building - enterable, lots of cover.
export function ruin(b, w, d, h = 5) {
  const rng = b.rng;
  const m = rng.pick([MAT.BRICK, MAT.PLASTER, MAT.CONCRETE, MAT.STONE]);
  b.foundation(w, d);
  b.box(-w / 2, 0, -d / 2, w / 2, 0.15, d / 2, MAT.CONCRETE_DARK, S);
  const sides = [
    [-w / 2, -d / 2, w / 2, -d / 2, w],
    [-w / 2, d / 2, w / 2, d / 2, w],
    [-w / 2, -d / 2, -w / 2, d / 2, d],
    [w / 2, -d / 2, w / 2, d / 2, d],
  ];
  for (const [ax, az, bx, bz, len] of sides) {
    if (rng.chance(0.15)) continue;
    const hh = rng.float(1.2, h);
    const ops = windowRow(len, 1, 3.2, 1.3, 0.9, 2.1);
    if (rng.chance(0.6)) ops.push({ c: rng.float(1.5, len - 1.5), w: 2.2, y0: 0, y1: 2.6 });
    b.wall(ax, az, bx, bz, 0, hh, 0.35, m, ops, BF.COVER);
  }
  for (let i = 0; i < 5; i++) {
    const sx = rng.float(0.8, 2.4);
    b.cbox(rng.float(-w / 2, w / 2), 0, rng.float(-d / 2, d / 2), sx, rng.float(0.4, 1.2), rng.float(0.8, 2), m, SMALLCOVER);
  }
}

// Large enterable warehouse / factory hall.
export function warehouse(b, w, d, h = 8, m = MAT.METAL) {
  b.foundation(w, d);
  b.box(-w / 2, 0, -d / 2, w / 2, 0.2, d / 2, MAT.CONCRETE, S | BF.BUILDING);
  const bigDoor = [{ c: w / 2, w: 5, y0: 0, y1: 4.8 }];
  const hi = [];
  for (let x = 4; x < w - 2; x += 6) hi.push({ c: x, w: 2.6, y0: h - 2.6, y1: h - 1.0 });
  b.wall(-w / 2, -d / 2, w / 2, -d / 2, 0, h, 0.35, m, [...bigDoor, ...hi], BF.COVER);
  b.wall(-w / 2, d / 2, w / 2, d / 2, 0, h, 0.35, m, [{ c: w * 0.3, w: 1.8, y0: 0, y1: 2.4 }, ...hi], BF.COVER);
  const sideHi = [];
  for (let z = 4; z < d - 2; z += 6) sideHi.push({ c: z, w: 2.6, y0: h - 2.6, y1: h - 1.0 });
  b.wall(-w / 2, -d / 2, -w / 2, d / 2, 0, h, 0.35, m, [{ c: d / 2, w: 2.0, y0: 0, y1: 2.5 }, ...sideHi], BF.COVER);
  b.wall(w / 2, -d / 2, w / 2, d / 2, 0, h, 0.35, m, sideHi, BF.COVER);
  b.box(-w / 2 - 0.4, h, -d / 2 - 0.4, w / 2 + 0.4, h + 0.3, d / 2 + 0.4, MAT.ROOF_METAL, S | BF.BUILDING);
  b.prop('prism', 0, h + 0.3, 0, { w: w + 0.8, d: d + 0.8, h: 1.4, m: MAT.ROOF_METAL });
  // interior cover: crates, pallets, a container
  const rng = b.rng;
  for (let i = 0; i < 4; i++) {
    const x = rng.float(-w / 2 + 3, w / 2 - 3);
    const z = rng.float(-d / 2 + 4, d / 2 - 3);
    if (rng.chance(0.3)) container(b, x, z, rng.int(0, 1));
    else crates(b, x, z, rng.int(2, 4));
  }
  b.light(0, h - 0.5, 0, 22);
  b.light(0, 4.2, -d / 2 - 0.6, 12);
}

export function container(b, x, z, rot = 0, m) {
  const mat = m ?? b.rng.pick([MAT.CONTAINER_RED, MAT.CONTAINER_BLUE, MAT.CONTAINER_GREEN, MAT.CONTAINER_TAN, MAT.RUST]);
  if (rot) b.box(x - 1.22, 0, z - 3.05, x + 1.22, 2.6, z + 3.05, mat, COVER);
  else b.box(x - 3.05, 0, z - 1.22, x + 3.05, 2.6, z + 1.22, mat, COVER);
}

export function containerStack(b, cols, rows, maxLevels) {
  const rng = b.rng;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const levels = rng.int(1, maxLevels);
      const x = c * 6.4 - (cols - 1) * 3.2;
      const z = r * 2.7 - (rows - 1) * 1.35;
      for (let l = 0; l < levels; l++) {
        const m = rng.pick([MAT.CONTAINER_RED, MAT.CONTAINER_BLUE, MAT.CONTAINER_GREEN, MAT.CONTAINER_TAN, MAT.RUST]);
        b.box(x - 3.05, l * 2.6, z - 1.22, x + 3.05, (l + 1) * 2.6, z + 1.22, m, l === 0 ? COVER : S);
      }
    }
  }
}

export function crates(b, x, z, n = 3) {
  const rng = b.rng;
  for (let i = 0; i < n; i++) {
    const s = rng.float(0.9, 1.3);
    const ox = x + rng.float(-1.2, 1.2);
    const oz = z + rng.float(-1.2, 1.2);
    const stack = rng.chance(0.3) ? 2 : 1;
    for (let k = 0; k < stack; k++) b.cbox(ox, k * s, oz, s, s, s, MAT.CRATE, SMALLCOVER);
  }
}

export function barracks(b, w = 26, d = 9) {
  house(b, w, d, 1, { wall: MAT.CONCRETE, roof: MAT.ROOF_METAL, backDoor: true });
  for (let x = -w / 2 + 2; x < w / 2 - 2; x += 3) {
    b.cbox(x, 0.15, d / 2 - 1.2, 0.9, 0.9, 2.0, MAT.OLIVE, SMALL);
  }
  b.marker('barracks', 0, 0.2, 0, Math.max(w, d) / 2);
}

export function commandPost(b, big = false) {
  const w = big ? 20 : 12;
  const d = big ? 14 : 9;
  house(b, w, d, big ? 2 : 1, { wall: MAT.CONCRETE, roof: MAT.ROOF_METAL, flatRoof: true, backDoor: true });
  // antenna mast and sandbag entrance
  b.box(w / 2 - 1.2, (big ? 2 : 1) * FLOOR_H, d / 2 - 1.2, w / 2 - 0.9, (big ? 2 : 1) * FLOOR_H + 9, d / 2 - 0.9, MAT.DARK_METAL, DECO);
  sandbagWall(b, -3.2, -d / 2 - 2.2, 3.0, 0);
  sandbagWall(b, 3.2, -d / 2 - 2.2, 3.0, 0);
  b.cbox(0, 0.15, 1, 3.2, 0.9, 2.0, MAT.WOOD_DARK, SMALLCOVER); // map table
  b.marker('command', 0, 0.2, 1, 3);
}

export function armory(b) {
  const w = 14;
  const d = 10;
  house(b, w, d, 1, { wall: MAT.CONCRETE_DARK, roof: MAT.ROOF_METAL, flatRoof: true });
  for (let x = -5; x <= 5; x += 2.5) b.cbox(x, 0.15, d / 2 - 0.8, 1.8, 1.8, 0.5, MAT.DARK_METAL, SMALL);
  b.marker('armory', 0, 0.2, 0, 5);
}

export function medTent(b) {
  const w = 12;
  const d = 8;
  b.box(-w / 2, 0, -d / 2, w / 2, 0.12, d / 2, MAT.CANVAS, S);
  b.prop('prism', 0, 0, 0, { w, d, h: 3.6, m: MAT.CANVAS, open: true });
  b.box(-w / 2, 0, d / 2 - 0.1, w / 2, 1.2, d / 2, MAT.CANVAS, S);
  for (let x = -4; x <= 4; x += 2.6) b.cbox(x, 0.12, 1.5, 0.9, 0.6, 2.0, MAT.PAINT_WHITE, SMALL);
  b.prop('plane', 0, 3.62, 0, { w: 2.2, d: 2.2, m: MAT.RED_CROSS });
  b.marker('medical', 0, 0.2, 0, 9);
  b.light(0, 3, 0, 10, 0xfff0e0);
}

export function tent(b, w = 5, d = 4, m = MAT.CANVAS) {
  b.box(-w / 2, 0, -d / 2, w / 2, 0.08, d / 2, m, DECO);
  b.prop('prism', 0, 0, 0, { w, d, h: 2.4, m, open: true });
  b.box(-w / 2, 0, d / 2 - 0.15, w / 2, 1.0, d / 2, m, SMALL);
}

export function garage(b, w = 14, d = 10) {
  b.box(-w / 2, 0, -d / 2, w / 2, 0.15, d / 2, MAT.CONCRETE, S);
  for (const x of [-w / 2, 0, w / 2]) {
    b.box(x - 0.2, 0, -d / 2, x + 0.2, 5, -d / 2 + 0.4, MAT.DARK_METAL, S);
  }
  b.wall(-w / 2, d / 2, w / 2, d / 2, 0, 5, 0.3, MAT.METAL, [], BF.COVER);
  b.wall(-w / 2, -d / 2, -w / 2, d / 2, 0, 5, 0.3, MAT.METAL, [], BF.COVER);
  b.wall(w / 2, -d / 2, w / 2, d / 2, 0, 5, 0.3, MAT.METAL, [], BF.COVER);
  b.box(-w / 2 - 0.3, 5, -d / 2 - 0.6, w / 2 + 0.3, 5.3, d / 2 + 0.3, MAT.ROOF_METAL, S);
  b.cbox(-w / 2 + 1.2, 0.15, d / 2 - 1.2, 1.6, 1.0, 1.0, MAT.RUST, SMALLCOVER);
  b.light(0, 4.6, 0, 14);
}

export function hangar(b, w = 30, d = 26) {
  b.box(-w / 2, 0, -d / 2, w / 2, 0.15, d / 2, MAT.CONCRETE, S);
  const h = 10;
  b.wall(-w / 2, d / 2, w / 2, d / 2, 0, h, 0.4, MAT.METAL, [], BF.COVER);
  b.wall(-w / 2, -d / 2, -w / 2, d / 2, 0, h, 0.4, MAT.METAL, [{ c: d * 0.7, w: 1.8, y0: 0, y1: 2.4 }], BF.COVER);
  b.wall(w / 2, -d / 2, w / 2, d / 2, 0, h, 0.4, MAT.METAL, [], BF.COVER);
  b.box(-w / 2 - 0.4, h, -d / 2, w / 2 + 0.4, h + 0.4, d / 2 + 0.4, MAT.ROOF_METAL, S);
  b.prop('prism', 0, h + 0.4, 0, { w: w + 0.8, d: d + 0.4, h: 3.5, m: MAT.ROOF_METAL, axis: 'x' });
  b.light(0, h - 0.5, 0, 26);
}

export function controlTower(b) {
  b.foundation(6, 6);
  b.box(-3, 0, -3, 3, 11, 3, MAT.CONCRETE, COVER | BF.BUILDING);
  b.box(-4, 11, -4, 4, 11.3, 4, MAT.CONCRETE_DARK, S);
  b.box(-3.6, 11.3, -3.6, 3.6, 13.8, 3.6, MAT.WINDOW, S);
  b.box(-4.2, 13.8, -4.2, 4.2, 14.2, 4.2, MAT.CONCRETE_DARK, S);
  b.box(-0.1, 14.2, -0.1, 0.1, 18, 0.1, MAT.DARK_METAL, DECO);
  b.prop('sphere', 0, 18.1, 0, { r: 0.3, m: MAT.LAMP, blink: true });
}

export function watchtower(b, h = 5.2) {
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) b.box(x - 0.15, 0, z - 0.15, x + 0.15, h + 2.4, z + 0.15, MAT.WOOD_DARK, S);
  b.box(-2, h, -2, 2, h + 0.25, 2, MAT.WOOD, S);
  b.box(-2, h + 0.25, -2, 2, h + 1.25, -1.7, MAT.SANDBAG, COVER);
  b.box(-2, h + 0.25, 1.7, 2, h + 1.25, 2, MAT.SANDBAG, S);
  b.box(-2, h + 0.25, -1.7, -1.7, h + 1.25, 1.7, MAT.SANDBAG, S);
  b.box(1.7, h + 0.25, -1.7, 2, h + 1.25, 0.6, MAT.SANDBAG, S);
  b.box(-2.2, h + 2.4, -2.2, 2.2, h + 2.6, 2.2, MAT.ROOF_METAL, S);
  // stairs up the back-right
  b.stairs(2.7, -1.8, 2.7, 1.9, 0, h + 0.25, 1.0, MAT.WOOD, 'z');
  b.box(2.2, h, 1.7, 3.2, h + 0.25, 2.4, MAT.WOOD, S);
  b.light(0, h + 2.2, 0, 16, 0xfff4d8);
}

export function sandbagWall(b, cx, cz, len, rot = 0, h = 1.1) {
  if (rot === 0) b.box(cx - len / 2, 0, cz - 0.45, cx + len / 2, h, cz + 0.45, MAT.SANDBAG, COVER);
  else b.box(cx - 0.45, 0, cz - len / 2, cx + 0.45, h, cz + len / 2, MAT.SANDBAG, COVER);
}

// Circular fighting position of sandbags around the local origin.
export function sandbagNest(b, r = 3.2) {
  sandbagWall(b, 0, -r, r * 1.6, 0);
  sandbagWall(b, -r, 0.4, r * 1.3, 1);
  sandbagWall(b, r, 0.4, r * 1.3, 1);
  sandbagWall(b, -r * 0.55, r, r * 0.7, 0);
}

export function hescoLine(b, len, rot = 0) {
  const n = Math.max(1, Math.round(len / 1.5));
  for (let i = 0; i < n; i++) {
    const o = -len / 2 + (i + 0.5) * (len / n);
    if (rot === 0) b.box(o - 0.75, 0, -0.75, o + 0.75, 1.9, 0.75, MAT.HESCO, COVER);
    else b.box(-0.75, 0, o - 0.75, 0.75, 1.9, o + 0.75, MAT.HESCO, COVER);
  }
}

export function concreteBarrier(b, x, z, rot = 0) {
  if (rot === 0) b.box(x - 1.6, 0, z - 0.35, x + 1.6, 0.95, z + 0.35, MAT.CONCRETE, COVER);
  else b.box(x - 0.35, 0, z - 1.6, x + 0.35, 0.95, z + 1.6, MAT.CONCRETE, COVER);
}

export function hedgehog(b, x, z) {
  b.prop('hedgehog', x, 0, z, { s: 1.3, m: MAT.RUST, yaw: b.rng.float(0, 3) });
  b.box(x - 0.8, 0, z - 0.8, x + 0.8, 1.3, z + 0.8, MAT.RUST, BF.SOLID | BF.COVER);
}

export function bunker(b, w = 7, d = 6) {
  const h = 2.5;
  b.foundation(w, d);
  b.box(-w / 2, 0, -d / 2, w / 2, 0.15, d / 2, MAT.CONCRETE_DARK, S);
  const slits = [{ c: w * 0.2, w: 1.6, y0: 1.25, y1: 1.65 }, { c: w * 0.5, w: 1.6, y0: 1.25, y1: 1.65 }, { c: w * 0.8, w: 1.6, y0: 1.25, y1: 1.65 }];
  b.wall(-w / 2, -d / 2, w / 2, -d / 2, 0, h, 0.6, MAT.CONCRETE, slits, BF.COVER);
  b.wall(-w / 2, d / 2, w / 2, d / 2, 0, h, 0.6, MAT.CONCRETE, [{ c: w / 2, w: 1.6, y0: 0, y1: 2.1 }], BF.COVER);
  b.wall(-w / 2, -d / 2, -w / 2, d / 2, 0, h, 0.6, MAT.CONCRETE, [{ c: d / 2, w: 1.4, y0: 1.25, y1: 1.65 }], BF.COVER);
  b.wall(w / 2, -d / 2, w / 2, d / 2, 0, h, 0.6, MAT.CONCRETE, [{ c: d / 2, w: 1.4, y0: 1.25, y1: 1.65 }], BF.COVER);
  b.box(-w / 2 - 0.3, h, -d / 2 - 0.3, w / 2 + 0.3, h + 0.5, d / 2 + 0.3, MAT.CONCRETE_DARK, S);
  b.box(-w / 2, h + 0.5, -d / 2, w / 2, h + 1.1, d / 2, MAT.SANDBAG, DECO);
}

// Raised earthwork trench: two parallel berms with a walkable channel between.
export function trench(b, len, rot = 0) {
  const w = 2.4;
  const n = Math.max(1, Math.round(len / 3));
  for (let i = 0; i < n; i++) {
    const o = -len / 2 + (i + 0.5) * (len / n);
    const jitter = b.rng.float(-0.2, 0.2);
    const hh = 1.25 + b.rng.float(-0.1, 0.1);
    if (rot === 0) {
      b.box(o - 1.5, 0, -w / 2 - 1.2 + jitter, o + 1.5, hh, -w / 2 + jitter, MAT.SANDBAG, COVER);
      b.box(o - 1.5, 0, w / 2 + jitter, o + 1.5, hh * 0.8, w / 2 + 1.0 + jitter, MAT.SANDBAG, COVER);
    } else {
      b.box(-w / 2 - 1.2 + jitter, 0, o - 1.5, -w / 2 + jitter, hh, o + 1.5, MAT.SANDBAG, COVER);
      b.box(w / 2 + jitter, 0, o - 1.5, w / 2 + 1.0 + jitter, hh * 0.8, o + 1.5, MAT.SANDBAG, COVER);
    }
  }
  // wooden duckboards
  if (rot === 0) b.box(-len / 2, 0, -0.6, len / 2, 0.08, 0.6, MAT.WOOD_DARK, DECO);
  else b.box(-0.6, 0, -len / 2, 0.6, 0.08, len / 2, MAT.WOOD_DARK, DECO);
}

export function checkpoint(b) {
  b.foundation(4, 4);
  b.box(-2, 0, -1.6, 2, 2.8, 1.6, MAT.CONCRETE, COVER | BF.BUILDING);
  b.box(-1.9, 1.2, -1.65, 1.9, 2.3, -1.55, MAT.WINDOW, DECO);
  b.box(-2.3, 2.8, -1.9, 2.3, 3.0, 1.9, MAT.ROOF_METAL, S);
  // barrier arm across the road (+x)
  b.box(2.4, 0, -0.3, 2.8, 1.2, 0.3, MAT.HAZARD, SMALL);
  b.box(2.8, 1.0, -0.08, 10.5, 1.15, 0.08, MAT.HAZARD, DECO);
  concreteBarrier(b, 5, -5, 0);
  concreteBarrier(b, 9, 5, 0);
  sandbagWall(b, -2, -3.4, 3.5, 0);
  b.light(0, 3.0, -2.0, 12);
}

export function lamp(b, x, z, h = 6) {
  b.box(x - 0.1, 0, z - 0.1, x + 0.1, h, z + 0.1, MAT.DARK_METAL, SMALL);
  b.box(x - 0.1, h - 0.1, z - 0.1, x + 0.9, h + 0.05, z + 0.1, MAT.DARK_METAL, DECO);
  b.box(x + 0.6, h - 0.3, z - 0.18, x + 1.0, h - 0.1, z + 0.18, MAT.LAMP, DECO);
  b.light(x + 0.8, h - 0.4, z, 16);
}

export function flagpole(b, key, x = 0, z = 0, h = 9) {
  b.box(x - 0.08, 0, z - 0.08, x + 0.08, h, z + 0.08, MAT.PAINT_WHITE, SMALL);
  const [wx, wz] = b.toWorld(x, z);
  b.flags.push({ key, x: wx, y: b.oy + h, z: wz });
}

export function fence(b, len, rot = 0, h = 1.1, m = MAT.WOOD) {
  const posts = Math.max(2, Math.round(len / 2.5) + 1);
  for (let i = 0; i < posts; i++) {
    const o = -len / 2 + (i * len) / (posts - 1);
    if (rot === 0) b.box(o - 0.08, 0, -0.08, o + 0.08, h + 0.1, 0.08, m, DECO);
    else b.box(-0.08, 0, o - 0.08, 0.08, h + 0.1, o + 0.08, m, DECO);
  }
  if (rot === 0) {
    b.box(-len / 2, h * 0.45, -0.05, len / 2, h * 0.55, 0.05, m, DECO);
    b.box(-len / 2, h * 0.85, -0.05, len / 2, h * 0.95, 0.05, m, DECO);
    b.box(-len / 2, 0, -0.1, len / 2, h, 0.1, m, BF.SOLID);
  } else {
    b.box(-0.05, h * 0.45, -len / 2, 0.05, h * 0.55, len / 2, m, DECO);
    b.box(-0.05, h * 0.85, -len / 2, 0.05, h * 0.95, len / 2, m, DECO);
    b.box(-0.1, 0, -len / 2, 0.1, h, len / 2, m, BF.SOLID);
  }
}

export function stoneWall(b, len, rot = 0) {
  if (rot === 0) b.box(-len / 2, 0, -0.35, len / 2, 0.95, 0.35, MAT.STONE, COVER);
  else b.box(-0.35, 0, -len / 2, 0.35, 0.95, len / 2, MAT.STONE, COVER);
}

export function wreckCar(b, x, z, rot = 0) {
  b.push(x, 0, z, rot);
  const m = b.rng.pick([MAT.RUST, MAT.BLACK, MAT.RUST]);
  b.box(-0.9, 0.3, -2.1, 0.9, 1.0, 2.1, m, COVER);
  b.box(-0.8, 1.0, -0.9, 0.8, 1.55, 1.0, m, S);
  b.pop();
}

export function silo(b, r = 3.2, h = 16) {
  b.cylinder(0, 0, 0, r, h, MAT.METAL, true, 16);
  b.prop('cone', 0, h, 0, { r: r * 1.05, h: 2.2, m: MAT.ROOF_METAL, seg: 16 });
  b.box(r - 0.1, 0, -0.3, r + 0.5, h, 0.3, MAT.DARK_METAL, DECO);
}

export function chimney(b, r = 1.6, h = 28) {
  b.cylinder(0, 0, 0, r, h, MAT.BRICK, true, 12);
  b.prop('cyl', 0, h, 0, { r: r * 1.15, h: 1, m: MAT.CONCRETE_DARK, seg: 12 });
  b.prop('smoke', 0, h + 1, 0, { r: 2 });
}

export function crane(b, span = 22, h = 20) {
  for (const x of [-span / 2, span / 2]) {
    b.box(x - 0.6, 0, -4, x + 0.6, h, -3, MAT.HAZARD, S);
    b.box(x - 0.6, 0, 3, x + 0.6, h, 4, MAT.HAZARD, S);
    b.box(x - 0.8, 0, -4.2, x + 0.8, 1.2, 4.2, MAT.DARK_METAL, S);
  }
  b.box(-span / 2 - 4, h, -1.2, span / 2 + 10, h + 2.2, 1.2, MAT.HAZARD, S);
  b.box(4, h - 3, -0.1, 4.2, h, 0.1, MAT.DARK_METAL, DECO);
  b.box(2.8, h - 5.8, -1.3, 5.4, h - 3, 1.3, MAT.CONTAINER_BLUE, DECO);
}

export function dock(b, len, width) {
  // platform over water; y is set by caller (water level based)
  b.box(-width / 2, -0.4, -len / 2, width / 2, 0.0, len / 2, MAT.CONCRETE_DARK, S | BF.WALKSURF);
  for (let z = -len / 2 + 2; z < len / 2; z += 6) {
    b.box(-width / 2 + 0.4, -6, z - 0.4, -width / 2 + 1.2, -0.4, z + 0.4, MAT.CONCRETE_DARK, DECO);
    b.box(width / 2 - 1.2, -6, z - 0.4, width / 2 - 0.4, -0.4, z + 0.4, MAT.CONCRETE_DARK, DECO);
    b.box(width / 2 - 0.7, 0, z - 0.25, width / 2 - 0.2, 0.6, z + 0.25, MAT.DARK_METAL, SMALL);
  }
}

export function ship(b, len = 64, w = 13) {
  b.box(-w / 2, -5, -len / 2, w / 2, 5.5, len / 2, MAT.DARK_METAL, S);
  b.box(-w / 2 + 0.2, 5.5, -len / 2, w / 2 - 0.2, 5.8, len / 2, MAT.RUST, S);
  b.box(-w / 2 + 1, 5.8, len / 2 - 12, w / 2 - 1, 15, len / 2 - 3, MAT.PAINT_WHITE, S);
  b.box(-w / 2 + 1.5, 13, len / 2 - 11.5, w / 2 - 1.5, 14, len / 2 - 3.5, MAT.WINDOW, DECO);
  b.cylinder(0, 15, len / 2 - 7, 1.1, 5, MAT.FLAG_RED, false, 10);
  for (let z = -len / 2 + 6; z < len / 2 - 16; z += 6.4) {
    const levels = b.rng.int(1, 3);
    for (let l = 0; l < levels; l++) {
      const m = b.rng.pick([MAT.CONTAINER_RED, MAT.CONTAINER_BLUE, MAT.CONTAINER_GREEN, MAT.CONTAINER_TAN]);
      b.box(-w / 2 + 1.2, 5.8 + l * 2.6, z - 3.05, -0.2, 5.8 + (l + 1) * 2.6, z + 3.05, m, DECO);
      b.box(0.2, 5.8 + l * 2.6, z - 3.05, w / 2 - 1.2, 5.8 + (l + 1) * 2.6, z + 3.05, m, DECO);
    }
  }
}

export function lighthouse(b) {
  b.foundation(7, 7);
  b.cylinder(0, 0, 0, 3.2, 3, MAT.STONE, true, 16);
  b.cylinder(0, 3, 0, 2.2, 16, MAT.PAINT_WHITE, true, 16);
  b.prop('cyl', 0, 8, 0, { r: 2.25, h: 3, m: MAT.FLAG_RED, seg: 16 });
  b.prop('cyl', 0, 19, 0, { r: 1.8, h: 2.4, m: MAT.WINDOW, seg: 12 });
  b.prop('cone', 0, 21.4, 0, { r: 2.1, h: 1.6, m: MAT.FLAG_RED, seg: 12 });
  b.prop('sphere', 0, 20.2, 0, { r: 0.7, m: MAT.LAMP, beacon: true });
  b.light(0, 20.2, 0, 40, 0xfff2c0);
}

export function barn(b, w = 14, d = 18) {
  const h = 6;
  b.foundation(w, d);
  b.box(-w / 2, 0, -d / 2, w / 2, 0.1, d / 2, MAT.WOOD_DARK, S);
  b.wall(-w / 2, -d / 2, w / 2, -d / 2, 0, h, 0.3, MAT.WOOD, [{ c: w / 2, w: 4.5, y0: 0, y1: 4.5 }], BF.COVER);
  b.wall(-w / 2, d / 2, w / 2, d / 2, 0, h, 0.3, MAT.WOOD, [{ c: w / 2, w: 3.0, y0: 0, y1: 3.4 }], BF.COVER);
  b.wall(-w / 2, -d / 2, -w / 2, d / 2, 0, h, 0.3, MAT.WOOD, [{ c: d * 0.3, w: 1.2, y0: 2, y1: 3 }, { c: d * 0.7, w: 1.2, y0: 2, y1: 3 }], BF.COVER);
  b.wall(w / 2, -d / 2, w / 2, d / 2, 0, h, 0.3, MAT.WOOD, [{ c: d * 0.5, w: 1.6, y0: 0, y1: 2.4 }], BF.COVER);
  b.box(-w / 2 - 0.3, h, -d / 2 - 0.3, w / 2 + 0.3, h + 0.2, d / 2 + 0.3, MAT.WOOD_DARK, S);
  b.prop('prism', 0, h + 0.2, 0, { w: w + 1, d: d + 0.6, h: 4.2, m: MAT.ROOF_METAL });
  // hay bales
  for (let i = 0; i < 4; i++) b.cbox(b.rng.float(-w / 3, w / 3), 0.1, b.rng.float(-d / 3, d / 3), 1.4, 1.0, 1.0, MAT.SANDBAG, SMALLCOVER);
}

export function windmill(b) {
  b.cylinder(0, 0, 0, 2.2, 12, MAT.STONE, true, 10);
  b.prop('cone', 0, 12, 0, { r: 2.6, h: 3, m: MAT.WOOD_DARK, seg: 10 });
  b.prop('blades', 0, 11, -2.6, { r: 7, m: MAT.WOOD });
}

export function cabin(b, w = 7, d = 6, snow = false) {
  house(b, w, d, 1, { wall: MAT.WOOD_DARK, roof: MAT.ROOF_METAL, snow, chimney: true });
}

export function logPile(b, x, z, rot = 0) {
  b.push(x, 0, z, rot);
  for (let i = 0; i < 5; i++) b.prop('cyl', -2 + i * 0.9 - (i > 2 ? 1.8 : 0), i > 2 ? 0.85 : 0.4, 0, { r: 0.42, h: 5, m: MAT.TRUNK, seg: 8, lying: true });
  b.box(-2.3, 0, -2.5, 2.3, 1.2, 2.5, MAT.TRUNK, BF.SOLID | BF.COVER);
  b.pop();
}

export function radar(b) {
  bunker(b, 8, 7);
  b.cylinder(0, 3.1, 0, 0.5, 4, MAT.DARK_METAL, false, 8);
  b.prop('dish', 0, 7.2, 0, { r: 3.4, m: MAT.PAINT_WHITE, spin: 0.6 });
  b.prop('sphere', 0, 7.4, 0, { r: 0.25, m: MAT.LAMP, blink: true });
}

export function radioMast(b, h = 26) {
  b.box(-0.9, 0, -0.9, 0.9, 1, 0.9, MAT.CONCRETE, S);
  b.prop('mast', 0, 1, 0, { h, w: 1.4, m: MAT.PAINT_WHITE });
  b.box(-0.5, 1, -0.5, 0.5, h, 0.5, MAT.DARK_METAL, BF.SOLID);
  b.prop('sphere', 0, h + 1, 0, { r: 0.3, m: MAT.LAMP, blink: true });
}

export function helipad(b, r = 9) {
  b.box(-r, 0, -r, r, 0.12, r, MAT.CONCRETE_DARK, S);
  b.box(-2.6, 0.12, -3.2, -1.8, 0.14, 3.2, MAT.PAINT_WHITE, DECO);
  b.box(1.8, 0.12, -3.2, 2.6, 0.14, 3.2, MAT.PAINT_WHITE, DECO);
  b.box(-1.8, 0.12, -0.4, 1.8, 0.14, 0.4, MAT.PAINT_WHITE, DECO);
}

export function vehiclePad(b, w = 6, d = 10) {
  b.box(-w / 2, 0, -d / 2, w / 2, 0.1, d / 2, MAT.CONCRETE_DARK, S);
  b.box(-w / 2, 0.1, -d / 2, -w / 2 + 0.2, 0.12, d / 2, MAT.HAZARD, DECO);
  b.box(w / 2 - 0.2, 0.1, -d / 2, w / 2, 0.12, d / 2, MAT.HAZARD, DECO);
}

// Shooting range: firing line at z=0, lanes extend towards -z.
export function shootingRange(b, lanes = 5) {
  const lw = 4;
  const W = lanes * lw;
  b.box(-W / 2, 0, -1, W / 2, 0.1, 1.5, MAT.CONCRETE, S);
  b.box(-W / 2, 0.1, -1.0, W / 2, 1.0, -0.6, MAT.WOOD_DARK, SMALLCOVER); // firing bench
  b.box(-W / 2 - 1, 0, 1.5, W / 2 + 1, 3.2, 1.8, MAT.WOOD, S); // back wall
  b.box(-W / 2 - 1, 3.2, -1.2, W / 2 + 1, 3.4, 1.8, MAT.ROOF_METAL, S);
  for (let i = 0; i <= lanes; i++) {
    const x = -W / 2 + i * lw;
    b.box(x - 0.08, 0, -60, x + 0.08, 0.3, -1, MAT.PAINT_WHITE, DECO);
  }
  const dists = [15, 30, 45];
  for (let i = 0; i < lanes; i++) {
    const x = -W / 2 + (i + 0.5) * lw;
    const dz = -dists[i % dists.length];
    const t = b.box(x - 0.45, 0.2, dz - 0.1, x + 0.45, 1.9, dz + 0.1, MAT.TARGET, S | BF.RANGE_TARGET);
    b.box(x - 0.08, 0, dz - 0.05, x + 0.08, 0.2, dz + 0.05, MAT.WOOD_DARK, DECO);
    t.targetIndex = b.rangeTargets.length;
    b.rangeTargets.push(t);
  }
  // berm at the end
  b.box(-W / 2 - 2, 0, -64, W / 2 + 2, 4, -60, MAT.SANDBAG, S);
  b.marker('range', 0, 0.2, 0.5, W / 2);
}

// Obstacle course used by basic training: low walls (jump), crawl bars (prone), a trench.
export function obstacleCourse(b) {
  b.box(-4, 0, -2, 4, 0.05, 50, MAT.GRAVEL, DECO);
  b.box(-3, 0, 6, 3, 0.95, 6.5, MAT.WOOD, S); // jump wall
  b.box(-3, 0, 14, 3, 0.95, 14.5, MAT.WOOD, S);
  // crawl frame: bars at 0.75-1.0 m, requires prone
  for (let z = 20; z <= 28; z += 2) {
    b.box(-3.2, 0, z - 0.1, -3, 1.1, z + 0.1, MAT.WOOD_DARK, S);
    b.box(3, 0, z - 0.1, 3.2, 1.1, z + 0.1, MAT.WOOD_DARK, S);
    b.box(-3, 0.72, z - 0.1, 3, 1.1, z + 0.1, MAT.CAMO_NET, S);
  }
  trench(b, 12, 1);
  b.marker('course_start', 0, 0.1, 0, 3);
  b.marker('course_end', 0, 0.1, 46, 3);
}

export function paradeGround(b, w = 34, d = 26) {
  b.box(-w / 2, 0, -d / 2, w / 2, 0.08, d / 2, MAT.ASPHALT, S);
  for (let x = -w / 2 + 3; x < w / 2 - 2; x += 4) b.box(x - 0.1, 0.08, -d / 2 + 3, x + 0.1, 0.09, d / 2 - 3, MAT.PAINT_WHITE, DECO);
  b.cbox(0, 0.08, -d / 2 - 1.2, 6, 0.6, 2.4, MAT.CONCRETE, S); // reviewing stand
  b.marker('parade', 0, 0.1, 0, Math.min(w, d) / 2);
}

export function missionBoard(b) {
  b.box(-1.4, 0, -0.1, 1.4, 2.2, 0.1, MAT.WOOD_DARK, S);
  b.box(-1.25, 0.8, -0.14, 1.25, 2.0, -0.1, MAT.PAINT_WHITE, DECO);
  b.marker('mission_board', 0, 0.2, -1, 3);
}

export function govBuilding(b) {
  const w = 44;
  const d = 26;
  const h = 12;
  b.foundation(w, d);
  b.box(-w / 2 - 3, 0, -d / 2 - 6, w / 2 + 3, 1.2, d / 2 + 2, MAT.STONE, S); // plinth
  b.stairs(0, -d / 2 - 7.5, 0, -d / 2 - 4.5, 0, 1.2, 14, MAT.STONE);
  b.push(0, 1.2, 0, 0);
  b.box(-w / 2, 0, -d / 2 + 4, w / 2, h, d / 2, MAT.STONE, COVER | BF.BUILDING);
  for (let x = -w / 2 + 3; x <= w / 2 - 3; x += 4.6) b.cylinder(x, 0, -d / 2 + 1.2, 0.7, h, MAT.PAINT_WHITE, true, 10);
  b.box(-w / 2, h, -d / 2, w / 2, h + 1.4, d / 2, MAT.STONE, S);
  b.prop('prism', 0, h + 1.4, -d / 2 + 2, { w: w, d: 4.5, h: 3, m: MAT.STONE, axis: 'x' });
  b.prop('dome', 0, h + 1.4, 6, { r: 8, m: MAT.RUST });
  b.pop();
  b.light(-8, 4, -d / 2 - 2, 14);
  b.light(8, 4, -d / 2 - 2, 14);
}

export function fountain(b) {
  b.cylinder(0, 0, 0, 5, 0.8, MAT.STONE, true, 18);
  b.prop('cyl', 0, 0.8, 0, { r: 4.4, h: 0.05, m: MAT.WINDOW, seg: 18 });
  b.cylinder(0, 0, 0, 0.8, 3, MAT.STONE, false, 10);
  b.prop('sphere', 0, 3.4, 0, { r: 0.6, m: MAT.STONE });
}

export function station(b) {
  const w = 54;
  const d = 16;
  b.foundation(w, d);
  b.box(-w / 2, 0, -d / 2, w / 2, 1.1, d / 2, MAT.CONCRETE, S); // platform
  for (let x = -w / 2 + 2; x <= w / 2 - 2; x += 6.5) {
    b.box(x - 0.25, 1.1, -0.25, x + 0.25, 6.5, 0.25, MAT.DARK_METAL, S);
  }
  b.box(-w / 2, 6.5, -d / 2, w / 2, 6.9, d / 2, MAT.ROOF_METAL, S);
  b.push(0, 1.1, 5, 0);
  house(b, 14, 6, 1, { wall: MAT.BRICK, roof: MAT.ROOF_METAL, flatRoof: true });
  b.pop();
  // tracks & a wagon
  b.box(-w / 2 - 20, 0, -d / 2 - 4.2, w / 2 + 20, 0.2, -d / 2 - 3.9, MAT.DARK_METAL, DECO);
  b.box(-w / 2 - 20, 0, -d / 2 - 2.8, w / 2 + 20, 0.2, -d / 2 - 2.5, MAT.DARK_METAL, DECO);
  b.box(-10, 0.6, -d / 2 - 4.8, 6, 3.8, -d / 2 - 1.9, MAT.RUST, COVER);
}

export function marketStalls(b, n = 6) {
  for (let i = 0; i < n; i++) {
    const x = (i % 3) * 7 - 7;
    const z = Math.floor(i / 3) * 8 - 4;
    b.box(x - 1.8, 0, z - 1.2, x + 1.8, 0.95, z + 1.2, MAT.WOOD, COVER);
    for (const [px, pz] of [[-1.8, -1.2], [1.8, -1.2], [-1.8, 1.2], [1.8, 1.2]]) b.box(x + px - 0.06, 0, z + pz - 0.06, x + px + 0.06, 2.6, z + pz + 0.06, MAT.WOOD_DARK, DECO);
    b.box(x - 2.1, 2.6, z - 1.5, x + 2.1, 2.7, z + 1.5, b.rng.pick([MAT.CANVAS, MAT.FLAG_RED, MAT.FLAG_BLUE, MAT.CONTAINER_TAN]), DECO);
  }
}

export function fuelTanks(b) {
  for (const [x, z] of [[-4, -3], [4, -3], [0, 4]]) {
    b.cylinder(x, 0, z, 2.6, 5.5, MAT.PAINT_WHITE, true, 14);
    b.prop('cyl', x, 5.5, z, { r: 2.65, h: 0.3, m: MAT.RUST, seg: 14 });
  }
  b.box(-7, 0, -7, 7, 0.9, -6.5, MAT.CONCRETE, COVER);
}

export function pierShed(b) {
  house(b, 8, 6, 1, { wall: MAT.WOOD, roof: MAT.ROOF_METAL });
  b.cbox(5, 0, 0, 1.2, 0.8, 2.4, MAT.WOOD_DARK, SMALLCOVER);
}

export function chapel(b) {
  house(b, 9, 14, 1, { wall: MAT.STONE, roof: MAT.ROOF_TILE, backDoor: false });
  b.push(0, 0, -8.5, 0);
  b.foundation(4, 4);
  b.box(-2, 0, -2, 2, 12, 2, MAT.STONE, COVER | BF.BUILDING);
  b.prop('cone', 0, 12, 0, { r: 2.6, h: 5, m: MAT.ROOF_TILE, seg: 4 });
  b.pop();
}

export function sawmill(b) {
  garage(b, 16, 10);
  logPile(b, 12, 0, 1);
  logPile(b, -12, 4, 0);
  b.cylinder(0, 0.15, 0, 1.4, 0.2, MAT.DARK_METAL, false, 16);
}

export function rock(b, x, z, s) {
  const [wx, wz] = b.toWorld(x, z);
  const y = b.terrain.heightAt(wx, wz) - s * 0.3 - b.oy;
  b.prop('rock', x, y, z, { s, m: MAT.ROCK, seed: Math.floor(b.rng.next() * 1e6) });
  b.box(x - s * 0.7, y, z - s * 0.7, x + s * 0.7, y + s * 1.1, z + s * 0.7, MAT.ROCK, BF.SOLID | BF.COVER);
}
