// World assembly: territories, bases, roads, bridges, towns, fortifications,
// vegetation. Fully deterministic for a given seed so the client can rebuild
// the exact world the simulation uses.
import { Rng, clamp, lerp, smoothstep, dist2D, hash2 } from '../math.js';
import { WORLD_HALF, WORLD_SEED, FACTION, SEA_LEVEL } from '../constants.js';
import {
  TERRITORIES, TERRITORY_BY_ID, ROAD_LINKS, ROAD_JUNCTIONS, anchorPos, RIVER_WIDTH, SECTOR_RADIUS,
} from '../config/territories.js';
import { Terrain, TMAT } from './terrain.js';
import { Builder, BF } from './builder.js';
import { MAT } from './materials.js';
import * as P from './prefabs.js';
import { Colliders } from './colliders.js';
import { NavGrid } from './nav.js';

// ------------------------------------------------------------------ occupancy
class Occupancy {
  constructor(terrain, cell = 2) {
    this.t = terrain;
    this.cell = cell;
    this.n = Math.ceil((WORLD_HALF * 2) / cell);
    this.grid = new Uint8Array(this.n * this.n);
  }
  mark(x0, z0, x1, z1, v = 1) {
    const c = this.cell;
    const i0 = clamp(Math.floor((x0 + WORLD_HALF) / c), 0, this.n - 1);
    const i1 = clamp(Math.floor((x1 + WORLD_HALF) / c), 0, this.n - 1);
    const j0 = clamp(Math.floor((z0 + WORLD_HALF) / c), 0, this.n - 1);
    const j1 = clamp(Math.floor((z1 + WORLD_HALF) / c), 0, this.n - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.grid[j * this.n + i] = Math.max(this.grid[j * this.n + i], v);
  }
  markCircle(x, z, r, v = 1) {
    this.mark(x - r, z - r, x + r, z + r, v);
  }
  free(x0, z0, x1, z1) {
    const c = this.cell;
    const i0 = Math.floor((x0 + WORLD_HALF) / c);
    const i1 = Math.floor((x1 + WORLD_HALF) / c);
    const j0 = Math.floor((z0 + WORLD_HALF) / c);
    const j1 = Math.floor((z1 + WORLD_HALF) / c);
    if (i0 < 0 || j0 < 0 || i1 >= this.n || j1 >= this.n) return false;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (this.grid[j * this.n + i]) return false;
    return true;
  }
  at(x, z) {
    const c = this.cell;
    const i = Math.floor((x + WORLD_HALF) / c);
    const j = Math.floor((z + WORLD_HALF) / c);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return 1;
    return this.grid[j * this.n + i];
  }
}

function footprint(w, d, rot) {
  return rot & 1 ? [d, w] : [w, d];
}

// Try to place a prefab of size w x d (local) at x,z with rotation rot.
function tryPlace(ctx, x, z, rot, w, d, fn, opts = {}) {
  const [fw, fd] = footprint(w, d, rot);
  const m = opts.margin ?? 1.5;
  const t = ctx.terrain;
  if (!ctx.occ.free(x - fw / 2 - m, z - fd / 2 - m, x + fw / 2 + m, z + fd / 2 + m)) return false;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [ox, oz] of [[-fw / 2, -fd / 2], [fw / 2, -fd / 2], [-fw / 2, fd / 2], [fw / 2, fd / 2], [0, 0]]) {
    const h = t.heightAt(x + ox, z + oz);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  if (lo < (opts.minHeight ?? 1.4)) return false;
  if (hi - lo > (opts.maxSlope ?? 3.5)) return false;
  ctx.occ.mark(x - fw / 2 - 0.5, z - fd / 2 - 0.5, x + fw / 2 + 0.5, z + fd / 2 + 0.5);
  ctx.b.at(x, z, rot, fn, { footprint: Math.min(fw, fd) / 2, y: opts.y });
  return true;
}

// Rotation (0..3) whose local -Z (front) faces the direction (dx,dz) most closely.
function rotFacing(dx, dz) {
  // local front (0,-1) under rot r -> r0:(0,-1) r1:(-1,0) r2:(0,1) r3:(1,0)
  if (Math.abs(dx) > Math.abs(dz)) return dx < 0 ? 1 : 3;
  return dz < 0 ? 0 : 2;
}

// ------------------------------------------------------------------ biomes
function makeBiomeAt(territories) {
  return (x, z) => {
    let best = null;
    let bestS = Infinity;
    for (const t of territories) {
      const k = t.biome === 'base' ? 1.3 : 2.1;
      const s = dist2D(x, z, t.x, t.z) / (t.radius * k);
      if (s < bestS) {
        bestS = s;
        best = t;
      }
    }
    if (best && bestS < 1) return best.biome === 'base' ? (best.faction === FACTION.DOMINION ? 'mountain' : 'wild') : best.biome;
    if (z < -470) return 'mountain';
    if (x > 250 && z > 250) return 'canyon';
    return 'wild';
  };
}

// ------------------------------------------------------------------ roads
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function planRoadPolyline(terrain, ax, az, bx, bz, wiggle, seed) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(2, Math.ceil(len / 110));
  const nx = -(bz - az) / len;
  const nz = (bx - ax) / len;
  const ctrl = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let x = lerp(ax, bx, t);
    let z = lerp(az, bz, t);
    if (i > 0 && i < n) {
      const off = (hash2(i, seed, 77) - 0.5) * 2 * Math.min(45, len * wiggle);
      x += nx * off;
      z += nz * off;
    }
    ctrl.push([x, z]);
  }
  const pts = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(1, Math.ceil(segLen / 3));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      pts.push({ x: catmull(p0[0], p1[0], p2[0], p3[0], t), z: catmull(p0[1], p1[1], p2[1], p3[1], t) });
    }
  }
  pts.push({ x: bx, z: bz });
  return pts;
}

// Compute the height profile (with bridge spans) for road samples.
function profileRoad(terrain, road) {
  const pts = road.samples;
  const raw = pts.map((p) => terrain.heightAt(p.x, p.z));
  for (let i = 0; i < pts.length; i++) {
    const rd = terrain.riverDistAt(pts[i].x, pts[i].z);
    pts[i].bridge = raw[i] < 1.6 && rd < RIVER_WIDTH / 2 + 10;
  }
  // smoothing
  const W = 6;
  const sm = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    let s = 0;
    let c = 0;
    for (let k = -W; k <= W; k++) {
      const j = clamp(i + k, 0, pts.length - 1);
      if (pts[j].bridge) continue;
      s += raw[j];
      c++;
    }
    sm[i] = Math.max(c ? s / c : raw[i], 1.6);
  }
  for (let i = 0; i < pts.length; i++) pts[i].h = sm[i];
  // bridge spans: constant deck height with ramps
  road.bridges = [];
  const orig = pts.map((p) => p.bridge);
  let i = 0;
  while (i < pts.length) {
    if (!orig[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < pts.length && orig[j + 1]) j++;
    // merge with a previous span that is very close
    const prev = road.bridges[road.bridges.length - 1];
    let s0 = Math.max(0, i - 3);
    const s1 = Math.min(pts.length - 1, j + 3);
    if (prev && s0 - prev.to < 8) {
      s0 = prev.from;
      road.bridges.pop();
    }
    const deck = Math.max(pts[s0].h, pts[s1].h, 2.4) + 0.9;
    for (let k = s0; k <= s1; k++) {
      pts[k].h = deck;
      pts[k].bridge = true;
    }
    const RAMP = 9;
    for (let k = 1; k <= RAMP; k++) {
      const t = k / (RAMP + 1);
      if (s0 - k >= 0) pts[s0 - k].h = lerp(deck, pts[s0 - k].h, t);
      if (s1 + k < pts.length) pts[s1 + k].h = lerp(deck, pts[s1 + k].h, t);
    }
    road.bridges.push({ from: s0, to: s1, deck });
    i = j + 1;
  }
}

