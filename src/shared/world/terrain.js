// Deterministic heightmap terrain shared by simulation and client.
//
// The continent is described in config/world.js (ranges, hills, rivers, lakes,
// coasts, desert). Generation runs in phases so the layout can flatten pads
// and roads before structures are placed:
//   coarse fields (32 m) -> raw heights (4 m) -> pads -> roads -> materials.
// Large-scale shape comes from the coarse fields (cheap to evaluate); the
// full-resolution pass only adds noise detail on top, which keeps a 6 km world
// fast to generate on both the server and in the browser.
import { Noise2D, clamp, lerp, smoothstep } from '../math.js';
import { WORLD_HALF, SEA_LEVEL } from '../constants.js';
import { RIVERS, LAKES, COAST, ISLANDS, RANGES, HILLS, DESERT, FORESTS, SNOW_LINE, TERRITORY_BY_ID } from '../config/world.js';

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
  DUNE: 15,
  RAIL: 16,
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
  [0.8, 0.66, 0.44], // dune sand
  [0.33, 0.3, 0.27], // rail ballast
];

// Biome codes (coarse grid).
export const BIOME = {
  PLAINS: 0, FOREST: 1, MOUNTAIN: 2, SNOW: 3, DESERT: 4, CANYON: 5, HILLS: 6, COAST: 7, SEA: 8, FARMLAND: 9, LAKE: 10,
};
export const BIOME_NAMES = ['plains', 'forest', 'mountain', 'snow', 'desert', 'canyon', 'hills', 'coast', 'sea', 'farmland', 'lake'];

const FIELD = 32; // coarse field resolution (m)

function terrace(h, step, sharp) {
  const k = h / step;
  const f = Math.floor(k);
  const t = k - f;
  const s = smoothstep(0.5 - sharp, 0.5 + sharp, t);
  return (f + s) * step;
}

function segDist(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const l2 = abx * abx + abz * abz || 1;
  let t = ((px - ax) * abx + (pz - az) * abz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + abx * t);
  const dz = pz - (az + abz * t);
  return { d: Math.sqrt(dx * dx + dz * dz), t };
}

// Piecewise linear interpolation of a polyline [[a, b], ...] giving b for key a.
function polyAt(pts, key, keyIdx, valIdx) {
  if (key <= pts[0][keyIdx]) return pts[0][valIdx];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (key <= b[keyIdx]) return lerp(a[valIdx], b[valIdx], (key - a[keyIdx]) / (b[keyIdx] - a[keyIdx] || 1));
  }
  return pts[pts.length - 1][valIdx];
}

export class Terrain {
  constructor(seed, res = 4) {
    this.seed = seed;
    this.res = res;
    this.size = WORLD_HALF * 2;
    this.n = Math.round(this.size / res) + 1; // samples per side
    this.noise = new Noise2D(seed);
    this.noise2 = new Noise2D(seed ^ 0x5bd1e995);
    const N = this.n * this.n;
    this.heights = new Float32Array(N);
    this.materials = new Uint8Array(N);
    this.riverDist = new Float32Array(N); // distance to the nearest river bank (negative in the water)
    this.flags = new Uint8Array(N); // bit0 road, bit1 pad, bit2 rail
    this.padMat = new Int8Array(N).fill(-1);
    this.fn = Math.round(this.size / FIELD) + 1;
    const F = this.fn * this.fn;
    this.fRange = new Float32Array(F); // 0..1 mountain weight
    this.fPeak = new Float32Array(F); // mountain peak height
    this.fHill = new Float32Array(F); // hill amplitude (m)
    this.fDesert = new Float32Array(F); // 0..1
    this.fCanyon = new Float32Array(F); // 0..1
    this.fForest = new Float32Array(F); // 0..1 forest density
    this.fLand = new Float32Array(F); // approximate distance to the sea (m, positive on land)
    this.biome = new Uint8Array(F);
  }

