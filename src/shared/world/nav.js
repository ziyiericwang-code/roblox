// Navigation grid + A* for AI soldiers.
// Two layers: a fine 2 m grid for local paths and a coarse 8 m grid for long
// distance routing. Both are built once from the terrain and colliders.
import { WORLD_HALF, SEA_LEVEL, BODY } from '../constants.js';
import { BF } from './builder.js';

const BLOCKED = 0;
const OPEN = 1;
const ROAD = 2;
const ROUGH = 3; // shallow water / steep: allowed but expensive

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

class Grid {
  constructor(cell) {
    this.cell = cell;
    this.n = Math.ceil((WORLD_HALF * 2) / cell);
    this.cells = new Uint8Array(this.n * this.n);
    this.g = new Float32Array(this.n * this.n);
    this.parent = new Int32Array(this.n * this.n);
    this.visit = new Uint32Array(this.n * this.n);
    this.closed = new Uint32Array(this.n * this.n);
    this.gen = 1;
    this.heap = new MinHeap(4096);
  }
  idx(x, z) {
    const i = Math.floor((x + WORLD_HALF) / this.cell);
    const j = Math.floor((z + WORLD_HALF) / this.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }
  center(k) {
    const i = k % this.n;
    const j = (k / this.n) | 0;
    return { x: -WORLD_HALF + (i + 0.5) * this.cell, z: -WORLD_HALF + (j + 0.5) * this.cell };
  }
  walkable(k) {
    return k >= 0 && this.cells[k] !== BLOCKED;
  }
  cost(k) {
    const c = this.cells[k];
    return c === ROAD ? 0.8 : c === ROUGH ? 3 : 1;
  }

  nearestWalkable(k, maxR = 6) {
    if (this.walkable(k)) return k;
    if (k < 0) return -1;
    const i0 = k % this.n;
    const j0 = (k / this.n) | 0;
    for (let r = 1; r <= maxR; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          const i = i0 + di;
          const j = j0 + dj;
          if (i < 0 || j < 0 || i >= this.n || j >= this.n) continue;
          const kk = j * this.n + i;
          if (this.cells[kk] !== BLOCKED) return kk;
        }
      }
    }
    return -1;
  }

  // Grid line-of-walk: true if every cell along the segment is walkable (not rough).
  clearLine(a, b) {
    const n = this.n;
    let i0 = a % n;
    let j0 = (a / n) | 0;
    const i1 = b % n;
    const j1 = (b / n) | 0;
    const di = Math.abs(i1 - i0);
    const dj = Math.abs(j1 - j0);
    const si = i0 < i1 ? 1 : -1;
    const sj = j0 < j1 ? 1 : -1;
    let err = di - dj;
    for (let guard = 0; guard < 4000; guard++) {
      const c = this.cells[j0 * n + i0];
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

  astar(sk, gk, maxNodes) {
    const n = this.n;
    this.gen++;
    if (this.gen > 0xfffffff0) {
      this.visit.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    const heap = this.heap;
    heap.clear();
    const gi = gk % n;
    const gj = (gk / n) | 0;
    const h = (k) => {
      const di = Math.abs((k % n) - gi);
      const dj = Math.abs(((k / n) | 0) - gj);
      return (Math.max(di, dj) + 0.414 * Math.min(di, dj)) * 1.15;
    };
    this.g[sk] = 0;
    this.visit[sk] = gen;
    this.parent[sk] = -1;
    heap.push(h(sk), sk);
    let expanded = 0;
    let bestK = sk;
    let bestH = h(sk);
    while (heap.size > 0) {
      const k = heap.pop();
      if (this.closed[k] === gen) continue;
      this.closed[k] = gen;
      if (k === gk) return this.trace(k);
      const hk = h(k);
      if (hk < bestH) {
        bestH = hk;
        bestK = k;
      }
      if (++expanded > maxNodes) break;
      const i = k % n;
      const j = (k / n) | 0;
      const gk0 = this.g[k];
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= n) continue;
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ii = i + di;
          if (ii < 0 || ii >= n) continue;
          const nk = jj * n + ii;
          if (this.cells[nk] === BLOCKED || this.closed[nk] === gen) continue;
          if (di && dj && (this.cells[j * n + ii] === BLOCKED || this.cells[jj * n + i] === BLOCKED)) continue; // no corner cutting
          const step = (di && dj ? 1.414 : 1) * this.cost(nk);
          const ng = gk0 + step;
          if (this.visit[nk] === gen && this.g[nk] <= ng) continue;
          this.visit[nk] = gen;
          this.g[nk] = ng;
          this.parent[nk] = k;
          heap.push(ng + h(nk), nk);
        }
      }
    }
    // Partial path toward the closest reached node (better than nothing).
    return bestK !== sk ? this.trace(bestK, true) : null;
  }

  trace(k, partial = false) {
    const out = [];
    let guard = 0;
    while (k >= 0 && guard++ < 100000) {
      out.push(k);
      k = this.parent[k];
    }
    out.reverse();
    out.partial = partial;
    return out;
  }

  smooth(path) {
    if (path.length <= 2) return path;
    const out = [path[0]];
    let anchor = path[0];
    for (let i = 2; i < path.length; i++) {
      if (!this.clearLine(anchor, path[i])) {
        anchor = path[i - 1];
        out.push(anchor);
      }
    }
    out.push(path[path.length - 1]);
    out.partial = path.partial;
    return out;
  }
}

