// Offline world pipeline: Natural Earth → ~1,200 land provinces + ~190 sea zones.
// Run with `npm run worldgen` (downloads are cached in tools/worldgen/.cache).
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as R from './lib/raster.mjs';
import * as P from './lib/partition.mjs';
import * as O from './overrides/data.mjs';
import { finish } from './lib/finish.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = join(here, '.cache');
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const SOURCES = [
  'ne_10m_admin_1_states_provinces_lakes',
  'ne_10m_admin_0_countries_lakes',
  'ne_10m_populated_places_simple',
  'ne_10m_geography_regions_polys',
  'ne_10m_geography_marine_polys',
  'ne_50m_rivers_lake_centerlines',
  'ne_10m_ports',
  'ne_10m_airports',
];
mkdirSync(CACHE, { recursive: true });
for (const s of SOURCES) {
  const f = join(CACHE, `${s}.geojson`);
  if (!existsSync(f)) {
    log('downloading', s);
    execFileSync('curl', ['-sS', '--max-time', '600', '-o', f, `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/${s}.geojson`]);
  }
}
const load = (n) => JSON.parse(readFileSync(join(CACHE, `${n}.geojson`), 'utf8')).features;
const A0 = load('ne_10m_admin_0_countries_lakes');
const A1 = load('ne_10m_admin_1_states_provinces_lakes');
const PLACES = load('ne_10m_populated_places_simple');
const GEO = load('ne_10m_geography_regions_polys');
log('loaded sources', A0.length, 'admin-0,', A1.length, 'admin-1,', PLACES.length, 'places');

const { W, H } = R;
const N = W * H;
const rand = R.rng(20300101);

// ---------------------------------------------------------------- countries
const keyOf = (p) => {
  const k = p.TYPE === 'Indeterminate' ? p.ADMIN : p.SOVEREIGNT;
  return O.MERGE_COUNTRIES[k] || k;
};
const countries = [];
const countryIdx = new Map();
const a0Country = new Int32Array(A0.length);
A0.forEach((f, i) => {
  const p = f.properties;
  const key = keyOf(p);
  if (!countryIdx.has(key)) {
    countryIdx.set(key, countries.length);
    countries.push({ key, feats: [], pop: 0, gdp: 0, main: null });
  }
  const c = countries[countryIdx.get(key)];
  c.feats.push(i);
  c.pop += Math.max(0, p.POP_EST || 0);
  c.gdp += Math.max(0, p.GDP_MD || 0);
  const isMain = p.ADMIN === key || p.SOVEREIGNT === p.ADMIN;
  if (!c.main || (isMain && !(c.main.ADMIN === key)) || (!isMain && c.main.ADMIN !== key && (p.POP_EST || 0) > (c.main.POP_EST || 0))) c.main = p;
  a0Country[i] = countryIdx.get(key);
});
const a0ByA3 = new Map();
A0.forEach((f, i) => {
  const p = f.properties;
  for (const k of [p.ADM0_A3, p.GU_A3, p.SU_A3]) if (k && !a0ByA3.has(k)) a0ByA3.set(k, i);
});

// ---------------------------------------------------------------- rasterize admin-0 / admin-1
const a0 = new Uint16Array(N);
A0.forEach((f, i) => {
  const polys = R.geometryPolygons(f.geometry);
  let n = 0;
  for (const poly of polys) n += R.fillPolygon(poly, (q) => (a0[q] = i + 1));
  if (n === 0 && polys.length) {
    // tiny island state: keep one pixel at its largest polygon
    const big = polys.reduce((m, p) => (p[0].length > m[0].length ? p : m), polys[0]);
    const c = R.roughCentroid([big]);
    const q = R.pixelAt(c[0], c[1]);
    if (q >= 0 && a0[q] === 0) a0[q] = i + 1;
  }
});
log('rasterized admin-0');
const a1 = new Uint16Array(N);
const a1ToA0 = new Int32Array(A1.length).fill(-1);
A1.forEach((f, i) => {
  const p = f.properties;
  let k = a0ByA3.get(p.adm0_a3);
  if (k === undefined) k = a0ByA3.get(p.gu_a3);
  if (k === undefined) k = a0ByA3.get(p.sov_a3);
  a1ToA0[i] = k === undefined ? -1 : k;
  for (const poly of R.geometryPolygons(f.geometry)) R.fillPolygon(poly, (q) => (a1[q] = i + 1));
});
log('rasterized admin-1');