// ------------------------------------------------------------------ main
export function generateWorld(seed = WORLD_SEED, opts = {}) {
  const t0 = Date.now();
  const rng = new Rng(seed);
  const terrain = new Terrain(seed);
  terrain.generateRaw();

  const territories = TERRITORIES.map((def) => ({
    ...def,
    x: def.center[0],
    z: def.center[1],
    faction: def.initialOwner,
    sectors: def.sectors.map((s) => ({ ...s, x: def.center[0] + s.off[0], z: def.center[1] + s.off[1] })),
  }));
  const tById = Object.fromEntries(territories.map((t) => [t.id, t]));

  // ---------------------------------------------------------- pads
  const pads = [];
  const padH = (x, z, min = 3) => Math.max(terrain.heightAt(x, z), min);
  for (const t of territories) {
    if (t.isBase) {
      pads.push({ x: t.x, z: t.z, r: 6, blend: 45, rect: [165, 128], h: padH(t.x, t.z, 4), overRiver: false });
    } else if (t.biome === 'city') {
      pads.push({ x: t.x, z: t.z, r: 4, blend: 55, rect: [170, 160], h: 5.5 });
    } else if (t.biome === 'industrial') {
      pads.push({ x: t.x, z: t.z, r: 4, blend: 50, rect: [120, 105], h: padH(t.x, t.z, 4.2) });
    } else if (t.biome === 'harbor' || t.biome === 'coastal') {
      pads.push({ x: t.x + 20, z: t.z, r: 60, blend: 45, h: padH(t.x + 20, t.z, 3.2) });
    } else {
      pads.push({ x: t.x, z: t.z, r: 42, blend: 38, h: padH(t.x, t.z) });
    }
  }
  for (const p of pads) terrain.applyPad(p);
  // Sector pads come after territory pads so they follow the settled ground.
  for (const t of territories) {
    for (const s of t.sectors) {
      const h = padH(s.x, s.z, 2.6);
      const pad = { x: s.x, z: s.z, r: 16, blend: 16, h };
      if (t.id === 'northland' && s.id === 'B') Object.assign(pad, { r: 42, blend: 18, h: Math.max(2.6, h - 1.2), mat: TMAT.ICE });
      terrain.applyPad(pad);
    }
  }

  // ---------------------------------------------------------- roads
  const roads = [];
  let roadId = 0;
  for (const [a, bId] of ROAD_LINKS) {
    const A = anchorPos(a);
    const B = anchorPos(bId);
    const samples = planRoadPolyline(terrain, A[0], A[1], B[0], B[1], 0.09, roadId * 17 + 3);
    roads.push({ id: roadId++, a, b: bId, width: 9, samples, kind: 'main' });
  }
  // Capital street grid
  const cap = tById.capital;
  const BLOCK = 46;
  const cityStreets = [];
  for (let g = -3; g <= 4; g++) {
    const off = (g - 0.5) * BLOCK;
    const span = 165;
    // north-south street at x = cap.x + off
    cityStreets.push({ ax: cap.x + off, az: cap.z - span, bx: cap.x + off, bz: cap.z + span });
    cityStreets.push({ ax: cap.x - span, az: cap.z + off, bx: cap.x + span, bz: cap.z + off });
  }
  for (const s of cityStreets) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    const steps = Math.ceil(len / 3);
    const samples = [];
    for (let i = 0; i <= steps; i++) samples.push({ x: lerp(s.ax, s.bx, i / steps), z: lerp(s.az, s.bz, i / steps) });
    // Streets that run along the river would become absurdly long bridges; skip them.
    const wet = samples.filter((p) => terrain.riverDistAt(p.x, p.z) < RIVER_WIDTH / 2 + 12).length;
    if (wet / samples.length > 0.22) continue;
    roads.push({ id: roadId++, a: 'capital', b: 'capital', width: 11, samples, kind: 'street' });
  }
  for (const r of roads) profileRoad(terrain, r);
  for (const r of roads) terrain.applyRoad(r);

  const biomeAt = makeBiomeAt(territories);
  terrain.finalizeMaterials(biomeAt);

  // ---------------------------------------------------------- structures
  const b = new Builder(terrain, rng);
  const occ = new Occupancy(terrain);
  const ctx = { terrain, rng, b, occ, territories, tById, roads };
  // roads occupy space
  for (const r of roads) {
    for (const p of r.samples) occ.markCircle(p.x, p.z, r.width / 2 + 1.5);
  }
  // water occupies space
  for (let z = -WORLD_HALF; z < WORLD_HALF; z += 4) {
    for (let x = -WORLD_HALF; x < WORLD_HALF; x += 4) {
      if (terrain.heightAt(x + 2, z + 2) < 1.0) occ.mark(x, z, x + 4, z + 4);
    }
  }

  buildBridges(ctx);
  // snap bridge sectors to real bridges
  for (const t of territories) {
    for (const s of t.sectors) {
      if (s.name.includes('Bridge')) {
        let best = null;
        let bd = Infinity;
        for (const r of roads) {
          for (const br of r.bridges) {
            for (const idx of [br.from - 2, br.to + 2]) {
              const p = r.samples[clamp(idx, 0, r.samples.length - 1)];
              const d = dist2D(p.x, p.z, s.x, s.z);
              if (d < bd && d < 160) {
                bd = d;
                best = p;
              }
            }
          }
        }
        if (best) {
          s.x = best.x;
          s.z = best.z;
        }
      }
    }
  }

  const baseInfo = {};
  for (const t of territories) {
    if (t.isBase) baseInfo[t.faction] = buildBase(ctx, t);
  }
  for (const t of territories) {
    if (t.isBase) continue;
    setupSectors(ctx, t);
    switch (t.biome) {
      case 'city': buildCity(ctx, t); break;
      case 'industrial': buildIndustrial(ctx, t); break;
      case 'harbor': buildHarbor(ctx, t); break;
      case 'coastal': buildCoastalTown(ctx, t); break;
      case 'farmland': buildFarmland(ctx, t); break;
      case 'canyon': buildCanyon(ctx, t); break;
      case 'mountain': buildMountain(ctx, t); break;
      case 'forest': buildForest(ctx, t); break;
      default: break;
    }
  }
  buildRoadside(ctx);
  const trees = plantTrees(ctx, biomeAt);
  scatterRocks(ctx, biomeAt);
  computeTerritoryPoints(ctx);

  // ---------------------------------------------------------- compile
  const colliders = new Colliders(terrain, b.boxes);
  const cover = buildCover(b.boxes, colliders, terrain);
  const nav = opts.nav ? new NavGrid(terrain, colliders, b.boxes) : null;

  const vehicleSpawns = b.markers.filter((m) => m.type === 'vehicle');
  const world = {
    seed,
    terrain,
    colliders,
    nav,
    boxes: b.boxes,
    props: b.props,
    lights: b.lights,
    flags: b.flags,
    markers: b.markers,
    trees,
    roads,
    cover,
    territories,
    tById,
    bases: baseInfo,
    vehicleSpawns,
    rangeTargets: b.rangeTargets,
    biomeAt,
    genMs: Date.now() - t0,
  };
  world.routeBetween = (fromId, toId) => roadRoute(world, fromId, toId);
  return world;
}

