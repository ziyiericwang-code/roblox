// Deterministic heightmap terrain shared by simulation and client.
// Generation happens in phases so the layout can flatten pads/roads before
// structures are placed:  raw heights -> pads -> roads -> materials.
import { Noise2D, clamp, lerp, smoothstep, pointSegDist2D } from '../math.js';
import { WORLD_HALF, SEA_LEVEL } from '../constants.js';
import { RIVER_PATH, RIVER_WIDTH, COAST_X } from '../config/territories.js';

export const TMAT = {
  GRASS: 0,
  DRYGRASS: 1,
  DIRT: 2,
  ROCK: 3,
  SAND: 4,
  SNOW: 5,
  ROAD: 6,
  FIELD: 7,
  CONCRETE: 8,
  REDROCK: 9,
  MUD: 10,
  GRAVEL: 11,
  FOREST: 12,
  FIELD2: 13,
  ICE: 14,
};

export const TMAT_COLORS = [
  [0.29, 0.39, 0.19], // grass
  [0.47, 0.46, 0.27], // dry grass
  [0.42, 0.34, 0.24], // dirt
  [0.42, 0.41, 0.39], // rock
  [0.74, 0.68, 0.52], // sand
  [0.88, 0.9, 0.93], // snow
  [0.2, 0.2, 0.21], // road
  [0.55, 0.49, 0.26], // field (wheat)
  [0.5, 0.5, 0.48], // concrete
  [0.62, 0.36, 0.23], // red rock
  [0.3, 0.26, 0.2], // mud
  [0.48, 0.46, 0.42], // gravel
  [0.22, 0.3, 0.16], // forest floor
  [0.36, 0.44, 0.2], // green crop
  [0.72, 0.8, 0.86], // ice
];

function gauss(x, z, cx, cz, r) {
  const dx = x - cx;
  const dz = z - cz;
  return Math.exp(-(dx * dx + dz * dz) / (r * r));
}

function terrace(h, step, sharp) {
  const k = h / step;
  const f = Math.floor(k);
  const t = k - f;
  const s = smoothstep(0.5 - sharp, 0.5 + sharp, t);
  return (f + s) * step;
}

export class Terrain {
  constructor(seed, res = 4) {
    this.seed = seed;
    this.res = res;
    this.size = WORLD_HALF * 2;
    this.n = Math.round(this.size / res) + 1; // samples per side
    this.noise = new Noise2D(seed);
    this.noise2 = new Noise2D(seed ^ 0x5bd1e995);
    this.heights = new Float32Array(this.n * this.n);
    this.materials = new Uint8Array(this.n * this.n);
    this.riverDist = new Float32Array(this.n * this.n);
    this.flags = new Uint8Array(this.n * this.n); // bit0 road, bit1 pad, bit2 field
    this.padMat = new Int8Array(this.n * this.n).fill(-1);
    this.river = this.buildRiver();
  }

