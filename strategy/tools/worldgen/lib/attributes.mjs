// Province, sea, country, region and area attributes for the world package.
import * as R from './raster.mjs';
import * as P from './partition.mjs';
import * as O from '../overrides/data.mjs';

const { W, H } = R;
export const TERRAINS = ['plains', 'forest', 'jungle', 'hills', 'mountains', 'desert', 'marsh', 'tundra', 'arctic'];
const T = Object.fromEntries(TERRAINS.map((t, i) => [t, i]));

const PALETTE = [
  '#7d9bbf', '#c08a7a', '#8fb28a', '#d1b276', '#a293c2', '#78aeb0', '#cf9d6c', '#abb36e',
  '#b58aa6', '#86b5bd', '#c9a96f', '#8e9ecf', '#b3967a', '#7fae8e', '#c48585', '#9eb0c7',
  '#b8a2cf', '#adc07e', '#d0a38f', '#8fc0a8',
];
const COLOR_OVERRIDES = {
  'United States of America': '#5b83b8',
  China: '#c0625a',
  Russia: '#7f9f6f',
  'United Kingdom': '#b8566a',
  France: '#6f8fce',
  Germany: '#8a8f99',
  India: '#d49a55',
  Brazil: '#78b07c',
  Japan: '#d6c7a0',
  Turkey: '#b07b62',
  Iran: '#8fb59a',
  Canada: '#c77b72',
  Australia: '#c9a15e',
  Ukraine: '#d3c46a',
  Poland: '#c98f8f',
  'Saudi Arabia': '#86a36a',
  Egypt: '#d2b98a',
  Italy: '#88b48a',
  Spain: '#d0b35c',
  Mexico: '#8fad7c',
  Indonesia: '#b48f7a',
  Pakistan: '#6f9f84',
  'South Korea': '#8aa6c9',
  'North Korea': '#b07a7a',
  Israel: '#8fb0d4',
};

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const title = (s) => (s && s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()) : s);

