// Pixel-set partitioning: connected components, geodesic Voronoi (Dial's algorithm)
// and Lloyd relaxation. Used to split large admin units into provinces and the
// ocean into sea zones. All work is done on flat typed arrays over the raster.
import { W, H, ROW_COS } from './raster.mjs';

const N = W * H;
export const memb = new Int32Array(N); // membership stamp: memb[p] === stamp means p is in the current set
export const dist = new Int32Array(N);
export const own = new Int32Array(N);
let stampCounter = 1;

export function newStamp() {
  return ++stampCounter;
}

export function markSet(pixels, stamp) {
  for (let i = 0; i < pixels.length; i++) memb[pixels[i]] = stamp;
}

// 8-neighbourhood step costs per row (x steps shrink with latitude)
const HC = new Int32Array(H);
const DC = new Int32Array(H);
for (let y = 0; y < H; y++) {
  HC[y] = Math.max(1, Math.round(10 * ROW_COS[y]));
  DC[y] = Math.round(Math.sqrt(HC[y] * HC[y] + 100));
}
const C = 16; // circular bucket count (> max step cost)

// 4-connected components of a stamped pixel set; returns arrays of pixel indices
export function components(pixels, stamp) {
  const seen = newStamp();
  const out = [];
  const stack = [];
  for (let i = 0; i < pixels.length; i++) {
    const s = pixels[i];
    if (memb[s] !== stamp) continue;
    memb[s] = seen;
    const comp = [];
    stack.push(s);
    while (stack.length) {
      const p = stack.pop();
      comp.push(p);
      const x = p % W;
      const y = (p - x) / W;
      const nb = [y > 0 ? p - W : -1, y < H - 1 ? p + W : -1, x > 0 ? p - 1 : p + W - 1, x < W - 1 ? p + 1 : p - W + 1];
      for (const q of nb) {
        if (q >= 0 && memb[q] === stamp) {
          memb[q] = seen;
          stack.push(q);
        }
      }
    }
    out.push(Int32Array.from(comp));
  }
  // restore membership for callers
  for (const c of out) for (let i = 0; i < c.length; i++) memb[c[i]] = stamp;
  return out;
}

// Assign every pixel of the stamped set to the geodesically nearest seed.
// Writes owner index into own[]; returns the number of unreached pixels.
export function geoVoronoi(pixels, seeds, stamp) {
  const INF = 0x3fffffff;
  for (let i = 0; i < pixels.length; i++) {
    dist[pixels[i]] = INF;
    own[pixels[i]] = -1;
  }
  const B = Array.from({ length: C }, () => []);
  let pending = 0;
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    if (memb[s] !== stamp) continue;
    dist[s] = 0;
    own[s] = i;
    B[0].push(s);
    pending++;
  }
  let d = 0;
  while (pending > 0) {
    const b = B[d % C];
    while (b.length) {
      const p = b.pop();
      pending--;
      if (dist[p] !== d) continue;
      const o = own[p];
      const x = p % W;
      const y = (p - x) / W;
      const xl = x > 0 ? -1 : W - 1;
      const xr = x < W - 1 ? 1 : -(W - 1);
      const hc = HC[y];
      // same row
      relax(p + xl, d + hc, o);
      relax(p + xr, d + hc, o);
      if (y > 0) {
        const r = p - W;
        const dc = DC[y - 1];
        relax(r, d + 10, o);
        relax(r + xl, d + dc, o);
        relax(r + xr, d + dc, o);
      }
      if (y < H - 1) {
        const r = p + W;
        const dc = DC[y + 1];
        relax(r, d + 10, o);
        relax(r + xl, d + dc, o);
        relax(r + xr, d + dc, o);
      }
    }
    d++;
    if (d > INF - 100) break;
  }
  function relax(q, nd, o) {
    if (memb[q] !== stamp || nd >= dist[q]) return;
    dist[q] = nd;
    own[q] = o;
    B[nd % C].push(q);
    pending++;
  }
  let unreached = 0;
  for (let i = 0; i < pixels.length; i++) if (own[pixels[i]] < 0) unreached++;
  return unreached;
}

// wrapped x difference a-b in pixels, in [-W/2, W/2)
export function dxWrap(a, b) {
  let d = a - b;
  if (d >= W / 2) d -= W;
  else if (d < -W / 2) d += W;
  return d;
}

// Lloyd relaxation: move each seed to the region pixel closest to its mass-weighted centroid
export function lloydStep(pixels, seeds, mass) {
  const k = seeds.length;
  const sx = new Float64Array(k);
  const sy = new Float64Array(k);
  const sw = new Float64Array(k);
  const seedX = seeds.map((s) => s % W);
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    const o = own[p];
    if (o < 0) continue;
    const x = p % W;
    const y = (p - x) / W;
    const m = mass(p);
    sx[o] += dxWrap(x, seedX[o]) * m;
    sy[o] += y * m;
    sw[o] += m;
  }
  const best = new Float64Array(k).fill(Infinity);
  const next = seeds.slice();
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    const o = own[p];
    if (o < 0 || sw[o] <= 0) continue;
    const x = p % W;
    const y = (p - x) / W;
    const cx = sx[o] / sw[o];
    const cy = sy[o] / sw[o];
    const dx = (dxWrap(x, seedX[o]) - cx) * ROW_COS[y];
    const dy = y - cy;
    const dd = dx * dx + dy * dy;
    if (dd < best[o]) {
      best[o] = dd;
      next[o] = p;
    }
  }
  return next;
}

// Choose k seeds inside a component: big cities first, then D²-weighted sampling.
export function chooseSeeds(pixels, k, cityPixels, rand) {
  const seeds = [];
  const pts = (p) => {
    const x = p % W;
    return [x, (p - x) / W];
  };
  const d2 = (p, q) => {
    const [x1, y1] = pts(p);
    const [x2, y2] = pts(q);
    const c = ROW_COS[Math.min(H - 1, Math.round((y1 + y2) / 2))];
    const dx = dxWrap(x1, x2) * c;
    const dy = y1 - y2;
    return dx * dx + dy * dy;
  };
  // approximate area in "pixel² at local cos" for spacing
  const spacing2 = (pixels.length / k) * 0.45;
  for (const cp of cityPixels) {
    if (seeds.length >= k) break;
    if (seeds.every((s) => d2(s, cp) > spacing2)) seeds.push(cp);
  }
  const sample = [];
  const M = Math.min(pixels.length, 3000);
  for (let i = 0; i < M; i++) sample.push(pixels[Math.floor(rand() * pixels.length)]);
  if (!seeds.length) seeds.push(sample[0]);
  while (seeds.length < k) {
    let total = 0;
    const w = sample.map((p) => {
      let m = Infinity;
      for (const s of seeds) m = Math.min(m, d2(p, s));
      total += m;
      return m;
    });
    if (total <= 0) break;
    let r = rand() * total;
    let pick = sample[sample.length - 1];
    for (let i = 0; i < sample.length; i++) {
      r -= w[i];
      if (r <= 0) {
        pick = sample[i];
        break;
      }
    }
    seeds.push(pick);
  }
  return seeds;
}
