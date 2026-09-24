// Settlement builders: one per territory type, plus villages and front-line
// fortifications. Each country has its own architecture palette so crossing a
// border is visible: Aldmark brick and slate, Karsan concrete blocks, Seravian
// warm plaster and terracotta.
import { MAT } from './materials.js';
import { BF } from './builder.js';
import * as P from './prefabs.js';
import { airport, borderPost, gasStation, oilDerrick, pipeline, highrise, monastery, farmstead, shopRow, pier } from './infra.js';
import { undergroundBunker, coastalGun, dragonTeeth, artilleryPiece, officeBuilding, LVL } from './buildings.js';
import { buildGarrison } from './bases.js';
import { tryPlace, findSpot, scatter, rotFacing } from './place.js';
import { SECTOR_RADIUS, AIRPORTS } from '../config/world.js';
import { dist2D, clamp } from '../math.js';

export const STYLE = {
  1: { walls: [MAT.BRICK, MAT.STONE, MAT.PLASTER, MAT.BRICK], roof: MAT.ROOF_METAL, apt: [MAT.BRICK, MAT.STONE, MAT.CONCRETE, MAT.PLASTER], tower: 1 },
  2: { walls: [MAT.CONCRETE, MAT.PLASTER, MAT.CONCRETE_DARK, MAT.PLASTER], roof: MAT.ROOF_METAL, apt: [MAT.CONCRETE, MAT.CONCRETE_DARK, MAT.PLASTER, MAT.CONCRETE], tower: 1.2 },
  3: { walls: [MAT.PLASTER_WARM, MAT.PLASTER, MAT.STONE, MAT.PLASTER_WARM], roof: MAT.ROOF_TILE, apt: [MAT.PLASTER_WARM, MAT.PLASTER, MAT.STONE, MAT.PLASTER_WARM], tower: 0.8 },
};

export const CITY_BLOCK = 50;

function style(t) {
  return STYLE[t.country] || STYLE[1];
}

function houseFn(st, rng, floors) {
  return (bb, w, d) => P.house(bb, w, d, floors ?? (rng.chance(0.35) ? 2 : 1), { wall: rng.pick(st.walls), roof: st.roof, chimney: rng.chance(0.3), flatRoof: st.roof === MAT.ROOF_METAL && rng.chance(0.5) });
}

// Which way is the sea from here (unit vector), or null.
export function seaDirection(terrain, x, z, reach = 260) {
  let best = null;
  let bl = Infinity;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const px = x + Math.cos(a) * reach;
    const pz = z + Math.sin(a) * reach;
    const l = terrain.landDist(px, pz);
    if (l < bl) {
      bl = l;
      best = { x: Math.cos(a), z: Math.sin(a) };
    }
  }
  return bl < 0 ? best : null;
}

// First point along a direction where the terrain drops into water.
function shoreAlong(terrain, x, z, dx, dz, maxD = 400) {
  for (let d = 0; d < maxD; d += 3) {
    if (terrain.heightAt(x + dx * d, z + dz * d) < 0.3) return { x: x + dx * d, z: z + dz * d, d };
  }
  return null;
}

// ---------------------------------------------------------------- sectors
export function setupSectors(ctx, t) {
  const { b, occ, terrain } = ctx;
  t.spawns = [];
  for (const s of t.sectors) {
    if (!s.underground) s.y = terrain.heightAt(s.x, s.z);
    s.r = SECTOR_RADIUS;
    if (!s.underground) {
      b.at(s.x, s.z, 0, () => P.flagpole(b, `${t.id}:${s.id}`, 0, 0, 9));
      occ.markCircle(s.x, s.z, 4);
      const rot = ctx.rng.int(0, 3);
      if (occ.free(s.x + 5, s.z + 3, s.x + 13, s.z + 11)) {
        b.at(s.x + 9, s.z + 7, rot, () => P.sandbagNest(b, 2.6));
        occ.markCircle(s.x + 9, s.z + 7, 4);
      }
      if (occ.free(s.x - 13, s.z - 9, s.x - 7, s.z - 3)) {
        b.at(s.x - 10, s.z - 6, 0, () => P.crates(b, 0, 0, 3));
        occ.markCircle(s.x - 10, s.z - 6, 3);
      }
    }
    if (s.id === 'A') {
      const dirx = t.x - s.x;
      const dirz = t.z - s.z;
      const l = Math.hypot(dirx, dirz);
      let px = s.x + 18;
      let pz = s.z - 16;
      if (l > 20) {
        px = s.x + (dirx / l) * 20;
        pz = s.z + (dirz / l) * 20;
      }
      const cp = findSpot(ctx, px, pz, 12, 9, 40) || { x: px, z: pz, rot: 0 };
      tryPlace(ctx, cp.x, cp.z, cp.rot, 12, 9, () => P.commandPost(b, false), { margin: 0.5, maxSlope: 6, kind: 'command', name: `${t.name} Command Post` });
      t.commandPost = { x: cp.x, z: cp.z, y: terrain.heightAt(cp.x, cp.z) };
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = cp.x + Math.cos(a) * 11;
        const z = cp.z + Math.sin(a) * 11;
        t.spawns.push({ x, z, y: terrain.heightAt(x, z) });
      }
      const vp = findSpot(ctx, cp.x + 14, cp.z + 10, 6, 10, 36);
      if (vp) {
        tryPlace(ctx, vp.x, vp.z, vp.rot, 6, 10, () => P.vehiclePad(b), { margin: 0.3 });
        b.markers.push({ type: 'vehicle', x: vp.x, y: terrain.heightAt(vp.x, vp.z) + 0.3, z: vp.z, r: 4, vtype: t.type === 'port' || t.type === 'island' ? 'truck' : 'jeep', yaw: (vp.rot * Math.PI) / 2, territory: t.id });
      }
    }
  }
  ctx.places.push({ name: t.name, x: t.x, z: t.z, r: t.radius * 1.2, kind: 'territory', territory: t.id });
  for (const s of t.sectors) ctx.places.push({ name: s.name, x: s.x, z: s.z, r: 45, kind: 'sector', territory: t.id });
}