// ------------------------------------------------------------------ bridges
function buildBridges(ctx) {
  const { b, roads } = ctx;
  for (const r of roads) {
    for (const br of r.bridges) {
      const pts = r.samples.slice(br.from, br.to + 1);
      const deck = br.deck;
      const half = r.width / 2;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        b.boxes.push({ x0: p.x - half * 0.8, y0: deck - 0.6, z0: p.z - half * 0.8, x1: p.x + half * 0.8, y1: deck, z1: p.z + half * 0.8, m: MAT.CONCRETE, f: BF.SOLID | BF.WALKSURF });
        // railings: small posts at the edges (solid only; rendered by the bridge prop)
        const q = pts[Math.min(pts.length - 1, i + 1)];
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l;
        const nz = dx / l;
        for (const side of [-1, 1]) {
          const ex = p.x + nx * half * side;
          const ez = p.z + nz * half * side;
          b.boxes.push({ x0: ex - 0.35, y0: deck, z0: ez - 0.35, x1: ex + 0.35, y1: deck + 1.0, z1: ez + 0.35, m: MAT.CONCRETE, f: BF.SOLID | BF.COVER });
        }
      }
      b.props.push({ t: 'bridge', pts: pts.map((p) => [p.x, p.z]), deck, w: r.width, m: MAT.CONCRETE, x: pts[0].x, y: deck, z: pts[0].z, yaw: 0 });
    }
  }
}

// ------------------------------------------------------------------ bases
function toWorldFrame(t, rot, lx, lz) {
  switch (rot & 3) {
    case 0: return [t.x + lx, t.z + lz];
    case 1: return [t.x + lz, t.z - lx];
    case 2: return [t.x - lx, t.z - lz];
    default: return [t.x - lz, t.z + lx];
  }
}
function toLocalFrame(t, rot, x, z) {
  const dx = x - t.x;
  const dz = z - t.z;
  switch (rot & 3) {
    case 0: return [dx, dz];
    case 1: return [-dz, dx];
    case 2: return [-dx, -dz];
    default: return [dz, -dx];
  }
}

function buildBase(ctx, t) {
  const { b, terrain, occ, roads } = ctx;
  const rot = t.faction === FACTION.DOMINION ? 2 : 0;
  const y = terrain.heightAt(t.x, t.z);
  const W = 150;
  const D = 115;
  const dom = t.faction === FACTION.DOMINION;
  const info = { id: t.id, faction: t.faction, spawns: [], x: t.x, z: t.z, y, rot, rect: [W, D] };
  // clear occupancy for the whole base so vegetation stays out
  {
    const c0 = toWorldFrame(t, rot, -W - 6, -D - 6);
    const c1 = toWorldFrame(t, rot, W + 6, D + 6);
    occ.mark(Math.min(c0[0], c1[0]), Math.min(c0[1], c1[1]), Math.max(c0[0], c1[0]), Math.max(c0[1], c1[1]), 2);
  }
  // gates where roads cross the perimeter
  const gates = { N: [], S: [], E: [], W: [] };
  for (const r of roads) {
    if (r.a !== t.id && r.b !== t.id) continue;
    for (const p of r.samples) {
      const [lx, lz] = toLocalFrame(t, rot, p.x, p.z);
      if (Math.abs(lx) > W || Math.abs(lz) > D) {
        const ex = Math.abs(lx) / W;
        const ez = Math.abs(lz) / D;
        if (ex > ez) gates[lx > 0 ? 'E' : 'W'].push(clamp(lz, -D + 12, D - 12));
        else gates[lz > 0 ? 'S' : 'N'].push(clamp(lx, -W + 12, W - 12));
        break;
      }
    }
  }
  b.push(t.x, y, t.z, rot);
  const hescoSide = (ax, az, bx, bz, gateList) => {
    const alongX = az === bz;
    const len = alongX ? Math.abs(bx - ax) : Math.abs(bz - az);
    const start = alongX ? Math.min(ax, bx) : Math.min(az, bz);
    const cuts = gateList.map((g) => [g - 9, g + 9]).sort((p, q) => p[0] - q[0]);
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
    for (const g of gateList) {
      // gate posts, barrier and a guard
      const gx = alongX ? g : ax;
      const gz = alongX ? az : g;
      for (const s of [-1, 1]) {
        const px = alongX ? gx + s * 9.5 : gx;
        const pz = alongX ? gz : gz + s * 9.5;
        b.cbox(px, 0, pz, 1.6, 3.2, 1.6, dom ? MAT.CONCRETE_DARK : MAT.CONCRETE, BF.SOLID | BF.RENDER | BF.COVER);
      }
      b.marker('guard', alongX ? gx + 6 : gx + (ax > 0 ? -4 : 4), 0, alongX ? gz + (az > 0 ? -4 : 4) : gz + 6, 2, { lookX: gx, lookZ: gz + (az > 0 ? 30 : -30) });
      b.light(gx, 4, gz, 18);
    }
  };
  hescoSide(-W, -D, W, -D, gates.N);
  hescoSide(-W, D, W, D, gates.S);
  hescoSide(-W, -D, -W, D, gates.W);
  hescoSide(W, -D, W, D, gates.E);
  for (const [cx, cz] of [[-W + 4, -D + 4], [W - 4, -D + 4], [-W + 4, D - 4], [W - 4, D - 4]]) {
    b.push(cx, 0, cz, 0);
    P.watchtower(b);
    b.pop();
    b.marker('guard', cx, 5.45, cz, 1.5, { tower: true });
  }

  // --- Command HQ, mission board, flag
  b.push(0, 0, -72, 0);
  P.commandPost(b, true);
  b.pop();
  b.push(-16, 0, -50, 0);
  P.missionBoard(b);
  b.pop();
  P.flagpole(b, `base:${t.id}`, 0, -34, 12);
  // parade ground
  b.push(0, 0, -20, 0);
  P.paradeGround(b);
  b.pop();
  // barracks row
  for (const z of [-92, -76, -60]) {
    b.push(-100, 0, z, 0);
    P.barracks(b);
    b.pop();
  }
  // obstacle course (training)
  b.push(-58, 0, -48, 0);
  P.obstacleCourse(b);
  b.pop();
  // shooting range, lanes towards local west
  b.push(-80, 0, 18, 1);
  P.shootingRange(b, 6);
  b.pop();
  // spawn yard
  const spawnC = [10, 12];
  b.box(spawnC[0] - 14, 0, spawnC[1] - 10, spawnC[0] + 14, 0.06, spawnC[1] + 10, MAT.GRAVEL, BF.RENDER);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const [wx, wz] = b.toWorld(spawnC[0] + Math.cos(a) * 7, spawnC[1] + Math.sin(a) * 5);
    info.spawns.push({ x: wx, z: wz, y: y + 0.1 });
  }
  for (const [x, z] of [[-8, 26], [-2, 26], [22, 26], [28, 26]]) {
    b.push(x, 0, z, 2);
    P.tent(b, 5, 4, dom ? MAT.OLIVE : MAT.CANVAS);
    b.pop();
  }
  P.crates(b, 26, 4, 4);
  // armory + medical
  b.push(-38, 0, 46, 2);
  P.armory(b);
  b.pop();
  for (const [x, z] of [[40, 22], [40, 38]]) {
    b.push(x, 0, z, 1);
    P.medTent(b);
    b.pop();
  }
  // vehicle depot
  for (const z of [-86, -70]) {
    b.push(78, 0, z, 3);
    P.garage(b);
    b.pop();
  }
  const pads = [
    ['tank', 118, -88], ['apc', 118, -70], ['truck', 118, -52], ['truck', 104, -52],
    ['jeep', 90, -40], ['jeep', 80, -40], ['recon', 70, -40], ['apc', 104, -34],
  ];
  for (const [type, x, z] of pads) {
    b.push(x, 0, z, 0);
    P.vehiclePad(b, type === 'tank' ? 7 : 6, type === 'tank' ? 12 : 10);
    b.pop();
    b.marker('vehicle', x, 0.3, z, 4, { vtype: type, yaw: b.yawWorld(0), faction: t.faction, base: t.id });
  }
  for (const [x, z] of [[108, 8], [108, 36]]) {
    b.push(x, 0, z, 0);
    P.helipad(b);
    b.pop();
    b.marker('vehicle', x, 0.3, z, 6, { vtype: 'heli', yaw: b.yawWorld(0), faction: t.faction, base: t.id });
  }
  // airfield: runway, hangar, control tower
  b.box(-135, 0, 76, 125, 0.07, 96, MAT.ASPHALT, BF.RENDER | BF.SOLID);
  for (let x = -125; x < 120; x += 14) b.box(x, 0.07, 85.6, x + 7, 0.08, 86.4, MAT.PAINT_WHITE, BF.RENDER);
  b.push(-98, 0, 52, 2);
  P.hangar(b);
  b.pop();
  b.push(-40, 0, 62, 0);
  P.controlTower(b);
  b.pop();
  // fuel & lamps
  b.push(60, 0, 60, 0);
  P.fuelTanks(b);
  b.pop();
  for (const [x, z] of [[-20, 0], [30, -40], [-60, 30], [60, 0], [0, 45], [-30, -40]]) P.lamp(b, x, z);
  // ambient life markers
  b.marker('work', 78, 0.2, -78, 3, { activity: 'repair' });
  b.marker('work', 104, 0.2, -60, 3, { activity: 'repair' });
  b.marker('talk', -16, 0.2, -40, 2);
  b.marker('talk', 22, 0.2, 40, 2);
  b.marker('carry_a', -38, 0.2, 38, 2);
  b.marker('carry_b', 70, 0.2, -52, 2);
  b.marker('range_pos', -80, 0.2, 16, 12);
  b.marker('drill', 0, 0.2, -20, 12);
  b.marker('patrol', -130, 0.2, -100, 2);
  b.marker('patrol', 130, 0.2, -100, 2);
  b.marker('patrol', 130, 0.2, 60, 2);
  b.marker('patrol', -130, 0.2, 60, 2);
  b.marker('spawn_yard', spawnC[0], 0.2, spawnC[1], 12);
  b.pop();

  // collect markers belonging to this base
  info.markers = b.markers.filter((m) => dist2D(m.x, m.z, t.x, t.z) < 200 && !m.base);
  return info;
}

