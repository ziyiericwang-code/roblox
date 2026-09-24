// Regions: every point of the continent belongs to exactly one territory
// (noise-warped nearest centre, so borders look organic). Used for the war map,
// "where am I" labels, border crossings, territory adjacency (fronts) and
// deciding which country's architecture a village gets.
import { WORLD_HALF, SEA_LEVEL } from '../constants.js';
import { Noise2D, clamp } from '../math.js';

export const REGION_CELL = 16;

export class RegionMap {
  constructor(terrain, territories, seed) {
    this.terrain = terrain;
    this.territories = territories;
    this.cell = REGION_CELL;
    this.n = Math.ceil((WORLD_HALF * 2) / REGION_CELL);
    this.idx = new Uint8Array(this.n * this.n); // territory index + 1 (0 = none)
    this.land = new Uint8Array(this.n * this.n);
    this.noise = new Noise2D(seed ^ 0x2a1b3c);
    this.build();
    this.computeAdjacency();
  }

  build() {
    const { n, cell } = this;
    const ts = this.territories;
    for (let j = 0; j < n; j++) {
      const z = -WORLD_HALF + (j + 0.5) * cell;
      for (let i = 0; i < n; i++) {
        const x = -WORLD_HALF + (i + 0.5) * cell;
        const wx = x + this.noise.fbm(x / 520, z / 520, 3) * 190;
        const wz = z + this.noise.fbm(x / 520 + 17, z / 520 - 9, 3) * 190;
        let best = 0;
        let bd = Infinity;
        // island territories own exactly their island, nothing else
        let onIsland = -1;
        for (let t = 0; t < ts.length; t++) {
          const isl = ts[t].island;
          if (!isl) continue;
          const qx = (x - isl.center[0]) / (isl.radius[0] * 1.25);
          const qz = (z - isl.center[1]) / (isl.radius[1] * 1.25);
          if (qx * qx + qz * qz < 1) onIsland = t;
        }
        if (onIsland >= 0) {
          const k = j * n + i;
          this.idx[k] = onIsland + 1;
          this.land[k] = this.terrain.heightAt(x, z) > SEA_LEVEL + 0.2 ? 1 : 0;
          continue;
        }
        for (let t = 0; t < ts.length; t++) {
          if (ts[t].island) continue;
          const dx = wx - ts[t].x;
          const dz = wz - ts[t].z;
          // bigger (more valuable) territories claim a little more ground
          const d = (dx * dx + dz * dz) / (ts[t].weight || 1);
          if (d < bd) {
            bd = d;
            best = t;
          }
        }
        const k = j * n + i;
        this.idx[k] = best + 1;
        this.land[k] = this.terrain.heightAt(x, z) > SEA_LEVEL + 0.2 ? 1 : 0;
      }
    }
  }

  // Territories that share a land border (or, for islands, the nearest shore).
  computeAdjacency() {
    const { n } = this;
    const counts = new Map();
    const bump = (a, b) => {
      if (a === b) return;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    };
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const k = j * n + i;
        if (!this.land[k]) continue;
        if (this.land[k + 1]) bump(this.idx[k], this.idx[k + 1]);
        if (this.land[k + n]) bump(this.idx[k], this.idx[k + n]);
      }
    }
    const ts = this.territories;
    for (const t of ts) t.adjacent = [];
    for (const [key, c] of counts) {
      if (c < 6) continue; // at least ~100 m of shared border
      const [a, b] = key.split('|').map(Number);
      ts[a - 1].adjacent.push(ts[b - 1].id);
      ts[b - 1].adjacent.push(ts[a - 1].id);
    }
    // islands and other isolated regions connect to the nearest territory
    for (const t of ts) {
      if (t.adjacent.length) continue;
      let best = null;
      let bd = Infinity;
      for (const o of ts) {
        if (o === t) continue;
        const d = Math.hypot(o.x - t.x, o.z - t.z);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (best) {
        t.adjacent.push(best.id);
        best.adjacent.push(t.id);
        t.bySea = true;
      }
    }
  }

  cellIndex(x, z) {
    const i = clamp(Math.floor((x + WORLD_HALF) / this.cell), 0, this.n - 1);
    const j = clamp(Math.floor((z + WORLD_HALF) / this.cell), 0, this.n - 1);
    return j * this.n + i;
  }

  territoryAt(x, z) {
    const v = this.idx[this.cellIndex(x, z)];
    return v ? this.territories[v - 1] : null;
  }

  territoryIndexAt(x, z) {
    return this.idx[this.cellIndex(x, z)] - 1;
  }

  // Walk from a to b and report where the territory changes (border points).
  crossings(ax, az, bx, bz, step = 8) {
    const len = Math.hypot(bx - ax, bz - az);
    const out = [];
    let prev = this.territoryIndexAt(ax, az);
    for (let d = step; d <= len; d += step) {
      const t = d / len;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const cur = this.territoryIndexAt(x, z);
      if (cur !== prev) out.push({ x, z, from: prev, to: cur });
      prev = cur;
    }
    return out;
  }
}
