// Navigation for AI soldiers on a 6 km world.
//  - coarse grid (8 m) over the whole continent for long routes
//  - fine grid (2 m) built lazily in 128 m tiles where soldiers actually are
//    (LRU cached), searched inside a sliding window around start and goal
// A full 2 m grid for the whole map would need ~170 MB; this needs a few MB.
import { WORLD_HALF, SEA_LEVEL, BODY } from '../constants.js';
import { BF } from './builder.js';

const BLOCKED = 0;
const OPEN = 1;
const ROAD = 2;
const ROUGH = 3; // shallow water / steep: allowed but expensive

const FINE = 2;
const TILE = 64; // fine cells per tile side (128 m)
const WIN = 200; // fine search window (cells) = 400 m
const COARSE = 8;
const MAX_TILES = 700;

class MinHeap {
  constructor(cap) {
    this.keys = new Float32Array(cap);
    this.vals = new Int32Array(cap);
    this.size = 0;
  }
  clear() {
    this.size = 0;
  }
  push(k, v) {
    if (this.size >= this.keys.length) {
      const nk = new Float32Array(this.keys.length * 2);
      nk.set(this.keys);
      const nv = new Int32Array(this.vals.length * 2);
      nv.set(this.vals);
      this.keys = nk;
      this.vals = nv;
    }
    let i = this.size++;
    const keys = this.keys;
    const vals = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = k;
    vals[i] = v;
  }
  pop() {
    const keys = this.keys;
    const vals = this.vals;
    const top = vals[0];
    const n = --this.size;
    if (n <= 0) return top;
    const k = keys[n];
    const v = vals[n];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= n) break;
      if (c + 1 < n && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= k) break;
      keys[i] = keys[c];
      vals[i] = vals[c];
      i = c;
    }
    keys[i] = k;
    vals[i] = v;
    return top;
  }
}

// A* over a rectangular window of cells supplied by a getter.
class Search {
  constructor(cap) {
    this.g = new Float32Array(cap);
    this.parent = new Int32Array(cap);
    this.visit = new Uint32Array(cap);
    this.closed = new Uint32Array(cap);
    this.cells = new Uint8Array(cap);
    this.gen = 1;
    this.heap = new MinHeap(4096);
  }
  run(w, h, cells, sk, gk, maxNodes) {
    this.gen++;
    if (this.gen > 0xfffffff0) {
      this.visit.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    const heap = this.heap;
    heap.clear();
    const gi = gk % w;
    const gj = (gk / w) | 0;
    const hf = (k) => {
      const di = Math.abs((k % w) - gi);
      const dj = Math.abs(((k / w) | 0) - gj);
      return (Math.max(di, dj) + 0.414 * Math.min(di, dj)) * 1.15;
    };
    const cost = (c) => (c === ROAD ? 0.8 : c === ROUGH ? 3 : 1);
    this.g[sk] = 0;
    this.visit[sk] = gen;
    this.parent[sk] = -1;
    heap.push(hf(sk), sk);
    let expanded = 0;
    let bestK = sk;
    let bestH = hf(sk);
    while (heap.size > 0) {
      const k = heap.pop();
      if (this.closed[k] === gen) continue;
      this.closed[k] = gen;
      if (k === gk) return this.trace(k, false);
      const hk = hf(k);
      if (hk < bestH) {
        bestH = hk;
        bestK = k;
      }
      if (++expanded > maxNodes) break;
      const i = k % w;
      const j = (k / w) | 0;
      const g0 = this.g[k];
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= h) continue;
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ii = i + di;
          if (ii < 0 || ii >= w) continue;
          const nk = jj * w + ii;
          const c = cells[nk];
          if (c === BLOCKED || this.closed[nk] === gen) continue;
          if (di && dj && (cells[j * w + ii] === BLOCKED || cells[jj * w + i] === BLOCKED)) continue;
          const ng = g0 + (di && dj ? 1.414 : 1) * cost(c);
          if (this.visit[nk] === gen && this.g[nk] <= ng) continue;
          this.visit[nk] = gen;
          this.g[nk] = ng;
          this.parent[nk] = k;
          heap.push(ng + hf(nk), nk);
        }
      }
    }
    return bestK !== sk ? this.trace(bestK, true) : null;
  }
  trace(k, partial) {
    const out = [];
    let guard = 0;
    while (k >= 0 && guard++ < 200000) {
      out.push(k);
      k = this.parent[k];
    }
    out.reverse();
    out.partial = partial;
    return out;
  }
}