// ------------------------------------------------------------------ sectors
function setupSectors(ctx, t) {
  const { b, occ, terrain } = ctx;
  t.spawns = [];
  for (const s of t.sectors) {
    s.y = terrain.heightAt(s.x, s.z);
    s.r = SECTOR_RADIUS;
    b.at(s.x, s.z, 0, () => P.flagpole(b, `${t.id}:${s.id}`, 0, 0, 9));
    occ.markCircle(s.x, s.z, 4);
    // defensive position around the flag
    const rot = ctx.rng.int(0, 3);
    b.at(s.x + 9, s.z + 7, rot, () => P.sandbagNest(b, 2.6));
    occ.markCircle(s.x + 9, s.z + 7, 4);
    b.at(s.x - 10, s.z - 6, 0, () => P.crates(b, 0, 0, 3));
    occ.markCircle(s.x - 10, s.z - 6, 3);
    if (s.id === 'A') {
      // command post: spawn point for the owner while the sector is not contested
      const dirx = t.x - s.x;
      const dirz = t.z - s.z;
      const l = Math.hypot(dirx, dirz);
      let px = s.x + 16;
      let pz = s.z - 14;
      if (l > 20) {
        px = s.x + (dirx / l) * 18;
        pz = s.z + (dirz / l) * 18;
      }
      const cp = findSpot(ctx, px, pz, 12, 9, 30) || { x: px, z: pz, rot: 0 };
      tryPlace(ctx, cp.x, cp.z, cp.rot, 12, 9, () => P.commandPost(b, false), { margin: 0.5, maxSlope: 6 });
      t.commandPost = { x: cp.x, z: cp.z, y: terrain.heightAt(cp.x, cp.z) };
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = cp.x + Math.cos(a) * 11;
        const z = cp.z + Math.sin(a) * 11;
        t.spawns.push({ x, z, y: terrain.heightAt(x, z) });
      }
      // vehicle pad near the command post
      const vp = findSpot(ctx, cp.x + 14, cp.z + 10, 6, 10, 30);
      if (vp) {
        tryPlace(ctx, vp.x, vp.z, vp.rot, 6, 10, () => P.vehiclePad(b), { margin: 0.3 });
        b.markers.push({ type: 'vehicle', x: vp.x, y: terrain.heightAt(vp.x, vp.z) + 0.3, z: vp.z, r: 4, vtype: t.biome === 'harbor' ? 'truck' : 'jeep', yaw: (vp.rot * Math.PI) / 2, territory: t.id });
      }
    }
  }
}

// Spiral search for a free placement spot.
function findSpot(ctx, x, z, w, d, maxR) {
  for (let r = 0; r <= maxR; r += 3) {
    const steps = Math.max(1, Math.floor(r / 2));
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      for (const rot of [0, 1]) {
        const [fw, fd] = footprint(w, d, rot);
        if (!ctx.occ.free(px - fw / 2 - 1, pz - fd / 2 - 1, px + fw / 2 + 1, pz + fd / 2 + 1)) continue;
        const h = ctx.terrain.heightAt(px, pz);
        if (h < 1.5) continue;
        return { x: px, z: pz, rot };
      }
    }
  }
  return null;
}