// ---------------------------------------------------------------- units (admin-1 or admin-0 fallback) per land pixel
const NA1 = A1.length;
const unitOf = new Int32Array(N).fill(-1);
const units = [];
for (let i = 0; i < NA1; i++) {
  const p = A1[i].properties;
  units.push({ name: p.name || p.gn_name || p.woe_name || p.admin, region: p.region || null, a0: a1ToA0[i], country: a1ToA0[i] >= 0 ? a0Country[a1ToA0[i]] : -1 });
}
for (let i = 0; i < A0.length; i++) {
  const p = A0[i].properties;
  units.push({ name: p.NAME || p.ADMIN, region: null, a0: i, country: a0Country[i] });
}
let landCount = 0;
for (let q = 0; q < N; q++) {
  let u = -1;
  if (a1[q] && units[a1[q] - 1].country >= 0) u = a1[q] - 1;
  else if (a0[q]) u = NA1 + a0[q] - 1;
  unitOf[q] = u;
  if (u >= 0) landCount++;
}
// if admin-1 disagrees with admin-0 on the country, trust admin-0 (NE admin-1 has a few stray codes)
for (let q = 0; q < N; q++) {
  const u = unitOf[q];
  if (u >= 0 && u < NA1 && a0[q] && units[u].country !== a0Country[a0[q] - 1]) unitOf[q] = NA1 + a0[q] - 1;
}
// orphan micro-territories (uninhabited disputed zones, reefs): fold into the neighbour with the longest border, or drop
{
  const orphan = new Set(countries.map((c, i) => i).filter((i) => countries[i].main.TYPE === 'Indeterminate' && countries[i].pop < 20000));
  const border = new Map();
  const cOf = (q) => (unitOf[q] >= 0 ? units[unitOf[q]].country : -1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const q = y * W + x;
      const a = cOf(q);
      if (a < 0) continue;
      for (const r of [y * W + ((x + 1) % W), y + 1 < H ? q + W : -1]) {
        if (r < 0) continue;
        const b = cOf(r);
        if (b < 0 || b === a) continue;
        if (orphan.has(a) && !orphan.has(b)) border.set(`${a},${b}`, (border.get(`${a},${b}`) || 0) + 1);
        if (orphan.has(b) && !orphan.has(a)) border.set(`${b},${a}`, (border.get(`${b},${a}`) || 0) + 1);
      }
    }
  }
  for (const o of orphan) {
    let best = -1;
    let bl = 0;
    for (const [k, len] of border) {
      const [a, b] = k.split(',').map(Number);
      if (a === o && len > bl) {
        bl = len;
        best = b;
      }
    }
    if (best >= 0) {
      for (const u of units) if (u.country === o) u.country = best;
    } else {
      for (let q = 0; q < N; q++) if (unitOf[q] >= 0 && units[unitOf[q]].country === o) unitOf[q] = -1;
    }
  }
  landCount = 0;
  for (let q = 0; q < N; q++) if (unitOf[q] >= 0) landCount++;
}
log('land pixels', landCount);

// ---------------------------------------------------------------- terrain hints from named geography regions
const hint = new Uint8Array(N); // 1 mountain 2 desert 3 hills 4 tundra 5 wetland 6 plain
const hintOf = { 'Range/mtn': 1, Desert: 2, Plateau: 3, Foothills: 3, Tundra: 4, Wetlands: 5, Delta: 5, Plain: 6, Lowland: 6, Basin: 6, Valley: 6, Depression: 6 };
for (const order of [6, 3, 4, 5, 2, 1]) {
  for (const f of GEO) {
    const h = hintOf[f.properties.FEATURECLA];
    if (h !== order) continue;
    if (h === 1 && (f.properties.SCALERANK ?? 9) > 5) continue; // minor ranges add noise at this scale
    for (const poly of R.geometryPolygons(f.geometry)) R.fillPolygon(poly, (q) => (hint[q] = h));
  }
}
log('terrain hints rasterized');