// Landmarks placed at named sectors.
function landmarks(ctx, t) {
  const { b, rng } = ctx;
  const st = style(t);
  for (const s of t.sectors) {
    const n = s.name;
    if (s.underground) continue;
    if (/Parliament|Palace|Assembly|Town Hall|Customs/.test(n)) {
      const spot = findSpot(ctx, s.x, s.z - 26, 50, 36, 40) || { x: s.x, z: s.z - 26, rot: 0 };
      tryPlace(ctx, spot.x, spot.z, 0, 50, 36, () => P.govBuilding(b), { margin: 0, maxSlope: 8, kind: 'landmark', name: n, destructible: false });
      tryPlace(ctx, s.x - 14, s.z + 8, 0, 10, 10, () => P.fountain(b), { margin: 0 });
    } else if (/Market|Bazaar/.test(n)) {
      b.at(s.x + 4, s.z + 14, 0, () => P.marketStalls(b, 9));
      ctx.occ.markCircle(s.x + 4, s.z + 14, 16);
    } else if (/Rail Yard|Rail Depot|Junction/.test(n)) {
      tryPlace(ctx, s.x + 8, s.z + 30, 0, 26, 9, () => P.containerStack(b, 4, 3, 2), { margin: 0.5 });
      tryPlace(ctx, s.x - 30, s.z + 28, 1, 30, 10, () => P.crane(b, 20, 18), { margin: 0 });
    } else if (/Citadel|Fortress/.test(n)) {
      fortress(ctx, s.x, s.z, 34);
    } else if (/Foundry|Steelworks/.test(n)) {
      tryPlace(ctx, s.x + 2, s.z - 32, 0, 38, 24, () => P.warehouse(b, 38, 24, 11, MAT.BRICK), { margin: 0.5, maxSlope: 6, kind: 'factory', name: n });
      tryPlace(ctx, s.x + 28, s.z - 18, 0, 5, 5, () => P.chimney(b, 1.8, 32));
      tryPlace(ctx, s.x + 32, s.z - 36, 0, 5, 5, () => P.chimney(b, 1.6, 28));
    } else if (/Radar|Relay/.test(n)) {
      tryPlace(ctx, s.x + 6, s.z - 14, 0, 8, 7, () => P.radar(b), { margin: 0.5, maxSlope: 8 });
      tryPlace(ctx, s.x - 12, s.z + 10, 0, 3, 3, () => P.radioMast(b, 30), { margin: 0, maxSlope: 8 });
    } else if (/Lighthouse/.test(n)) {
      tryPlace(ctx, s.x - 14, s.z - 8, 0, 8, 8, () => P.lighthouse(b), { margin: 0, maxSlope: 8, minHeight: 0.8 });
    } else if (/Monastery/.test(n)) {
      tryPlace(ctx, s.x + 18, s.z - 16, 0, 26, 34, () => monastery(b), { margin: 0, maxSlope: 7 });
    } else if (/Mill/.test(n) && !/Saw/.test(n)) {
      tryPlace(ctx, s.x + 16, s.z - 12, 0, 6, 6, () => P.windmill(b));
    } else if (/Silos|Grain/.test(n)) {
      for (let i = 0; i < 3; i++) tryPlace(ctx, s.x + 14 + i * 8, s.z - 16, 0, 7, 7, () => P.silo(b, 3.2, 17));
      tryPlace(ctx, s.x - 16, s.z - 18, 0, 14, 18, () => P.barn(b, 14, 18), { margin: 0.5, kind: 'barn' });
    } else if (/Trenches|Fortifications|Bunkers/.test(n)) {
      trenchLine(ctx, s.x, s.z - 18, 46, 0);
      trenchLine(ctx, s.x, s.z + 22, 36, 0);
      for (const dx of [-16, 16]) tryPlace(ctx, s.x + dx, s.z - 30, 0, 6, 5, () => P.bunker(b, 6, 5));
    } else if (/Artillery/.test(n)) {
      for (let i = 0; i < 4; i++) {
        const x = s.x - 18 + i * 12;
        if (ctx.occ.free(x - 3, s.z - 22, x + 3, s.z - 12)) {
          b.at(x, s.z - 16, 0, () => artilleryPiece(b, 0, 0));
          ctx.occ.markCircle(x, s.z - 16, 5);
        }
      }
    } else if (/Villas|Village|Town$|Fishing/.test(n)) {
      scatter(ctx, s.x, s.z, 55, 8, () => [rng.float(8, 11), rng.float(7, 9)], houseFn(st, rng), { kind: 'house', minR: 14 });
    } else if (/Bridge|Crossing|Dam/.test(n)) {
      b.at(s.x + 7, s.z + 7, 0, () => P.sandbagWall(b, 0, 0, 5, 1));
      b.at(s.x - 7, s.z - 7, 0, () => P.sandbagWall(b, 0, 0, 5, 1));
    } else if (/Harbour|Docks|Shipyard|Terminal$/.test(n) && t.type !== 'airbase') {
      tryPlace(ctx, s.x + 18, s.z - 6, 0, 22, 24, () => P.warehouse(b, 22, 24, 9, MAT.CONCRETE), { margin: 0.5, kind: 'warehouse' });
    } else if (/Hangar/.test(n)) {
      // airport builder handles it
    } else if (/Observation Post/.test(n) && ctx.occ.free(s.x - 28, s.z - 28, s.x + 28, s.z + 28)) {
      outpost(ctx, s.x, s.z, 24);
    }
  }
}

