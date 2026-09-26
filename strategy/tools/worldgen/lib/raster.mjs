// Equirectangular raster grid used by the offline world pipeline.
// Pixel (x, y): x grows east from lon -180, y grows south from LAT_MAX.
// The grid wraps horizontally (x = W-1 touches x = 0).

export const W = 8192;
export const LAT_MAX = 84;
export const LAT_MIN = -58;
export const CELL = 360 / W; // degrees per pixel
export const H = Math.round((LAT_MAX - LAT_MIN) / CELL);
export const KM_PER_DEG = 111.32;

export const lonToX = (lon) => (lon + 180) / CELL;
export const latToY = (lat) => (LAT_MAX - lat) / CELL;
export const xToLon = (x) => x * CELL - 180;
export const yToLat = (y) => LAT_MAX - y * CELL;
export const rowLat = (y) => LAT_MAX - (y + 0.5) * CELL;

// km² of one pixel on row y, and km length of horizontal/vertical pixel edges
export const ROW_KM2 = new Float64Array(H);
export const ROW_COS = new Float64Array(H);
for (let y = 0; y < H; y++) {
  const c = Math.cos((rowLat(y) * Math.PI) / 180);
  ROW_COS[y] = c;
  ROW_KM2[y] = (CELL * KM_PER_DEG) ** 2 * c;
}
export const EDGE_KM = CELL * KM_PER_DEG;

export const idx = (x, y) => y * W + x;
export const wrapX = (x) => ((x % W) + W) % W;

// pixel containing a lon/lat point, or -1 if outside the grid
export function pixelAt(lon, lat) {
  const x = Math.floor(lonToX(lon));
  const y = Math.floor(latToY(lat));
  if (y < 0 || y >= H) return -1;
  return idx(wrapX(x), y);
}

// Scanline fill of one polygon (array of rings of [lon, lat]) with the even-odd rule.
// Calls set(i) for every pixel whose centre lies inside. Returns the pixel count.
export function fillPolygon(rings, set) {
  const edges = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      const x0 = lonToX(a[0]);
      const y0 = latToY(a[1]);
      const x1 = lonToX(b[0]);
      const y1 = latToY(b[1]);
      if (y0 === y1) continue;
      const ya = Math.min(y0, y1);
      const yb = Math.max(y0, y1);
      edges.push({ ya, yb, x0, y0, k: (x1 - x0) / (y1 - y0) });
      if (ya < minY) minY = ya;
      if (yb > maxY) maxY = yb;
    }
  }
  if (!edges.length) return 0;
  edges.sort((p, q) => p.ya - q.ya);
  const rowStart = Math.max(0, Math.floor(minY - 0.5));
  const rowEnd = Math.min(H - 1, Math.ceil(maxY));
  let next = 0;
  let active = [];
  const xs = [];
  let count = 0;
  for (let y = rowStart; y <= rowEnd; y++) {
    const yc = y + 0.5;
    while (next < edges.length && edges[next].ya <= yc) active.push(edges[next++]);
    active = active.filter((e) => e.yb > yc);
    if (!active.length) continue;
    xs.length = 0;
    for (const e of active) if (e.ya <= yc) xs.push(e.x0 + (yc - e.y0) * e.k);
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.ceil(xs[i] - 0.5);
      const xb = Math.ceil(xs[i + 1] - 0.5) - 1;
      for (let x = xa; x <= xb; x++) {
        set(idx(wrapX(x), y));
        count++;
      }
    }
  }
  return count;
}

export function geometryPolygons(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

export function geometryLines(geom) {
  if (!geom) return [];
  if (geom.type === 'LineString') return [geom.coordinates];
  if (geom.type === 'MultiLineString') return geom.coordinates;
  return [];
}

// DDA line rasterization in pixel space
export function drawLine(coords, set) {
  for (let i = 0; i + 1 < coords.length; i++) {
    let x0 = lonToX(coords[i][0]);
    const y0 = latToY(coords[i][1]);
    let x1 = lonToX(coords[i + 1][0]);
    const y1 = latToY(coords[i + 1][1]);
    if (Math.abs(x1 - x0) > W / 2) continue; // antimeridian jump
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.floor(x0 + (x1 - x0) * t);
      const y = Math.floor(y0 + (y1 - y0) * t);
      if (y >= 0 && y < H) set(idx(wrapX(x), y));
    }
  }
}

// Mean lon/lat of a polygon's outer ring vertices (good enough for fallback seeding)
export function roughCentroid(polys) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const p of polys) {
    for (const pt of p[0]) {
      sx += pt[0];
      sy += pt[1];
      n++;
    }
  }
  return n ? [sx / n, sy / n] : null;
}

// Seeded PRNG (mulberry32) for reproducible pipeline output
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