const habitability = (q) => {
  const y = (q / W) | 0;
  const lat = Math.abs(R.rowLat(y));
  const h = hint[q];
  if (lat > 62) return 0.35;
  if (h === 2) return 0.3;
  if (h === 4) return 0.35;
  if (h === 1) return 0.6;
  return 1;
};

// ---------------------------------------------------------------- cities
const cities = [];
for (const f of PLACES) {
  const p = f.properties;
  const pop = Math.max(p.pop_max || 0, p.pop_min || 0);
  let q = R.pixelAt(p.longitude, p.latitude);
  if (q < 0) continue;
  if (unitOf[q] < 0) {
    // coastal city on a water pixel: look for the nearest land pixel
    const x0 = q % W;
    const y0 = (q / W) | 0;
    let best = -1;
    let bd = 99;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const y = y0 + dy;
        if (y < 0 || y >= H) continue;
        const r = R.idx(R.wrapX(x0 + dx), y);
        const d = dx * dx + dy * dy;
        if (unitOf[r] >= 0 && d < bd) {
          bd = d;
          best = r;
        }
      }
    }
    if (best < 0) continue;
    q = best;
  }
  cities.push({ name: p.nameascii || p.name, pop, q, lon: p.longitude, lat: p.latitude, capital: p.adm0cap === 1 || p.featurecla === 'Admin-0 capital', sov: p.sov0name, adm0: p.adm0_a3, world: p.worldcity === 1 });
}
cities.sort((a, b) => b.pop - a.pop);
const cityPopAt = new Map();
for (const c of cities) cityPopAt.set(c.q, (cityPopAt.get(c.q) || 0) + c.pop);
log('cities', cities.length);

// ---------------------------------------------------------------- per-unit and per-country statistics
const U = units.length;
const uPix = new Int32Array(U);
const uHab = new Float64Array(U);
const uKm2 = new Float64Array(U);
const uCity = new Float64Array(U);
for (let q = 0; q < N; q++) {
  const u = unitOf[q];
  if (u < 0) continue;
  uPix[u]++;
  uKm2[u] += R.ROW_KM2[(q / W) | 0];
  uHab[u] += R.ROW_KM2[(q / W) | 0] * habitability(q);
}
for (const [q, pop] of cityPopAt) if (unitOf[q] >= 0) uCity[unitOf[q]] += pop;
// pixel lists per unit (counting sort)
const uStart = new Int32Array(U + 1);
for (let u = 0; u < U; u++) uStart[u + 1] = uStart[u] + uPix[u];
const uFill = uStart.slice(0, U);
const uPixels = new Int32Array(landCount);
for (let q = 0; q < N; q++) {
  const u = unitOf[q];
  if (u >= 0) uPixels[uFill[u]++] = q;
}
const unitPixels = (u) => uPixels.subarray(uStart[u], uStart[u + 1]);

const C = countries.length;
const cHab = new Float64Array(C);
const cCity = new Float64Array(C);
const cArea = new Float64Array(C);
for (let u = 0; u < U; u++) {
  if (!uPix[u]) continue;
  const c = units[u].country;
  cHab[c] += uHab[u];
  cCity[c] += uCity[u];
}
for (let q = 0; q < N; q++) if (unitOf[q] >= 0) cArea[units[unitOf[q]].country] += R.ROW_KM2[(q / W) | 0];

// unit adjacency (same country) with shared border length in pixels
const uAdj = new Map();
const addAdj = (u, v) => {
  if (u === v || u < 0 || v < 0 || units[u].country !== units[v].country) return;
  const k = u < v ? u * 65536 + v : v * 65536 + u;
  uAdj.set(k, (uAdj.get(k) || 0) + 1);
};
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const q = y * W + x;
    const u = unitOf[q];
    if (u < 0) continue;
    addAdj(u, unitOf[y * W + ((x + 1) % W)]);
    if (y + 1 < H) addAdj(u, unitOf[q + W]);
  }
}
log('unit stats and adjacency', U, 'units');