function nearestRoadDir(ctx, x, z) {
  let best = null;
  let bd = Infinity;
  for (const r of ctx.roads) {
    for (let i = 0; i < r.samples.length; i += 3) {
      const p = r.samples[i];
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
  }
  return best ? { dx: best.x - x, dz: best.z - z, d: Math.sqrt(bd) } : { dx: 0, dz: -1, d: 999 };
}

// Scatter prefabs in a ring/area with rejection sampling.
function scatter(ctx, cx, cz, radius, count, sizeFn, placeFn, tries = 12) {
  let placed = 0;
  for (let i = 0; i < count * tries && placed < count; i++) {
    const a = ctx.rng.float(0, Math.PI * 2);
    const d = Math.sqrt(ctx.rng.next()) * radius;
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    const [w, dd] = sizeFn();
    const road = nearestRoadDir(ctx, x, z);
    const rot = road.d < 40 ? rotFacing(road.dx, road.dz) : ctx.rng.int(0, 3);
    if (tryPlace(ctx, x, z, rot, w, dd, (bb) => placeFn(bb, w, dd))) placed++;
  }
  return placed;
}

// ------------------------------------------------------------------ biomes
function buildCity(ctx, t) {
  const { b, rng, terrain } = ctx;
  const BLOCK = 46;
  const secA = t.sectors[0];
  // Parliament square: government building north of the flag, fountain nearby
  tryPlace(ctx, secA.x, secA.z - 34, 0, 50, 34, () => P.govBuilding(b), { margin: 0, maxSlope: 8 });
  tryPlace(ctx, secA.x - 14, secA.z + 6, 0, 10, 10, () => P.fountain(b), { margin: 0 });
  const secB = t.sectors[1];
  tryPlace(ctx, secB.x, secB.z - 20, 0, 56, 22, () => P.station(b), { margin: 0, maxSlope: 8 });
  const secC = t.sectors[2];
  b.at(secC.x + 4, secC.z + 12, 0, () => P.marketStalls(b, 6));
  ctx.occ.markCircle(secC.x + 4, secC.z + 12, 14);

  for (let gx = -3; gx <= 3; gx++) {
    for (let gz = -3; gz <= 3; gz++) {
      const bx = t.x + gx * BLOCK;
      const bz = t.z + gz * BLOCK;
      if (Math.hypot(gx, gz) > 3.6) continue;
      if (terrain.riverDistAt(bx, bz) < 34) continue;
      const nearSector = t.sectors.some((s) => dist2D(s.x, s.z, bx, bz) < 30);
      const kind = nearSector ? 'ruin' : rng.weighted([{ w: 5, v: 'apt' }, { w: 2, v: 'mixed' }, { w: 1.5, v: 'ruin' }, { w: 1, v: 'park' }]);
      const q = 8.5;
      const quads = [[-q, -q], [q, -q], [-q, q], [q, q]];
      for (const [ox, oz] of quads) {
        const x = bx + ox;
        const z = bz + oz;
        const rot = rotFacing(ox, oz); // face outward to the street
        const w = rng.float(13, 16);
        const d = rng.float(12, 15);
        if (kind === 'park') {
          if (rng.chance(0.5)) tryPlace(ctx, x, z, 0, 3, 3, () => P.crates(b, 0, 0, 2));
          continue;
        }
        if (kind === 'apt' || (kind === 'mixed' && rng.chance(0.5))) {
          const floors = rng.int(2, 6);
          const m = rng.pick([MAT.PLASTER, MAT.BRICK, MAT.PLASTER_WARM, MAT.CONCRETE, MAT.STONE]);
          tryPlace(ctx, x, z, rot, w, d, () => P.apartment(b, w, d, floors, m), { margin: 0.4 });
        } else if (kind === 'mixed') {
          tryPlace(ctx, x, z, rot, 11, 10, () => P.house(b, 11, 10, 2, { wall: MAT.BRICK, flatRoof: true, backDoor: true }), { margin: 0.6 });
        } else {
          tryPlace(ctx, x, z, rot, 12, 11, () => P.ruin(b, 12, 11, rng.float(3, 7)), { margin: 0.6 });
        }
      }
    }
  }
  // street clutter: wrecks, barricades, lamps
  for (let i = 0; i < 26; i++) {
    const gx = rng.int(-3, 4);
    const along = rng.float(-150, 150);
    const vertical = rng.chance(0.5);
    const off = (gx - 0.5) * BLOCK + rng.float(-3, 3);
    const x = vertical ? t.x + off : t.x + along;
    const z = vertical ? t.z + along : t.z + off;
    if (terrain.riverDistAt(x, z) < 20) continue;
    if (rng.chance(0.55)) b.at(x, z, 0, () => P.wreckCar(b, 0, 0, vertical ? 0 : 1));
    else b.at(x, z, 0, () => P.concreteBarrier(b, 0, 0, vertical ? 1 : 0));
  }
  for (let gx = -3; gx <= 4; gx++) {
    for (let k = -3; k <= 3; k++) {
      const x = t.x + (gx - 0.5) * BLOCK + 6.2;
      const z = t.z + k * BLOCK;
      if (terrain.riverDistAt(x, z) < 22) continue;
      if (rng.chance(0.55)) b.at(x, z, 0, () => P.lamp(b, 0, 0, 6));
    }
  }
}

function buildIndustrial(ctx, t) {
  const { b, rng } = ctx;
  const [A, B, C] = t.sectors;
  // Foundry: big factory hall with chimneys
  tryPlace(ctx, A.x + 2, A.z - 30, 0, 36, 22, () => P.warehouse(b, 36, 22, 10, MAT.BRICK), { margin: 0.5, maxSlope: 6 });
  tryPlace(ctx, A.x + 26, A.z - 18, 0, 5, 5, () => P.chimney(b, 1.8, 30));
  tryPlace(ctx, A.x + 30, A.z - 34, 0, 5, 5, () => P.chimney(b, 1.6, 26));
  // Rail yard: tracks, wagons, container stacks, crane
  b.at(B.x, B.z, 0, () => {
    for (const oz of [-8, -3, 3, 8]) {
      b.box(-70, 0, oz - 0.7, 70, 0.18, oz - 0.55, MAT.DARK_METAL, BF.RENDER);
      b.box(-70, 0, oz + 0.55, 70, 0.18, oz + 0.7, MAT.DARK_METAL, BF.RENDER);
      for (let x = -60; x < 60; x += rng.float(16, 30)) {
        if (Math.abs(x) < 8) continue;
        b.box(x - 6.5, 0.6, oz - 1.4, x + 6.5, 3.9, oz + 1.4, rng.pick([MAT.RUST, MAT.CONTAINER_TAN, MAT.CONTAINER_RED]), BF.SOLID | BF.RENDER | BF.COVER);
      }
    }
  });
  ctx.occ.mark(B.x - 72, B.z - 11, B.x + 72, B.z + 11);
  tryPlace(ctx, B.x + 6, B.z + 30, 0, 26, 9, () => P.containerStack(b, 4, 3, 3), { margin: 0.5 });
  tryPlace(ctx, B.x - 30, B.z + 28, 1, 30, 10, () => P.crane(b, 20, 18), { margin: 0 });
  // River bridge defenses
  b.at(C.x, C.z, 0, () => {
    P.sandbagWall(b, 6, 6, 5, 1);
    P.sandbagWall(b, -6, 6, 5, 1);
  });
  const bk = findSpot(ctx, C.x + 12, C.z + 14, 8, 7, 30);
  if (bk) tryPlace(ctx, bk.x, bk.z, rotFacing(C.x - bk.x, C.z - bk.z), 8, 7, () => P.bunker(b, 8, 7));
  // Factories, warehouses, silos, fuel tanks around
  scatter(ctx, t.x, t.z, 125, 9, () => [rng.float(20, 32), rng.float(14, 22)], (bb, w, d) => P.warehouse(bb, w, d, rng.float(7, 10), rng.pick([MAT.METAL, MAT.BRICK, MAT.CONCRETE])));
  scatter(ctx, t.x, t.z, 120, 5, () => [7, 7], (bb) => P.silo(bb, 3, rng.float(12, 18)));
  scatter(ctx, t.x, t.z, 120, 2, () => [15, 15], (bb) => P.fuelTanks(bb));
  scatter(ctx, t.x, t.z, 120, 6, () => [14, 6], (bb) => P.containerStack(bb, 2, 2, 2));
  scatter(ctx, t.x, t.z, 110, 3, () => [4, 4], (bb) => P.chimney(bb, 1.4, rng.float(18, 26)));
}

function buildHarbor(ctx, t) {
  const { b, rng, terrain } = ctx;
  const [A, B, C] = t.sectors;
  // Piers along the coast
  for (const dz of [-80, -25, 30, 90]) {
    const z = t.z + dz;
    const cx = terrain.coastX(z);
    // find the actual shoreline
    let shore = cx + 60;
    for (let x = cx + 60; x > cx - 80; x -= 2) {
      if (terrain.heightAt(x, z) < 0.3) {
        shore = x;
        break;
      }
    }
    const len = 48;
    b.at(shore - len / 2 + 8, z, 1, () => P.dock(b, len, 9), { y: 1.7 });
    ctx.occ.mark(shore - len, z - 6, shore + 8, z + 6);
    if (dz === 30) b.at(shore - 30, z + 14, 1, () => P.ship(b, 62, 13), { y: 0 });
    if (dz === -25 || dz === 90) b.markers.push({ type: 'vehicle', vtype: 'boat', x: shore - 20, y: 0.4, z: z - 9, r: 5, yaw: Math.PI / 2, territory: t.id });
    b.at(shore + 6, z + 6, 1, () => P.crane(b, 12, 18), { y: terrain.heightAt(shore + 6, z) });
  }
  // Container yard
  for (let i = 0; i < 6; i++) {
    tryPlace(ctx, B.x - 18 + (i % 3) * 18, B.z - 22 + Math.floor(i / 3) * 44, 0, 14, 7, () => P.containerStack(b, 2, 2, 3), { margin: 1 });
  }
  // Dry docks: big concrete apron + crane
  tryPlace(ctx, C.x + 18, C.z - 6, 0, 22, 24, () => P.warehouse(b, 22, 24, 9, MAT.CONCRETE), { margin: 0.5 });
  // Warehouses behind the quay
  scatter(ctx, t.x + 45, t.z, 95, 8, () => [rng.float(18, 28), rng.float(12, 18)], (bb, w, d) => P.warehouse(bb, w, d, 8, rng.pick([MAT.METAL, MAT.BRICK])));
  scatter(ctx, t.x + 40, t.z, 100, 6, () => [14, 6], (bb) => P.containerStack(bb, 2, 2, 2));
  scatter(ctx, t.x + 60, t.z, 90, 5, () => [10, 9], (bb) => P.house(bb, 10, 9, 2, { wall: MAT.BRICK, flatRoof: true }));
  void A;
}

function buildCoastalTown(ctx, t) {
  const { b, rng, terrain } = ctx;
  const [A, B, C] = t.sectors;
  tryPlace(ctx, A.x, A.z - 22, 0, 18, 13, () => P.house(b, 18, 13, 2, { wall: MAT.STONE, roof: MAT.ROOF_TILE, backDoor: true }), { margin: 0.5, maxSlope: 5 });
  tryPlace(ctx, B.x - 14, B.z - 8, 0, 8, 8, () => P.lighthouse(b), { margin: 0, maxSlope: 8, minHeight: 0.8 });
  // fishery: sheds + pier
  for (let i = 0; i < 3; i++) tryPlace(ctx, C.x + 12 + i * 12, C.z + 18, 2, 8, 6, () => P.pierShed(b), { margin: 0.5 });
  {
    const z = C.z;
    let shore = C.x;
    for (let x = C.x; x > C.x - 140; x -= 2) {
      if (terrain.heightAt(x, z) < 0.3) {
        shore = x;
        break;
      }
    }
    b.at(shore - 14, z, 1, () => P.dock(b, 34, 6), { y: 1.5 });
    b.markers.push({ type: 'vehicle', vtype: 'boat', x: shore - 18, y: 0.4, z: z + 8, r: 5, yaw: Math.PI / 2, territory: t.id });
  }
  // Houses around the town
  scatter(ctx, t.x + 20, t.z, 110, 26, () => [rng.float(8, 12), rng.float(7, 10)], (bb, w, d) =>
    P.house(bb, w, d, rng.chance(0.4) ? 2 : 1, { wall: rng.pick([MAT.PLASTER, MAT.PLASTER_WARM, MAT.STONE]), roof: MAT.ROOF_TILE, chimney: rng.chance(0.3) }));
  scatter(ctx, t.x, t.z, 120, 6, () => [5, 5], (bb) => P.crates(bb, 0, 0, 3));
  scatter(ctx, t.x, t.z, 100, 8, () => [14, 1], (bb) => P.stoneWall(bb, 14, 0));
}

function buildFarmland(ctx, t) {
  const { b, rng } = ctx;
  const [A, B, C] = t.sectors;
  // Village square
  tryPlace(ctx, A.x + 22, A.z - 20, 0, 9, 22, () => P.chapel(b), { margin: 0.5, maxSlope: 6 });
  scatter(ctx, A.x, A.z, 55, 9, () => [rng.float(8, 11), rng.float(7, 9)], (bb, w, d) =>
    P.house(bb, w, d, rng.chance(0.35) ? 2 : 1, { wall: rng.pick([MAT.PLASTER_WARM, MAT.STONE, MAT.PLASTER]), roof: MAT.ROOF_TILE, chimney: true }));
  // Silos
  for (let i = 0; i < 3; i++) tryPlace(ctx, B.x + 14 + i * 8, B.z - 16, 0, 7, 7, () => P.silo(b, 3.2, 17));
  tryPlace(ctx, B.x - 16, B.z - 18, 0, 14, 18, () => P.barn(b, 14, 18), { margin: 0.5 });
  // Old mill
  tryPlace(ctx, C.x + 16, C.z - 12, 0, 6, 6, () => P.windmill(b));
  tryPlace(ctx, C.x - 18, C.z + 14, 1, 14, 18, () => P.barn(b, 14, 18), { margin: 0.5 });
  // Farms across the plains
  scatter(ctx, t.x, t.z, 210, 7, () => [11, 9], (bb) => P.house(bb, 11, 9, 1, { wall: MAT.PLASTER_WARM, roof: MAT.ROOF_TILE, chimney: true }));
  scatter(ctx, t.x, t.z, 210, 6, () => [14, 18], (bb) => P.barn(bb, 14, 18));
  scatter(ctx, t.x, t.z, 200, 18, () => [22, 1], (bb) => P.stoneWall(bb, 22, 0));
  scatter(ctx, t.x, t.z, 200, 14, () => [18, 1], (bb) => P.fence(bb, 18, 0));
}

function buildCanyon(ctx, t) {
  const { b, rng } = ctx;
  const [A, B, C] = t.sectors;
  // Canyon outpost: hesco ring, bunker, tower, tents
  b.at(A.x, A.z, 0, () => {
    for (const [x, z, len, r] of [[0, -26, 30, 0], [0, 26, 30, 0], [-26, 0, 20, 1], [26, 0, 20, 1]]) {
      b.push(x, 0, z, 0);
      P.hescoLine(b, len, r);
      b.pop();
    }
  });
  ctx.occ.markCircle(A.x, A.z, 28);
  b.at(A.x + 14, A.z + 14, 2, () => P.bunker(b, 7, 6));
  b.at(A.x - 16, A.z + 16, 0, () => P.watchtower(b));
  b.at(A.x - 14, A.z - 14, 0, () => P.tent(b, 6, 4));
  // Relay on the mesa
  tryPlace(ctx, B.x + 6, B.z - 8, 0, 3, 3, () => P.radioMast(b, 28), { margin: 0, maxSlope: 8 });
  tryPlace(ctx, B.x - 10, B.z + 8, 0, 7, 6, () => P.bunker(b, 7, 6), { margin: 0, maxSlope: 6 });
  // Dry riverbed: wrecks
  for (let i = 0; i < 6; i++) b.at(C.x + rng.float(-30, 30), C.z + rng.float(-30, 30), 0, () => P.wreckCar(b, 0, 0, rng.int(0, 1)));
  scatter(ctx, t.x, t.z, 150, 5, () => [8, 7], (bb) => P.ruin(bb, 8, 7, 3.5));
  scatter(ctx, t.x, t.z, 150, 6, () => [5, 5], (bb) => P.sandbagNest(bb, 2.4));
}

function buildMountain(ctx, t) {
  const { b, rng } = ctx;
  const [A, B, C] = t.sectors;
  // Ridge fortress
  for (const [ox, oz, r] of [[18, -14, 0], [-18, -12, 0], [0, 22, 2]]) {
    tryPlace(ctx, A.x + ox, A.z + oz, r, 7, 6, () => P.bunker(b, 7, 6), { margin: 0.5, maxSlope: 6 });
  }
  for (const [ox, oz, len, r] of [[0, -30, 36, 0], [-30, 0, 30, 1], [30, 0, 30, 1]]) {
    b.at(A.x + ox, A.z + oz, 0, () => P.hescoLine(b, len, r));
  }
  b.at(A.x + 24, A.z + 24, 0, () => P.watchtower(b));
  b.at(A.x - 24, A.z + 24, 0, () => P.watchtower(b));
  b.at(A.x, A.z - 44, 0, () => P.trench(b, 40, 0));
  // Radar station
  tryPlace(ctx, B.x + 4, B.z - 14, 0, 8, 7, () => P.radar(b), { margin: 0.5, maxSlope: 8 });
  b.at(B.x, B.z + 14, 0, () => P.hescoLine(b, 20, 0));
  // Pass checkpoint on the road
  const cpSpot = findSpot(ctx, C.x + 12, C.z, 6, 6, 30);
  if (cpSpot) tryPlace(ctx, cpSpot.x, cpSpot.z, cpSpot.rot, 6, 6, () => P.checkpoint(b), { margin: 0.2, maxSlope: 6 });
  b.at(C.x - 12, C.z + 10, 0, () => P.bunker(b, 6, 5));
  for (let i = 0; i < 8; i++) b.at(t.x + rng.float(-90, 90), t.z + rng.float(-90, 90), 0, () => P.hedgehog(b, 0, 0));
  scatter(ctx, t.x, t.z, 120, 4, () => [30, 4], (bb) => P.trench(bb, 26, 0));
}

function buildForest(ctx, t) {
  const { b, rng } = ctx;
  const [A, B, C] = t.sectors;
  tryPlace(ctx, A.x + 20, A.z - 16, 0, 16, 10, () => P.sawmill(b), { margin: 0.5, maxSlope: 6 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const x = A.x + Math.cos(a) * 36;
    const z = A.z + Math.sin(a) * 36;
    tryPlace(ctx, x, z, rng.int(0, 3), 7, 6, () => P.cabin(b, 7, 6, true), { maxSlope: 5 });
  }
  b.at(A.x - 18, A.z + 18, 0, () => P.logPile(b, 0, 0, 0));
  // Frozen lake: ice-fishing huts
  for (let i = 0; i < 3; i++) b.at(B.x + rng.float(-25, 25), B.z + rng.float(-25, 25), rng.int(0, 3), () => P.house(b, 4, 4, 1, { wall: MAT.WOOD, roof: MAT.ROOF_METAL, snow: true }));
  // Hunter lodge
  tryPlace(ctx, C.x + 14, C.z - 10, 0, 12, 9, () => P.house(b, 12, 9, 2, { wall: MAT.WOOD_DARK, roof: MAT.ROOF_METAL, snow: true, chimney: true }), { margin: 0.5, maxSlope: 6 });
  b.at(C.x - 16, C.z + 12, 0, () => P.watchtower(b));
  scatter(ctx, t.x, t.z, 150, 7, () => [7, 6], (bb) => P.cabin(bb, 7, 6, true));
  scatter(ctx, t.x, t.z, 140, 5, () => [6, 6], (bb) => P.logPile(bb, 0, 0, 0));
}

// Checkpoints, trench lines and wrecks along the main roads between territories.
function buildRoadside(ctx) {
  const { b, rng, roads, territories } = ctx;
  const inside = (x, z) => territories.some((t) => dist2D(x, z, t.x, t.z) < t.radius * 1.05 + (t.isBase ? 60 : 0));
  for (const r of roads) {
    if (r.kind !== 'main') continue;
    const s = r.samples;
    // checkpoint near the middle of the link
    const mid = s[Math.floor(s.length * 0.45)];
    if (!inside(mid.x, mid.z) && rng.chance(0.7)) {
      const q = s[Math.floor(s.length * 0.45) + 2] || mid;
      const dx = q.x - mid.x;
      const dz = q.z - mid.z;
      const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l;
      const nz = dx / l;
      const x = mid.x + nx * 10;
      const z = mid.z + nz * 10;
      const rot = rotFacing(-nx, -nz);
      tryPlace(ctx, x, z, (rot + 1) & 3, 6, 6, () => P.checkpoint(b), { margin: 0.2, maxSlope: 5 });
    }
    // trench line and hedgehogs a little further along
    const tp = s[Math.floor(s.length * 0.6)];
    if (tp && !inside(tp.x, tp.z) && rng.chance(0.6)) {
      const q = s[Math.floor(s.length * 0.6) + 2] || tp;
      const dx = q.x - tp.x;
      const dz = q.z - tp.z;
      const rot = Math.abs(dx) > Math.abs(dz) ? 1 : 0; // perpendicular to road
      for (const side of [-1, 1]) {
        const off = side * 26;
        const x = tp.x + (rot === 0 ? off : 0);
        const z = tp.z + (rot === 1 ? off : 0);
        tryPlace(ctx, x, z, 0, rot === 0 ? 28 : 5, rot === 0 ? 5 : 28, () => P.trench(b, 26, rot), { margin: 0.2, maxSlope: 4 });
      }
      for (let i = 0; i < 4; i++) {
        const x = tp.x + rng.float(-18, 18);
        const z = tp.z + rng.float(-18, 18);
        if (ctx.occ.at(x, z)) continue;
        b.at(x, z, 0, () => P.hedgehog(b, 0, 0));
      }
    }
    // wrecks
    for (let i = 0; i < 2; i++) {
      const p = s[rng.int(0, s.length - 1)];
      if (inside(p.x, p.z) || p.bridge) continue;
      b.at(p.x + rng.float(-7, 7), p.z + rng.float(-7, 7), 0, () => P.wreckCar(b, 0, 0, rng.int(0, 1)));
    }
  }
}

function plantTrees(ctx, biomeAt) {
  const { terrain, occ } = ctx;
  const trees = [];
  const nz = terrain.noise2;
  const STEP = 7;
  for (let z = -WORLD_HALF + 10; z < WORLD_HALF - 4; z += STEP) {
    for (let x = -WORLD_HALF + 10; x < WORLD_HALF - 4; x += STEP) {
      const jx = x + (hash2(x, z, 11) - 0.5) * STEP * 0.9;
      const jz = z + (hash2(x, z, 23) - 0.5) * STEP * 0.9;
      const h = terrain.heightAt(jx, jz);
      if (h < 1.8) continue;
      const biome = biomeAt(jx, jz);
      let dens;
      switch (biome) {
        case 'forest': dens = 0.62; break;
        case 'mountain': dens = h > 80 ? 0.02 : 0.28; break;
        case 'wild': dens = 0.34 * smoothstep(-0.05, 0.45, nz.fbm(jx / 190, jz / 190, 3)); break;
        case 'farmland': dens = 0.035; break;
        case 'canyon': dens = 0.025; break;
        case 'coastal': case 'harbor': dens = 0.05; break;
        case 'industrial': dens = 0.04; break;
        case 'city': dens = 0.015; break;
        default: dens = 0.02;
      }
      if (hash2(jx | 0, jz | 0, 5) > dens) continue;
      if (occ.at(jx, jz)) continue;
      const mat = terrain.materialAt(jx, jz);
      if (mat === TMAT.ROAD || mat === TMAT.ICE) continue;
      const slope = terrain.slopeAtIndex(Math.round((jx + WORLD_HALF) / terrain.res), Math.round((jz + WORLD_HALF) / terrain.res));
      if (slope > 1.1) continue;
      let kind;
      const r = hash2(jx | 0, jz | 0, 9);
      if (biome === 'forest' || biome === 'mountain') kind = r < 0.85 ? 0 : 3;
      else if (biome === 'canyon') kind = r < 0.5 ? 3 : 4;
      else if (biome === 'wild') kind = r < 0.35 ? 0 : r < 0.85 ? 1 : 2;
      else kind = r < 0.6 ? 1 : 4;
      const scale = 0.8 + hash2(jx | 0, jz | 0, 31) * 0.6;
      trees.push({ x: jx, y: h, z: jz, k: kind, s: scale, r: hash2(jx | 0, jz | 0, 41) * Math.PI * 2 });
      if (kind !== 4) {
        const tr = 0.3 * scale;
        ctx.b.boxes.push({ x0: jx - tr, y0: h - 0.5, z0: jz - tr, x1: jx + tr, y1: h + 7 * scale, z1: jz + tr, m: MAT.TRUNK, f: BF.SOLID | BF.COVER });
      }
      occ.markCircle(jx, jz, 1.2);
    }
  }
  return trees;
}

function scatterRocks(ctx, biomeAt) {
  const { rng, terrain, b, occ } = ctx;
  for (let i = 0; i < 900; i++) {
    const x = rng.float(-WORLD_HALF + 20, WORLD_HALF - 20);
    const z = rng.float(-WORLD_HALF + 20, WORLD_HALF - 20);
    const biome = biomeAt(x, z);
    const p = biome === 'mountain' ? 0.6 : biome === 'canyon' ? 0.6 : biome === 'forest' ? 0.25 : biome === 'wild' ? 0.08 : 0;
    if (!rng.chance(p)) continue;
    if (terrain.heightAt(x, z) < 1.5 || occ.at(x, z)) continue;
    const s = rng.float(0.8, biome === 'canyon' ? 3.2 : 2.4);
    b.at(x, z, 0, () => P.rock(b, 0, 0, s), { y: terrain.heightAt(x, z) });
    occ.markCircle(x, z, s + 0.5);
  }
}

// Reinforcement entry points and recon overlooks per territory.
function computeTerritoryPoints(ctx) {
  const { terrain, territories, occ } = ctx;
  for (const t of territories) {
    t.y = terrain.heightAt(t.x, t.z);
    t.entries = [];
    t.overlooks = [];
    const R = t.radius;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = t.x + Math.cos(a) * R * 1.05;
      const z = t.z + Math.sin(a) * R * 1.05;
      if (terrain.heightAt(x, z) > 1.5 && !occ.at(x, z)) t.entries.push({ x, z });
    }
    // overlooks: highest points in a ring around the territory
    const cands = [];
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      for (const k of [1.05, 1.35]) {
        const x = t.x + Math.cos(a) * R * k;
        const z = t.z + Math.sin(a) * R * k;
        const h = terrain.heightAt(x, z);
        if (h > 1.5 && Math.abs(x) < WORLD_HALF - 40 && Math.abs(z) < WORLD_HALF - 40) cands.push({ x, z, h, a });
      }
    }
    cands.sort((p, q) => q.h - p.h);
    for (const c of cands) {
      if (t.overlooks.every((o) => dist2D(o.x, o.z, c.x, c.z) > R * 0.8)) t.overlooks.push({ x: c.x, z: c.z, y: c.h });
      if (t.overlooks.length >= 3) break;
    }
    if (!t.commandPost) t.commandPost = { x: t.x, z: t.z, y: t.y };
  }
}