// Hesco ring with a bunker, a watchtower and tents.
export function outpost(ctx, x, z, r = 24) {
  const { b } = ctx;
  b.at(x, z, 0, () => {
    for (const [ox, oz, len, rot] of [[0, -r, r * 1.2, 0], [0, r, r * 1.2, 0], [-r, 0, r * 0.8, 1], [r, 0, r * 0.8, 1]]) {
      b.push(ox, 0, oz, 0);
      P.hescoLine(b, len, rot);
      b.pop();
    }
    b.push(r * 0.5, 0, r * 0.5, 2);
    P.bunker(b, 7, 6);
    b.pop();
    b.push(-r * 0.65, 0, r * 0.62, 0);
    P.watchtower(b);
    b.pop();
    b.push(-r * 0.55, 0, -r * 0.55, 0);
    P.tent(b, 6, 4);
    b.pop();
  });
  ctx.occ.markCircle(x, z, r + 3);
}

function fortress(ctx, x, z, r) {
  const { b } = ctx;
  b.at(x, z, 0, () => {
    for (const [ox, oz, len, rot] of [[0, -r, r * 2, 0], [0, r, r * 2, 0], [-r, 0, r * 2, 1], [r, 0, r * 2, 1]]) {
      b.push(ox, 0, oz, 0);
      if (rot) b.box(-1, 0, -len / 2, 1, 5, len / 2, MAT.STONE, BF.SOLID | BF.RENDER | BF.COVER);
      else {
        b.box(-len / 2, 0, -1, -4, 5, 1, MAT.STONE, BF.SOLID | BF.RENDER | BF.COVER);
        b.box(4, 0, -1, len / 2, 5, 1, MAT.STONE, BF.SOLID | BF.RENDER | BF.COVER);
      }
      b.pop();
    }
    for (const [cx, cz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) b.box(cx - 3, 0, cz - 3, cx + 3, 8, cz + 3, MAT.STONE, BF.SOLID | BF.RENDER | BF.COVER);
    b.push(0, 0, r * 0.4, 0);
    P.bunker(b, 9, 7);
    b.pop();
  });
  ctx.occ.markCircle(x, z, r + 4);
}

function trenchLine(ctx, x, z, len, rot) {
  const [fw, fd] = rot ? [5, len + 2] : [len + 2, 5];
  if (!ctx.occ.free(x - fw / 2, z - fd / 2, x + fw / 2, z + fd / 2)) return false;
  ctx.b.at(x, z, 0, () => P.trench(ctx.b, len, rot));
  ctx.occ.mark(x - fw / 2, z - fd / 2, x + fw / 2, z + fd / 2);
  return true;
}

// ---------------------------------------------------------------- cities
// Grid city: downtown towers in the middle, apartment blocks, shops and parks
// further out, then suburbs of houses.
function buildCityGrid(ctx, t, G, opts = {}) {
  const { b, rng, terrain } = ctx;
  const st = style(t);
  const B = CITY_BLOCK;
  for (let gx = -G; gx <= G; gx++) {
    for (let gz = -G; gz <= G; gz++) {
      const bx = t.x + gx * B;
      const bz = t.z + gz * B;
      const ring = Math.max(Math.abs(gx), Math.abs(gz));
      if (Math.hypot(gx, gz) > G + 0.6) continue;
      if (terrain.riverDistAt(bx, bz) < 30) continue;
      const nearSector = t.sectors.some((s) => dist2D(s.x, s.z, bx, bz) < 34);
      let kind;
      if (nearSector) kind = rng.chance(0.5) ? 'ruin' : 'low';
      else if (ring === 0 && opts.capital) kind = 'plaza';
      else if (ring <= 1) kind = rng.weighted([{ w: opts.capital ? 6 : 2, v: 'tower' }, { w: 4, v: 'apt' }, { w: 1, v: 'shops' }]);
      else kind = rng.weighted([{ w: 5, v: 'apt' }, { w: 2, v: 'shops' }, { w: 1.2, v: 'park' }, { w: opts.damaged ? 2 : 0.6, v: 'ruin' }]);
      // each block leaves ~37 m of buildable ground between its streets
      const q = 9.2;
      const quads = [[-q, -q], [q, -q], [-q, q], [q, q]];
      if (kind === 'plaza') {
        b.at(bx, bz, 0, () => P.fountain(b));
        ctx.occ.markCircle(bx, bz, 7);
        for (const [ox, oz] of quads) P.lamp(b, bx + ox * 1.4, bz + oz * 1.4);
        continue;
      }
      if (kind === 'tower') {
        const floors = Math.round(rng.int(7, 16) * st.tower);
        tryPlace(ctx, bx, bz, rng.int(0, 1), 26, 24, () => highrise(b, 26, 24, floors), { margin: 0.4, maxSlope: 6 });
        continue;
      }
      if (kind === 'shops') {
        for (const oz of [-q, q]) tryPlace(ctx, bx, bz + oz, oz < 0 ? 0 : 2, 35, 10, () => shopRow(b, 4), { margin: 0.2, maxSlope: 5 });
        continue;
      }
      for (const [ox, oz] of quads) {
        const x = bx + ox;
        const z = bz + oz;
        const rot = rotFacing(ox, oz);
        if (kind === 'park') {
          if (rng.chance(0.5)) ctx.trees.push({ x, y: terrain.heightAt(x, z), z, k: 1, s: rng.float(0.9, 1.3), r: rng.float(0, 6.28) });
          continue;
        }
        const w = rng.float(13.5, 16.5);
        const d = rng.float(13, 16);
        if (kind === 'apt') {
          const floors = rng.int(opts.capital ? 3 : 2, opts.capital ? 7 : 5);
          tryPlace(ctx, x, z, rot, w, d, () => P.apartment(b, w, d, floors, rng.pick(st.apt)), { margin: 0.4, kind: 'apartment' });
        } else if (kind === 'low') {
          tryPlace(ctx, x, z, rot, 11, 10, () => P.house(b, 11, 10, 2, { wall: rng.pick(st.walls), flatRoof: true, backDoor: true }), { margin: 0.6, kind: 'house' });
        } else {
          tryPlace(ctx, x, z, rot, 13, 12, () => P.ruin(b, 13, 12, rng.float(3, 7)), { margin: 0.6, kind: 'ruin', destructible: false });
        }
      }
    }
  }
  // street clutter: cars, barricades, lamps
  const span = (G + 0.5) * B;
  for (let i = 0; i < 18 + G * 8; i++) {
    const gx = rng.int(-G, G + 1);
    const along = rng.float(-span, span);
    const vertical = rng.chance(0.5);
    const off = (gx - 0.5) * B + rng.float(-2.5, 2.5);
    const x = vertical ? t.x + off : t.x + along;
    const z = vertical ? t.z + along : t.z + off;
    if (terrain.riverDistAt(x, z) < 16 || terrain.isRail(x, z)) continue;
    if (rng.chance(0.55)) b.at(x, z, 0, () => P.wreckCar(b, 0, 0, vertical ? 0 : 1));
    else b.at(x, z, 0, () => P.concreteBarrier(b, 0, 0, vertical ? 1 : 0));
  }
  for (let gx = -G; gx <= G + 1; gx++) {
    for (let k = -G; k <= G; k++) {
      const x = t.x + (gx - 0.5) * B + 6.4;
      const z = t.z + k * B;
      if (terrain.riverDistAt(x, z) < 16) continue;
      if (rng.chance(0.5)) b.at(x, z, 0, () => P.lamp(b, 0, 0, 6.5));
    }
  }
  // suburbs
  scatter(ctx, t.x, t.z, span + 150, opts.capital ? 60 : 36, () => [rng.float(9, 12), rng.float(8, 10)], houseFn(st, rng), { kind: 'house', minR: span + 20 });
  scatter(ctx, t.x, t.z, span + 170, opts.capital ? 8 : 5, () => [rng.float(20, 30), rng.float(14, 20)], (bb, w, d) => P.warehouse(bb, w, d, rng.float(7, 9), rng.pick([MAT.METAL, MAT.BRICK])), { kind: 'warehouse', minR: span + 40 });
  ctx.zones.push({ kind: 'city', x: t.x, z: t.z, r: span + 30 });
}

// City street segments (planned before the terrain materials are finalised).
export function cityStreets(t, G) {
  const B = CITY_BLOCK;
  const span = (G + 0.5) * B + 10;
  const out = [];
  for (let g = -G; g <= G + 1; g++) {
    const off = (g - 0.5) * B;
    out.push({ ax: t.x + off, az: t.z - span, bx: t.x + off, bz: t.z + span });
    out.push({ ax: t.x - span, az: t.z + off, bx: t.x + span, bz: t.z + off });
  }
  return out;
}

// ---------------------------------------------------------------- per type
function buildPort(ctx, t) {
  const { b, rng, terrain } = ctx;
  const st = style(t);
  const sea = seaDirection(terrain, t.x, t.z, 300) || { x: -1, z: 0 };
  const side = { x: -sea.z, z: sea.x };
  // piers along the coast
  for (const k of [-120, -50, 20, 90]) {
    const ox = t.x + side.x * k;
    const oz = t.z + side.z * k;
    const shore = shoreAlong(terrain, ox, oz, sea.x, sea.z, 420);
    if (!shore) continue;
    const alongX = Math.abs(sea.x) > Math.abs(sea.z);
    const len = 52;
    const px = shore.x + sea.x * (len / 2 - 6);
    const pz = shore.z + sea.z * (len / 2 - 6);
    b.at(px, pz, alongX ? 1 : 0, () => P.dock(b, len, 10), { y: 1.8 });
    ctx.occ.mark(px - (alongX ? len / 2 : 6), pz - (alongX ? 6 : len / 2), px + (alongX ? len / 2 : 6), pz + (alongX ? 6 : len / 2));
    if (k === 20) b.at(shore.x + sea.x * 36 + side.x * 16, shore.z + sea.z * 36 + side.z * 16, alongX ? 1 : 0, () => P.ship(b, 64, 13), { y: 0 });
    if (k === -50 || k === 90) b.markers.push({ type: 'vehicle', vtype: 'boat', x: shore.x + sea.x * 24 - side.x * 9, y: 0.4, z: shore.z + sea.z * 24 - side.z * 9, r: 5, yaw: Math.atan2(-sea.x, -sea.z), territory: t.id });
    const cx = shore.x - sea.x * 8;
    const cz = shore.z - sea.z * 8;
    tryPlace(ctx, cx, cz, alongX ? 1 : 0, 26, 9, () => P.crane(b, 14, 18), { margin: 0, maxSlope: 5 });
  }
  scatter(ctx, t.x - sea.x * 40, t.z - sea.z * 40, 120, 9, () => [rng.float(20, 30), rng.float(14, 18)], (bb, w, d) => P.warehouse(bb, w, d, 8, rng.pick([MAT.METAL, MAT.BRICK])), { kind: 'warehouse' });
  scatter(ctx, t.x - sea.x * 20, t.z - sea.z * 20, 110, 10, () => [14, 6], (bb) => P.containerStack(bb, 2, 2, 3));
  scatter(ctx, t.x - sea.x * 150, t.z - sea.z * 150, 150, 34, () => [rng.float(9, 12), rng.float(8, 10)], houseFn(st, rng), { kind: 'house' });
  ctx.zones.push({ kind: 'city', x: t.x - sea.x * 100, z: t.z - sea.z * 100, r: 170 });
}

function buildIndustrial(ctx, t) {
  const { b, rng } = ctx;
  const st = style(t);
  scatter(ctx, t.x, t.z, 170, 12, () => [rng.float(22, 34), rng.float(14, 22)], (bb, w, d) => P.warehouse(bb, w, d, rng.float(8, 11), rng.pick([MAT.METAL, MAT.BRICK, MAT.CONCRETE])), { kind: 'factory' });
  scatter(ctx, t.x, t.z, 160, 6, () => [7, 7], (bb) => P.silo(bb, 3, rng.float(12, 18)));
  scatter(ctx, t.x, t.z, 160, 3, () => [15, 15], (bb) => P.fuelTanks(bb));
  scatter(ctx, t.x, t.z, 170, 8, () => [14, 6], (bb) => P.containerStack(bb, 2, 2, 2));
  scatter(ctx, t.x, t.z, 150, 5, () => [4, 4], (bb) => P.chimney(bb, 1.5, rng.float(20, 30)));
  scatter(ctx, t.x, t.z, 150, 2, () => [26, 9], (bb) => P.crane(bb, 20, 18));
  // workers' housing
  scatter(ctx, t.x, t.z, 300, 14, () => [rng.float(16, 20), rng.float(12, 14)], (bb, w, d) => P.apartment(bb, w, d, rng.int(2, 4), rng.pick(st.apt)), { kind: 'apartment', minR: 180 });
  ctx.zones.push({ kind: 'city', x: t.x, z: t.z, r: 190 });
}

function buildMountain(ctx, t) {
  const { b, rng } = ctx;
  const [A] = t.sectors;
  for (const [ox, oz] of [[-44, -30], [44, -26]]) tryPlace(ctx, A.x + ox, A.z + oz, 0, 7, 6, () => P.bunker(b, 7, 6), { margin: 0.5, maxSlope: 7 });
  trenchLine(ctx, A.x, A.z - 52, 44, 0);
  for (let i = 0; i < 10; i++) {
    const x = t.x + rng.float(-140, 140);
    const z = t.z + rng.float(-140, 140);
    if (ctx.occ.at(x, z)) continue;
    b.at(x, z, 0, () => P.hedgehog(b, 0, 0));
  }
  scatter(ctx, t.x, t.z, 200, 9, () => [7, 6], (bb) => P.cabin(bb, 7, 6, true), { kind: 'cabin', maxSlope: 5 });
  scatter(ctx, t.x, t.z, 160, 3, () => [30, 4], (bb) => P.trench(bb, 26, 0), { maxSlope: 5 });
}

function buildForest(ctx, t) {
  const { b, rng } = ctx;
  const [A, B, C] = t.sectors;
  tryPlace(ctx, A.x + 22, A.z - 18, 0, 16, 10, () => P.sawmill(b), { margin: 0.5, maxSlope: 6, kind: 'sawmill' });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    tryPlace(ctx, A.x + Math.cos(a) * 38, A.z + Math.sin(a) * 38, rng.int(0, 3), 7, 6, () => P.cabin(b, 7, 6), { maxSlope: 5, kind: 'cabin' });
  }
  b.at(A.x - 18, A.z + 18, 0, () => P.logPile(b, 0, 0, 0));
  tryPlace(ctx, B.x + 12, B.z - 10, 0, 7, 6, () => P.cabin(b, 7, 6), { maxSlope: 6, kind: 'cabin', name: 'Ranger Station' });
  b.at(B.x - 12, B.z + 12, 0, () => P.watchtower(b));
  for (let i = 0; i < 3; i++) b.at(C.x + rng.float(-18, 18), C.z + rng.float(-18, 18), 0, () => P.tent(b, 5, 4));
  scatter(ctx, t.x, t.z, 200, 8, () => [7, 6], (bb) => P.cabin(bb, 7, 6), { kind: 'cabin' });
  scatter(ctx, t.x, t.z, 180, 6, () => [6, 6], (bb) => P.logPile(bb, 0, 0, 0));
}