// ---------------------------------------------------------------- province budget per country
const liveCountries = countries.map((c, i) => i).filter((i) => cArea[i] > 0);
const budget = new Int32Array(C);
let fixed = 0;
for (const i of liveCountries) {
  const o = O.BUDGET_OVERRIDES[countries[i].key];
  if (o) {
    budget[i] = o;
    fixed += o;
  }
}
const free = liveCountries.filter((i) => !budget[i]);
const weight = (i) => 0.6 * Math.sqrt(cArea[i] / 1e4) + 0.4 * Math.sqrt(countries[i].pop / 1e6);
let lo = 0;
let hi = 20;
for (let it = 0; it < 50; it++) {
  const s = (lo + hi) / 2;
  const sum = free.reduce((a, i) => a + Math.max(1, Math.round(s * weight(i))), 0);
  if (fixed + sum > O.TARGET_PROVINCES) hi = s;
  else lo = s;
}
for (const i of free) budget[i] = Math.max(1, Math.round(lo * weight(i)));
log('budget', liveCountries.length, 'countries, total', liveCountries.reduce((a, i) => a + budget[i], 0));

// ---------------------------------------------------------------- merge small units into clusters
const byCountry = new Map();
for (let u = 0; u < U; u++) {
  if (!uPix[u]) continue;
  const c = units[u].country;
  if (!byCountry.has(c)) byCountry.set(c, []);
  byCountry.get(c).push(u);
}
const unitCentroid = (u) => {
  const px = unitPixels(u);
  const x0 = px[0] % W;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < px.length; i += Math.max(1, (px.length / 400) | 0)) {
    sx += P.dxWrap(px[i] % W, x0);
    sy += (px[i] / W) | 0;
  }
  const n = Math.ceil(px.length / Math.max(1, (px.length / 400) | 0));
  return [R.wrapX(Math.round(x0 + sx / n)), sy / n];
};
const neighborsOf = new Map();
for (const [k, len] of uAdj) {
  const u = Math.floor(k / 65536);
  const v = k % 65536;
  if (!neighborsOf.has(u)) neighborsOf.set(u, new Map());
  if (!neighborsOf.has(v)) neighborsOf.set(v, new Map());
  neighborsOf.get(u).set(v, len);
  neighborsOf.get(v).set(u, len);
}