  // Dense, slightly wiggled river centre line.
  buildRiver() {
    const pts = [];
    for (let i = 0; i < RIVER_PATH.length - 1; i++) {
      const [ax, az] = RIVER_PATH[i];
      const [bx, bz] = RIVER_PATH[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(len / 12));
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const x = lerp(ax, bx, t);
        const z = lerp(az, bz, t);
        const w = this.noise2.noise(x / 90, z / 90) * 14;
        pts.push([x + nx * w, z + nz * w]);
      }
    }
    pts.push(RIVER_PATH[RIVER_PATH.length - 1]);
    return pts;
  }

  riverDistance(x, z) {
    let best = 1e9;
    const r = this.river;
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i];
      const b = r[i + 1];
      // cheap reject
      const minx = Math.min(a[0], b[0]) - best;
      const maxx = Math.max(a[0], b[0]) + best;
      if (x < minx || x > maxx) continue;
      const d = pointSegDist2D(x, z, a[0], a[1], b[0], b[1]);
      if (d < best) best = d;
    }
    return best;
  }

  coastX(z) {
    return COAST_X + 30 * this.noise2.fbm(z / 170 + 3.3, 1.7, 3);
  }

  rawHeight(x, z, riverD) {
    const n = this.noise;
    let h = 6 + 7 * n.fbm(x / 280 + 11, z / 280 - 7, 4);
    h += 2.5 * n.fbm(x / 60, z / 60, 3);

    // Mountains: Black Ridge massif + the northern range.
    const mBR = gauss(x, z, -370, -560, 300);
    const mNorth = smoothstep(-470, -780, z) * (0.55 + 0.45 * smoothstep(-200, -600, x + z * 0.3));
    const mountain = Math.max(mBR, mNorth * 0.85);
    if (mountain > 0.01) h += mountain * (30 + 95 * n.ridged(x / 250 + 5, z / 250 + 9, 5));

    // Northland: rolling forested hills.
    const nl = gauss(x, z, 430, -470, 320);
    h += nl * 16 * (n.fbm(x / 150 + 3, z / 150, 4) + 0.7);

    // Red Canyon: terraced mesas cut by dry canyons.
    const rc = gauss(x, z, 430, 470, 330);
    if (rc > 0.02) {
      const mesa = 27 + 10 * n.fbm(x / 210, z / 210, 3);
      const ch = Math.abs(this.noise2.fbm(x / 170 + 40, z / 170 - 40, 3));
      const cut = smoothstep(0.05, 0.15, ch);
      let mh = lerp(4, mesa, cut);
      mh = terrace(mh, 7, 0.28);
      h = lerp(h, mh, smoothstep(0.15, 0.55, rc));
    }

    // Plains, city, industrial valley: flatter ground.
    const flat = Math.max(gauss(x, z, 470, 55, 290), gauss(x, z, 45, -265, 270), gauss(x, z, -120, 175, 250), gauss(x, z, -570, 400, 260), gauss(x, z, -560, -200, 210));
    h = lerp(h, 5 + 2.2 * n.fbm(x / 320, z / 320, 2), flat * 0.72);

    // River valley and channel.
    const dr = riverD;
    const valley = 1 - smoothstep(20, 170, dr);
    h = lerp(h, 3.8, valley * 0.7);
    const half = RIVER_WIDTH / 2;
    if (dr < half + 22) {
      const t = smoothstep(half - 5, half + 22, dr);
      h = lerp(-3.4, Math.max(h, 2.2), t);
    }

    // West coast / sea.
    const cx = this.coastX(z);
    const c = smoothstep(cx + 55, cx - 35, x);
    if (c > 0) h = lerp(h, -10, c);

    // Map boundary: steep hills on N, E, S edges (west is ocean).
    const e = WORLD_HALF;
    const edge = Math.max(smoothstep(e - 100, e - 5, x), smoothstep(e - 100, e - 5, z), smoothstep(-e + 100, -e + 5, z));
    if (edge > 0) h += edge * 55 * (0.6 + 0.4 * n.fbm(x / 90, z / 90, 3));
    return h;
  }

  generateRaw() {
    const { n, res } = this;
    for (let j = 0; j < n; j++) {
      const z = -WORLD_HALF + j * res;
      for (let i = 0; i < n; i++) {
        const x = -WORLD_HALF + i * res;
        const rd = this.riverDistance(x, z);
        const k = j * n + i;
        this.riverDist[k] = rd;
        this.heights[k] = this.rawHeight(x, z, rd);
      }
    }
  }

  // Blend a circular flat pad into the terrain.
  applyPad(pad) {
    const { n, res } = this;
    const R = pad.r + pad.blend;
    const ex = pad.rect ? pad.rect[0] : 0;
    const ez = pad.rect ? pad.rect[1] : 0;
    const i0 = Math.max(0, Math.floor((pad.x - R - ex + WORLD_HALF) / res));
    const i1 = Math.min(n - 1, Math.ceil((pad.x + R + ex + WORLD_HALF) / res));
    const j0 = Math.max(0, Math.floor((pad.z - R - ez + WORLD_HALF) / res));
    const j1 = Math.min(n - 1, Math.ceil((pad.z + R + ez + WORLD_HALF) / res));
    for (let j = j0; j <= j1; j++) {
      const z = -WORLD_HALF + j * res;
      for (let i = i0; i <= i1; i++) {
        const x = -WORLD_HALF + i * res;
        let d;
        if (pad.rect) {
          const dx = Math.max(0, Math.abs(x - pad.x) - pad.rect[0]);
          const dz = Math.max(0, Math.abs(z - pad.z) - pad.rect[1]);
          d = Math.hypot(dx, dz) + pad.r;
        } else d = Math.hypot(x - pad.x, z - pad.z);
        if (d > R) continue;
        const w = 1 - smoothstep(pad.r, R, d);
        const k = j * n + i;
        if (this.riverDist[k] < RIVER_WIDTH / 2 + 3 && !pad.overRiver) continue;
        if (this.heights[k] < -1.0 && !pad.overWater) continue; // never reclaim the sea
        this.heights[k] = lerp(this.heights[k], pad.h, w);
        if (w > 0.8) {
          this.flags[k] |= 2;
          if (pad.mat !== undefined) this.padMat[k] = pad.mat;
        }
      }
    }
  }

  // Flattens terrain along a road. `profile` holds smoothed target heights per sample.
  applyRoad(road) {
    const { n, res } = this;
    const half = road.width / 2;
    const shoulder = 7;
    const R = half + shoulder;
    const pts = road.samples;
    const best = new Map();
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s];
      const b = pts[s + 1];
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - R + WORLD_HALF) / res));
      const i1 = Math.min(n - 1, Math.ceil((Math.max(a.x, b.x) + R + WORLD_HALF) / res));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - R + WORLD_HALF) / res));
      const j1 = Math.min(n - 1, Math.ceil((Math.max(a.z, b.z) + R + WORLD_HALF) / res));
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const l2 = abx * abx + abz * abz || 1;
      for (let j = j0; j <= j1; j++) {
        const z = -WORLD_HALF + j * res;
        for (let i = i0; i <= i1; i++) {
          const x = -WORLD_HALF + i * res;
          let t = ((x - a.x) * abx + (z - a.z) * abz) / l2;
          t = clamp(t, 0, 1);
          const px = a.x + abx * t;
          const pz = a.z + abz * t;
          const d = Math.hypot(x - px, z - pz);
          if (d > R) continue;
          const k = j * n + i;
          const prev = best.get(k);
          if (prev && prev.d <= d) continue;
          const bridge = a.bridge || b.bridge;
          best.set(k, { d, h: lerp(a.h, b.h, t), bridge });
        }
      }
    }
    for (const [k, v] of best) {
      if (v.bridge && this.riverDist[k] < RIVER_WIDTH / 2 + 4) continue; // keep the channel open under bridges
      if (this.heights[k] < SEA_LEVEL - 0.5 && v.bridge) continue;
      const w = 1 - smoothstep(half, R, v.d);
      const target = v.bridge ? Math.min(v.h, this.heights[k] + 999) : v.h;
      this.heights[k] = lerp(this.heights[k], target, w);
      if (v.d <= half + 0.5) this.flags[k] |= 1;
    }
  }

  finalizeMaterials(biomeAt) {
    const { n, res } = this;
    for (let j = 0; j < n; j++) {
      const z = -WORLD_HALF + j * res;
      for (let i = 0; i < n; i++) {
        const x = -WORLD_HALF + i * res;
        const k = j * n + i;
        const h = this.heights[k];
        if (this.flags[k] & 1) {
          this.materials[k] = TMAT.ROAD;
          continue;
        }
        if (this.padMat[k] >= 0) {
          this.materials[k] = this.padMat[k];
          continue;
        }
        const slope = this.slopeAtIndex(i, j);
        const biome = biomeAt(x, z);
        const nz = this.noise2.noise(x / 23, z / 23);
        let m = TMAT.GRASS;
        if (h < 1.6 && this.riverDist[k] < RIVER_WIDTH / 2 + 26) m = TMAT.MUD;
        else if (h < 2.2) m = TMAT.SAND;
        else if (biome === 'canyon') m = slope > 0.5 ? TMAT.REDROCK : nz > 0.2 ? TMAT.DRYGRASS : TMAT.SAND;
        else if (biome === 'mountain') m = slope > 0.55 ? TMAT.ROCK : h > 85 ? TMAT.SNOW : nz > 0.25 ? TMAT.GRAVEL : TMAT.DRYGRASS;
        else if (biome === 'forest') m = slope > 0.6 ? TMAT.ROCK : h > 40 || nz > 0.35 ? TMAT.SNOW : TMAT.FOREST;
        else if (biome === 'farmland') {
          const fx = Math.floor((x + 3000) / 46);
          const fz = Math.floor((z + 3000) / 38);
          const f = (fx * 7 + fz * 13) % 5;
          m = f === 0 ? TMAT.GRASS : f === 1 || f === 3 ? TMAT.FIELD : f === 2 ? TMAT.FIELD2 : TMAT.DIRT;
          if (slope > 0.4) m = TMAT.GRASS;
        } else if (biome === 'city' || biome === 'industrial') m = nz > 0.1 ? TMAT.DIRT : TMAT.DRYGRASS;
        else if (biome === 'coastal' || biome === 'harbor') m = nz > 0.3 ? TMAT.SAND : TMAT.DRYGRASS;
        else m = nz > 0.45 ? TMAT.DRYGRASS : nz < -0.4 ? TMAT.DIRT : TMAT.GRASS;
        if (slope > 0.9) m = biome === 'canyon' ? TMAT.REDROCK : TMAT.ROCK;
        if (h > 110) m = TMAT.SNOW;
        this.materials[k] = m;
      }
    }
  }

  slopeAtIndex(i, j) {
    const { n, res } = this;
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    const j0 = Math.max(0, j - 1);
    const j1 = Math.min(n - 1, j + 1);
    const dx = (this.heights[j * n + i1] - this.heights[j * n + i0]) / ((i1 - i0) * res);
    const dz = (this.heights[j1 * n + i] - this.heights[j0 * n + i]) / ((j1 - j0) * res);
    return Math.sqrt(dx * dx + dz * dz);
  }

  // --------------------------------------------------------------- queries
  heightAt(x, z) {
    const { n, res } = this;
    let fx = (x + WORLD_HALF) / res;
    let fz = (z + WORLD_HALF) / res;
    fx = clamp(fx, 0, n - 1.001);
    fz = clamp(fz, 0, n - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h = this.heights;
    const k = j * n + i;
    // Split each quad into two triangles to match the rendered mesh exactly.
    if (tx + tz <= 1) {
      return h[k] + (h[k + 1] - h[k]) * tx + (h[k + n] - h[k]) * tz;
    }
    return h[k + n + 1] + (h[k + n] - h[k + n + 1]) * (1 - tx) + (h[k + 1] - h[k + n + 1]) * (1 - tz);
  }

  normalAt(x, z) {
    const e = this.res;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    const nx = hl - hr;
    const nz = hd - hu;
    const ny = 2 * e;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    return { x: nx / l, y: ny / l, z: nz / l };
  }

  materialAt(x, z) {
    const { n, res } = this;
    const i = clamp(Math.round((x + WORLD_HALF) / res), 0, n - 1);
    const j = clamp(Math.round((z + WORLD_HALF) / res), 0, n - 1);
    return this.materials[j * n + i];
  }

  riverDistAt(x, z) {
    const { n, res } = this;
    const i = clamp(Math.round((x + WORLD_HALF) / res), 0, n - 1);
    const j = clamp(Math.round((z + WORLD_HALF) / res), 0, n - 1);
    return this.riverDist[j * n + i];
  }

  waterDepthAt(x, z) {
    return Math.max(0, SEA_LEVEL - this.heightAt(x, z));
  }

  isRoad(x, z) {
    const { n, res } = this;
    const i = clamp(Math.round((x + WORLD_HALF) / res), 0, n - 1);
    const j = clamp(Math.round((z + WORLD_HALF) / res), 0, n - 1);
    return (this.flags[j * n + i] & 1) !== 0;
  }

  // Ray march against the heightfield. Returns t or -1.
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    let step = 2;
    let t = 0;
    let prevT = 0;
    let prevAbove = oy - this.heightAt(ox, oz);
    if (prevAbove < 0) return 0;
    while (t < maxT) {
      t = Math.min(maxT, t + step);
      const x = ox + dx * t;
      const y = oy + dy * t;
      const z = oz + dz * t;
      if (x < -WORLD_HALF || x > WORLD_HALF || z < -WORLD_HALF || z > WORLD_HALF) return -1;
      const above = y - this.heightAt(x, z);
      if (above <= 0) {
        // refine by bisection
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          const my = oy + dy * mid;
          const ma = my - this.heightAt(ox + dx * mid, oz + dz * mid);
          if (ma > 0) lo = mid;
          else hi = mid;
        }
        return hi;
      }
      prevT = t;
      prevAbove = above;
      // Larger steps when far above ground.
      step = clamp(above * 0.5, 1, 8);
    }
    return -1;
  }
}