export class NavGrid {
  constructor(terrain, colliders) {
    this.terrain = terrain;
    this.colliders = colliders;
    this.fn = Math.ceil((WORLD_HALF * 2) / FINE); // fine cells per side
    this.tilesPerSide = Math.ceil(this.fn / TILE);
    this.tiles = new Map(); // tile index -> Uint8Array
    this.cn = Math.ceil((WORLD_HALF * 2) / COARSE);
    this.coarse = new Uint8Array(this.cn * this.cn);
    this.fineSearch = new Search(WIN * WIN);
    this.coarseSearch = new Search(this.cn * this.cn);
    this.winCells = new Uint8Array(WIN * WIN);
    this.tilesBuilt = 0;
    this.lastKey = -1;
    this.lastTile = null;
    this.buildCoarse();
  }

  // ------------------------------------------------------------ building
  classify(x, z) {
    const t = this.terrain;
    const h = t.heightAt(x, z);
    const depth = SEA_LEVEL - h;
    if (depth > 1.1) return BLOCKED;
    const e = 1.5;
    const slope = Math.max(Math.abs(t.heightAt(x + e, z) - t.heightAt(x - e, z)), Math.abs(t.heightAt(x, z + e) - t.heightAt(x, z - e))) / (2 * e);
    if (slope > 1.15) return BLOCKED;
    if (depth > 0.3 || slope > 0.75) return ROUGH;
    return t.isRoad(x, z) ? ROAD : OPEN;
  }