const clusters = []; // {country, units:[], alloc}
for (const [c, list] of byCountry) {
  const n = budget[c];
  const allocOf = (u) => n * (cCity[c] > 0 ? 0.55 * (uHab[u] / cHab[c]) + 0.45 * (uCity[u] / cCity[c]) : uHab[u] / cHab[c]);
  if (n <= 1) {
    clusters.push({ country: c, units: list.slice(), alloc: 1 });
    continue;
  }
  // union-find over units of this country
  const parent = new Map(list.map((u) => [u, u]));
  const find = (u) => {
    while (parent.get(u) !== u) {
      parent.set(u, parent.get(parent.get(u)));
      u = parent.get(u);
    }
    return u;
  };
  const alloc = new Map(list.map((u) => [u, allocOf(u)]));
  const areaK = new Map(list.map((u) => [u, uKm2[u]]));
  const avgArea = cArea[c] / n;
  const minArea = Math.max(2500, Math.min(0.3 * avgArea, 15000));
  const members = new Map(list.map((u) => [u, [u]]));
  const nbr = new Map(list.map((u) => [u, new Map(neighborsOf.get(u) || [])]));
  const cent = new Map(list.map((u) => [u, unitCentroid(u)]));
  const stuck = new Set();
  for (;;) {
    let small = -1;
    let sa = 0.55;
    for (const u of list) {
      if (find(u) !== u || stuck.has(u)) continue;
      const tooSmall = areaK.get(u) < minArea;
      const key = tooSmall ? alloc.get(u) - 10 : alloc.get(u);
      if (key < sa) {
        sa = key;
        small = u;
      }
    }
    if (small < 0) break;
    sa = alloc.get(small);
    // best adjacent cluster
    let target = -1;
    let bestScore = Infinity;
    for (const [v, len] of nbr.get(small)) {
      const r = find(v);
      if (r === small) continue;
      const sameRegion = units[small].region && units[small].region === units[r].region ? 0.35 : 0;
      const score = alloc.get(r) - sameRegion - Math.min(0.2, len / 400);
      if (score < bestScore) {
        bestScore = score;
        target = r;
      }
    }
    if (target < 0 && sa < 0.25) {
      // island: attach to the nearest cluster within ~700 km
      const [x0, y0] = cent.get(small);
      let bd = Infinity;
      for (const u of list) {
        if (find(u) !== u || u === small) continue;
        const [x1, y1] = cent.get(u);
        const dx = P.dxWrap(x1, x0) * R.ROW_COS[Math.min(H - 1, Math.round(y0))];
        const d = Math.hypot(dx, y1 - y0) * R.EDGE_KM;
        if (d < bd) {
          bd = d;
          target = u;
        }
      }
      if (bd > 700) target = -1;
    }
    if (target < 0) {
      stuck.add(small);
      continue;
    }
    // merge small into target
    parent.set(small, target);
    alloc.set(target, alloc.get(target) + alloc.get(small));
    areaK.set(target, areaK.get(target) + areaK.get(small));
    members.get(target).push(...members.get(small));
    for (const [v, len] of nbr.get(small)) {
      const r = find(v);
      if (r === target) continue;
      nbr.get(target).set(v, (nbr.get(target).get(v) || 0) + len);
    }
    stuck.delete(target);
  }
  for (const u of list) {
    if (find(u) !== u) continue;
    const mem = members.get(u);
    const km = areaK.get(u);
    // drop tiny uninhabited outlying islands (they become open water) unless strategic
    const cityPop = mem.reduce((a, v) => a + uCity[v], 0);
    const strategic = mem.some((v) => O.STRATEGIC_ISLANDS.some((sname) => units[v].name && units[v].name.includes(sname)));
    if (km < 600 && cityPop < 5000 && !strategic && list.length > 1 && stuck.has(u)) continue;
    const cap = Math.max(1, Math.floor(km / (0.45 * avgArea)));
    clusters.push({ country: c, units: mem, alloc: Math.min(alloc.get(u), cap + 0.49) });
  }
}
log('clusters', clusters.length);

// ---------------------------------------------------------------- split clusters into provinces
const L = new Int32Array(N).fill(-1);
const provinces = []; // {country, cluster, part, parts, seedQ}
const pixelMass = (q) => {
  const u = unitOf[q];
  const c = units[u].country;
  const a = (R.ROW_KM2[(q / W) | 0] * habitability(q)) / cHab[c];
  const cp = cityPopAt.get(q);
  return cCity[c] > 0 ? 0.55 * a + (cp ? (0.45 * cp) / cCity[c] : 0) : a;
};
const clusterCities = new Map();
for (const c of cities) {
  const u = unitOf[c.q];
  if (u < 0) continue;
  if (!clusterCities.has(u)) clusterCities.set(u, []);
  clusterCities.get(u).push(c);
}

