// Static collision world: axis aligned boxes in a uniform grid + the terrain
// heightfield. Provides ground queries, character push-out, and raycasts.
import { WORLD_HALF, BODY } from '../constants.js';
import { rayAABB } from '../math.js';
import { BF } from './builder.js';
import { PENETRABLE } from './materials.js';

const CELL = 8;

export class Colliders {
  constructor(terrain, boxes) {
    this.terrain = terrain;
    const solid = boxes.filter((b) => b.f & BF.SOLID);
    const n = solid.length;
    this.count = n;
    this.x0 = new Float32Array(n);
    this.y0 = new Float32Array(n);
    this.z0 = new Float32Array(n);
    this.x1 = new Float32Array(n);
    this.y1 = new Float32Array(n);
    this.z1 = new Float32Array(n);
    this.mat = new Uint8Array(n);
    this.flags = new Uint8Array(n);
    this.ref = solid; // original box objects (range targets etc.)
    for (let i = 0; i < n; i++) {
      const b = solid[i];
      b.ci = i;
      this.x0[i] = b.x0;
      this.y0[i] = b.y0;
      this.z0[i] = b.z0;
      this.x1[i] = b.x1;
      this.y1[i] = b.y1;
      this.z1[i] = b.z1;
      this.mat[i] = b.m;
      this.flags[i] = b.f;
    }
    this.cells = Math.ceil((WORLD_HALF * 2) / CELL);
    this.buildGrid();
    this.stamp = new Uint32Array(n);
    this.stampId = 1;
  }

  buildGrid() {
    const C = this.cells;
    const counts = new Int32Array(C * C);
    const range = (i) => {
      const cx0 = Math.max(0, Math.floor((this.x0[i] + WORLD_HALF) / CELL));
      const cx1 = Math.min(C - 1, Math.floor((this.x1[i] + WORLD_HALF) / CELL));
      const cz0 = Math.max(0, Math.floor((this.z0[i] + WORLD_HALF) / CELL));
      const cz1 = Math.min(C - 1, Math.floor((this.z1[i] + WORLD_HALF) / CELL));
      return [cx0, cx1, cz0, cz1];
    };
    for (let i = 0; i < this.count; i++) {
      const [a, b, c, d] = range(i);
      for (let z = c; z <= d; z++) for (let x = a; x <= b; x++) counts[z * C + x]++;
    }
    this.start = new Int32Array(C * C + 1);
    for (let k = 0; k < C * C; k++) this.start[k + 1] = this.start[k] + counts[k];
    this.items = new Int32Array(this.start[C * C]);
    const fill = new Int32Array(C * C);
    for (let i = 0; i < this.count; i++) {
      const [a, b, c, d] = range(i);
      for (let z = c; z <= d; z++) {
        for (let x = a; x <= b; x++) {
          const k = z * C + x;
          this.items[this.start[k] + fill[k]++] = i;
        }
      }
    }
  }

  nextStamp() {
    this.stampId++;
    if (this.stampId > 0xfffffff0) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
    return this.stampId;
  }

  // Iterate candidate boxes overlapping an XZ rectangle.
  forEachInRect(minx, minz, maxx, maxz, fn) {
    const C = this.cells;
    const cx0 = Math.max(0, Math.floor((minx + WORLD_HALF) / CELL));
    const cx1 = Math.min(C - 1, Math.floor((maxx + WORLD_HALF) / CELL));
    const cz0 = Math.max(0, Math.floor((minz + WORLD_HALF) / CELL));
    const cz1 = Math.min(C - 1, Math.floor((maxz + WORLD_HALF) / CELL));
    const s = this.nextStamp();
    for (let z = cz0; z <= cz1; z++) {
      for (let x = cx0; x <= cx1; x++) {
        const k = z * C + x;
        for (let p = this.start[k]; p < this.start[k + 1]; p++) {
          const i = this.items[p];
          if (this.stamp[i] === s) continue;
          this.stamp[i] = s;
          if (this.x1[i] < minx || this.x0[i] > maxx || this.z1[i] < minz || this.z0[i] > maxz) continue;
          if (fn(i) === false) return;
        }
      }
    }
  }

  // Highest walkable surface under a circle whose feet are at y (surfaces up to y+step count).
  groundHeight(x, z, y, r = BODY.radius * 0.7, step = BODY.stepHeight) {
    let g = this.terrain.heightAt(x, z);
    const lim = y + step;
    this.forEachInRect(x - r, z - r, x + r, z + r, (i) => {
      const top = this.y1[i];
      if (top > g && top <= lim) {
        // circle vs rect overlap
        const cx = Math.max(this.x0[i], Math.min(x, this.x1[i]));
        const cz = Math.max(this.z0[i], Math.min(z, this.z1[i]));
        if ((cx - x) * (cx - x) + (cz - z) * (cz - z) <= r * r) g = top;
      }
    });
    return g;
  }