// Cover points along the sides of cover-flagged boxes.
function buildCover(boxes, colliders, terrain) {
  const pts = [];
  for (const bx of boxes) {
    if (!(bx.f & BF.COVER) || !(bx.f & BF.SOLID)) continue;
    const g = terrain.heightAt((bx.x0 + bx.x1) / 2, (bx.z0 + bx.z1) / 2);
    const h = bx.y1 - Math.max(g, bx.y0);
    if (h < 0.8) continue;
    if (bx.y0 - g > 1.0) continue; // floating (upper floors)
    const low = h < 1.5;
    const sides = [
      [bx.x0 - 0.7, bx.z0, bx.x0 - 0.7, bx.z1, 1, 0],
      [bx.x1 + 0.7, bx.z0, bx.x1 + 0.7, bx.z1, -1, 0],
      [bx.x0, bx.z0 - 0.7, bx.x1, bx.z0 - 0.7, 0, 1],
      [bx.x0, bx.z1 + 0.7, bx.x1, bx.z1 + 0.7, 0, -1],
    ];
    for (const [ax, az, cx, cz, nx, nz] of sides) {
      const len = Math.hypot(cx - ax, cz - az);
      const n = Math.max(1, Math.floor(len / 2.5));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = lerp(ax, cx, t);
        const z = lerp(az, cz, t);
        const y = terrain.heightAt(x, z);
        if (y < SEA_LEVEL + 0.3) continue;
        if (colliders.pointInSolid(x, y + 0.9, z)) continue;
        // (nx,nz) points from the cover spot toward the box = the protected direction
        pts.push({ x, z, y, nx, nz, low });
      }
    }
  }
  // spatial index
  const cell = 16;
  const grid = new Map();
  pts.forEach((p, i) => {
    const k = Math.floor((p.x + WORLD_HALF) / cell) * 1000 + Math.floor((p.z + WORLD_HALF) / cell);
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(i);
  });
  return {
    points: pts,
    near(x, z, r, fn) {
      const c0 = Math.floor((x - r + WORLD_HALF) / cell);
      const c1 = Math.floor((x + r + WORLD_HALF) / cell);
      const d0 = Math.floor((z - r + WORLD_HALF) / cell);
      const d1 = Math.floor((z + r + WORLD_HALF) / cell);
      for (let i = c0; i <= c1; i++) {
        for (let j = d0; j <= d1; j++) {
          const arr = grid.get(i * 1000 + j);
          if (!arr) continue;
          for (const idx of arr) {
            const p = pts[idx];
            if ((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) <= r * r) fn(p, idx);
          }
        }
      }
    },
  };
}