clusters.forEach((cl, ci) => {
  const k = Math.max(1, Math.round(cl.alloc));
  cl.k = k;
  const total = cl.units.reduce((a, u) => a + uPix[u], 0);
  const pixels = new Int32Array(total);
  let o = 0;
  for (const u of cl.units) {
    pixels.set(unitPixels(u), o);
    o += uPix[u];
  }
  if (k === 1) {
    const id = provinces.length;
    provinces.push({ country: cl.country, cluster: ci, part: 0, parts: 1 });
    for (let i = 0; i < pixels.length; i++) L[pixels[i]] = id;
    return;
  }
  const stamp = P.newStamp();
  P.markSet(pixels, stamp);
  const comps = P.components(pixels, stamp);
  const cm = comps.map((cp) => {
    let m = 0;
    for (let i = 0; i < cp.length; i++) m += pixelMass(cp[i]);
    return m;
  });
  const mTot = cm.reduce((a, b) => a + b, 0) || 1;
  // largest remainder seat allocation
  const raw = cm.map((m) => (m / mTot) * k);
  const seats = raw.map((r) => Math.floor(r));
  let left = k - seats.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    seats[i]++;
    left--;
  }
  const cityList = cl.units.flatMap((u) => clusterCities.get(u) || []).sort((a, b) => b.pop - a.pop);
  const compOwner = []; // per component: array of province ids by own index
  comps.forEach((cp, i) => {
    const s = seats[i];
    if (!s) return;
    const cst = P.newStamp();
    P.markSet(cp, cst);
    const cityPix = cityList.filter((c) => P.memb[c.q] === cst).map((c) => c.q);
    let seeds = P.chooseSeeds(cp, s, cityPix, rand);
    for (let it = 0; it < 4; it++) {
      P.geoVoronoi(cp, seeds, cst);
      seeds = P.lloydStep(cp, seeds, pixelMass);
    }
    P.geoVoronoi(cp, seeds, cst);
    const ids = seeds.map((sq, j) => {
      const id = provinces.length;
      provinces.push({ country: cl.country, cluster: ci, part: j, parts: k, seedQ: sq });
      return id;
    });
    for (let j = 0; j < cp.length; j++) {
      const ow = P.own[cp[j]];
      L[cp[j]] = ids[ow >= 0 ? ow : 0];
    }
    compOwner[i] = ids;
  });
  // unseeded components join the nearest seeded province of this cluster
  const seeded = provinces.filter((p) => p.cluster === ci && p.seedQ !== undefined);
  comps.forEach((cp, i) => {
    if (seats[i]) return;
    const q0 = cp[0];
    const x0 = q0 % W;
    const y0 = (q0 / W) | 0;
    let best = seeded[0];
    let bd = Infinity;
    for (const p of seeded) {
      const x1 = p.seedQ % W;
      const y1 = (p.seedQ / W) | 0;
      const d = (P.dxWrap(x1, x0) * R.ROW_COS[y0]) ** 2 + (y1 - y0) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    const id = provinces.indexOf(best);
    for (let j = 0; j < cp.length; j++) L[cp[j]] = id;
  });
});
const PC = provinces.length;
log('land provinces', PC);

// ---------------------------------------------------------------- water: seas and lakes
const waterList = [];
for (let q = 0; q < N; q++) if (L[q] < 0) waterList.push(q);
const water = Int32Array.from(waterList);
waterList.length = 0;
const wStamp = P.newStamp();
P.markSet(water, wStamp);
const wComps = P.components(water, wStamp);
wComps.sort((a, b) => b.length - a.length);
const forced = new Set(O.FORCE_SEA_POINTS.map(([lon, lat]) => R.pixelAt(lon, lat)));
const seaComps = [];
const lakeComps = [];
wComps.forEach((cp, i) => {
  let area = 0;
  let force = false;
  for (let j = 0; j < cp.length; j++) {
    area += R.ROW_KM2[(cp[j] / W) | 0];
    if (forced.has(cp[j])) force = true;
  }
  if (i === 0 || area >= 40000 || force) seaComps.push(cp);
  else lakeComps.push(cp);
});
log('water components: seas', seaComps.length, 'lakes', lakeComps.length);

// distance to coast (in 1/10 pixel units) over all sea pixels
const seaAll = new Int32Array(seaComps.reduce((a, c) => a + c.length, 0));
{
  let o = 0;
  for (const c of seaComps) {
    seaAll.set(c, o);
    o += c.length;
  }
}
const sStamp = P.newStamp();
P.markSet(seaAll, sStamp);
const coast = [];
for (let i = 0; i < seaAll.length; i++) {
  const q = seaAll[i];
  const x = q % W;
  const y = (q / W) | 0;
  const nb = [y > 0 ? q - W : -1, y < H - 1 ? q + W : -1, x > 0 ? q - 1 : q + W - 1, x < W - 1 ? q + 1 : q - W + 1];
  if (nb.some((r) => r >= 0 && L[r] >= 0)) coast.push(q);
}
P.geoVoronoi(seaAll, coast, sStamp);
const coastKm = new Float32Array(N);
for (let i = 0; i < seaAll.length; i++) coastKm[seaAll[i]] = (P.dist[seaAll[i]] / 10) * R.EDGE_KM;
log('coast distance field');

