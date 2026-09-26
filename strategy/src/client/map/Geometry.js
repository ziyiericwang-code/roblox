// Decodes the world geometry package into GPU-ready meshes:
//  - fill mesh (land provinces, sea zones and lakes) with a per-vertex region id
//  - border mesh (one quad per arc segment) carrying the ids on both sides
//  - a triangle grid for exact CPU picking
import earcut from 'earcut';
import { millerY } from '../../shared/world.js';

export function decodeArcs(bytes, grid) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x31574347) throw new Error('bad geometry package');
  const len0 = dv.getUint32(4, true);
  const len1 = dv.getUint32(8, true);
  const cell = 360 / grid.W;
  const Q = grid.q;
  const latRows = new Map();
  const toY = (py) => {
    const k = Math.round(py * Q);
    let v = latRows.get(k);
    if (v === undefined) {
      v = millerY(grid.latMax - (k / Q) * cell);
      latRows.set(k, v);
    }
    return v;
  };
  const read = (start, end) => {
    let o = start;
    const uvar = () => {
      let v = 0;
      let mul = 1;
      for (;;) {
        const b = bytes[o++];
        v += (b & 0x7f) * mul;
        if (b < 0x80) return v;
        mul *= 128;
      }
    };
    const svar = () => {
      const u = uvar();
      return u % 2 ? -(u + 1) / 2 : u / 2;
    };
    const n = uvar();
    const arcs = new Array(n);
    for (let a = 0; a < n; a++) {
      const m = uvar();
      const pts = new Float32Array(m * 2);
      let x = 0;
      let y = 0;
      for (let i = 0; i < m; i++) {
        x += svar();
        y += svar();
        pts[i * 2] = (x / Q) * cell - 180;
        pts[i * 2 + 1] = toY(y / Q);
      }
      arcs[a] = pts;
    }
    if (o !== end) throw new Error('geometry decode mismatch');
    return arcs;
  };
  return { lod0: read(12, 12 + len0), lod1: read(12 + len0, 12 + len0 + len1) };
}

// Assemble a ring (list of signed arc refs) into a flat coordinate array.
function assembleRing(refs, arcs) {
  const out = [];
  for (const r of refs) {
    const a = arcs[Math.abs(r) - 1];
    const n = a.length / 2;
    const fwd = r > 0;
    const fx = fwd ? a[0] : a[(n - 1) * 2];
    let shift = 0;
    if (out.length) shift = Math.round((out[out.length - 2] - fx) / 360) * 360;
    for (let i = out.length ? 1 : 0; i < n; i++) {
      const j = fwd ? i : n - 1 - i;
      out.push(a[j * 2] + shift, a[j * 2 + 1]);
    }
  }
  // drop closing duplicate
  const m = out.length;
  if (m >= 4 && Math.abs(out[0] - out[m - 2]) < 1e-6 && Math.abs(out[1] - out[m - 1]) < 1e-6) out.length = m - 2;
  return out;
}

function signedArea(r) {
  let s = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
  }
  return s / 2;
}

function pointInRing(x, y, r) {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2];
    const yi = r[i * 2 + 1];
    const xj = r[j * 2];
    const yj = r[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Triangulate every region. Returns interleaved positions, ids, indices, and per-region bounds.
export function buildFill(world, arcs) {
  const { json, P, S } = world;
  const regions = [...json.rings.land, ...json.rings.sea, json.rings.lake];
  const pos = [];
  const ids = [];
  const idx = [];
  const bounds = new Float32Array(regions.length * 4);
  regions.forEach((rings, id) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const outers = [];
    const holes = [];
    for (const refs of rings) {
      const r = assembleRing(refs, arcs);
      if (r.length < 6) continue;
      const a = signedArea(r);
      if (a > 0) outers.push({ r, a, holes: [] });
      else holes.push(r);
      for (let i = 0; i < r.length; i += 2) {
        if (r[i] < minX) minX = r[i];
        if (r[i] > maxX) maxX = r[i];
        if (r[i + 1] < minY) minY = r[i + 1];
        if (r[i + 1] > maxY) maxY = r[i + 1];
      }
    }
    for (const h of holes) {
      let best = null;
      for (const o of outers) {
        if (pointInRing(h[0], h[1], o.r) && (!best || o.a < best.a)) best = o;
      }
      if (best) best.holes.push(h);
    }
    for (const o of outers) {
      const flat = o.r.slice();
      const holeIdx = [];
      for (const h of o.holes) {
        holeIdx.push(flat.length / 2);
        for (const v of h) flat.push(v);
      }
      const tri = earcut(flat, holeIdx);
      const base = pos.length / 2;
      for (const v of flat) pos.push(v);
      for (let i = 0; i < flat.length / 2; i++) ids.push(id);
      for (const t of tri) idx.push(base + t);
    }
    bounds[id * 4] = minX;
    bounds[id * 4 + 1] = minY;
    bounds[id * 4 + 2] = maxX;
    bounds[id * 4 + 3] = maxY;
  });
  void P;
  void S;
  return { pos: new Float32Array(pos), ids: new Float32Array(ids), idx: new Uint32Array(idx), bounds, regionCount: regions.length };
}

