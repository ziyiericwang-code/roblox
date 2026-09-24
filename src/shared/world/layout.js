// World assembly for the three-country continent. Fully deterministic for a
// given seed so every client rebuilds the exact world the server simulates.
//
//   terrain -> regions -> settlement pads -> roads & railways (A*) -> villages
//   -> road/rail profiles -> bases, cities, towns, border posts, fortifications
//   -> terrain materials -> forests & rocks -> colliders, cover, navigation
import { Rng, clamp, dist2D, hash2, smoothstep } from '../math.js';
import { WORLD_HALF, WORLD_SEED, SEA_LEVEL, FACTION_INFO } from '../constants.js';
import { TERRITORIES, HQ_BASES, HIGHWAYS, RAILWAYS, AIRPORTS, PLACE_NAMES, LAKES, RIVERS, ISLANDS } from '../config/world.js';
import { Terrain, TMAT, BIOME } from './terrain.js';
import { Builder, BF } from './builder.js';
import { MAT } from './materials.js';
import * as P from './prefabs.js';
import { Colliders } from './colliders.js';
import { NavGrid } from './nav.js';
import { RegionMap } from './regions.js';
import { RouteGrid, smoothPath, profileRoute, pointAlong } from './routing.js';
import { Occupancy, RoadIndex, tryPlace, rotFacing } from './place.js';
import { buildTerritory, buildVillage, buildFrontline, buildBorderCrossing, cityStreets, CITY_BLOCK } from './settlements.js';
import { buildHQ, HQ_HALF, GARRISON_HALF, gatePoint, localToWorld } from './bases.js';
import { station as stationPrefab, gasStation, pylon } from './infra.js';
import { bunkerSinkRects, BUNKER_DEPTH } from './buildings.js';

const VILLAGES_PER_TYPE = {
  capital: 2, city: 2, port: 2, industrial: 2, mountain: 1, forest: 2, airbase: 2, military: 2, desert: 1,
  canyon: 1, lakeside: 2, farmland: 3, coastal: 2, island: 0, hills: 2,
};

function levelAt(terrain, x, z, r, min = 3) {
  let s = 0;
  let n = 0;
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      const h = terrain.heightAt(x + (i * r) / 2, z + (j * r) / 2);
      if (h < SEA_LEVEL) continue;
      s += h;
      n++;
    }
  }
  return Math.max(min, n ? s / n : min);
}

