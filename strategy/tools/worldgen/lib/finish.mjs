// Second half of the world pipeline: adjacency, attributes, tracing, encoding, output.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import * as R from './raster.mjs';
import * as P from './partition.mjs';
import * as O from '../overrides/data.mjs';
import { traceArcs } from './trace.mjs';
import { smoothArc, encodeArcs } from './geom.mjs';
import { attributes } from './attributes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = join(here, '..', '.cache');
const OUT = join(here, '..', '..', '..', 'data', 'world');
const { W, H } = R;
const N = W * H;

export async function finish(ctx) {
  const { log, L, PC, SC, LAKE } = ctx;
  const load = (n) => JSON.parse(readFileSync(join(CACHE, `${n}.geojson`), 'utf8')).features;

  // ------------------------------------------------------------ rivers mask
  const river = new Uint8Array(N);
  for (const f of load('ne_50m_rivers_lake_centerlines')) {
    if ((f.properties.scalerank ?? 9) > 7) continue;
    for (const line of R.geometryLines(f.geometry)) R.drawLine(line, (q) => (river[q] = 1));
  }

  // ------------------------------------------------------------ adjacency from pixel contacts
  const pairLen = new Map();
  const pairRiver = new Map();
  const add = (a, b, km, riv) => {
    if (a === b || a === LAKE || b === LAKE) return;
    const k = a < b ? a * 8192 + b : b * 8192 + a;
    pairLen.set(k, (pairLen.get(k) || 0) + km);
    if (riv) pairRiver.set(k, (pairRiver.get(k) || 0) + km);
  };
  for (let y = 0; y < H; y++) {
    const hk = R.EDGE_KM; // vertical boundary between horizontal neighbours
    const vk = R.EDGE_KM * Math.cos(((R.yToLat(y + 1) * Math.PI) / 180)); // horizontal boundary below the row
    for (let x = 0; x < W; x++) {
      const q = y * W + x;
      const a = L[q];
      const r = y * W + ((x + 1) % W);
      if (L[r] !== a) add(a, L[r], hk, river[q] || river[r]);
      if (y + 1 < H) {
        const d = q + W;
        if (L[d] !== a) add(a, L[d], vk, river[q] || river[d]);
      }
    }
  }
  const landAdj = [];
  const coastAdj = [];
  const seaAdj = [];
  for (const [k, len] of pairLen) {
    const a = Math.floor(k / 8192);
    const b = k % 8192;
    const km = Math.round(len);
    if (a < PC && b < PC) {
      const riv = (pairRiver.get(k) || 0) / len > 0.35 && len > 25 ? 1 : 0;
      landAdj.push([a, b, Math.max(1, km), riv]);
    } else if (a < PC || b < PC) coastAdj.push([Math.min(a, b), Math.max(a, b) - PC, Math.max(1, km)]);
    else seaAdj.push([a - PC, b - PC, Math.max(1, km)]);
  }
  // curated crossings
  const provAt = (lon, lat, wantLand) => {
    const q = R.pixelAt(lon, lat);
    if (q < 0) return -1;
    const x0 = q % W;
    const y0 = (q / W) | 0;
    let best = -1;
    let bd = Infinity;
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const y = y0 + dy;
        if (y < 0 || y >= H) continue;
        const v = L[R.idx(R.wrapX(x0 + dx), y)];
        const ok = wantLand ? v < PC : v >= PC && v < LAKE;
        const d = dx * dx + dy * dy;
        if (ok && d < bd) {
          bd = d;
          best = v;
        }
      }
    }
    return best;
  };
  const landKey = new Set(landAdj.map(([a, b]) => `${a},${b}`));
  const crossings = [];
  for (const c of O.LAND_CROSSINGS) {
    const a = provAt(c.a[0], c.a[1], true);
    const b = provAt(c.b[0], c.b[1], true);
    if (a < 0 || b < 0 || a === b) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    crossings.push({ name: c.name, a: lo, b: hi, kind: c.kind });
    const key = `${lo},${hi}`;
    const flag = c.kind === 'strait' ? 2 : 4;
    const existing = landAdj.find((e) => e[0] === lo && e[1] === hi);
    if (existing) existing[3] |= flag;
    else if (!landKey.has(key)) {
      landAdj.push([lo, hi, 20, flag]);
      landKey.add(key);
    }
  }
  const seaKey = new Set(seaAdj.map(([a, b]) => `${a},${b}`));
  for (const c of O.SEA_LINKS) {
    const a = provAt(c.a[0], c.a[1], false);
    const b = provAt(c.b[0], c.b[1], false);
    if (a < 0 || b < 0 || a === b) continue;
    const lo = Math.min(a, b) - PC;
    const hi = Math.max(a, b) - PC;
    if (!seaKey.has(`${lo},${hi}`)) {
      seaAdj.push([lo, hi, 20]);
      seaKey.add(`${lo},${hi}`);
      crossings.push({ name: c.name, a: lo, b: hi, kind: 'sea' });
    }
  }
  log('adjacency: land', landAdj.length, 'coast', coastAdj.length, 'sea', seaAdj.length, 'crossings', crossings.length);

  // ------------------------------------------------------------ label points (pole of inaccessibility on the raster)
  const land = [];
  for (let q = 0; q < N; q++) if (L[q] < PC) land.push(q);
  const landPx = Int32Array.from(land);
  land.length = 0;
  const lst = P.newStamp();
  P.markSet(landPx, lst);
  const edge = [];
  for (let i = 0; i < landPx.length; i++) {
    const q = landPx[i];
    const x = q % W;
    const y = (q / W) | 0;
    const a = L[q];
    const nb = [y > 0 ? q - W : -1, y < H - 1 ? q + W : -1, x > 0 ? q - 1 : q + W - 1, x < W - 1 ? q + 1 : q - W + 1];
    if (nb.some((r) => r < 0 || L[r] !== a)) edge.push(q);
  }
  P.geoVoronoi(landPx, edge, lst);
  const labelQ = new Int32Array(PC).fill(-1);
  const labelD = new Int32Array(PC).fill(-1);
  for (let i = 0; i < landPx.length; i++) {
    const q = landPx[i];
    const a = L[q];
    // dist measured to the nearest boundary pixel of *any* province; restrict to own province pixels
    if (P.dist[q] > labelD[a]) {
      labelD[a] = P.dist[q];
      labelQ[a] = q;
    }
  }
  log('label points');

  const attr = attributes({ ...ctx, landPx, labelQ, landAdj, coastAdj, seaAdj, load });
  log('attributes');

  // ------------------------------------------------------------ trace arcs and rings
  const traced = traceArcs(L, LAKE + 1);
  log('traced', traced.arcs.length, 'arcs');
  const lod0 = [];
  const lod1 = [];
  let v0 = 0;
  let v1 = 0;
  for (const raw of traced.arcs) {
    const n = raw.length / 2;
    const loop = n > 2 && raw[0] === raw[(n - 1) * 2] && raw[1] === raw[(n - 1) * 2 + 1];
    const a = smoothArc(raw, 0.3, loop);
    const b = smoothArc(raw, 1.8, loop);
    lod1.push(a);
    lod0.push(b);
    v1 += a.length / 2;
    v0 += b.length / 2;
  }
  const blob0 = encodeArcs(lod0, 8);
  const blob1 = encodeArcs(lod1, 8);
  log('arcs smoothed: lod0', v0, 'pts', (blob0.length / 1024).toFixed(0), 'KB; lod1', v1, 'pts', (blob1.length / 1024).toFixed(0), 'KB');

  // ------------------------------------------------------------ write package
  mkdirSync(OUT, { recursive: true });
  const header = new Uint8Array(12);
  const dv = new DataView(header.buffer);
  header.set([0x47, 0x43, 0x57, 0x31]); // "GCW1"
  dv.setUint32(4, blob0.length, true);
  dv.setUint32(8, blob1.length, true);
  const bin = new Uint8Array(12 + blob0.length + blob1.length);
  bin.set(header, 0);
  bin.set(blob0, 12);
  bin.set(blob1, 12 + blob0.length);
  writeFileSync(join(OUT, 'geometry.bin'), bin);

  const world = {
    format: 1,
    grid: { W, H, latMax: R.LAT_MAX, latMin: R.LAT_MIN, q: 8 },
    ...attr.json,
    crossings,
    adj: { land: landAdj.flat(), coast: coastAdj.flat(), sea: seaAdj.flat() },
    arcs: { a: traced.arcPair.map((p) => p[0]), b: traced.arcPair.map((p) => p[1]) },
    rings: {
      land: traced.rings.slice(0, PC),
      sea: traced.rings.slice(PC, PC + SC),
      lake: traced.rings[LAKE],
    },
  };
  const txt = JSON.stringify(world);
  writeFileSync(join(OUT, 'world.json'), txt);
  log('wrote world.json', (txt.length / 1024).toFixed(0), 'KB, geometry.bin', (bin.length / 1024).toFixed(0), 'KB');

  writePreview(L, PC, LAKE, attr.provinceColor, join(CACHE, 'preview.png'));
  log('preview written');
  report(world, attr, log);
}