  // Push a vertical cylinder out of boxes. pos is mutated. Returns true if collided.
  resolveCylinder(pos, r, height, step = BODY.stepHeight) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const yb = pos.y + step;
      const yt = pos.y + height;
      this.forEachInRect(pos.x - r, pos.z - r, pos.x + r, pos.z + r, (i) => {
        if (this.y1[i] <= yb || this.y0[i] >= yt) return;
        const x0 = this.x0[i];
        const x1 = this.x1[i];
        const z0 = this.z0[i];
        const z1 = this.z1[i];
        const cx = Math.max(x0, Math.min(pos.x, x1));
        const cz = Math.max(z0, Math.min(pos.z, z1));
        let dx = pos.x - cx;
        let dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) return;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = r - d;
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
        } else {
          // centre inside the box: exit via the nearest face
          const ex = Math.min(pos.x - x0, x1 - pos.x);
          const ez = Math.min(pos.z - z0, z1 - pos.z);
          if (ex < ez) pos.x = pos.x - x0 < x1 - pos.x ? x0 - r : x1 + r;
          else pos.z = pos.z - z0 < z1 - pos.z ? z0 - r : z1 + r;
        }
        moved = true;
        hit = true;
      });
      if (!moved) break;
    }
    return hit;
  }

  // Lowest box bottom above y within the circle (used for ceilings / stance checks).
  ceilingAbove(x, z, y, r = BODY.radius * 0.8) {
    let c = Infinity;
    this.forEachInRect(x - r, z - r, x + r, z + r, (i) => {
      if (this.y0[i] > y && this.y0[i] < c) c = this.y0[i];
    });
    return c;
  }

  pointInSolid(x, y, z) {
    let inside = false;
    this.forEachInRect(x, z, x, z, (i) => {
      if (y > this.y0[i] && y < this.y1[i]) {
        inside = true;
        return false;
      }
      return undefined;
    });
    return inside;
  }

  // Raycast against boxes only (grid DDA). Returns {t, i} of nearest hit or null.
  raycastBoxes(ox, oy, oz, dx, dy, dz, maxT, opts) {
    const C = this.cells;
    const ignorePenetrable = opts && opts.penetrate;
    let best = maxT;
    let bestI = -1;
    const s = this.nextStamp();
    // DDA over XZ cells
    let cx = Math.floor((ox + WORLD_HALF) / CELL);
    let cz = Math.floor((oz + WORLD_HALF) / CELL);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const invDx = Math.abs(dx) > 1e-9 ? 1 / dx : Infinity;
    const invDz = Math.abs(dz) > 1e-9 ? 1 / dz : Infinity;
    const nextBx = (cx + (stepX > 0 ? 1 : 0)) * CELL - WORLD_HALF;
    const nextBz = (cz + (stepZ > 0 ? 1 : 0)) * CELL - WORLD_HALF;
    let tMaxX = Math.abs(dx) > 1e-9 ? (nextBx - ox) * invDx : Infinity;
    let tMaxZ = Math.abs(dz) > 1e-9 ? (nextBz - oz) * invDz : Infinity;
    const tDeltaX = Math.abs(CELL * invDx);
    const tDeltaZ = Math.abs(CELL * invDz);
    let tEnter = 0;
    for (let guard = 0; guard < 600; guard++) {
      if (tEnter > best) break;
      if (cx >= 0 && cx < C && cz >= 0 && cz < C) {
        const k = cz * C + cx;
        for (let p = this.start[k]; p < this.start[k + 1]; p++) {
          const i = this.items[p];
          if (this.stamp[i] === s) continue;
          this.stamp[i] = s;
          if (ignorePenetrable && PENETRABLE.has(this.mat[i])) continue;
          if (opts && opts.skip && opts.skip(i)) continue;
          const t = rayAABB(ox, oy, oz, dx, dy, dz, this.x0[i], this.y0[i], this.z0[i], this.x1[i], this.y1[i], this.z1[i], best);
          if (t >= 0 && t < best) {
            best = t;
            bestI = i;
          }
        }
      } else if ((cx < 0 && stepX < 0) || (cx >= C && stepX > 0) || (cz < 0 && stepZ < 0) || (cz >= C && stepZ > 0)) {
        break;
      }
      if (tMaxX < tMaxZ) {
        tEnter = tMaxX;
        tMaxX += tDeltaX;
        cx += stepX;
      } else {
        tEnter = tMaxZ;
        tMaxZ += tDeltaZ;
        cz += stepZ;
      }
      if (tEnter > maxT) break;
    }
    return bestI >= 0 ? { t: best, i: bestI } : null;
  }

  // Full raycast vs terrain + boxes. Returns {t, i (box or -1), terrain: bool, mat} or null.
  raycast(ox, oy, oz, dx, dy, dz, maxT, opts) {
    const bh = this.raycastBoxes(ox, oy, oz, dx, dy, dz, maxT, opts);
    const lim = bh ? bh.t : maxT;
    const tt = this.terrain.raycast(ox, oy, oz, dx, dy, dz, lim);
    if (tt >= 0 && (!bh || tt < bh.t)) return { t: tt, i: -1, terrain: true, mat: -1 };
    if (bh) return { t: bh.t, i: bh.i, terrain: false, mat: this.mat[bh.i] };
    return null;
  }

  lineOfSight(ax, ay, az, bx, by, bz, opts) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-4) return true;
    const h = this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05, opts || { penetrate: true });
    return !h;
  }

  // Outward normal of box i at point p (for impact effects).
  boxNormal(i, px, py, pz) {
    const d = [
      [Math.abs(px - this.x0[i]), -1, 0, 0],
      [Math.abs(px - this.x1[i]), 1, 0, 0],
      [Math.abs(py - this.y0[i]), 0, -1, 0],
      [Math.abs(py - this.y1[i]), 0, 1, 0],
      [Math.abs(pz - this.z0[i]), 0, 0, -1],
      [Math.abs(pz - this.z1[i]), 0, 0, 1],
    ];
    d.sort((a, b) => a[0] - b[0]);
    return { x: d[0][1], y: d[0][2], z: d[0][3] };
  }
}