function buildAirbase(ctx, t) {
  const { b, rng } = ctx;
  const st = style(t);
  const ap = AIRPORTS.find((a) => a.territory === t.id);
  if (ap) {
    const x = t.x + ap.off[0];
    const z = t.z + ap.off[1];
    const spots = [];
    b.at(x, z, ap.rot, () => {
      const loc = airport(b, ap.len, ap.name);
      for (const s of loc) {
        const [wx, wz] = b.toWorld(s.x, s.z);
        spots.push({ x: wx, z: wz, yaw: b.yawWorld(s.yaw), kind: s.kind });
      }
    }, { y: ctx.terrain.heightAt(x, z) });
    for (const s of spots) b.markers.push({ type: 'vehicle', vtype: s.kind, x: s.x, y: ctx.terrain.heightAt(s.x, s.z) + 0.4, z: s.z, r: 12, yaw: s.yaw, territory: t.id, airport: ap.name });
    const [hx, hz] = ap.rot & 1 ? [120, ap.len / 2 + 30] : [ap.len / 2 + 30, 120];
    ctx.occ.mark(x - hx, z - hz, x + hx, z + (ap.rot & 1 ? hz : 170));
    ctx.places.push({ name: ap.name, x, z, r: ap.len / 2, kind: 'airport', territory: t.id });
  }
  scatter(ctx, t.x, t.z, 260, 18, () => [rng.float(9, 11), rng.float(8, 9)], houseFn(st, rng), { kind: 'house' });
  scatter(ctx, t.x, t.z, 320, 5, () => [30, 26], (bb) => farmstead(bb));
  ctx.zones.push({ kind: 'farm', x: t.x, z: t.z, r: 420 });
}