  // ------------------------------------------------------------ coarse fields
  buildFields() {
    const { fn } = this;
    const n2 = this.noise2;
    const canyon = TERRITORY_BY_ID.kesh.center;
    for (let j = 0; j < fn; j++) {
      const z = -WORLD_HALF + j * FIELD;
      for (let i = 0; i < fn; i++) {
        const x = -WORLD_HALF + i * FIELD;
        const k = j * fn + i;
        // ranges: nearest ridge
        let rw = 0;
        let peak = 0;
        for (const r of RANGES) {
          for (let s = 0; s < r.pts.length - 1; s++) {
            const a = r.pts[s];
            const b = r.pts[s + 1];
            const { d, t } = segDist(x, z, a[0], a[1], b[0], b[1]);
            const wob = r.width * (0.85 + 0.3 * n2.noise(x / 700 + s, z / 700));
            const w = 1 - smoothstep(0, wob, d);
            if (w > rw) {
              rw = w;
              peak = lerp(a[2], b[2], t);
            }
          }
        }
        // north & east map edges become mountains too (keeps soldiers inside)
        const edgeN = smoothstep(-WORLD_HALF + 380, -WORLD_HALF + 40, z);
        const edgeE = smoothstep(WORLD_HALF - 380, WORLD_HALF - 40, x);
        const edge = Math.max(edgeN, edgeE);
        if (edge > rw) {
          rw = edge;
          peak = Math.max(peak, 180);
        }
        this.fRange[k] = rw;
        this.fPeak[k] = peak;
        let hill = 0;
        for (const [hx, hz, hr, hh] of HILLS) {
          const dx = x - hx;
          const dz = z - hz;
          const g = Math.exp(-(dx * dx + dz * dz) / (hr * hr));
          hill += g * hh;
        }
        this.fHill[k] = hill;
        const dd = Math.hypot(x - DESERT.center[0], z - DESERT.center[1]);
        this.fDesert[k] = smoothstep(DESERT.radius, DESERT.radius * 0.55, dd + n2.noise(x / 500, z / 500) * 260);
        const cd = Math.hypot(x - canyon[0], z - canyon[1]);
        this.fCanyon[k] = smoothstep(560, 300, cd + n2.noise(x / 300 + 3, z / 300) * 120);
        let forest = 0;
        for (const [fx, fz, fr, fd] of FORESTS) {
          const d = Math.hypot(x - fx, z - fz);
          forest = Math.max(forest, fd * smoothstep(fr, fr * 0.45, d + n2.noise(x / 260 + 9, z / 260) * 180));
        }
        this.fForest[k] = forest;
        this.fLand[k] = this.landDist(x, z);
      }
    }
  }

  // Bilinear sample of a coarse field.
  field(arr, x, z) {
    const { fn } = this;
    let fx = (x + WORLD_HALF) / FIELD;
    let fz = (z + WORLD_HALF) / FIELD;
    fx = fx < 0 ? 0 : fx > fn - 1.001 ? fn - 1.001 : fx;
    fz = fz < 0 ? 0 : fz > fn - 1.001 ? fn - 1.001 : fz;
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k = j * fn + i;
    const a = arr[k] + (arr[k + 1] - arr[k]) * tx;
    const b = arr[k + fn] + (arr[k + fn + 1] - arr[k + fn]) * tx;
    return a + (b - a) * tz;
  }

  // ------------------------------------------------------------ coast
  westCoastX(z) {
    return polyAt(COAST.west, z, 1, 0) + 90 * this.noise2.fbm(z / 420 + 3.3, 1.7, 3) + 14 * this.noise2.noise(z / 55, 9.1);
  }

  southCoastZ(x) {
    return polyAt(COAST.south, x, 0, 1) + 80 * this.noise2.fbm(x / 400 - 6.1, 4.2, 3) + 12 * this.noise2.noise(x / 50, 2.7);
  }

  // Signed distance-ish to the sea (positive on land).
  landDist(x, z) {
    return Math.min(x - this.westCoastX(z), this.southCoastZ(x) - z);
  }