export function generateWorld(seed = WORLD_SEED, opts = {}) {
  const T = {};
  const t0 = Date.now();
  const mark = (k) => {
    T[k] = Date.now() - t0;
  };
  const rng = new Rng(seed);
  const terrain = new Terrain(seed);
  terrain.generateRaw();
  mark('terrain');

  // ---------------------------------------------------------- territories
  const territories = TERRITORIES.map((def) => ({
    id: def.id, name: def.name, type: def.type, country: def.country, faction: def.country, value: def.value, radius: def.radius, blurb: def.blurb,
    x: def.center[0], z: def.center[1], weight: 1 + def.value * 0.05, isBase: false, rot: 0,
    sectors: def.sectors.map(([id, name, off]) => ({ id, name, x: def.center[0] + off[0], z: def.center[1] + off[1] })),
  }));
  const tById = Object.fromEntries(territories.map((t) => [t.id, t]));
  const hqs = HQ_BASES.map((h) => ({ ...h, x: h.center[0], z: h.center[1], faction: h.country }));
  for (const isl of ISLANDS) {
    const t = tById[isl.id];
    if (t) t.island = isl;
  }
  const regions = new RegionMap(terrain, territories, seed);
  for (const t of territories) {
    t.front = t.adjacent.some((a) => tById[a].country !== t.country);
    // garrisons face the nearest foreign neighbour
    const foe = t.adjacent.map((a) => tById[a]).filter((o) => o.country !== t.country).sort((a, b) => dist2D(a.x, a.z, t.x, t.z) - dist2D(b.x, b.z, t.x, t.z))[0];
    if (foe) t.rot = rotFacing(foe.x - t.x, foe.z - t.z);
  }
  mark('regions');

  // ---------------------------------------------------------- pads
  const pads = [];
  const rectPad = (x, z, hx, hz, blend, h) => pads.push({ x, z, r: 4, blend, rect: [hx, hz], h });
  const discPad = (x, z, r, blend, h) => pads.push({ x, z, r, blend, h });
  for (const hq of hqs) {
    hq.y = levelAt(terrain, hq.x, hq.z, 150, 4);
    const [hx, hz] = hq.rot & 1 ? [HQ_HALF[1], HQ_HALF[0]] : HQ_HALF;
    rectPad(hq.x, hq.z, hx + 14, hz + 14, 60, hq.y);
  }
  for (const ap of AIRPORTS) {
    const t = tById[ap.territory];
    const x = t.x + ap.off[0];
    const z = t.z + ap.off[1];
    const [cx, cz] = localToWorld(x, z, ap.rot, 0, 72);
    const hx = Math.max(ap.len / 2, 230) + 12;
    const [ex, ez] = ap.rot & 1 ? [100, hx] : [hx, 100];
    ap.y = levelAt(terrain, cx, cz, 180, 3);
    rectPad(cx, cz, ex, ez, 60, ap.y);
  }
  for (const t of territories) {
    const lvl = (r) => levelAt(terrain, t.x, t.z, r);
    switch (t.type) {
      case 'capital': rectPad(t.x, t.z, 200, 200, 80, lvl(180)); break;
      case 'city': rectPad(t.x, t.z, 150, 150, 70, lvl(140)); break;
      case 'industrial': rectPad(t.x, t.z, 160, 140, 60, lvl(140)); break;
      case 'military':
      case 'hills': {
        const [hx, hz] = t.rot & 1 ? [GARRISON_HALF[1], GARRISON_HALF[0]] : GARRISON_HALF;
        t.y = lvl(110);
        rectPad(t.x, t.z, hx + 14, hz + 14, 55, t.y);
        break;
      }
      case 'port': discPad(t.x, t.z, 130, 55, lvl(120)); break;
      case 'lakeside': rectPad(t.x, t.z - 50, 150, 80, 50, lvl(100)); break;
      case 'coastal': discPad(t.x, t.z - 40, 120, 50, lvl(110)); break;
      case 'farmland': discPad(t.sectors[0].x, t.sectors[0].z, 80, 40, levelAt(terrain, t.sectors[0].x, t.sectors[0].z, 70)); break;
      default: {
        const a = t.sectors[0];
        discPad(a.x, a.z, 42, 30, levelAt(terrain, a.x, a.z, 40));
      }
    }
  }
  for (const p of pads) terrain.applyPad(p);
  // sector pads follow the settled ground; underground objectives dig in
  for (const t of territories) {
    t.y = t.y ?? terrain.heightAt(t.x, t.z);
    for (const s of t.sectors) {
      if (/Bunker$|Metro/.test(s.name)) {
        s.underground = true;
        s.groundY = levelAt(terrain, s.x, s.z, 20, 2.5);
        terrain.applyPad({ x: s.x, z: s.z, r: 14, blend: 12, h: s.groundY });
        for (const r of bunkerSinkRects(18, 14)) terrain.applyPad({ x: s.x + r.cx, z: s.z + r.cz, r: 0.5, blend: 2.5, rect: [r.hx, r.hz], h: s.groundY - BUNKER_DEPTH, sink: true });
        s.y = s.groundY - BUNKER_DEPTH;
        continue;
      }
      terrain.applyPad({ x: s.x, z: s.z, r: 15, blend: 15, h: levelAt(terrain, s.x, s.z, 14, 2.6) });
    }
  }
  mark('pads');

  // ---------------------------------------------------------- roads & railways
  const grid = new RouteGrid(terrain);
  const blockRect = (x0, z0, x1, z1) => {
    for (let z = z0; z <= z1; z += 32) for (let x = x0; x <= x1; x += 32) grid.blocked[grid.idx(x, z)] = 1;
  };
  for (const hq of hqs) {
    const [hx, hz] = hq.rot & 1 ? [HQ_HALF[1], HQ_HALF[0]] : HQ_HALF;
    blockRect(hq.x - hx, hq.z - hz, hq.x + hx, hq.z + hz);
    hq.gate = gatePoint(hq, HQ_HALF, 30);
  }
  // cities and garrisons: roads end at the edge (a street end / the front gate)
  // instead of cutting through the blocks to the centre
  const cityG = (t) => (t.type === 'capital' ? 3 : t.type === 'city' ? 2 : 0);
  for (const t of territories) {
    const G = cityG(t);
    if (G) {
      const span = (G + 0.5) * CITY_BLOCK;
      blockRect(t.x - span + 16, t.z - span + 16, t.x + span - 16, t.z + span - 16);
    } else if (t.type === 'military' || t.type === 'hills') {
      const [hx, hz] = t.rot & 1 ? [GARRISON_HALF[1], GARRISON_HALF[0]] : GARRISON_HALF;
      blockRect(t.x - hx, t.z - hz, t.x + hx, t.z + hz);
      t.gate = gatePoint(t, GARRISON_HALF, 26);
    }
  }
  const anchor = (id, toward) => {
    const t = tById[id];
    if (t) {
      const G = cityG(t);
      if (G && toward) {
        // leave the grid along the street closest to the destination direction
        const span = (G + 0.5) * CITY_BLOCK + 14;
        const dx = toward.x - t.x;
        const dz = toward.z - t.z;
        const snap = (v) => clamp(Math.round(v / CITY_BLOCK - 0.5) + 0.5, -G + 0.5, G + 0.5) * CITY_BLOCK;
        if (Math.abs(dx) > Math.abs(dz)) return { x: t.x + Math.sign(dx) * span, z: t.z + snap((dz / Math.abs(dx)) * span) };
        return { x: t.x + snap((dx / Math.abs(dz)) * span), z: t.z + Math.sign(dz) * span };
      }
      if (t.gate) return t.gate;
      return { x: t.x, z: t.z };
    }
    const h = hqs.find((q) => q.id === id);
    return h ? h.gate : null;
  };
  const roads = [];
  let roadId = 0;
  const addRoad = (a, bId, kind, width) => {
    const ca = tById[a] || hqs.find((q) => q.id === a);
    const cb = tById[bId] || hqs.find((q) => q.id === bId);
    if (!ca || !cb) return null;
    const A = anchor(a, cb);
    const B = anchor(bId, ca);
    if (!A || !B) return null;
    const path = grid.route(A.x, A.z, B.x, B.z, false);
    if (!path) return null;
    // refuse routes that swim (islands are reached by boat or helicopter)
    let wet = 0;
    for (const p of path) if (grid.water[grid.idx(p.x, p.z)] === 2) wet++;
    if (wet > 1) return null;
    const samples = smoothPath(path, 3, 3);
    const r = { id: roadId++, a, b: bId, width, samples, kind };
    grid.markRoute(samples, 1);
    roads.push(r);
    return r;
  };
  const linked = new Set();
  for (const [a, bId] of HIGHWAYS) {
    if (addRoad(a, bId, 'highway', 12)) linked.add(`${a}|${bId}`).add(`${bId}|${a}`);
  }
  for (const t of territories) {
    for (const o of t.adjacent) {
      if (t.id > o || linked.has(`${t.id}|${o}`)) continue;
      const other = tById[o];
      if (t.type === 'island' || other.type === 'island') continue;
      if (dist2D(t.x, t.z, other.x, other.z) > 2500) continue;
      addRoad(t.id, o, 'main', 9);
      linked.add(`${t.id}|${o}`).add(`${o}|${t.id}`);
    }
  }
  mark('roads');

  // railways: straight platforms at each station, routed track between them
  const rails = [];
  const stations = [];
  for (const line of RAILWAYS) {
    const stops = line.stops.map((id) => tById[id]);
    const ctrl = [];
    for (let i = 0; i < stops.length; i++) {
      const t = stops[i];
      const next = stops[Math.min(stops.length - 1, i + 1)];
      const prev = stops[Math.max(0, i - 1)];
      const dirx = (next === t ? t.x - prev.x : next.x - t.x);
      const dirz = (next === t ? t.z - prev.z : next.z - t.z);
      const alongX = Math.abs(dirx) >= Math.abs(dirz);
      const sgn = alongX ? Math.sign(dirx) || 1 : Math.sign(dirz) || 1;
      const sec = t.sectors.find((s) => /Station|Rail|Junction|Depot/.test(s.name) && !s.underground);
      let sx = sec ? sec.x : t.x + (alongX ? 0 : 150);
      let sz = sec ? sec.z : t.z + (alongX ? 150 : 0);
      if (t.type === 'port') {
        sx = t.x + 150;
        sz = t.z;
      }
      const shared = stations.find((st) => dist2D(st.x, st.z, sx, sz) < 60);
      if (shared) {
        sx += alongX ? 0 : 70;
        sz += alongX ? 70 : 0;
      }
      const st = { x: sx, z: sz, alongX, sgn, line: line.id, territory: t.id, name: sec ? sec.name : `${t.name} Station` };
      stations.push(st);
      for (let k = -4; k <= 4; k++) {
        const o = k * 20 * sgn;
        ctrl.push({ x: sx + (alongX ? o : 0), z: sz + (alongX ? 0 : o), fixed: true });
      }
      if (i < stops.length - 1) {
        const a = ctrl[ctrl.length - 1];
        const nt = stops[i + 1];
        const nsec = nt.sectors.find((s) => /Station|Rail|Junction|Depot/.test(s.name) && !s.underground);
        const bx = nsec ? nsec.x : nt.x;
        const bz = nsec ? nsec.z : nt.z;
        const path = grid.route(a.x, a.z, bx, bz, true);
        if (path) for (let k = 1; k < path.length - 3; k++) ctrl.push(path[k]);
      }
    }
    const samples = smoothPath(ctrl, 2, 3);
    const rail = { id: line.id, name: line.name, width: 7, samples, kind: 'rail', rail: true, stations: stations.filter((s) => s.line === line.id) };
    grid.markRoute(samples, 2);
    rails.push(rail);
  }
  mark('rails');

  // ---------------------------------------------------------- villages
  const roadIndexPre = new RoadIndex(roads);
  const villages = [];
  const used = new Set();
  const nameFor = (country) => {
    const list = PLACE_NAMES[country];
    for (let i = 0; i < list.length; i++) {
      const n = list[(hash2(country, villages.length, i) * list.length) | 0];
      if (!used.has(n)) {
        used.add(n);
        return n;
      }
    }
    return `${FACTION_INFO[country].short} Hamlet ${villages.length}`;
  };
  const busy = (x, z) => {
    for (const t of territories) if (dist2D(x, z, t.x, t.z) < t.radius + 230) return true;
    for (const h of hqs) if (dist2D(x, z, h.x, h.z) < 380) return true;
    for (const v of villages) if (dist2D(x, z, v.x, v.z) < 430) return true;
    for (const st of stations) if (dist2D(x, z, st.x, st.z) < 120) return true;
    for (const ap of AIRPORTS) {
      const t = tById[ap.territory];
      if (dist2D(x, z, t.x + ap.off[0], t.z + ap.off[1]) < ap.len / 2 + 160) return true;
    }
    return false;
  };
  for (const t of territories) {
    const want = VILLAGES_PER_TYPE[t.type] ?? 1;
    if (!want) continue;
    const cands = [];
    for (const r of roads) {
      for (let i = 20; i < r.samples.length - 20; i += 14) {
        const p = r.samples[i];
        if (regions.territoryAt(p.x, p.z) !== t) continue;
        if (terrain.heightAt(p.x, p.z) < 2.5 || terrain.riverDistAt(p.x, p.z) < 50) continue;
        if (terrain.slopeAt(p.x, p.z) > 0.14 || terrain.field(terrain.fLand, p.x, p.z) < 90) continue;
        cands.push({ r, i, p, s: hash2(i, r.id, seed) });
      }
    }
    cands.sort((a, b) => a.s - b.s);
    let got = 0;
    for (const c of cands) {
      if (got >= want) break;
      if (busy(c.p.x, c.p.z)) continue;
      const biome = terrain.biomeCode(c.p.x, c.p.z);
      villages.push({
        name: nameFor(t.country), x: c.p.x, z: c.p.z, road: c.r, sampleIndex: c.i, territory: t.id, country: t.country,
        farm: biome === BIOME.PLAINS || biome === BIOME.HILLS, gas: c.r.kind === 'highway' && hash2(c.i, 7, seed) < 0.6,
      });
      got++;
    }
  }
  for (const v of villages) terrain.applyPad({ x: v.x, z: v.z, r: 42, blend: 28, h: levelAt(terrain, v.x, v.z, 36, 2.5) });
  void roadIndexPre;
  mark('villages');

  // city streets (inside city pads)
  for (const t of territories) {
    if (t.type !== 'capital' && t.type !== 'city') continue;
    const G = t.type === 'capital' ? 3 : 2;
    for (const s of cityStreets(t, G)) {
      const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
      const steps = Math.ceil(len / 3);
      const samples = [];
      for (let i = 0; i <= steps; i++) samples.push({ x: s.ax + ((s.bx - s.ax) * i) / steps, z: s.az + ((s.bz - s.az) * i) / steps });
      const wet = samples.filter((p) => terrain.riverDistAt(p.x, p.z) < 10).length;
      if (wet / samples.length > 0.2) continue;
      roads.push({ id: roadId++, a: t.id, b: t.id, width: 10, samples, kind: 'street' });
    }
  }
  // profile and flatten roads, then railways (rail grades win at crossings)
  for (const r of roads) profileRoute(terrain, r);
  for (const r of rails) profileRoute(terrain, r);
  for (const r of roads) terrain.applyRoad(r);
  for (const r of rails) terrain.applyRoad(r);
  mark('profiles');

  // ---------------------------------------------------------- structures
  const b = new Builder(terrain, rng);
  const occ = new Occupancy();
  const roadIndex = new RoadIndex(roads);
  const ctx = { terrain, rng, b, occ, territories, tById, roads, rails, roadIndex, regions, places: [], zones: [], borders: [], trees: [] };
  for (const r of [...roads, ...rails]) {
    for (let i = 0; i < r.samples.length; i += 2) {
      const p = r.samples[i];
      occ.markCircle(p.x, p.z, r.width / 2 + 1.5);
    }
  }
  for (let z = -WORLD_HALF; z < WORLD_HALF; z += 4) {
    for (let x = -WORLD_HALF; x < WORLD_HALF; x += 4) {
      if (terrain.heightAt(x + 2, z + 2) < 1.0) occ.mark(x, z, x + 4, z + 4);
    }
  }
  buildBridges(ctx, roads, false);
  buildBridges(ctx, rails, true);
  // snap river-crossing objectives to the real bridges
  for (const t of territories) {
    for (const s of t.sectors) {
      if (!/Bridge|Crossing|Dam/.test(s.name)) continue;
      let best = null;
      let bd = Infinity;
      for (const r of roads) {
        for (const br of r.bridges) {
          for (const idx of [br.from - 3, br.to + 3]) {
            const p = r.samples[clamp(idx, 0, r.samples.length - 1)];
            const d = dist2D(p.x, p.z, s.x, s.z);
            if (d < bd && d < 260) {
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

  // HQ bases
  const bases = {};
  for (const hq of hqs) {
    const [hx, hz] = hq.rot & 1 ? [HQ_HALF[1], HQ_HALF[0]] : HQ_HALF;
    occ.mark(hq.x - hx - 8, hq.z - hz - 8, hq.x + hx + 8, hq.z + hz + 8, 2);
    const info = buildHQ(b, hq, hq.faction, FACTION_INFO[hq.faction].short);
    info.gate = hq.gate;
    info.region = hq.region;
    info.markers = b.markers.filter((m) => Math.abs(m.x - hq.x) < hx + 20 && Math.abs(m.z - hq.z) < hz + 20 && !m.baseRef);
    for (const m of info.markers) m.baseRef = hq.id;
    bases[hq.faction] = info;
    ctx.places.push({ name: hq.name, x: hq.x, z: hq.z, r: Math.max(hx, hz) + 20, kind: 'base', faction: hq.faction });
    ctx.zones.push({ kind: 'base', x: hq.x, z: hq.z, r: Math.max(hx, hz) });
  }
  // territories
  for (const t of territories) {
    if (t.type === 'military' || t.type === 'hills') {
      const [hx, hz] = t.rot & 1 ? [GARRISON_HALF[1], GARRISON_HALF[0]] : GARRISON_HALF;
      occ.mark(t.x - hx - 6, t.z - hz - 6, t.x + hx + 6, t.z + hz + 6, 2);
      ctx.zones.push({ kind: 'base', x: t.x, z: t.z, r: Math.max(hx, hz) });
    }
    if (t.type === 'airbase') {
      const ap = AIRPORTS.find((a) => a.territory === t.id);
      void ap;
    }
  }
  for (const t of territories) buildTerritory(ctx, t);
  mark('territories');
  // railway stations
  for (const st of stations) {
    const y = levelAt(terrain, st.x, st.z, 10, 2);
    b.at(st.x, st.z, st.alongX ? 0 : 1, () => stationPrefab(b, 70, st.name), { y });
    const [hx, hz] = st.alongX ? [38, 26] : [26, 38];
    occ.mark(st.x - hx, st.z - hz, st.x + hx, st.z + hz);
    ctx.places.push({ name: st.name, x: st.x, z: st.z, r: 60, kind: 'station' });
  }
  // villages
  for (const v of villages) buildVillage(ctx, v);
  // border crossings where roads leave a country
  for (const r of roads) {
    if (r.kind === 'street') continue;
    let prev = null;
    for (let i = 10; i < r.samples.length - 10; i += 4) {
      const p = r.samples[i];
      const t = regions.territoryAt(p.x, p.z);
      if (!t) continue;
      if (prev && prev.country !== t.country && !p.bridge) {
        const nearTown = territories.some((o) => dist2D(p.x, p.z, o.x, o.z) < o.radius + 60);
        if (!nearTown) buildBorderCrossing(ctx, r, i, [prev.country, t.country].sort());
        break;
      }
      prev = t;
    }
  }
  // front-line fortifications between neighbouring countries
  for (const t of territories) {
    if (t.type === 'island') continue;
    const foes = t.adjacent.map((a) => tById[a]).filter((o) => o.country !== t.country && o.type !== 'island');
    for (const o of foes.slice(0, 2)) buildFrontline(ctx, t, o);
  }
  // roadside: fuel stations and power lines along highways, wrecks near fronts
  for (const r of roads) {
    if (r.kind !== 'highway') continue;
    const s = r.samples;
    for (let i = 60; i < s.length - 60; i += 40) {
      const p = s[i];
      if (terrain.heightAt(p.x, p.z) < 2 || territories.some((t) => dist2D(p.x, p.z, t.x, t.z) < t.radius + 40)) continue;
      const q = s[i + 1];
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const l = Math.hypot(dx, dz) || 1;
      const x = p.x - (dz / l) * 24;
      const z = p.z + (dx / l) * 24;
      if (!occ.at(x, z) && terrain.heightAt(x, z) > 1.5) {
        b.at(x, z, 0, () => pylon(b));
        occ.markCircle(x, z, 2);
      }
    }
    if (s.length > 400) {
      const i = Math.floor(s.length * (0.3 + hash2(r.id, 3, seed) * 0.4));
      const p = s[i];
      const q = s[i + 1];
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const l = Math.hypot(dx, dz) || 1;
      tryPlace(ctx, p.x - (dz / l) * 26, p.z + (dx / l) * 26, rotFacing(dz, -dx), 22, 30, () => gasStation(b), { maxSlope: 3 });
    }
  }
  for (const t of territories) {
    if (!t.front) continue;
    for (let i = 0; i < 6; i++) {
      const a = rng.float(0, Math.PI * 2);
      const d = rng.float(t.radius * 0.6, t.radius * 1.4);
      const x = t.x + Math.cos(a) * d;
      const z = t.z + Math.sin(a) * d;
      if (!occ.at(x, z) && terrain.heightAt(x, z) > 2) b.at(x, z, 0, () => P.wreckCar(b, 0, 0, rng.int(0, 1)));
    }
  }
  mark('structures');

  // ---------------------------------------------------------- materials & nature
  const zoneGrid = buildZoneGrid(ctx.zones, villages);
  terrain.finalizeMaterials((x, z) => zoneGrid.at(x, z));
  mark('materials');
  const trees = plantTrees(ctx);
  scatterRocks(ctx);
  computeTerritoryPoints(ctx);
  mark('nature');

  // ---------------------------------------------------------- compile
  const colliders = new Colliders(terrain, b.boxes);
  mark('colliders');
  const combatAreas = [
    ...territories.map((t) => ({ x: t.x, z: t.z, r: t.radius * 1.6 })),
    ...villages.map((v) => ({ x: v.x, z: v.z, r: 110 })),
    ...ctx.borders.map((p) => ({ x: p.x, z: p.z, r: 60 })),
  ];
  const cover = buildCover(b.boxes, colliders, terrain, combatAreas);
  mark('cover');
  const nav = opts.nav ? new NavGrid(terrain, colliders) : null;
  mark('nav');

  for (const l of LAKES) ctx.places.push({ name: l.name, x: l.center[0], z: l.center[1], r: Math.max(...l.radius), kind: 'lake' });
  const vehicleSpawns = b.markers.filter((m) => m.type === 'vehicle');
  const world = {
    seed,
    terrain,
    colliders,
    nav,
    regions,
    boxes: b.boxes,
    props: b.props,
    lights: b.lights,
    flags: b.flags,
    markers: b.markers,
    zones: b.zones,
    buildings: b.buildings,
    trees,
    roads,
    rails,
    stations,
    villages: villages.map(({ road, ...v }) => ({ ...v, road: road.id })),
    places: ctx.places,
    borders: ctx.borders,
    cover,
    territories,
    tById,
    hqs,
    bases,
    vehicleSpawns,
    rangeTargets: b.rangeTargets,
    rivers: RIVERS,
    biomeAt: (x, z) => terrain.biomeAt(x, z),
    timings: T,
    genMs: Date.now() - t0,
  };
  world.territoryAt = (x, z) => regions.territoryAt(x, z);
  world.routeBetween = (fromId, toId) => roadRoute(world, fromId, toId);
  world.placeAt = (x, z) => placeAt(world, x, z);
  return world;
}

// ------------------------------------------------------------------ zones
function buildZoneGrid(zones, villages) {
  const cell = 16;
  const n = Math.ceil((WORLD_HALF * 2) / cell);
  const g = new Uint8Array(n * n);
  const KIND = { city: 1, farm: 2, base: 3, village: 4 };
  const NAMES = [null, 'city', 'farm', 'base', 'village'];
  const paint = (z) => {
    const k = KIND[z.kind];
    const r = z.r;
    const i0 = clamp(Math.floor((z.x - r + WORLD_HALF) / cell), 0, n - 1);
    const i1 = clamp(Math.floor((z.x + r + WORLD_HALF) / cell), 0, n - 1);
    const j0 = clamp(Math.floor((z.z - r + WORLD_HALF) / cell), 0, n - 1);
    const j1 = clamp(Math.floor((z.z + r + WORLD_HALF) / cell), 0, n - 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = -WORLD_HALF + (i + 0.5) * cell;
        const zz = -WORLD_HALF + (j + 0.5) * cell;
        const rr = r * (0.8 + 0.35 * hash2((x / 64) | 0, (zz / 64) | 0, 77) * 0.6 + 0.25 * Math.sin(Math.atan2(zz - z.z, x - z.x) * 3 + z.x));
        if ((x - z.x) ** 2 + (zz - z.z) ** 2 > rr * rr) continue;
        const cur = g[j * n + i];
        // city/base win over farmland
        if (!cur || k === 1 || k === 3) g[j * n + i] = k;
      }
    }
  };
  for (const z of zones) if (z.kind === 'farm') paint(z);
  for (const v of villages) if (v.farm) paint({ kind: 'farm', x: v.x, z: v.z, r: 260 });
  for (const z of zones) if (z.kind !== 'farm') paint(z);
  return {
    at(x, z) {
      const i = Math.floor((x + WORLD_HALF) / cell);
      const j = Math.floor((z + WORLD_HALF) / cell);
      if (i < 0 || j < 0 || i >= n || j >= n) return null;
      return NAMES[g[j * n + i]];
    },
  };
}

// ------------------------------------------------------------------ bridges
function buildBridges(ctx, routes, rail) {
  const { b } = ctx;
  for (const r of routes) {
    for (const br of r.bridges) {
      const pts = r.samples.slice(br.from, br.to + 1);
      const deck = br.deck;
      const half = r.width / 2;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        b.boxes.push({ x0: p.x - half * 0.8, y0: deck - 0.6, z0: p.z - half * 0.8, x1: p.x + half * 0.8, y1: deck, z1: p.z + half * 0.8, m: MAT.CONCRETE, f: BF.SOLID | BF.WALKSURF });
        if (i % 2) continue;
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
      b.props.push({ t: 'bridge', pts: pts.map((p) => [p.x, p.z]), deck, w: r.width, m: MAT.CONCRETE, x: pts[0].x, y: deck, z: pts[0].z, yaw: 0, rail });
    }
  }
}

// ------------------------------------------------------------------ nature
function plantTrees(ctx) {
  const { terrain, occ } = ctx;
  const trees = ctx.trees;
  const nz = terrain.noise2;
  const STEP = 7;
  const snowAt = (z) => terrain.snowLine(z);
  for (let z = -WORLD_HALF + 10; z < WORLD_HALF - 4; z += STEP) {
    for (let x = -WORLD_HALF + 10; x < WORLD_HALF - 4; x += STEP) {
      const jx = x + (hash2(x, z, 11) - 0.5) * STEP * 0.9;
      const jz = z + (hash2(x, z, 23) - 0.5) * STEP * 0.9;
      const h = terrain.heightAt(jx, jz);
      if (h < 2.2) continue;
      const biome = terrain.biomeCode(jx, jz);
      const forest = terrain.forestAt(jx, jz) + nz.noise(jx / 90, jz / 90) * 0.18;
      let dens;
      switch (biome) {
        case BIOME.FOREST: dens = 0.1 + forest * 0.75; break;
        case BIOME.MOUNTAIN: dens = h > snowAt(jz) - 30 ? 0.01 : 0.16 + forest * 0.4; break;
        case BIOME.SNOW: dens = 0.004; break;
        case BIOME.DESERT: dens = 0.003; break;
        case BIOME.CANYON: dens = 0.012; break;
        case BIOME.COAST: dens = 0.03; break;
        case BIOME.HILLS: dens = 0.05 + forest * 0.5 + 0.06 * smoothstep(0.1, 0.5, nz.fbm(jx / 200, jz / 200, 2)); break;
        default: dens = forest > 0.2 ? forest * 0.7 : 0.018 + 0.1 * smoothstep(0.15, 0.55, nz.fbm(jx / 190, jz / 190, 3));
      }
      if (hash2(jx | 0, jz | 0, 5) > dens) continue;
      if (occ.at(jx, jz)) continue;
      const mat = terrain.materialAt(jx, jz);
      if (mat === TMAT.ROAD || mat === TMAT.ICE || mat === TMAT.RAIL || mat === TMAT.FIELD || mat === TMAT.FIELD2) continue;
      if (terrain.slopeAt(jx, jz) > 1.0) continue;
      let kind;
      const r = hash2(jx | 0, jz | 0, 9);
      if (biome === BIOME.FOREST || biome === BIOME.MOUNTAIN || biome === BIOME.SNOW || jz < -1600) kind = r < 0.8 ? 0 : r < 0.92 ? 2 : 3;
      else if (biome === BIOME.CANYON || biome === BIOME.DESERT) kind = r < 0.5 ? 3 : 4;
      else kind = r < 0.3 ? 0 : r < 0.8 ? 1 : r < 0.9 ? 2 : 4;
      const scale = 0.8 + hash2(jx | 0, jz | 0, 31) * 0.6;
      trees.push({ x: jx, y: h, z: jz, k: kind, s: scale, r: hash2(jx | 0, jz | 0, 41) * Math.PI * 2 });
      if (kind !== 4) {
        const tr = 0.3 * scale;
        ctx.b.boxes.push({ x0: jx - tr, y0: h - 0.5, z0: jz - tr, x1: jx + tr, y1: h + 7 * scale, z1: jz + tr, m: MAT.TRUNK, f: BF.SOLID | BF.COVER, tree: 1 });
      }
      occ.markCircle(jx, jz, 1.2);
    }
  }
  return trees;
}

function scatterRocks(ctx) {
  const { rng, terrain, b, occ } = ctx;
  for (let i = 0; i < 6000; i++) {
    const x = rng.float(-WORLD_HALF + 40, WORLD_HALF - 40);
    const z = rng.float(-WORLD_HALF + 40, WORLD_HALF - 40);
    const biome = terrain.biomeCode(x, z);
    const p = biome === BIOME.MOUNTAIN ? 0.7 : biome === BIOME.CANYON ? 0.7 : biome === BIOME.DESERT ? 0.18 : biome === BIOME.FOREST ? 0.25 : biome === BIOME.HILLS ? 0.15 : 0.04;
    if (!rng.chance(p)) continue;
    if (terrain.heightAt(x, z) < 1.5 || occ.at(x, z)) continue;
    const s = rng.float(0.8, biome === BIOME.CANYON || biome === BIOME.MOUNTAIN ? 3.4 : 2.2);
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
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const x = t.x + Math.cos(a) * R * 1.1;
      const z = t.z + Math.sin(a) * R * 1.1;
      if (terrain.heightAt(x, z) > 1.8 && !occ.at(x, z) && terrain.slopeAt(x, z) < 0.6) t.entries.push({ x, z });
    }
    const cands = [];
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      for (const k of [1.1, 1.4]) {
        const x = t.x + Math.cos(a) * R * k;
        const z = t.z + Math.sin(a) * R * k;
        const h = terrain.heightAt(x, z);
        if (h > 1.8 && Math.abs(x) < WORLD_HALF - 60 && Math.abs(z) < WORLD_HALF - 60) cands.push({ x, z, h, a });
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

// Cover points along the sides of cover boxes, only where fighting happens.
function buildCover(boxes, colliders, terrain, areas) {
  const pts = [];
  const inArea = (x, z) => {
    for (const a of areas) if ((x - a.x) ** 2 + (z - a.z) ** 2 < a.r * a.r) return true;
    return false;
  };
  for (const bx of boxes) {
    if (!(bx.f & BF.COVER) || !(bx.f & BF.SOLID)) continue;
    const cx = (bx.x0 + bx.x1) / 2;
    const cz = (bx.z0 + bx.z1) / 2;
    if (!inArea(cx, cz)) continue;
    const g = terrain.heightAt(cx, cz);
    const h = bx.y1 - Math.max(g, bx.y0);
    if (h < 0.8) continue;
    if (bx.y0 - g > 1.0) continue;
    const low = h < 1.5;
    const sides = [
      [bx.x0 - 0.7, bx.z0, bx.x0 - 0.7, bx.z1, 1, 0],
      [bx.x1 + 0.7, bx.z0, bx.x1 + 0.7, bx.z1, -1, 0],
      [bx.x0, bx.z0 - 0.7, bx.x1, bx.z0 - 0.7, 0, 1],
      [bx.x0, bx.z1 + 0.7, bx.x1, bx.z1 + 0.7, 0, -1],
    ];
    for (const [ax, az, ex, ez, nx, nz] of sides) {
      const len = Math.hypot(ex - ax, ez - az);
      const n = Math.max(1, Math.floor(len / 2.5));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = ax + (ex - ax) * t;
        const z = az + (ez - az) * t;
        const y = terrain.heightAt(x, z);
        if (y < SEA_LEVEL + 0.3) continue;
        if (colliders.pointInSolid(x, y + 0.9, z)) continue;
        pts.push({ x, z, y, nx, nz, low });
      }
    }
  }
  const cell = 16;
  const grid = new Map();
  pts.forEach((p, i) => {
    const k = Math.floor((p.x + WORLD_HALF) / cell) * 4096 + Math.floor((p.z + WORLD_HALF) / cell);
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
          const arr = grid.get(i * 4096 + j);
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

// ------------------------------------------------------------------ queries
// Route along the road network between two anchors (territory ids or HQ ids).
function roadRoute(world, fromId, toId) {
  const adj = new Map();
  for (const r of world.roads) {
    if (r.kind === 'street') continue;
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
  return pts;
}

// Human-readable location: nearest named place, its territory and country.
function placeAt(world, x, z) {
  let best = null;
  let bs = Infinity;
  for (const p of world.places) {
    if (p.kind === 'territory') continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d > p.r) continue;
    const s = d / p.r + (p.kind === 'sector' ? -0.2 : 0);
    if (s < bs) {
      bs = s;
      best = p;
    }
  }
  const t = world.regions.territoryAt(x, z);
  return { place: best ? best.name : null, kind: best ? best.kind : null, territory: t ? t.id : null, region: t ? t.name : null };
}

export { pointAlong };