// Poisson-like seed sampling with spacing growing away from the coast
const cand = [];
for (let i = 0; i < seaAll.length; i++) {
  const q = seaAll[i];
  if ((q % W) % 5 === 0 && ((q / W) | 0) % 5 === 0) cand.push(q);
}
for (let i = cand.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [cand[i], cand[j]] = [cand[j], cand[i]];
}
const lonlat = (q) => [R.xToLon((q % W) + 0.5), R.rowLat((q / W) | 0)];
const kmBetween = (a, b) => {
  let dl = Math.abs(a[0] - b[0]);
  if (dl > 180) dl = 360 - dl;
  const dx = dl * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot(dx, a[1] - b[1]) * R.KM_PER_DEG;
};
function sampleSeas(base) {
  const seeds = [];
  const grid = new Map();
  const cellDeg = 5;
  const key = (lon, lat) => Math.floor((lon + 180) / cellDeg) * 1000 + Math.floor((lat + 90) / cellDeg);
  for (const q of cand) {
    const ll = lonlat(q);
    const sp = base * (1 + 1.7 * Math.min(1, coastKm[q] / 700));
    const r = Math.ceil(sp / (cellDeg * 111 * Math.max(0.2, Math.cos((ll[1] * Math.PI) / 180)))) + 1;
    const gx = Math.floor((ll[0] + 180) / cellDeg);
    const gy = Math.floor((ll[1] + 90) / cellDeg);
    let ok = true;
    for (let dy = -r; dy <= r && ok; dy++) {
      for (let dx = -r; dx <= r && ok; dx++) {
        const cellX = (((gx + dx) % 72) + 72) % 72;
        const list = grid.get(cellX * 1000 + gy + dy);
        if (!list) continue;
        for (const s of list) {
          if (kmBetween(s.ll, ll) < Math.min(sp, s.sp)) {
            ok = false;
            break;
          }
        }
      }
    }
    if (!ok) continue;
    const s = { q, ll, sp };
    seeds.push(s);
    const k = key(ll[0], ll[1]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(s);
  }
  return seeds;
}
let sLo = 150;
let sHi = 2500;
let seaSeeds = [];
for (let it = 0; it < 10; it++) {
  const mid = (sLo + sHi) / 2;
  seaSeeds = sampleSeas(mid);
  if (seaSeeds.length > O.TARGET_SEA_ZONES) sLo = mid;
  else sHi = mid;
}
seaSeeds = sampleSeas(sHi);
log('sea seeds', seaSeeds.length, 'base spacing', Math.round(sHi), 'km');

const seas = [];
for (const cp of seaComps) {
  const cst = P.newStamp();
  P.markSet(cp, cst);
  let seeds = seaSeeds.filter((s) => P.memb[s.q] === cst).map((s) => s.q);
  if (!seeds.length) seeds = [cp[(cp.length / 2) | 0]];
  const km2 = (q) => R.ROW_KM2[(q / W) | 0];
  for (let it = 0; it < 2; it++) {
    P.geoVoronoi(cp, seeds, cst);
    seeds = P.lloydStep(cp, seeds, km2);
  }
  P.geoVoronoi(cp, seeds, cst);
  const ids = seeds.map((sq) => {
    const id = PC + seas.length;
    seas.push({ seedQ: sq });
    return id;
  });
  for (let j = 0; j < cp.length; j++) L[cp[j]] = ids[Math.max(0, P.own[cp[j]])];
}
const SC = seas.length;
const LAKE = PC + SC;
for (const cp of lakeComps) for (let j = 0; j < cp.length; j++) L[cp[j]] = LAKE;
log('sea zones', SC);

await finish({ log, L, PC, SC, LAKE, provinces, seas, clusters, units, countries, liveCountries, budget, cities, unitOf, hint, A0, cArea, cityPopAt, unitAreaCache: uPix });
log('done');