function buildDesert(ctx, t) {
  const { b, rng } = ctx;
  const st = style(t);
  const [A, B] = t.sectors;
  outpost(ctx, A.x, A.z, 30);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    tryPlace(ctx, B.x + Math.cos(a) * 42, B.z + Math.sin(a) * 42, 0, 20, 8, () => oilDerrick(b), { margin: 1, maxSlope: 6 });
  }
  tryPlace(ctx, B.x - 60, B.z + 20, 0, 15, 15, () => P.fuelTanks(b), { margin: 1 });
  b.at(B.x, B.z + 60, 0, () => pipeline(b, 140, 0));
  scatter(ctx, t.x, t.z, 230, 12, () => [rng.float(8, 11), rng.float(7, 9)], (bb, w, d) => P.house(bb, w, d, 1, { wall: rng.pick([MAT.PLASTER_WARM, MAT.SANDBAG, MAT.PLASTER]), flatRoof: true }), { kind: 'house' });
  scatter(ctx, t.x, t.z, 220, 8, () => [6, 5], (bb) => P.tent(bb, 6, 5, MAT.CANVAS));
  void st;
}

function buildCanyon(ctx, t) {
  const { b, rng } = ctx;
  const [A, , C] = t.sectors;
  outpost(ctx, A.x, A.z, 26);
  for (let i = 0; i < 6; i++) b.at(C.x + rng.float(-30, 30), C.z + rng.float(-30, 30), 0, () => P.wreckCar(b, 0, 0, rng.int(0, 1)));
  scatter(ctx, t.x, t.z, 200, 6, () => [8, 7], (bb) => P.ruin(bb, 8, 7, 3.5), { kind: 'ruin' });
  scatter(ctx, t.x, t.z, 200, 7, () => [5, 5], (bb) => P.sandbagNest(bb, 2.4));
}

