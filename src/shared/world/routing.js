// Road and railway routing over a coarse cost grid (A*), so routes follow
// valleys, bend around lakes and hills, merge into existing roads and bridge
// rivers instead of cutting through everything in a straight line.
import { WORLD_HALF, SEA_LEVEL } from '../constants.js';
import { clamp, lerp } from '../math.js';

const CELL = 32;

class Heap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

export class RouteGrid {
  constructor(terrain) {
    this.terrain = terrain;
    this.n = Math.round((WORLD_HALF * 2) / CELL) + 1;
    const N = this.n * this.n;
    this.h = new Float32Array(N);
    this.water = new Uint8Array(N); // 0 land, 1 river, 2 lake/sea
    this.slope = new Float32Array(N);
    this.road = new Uint8Array(N); // existing road/rail presence
    this.blocked = new Uint8Array(N); // settlements & bases routes should skirt
    const t = terrain;
    const n = this.n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -WORLD_HALF + i * CELL;
        const z = -WORLD_HALF + j * CELL;
        const k = j * n + i;
        const h = t.heightAt(x, z);
        this.h[k] = h;
        if (t.riverDistAt(x, z) < 2) this.water[k] = 1;
        else if (h < SEA_LEVEL + 0.4) this.water[k] = 2;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const hl = this.h[j * n + Math.max(0, i - 1)];
        const hr = this.h[j * n + Math.min(n - 1, i + 1)];
        const hu = this.h[Math.max(0, j - 1) * n + i];
        const hd = this.h[Math.min(n - 1, j + 1) * n + i];
        this.slope[k] = Math.max(Math.abs(hr - hl), Math.abs(hd - hu)) / (2 * CELL);
      }
    }
  }

  idx(x, z) {
    const i = clamp(Math.round((x + WORLD_HALF) / CELL), 0, this.n - 1);
    const j = clamp(Math.round((z + WORLD_HALF) / CELL), 0, this.n - 1);
    return j * this.n + i;
  }

  center(k) {
    return { x: -WORLD_HALF + (k % this.n) * CELL, z: -WORLD_HALF + Math.floor(k / this.n) * CELL };
  }

  // Mark cells near a polyline as having a road (routes prefer to join them).
  markRoute(samples, v = 1) {
    for (let i = 0; i < samples.length; i += 4) this.road[this.idx(samples[i].x, samples[i].z)] = v;
  }

  cellCost(k, rail) {
    const w = this.water[k];
    if (w === 2) return 4000;
    let c = 1;
    const s = this.slope[k];
    c += rail ? s * s * 900 + s * 40 : s * s * 260 + s * 12;
    if (w === 1) c += rail ? 45 : 28; // a bridge is expensive, so rivers get crossed once
    if (this.h[k] > 90) c += (this.h[k] - 90) * (rail ? 0.25 : 0.08);
    if (this.blocked[k]) c += 25;
    if (this.road[k]) c *= rail ? (this.road[k] === 2 ? 0.45 : 0.9) : 0.42;
    return c;
  }

  // A* between two world points. Returns an array of {x,z} coarse points.
  route(ax, az, bx, bz, rail = false) {
    const n = this.n;
    const s = this.idx(ax, az);
    const g = this.idx(bx, bz);
    const N = n * n;
    const gScore = new Float32Array(N).fill(Infinity);
    const parent = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new Heap();
    const gi = g % n;
    const gj = Math.floor(g / n);
    const h = (k) => {
      const di = Math.abs((k % n) - gi);
      const dj = Math.abs(Math.floor(k / n) - gj);
      return (Math.max(di, dj) + 0.414 * Math.min(di, dj)) * 0.95;
    };
    gScore[s] = 0;
    heap.push(h(s), s);
    let found = false;
    while (heap.size) {
      const k = heap.pop();
      if (closed[k]) continue;
      closed[k] = 1;
      if (k === g) {
        found = true;
        break;
      }
      const i = k % n;
      const j = Math.floor(k / n);
      const ck = this.cellCost(k, rail);
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= n) continue;
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ii = i + di;
          if (ii < 0 || ii >= n) continue;
          const nk = jj * n + ii;
          if (closed[nk]) continue;
          const len = di && dj ? 1.414 : 1;
          const ng = gScore[k] + len * (ck + this.cellCost(nk, rail)) * 0.5;
          if (ng < gScore[nk]) {
            gScore[nk] = ng;
            parent[nk] = k;
            heap.push(ng + h(nk), nk);
          }
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = g; k >= 0; k = parent[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => this.center(k));
    pts[0] = { x: ax, z: az };
    pts[pts.length - 1] = { x: bx, z: bz };
    return pts;
  }
}

