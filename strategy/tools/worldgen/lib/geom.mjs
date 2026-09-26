// Arc smoothing, simplification and compact binary encoding.

// Douglas-Peucker on an interleaved Float64Array/Array [x0,y0,x1,y1,...], endpoints kept.
export function simplify(pts, tol) {
  const n = pts.length / 2;
  if (n <= 2) return Array.from(pts);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = tol * tol;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a * 2];
    const ay = pts[a * 2 + 1];
    const bx = pts[b * 2];
    const by = pts[b * 2 + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tol2;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2] - ax;
      const py = pts[i * 2 + 1] - ay;
      let d2;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const qx = px - t * dx;
        const qy = py - t * dy;
        d2 = qx * qx + qy * qy;
      }
      if (d2 > bestD) {
        bestD = d2;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

// Closed loops: simplify two halves split at the farthest point from the start.
export function simplifyLoop(pts, tol) {
  const n = pts.length / 2;
  if (n <= 4) return Array.from(pts);
  let far = 1;
  let fd = -1;
  for (let i = 1; i < n - 1; i++) {
    const dx = pts[i * 2] - pts[0];
    const dy = pts[i * 2 + 1] - pts[1];
    const d = dx * dx + dy * dy;
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const a = simplify(pts.slice(0, (far + 1) * 2), tol);
  const b = simplify(pts.slice(far * 2), tol);
  return a.concat(b.slice(2));
}

// Chaikin corner cutting with fixed endpoints (open) or wrapping (closed loop,
// where the first and last points coincide and are fixed as well).
export function chaikin(pts, iterations) {
  let p = Array.from(pts);
  for (let it = 0; it < iterations; it++) {
    const n = p.length / 2;
    if (n < 3) return p;
    const out = [p[0], p[1]];
    for (let i = 0; i < n - 1; i++) {
      const x0 = p[i * 2];
      const y0 = p[i * 2 + 1];
      const x1 = p[i * 2 + 2];
      const y1 = p[i * 2 + 3];
      if (i > 0) out.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1);
      if (i < n - 2) out.push(0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1);
    }
    out.push(p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
    p = out;
  }
  return p;
}

// Smooth a raw staircase arc into a clean line at the given final tolerance (pixels).
export function smoothArc(raw, finalTol, loop) {
  const s = loop ? simplifyLoop : simplify;
  let p = s(raw, 0.72);
  p = chaikin(p, 2);
  return s(p, finalTol);
}

// Zigzag varint writer
export class ByteWriter {
  constructor() {
    this.buf = new Uint8Array(1 << 20);
    this.len = 0;
  }
  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  }
  uvar(v) {
    this.ensure(10);
    v = Math.floor(v);
    while (v >= 0x80) {
      this.buf[this.len++] = (v & 0x7f) | 0x80;
      v = Math.floor(v / 128);
    }
    this.buf[this.len++] = v;
  }
  svar(v) {
    this.uvar(v >= 0 ? v * 2 : -v * 2 - 1);
  }
  bytes() {
    return this.buf.subarray(0, this.len);
  }
}

// Encode arcs (arrays of pixel-space points) quantized to 1/Q pixel.
// Layout: uvar(arcCount); per arc: uvar(pointCount), svar(x0), svar(y0), then svar deltas.
export function encodeArcs(arcList, Q) {
  const w = new ByteWriter();
  w.uvar(arcList.length);
  for (const pts of arcList) {
    const n = pts.length / 2;
    w.uvar(n);
    let px = 0;
    let py = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.round(pts[i * 2] * Q);
      const y = Math.round(pts[i * 2 + 1] * Q);
      w.svar(x - px);
      w.svar(y - py);
      px = x;
      py = y;
    }
  }
  return w.bytes();
}