function buildLakeside(ctx, t) {
  const { b, rng, terrain } = ctx;
  const st = style(t);
  // harbour piers on the lake shore (south of the town)
  for (const dx of [-60, 0, 60]) {
    const shore = shoreAlong(terrain, t.x + dx, t.z, 0, 1, 300);
    if (!shore) continue;
    b.at(shore.x, shore.z + 14, 0, () => pier(b, 30, 4), { y: 1.4 });
    ctx.occ.mark(shore.x - 3, shore.z, shore.x + 3, shore.z + 30);
    if (dx !== 0) b.markers.push({ type: 'vehicle', vtype: 'boat', x: shore.x + 8, y: 0.4, z: shore.z + 22, r: 5, yaw: Math.PI, territory: t.id });
  }
  scatter(ctx, t.x, t.z - 60, 190, 36, () => [rng.float(9, 12), rng.float(8, 10)], houseFn(st, rng), { kind: 'house' });
  scatter(ctx, t.x - 120, t.z - 40, 70, 6, () => [14, 12], (bb) => P.house(bb, 14, 12, 2, { wall: MAT.PLASTER, roof: MAT.ROOF_TILE, backDoor: true }), { kind: 'villa' });
  scatter(ctx, t.x, t.z - 40, 150, 4, () => [36, 10], (bb) => shopRow(bb, 4), { maxSlope: 4 });
  ctx.zones.push({ kind: 'city', x: t.x, z: t.z - 40, r: 150 });
}

function buildFarmland(ctx, t) {
  const { b, rng } = ctx;
  const st = style(t);
  const [A] = t.sectors;
  tryPlace(ctx, A.x + 22, A.z - 22, 0, 9, 22, () => P.chapel(b), { margin: 0.5, maxSlope: 6, kind: 'chapel' });
  scatter(ctx, A.x, A.z, 70, 14, () => [rng.float(8, 11), rng.float(7, 9)], houseFn(st, rng), { kind: 'house', minR: 18 });
  scatter(ctx, t.x, t.z, 330, 9, () => [30, 26], (bb) => farmstead(bb));
  scatter(ctx, t.x, t.z, 300, 20, () => [22, 1], (bb) => P.stoneWall(bb, 22, 0));
  scatter(ctx, t.x, t.z, 300, 14, () => [18, 1], (bb) => P.fence(bb, 18, 0));
  ctx.zones.push({ kind: 'farm', x: t.x, z: t.z, r: 520 });
}

