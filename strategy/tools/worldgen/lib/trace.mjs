// Boundary tracing on the raster's corner lattice.
// Produces shared "arcs" (each border piece stored once) and, per region, rings made
// of signed arc references. Neighbouring regions therefore share identical geometry.
import { W, H } from './raster.mjs';

const DX = [1, 0, -1, 0]; // dir 0=E 1=S 2=W 3=N
const DY = [0, 1, 0, -1];

export function traceArcs(L, regionCount) {
  const lab = (x, y) => (y < 0 || y >= H ? -1 : L[y * W + (x < 0 ? x + W : x >= W ? x - W : x)]);
  const visited = new Uint8Array(W * (H + 1));
  const arcs = []; // Int32Array of interleaved x,y (unwrapped corner coords)
  const arcPair = []; // [a, b] labels of the arc (a = left side in stored orientation)
  const arcKey = new Map();
  const rings = Array.from({ length: regionCount }, () => []);

  // outgoing directions for label a at corner (cx, cy)
  function around(cx, cy) {
    const NW = lab(cx - 1, cy - 1);
    const NE = lab(cx, cy - 1);
    const SW = lab(cx - 1, cy);
    const SE = lab(cx, cy);
    return [NW, NE, SW, SE];
  }
  function isNode(nw, ne, sw, se) {
    if (nw === se && ne === sw && nw !== ne) return true; // saddle
    let d = 1;
    const s = [nw];
    for (const v of [ne, sw, se]) {
      if (!s.includes(v)) {
        s.push(v);
        d++;
      }
    }
    return d >= 3;
  }
  // outgoing label for each dir, and neighbour on the right side of that segment
  function outs(nw, ne, sw, se) {
    return [
      ne !== se ? ne : -9, // E: belongs to NE, neighbour SE
      sw !== se ? se : -9, // S: belongs to SE, neighbour SW
      nw !== sw ? sw : -9, // W: belongs to SW, neighbour NW
      nw !== ne ? nw : -9, // N: belongs to NW, neighbour NE
    ];
  }
  const rightOf = (d, nw, ne, sw, se) => (d === 0 ? se : d === 1 ? sw : d === 2 ? nw : ne);
  const wrap = (x) => (x < 0 ? x + W : x >= W ? x - W : x);

  for (let cy = 0; cy <= H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const v = visited[cy * W + cx];
      if (v === 15) continue;
      const [nw, ne, sw, se] = around(cx, cy);
      const o = outs(nw, ne, sw, se);
      for (let d0 = 0; d0 < 4; d0++) {
        const a = o[d0];
        if (a < 0 || visited[cy * W + cx] & (1 << d0)) continue;
        traceRing(cx, cy, d0, a);
      }
    }
  }

  function traceRing(sx, sy, sd, a) {
    const xs = [];
    const ys = [];
    const nbs = [];
    const nodes = [];
    let cx = sx;
    let cy = sy;
    let ux = sx; // unwrapped x
    let d = sd;
    for (let guard = 0; guard < 50_000_000; guard++) {
      const [nw, ne, sw, se] = around(cx, cy);
      xs.push(ux);
      ys.push(cy);
      nodes.push(isNode(nw, ne, sw, se));
      nbs.push(rightOf(d, nw, ne, sw, se));
      visited[cy * W + cx] |= 1 << d;
      cx = wrap(cx + DX[d]);
      ux += DX[d];
      cy += DY[d];
      const [nw2, ne2, sw2, se2] = around(cx, cy);
      const o = outs(nw2, ne2, sw2, se2);
      const left = (d + 3) % 4;
      const right = (d + 1) % 4;
      let nd;
      if (o[left] === a) nd = left;
      else if (o[d] === a) nd = d;
      else if (o[right] === a) nd = right;
      else nd = (d + 2) % 4;
      if (cx === sx && cy === sy && nd === sd) break;
      d = nd;
    }
    if (a >= regionCount) return;
    const n = xs.length;
    const ring = [];
    let first = nodes.indexOf(true);
    if (first < 0) {
      // closed loop with a single neighbour
      const b = nbs[0];
      let m = 0;
      for (let i = 1; i < n; i++) {
        const ci = ys[i] * W + wrap(xs[i]);
        const cm = ys[m] * W + wrap(xs[m]);
        if (ci < cm) m = i;
      }
      const key = `${Math.min(a, b)},${Math.max(a, b)},L,${ys[m] * W + wrap(xs[m])}`;
      let id = arcKey.get(key);
      const forward = a < b;
      if (id === undefined) {
        const pts = new Int32Array((n + 1) * 2);
        for (let i = 0; i <= n; i++) {
          const j = (m + i) % n;
          pts[i * 2] = xs[j];
          pts[i * 2 + 1] = ys[j];
        }
        id = storeArc(pts, forward ? [a, b] : [b, a], !forward);
        arcKey.set(key, id);
      }
      ring.push(forward ? id + 1 : -(id + 1));
      rings[a].push(ring);
      return;
    }
    // split at nodes
    let i = first;
    do {
      let j = (i + 1) % n;
      while (!nodes[j]) j = (j + 1) % n;
      const b = nbs[i];
      const len = ((j - i + n) % n || n) + 1;
      const s = ys[i] * W + wrap(xs[i]);
      const e = ys[j] * W + wrap(xs[j]);
      const forward = a < b;
      const key = forward ? `${a},${b},${s},${e}` : `${b},${a},${e},${s}`;
      let id = arcKey.get(key);
      if (id === undefined) {
        const pts = new Int32Array(len * 2);
        let base = xs[i];
        let prev = xs[i];
        for (let k = 0; k < len; k++) {
          const q = (i + k) % n;
          let x = xs[q];
          // keep the piece continuous when it wraps around the ring start
          if (k > 0) {
            while (x - prev > W / 2) x -= W;
            while (prev - x > W / 2) x += W;
          }
          prev = x;
          pts[k * 2] = x;
          pts[k * 2 + 1] = ys[q];
        }
        void base;
        id = storeArc(pts, forward ? [a, b] : [b, a], !forward);
        arcKey.set(key, id);
      }
      ring.push(forward ? id + 1 : -(id + 1));
      i = j;
    } while (i !== first);
    rings[a].push(ring);
  }

  function storeArc(pts, pair, reverse) {
    let out = pts;
    if (reverse) {
      const n = pts.length / 2;
      out = new Int32Array(pts.length);
      for (let k = 0; k < n; k++) {
        out[k * 2] = pts[(n - 1 - k) * 2];
        out[k * 2 + 1] = pts[(n - 1 - k) * 2 + 1];
      }
    }
    arcs.push(out);
    arcPair.push(pair);
    return arcs.length - 1;
  }

  return { arcs, arcPair, rings };
}
