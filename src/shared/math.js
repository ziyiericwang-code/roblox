// Shared math utilities used by the simulation (server/solo) and the client.
// Everything here is pure and deterministic so both sides agree on results.

export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function invLerp(a, b, v) {
  return b === a ? 0 : (v - a) / (b - a);
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function angleDiff(a, b) {
  return wrapAngle(b - a);
}

export function approachAngle(a, target, maxStep) {
  const d = angleDiff(a, target);
  if (Math.abs(d) <= maxStep) return target;
  return a + Math.sign(d) * maxStep;
}

export function approach(v, target, maxStep) {
  if (v < target) return Math.min(target, v + maxStep);
  return Math.max(target, v - maxStep);
}

// Yaw convention: yaw 0 faces -Z ("north"), positive yaw turns left (three.js rotation.y).
export function forwardFromYaw(yaw) {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

export function yawFromDir(dx, dz) {
  return Math.atan2(-dx, -dz);
}

export function dirFromYawPitch(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function dist2DSq(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export function dist3(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function len3(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z);
}

export function normalize3(v) {
  const l = len3(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

export function angleBetween(a, b) {
  const la = len3(a.x, a.y, a.z) || 1;
  const lb = len3(b.x, b.y, b.z) || 1;
  const d = clamp((a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb), -1, 1);
  return Math.acos(d);
}

// Distance from point p to segment ab in 2D (x/z).
export function pointSegDist2D(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return Math.sqrt((px - cx) * (px - cx) + (pz - cz) * (pz - cz));
}

// Closest distance between an infinite ray (o + d*t, t in [0,maxT]) and point p.
export function rayPointDist(o, d, maxT, p) {
  const t = clamp((p.x - o.x) * d.x + (p.y - o.y) * d.y + (p.z - o.z) * d.z, 0, maxT);
  const cx = o.x + d.x * t - p.x;
  const cy = o.y + d.y * t - p.y;
  const cz = o.z + d.z * t - p.z;
  return { dist: Math.sqrt(cx * cx + cy * cy + cz * cz), t };
}

// ---------------------------------------------------------------------------
// Ray intersection primitives. Directions are assumed normalized.
// ---------------------------------------------------------------------------

export function rayAABB(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1, maxT) {
  let tmin = 0;
  let tmax = maxT;
  if (Math.abs(dx) < 1e-9) {
    if (ox < x0 || ox > x1) return -1;
  } else {
    const inv = 1 / dx;
    let t1 = (x0 - ox) * inv;
    let t2 = (x1 - ox) * inv;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < y0 || oy > y1) return -1;
  } else {
    const inv = 1 / dy;
    let t1 = (y0 - oy) * inv;
    let t2 = (y1 - oy) * inv;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < z0 || oz > z1) return -1;
  } else {
    const inv = 1 / dz;
    let t1 = (z0 - oz) * inv;
    let t2 = (z1 - oz) * inv;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

export function raySphere(o, d, c, r, maxT) {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  if (t < 0 || t > maxT) return -1;
  return t;
}

// Ray vs capsule (segment a-b with radius r). Returns t or -1.
export function rayCapsule(o, d, a, b, r, maxT) {
  const bax = b.x - a.x;
  const bay = b.y - a.y;
  const baz = b.z - a.z;
  const oax = o.x - a.x;
  const oay = o.y - a.y;
  const oaz = o.z - a.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * d.x + bay * d.y + baz * d.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = d.x * oax + d.y * oay + d.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const A = baba - bard * bard;
  let B = baba * rdoa - baoa * bard;
  let C = baba * oaoa - baoa * baoa - r * r * baba;
  let h = B * B - A * C;
  if (h >= 0 && A > 1e-9) {
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t >= 0 && t <= maxT) return t;
  }
  // caps
  const t1 = raySphere(o, d, a, r, maxT);
  const t2 = raySphere(o, d, b, r, maxT);
  if (t1 < 0) return t2;
  if (t2 < 0) return t1;
  return Math.min(t1, t2);
}

// ---------------------------------------------------------------------------
// Deterministic random numbers and noise.
// ---------------------------------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hash2(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class Rng {
  constructor(seed) {
    this.next = mulberry32(seed);
  }
  float(lo = 0, hi = 1) {
    return lo + (hi - lo) * this.next();
  }
  int(lo, hi) {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  weighted(entries) {
    // entries: [{w, v}]
    let total = 0;
    for (const e of entries) total += Math.max(0, e.w);
    if (total <= 0) return entries.length ? entries[0].v : undefined;
    let r = this.next() * total;
    for (const e of entries) {
      r -= Math.max(0, e.w);
      if (r <= 0) return e.v;
    }
    return entries[entries.length - 1].v;
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }
}

// 2D gradient noise (Perlin style), deterministic by seed.
export class Noise2D {
  constructor(seed) {
    const rand = mulberry32(seed);
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  static grad(h, x, y) {
    switch (h & 7) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  }
  noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const p = this.perm;
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    const g = Noise2D.grad;
    const x1 = lerp(g(aa, xf, yf), g(ba, xf - 1, yf), u);
    const x2 = lerp(g(ab, xf, yf - 1), g(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 0.7071; // roughly [-1, 1]
  }
  fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
  ridged(x, y, octaves = 4) {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let prev = 1;
    for (let i = 0; i < octaves; i++) {
      let n = 1 - Math.abs(this.noise(x * freq, y * freq));
      n *= n;
      sum += n * amp * prev;
      prev = n;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum;
  }
}

// Simple fixed-cell spatial hash for dynamic entities (x/z plane).
export class SpatialHash {
  constructor(cellSize = 32) {
    this.cell = cellSize;
    this.map = new Map();
    this.where = new Map();
  }
  key(cx, cz) {
    return (cx + 1024) * 4096 + (cz + 1024);
  }
  update(obj, x, z) {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    const k = this.key(cx, cz);
    const old = this.where.get(obj);
    if (old === k) return;
    if (old !== undefined) {
      const set = this.map.get(old);
      if (set) {
        set.delete(obj);
        if (set.size === 0) this.map.delete(old);
      }
    }
    let set = this.map.get(k);
    if (!set) {
      set = new Set();
      this.map.set(k, set);
    }
    set.add(obj);
    this.where.set(obj, k);
  }
  remove(obj) {
    const old = this.where.get(obj);
    if (old === undefined) return;
    const set = this.map.get(old);
    if (set) {
      set.delete(obj);
      if (set.size === 0) this.map.delete(old);
    }
    this.where.delete(obj);
  }
  // Calls fn(obj) for every object in cells overlapping the circle. Caller filters exact distance.
  query(x, z, r, fn) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c);
    const x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c);
    const z1 = Math.floor((z + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const set = this.map.get(this.key(cx, cz));
        if (!set) continue;
        for (const o of set) fn(o);
      }
    }
  }
}

export function formatTime(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}