export function attributes(ctx) {
  const { L, PC, SC, LAKE, provinces, seas, clusters, units, countries, liveCountries, cities, unitOf, hint, cArea, landPx, labelQ, landAdj, coastAdj, load } = ctx;

  // ------------------------------------------------------------ live countries renumbered 0..n-1
  const cMap = new Int32Array(countries.length).fill(-1);
  const liveIdx = liveCountries.filter((c) => provinces.some((p) => p.country === c));
  liveIdx.forEach((c, i) => (cMap[c] = i));
  const CN = liveIdx.length;

  // ------------------------------------------------------------ per-province pixel statistics
  const pix = new Int32Array(PC);
  const km2 = new Float64Array(PC);
  const sumLat = new Float64Array(PC);
  const sumDx = new Float64Array(PC);
  const sumY = new Float64Array(PC);
  const refX = new Int32Array(PC).fill(-1);
  const hints = Array.from({ length: PC }, () => new Float64Array(7));
  const climate = Array.from({ length: PC }, () => ({ jungle: 0, forest: 0 }));
  const box = O.CLIMATE_BOXES;
  for (let i = 0; i < landPx.length; i++) {
    const q = landPx[i];
    const p = L[q];
    const x = q % W;
    const y = (q / W) | 0;
    const a = R.ROW_KM2[y];
    if (refX[p] < 0) refX[p] = x;
    pix[p]++;
    km2[p] += a;
    const lat = R.rowLat(y);
    sumLat[p] += lat * a;
    sumDx[p] += P.dxWrap(x, refX[p]) * a;
    sumY[p] += y * a;
    hints[p][hint[q]] += a;
    if ((i & 7) === 0) {
      const lon = R.xToLon(x + 0.5);
      for (const [k, x0, y0, x1, y1] of box) if (lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1) climate[p][k] += a * 8;
    }
  }
  const cx = new Float64Array(PC);
  const cy = new Float64Array(PC);
  const lat = new Float64Array(PC);
  for (let p = 0; p < PC; p++) {
    cx[p] = R.wrapX(refX[p] + sumDx[p] / km2[p]);
    cy[p] = sumY[p] / km2[p];
    lat[p] = sumLat[p] / km2[p];
  }
  const lonOf = (p) => R.xToLon(cx[p]);

  // ------------------------------------------------------------ terrain
  const terrain = new Uint8Array(PC);
  for (let p = 0; p < PC; p++) {
    const h = hints[p];
    const f = (k) => h[k] / km2[p];
    const al = Math.abs(lat[p]);
    const country = countries[provinces[p].country].key;
    let t;
    if (f(1) >= 0.38) t = 'mountains';
    else if (f(2) >= 0.42) t = 'desert';
    else if (al >= 72 || (country === 'Denmark' && lat[p] > 60)) t = 'arctic';
    else if (al >= 64 || f(4) >= 0.4) t = 'tundra';
    else if (f(5) >= 0.4) t = 'marsh';
    else if (climate[p].jungle / km2[p] >= 0.4 && al < 20) t = 'jungle';
    else if (f(1) >= 0.14 || f(3) >= 0.45) t = 'hills';
    else if (climate[p].forest / km2[p] >= 0.4) t = 'forest';
    else t = 'plains';
    terrain[p] = T[t];
  }

  // ------------------------------------------------------------ cities per province
  const provCities = Array.from({ length: PC }, () => []);
  for (const c of cities) {
    const p = L[c.q];
    if (p >= 0 && p < PC) provCities[p].push(c);
  }
  const cityOut = { name: [], pop: [], prov: [], x: [], y: [], cap: [] };
  const provCityIdx = Array.from({ length: PC }, () => []);
  for (let p = 0; p < PC; p++) {
    const list = provCities[p];
    list.sort((a, b) => b.pop - a.pop);
    list.forEach((c, i) => {
      if (i >= 4 && !c.capital) return;
      if (i > 0 && c.pop < 50000 && !c.capital) return;
      provCityIdx[p].push(cityOut.name.length);
      cityOut.name.push(c.name);
      cityOut.pop.push(Math.round(c.pop));
      cityOut.prov.push(p);
      cityOut.x.push(+(R.lonToX(c.lon)).toFixed(1));
      cityOut.y.push(+(R.latToY(c.lat)).toFixed(1));
      cityOut.cap.push(c.capital ? 1 : 0);
    });
  }
  const urban = new Uint8Array(PC);
  const cityPop = new Float64Array(PC);
  for (let p = 0; p < PC; p++) {
    const top = provCities[p][0]?.pop || 0;
    urban[p] = top >= 10e6 ? 3 : top >= 3e6 ? 2 : top >= 1e6 ? 1 : 0;
    for (const c of provCities[p]) cityPop[p] += c.pop;
  }

  // ------------------------------------------------------------ population and GDP
  const habArea = new Float64Array(PC);
  const habOf = [1, 0.8, 0.5, 0.7, 0.35, 0.08, 0.35, 0.06, 0.01];
  for (let p = 0; p < PC; p++) habArea[p] = km2[p] * habOf[terrain[p]];
  const urbanShare = (inc) => (/^1|^2/.test(inc || '') ? 0.8 : /^3/.test(inc || '') ? 0.62 : /^4/.test(inc || '') ? 0.45 : 0.33);
  const pop = new Float64Array(PC);
  const gdp = new Float64Array(PC);
  const provsOf = Array.from({ length: countries.length }, () => []);
  for (let p = 0; p < PC; p++) provsOf[provinces[p].country].push(p);
  for (const c of liveIdx) {
    const list = provsOf[c];
    const cc = countries[c];
    const u = urbanShare(cc.main.INCOME_GRP);
    const totalCity = list.reduce((a, p) => a + cityPop[p], 0);
    const totalHab = list.reduce((a, p) => a + habArea[p], 0) || 1;
    const urbanPop = totalCity > 0 ? cc.pop * u : 0;
    const ruralPop = cc.pop - urbanPop;
    for (const p of list) pop[p] = (totalCity > 0 ? (urbanPop * cityPop[p]) / totalCity : 0) + (ruralPop * habArea[p]) / totalHab;
    const w = list.map((p) => pop[p] * (1 + (totalCity > 0 ? cityPop[p] / Math.max(1, pop[p]) : 0)));
    const ws = w.reduce((a, b) => a + b, 0) || 1;
    list.forEach((p, i) => (gdp[p] = (cc.gdp * w[i]) / ws));
  }

  // ------------------------------------------------------------ resources
  const res = { oil: new Float64Array(PC), minerals: new Float64Array(PC), rare: new Float64Array(PC), food: new Float64Array(PC) };
  const kmTo = (p, lon, la) => {
    let dl = Math.abs(lonOf(p) - lon);
    if (dl > 180) dl = 360 - dl;
    return Math.hypot(dl * Math.cos((((lat[p] + la) / 2) * Math.PI) / 180), lat[p] - la) * R.KM_PER_DEG;
  };
  for (const [kind, lon, la, r, w] of O.RESOURCE_ZONES) {
    for (let p = 0; p < PC; p++) {
      const d = kmTo(p, lon, la);
      const reach = r + Math.sqrt(km2[p]) * 0.5;
      if (d < reach) res[kind][p] += w * Math.sqrt(1 - d / reach);
    }
  }
  const foodBase = [1, 0.5, 0.4, 0.6, 0.15, 0.05, 0.3, 0.05, 0];
  for (let p = 0; p < PC; p++) {
    res.food[p] += foodBase[terrain[p]] * Math.min(3, km2[p] / 60000) + Math.min(2, pop[p] / 20e6);
    if (terrain[p] === T.mountains || terrain[p] === T.hills) res.minerals[p] += 0.6;
  }
  const q = (a, s) => Array.from(a, (v) => Math.min(20, Math.round(v * s)));

  // ------------------------------------------------------------ ports and airbases
  const nearestLand = (lon, la) => {
    const q0 = R.pixelAt(lon, la);
    if (q0 < 0) return -1;
    const x0 = q0 % W;
    const y0 = (q0 / W) | 0;
    let best = -1;
    let bd = Infinity;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const y = y0 + dy;
        if (y < 0 || y >= H) continue;
        const v = L[R.idx(R.wrapX(x0 + dx), y)];
        const d = dx * dx + dy * dy;
        if (v < PC && d < bd) {
          bd = d;
          best = v;
        }
      }
    }
    return best;
  };
  const coastal = new Uint8Array(PC);
  for (let i = 0; i < coastAdj.length; i++) coastal[coastAdj[i][0]] = 1;
  const port = new Uint8Array(PC);
  for (const f of load('ne_10m_ports')) {
    const [lon, la] = f.geometry.coordinates;
    const p = nearestLand(lon, la);
    if (p >= 0 && coastal[p]) port[p] = Math.min(3, port[p] + 1);
  }
  for (let p = 0; p < PC; p++) if (coastal[p] && urban[p] >= 2) port[p] = Math.max(port[p], 2);
  const airbase = new Uint8Array(PC);
  for (const f of load('ne_10m_airports')) {
    const t = f.properties.type || '';
    const [lon, la] = f.geometry.coordinates;
    const p = nearestLand(lon, la);
    if (p < 0) continue;
    const w = /military/.test(t) ? 2 : /major/.test(t) ? 1 : (f.properties.scalerank ?? 9) <= 4 ? 1 : 0;
    if (w) airbase[p] = Math.min(3, airbase[p] + w);
  }

  // ------------------------------------------------------------ province names
  const provName = new Array(PC);
  const compass = (dx, dy) => {
    const a = Math.atan2(-dy, dx);
    const names = ['East', 'North-East', 'North', 'North-West', 'West', 'South-West', 'South', 'South-East'];
    return names[(Math.round(a / (Math.PI / 4)) + 8) % 8];
  };
  const usedNames = new Map();
  const clusterInfo = clusters.map((cl) => {
    const main = cl.units.reduce((m, u) => (unitArea(u) > unitArea(m) ? u : m), cl.units[0]);
    const regionsOf = new Set(cl.units.map((u) => units[u].region).filter(Boolean));
    const name = cl.units.length > 1 && regionsOf.size === 1 ? [...regionsOf][0] : units[main].name;
    return { main, name: title(name) };
  });
  function unitArea(u) {
    return ctx.unitAreaCache ? ctx.unitAreaCache[u] : 0;
  }
  // cluster centroid for compass naming
  const clCx = new Float64Array(clusters.length);
  const clCy = new Float64Array(clusters.length);
  const clW = new Float64Array(clusters.length);
  const clRef = new Int32Array(clusters.length).fill(-1);
  for (let p = 0; p < PC; p++) {
    const c = provinces[p].cluster;
    if (clRef[c] < 0) clRef[c] = Math.round(cx[p]);
    clCx[c] += P.dxWrap(Math.round(cx[p]), clRef[c]) * km2[p];
    clCy[c] += cy[p] * km2[p];
    clW[c] += km2[p];
  }
  for (let p = 0; p < PC; p++) {
    const pr = provinces[p];
    const base = clusterInfo[pr.cluster].name || countries[pr.country].main.NAME;
    let name;
    const clu = clusters[pr.cluster];
    if (pr.parts === 1) {
      const big = provCities[p][0];
      name = clu.units.length > 1 && big && big.pop >= 100000 ? big.name : title(units[clusterInfo[pr.cluster].main].name) || base;
    }
    else {
      const big = provCities[p].find((c) => c.pop >= 40000);
      if (big) name = big.name;
      else {
        const c = pr.cluster;
        const dx = P.dxWrap(Math.round(cx[p]), clRef[c]) - clCx[c] / clW[c];
        const dy = cy[p] - clCy[c] / clW[c];
        name = Math.hypot(dx, dy) < 6 ? `Central ${base}` : `${compass(dx, dy)} ${base}`;
      }
    }
    const key = `${pr.country}|${name}`;
    const n = usedNames.get(key) || 0;
    usedNames.set(key, n + 1);
    provName[p] = n ? `${name} ${['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || n + 1}` : name;
  }

  // ------------------------------------------------------------ land graph helpers
  const nbrs = Array.from({ length: PC }, () => []);
  for (const [a, b, len] of landAdj) {
    nbrs[a].push([b, len]);
    nbrs[b].push([a, len]);
  }

  // ------------------------------------------------------------ regions: split clusters keep their unit name; single provinces grouped by NE region or neighbours
  const region = new Int32Array(PC).fill(-1);
  const regions = [];
  const byKey = new Map();
  for (let p = 0; p < PC; p++) {
    const pr = provinces[p];
    const cl = clusters[pr.cluster];
    let key;
    let name;
    if (pr.parts > 1) {
      key = `c${pr.cluster}`;
      name = clusterInfo[pr.cluster].name;
    } else {
      const reg = units[clusterInfo[pr.cluster].main].region;
      if (reg) {
        key = `r${pr.country}|${reg}`;
        name = title(reg);
      } else continue;
    }
    void cl;
    if (!byKey.has(key)) {
      byKey.set(key, regions.length);
      regions.push({ name, country: cMap[pr.country], provinces: [] });
    }
    region[p] = byKey.get(key);
    regions[region[p]].provinces.push(p);
  }
  // group the remaining provinces with adjacent unassigned provinces of the same country (~3 per region)
  for (let p = 0; p < PC; p++) {
    if (region[p] >= 0) continue;
    const id = regions.length;
    regions.push({ name: provName[p], country: cMap[provinces[p].country], provinces: [p] });
    region[p] = id;
    const queue = [p];
    while (queue.length && regions[id].provinces.length < 3) {
      const a = queue.shift();
      for (const [b] of nbrs[a].sort((x, y) => y[1] - x[1])) {
        if (region[b] >= 0 || provinces[b].country !== provinces[p].country) continue;
        region[b] = id;
        regions[id].provinces.push(b);
        queue.push(b);
        if (regions[id].provinces.length >= 3) break;
      }
    }
  }
  // split very large regions
  for (let r = 0; r < regions.length; r++) {
    const list = regions[r].provinces;
    if (list.length <= 10) continue;
    const chunks = Math.ceil(list.length / 8);
    const set = new Set(list);
    const taken = new Set();
    for (let k = 1; k < chunks; k++) {
      const start = list.find((p) => !taken.has(p) && region[p] === r);
      if (start === undefined) break;
      const id = regions.length;
      const reg = { name: `${regions[r].name} ${['', 'North', 'South', 'East', 'West', 'Central', 'Outer', 'Inner'][k] || k}`.trim(), country: regions[r].country, provinces: [] };
      regions.push(reg);
      const queue = [start];
      while (queue.length && reg.provinces.length < 8) {
        const a = queue.shift();
        if (taken.has(a)) continue;
        taken.add(a);
        region[a] = id;
        reg.provinces.push(a);
        for (const [b] of nbrs[a]) if (set.has(b) && !taken.has(b)) queue.push(b);
      }
    }
    regions[r].provinces = list.filter((p) => region[p] === r);
  }
  const regionsOut = regions.filter((r) => r.provinces.length);
  const remap = new Map(regions.map((r, i) => [i, regionsOut.indexOf(r)]));
  for (let p = 0; p < PC; p++) region[p] = remap.get(region[p]);

  // ------------------------------------------------------------ continents and theaters
  const contOf = (p) => {
    const m = countries[provinces[p].country].main;
    let c = m.CONTINENT;
    if (countries[provinces[p].country].key === 'Russia') c = lonOf(p) > 60 || lonOf(p) < -100 ? 'Asia' : 'Europe';
    if (c === 'Seven seas (open ocean)') {
      const lo = lonOf(p);
      c = lo > -30 && lo < 60 ? 'Africa' : lo >= 60 && lo < 110 ? 'Asia' : 'Oceania';
    }
    if (c === 'Antarctica') c = 'Oceania';
    return c;
  };
  const theaterOf = (p) => {
    const m = countries[provinces[p].country].main;
    if (countries[provinces[p].country].key === 'Russia' && (lonOf(p) > 60 || lonOf(p) < -100)) return 'Siberia and Far East';
    const s = m.SUBREGION || m.REGION_UN || 'Other';
    if (s === 'Seven seas (open ocean)') return contOf(p) === 'Africa' ? 'Eastern Africa' : contOf(p) === 'Asia' ? 'Southern Asia' : 'Polynesia';
    if (/Melanesia|Micronesia|Polynesia/.test(s)) return 'Pacific Islands';
    return s;
  };
  const continents = [];
  const theaters = [];
  const idxOf = (arr, v) => {
    let i = arr.indexOf(v);
    if (i < 0) {
      i = arr.length;
      arr.push(v);
    }
    return i;
  };
  const continent = Array.from({ length: PC }, (_, p) => idxOf(continents, contOf(p)));
  const theater = Array.from({ length: PC }, (_, p) => idxOf(theaters, theaterOf(p)));

  // ------------------------------------------------------------ strategic areas (~1 per 10 provinces), BFS over the land graph
  const areaCount = Math.round(PC / 10);
  const seedsA = [];
  const byPop = Array.from({ length: PC }, (_, p) => p).sort((a, b) => pop[b] - pop[a]);
  const far = new Float64Array(PC).fill(Infinity);
  seedsA.push(byPop[0]);
  const dKm = (a, b) => {
    let dl = Math.abs(lonOf(a) - lonOf(b));
    if (dl > 180) dl = 360 - dl;
    return Math.hypot(dl * Math.cos((((lat[a] + lat[b]) / 2) * Math.PI) / 180), lat[a] - lat[b]) * R.KM_PER_DEG;
  };
  while (seedsA.length < areaCount) {
    const s = seedsA[seedsA.length - 1];
    let best = -1;
    let bv = -1;
    for (let p = 0; p < PC; p++) {
      far[p] = Math.min(far[p], dKm(p, s));
      const v = far[p] * Math.pow(1 + pop[p] / 5e6, 0.35) * Math.pow(Math.max(0.2, 1 - Math.abs(lat[p]) / 90), 0.8);
      if (v > bv) {
        bv = v;
        best = p;
      }
    }
    seedsA.push(best);
  }
  const area = new Int32Array(PC).fill(-1);
  const q2 = [];
  seedsA.forEach((s, i) => {
    area[s] = i;
    q2.push(s);
  });
  for (let h = 0; h < q2.length; h++) {
    const a = q2[h];
    for (const [b] of nbrs[a]) {
      if (area[b] >= 0) continue;
      area[b] = area[a];
      q2.push(b);
    }
  }
  for (let p = 0; p < PC; p++) {
    if (area[p] >= 0) continue;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < seedsA.length; i++) {
      const d = dKm(p, seedsA[i]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    area[p] = best;
  }
  const areas = seedsA.map((s) => ({ name: regionsOut[region[s]]?.name || provName[s] }));
  const areaNames = new Map();
  areas.forEach((a) => {
    const n = areaNames.get(a.name) || 0;
    areaNames.set(a.name, n + 1);
    if (n) a.name = `${a.name} ${n + 1}`;
  });

  // ------------------------------------------------------------ country graph, colours, capitals
  const cAdj = Array.from({ length: CN }, () => new Set());
  for (const [a, b] of landAdj) {
    const ca = cMap[provinces[a].country];
    const cb = cMap[provinces[b].country];
    if (ca !== cb) {
      cAdj[ca].add(cb);
      cAdj[cb].add(ca);
    }
  }
  const colors = new Array(CN).fill(null);
  liveIdx.forEach((c, i) => {
    if (COLOR_OVERRIDES[countries[c].key]) colors[i] = COLOR_OVERRIDES[countries[c].key];
  });
  const order = Array.from({ length: CN }, (_, i) => i).sort((a, b) => cAdj[b].size - cAdj[a].size);
  let rot = 0;
  for (const i of order) {
    if (colors[i]) continue;
    const used = new Set([...cAdj[i]].map((j) => colors[j]).filter(Boolean));
    for (let k = 0; k < PALETTE.length; k++) {
      const col = PALETTE[(rot + k) % PALETTE.length];
      if (!used.has(col)) {
        colors[i] = col;
        break;
      }
    }
    colors[i] = colors[i] || PALETTE[rot % PALETTE.length];
    rot += 7;
  }
  const capital = new Int32Array(CN).fill(-1);
  for (const c of cities) {
    if (!c.capital) continue;
    const p = L[c.q];
    if (p < 0 || p >= PC) continue;
    const ci = cMap[provinces[p].country];
    if (capital[ci] < 0) capital[ci] = p;
  }
  const provCount = new Int32Array(CN);
  for (let p = 0; p < PC; p++) provCount[cMap[provinces[p].country]]++;
  for (let i = 0; i < CN; i++) {
    if (capital[i] >= 0) continue;
    let best = -1;
    for (let p = 0; p < PC; p++) if (cMap[provinces[p].country] === i && (best < 0 || pop[p] > pop[best])) best = p;
    capital[i] = best;
  }

  // ------------------------------------------------------------ sea names from Natural Earth marine polygons
  const marine = load('ne_10m_geography_marine_polys');
  const seaName = new Array(SC).fill(null);
  const seaPix = new Int32Array(SC);
  const seaSx = new Float64Array(SC);
  const seaSy = new Float64Array(SC);
  const seaRef = new Int32Array(SC).fill(-1);
  const seaKm2 = new Float64Array(SC);
  for (let qq = 0; qq < L.length; qq++) {
    const v = L[qq];
    if (v < PC || v >= LAKE) continue;
    const s = v - PC;
    const x = qq % W;
    const y = (qq / W) | 0;
    if (seaRef[s] < 0) seaRef[s] = x;
    seaPix[s]++;
    seaSx[s] += P.dxWrap(x, seaRef[s]);
    seaSy[s] += y;
    seaKm2[s] += R.ROW_KM2[y];
  }
  const seaX = Array.from({ length: SC }, (_, s) => R.wrapX(Math.round(seaRef[s] + seaSx[s] / seaPix[s])));
  const seaY = Array.from({ length: SC }, (_, s) => Math.round(seaSy[s] / seaPix[s]));
  // paint named marine polygons: oceans first, then seas by importance so smaller bodies override
  const mId = new Int16Array(L.length).fill(-1);
  const orderM = marine
    .map((f, i) => ({ f, i, rank: (f.properties.featurecla === 'ocean' ? -100 : 0) + (f.properties.scalerank ?? 5) }))
    .sort((a, b) => a.rank - b.rank);
  for (const { f, i } of orderM) for (const poly of R.geometryPolygons(f.geometry)) R.fillPolygon(poly, (qq) => (mId[qq] = i));
  // majority name over a sample of each zone's pixels
  const votes = Array.from({ length: SC }, () => new Map());
  for (let qq = 0; qq < L.length; qq += 7) {
    const v = L[qq];
    if (v < PC || v >= LAKE || mId[qq] < 0) continue;
    const m = votes[v - PC];
    m.set(mId[qq], (m.get(mId[qq]) || 0) + 1);
  }
  for (let s = 0; s < SC; s++) {
    let best = -1;
    let bv = 0;
    for (const [k, n] of votes[s]) {
      if (n > bv) {
        bv = n;
        best = k;
      }
    }
    if (best >= 0) seaName[s] = title(marine[best].properties.name || marine[best].properties.name_en || '');
  }
  for (let s = 0; s < SC; s++) if (!seaName[s]) seaName[s] = seaKm2[s] < 200000 ? 'Inland Sea' : 'Open Ocean';
  // disambiguate duplicates with compass qualifiers
  const groups = new Map();
  seaName.forEach((n, s) => {
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(s);
  });
  for (const [n, list] of groups) {
    if (list.length < 2) continue;
    const mx = list.reduce((a, s) => a + P.dxWrap(seaX[s], seaX[list[0]]), 0) / list.length;
    const my = list.reduce((a, s) => a + seaY[s], 0) / list.length;
    const used = new Map();
    for (const s of list) {
      const dx = P.dxWrap(seaX[s], seaX[list[0]]) - mx;
      const dy = seaY[s] - my;
      let label = Math.hypot(dx * R.ROW_COS[Math.min(H - 1, seaY[s])], dy) < 40 ? 'Central' : compass(dx, dy);
      const k = used.get(label) || 0;
      used.set(label, k + 1);
      if (k) label = `${label} ${k + 1}`;
      seaName[s] = `${n} (${label})`;
    }
  }

  // ------------------------------------------------------------ outputs
  const provinceColor = (p) => {
    const base = hex(colors[cMap[provinces[p].country]]);
    const j = ((p * 2654435761) >>> 0) % 21;
    return base.map((v) => Math.max(0, Math.min(255, v - 10 + j)));
  };
  const labelX = Array.from({ length: PC }, (_, p) => (labelQ[p] >= 0 ? (labelQ[p] % W) + 0.5 : cx[p]));
  const labelY = Array.from({ length: PC }, (_, p) => (labelQ[p] >= 0 ? ((labelQ[p] / W) | 0) + 0.5 : cy[p]));
  const json = {
    terrains: TERRAINS,
    continents,
    theaters,
    countries: liveIdx.map((c, i) => {
      const m = countries[c].main;
      return {
        key: countries[c].key,
        name: m.NAME === 'United States of America' ? 'United States' : m.NAME,
        nameLong: m.NAME_LONG || m.NAME,
        iso3: m.ISO_A3 !== '-99' ? m.ISO_A3 : m.ADM0_A3,
        pop: Math.round(countries[c].pop),
        gdp: Math.round(countries[c].gdp),
        income: m.INCOME_GRP,
        economy: m.ECONOMY,
        subregion: m.SUBREGION,
        color: colors[i],
        capital: capital[i],
        provinces: provCount[i],
        areaKm2: Math.round(cArea[c]),
      };
    }),
    provinces: {
      name: provName,
      country: Array.from({ length: PC }, (_, p) => cMap[provinces[p].country]),
      region: Array.from(region),
      area: Array.from(area),
      theater,
      continent,
      km2: Array.from(km2, (v) => Math.round(v)),
      terrain: Array.from(terrain),
      pop: Array.from(pop, (v) => Math.round(v)),
      gdp: Array.from(gdp, (v) => Math.round(v)),
      x: labelX.map((v) => +v.toFixed(1)),
      y: labelY.map((v) => +v.toFixed(1)),
      cx: Array.from(cx, (v) => +v.toFixed(1)),
      cy: Array.from(cy, (v) => +v.toFixed(1)),
      lat: Array.from(lat, (v) => +v.toFixed(2)),
      urban: Array.from(urban),
      coastal: Array.from(coastal),
      port: Array.from(port),
      airbase: Array.from(airbase),
      oil: q(res.oil, 1.2),
      minerals: q(res.minerals, 1.3),
      rare: q(res.rare, 1.4),
      food: q(res.food, 1.6),
      cities: provCityIdx,
    },
    seas: { name: seaName, x: seaX, y: seaY, km2: Array.from(seaKm2, (v) => Math.round(v)) },
    regions: regionsOut.map((r) => ({ name: r.name, country: r.country })),
    areas,
    cities: cityOut,
  };
  return { json, provinceColor };
}