export class NavGrid {
  constructor(terrain, colliders, boxes) {
    this.terrain = terrain;
    this.colliders = colliders;
    this.fine = new Grid(2);
    this.coarse = new Grid(8);
    this.build(boxes);
  }

  build(boxes) {
    const t = this.terrain;
    const f = this.fine;
    const n = f.n;
    // terrain pass
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -WORLD_HALF + (i + 0.5) * f.cell;
        const z = -WORLD_HALF + (j + 0.5) * f.cell;
        const h = t.heightAt(x, z);
        const k = j * n + i;
        const depth = SEA_LEVEL - h;
        const hl = t.heightAt(x - 1.5, z);
        const hr = t.heightAt(x + 1.5, z);
        const hd = t.heightAt(x, z - 1.5);
        const hu = t.heightAt(x, z + 1.5);
        const slope = Math.max(Math.abs(hr - hl), Math.abs(hu - hd)) / 3;
        if (depth > 1.1 || slope > 1.15) f.cells[k] = BLOCKED;
        else if (depth > 0.3 || slope > 0.75) f.cells[k] = ROUGH;
        else f.cells[k] = t.isRoad(x, z) ? ROAD : OPEN;
      }
    }
    // obstacles
    const pad = 0.35;
    const walkSurf = [];
    for (const b of boxes) {
      if (!(b.f & BF.SOLID)) continue;
      if (b.f & BF.WALKSURF) {
        walkSurf.push(b);
        continue;
      }
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      const ground = Math.min(t.heightAt(b.x0, b.z0), t.heightAt(b.x1, b.z1), t.heightAt(cx, cz));
      if (b.y1 - ground <= BODY.stepHeight) continue; // low enough to walk over
      if (b.y0 - ground >= 1.9) continue; // overhead (roofs, bridge decks)
      const i0 = Math.max(0, Math.floor((b.x0 - pad + WORLD_HALF) / f.cell));
      const i1 = Math.min(n - 1, Math.floor((b.x1 + pad + WORLD_HALF) / f.cell));
      const j0 = Math.max(0, Math.floor((b.z0 - pad + WORLD_HALF) / f.cell));
      const j1 = Math.min(n - 1, Math.floor((b.z1 + pad + WORLD_HALF) / f.cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = -WORLD_HALF + (i + 0.5) * f.cell;
          const z = -WORLD_HALF + (j + 0.5) * f.cell;
          if (x < b.x0 - pad || x > b.x1 + pad || z < b.z0 - pad || z > b.z1 + pad) continue;
          f.cells[j * n + i] = BLOCKED;
        }
      }
    }
    // walkable surfaces over water (docks, bridge decks)
    for (const b of walkSurf) {
      const i0 = Math.max(0, Math.floor((b.x0 + WORLD_HALF) / f.cell));
      const i1 = Math.min(n - 1, Math.floor((b.x1 + WORLD_HALF) / f.cell));
      const j0 = Math.max(0, Math.floor((b.z0 + WORLD_HALF) / f.cell));
      const j1 = Math.min(n - 1, Math.floor((b.z1 + WORLD_HALF) / f.cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f.cells[j * n + i] = ROAD;
    }
    // coarse grid: a coarse cell is walkable if most of its fine cells are
    const c = this.coarse;
    const ratio = c.cell / f.cell;
    for (let j = 0; j < c.n; j++) {
      for (let i = 0; i < c.n; i++) {
        let open = 0;
        let road = 0;
        let rough = 0;
        for (let dj = 0; dj < ratio; dj++) {
          for (let di = 0; di < ratio; di++) {
            const fk = (j * ratio + dj) * n + (i * ratio + di);
            const v = f.cells[fk];
            if (v === OPEN) open++;
            else if (v === ROAD) road++;
            else if (v === ROUGH) rough++;
          }
        }
        const total = ratio * ratio;
        const walk = open + road;
        const k = j * c.n + i;
        if (walk >= total * 0.55) c.cells[k] = road > total * 0.3 ? ROAD : OPEN;
        else if (walk + rough >= total * 0.6) c.cells[k] = ROUGH;
        else c.cells[k] = BLOCKED;
      }
    }
  }

  isWalkable(x, z) {
    return this.fine.walkable(this.fine.idx(x, z));
  }

  // Returns an array of {x,z} waypoints, or null.
  findPath(sx, sz, tx, tz, budget = 6000) {
    const dist = Math.hypot(tx - sx, tz - sz);
    const grid = dist > 110 ? this.coarse : this.fine;
    let sk = grid.nearestWalkable(grid.idx(sx, sz), 4);
    let gk = grid.nearestWalkable(grid.idx(tx, tz), 8);
    if (sk < 0 || gk < 0) return null;
    if (sk === gk) return [{ x: tx, z: tz }];
    const raw = grid.astar(sk, gk, grid === this.coarse ? budget * 2 : budget);
    if (!raw) return null;
    const sm = grid.smooth(raw);
    const out = [];
    for (let i = 1; i < sm.length; i++) out.push(grid.center(sm[i]));
    if (!raw.partial && out.length) out[out.length - 1] = { x: tx, z: tz };
    out.partial = raw.partial;
    out.coarse = grid === this.coarse;
    return out;
  }

  // Straight line walkability test on the fine grid.
  clearWalk(ax, az, bx, bz) {
    const a = this.fine.idx(ax, az);
    const b = this.fine.idx(bx, bz);
    if (a < 0 || b < 0) return false;
    return this.fine.clearLine(a, b);
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
    const k = this.fine.nearestWalkable(this.fine.idx(x, z), 10);
    return k >= 0 ? this.fine.center(k) : { x, z };
  }
}