function buildCoastal(ctx, t) {
  const { b, rng, terrain } = ctx;
  const st = style(t);
  scatter(ctx, t.x, t.z - 40, 150, 30, () => [rng.float(8, 12), rng.float(7, 10)], houseFn(st, rng), { kind: 'house' });
  // beach fortifications along the shore
  const sea = seaDirection(terrain, t.x, t.z, 320) || { x: 0, z: 1 };
  const side = { x: -sea.z, z: sea.x };
  for (let k = -150; k <= 150; k += 30) {
    const shore = shoreAlong(terrain, t.x + side.x * k, t.z + side.z * k, sea.x, sea.z, 400);
    if (!shore) continue;
    const x = shore.x - sea.x * 22;
    const z = shore.z - sea.z * 22;
    if (k % 60 === 0) tryPlace(ctx, x, z, rotFacing(sea.x, sea.z), 6, 5, () => P.bunker(b, 6, 5), { margin: 0.5, maxSlope: 5, minHeight: 0.8 });
    else if (!ctx.occ.at(shore.x - sea.x * 6, shore.z - sea.z * 6)) b.at(shore.x - sea.x * 6, shore.z - sea.z * 6, 0, () => P.hedgehog(b, 0, 0));
  }
  ctx.zones.push({ kind: 'city', x: t.x, z: t.z - 40, r: 140 });
}

function buildIsland(ctx, t) {
  const { b, rng, terrain } = ctx;
  const [A, B, C] = t.sectors;
  outpost(ctx, A.x, A.z, 30);
  scatter(ctx, A.x, A.z, 80, 3, () => [28, 10], (bb) => P.barracks(bb, 26, 9), { kind: 'barracks', minR: 36 });
  const sea = seaDirection(terrain, A.x, A.z, 250) || { x: 0, z: -1 };
  const shore = shoreAlong(terrain, A.x, A.z, sea.x, sea.z, 300);
  if (shore) {
    const alongX = Math.abs(sea.x) > Math.abs(sea.z);
    b.at(shore.x + sea.x * 16, shore.z + sea.z * 16, alongX ? 1 : 0, () => P.dock(b, 40, 9), { y: 1.8 });
    b.markers.push({ type: 'vehicle', vtype: 'boat', x: shore.x + sea.x * 20 + sea.z * 10, y: 0.4, z: shore.z + sea.z * 20 - sea.x * 10, r: 5, yaw: Math.atan2(-sea.x, -sea.z), territory: t.id });
  }
  for (const dx of [-14, 14]) tryPlace(ctx, B.x + dx, B.z, 0, 10, 10, () => coastalGun(b), { margin: 0.5, maxSlope: 6 });
  scatter(ctx, C.x, C.z, 60, 8, () => [7, 6], (bb) => P.cabin(bb, 7, 6), { kind: 'cabin' });
  const hp = findSpot(ctx, A.x + 40, A.z - 30, 18, 18, 60);
  if (hp) {
    tryPlace(ctx, hp.x, hp.z, 0, 18, 18, () => P.helipad(b, 9), { margin: 0 });
    b.markers.push({ type: 'vehicle', vtype: 'heli', x: hp.x, y: terrain.heightAt(hp.x, hp.z) + 0.3, z: hp.z, r: 6, yaw: 0, territory: t.id });
  }
  void rng;
}

function buildHills(ctx, t) {
  const { b } = ctx;
  const [, B, C] = t.sectors;
  buildGarrison(b, t, t.rot || 0);
  tryPlace(ctx, B.x + 10, B.z - 10, 0, 7, 6, () => P.bunker(b, 7, 6), { margin: 0.5, maxSlope: 7 });
  b.at(B.x - 10, B.z + 10, 0, () => P.watchtower(b));
  scatter(ctx, C.x, C.z, 70, 10, () => [9, 8], houseFn(style(t), ctx.rng), { kind: 'house', minR: 18 });
}

export function buildTerritory(ctx, t) {
  setupSectors(ctx, t);
  for (const s of t.sectors) {
    if (s.underground) {
      b_under(ctx, s, t);
    }
  }
  // landmarks first so the generic fill (city blocks, scatter) builds around them
  landmarks(ctx, t);
  switch (t.type) {
    case 'capital': buildCityGrid(ctx, t, 3, { capital: true }); break;
    case 'city': buildCityGrid(ctx, t, 2, { damaged: t.front }); break;
    case 'port': buildPort(ctx, t); break;
    case 'industrial': buildIndustrial(ctx, t); break;
    case 'mountain': buildMountain(ctx, t); break;
    case 'forest': buildForest(ctx, t); break;
    case 'airbase': buildAirbase(ctx, t); break;
    case 'military': buildGarrison(ctx.b, t, t.rot || 0); break;
    case 'desert': buildDesert(ctx, t); break;
    case 'canyon': buildCanyon(ctx, t); break;
    case 'lakeside': buildLakeside(ctx, t); break;
    case 'farmland': buildFarmland(ctx, t); break;
    case 'coastal': buildCoastal(ctx, t); break;
    case 'island': buildIsland(ctx, t); break;
    case 'hills': buildHills(ctx, t); break;
    default: break;
  }
}

