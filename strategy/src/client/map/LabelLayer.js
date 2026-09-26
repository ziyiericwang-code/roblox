// Canvas2D overlay for text: countries, regions, provinces, cities, seas and unit captions.
// Redrawn only when the camera or the labelled data changes. Greedy collision on a coarse grid.

export class LabelLayer {
  constructor(canvas, world, renderer) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.r = renderer;
    this.extra = []; // dynamic labels: {x, y, text, color, size, prio}
    this.countryName = (c) => world.countries[c].name;
    this.ownerOf = (p) => world.provinces.country[p];
    this.computeAnchors();
  }

  // country label anchors from the largest connected block of provinces
  computeAnchors() {
    const w = this.world;
    const P = w.P;
    const owner = new Int32Array(P);
    for (let p = 0; p < P; p++) owner[p] = this.ownerOf(p);
    const seen = new Uint8Array(P);
    const best = new Map();
    for (let p = 0; p < P; p++) {
      if (seen[p]) continue;
      const c = owner[p];
      const block = [];
      const stack = [p];
      seen[p] = 1;
      while (stack.length) {
        const a = stack.pop();
        block.push(a);
        for (let k = w.adjStart[a]; k < w.adjStart[a + 1]; k++) {
          const b = w.adjTo[k];
          if (b < P && !seen[b] && owner[b] === c) {
            seen[b] = 1;
            stack.push(b);
          }
        }
      }
      const km = block.reduce((s, q) => s + w.provinces.km2[q], 0);
      const prev = best.get(c);
      if (!prev || km > prev.km) best.set(c, { km, block });
    }
    this.anchors = [];
    for (const [c, { km, block }] of best) {
      let sx = 0;
      let sy = 0;
      const x0 = w.wx(block[0]);
      for (const q of block) {
        let dx = w.wx(q) - x0;
        if (dx > 180) dx -= 360;
        if (dx < -180) dx += 360;
        sx += dx * w.provinces.km2[q];
        sy += w.wy(q) * w.provinces.km2[q];
      }
      const cx = x0 + sx / km;
      const cy = sy / km;
      let pick = block[0];
      let bd = Infinity;
      for (const q of block) {
        let dx = w.wx(q) - cx;
        if (dx > 180) dx -= 360;
        const d = dx * dx + (w.wy(q) - cy) ** 2;
        if (d < bd) {
          bd = d;
          pick = q;
        }
      }
      // spread along the block's horizontal extent for long countries
      let minX = Infinity;
      let maxX = -Infinity;
      for (const q of block) {
        let dx = w.wx(q) - cx;
        if (dx > 180) dx -= 360;
        if (dx < -180) dx += 360;
        minX = Math.min(minX, dx);
        maxX = Math.max(maxX, dx);
      }
      const inside = bd < 25;
      this.anchors.push({ c, x: inside ? cx : w.wx(pick), y: inside ? cy : w.wy(pick), km, span: maxX - minX });
    }
    this.anchors.sort((a, b) => b.km - a.km);
  }

  resize(dpr, w, h) {
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.dpr = dpr;
  }

  draw() {
    const { ctx, world: w, r } = this;
    const z = r.camera.zoom;
    const W = r.cssW;
    const H = r.cssH;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const cell = 12;
    const cols = Math.ceil(W / cell) + 1;
    const occ = new Uint8Array(cols * (Math.ceil(H / cell) + 1));
    const tryPlace = (x, y, tw, th) => {
      const x0 = Math.floor((x - tw / 2) / cell);
      const x1 = Math.floor((x + tw / 2) / cell);
      const y0 = Math.floor((y - th / 2) / cell);
      const y1 = Math.floor((y + th / 2) / cell);
      if (x0 < 0 || y0 < 0 || x1 >= cols || y1 * cols >= occ.length) return false;
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) if (occ[yy * cols + xx]) return false;
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) occ[yy * cols + xx] = 1;
      return true;
    };
    const onScreen = (sx, sy, m = 40) => sx > -m && sx < W + m && sy > -m && sy < H + m;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // dynamic labels first (unit captions, battle tags): highest priority
    for (const l of this.extra) {
      const [bx, by] = r.worldToScreen(l.x, l.y);
      const sx = bx + (l.dx || 0);
      const sy = by + (l.dy || 0);
      if (!onScreen(sx, sy)) continue;
      ctx.font = `${l.weight || 600} ${l.size || 11}px Inter, system-ui, sans-serif`;
      const tw = ctx.measureText(l.text).width + 6;
      if (!l.force && !tryPlace(sx, sy, tw, (l.size || 11) + 4)) continue;
      this.text(l.text, sx, sy, l.color || '#fff', l.halo || 'rgba(8,12,18,0.85)');
    }

    // cities
    const cities = w.cities;
    const nC = cities.name.length;
    const cityMin = z < 3 ? 6e6 : z < 5 ? 2.5e6 : z < 8 ? 1e6 : z < 14 ? 3e5 : z < 25 ? 1e5 : 0;
    for (let i = 0; i < nC; i++) {
      const pop = cities.pop[i];
      const cap = cities.cap[i];
      if (pop < cityMin && !(cap && z > 6.5)) continue;
      const [wx, wy] = w.pxToWorld(cities.x[i], cities.y[i]);
      const [sx, sy] = r.worldToScreen(wx, wy);
      if (!onScreen(sx, sy, 10)) continue;
      const size = pop > 1e7 ? 11.5 : pop > 3e6 ? 11 : 10;
      ctx.font = `${cap ? 600 : 500} ${size}px Inter, system-ui, sans-serif`;
      const tw = ctx.measureText(cities.name[i]).width;
      if (!tryPlace(sx + tw / 2 + 6, sy, tw + 8, size + 3)) continue;
      ctx.beginPath();
      if (cap) {
        this.star(sx, sy, 4.2);
      } else ctx.arc(sx, sy, pop > 3e6 ? 2.8 : 2.1, 0, Math.PI * 2);
      ctx.fillStyle = cap ? '#f3dfa6' : '#e9edf2';
      ctx.strokeStyle = 'rgba(10,14,20,0.9)';
      ctx.lineWidth = 1.2;
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'left';
      this.text(cities.name[i], sx + 6, sy, '#eef2f6', 'rgba(10,14,20,0.8)');
      ctx.textAlign = 'center';
    }

    // province names
    if (z >= 7) {
      ctx.font = `500 10.5px Inter, system-ui, sans-serif`;
      for (let p = 0; p < w.P; p++) {
        const km = w.provinces.km2[p];
        const sizePx = Math.sqrt(km) / 111 * z;
        if (sizePx < 55) continue;
        const [sx, sy] = r.worldToScreen(w.wx(p), w.wy(p));
        if (!onScreen(sx, sy)) continue;
        const name = w.provinces.name[p].toUpperCase();
        const tw = ctx.measureText(name).width * 1.08;
        if (tw > sizePx * 1.3) continue;
        if (!tryPlace(sx, sy + 12, tw + 6, 14)) continue;
        ctx.save();
        ctx.letterSpacing = '0.8px';
        this.text(name, sx, sy + 12, 'rgba(240,242,245,0.78)', 'rgba(10,14,20,0.55)');
        ctx.restore();
      }
    }

    // country names
    for (const a of this.anchors) {
      const [sx, sy] = r.worldToScreen(a.x, a.y);
      if (!onScreen(sx, sy, 200)) continue;
      const extentPx = Math.sqrt(a.km) / 111 * z;
      if (extentPx < 38) continue;
      const size = Math.max(10, Math.min(30, extentPx / 7));
      const name = this.countryName(a.c).toUpperCase();
      ctx.font = `700 ${size.toFixed(1)}px Inter, system-ui, sans-serif`;
      const spacing = Math.min(size * 0.35, 8);
      const tw = ctx.measureText(name).width + spacing * name.length;
      if (tw > Math.max(extentPx * 1.5, a.span * z * 1.1) && extentPx < 120) continue;
      if (z > 16 && size < 14) continue;
      if (!tryPlace(sx, sy, tw, size + 4)) continue;
      ctx.save();
      ctx.letterSpacing = `${spacing.toFixed(1)}px`;
      this.text(name, sx, sy, 'rgba(250,250,252,0.92)', 'rgba(10,14,20,0.6)', 3.5);
      ctx.restore();
    }

    // sea names at low zoom
    if (z < 9) {
      ctx.font = `italic 500 11px Georgia, serif`;
      const seen = new Set();
      for (let s = 0; s < w.S; s++) {
        const name = w.seas.name[s].replace(/ \(.*\)$/, '');
        if (seen.has(name) || w.seas.km2[s] < 400000) continue;
        const [wx, wy] = r.regionCenter(w.P + s);
        const [sx, sy] = r.worldToScreen(wx, wy);
        if (!onScreen(sx, sy)) continue;
        const tw = ctx.measureText(name).width;
        if (!tryPlace(sx, sy, tw + 10, 16)) continue;
        seen.add(name);
        ctx.fillStyle = 'rgba(140,175,205,0.55)';
        ctx.fillText(name, sx, sy);
      }
    }
  }

  text(t, x, y, fill, halo, hw = 3) {
    const ctx = this.ctx;
    ctx.lineJoin = 'round';
    ctx.lineWidth = hw;
    ctx.strokeStyle = halo;
    ctx.strokeText(t, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(t, x, y);
  }

  star(x, y, r) {
    const ctx = this.ctx;
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
}
