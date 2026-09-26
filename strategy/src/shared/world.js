// Runtime view of the static world package (shared by simulation, server and client).
// Nodes 0..P-1 are land provinces, P..P+S-1 are sea zones. Adjacency is stored as CSR.

export const EDGE_RIVER = 1;
export const EDGE_STRAIT = 2;
export const EDGE_BRIDGE = 4;
export const EDGE_COAST = 8; // land <-> sea
export const EDGE_SEA = 16; // sea <-> sea

export const TERRAIN = ['plains', 'forest', 'jungle', 'hills', 'mountains', 'desert', 'marsh', 'tundra', 'arctic'];

const DEG = Math.PI / 180;

export function millerY(latDeg) {
  return (1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * latDeg * DEG))) / DEG;
}

export function buildWorld(json) {
  const g = json.grid;
  const cell = 360 / g.W;
  const pxLon = (x) => x * cell - 180;
  const pxLat = (y) => g.latMax - y * cell;
  const pv = json.provinces;
  const P = pv.name.length;
  const S = json.seas.name.length;
  const NN = P + S;

  const lon = new Float32Array(NN);
  const lat = new Float32Array(NN);
  for (let i = 0; i < P; i++) {
    lon[i] = pxLon(pv.x[i]);
    lat[i] = pxLat(pv.y[i]);
  }
  for (let s = 0; s < S; s++) {
    lon[P + s] = pxLon(json.seas.x[s] + 0.5);
    lat[P + s] = pxLat(json.seas.y[s] + 0.5);
  }
  const kmBetween = (a, b) => {
    let dl = Math.abs(lon[a] - lon[b]);
    if (dl > 180) dl = 360 - dl;
    const dx = dl * Math.cos(((lat[a] + lat[b]) / 2) * DEG);
    return Math.hypot(dx, lat[a] - lat[b]) * 111.32;
  };

  // adjacency lists
  const lists = Array.from({ length: NN }, () => []);
  const push = (a, b, flags, border) => {
    lists[a].push([b, flags, border]);
    lists[b].push([a, flags, border]);
  };
  const la = json.adj.land;
  for (let i = 0; i < la.length; i += 4) {
    const f = la[i + 3];
    push(la[i], la[i + 1], (f & 1 ? EDGE_RIVER : 0) | (f & 2 ? EDGE_STRAIT : 0) | (f & 4 ? EDGE_BRIDGE : 0), la[i + 2]);
  }
  const co = json.adj.coast;
  for (let i = 0; i < co.length; i += 3) push(co[i], P + co[i + 1], EDGE_COAST, co[i + 2]);
  const se = json.adj.sea;
  for (let i = 0; i < se.length; i += 3) push(P + se[i], P + se[i + 1], EDGE_SEA, se[i + 2]);

  const adjStart = new Uint32Array(NN + 1);
  for (let i = 0; i < NN; i++) adjStart[i + 1] = adjStart[i] + lists[i].length;
  const E = adjStart[NN];
  const adjTo = new Uint16Array(E);
  const adjFlags = new Uint8Array(E);
  const adjKm = new Float32Array(E);
  const adjBorder = new Float32Array(E);
  for (let i = 0; i < NN; i++) {
    lists[i].sort((p, q) => p[0] - q[0]);
    let k = adjStart[i];
    for (const [b, f, border] of lists[i]) {
      adjTo[k] = b;
      adjFlags[k] = f;
      adjKm[k] = Math.max(25, kmBetween(i, b));
      adjBorder[k] = border;
      k++;
    }
  }

  const u8 = (a) => Uint8Array.from(a);
  const provinces = {
    name: pv.name,
    country: Uint16Array.from(pv.country),
    region: Uint16Array.from(pv.region),
    area: Uint16Array.from(pv.area),
    theater: u8(pv.theater),
    continent: u8(pv.continent),
    km2: Float32Array.from(pv.km2),
    terrain: u8(pv.terrain),
    pop: Float64Array.from(pv.pop),
    gdp: Float64Array.from(pv.gdp),
    x: Float32Array.from(pv.x),
    y: Float32Array.from(pv.y),
    lat: Float32Array.from(pv.lat),
    urban: u8(pv.urban),
    coastal: u8(pv.coastal),
    port: u8(pv.port),
    airbase: u8(pv.airbase),
    oil: u8(pv.oil),
    minerals: u8(pv.minerals),
    rare: u8(pv.rare),
    food: u8(pv.food),
    cities: pv.cities,
  };

  const countries = json.countries.map((c, i) => ({ ...c, id: i }));
  const provincesOf = countries.map(() => []);
  for (let p = 0; p < P; p++) provincesOf[provinces.country[p]].push(p);

  const world = {
    json,
    grid: g,
    P,
    S,
    NN,
    provinces,
    seas: json.seas,
    countries,
    provincesOf,
    regions: json.regions,
    areas: json.areas,
    theaters: json.theaters,
    continents: json.continents,
    cities: json.cities,
    crossings: json.crossings,
    lon,
    lat,
    adjStart,
    adjTo,
    adjFlags,
    adjKm,
    adjBorder,
    kmBetween,
    isSea: (n) => n >= P,
    // world-space coordinates used by the renderer (lon, Miller y)
    wx: (n) => lon[n],
    wy: (n) => millerY(lat[n]),
    pxToWorld: (x, y) => [pxLon(x), millerY(pxLat(y))],
    nameOf: (n) => (n < P ? provinces.name[n] : json.seas.name[n - P]),
    countryByKey: new Map(countries.map((c) => [c.key, c.id])),
    countryByIso: new Map(countries.map((c) => [c.iso3, c.id])),
  };
  world.neighbors = (n) => {
    const out = [];
    for (let k = adjStart[n]; k < adjStart[n + 1]; k++) out.push(adjTo[k]);
    return out;
  };
  world.edgeIndex = (a, b) => {
    for (let k = adjStart[a]; k < adjStart[a + 1]; k++) if (adjTo[k] === b) return k;
    return -1;
  };
  return world;
}