function b_under(ctx, s, t) {
  const { b } = ctx;
  const w = 18;
  const d = 14;
  b.at(s.x, s.z, 0, () => undergroundBunker(b, w, d, { name: s.name, maptable: true }), { y: s.groundY });
  ctx.occ.mark(s.x - w / 2 - 3, s.z - d / 2 - 12, s.x + w / 2 + 3, s.z + d / 2 + 3);
  ctx.places.push({ name: s.name, x: s.x, z: s.z, r: 25, kind: 'underground', territory: t.id });
}

// ---------------------------------------------------------------- villages
export function buildVillage(ctx, v) {
  const { b, rng, terrain } = ctx;
  const st = STYLE[v.country] || STYLE[1];
  // houses along the road through the village
  const road = v.road;
  const i0 = v.sampleIndex;
  const pts = road.samples;
  let placed = 0;
  for (let k = -24; k <= 24; k += 3) {
    const i = clamp(i0 + k * 2, 1, pts.length - 2);
    const p = pts[i];
    const q = pts[i + 1];
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l;
    const nz = dx / l;
    for (const side of [-1, 1]) {
      if (rng.chance(0.25)) continue;
      const off = road.width / 2 + rng.float(8, 12);
      const x = p.x + nx * side * off;
      const z = p.z + nz * side * off;
      const w = rng.float(8, 11);
      const d = rng.float(7, 9);
      if (tryPlace(ctx, x, z, rotFacing(-nx * side, -nz * side), w, d, (bb) => P.house(bb, w, d, rng.chance(0.3) ? 2 : 1, { wall: rng.pick(st.walls), roof: st.roof, chimney: rng.chance(0.4) }), { kind: 'house', maxSlope: 3 })) placed++;
    }
  }
  const c = pts[i0];
  const cnx = -(pts[Math.min(pts.length - 1, i0 + 1)].z - c.z);
  const cnz = pts[Math.min(pts.length - 1, i0 + 1)].x - c.x;
  const cl = Math.hypot(cnx, cnz) || 1;
  tryPlace(ctx, c.x + (cnx / cl) * 26, c.z + (cnz / cl) * 26, rotFacing(-cnx, -cnz), 9, 22, () => P.chapel(b), { kind: 'chapel', maxSlope: 4 });
  if (v.farm) {
    scatter(ctx, c.x, c.z, 220, 4, () => [30, 26], (bb) => farmstead(bb), { minR: 70 });
    ctx.zones.push({ kind: 'farm', x: c.x, z: c.z, r: 280 });
  }
  if (v.gas) tryPlace(ctx, c.x - (cnx / cl) * 24, c.z - (cnz / cl) * 24, rotFacing(cnx, cnz), 22, 30, () => gasStation(b), { maxSlope: 3 });
  ctx.places.push({ name: v.name, x: c.x, z: c.z, r: 110, kind: 'village', territory: v.territory });
  void terrain;
  return placed;
}

// ---------------------------------------------------------------- fronts
// Trenches, bunkers and dragon's teeth on the side of a territory that faces
// a neighbouring country.
export function buildFrontline(ctx, t, other) {
  const { b, rng } = ctx;
  const dx = other.x - t.x;
  const dz = other.z - t.z;
  const l = Math.hypot(dx, dz) || 1;
  const ux = dx / l;
  const uz = dz / l;
  const r = t.radius * 0.95;
  const rot = Math.abs(ux) > Math.abs(uz) ? 1 : 0; // trenches perpendicular to the threat
  for (let k = -2; k <= 2; k++) {
    const x = t.x + ux * r + (rot ? 0 : k * 34) + rng.float(-5, 5);
    const z = t.z + uz * r + (rot ? k * 34 : 0) + rng.float(-5, 5);
    if (ctx.terrain.heightAt(x, z) < 2) continue;
    trenchLine(ctx, x, z, 28, rot);
  }
  for (let k = -1; k <= 1; k += 2) {
    const x = t.x + ux * (r - 14) + (rot ? 0 : k * 50);
    const z = t.z + uz * (r - 14) + (rot ? k * 50 : 0);
    tryPlace(ctx, x, z, rotFacing(ux, uz), 6, 5, () => P.bunker(b, 6, 5), { maxSlope: 5 });
  }
  const tx = t.x + ux * (r + 26);
  const tz = t.z + uz * (r + 26);
  if (ctx.terrain.heightAt(tx, tz) > 2 && ctx.occ.free(tx - 24, tz - 24, tx + 24, tz + 24)) {
    b.at(tx, tz, 0, () => dragonTeeth(b, 44, rot));
    ctx.occ.markCircle(tx, tz, 24);
  }
}

// Border post where a road crosses between two countries.
export function buildBorderCrossing(ctx, road, i, countries) {
  const { b } = ctx;
  const pts = road.samples;
  const p = pts[i];
  const q = pts[Math.min(pts.length - 1, i + 2)];
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  const alongZ = Math.abs(dz) >= Math.abs(dx);
  const key = `border:${countries[0]}:${countries[1]}`;
  b.at(p.x, p.z, alongZ ? 0 : 1, () => borderPost(b, road.width, key), { y: p.h });
  ctx.occ.markCircle(p.x, p.z, road.width + 22);
  ctx.places.push({ name: 'Border Crossing', x: p.x, z: p.z, r: 40, kind: 'border' });
  ctx.borders.push({ x: p.x, z: p.z, countries });
}

export { officeBuilding, LVL };