  // ------------------------------------------------------------ rivers
  // Rasterise distance to every river bank (only near rivers).
  buildRivers() {
    const { n, res } = this;
    this.riverDist.fill(1e4);
    const R = 260;
    for (const river of RIVERS) {
      const half = river.width / 2;
      // densify with a gentle wiggle so rivers meander
      const pts = [];
      for (let i = 0; i < river.path.length - 1; i++) {
        const [ax, az] = river.path[i];
        const [bx, bz] = river.path[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(1, Math.ceil(len / 24));
        const nx = -(bz - az) / len;
        const nz = (bx - ax) / len;
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          const x = lerp(ax, bx, t);
          const z = lerp(az, bz, t);
          const w = this.noise2.noise(x / 180 + river.width, z / 180) * 45;
          pts.push([x + nx * w, z + nz * w]);
        }
      }
      pts.push(river.path[river.path.length - 1]);
      river.dense = pts;
      for (let s = 0; s < pts.length - 1; s++) {
        const [ax, az] = pts[s];
        const [bx, bz] = pts[s + 1];
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R + WORLD_HALF) / res));
        const i1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + R + WORLD_HALF) / res));
        const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R + WORLD_HALF) / res));
        const j1 = Math.min(n - 1, Math.ceil((Math.max(az, bz) + R + WORLD_HALF) / res));
        const abx = bx - ax;
        const abz = bz - az;
        const l2 = abx * abx + abz * abz || 1;
        for (let j = j0; j <= j1; j++) {
          const z = -WORLD_HALF + j * res;
          const row = j * n;
          for (let i = i0; i <= i1; i++) {
            const x = -WORLD_HALF + i * res;
            let t = ((x - ax) * abx + (z - az) * abz) / l2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const dx = x - (ax + abx * t);
            const dz = z - (az + abz * t);
            const d = Math.sqrt(dx * dx + dz * dz) - half;
            if (d < this.riverDist[row + i]) this.riverDist[row + i] = d;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ heights
  rawHeight(x, z, bank) {
    const n = this.noise;
    let h = 10 + 7 * n.fbm(x / 720 + 11, z / 720 - 7, 3) + 2.2 * n.fbm(x / 110, z / 110, 2);
    // broad rolling relief so the plains are never a table top
    const roll = n.fbm(x / 1150 - 3, z / 1150 + 8, 3);
    if (roll > 0) h += roll * roll * 70;
    const hill = this.field(this.fHill, x, z);
    if (hill > 0.4) h += hill * (0.5 + 0.5 * n.fbm(x / 260 + 7, z / 260 - 3, 3));
    const rw = this.field(this.fRange, x, z);
    if (rw > 0.004) {
      const peak = this.field(this.fPeak, x, z);
      const r = n.ridged(x / 340 + 5, z / 340 + 9, 5);
      h += peak * Math.pow(rw, 1.3) * (0.4 + 0.8 * r) + rw * 10 * n.fbm(x / 60, z / 60, 2);
    }
    const dw = this.field(this.fDesert, x, z);
    if (dw > 0.01) {
      const warp = n.fbm(x / 420, z / 420, 2) * 140;
      const s = Math.abs(Math.sin((x * 0.6 + z * 0.8 + warp) / 34));
      const dune = s * s * (2.5 + 5 * (0.5 + 0.5 * n.fbm(x / 300 + 4, z / 300, 2)));
      const outcrop = Math.max(0, n.fbm(x / 160 + 20, z / 160 - 20, 3) - 0.35) * 45;
      h = lerp(h, 7 + dune + outcrop + 3 * n.fbm(x / 500, z / 500, 2), dw * (1 - rw) * 0.85);
    }
    const cw = this.field(this.fCanyon, x, z);
    if (cw > 0.02) {
      const mesa = 32 + 12 * this.noise2.fbm(x / 210, z / 210, 3);
      const ch = Math.abs(this.noise2.fbm(x / 170 + 40, z / 170 - 40, 3));
      const cut = smoothstep(0.05, 0.16, ch);
      let mh = lerp(5, mesa, cut);
      mh = terrace(mh, 8, 0.26);
      h = lerp(h, mh, smoothstep(0.1, 0.6, cw));
    }
    // river valleys and channels
    if (bank < 240) {
      const valley = 1 - smoothstep(0, 240, bank);
      h = lerp(h, 3.8 + Math.max(0, bank) * 0.01, valley * 0.72);
      if (bank < 22) {
        const t = smoothstep(-8, 22, bank);
        h = lerp(-3.8, Math.max(h, 2.3), t);
      }
    }
    // lakes
    for (const lake of LAKES) {
      const dx = (x - lake.center[0]) / lake.radius[0];
      const dz = (z - lake.center[1]) / lake.radius[1];
      let q = Math.sqrt(dx * dx + dz * dz);
      if (q > 1.6) continue;
      q += this.noise2.noise(x / 140 + lake.depth, z / 140) * 0.12;
      if (q < 1.45) {
        const shore = Math.min(h, 1.6 + (q - 1) * 40);
        h = lerp(h, shore, smoothstep(1.45, 1.0, q));
        if (q < 1) h = lerp(1.2, -lake.depth, smoothstep(1.0, 0.72, q));
      }
      for (const isl of lake.islands) {
        const d = Math.hypot(x - isl.center[0], z - isl.center[1]);
        if (d < isl.r * 1.3) h = Math.max(h, lerp(-2, 7 + 3 * n.fbm(x / 40, z / 40, 2), smoothstep(isl.r * 1.3, isl.r * 0.55, d)));
      }
    }
    // coasts, sea and islands
    const L = this.field(this.fLand, x, z) > 420 ? 1e4 : this.landDist(x, z);
    if (L < 220) {
      if (L > 0) {
        // coastal lowlands and beaches
        const beach = 1.4 + L * 0.02;
        h = lerp(beach, h, smoothstep(0, 220, L) * (0.35 + 0.65 * smoothstep(0, 60, L)));
      } else {
        h = lerp(1.0, -16 + 4 * n.fbm(x / 200, z / 200, 2), smoothstep(0, -170, L));
      }
      if (L < 40) {
        for (const isl of ISLANDS) {
          const dx = (x - isl.center[0]) / isl.radius[0];
          const dz = (z - isl.center[1]) / isl.radius[1];
          let q = Math.sqrt(dx * dx + dz * dz);
          if (q > 1.5) continue;
          q += this.noise2.noise(x / 90 + isl.height, z / 90) * 0.14;
          const ih = q < 1 ? 1.6 + (1 - q * q) * isl.height * (0.7 + 0.3 * n.fbm(x / 80, z / 80, 2)) : lerp(1.2, -12, smoothstep(1, 1.45, q));
          h = Math.max(h, ih);
        }
      }
    }
    // west & south map edges: open sea
    const edgeSea = Math.max(smoothstep(-WORLD_HALF + 160, -WORLD_HALF + 20, x), smoothstep(WORLD_HALF - 160, WORLD_HALF - 20, z) * (x < 2000 ? 1 : 0));
    if (edgeSea > 0) h = lerp(h, -18, edgeSea);
    return h;
  }

  generateRaw() {
    this.buildFields();
    this.buildRivers();
    const { n, res } = this;
    for (let j = 0; j < n; j++) {
      const z = -WORLD_HALF + j * res;
      const row = j * n;
      for (let i = 0; i < n; i++) {
        const x = -WORLD_HALF + i * res;
        this.heights[row + i] = this.rawHeight(x, z, this.riverDist[row + i]);
      }
    }
    this.classifyBiomes();
  }

  classifyBiomes() {
    const { fn } = this;
    for (let j = 0; j < fn; j++) {
      const z = -WORLD_HALF + j * FIELD;
      for (let i = 0; i < fn; i++) {
        const x = -WORLD_HALF + i * FIELD;
        const k = j * fn + i;
        const h = this.heightAt(x, z);
        let b = BIOME.PLAINS;
        if (h < SEA_LEVEL - 0.5) b = this.fLand[k] < 0 ? BIOME.SEA : BIOME.LAKE;
        else if (h > this.snowLine(z)) b = BIOME.SNOW;
        else if (this.fRange[k] > 0.35) b = BIOME.MOUNTAIN;
        else if (this.fCanyon[k] > 0.4) b = BIOME.CANYON;
        else if (this.fDesert[k] > 0.5) b = BIOME.DESERT;
        else if (this.fLand[k] < 70) b = BIOME.COAST;
        else if (this.fForest[k] > 0.3) b = BIOME.FOREST;
        else if (this.fHill[k] > 14) b = BIOME.HILLS;
        this.biome[k] = b;
      }
    }
  }

  snowLine(z) {
    return SNOW_LINE - smoothstep(-1500, -2800, z) * 40;
  }

  biomeCode(x, z) {
    const { fn } = this;
    const i = clamp(Math.round((x + WORLD_HALF) / FIELD), 0, fn - 1);
    const j = clamp(Math.round((z + WORLD_HALF) / FIELD), 0, fn - 1);
    return this.biome[j * fn + i];
  }

  biomeAt(x, z) {
    return BIOME_NAMES[this.biomeCode(x, z)];
  }

  forestAt(x, z) {
    return this.field(this.fForest, x, z);
  }

  desertAt(x, z) {
    return this.field(this.fDesert, x, z);
  }

  // ------------------------------------------------------------ editing
  // Blend a flat pad (circle or rounded rectangle) into the terrain.
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
        if (this.riverDist[k] < 3 && !pad.overRiver) continue;
        if (this.heights[k] < -1.0 && !pad.overWater) continue; // never reclaim the sea
        if (pad.sink) {
          // underground rooms: dig below the ground, never raise it
          this.heights[k] = Math.min(this.heights[k], lerp(this.heights[k], pad.h, w));
        } else this.heights[k] = lerp(this.heights[k], pad.h, w);
        if (w > 0.8) {
          this.flags[k] |= 2;
          if (pad.mat !== undefined) this.padMat[k] = pad.mat;
        }
      }
    }
  }

  // Flattens terrain along a road or railway. Samples carry target heights (h).
  applyRoad(road) {
    const { n, res } = this;
    const half = road.width / 2;
    const shoulder = road.rail ? 6 : 7;
    const R = half + shoulder;
    const pts = road.samples;
    const best = new Map();
    const flag = road.rail ? 4 : 1;
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
      if (v.bridge && this.riverDist[k] < 4) continue; // keep the channel open under bridges
      if (this.heights[k] < SEA_LEVEL - 0.5 && v.bridge) continue;
      if (this.flags[k] & 2 && !road.overPads) {
        // inside a settlement pad: only mark, keep the pad height
        if (v.d <= half + 0.5) this.flags[k] |= flag;
        continue;
      }
      const w = 1 - smoothstep(half, R, v.d);
      this.heights[k] = lerp(this.heights[k], v.h, w);
      if (v.d <= half + 0.5) this.flags[k] |= flag;
    }
  }

  // zoneAt(x,z) -> 'city' | 'farm' | 'base' | 'village' | null (from the layout)
  finalizeMaterials(zoneAt) {
    const { n, res } = this;
    const nz2 = this.noise2;
    for (let j = 0; j < n; j++) {
      const z = -WORLD_HALF + j * res;
      const snow = this.snowLine(z);
      for (let i = 0; i < n; i++) {
        const x = -WORLD_HALF + i * res;
        const k = j * n + i;
        const h = this.heights[k];
        const f = this.flags[k];
        if (f & 1) {
          this.materials[k] = TMAT.ROAD;
          continue;
        }
        if (f & 4) {
          this.materials[k] = TMAT.RAIL;
          continue;
        }
        if (this.padMat[k] >= 0) {
          this.materials[k] = this.padMat[k];
          continue;
        }
        const slope = this.slopeAtIndex(i, j);
        const nz = nz2.noise(x / 23, z / 23);
        const nb = nz2.noise(x / 170 + 31, z / 170 - 17); // broad patches
        const bank = this.riverDist[k];
        let m;
        if (h < 1.6 && bank < 26) m = TMAT.MUD;
        else if (h < 2.4 && this.field(this.fLand, x, z) < 120 && this.landDist(x, z) < 90) m = TMAT.SAND;
        else if (h < 1.9) m = TMAT.MUD;
        else {
          const rw = this.field(this.fRange, x, z);
          const cw = this.field(this.fCanyon, x, z) + nb * 0.12;
          const dw = this.field(this.fDesert, x, z) + nb * 0.18 + nz * 0.05;
          const fw = this.field(this.fForest, x, z) + nb * 0.22 + nz * 0.06;
          const dry = smoothstep(-900, 2600, x) * 0.55 + nb * 0.35;
          const zone = zoneAt ? zoneAt(x, z) : null;
          if (h > snow + 10 * nb) m = slope > 1.05 ? TMAT.ROCK : TMAT.SNOW;
          else if (rw > 0.42 + nb * 0.1) m = slope > 0.62 ? TMAT.ROCK : h > snow - 30 && nz > -0.1 ? TMAT.SNOW : nz > 0.2 ? TMAT.GRAVEL : TMAT.DRYGRASS;
          else if (cw > 0.45) m = slope > 0.42 ? TMAT.REDROCK : nz > 0.25 ? TMAT.DRYGRASS : TMAT.SAND;
          else if (dw > 0.55) m = slope > 0.55 ? TMAT.REDROCK : nz > 0.5 ? TMAT.SAND : TMAT.DUNE;
          else if (dw > 0.38) m = nz > 0.1 ? TMAT.SAND : nz > -0.3 ? TMAT.DRYGRASS : TMAT.DIRT;
          else if (fw > 0.36) m = nz > 0.45 ? TMAT.GRASS : TMAT.FOREST;
          else if (h < 6 && this.field(this.fLand, x, z) < 100) m = nz > 0.2 ? TMAT.SAND : TMAT.DRYGRASS;
          else m = nz + dry > 0.62 ? TMAT.DRYGRASS : nz < -0.45 ? TMAT.DIRT : TMAT.GRASS;
          if (zone === 'farm' && slope < 0.35 && m !== TMAT.FOREST) {
            // patchwork of fields: irregular cells, each with its own crop
            const wx = x + nz2.noise(x / 60, z / 60) * 9;
            const wz = z + nz2.noise(x / 60 + 5, z / 60) * 9;
            const fx = Math.floor((wx + 9000) / 52);
            const fz = Math.floor((wz + 9000) / 40);
            const fh = ((fx * 73856093) ^ (fz * 19349663)) >>> 0;
            const fi = fh % 7;
            m = fi === 0 ? TMAT.GRASS : fi <= 2 ? TMAT.FIELD : fi <= 4 ? TMAT.FIELD2 : fi === 5 ? TMAT.DIRT : TMAT.DRYGRASS;
            // hedgerows along field edges
            const ex = ((wx + 9000) % 52) / 52;
            const ez = ((wz + 9000) % 40) / 40;
            if (ex < 0.035 || ez < 0.045) m = TMAT.GRASS;
          } else if (zone === 'city' || zone === 'base') m = nz > 0.1 ? TMAT.DIRT : dw > 0.4 ? TMAT.SAND : TMAT.DRYGRASS;
          if (slope > 0.95 && m !== TMAT.SNOW) m = cw > 0.3 || dw > 0.4 ? TMAT.REDROCK : TMAT.ROCK;
        }
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

  slopeAt(x, z) {
    const { n, res } = this;
    return this.slopeAtIndex(clamp(Math.round((x + WORLD_HALF) / res), 0, n - 1), clamp(Math.round((z + WORLD_HALF) / res), 0, n - 1));
  }

  // --------------------------------------------------------------- queries
  heightAt(x, z) {
    const { n, res } = this;
    let fx = (x + WORLD_HALF) / res;
    let fz = (z + WORLD_HALF) / res;
    fx = fx < 0 ? 0 : fx > n - 1.001 ? n - 1.001 : fx;
    fz = fz < 0 ? 0 : fz > n - 1.001 ? n - 1.001 : fz;
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

  index(x, z) {
    const { n, res } = this;
    const i = clamp(Math.round((x + WORLD_HALF) / res), 0, n - 1);
    const j = clamp(Math.round((z + WORLD_HALF) / res), 0, n - 1);
    return j * n + i;
  }

  materialAt(x, z) {
    return this.materials[this.index(x, z)];
  }

  riverDistAt(x, z) {
    return this.riverDist[this.index(x, z)];
  }

  waterDepthAt(x, z) {
    return Math.max(0, SEA_LEVEL - this.heightAt(x, z));
  }

  isRoad(x, z) {
    return (this.flags[this.index(x, z)] & 1) !== 0;
  }

  isRail(x, z) {
    return (this.flags[this.index(x, z)] & 4) !== 0;
  }

  // Ray march against the heightfield. Returns t or -1.
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    let step = 2;
    let t = 0;
    let prevT = 0;
    const prevAbove = oy - this.heightAt(ox, oz);
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
      // Larger steps when far above ground.
      step = clamp(above * 0.5, 1, 12);
    }
    return -1;
  }
}
