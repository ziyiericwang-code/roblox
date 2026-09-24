// Placement helpers shared by the world layout and settlement builders.
import { WORLD_HALF } from '../constants.js';
import { clamp } from '../math.js';

// Coarse occupancy grid (2 m cells): prevents overlapping structures, trees in
// buildings, houses on roads...
export class Occupancy {
  constructor(cell = 2) {
    this.cell = cell;
    this.n = Math.ceil((WORLD_HALF * 2) / cell);
    this.grid = new Uint8Array(this.n * this.n);
  }
  mark(x0, z0, x1, z1, v = 1) {
    const c = this.cell;
    const i0 = clamp(Math.floor((x0 + WORLD_HALF) / c), 0, this.n - 1);
    const i1 = clamp(Math.floor((x1 + WORLD_HALF) / c), 0, this.n - 1);
    const j0 = clamp(Math.floor((z0 + WORLD_HALF) / c), 0, this.n - 1);
    const j1 = clamp(Math.floor((z1 + WORLD_HALF) / c), 0, this.n - 1);
    for (let j = j0; j <= j1; j++) {
      const row = j * this.n;
      for (let i = i0; i <= i1; i++) if (this.grid[row + i] < v) this.grid[row + i] = v;
    }
  }
  markCircle(x, z, r, v = 1) {
    this.mark(x - r, z - r, x + r, z + r, v);
  }
  free(x0, z0, x1, z1) {
    const c = this.cell;
    const i0 = Math.floor((x0 + WORLD_HALF) / c);
    const i1 = Math.floor((x1 + WORLD_HALF) / c);
    const j0 = Math.floor((z0 + WORLD_HALF) / c);
    const j1 = Math.floor((z1 + WORLD_HALF) / c);
    if (i0 < 0 || j0 < 0 || i1 >= this.n || j1 >= this.n) return false;
    for (let j = j0; j <= j1; j++) {
      const row = j * this.n;
      for (let i = i0; i <= i1; i++) if (this.grid[row + i]) return false;
    }
    return true;
  }
  at(x, z) {
    const c = this.cell;
    const i = Math.floor((x + WORLD_HALF) / c);
    const j = Math.floor((z + WORLD_HALF) / c);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return 1;
    return this.grid[j * this.n + i];
  }
}

// Spatial index of road samples for "which way is the road" queries.
export class RoadIndex {
  constructor(roads, cell = 64) {
    this.cell = cell;
    this.map = new Map();
    for (const r of roads) {
      for (let i = 0; i < r.samples.length; i += 2) {
        const p = r.samples[i];
        const k = this.key(p.x, p.z);
        let arr = this.map.get(k);
        if (!arr) this.map.set(k, (arr = []));
        arr.push(p, r);
      }
    }
  }
  key(x, z) {
    return Math.floor((x + WORLD_HALF) / this.cell) * 4096 + Math.floor((z + WORLD_HALF) / this.cell);
  }
  nearest(x, z, maxR = 128) {
    const c = this.cell;
    const ci = Math.floor((x + WORLD_HALF) / c);
    const cj = Math.floor((z + WORLD_HALF) / c);
    const rr = Math.ceil(maxR / c);
    let best = null;
    let bestRoad = null;
    let bd = maxR * maxR;
    for (let di = -rr; di <= rr; di++) {
      for (let dj = -rr; dj <= rr; dj++) {
        const arr = this.map.get((ci + di) * 4096 + cj + dj);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k += 2) {
          const p = arr[k];
          const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
          if (d < bd) {
            bd = d;
            best = p;
            bestRoad = arr[k + 1];
          }
        }
      }
    }
    return best ? { p: best, road: bestRoad, dx: best.x - x, dz: best.z - z, d: Math.sqrt(bd) } : null;
  }
}

export function footprint(w, d, rot) {
  return rot & 1 ? [d, w] : [w, d];
}

// Rotation (0..3) whose local front (-Z) faces the direction (dx,dz).
export function rotFacing(dx, dz) {
  if (Math.abs(dx) > Math.abs(dz)) return dx < 0 ? 1 : 3;
  return dz < 0 ? 0 : 2;
}

// Try to place a prefab of local size w x d at (x,z) with rotation rot.
export function tryPlace(ctx, x, z, rot, w, d, fn, opts = {}) {
  const [fw, fd] = footprint(w, d, rot);
  const m = opts.margin ?? 1.5;
  const t = ctx.terrain;
  if (!ctx.occ.free(x - fw / 2 - m, z - fd / 2 - m, x + fw / 2 + m, z + fd / 2 + m)) return false;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [ox, oz] of [[-fw / 2, -fd / 2], [fw / 2, -fd / 2], [-fw / 2, fd / 2], [fw / 2, fd / 2], [0, 0]]) {
    const h = t.heightAt(x + ox, z + oz);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  if (lo < (opts.minHeight ?? 1.4)) return false;
  if (hi - lo > (opts.maxSlope ?? 3.5)) return false;
  if (opts.noRiver !== false && t.riverDistAt(x, z) < Math.max(fw, fd) / 2 + 2) return false;
  ctx.occ.mark(x - fw / 2 - 0.5, z - fd / 2 - 0.5, x + fw / 2 + 0.5, z + fd / 2 + 0.5);
  const run = () => ctx.b.at(x, z, rot, fn, { footprint: Math.min(fw, fd) / 2, y: opts.y });
  if (opts.kind) ctx.b.building(opts.kind, run, { name: opts.name, destructible: opts.destructible });
  else run();
  return true;
}

// Spiral search for a free spot of size w x d near (x,z).
export function findSpot(ctx, x, z, w, d, maxR, opts = {}) {
  for (let r = 0; r <= maxR; r += 3) {
    const steps = Math.max(1, Math.floor(r / 2));
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      for (const rot of [0, 1]) {
        const [fw, fd] = footprint(w, d, rot);
        if (!ctx.occ.free(px - fw / 2 - 1, pz - fd / 2 - 1, px + fw / 2 + 1, pz + fd / 2 + 1)) continue;
        const h = ctx.terrain.heightAt(px, pz);
        if (h < 1.5) continue;
        if (opts.maxSlope !== undefined) {
          const h2 = ctx.terrain.heightAt(px + fw / 2, pz + fd / 2);
          const h3 = ctx.terrain.heightAt(px - fw / 2, pz - fd / 2);
          if (Math.abs(h2 - h3) > opts.maxSlope) continue;
        }
        return { x: px, z: pz, rot };
      }
    }
  }
  return null;
}

// Scatter prefabs over a disc; buildings near a road face it.
export function scatter(ctx, cx, cz, radius, count, sizeFn, placeFn, opts = {}) {
  let placed = 0;
  const tries = opts.tries ?? 12;
  for (let i = 0; i < count * tries && placed < count; i++) {
    const a = ctx.rng.float(0, Math.PI * 2);
    const d = (opts.minR ?? 0) + Math.sqrt(ctx.rng.next()) * (radius - (opts.minR ?? 0));
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    const [w, dd] = sizeFn();
    const road = ctx.roadIndex ? ctx.roadIndex.nearest(x, z, 48) : null;
    const rot = road ? rotFacing(road.dx, road.dz) : ctx.rng.int(0, 3);
    if (tryPlace(ctx, x, z, rot, w, dd, (bb) => placeFn(bb, w, dd), { kind: opts.kind, name: opts.name, maxSlope: opts.maxSlope })) placed++;
  }
  return placed;
}