  buildCoarse() {
    const n = this.cn;
    const c = this.colliders;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -WORLD_HALF + (i + 0.5) * COARSE;
        const z = -WORLD_HALF + (j + 0.5) * COARSE;
        this.coarse[j * n + i] = this.classify(x, z);
      }
    }
    // large solid obstacles (buildings, walls) block coarse cells they mostly cover
    const cover = new Float32Array(n * n);
    for (let b = 0; b < c.count; b++) {
      if (c.flags[b] & BF.WALKSURF) continue;
      const w = c.x1[b] - c.x0[b];
      const d = c.z1[b] - c.z0[b];
      if (w * d < 6) continue; // trees, posts
      const ground = this.terrain.heightAt((c.x0[b] + c.x1[b]) / 2, (c.z0[b] + c.z1[b]) / 2);
      if (c.y1[b] - ground <= BODY.stepHeight || c.y0[b] - ground >= 1.9) continue;
      const i0 = Math.max(0, Math.floor((c.x0[b] + WORLD_HALF) / COARSE));
      const i1 = Math.min(n - 1, Math.floor((c.x1[b] + WORLD_HALF) / COARSE));
      const j0 = Math.max(0, Math.floor((c.z0[b] + WORLD_HALF) / COARSE));
      const j1 = Math.min(n - 1, Math.floor((c.z1[b] + WORLD_HALF) / COARSE));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const cx0 = -WORLD_HALF + i * COARSE;
          const cz0 = -WORLD_HALF + j * COARSE;
          const ox = Math.max(0, Math.min(c.x1[b], cx0 + COARSE) - Math.max(c.x0[b], cx0));
          const oz = Math.max(0, Math.min(c.z1[b], cz0 + COARSE) - Math.max(c.z0[b], cz0));
          cover[j * n + i] += (ox * oz) / (COARSE * COARSE);
        }
      }
    }
    for (let k = 0; k < n * n; k++) if (cover[k] > 0.6) this.coarse[k] = BLOCKED;
  }

  buildTile(ti, tj) {
    const cells = new Uint8Array(TILE * TILE);
    const x0 = -WORLD_HALF + ti * TILE * FINE;
    const z0 = -WORLD_HALF + tj * TILE * FINE;
    for (let j = 0; j < TILE; j++) {
      for (let i = 0; i < TILE; i++) cells[j * TILE + i] = this.classify(x0 + (i + 0.5) * FINE, z0 + (j + 0.5) * FINE);
    }
    const c = this.colliders;
    const pad = 0.35;
    const surf = [];
    c.forEachInRect(x0 - 1, z0 - 1, x0 + TILE * FINE + 1, z0 + TILE * FINE + 1, (b) => {
      if (c.flags[b] & BF.WALKSURF) {
        surf.push(b);
        return;
      }
      const cx = (c.x0[b] + c.x1[b]) / 2;
      const cz = (c.z0[b] + c.z1[b]) / 2;
      const ground = Math.min(this.terrain.heightAt(c.x0[b], c.z0[b]), this.terrain.heightAt(c.x1[b], c.z1[b]), this.terrain.heightAt(cx, cz));
      if (c.y1[b] - ground <= BODY.stepHeight) return;
      if (c.y0[b] - ground >= 1.9) return;
      const i0 = Math.max(0, Math.floor((c.x0[b] - pad - x0) / FINE));
      const i1 = Math.min(TILE - 1, Math.floor((c.x1[b] + pad - x0) / FINE));
      const j0 = Math.max(0, Math.floor((c.z0[b] - pad - z0) / FINE));
      const j1 = Math.min(TILE - 1, Math.floor((c.z1[b] + pad - z0) / FINE));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = x0 + (i + 0.5) * FINE;
          const z = z0 + (j + 0.5) * FINE;
          if (x < c.x0[b] - pad || x > c.x1[b] + pad || z < c.z0[b] - pad || z > c.z1[b] + pad) continue;
          cells[j * TILE + i] = BLOCKED;
        }
      }
    });
    for (const b of surf) {
      const i0 = Math.max(0, Math.floor((c.x0[b] - x0) / FINE));
      const i1 = Math.min(TILE - 1, Math.floor((c.x1[b] - x0) / FINE));
      const j0 = Math.max(0, Math.floor((c.z0[b] - z0) / FINE));
      const j1 = Math.min(TILE - 1, Math.floor((c.z1[b] - z0) / FINE));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * TILE + i] = ROAD;
    }
    this.tilesBuilt++;
    return cells;
  }

  tile(ti, tj) {
    const key = tj * this.tilesPerSide + ti;
    if (key === this.lastKey) return this.lastTile;
    let t = this.tiles.get(key);
    if (t) {
      // refresh LRU order
      this.tiles.delete(key);
      this.tiles.set(key, t);
    } else {
      t = this.buildTile(ti, tj);
      this.tiles.set(key, t);
      if (this.tiles.size > MAX_TILES) {
        const old = this.tiles.keys().next().value;
        this.tiles.delete(old);
      }
    }
    this.lastKey = key;
    this.lastTile = t;
    return t;
  }

  // Fine cell value at fine grid coordinates.
  fineCell(i, j) {
    if (i < 0 || j < 0 || i >= this.fn || j >= this.fn) return BLOCKED;
    const t = this.tile((i / TILE) | 0, (j / TILE) | 0);
    return t[(j % TILE) * TILE + (i % TILE)];
  }

  // Copy a W x H block of fine cells starting at (i0, j0) into out (row stride W).
  fillWindow(out, i0, j0, W, H) {
    for (let tj = Math.floor(j0 / TILE); tj <= Math.floor((j0 + H - 1) / TILE); tj++) {
      for (let ti = Math.floor(i0 / TILE); ti <= Math.floor((i0 + W - 1) / TILE); ti++) {
        const t = this.tile(ti, tj);
        const ja = Math.max(j0, tj * TILE);
        const jb = Math.min(j0 + H, (tj + 1) * TILE);
        const ia = Math.max(i0, ti * TILE);
        const ib = Math.min(i0 + W, (ti + 1) * TILE);
        for (let j = ja; j < jb; j++) {
          const src = (j - tj * TILE) * TILE + (ia - ti * TILE);
          out.set(t.subarray(src, src + (ib - ia)), (j - j0) * W + (ia - i0));
        }
      }
    }
  }

  fineIdx(x) {
    return Math.floor((x + WORLD_HALF) / FINE);
  }

  // ------------------------------------------------------------ queries
  isWalkable(x, z) {
    return this.fineCell(this.fineIdx(x), this.fineIdx(z)) !== BLOCKED;
  }

  // Straight line walkability test on the fine grid (no rough cells).
  clearWalk(ax, az, bx, bz) {
    let i0 = this.fineIdx(ax);
    let j0 = this.fineIdx(az);
    const i1 = this.fineIdx(bx);
    const j1 = this.fineIdx(bz);
    const di = Math.abs(i1 - i0);
    const dj = Math.abs(j1 - j0);
    if (di + dj > 600) return false;
    const si = i0 < i1 ? 1 : -1;
    const sj = j0 < j1 ? 1 : -1;
    let err = di - dj;
    for (let guard = 0; guard < 2000; guard++) {
      const c = this.fineCell(i0, j0);
      if (c === BLOCKED || c === ROUGH) return false;
      if (i0 === i1 && j0 === j1) return true;
      const e2 = 2 * err;
      if (e2 > -dj) {
        err -= dj;
        i0 += si;
      }
      if (e2 < di) {
        err += di;
        j0 += sj;
      }
    }
    return false;
  }

  nearestFine(i, j, maxR) {
    if (this.fineCell(i, j) !== BLOCKED) return [i, j];
    for (let r = 1; r <= maxR; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          if (this.fineCell(i + di, j + dj) !== BLOCKED) return [i + di, j + dj];
        }
      }
    }
    return null;
  }

  nearestCoarse(k, maxR) {
    const n = this.cn;
    if (k >= 0 && this.coarse[k] !== BLOCKED) return k;
    const i0 = k % n;
    const j0 = (k / n) | 0;
    for (let r = 1; r <= maxR; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          const i = i0 + di;
          const j = j0 + dj;
          if (i < 0 || j < 0 || i >= n || j >= n) continue;
          if (this.coarse[j * n + i] !== BLOCKED) return j * n + i;
        }
      }
    }
    return -1;
  }

  // Returns an array of {x,z} waypoints, or null.
  findPath(sx, sz, tx, tz, budget = 6000) {
    const dist = Math.hypot(tx - sx, tz - sz);
    if (dist > 150) return this.coarsePath(sx, sz, tx, tz, budget * 2);
    return this.finePath(sx, sz, tx, tz, budget);
  }

  finePath(sx, sz, tx, tz, budget) {
    const s = this.nearestFine(this.fineIdx(sx), this.fineIdx(sz), 4);
    const g = this.nearestFine(this.fineIdx(tx), this.fineIdx(tz), 8);
    if (!s || !g) return null;
    if (s[0] === g[0] && s[1] === g[1]) return [{ x: tx, z: tz }];
    // window centred between start and goal, sized to the trip
    const span = Math.max(Math.abs(s[0] - g[0]), Math.abs(s[1] - g[1]));
    const W = Math.min(WIN, Math.max(48, span + 60));
    const ci = ((s[0] + g[0]) / 2) | 0;
    const cj = ((s[1] + g[1]) / 2) | 0;
    const wi0 = Math.max(0, Math.min(this.fn - W, ci - (W >> 1)));
    const wj0 = Math.max(0, Math.min(this.fn - W, cj - (W >> 1)));
    const cells = this.winCells;
    this.fillWindow(cells, wi0, wj0, W, W);
    const si = s[0] - wi0;
    const sj = s[1] - wj0;
    const gi = g[0] - wi0;
    const gj = g[1] - wj0;
    if (si < 0 || sj < 0 || gi < 0 || gj < 0 || si >= W || sj >= W || gi >= W || gj >= W) return null;
    const raw = this.fineSearch.run(W, W, cells, sj * W + si, gj * W + gi, budget);
    if (!raw) return null;
    const pts = this.smooth(raw, (k) => [wi0 + (k % W), wj0 + ((k / W) | 0)], FINE);
    if (!raw.partial && pts.length) pts[pts.length - 1] = { x: tx, z: tz };
    pts.partial = raw.partial;
    pts.coarse = false;
    return pts;
  }

  coarsePath(sx, sz, tx, tz, budget) {
    const n = this.cn;
    const ci = (x) => Math.floor((x + WORLD_HALF) / COARSE);
    const idx = (x, z) => {
      const i = ci(x);
      const j = ci(z);
      return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i;
    };
    const sk = this.nearestCoarse(idx(sx, sz), 4);
    const gk = this.nearestCoarse(idx(tx, tz), 8);
    if (sk < 0 || gk < 0) return null;
    if (sk === gk) return [{ x: tx, z: tz }];
    const raw = this.coarseSearch.run(n, n, this.coarse, sk, gk, budget);
    if (!raw) return null;
    const out = [];
    let lastDir = -1;
    for (let k = 1; k < raw.length; k++) {
      const a = raw[k - 1];
      const b = raw[k];
      const dir = b - a;
      if (dir !== lastDir || k === raw.length - 1 || k % 6 === 0) out.push({ x: -WORLD_HALF + ((b % n) + 0.5) * COARSE, z: -WORLD_HALF + (((b / n) | 0) + 0.5) * COARSE });
      lastDir = dir;
    }
    if (!raw.partial && out.length) out[out.length - 1] = { x: tx, z: tz };
    out.partial = raw.partial;
    out.coarse = true;
    return out;
  }

  // String-pull a fine path using line-of-walk tests.
  smooth(raw, toCell, size) {
    const out = [];
    const center = (k) => {
      const [i, j] = toCell(k);
      return { x: -WORLD_HALF + (i + 0.5) * size, z: -WORLD_HALF + (j + 0.5) * size, i, j };
    };
    let anchor = center(raw[0]);
    let prev = anchor;
    for (let k = 1; k < raw.length; k++) {
      const c = center(raw[k]);
      if (!this.clearWalk(anchor.x, anchor.z, c.x, c.z)) {
        out.push({ x: prev.x, z: prev.z });
        anchor = prev;
      }
      prev = c;
    }
    out.push({ x: prev.x, z: prev.z });
    return out;
  }

  // Random walkable point near (x,z) within radius r, using a supplied rng().
  randomPointNear(x, z, r, rand) {
    for (let i = 0; i < 20; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * r;
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      if (this.isWalkable(px, pz)) return { x: px, z: pz };
    }
    const c = this.nearestFine(this.fineIdx(x), this.fineIdx(z), 10);
    return c ? { x: -WORLD_HALF + (c[0] + 0.5) * FINE, z: -WORLD_HALF + (c[1] + 0.5) * FINE } : { x, z };
  }
}
