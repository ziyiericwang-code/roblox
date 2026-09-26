// Seeded RNG, binary heap and small helpers used across the simulation.

export class Rng {
  constructor(seed = 1) {
    this.s = [seed >>> 0 || 1, 0x9e3779b9, 0x243f6a88, 0xb7e15162];
    for (let i = 0; i < 12; i++) this.next();
  }
  next() {
    // sfc32
    let [a, b, c, d] = this.s;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.s = [a, b, c, d];
    return (t >>> 0) / 4294967296;
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  int(n) {
    return Math.floor(this.next() * n);
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  // triangular noise in [1-w, 1+w]
  tri(w) {
    return 1 + (this.next() + this.next() - 1) * w;
  }
  get state() {
    return this.s.slice();
  }
  set state(v) {
    this.s = v.slice();
  }
}

export class Heap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
  topKey() {
    return this.k[0];
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export function dateOf(turn, start) {
  const d = new Date(Date.UTC(start.year, start.month - 1, start.day));
  d.setUTCDate(d.getUTCDate() + turn * 7);
  return d;
}
export function dateLabel(turn, start) {
  const d = dateOf(turn, start);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