// Route along the road network between two anchors (BFS over links).
function roadRoute(world, fromId, toId) {
  const adj = new Map();
  for (const r of world.roads) {
    if (r.kind !== 'main') continue;
    if (!adj.has(r.a)) adj.set(r.a, []);
    if (!adj.has(r.b)) adj.set(r.b, []);
    adj.get(r.a).push({ to: r.b, road: r, fwd: true });
    adj.get(r.b).push({ to: r.a, road: r, fwd: false });
  }
  const prev = new Map([[fromId, null]]);
  const q = [fromId];
  while (q.length) {
    const cur = q.shift();
    if (cur === toId) break;
    for (const e of adj.get(cur) || []) {
      if (prev.has(e.to)) continue;
      prev.set(e.to, { from: cur, e });
      q.push(e.to);
    }
  }
  if (!prev.has(toId)) return null;
  const chain = [];
  let cur = toId;
  while (prev.get(cur)) {
    const p = prev.get(cur);
    chain.push(p.e);
    cur = p.from;
  }
  chain.reverse();
  const pts = [];
  for (const e of chain) {
    const s = e.fwd ? e.road.samples : [...e.road.samples].reverse();
    for (let i = 0; i < s.length; i += 4) pts.push({ x: s[i].x, z: s[i].z });
  }
  const last = anchorPos(toId);
  pts.push({ x: last[0], z: last[1] });
  return pts;
}

export { ROAD_JUNCTIONS, TERRITORY_BY_ID };