function report(world, attr, log) {
  const p = world.provinces;
  const n = p.name.length;
  const byTerrain = {};
  for (let i = 0; i < n; i++) byTerrain[world.terrains[p.terrain[i]]] = (byTerrain[world.terrains[p.terrain[i]]] || 0) + 1;
  log('provinces', n, 'seas', world.seas.name.length, 'countries', world.countries.length, 'regions', world.regions.length, 'areas', world.areas.length);
  log('terrain mix', JSON.stringify(byTerrain));
  const top = world.countries.map((c, i) => [c.name, c.provinces]).sort((a, b) => b[1] - a[1]).slice(0, 12);
  log('largest', JSON.stringify(top));
  void attr;
}

// Downscaled PNG preview for eyeballing the partition.
function writePreview(L, PC, LAKE, colorOf, file) {
  const s = 4;
  const w = W / s;
  const h = Math.floor(H / s);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const q = y * s * W + x * s;
      const v = L[q];
      let r;
      let g;
      let b;
      const border = L[q + 1] !== v || (y * s + 1 < H && L[q + W] !== v) || L[q + 2] !== v;
      if (v < PC) [r, g, b] = colorOf(v);
      else if (v === LAKE) [r, g, b] = [120, 160, 200];
      else [r, g, b] = [34, 52, 74];
      if (border) {
        r *= 0.55;
        g *= 0.55;
        b *= 0.55;
      }
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const chunks = [];
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    chunks.push(len, td, c);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  chunk('IHDR', ihdr);
  chunk('IDAT', deflateSync(raw));
  chunk('IEND', Buffer.alloc(0));
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]));
}