// Chaikin smoothing + resampling every `step` metres.
export function smoothPath(pts, iterations = 3, step = 3) {
  let p = pts;
  for (let it = 0; it < iterations; it++) {
    if (p.length < 3) break;
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  // resample
  const res = [{ x: p[0].x, z: p[0].z }];
  let carry = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i];
    const b = p[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let d = step - carry;
    while (d <= len) {
      const t = d / len;
      res.push({ x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) });
      d += step;
    }
    carry = len - (d - step);
  }
  const last = p[p.length - 1];
  if (Math.hypot(res[res.length - 1].x - last.x, res[res.length - 1].z - last.z) > 0.5) res.push({ x: last.x, z: last.z });
  return res;
}

// Heights (with bridge spans over rivers) for a road or railway.
export function profileRoute(terrain, route) {
  const pts = route.samples;
  const raw = pts.map((p) => terrain.heightAt(p.x, p.z));
  for (let i = 0; i < pts.length; i++) {
    const rd = terrain.riverDistAt(pts[i].x, pts[i].z);
    pts[i].bridge = (raw[i] < 1.8 && rd < 12) || (raw[i] < SEA_LEVEL + 0.3 && !route.noBridges);
  }
  const W = route.rail ? 22 : 7;
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
    sm[i] = Math.max(c ? s / c : raw[i], 1.7);
  }
  // endpoints keep the ground height (they sit on pads)
  for (let i = 0; i < pts.length; i++) pts[i].h = sm[i];
  route.bridges = [];
  const orig = pts.map((p) => p.bridge);
  let i = 0;
  while (i < pts.length) {
    if (!orig[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < pts.length && orig[j + 1]) j++;
    const prev = route.bridges[route.bridges.length - 1];
    let s0 = Math.max(0, i - 3);
    const s1 = Math.min(pts.length - 1, j + 3);
    if (prev && s0 - prev.to < 10) {
      s0 = prev.from;
      route.bridges.pop();
    }
    const deck = Math.max(pts[s0].h, pts[s1].h, 2.6) + (route.rail ? 1.2 : 0.9);
    for (let k = s0; k <= s1; k++) {
      pts[k].h = deck;
      pts[k].bridge = true;
    }
    const RAMP = route.rail ? 18 : 9;
    for (let k = 1; k <= RAMP; k++) {
      const t = k / (RAMP + 1);
      if (s0 - k >= 0 && !pts[s0 - k].bridge) pts[s0 - k].h = lerp(deck, pts[s0 - k].h, t);
      if (s1 + k < pts.length && !pts[s1 + k].bridge) pts[s1 + k].h = lerp(deck, pts[s1 + k].h, t);
    }
    route.bridges.push({ from: s0, to: s1, deck });
    i = j + 1;
  }
  // cumulative distance (used by trains and convoys)
  let acc = 0;
  pts[0].d = 0;
  for (let k = 1; k < pts.length; k++) {
    acc += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z);
    pts[k].d = acc;
  }
  route.length = acc;
}

// Position + heading along a profiled route at distance d (metres).
export function pointAlong(route, d) {
  const pts = route.samples;
  d = clamp(d, 0, route.length);
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].d <= d) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  const span = b.d - a.d || 1;
  const t = (d - a.d) / span;
  return { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), h: lerp(a.h, b.h, t), yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)), bridge: a.bridge || b.bridge };
}