// One quad per segment. Per vertex: x, y, nx, ny, side, idA, idB, dist.
export const BORDER_STRIDE = 8;
export function buildBorders(world, arcs) {
  const { json, P, S } = world;
  const A = json.arcs.a;
  const B = json.arcs.b;
  const lake = P + S;
  let segs = 0;
  for (const a of arcs) segs += a.length / 2 - 1;
  const v = new Float32Array(segs * 4 * BORDER_STRIDE);
  const idx = new Uint32Array(segs * 6);
  let vo = 0;
  let io = 0;
  let vc = 0;
  arcs.forEach((pts, ai) => {
    const a = A[ai] < 0 ? -1 : A[ai];
    const b = B[ai] < 0 ? -1 : B[ai];
    if (a === -1 || b === -1) return;
    if (a === lake && b === lake) return;
    const n = pts.length / 2;
    let dist = 0;
    for (let i = 0; i < n - 1; i++) {
      const x0 = pts[i * 2];
      const y0 = pts[i * 2 + 1];
      const x1 = pts[i * 2 + 2];
      const y1 = pts[i * 2 + 3];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1e-6;
      const nx = -dy / len;
      const ny = dx / len;
      const put = (x, y, side, d) => {
        v[vo++] = x;
        v[vo++] = y;
        v[vo++] = nx;
        v[vo++] = ny;
        v[vo++] = side;
        v[vo++] = a;
        v[vo++] = b;
        v[vo++] = d;
      };
      put(x0, y0, -1, dist);
      put(x0, y0, 1, dist);
      put(x1, y1, -1, dist + len);
      put(x1, y1, 1, dist + len);
      idx[io++] = vc;
      idx[io++] = vc + 1;
      idx[io++] = vc + 2;
      idx[io++] = vc + 1;
      idx[io++] = vc + 3;
      idx[io++] = vc + 2;
      vc += 4;
      dist += len;
    }
  });
  return { verts: v.subarray(0, vo), idx: idx.subarray(0, io) };
}

// Uniform grid of triangles for picking.
export class PickGrid {
  constructor(fill, cell = 2) {
    this.cell = cell;
    this.cols = Math.ceil(400 / cell);
    this.rows = Math.ceil(200 / cell);
    this.x0 = -200;
    this.y0 = -80;
    this.fill = fill;
    const buckets = Array.from({ length: this.cols * this.rows }, () => []);
    const { pos, idx } = fill;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 2;
      const b = idx[t + 1] * 2;
      const c = idx[t + 2] * 2;
      const minX = Math.min(pos[a], pos[b], pos[c]);
      const maxX = Math.max(pos[a], pos[b], pos[c]);
      const minY = Math.min(pos[a + 1], pos[b + 1], pos[c + 1]);
      const maxY = Math.max(pos[a + 1], pos[b + 1], pos[c + 1]);
      const cx0 = Math.max(0, Math.floor((minX - this.x0) / cell));
      const cx1 = Math.min(this.cols - 1, Math.floor((maxX - this.x0) / cell));
      const cy0 = Math.max(0, Math.floor((minY - this.y0) / cell));
      const cy1 = Math.min(this.rows - 1, Math.floor((maxY - this.y0) / cell));
      for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) buckets[y * this.cols + x].push(t);
    }
    this.buckets = buckets.map((b) => Uint32Array.from(b));
  }
  pick(x, y) {
    for (const xx of [x, x + 360, x - 360]) {
      const r = this.pickRaw(xx, y);
      if (r >= 0) return r;
    }
    return -1;
  }
  pickRaw(x, y) {
    const cx = Math.floor((x - this.x0) / this.cell);
    const cy = Math.floor((y - this.y0) / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return -1;
    const { pos, idx, ids } = this.fill;
    for (const t of this.buckets[cy * this.cols + cx]) {
      const a = idx[t] * 2;
      const b = idx[t + 1] * 2;
      const c = idx[t + 2] * 2;
      const d1 = (x - pos[b]) * (pos[a + 1] - pos[b + 1]) - (pos[a] - pos[b]) * (y - pos[b + 1]);
      const d2 = (x - pos[c]) * (pos[b + 1] - pos[c + 1]) - (pos[b] - pos[c]) * (y - pos[c + 1]);
      const d3 = (x - pos[a]) * (pos[c + 1] - pos[a + 1]) - (pos[c] - pos[a]) * (y - pos[a + 1]);
      const neg = d1 < 0 || d2 < 0 || d3 < 0;
      const posi = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && posi)) return ids[idx[t]];
    }
    return -1;
  }
}
