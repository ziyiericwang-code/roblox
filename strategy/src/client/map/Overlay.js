// Turns the current game view into map state: province colours and flags, unit counters,
// battle markers, order arrows and captions. Also provides counter hit-testing.
import { ICON, uvOf } from './Atlas.js';
import { TERRAIN } from '../../shared/world.js';

const hex = (h) => {
  const v = parseInt(h.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};
const STRIDE = 17;
const TERRAIN_COLORS = ['#a8b86a', '#4f7a47', '#2f6b3f', '#9c8a5a', '#8a7f74', '#d9c38a', '#6c8f86', '#b9c2b8', '#eef2f4'];

export class Overlay {
  constructor(world, renderer, labels) {
    this.w = world;
    this.r = renderer;
    this.labels = labels;
    this.view = null;
    this.counters = [];
    this.sel = null;
    this.multi = [];
    this.preview = null;
    this.mode = 'political';
    this.lastZoomBucket = -1;
    this.colorCache = new Map();
  }

  color(c) {
    let v = this.colorCache.get(c);
    if (!v) {
      v = hex(this.w.countries[c]?.color || '#888888');
      this.colorCache.set(c, v);
    }
    return v;
  }

  setView(view) {
    this.view = view;
    const r = this.r;
    const P = this.w.P;
    for (let p = 0; p < P; p++) r.setOwner(p, view.prov.owner[p], view.prov.ctrl[p]);
    const pairs = [];
    for (const war of view.wars) for (const a of war.attackers) for (const d of war.defenders) pairs.push([a, d]);
    r.setWarMatrix(pairs);
    this.me = view.me.country;
    this.allies = new Set([this.me, ...view.alliances.filter(([a, b]) => a === this.me || b === this.me).map(([a, b]) => (a === this.me ? b : a))]);
    this.enemies = new Set();
    for (const war of view.wars) {
      if (war.attackers.includes(this.me)) war.defenders.forEach((x) => this.enemies.add(x));
      if (war.defenders.includes(this.me)) war.attackers.forEach((x) => this.enemies.add(x));
    }
    this.area = view.me.area === 'all' ? null : new Set(view.me.area);
    this.applyFlags();
    this.applyMode();
    this.rebuild();
  }

  applyFlags() {
    const v = this.view;
    if (!v) return;
    const P = this.w.P;
    const flags = new Uint8Array(P);
    for (const b of v.battles) flags[b.prov] |= 2;
    for (const pk of v.pockets || []) if (this.allies.has(pk.country)) for (const q of pk.provs) flags[q] |= 4;
    const selF = this.sel && this.sel.kind === 'formation' ? v.formations.find((f) => f.id === this.sel.id) : null;
    if (selF && selF.mine && this.area) for (const q of this.area) flags[q] |= 8;
    for (let p = 0; p < P; p++) this.r.setFlags(p, flags[p]);
    this.r.selected = this.sel && this.sel.kind === 'province' ? this.sel.id : -1;
  }

  setMode(mode) {
    this.mode = mode;
    this.applyMode();
  }

  applyMode() {
    const v = this.view;
    const r = this.r;
    const w = this.w;
    const P = w.P;
    r.clearModeColors();
    for (let p = 0; p < P; p++) r.setFog(p, 0);
    if (!v) return;
    const set = (p, col, a) => {
      const [cr, cg, cb] = typeof col === 'string' ? hex(col) : col;
      r.setModeColor(p, cr * 255, cg * 255, cb * 255, a * 255);
    };
    const ramp = (t) => {
      // red → amber → green
      t = Math.max(0, Math.min(1, t));
      return t < 0.5 ? [0.85, 0.3 + t * 0.9, 0.25] : [0.85 - (t - 0.5) * 1.1, 0.75, 0.3];
    };
    switch (this.mode) {
      case 'terrain':
        for (let p = 0; p < P; p++) set(p, TERRAIN_COLORS[w.provinces.terrain[p]], 0.8);
        r.terrainMix = 1;
        break;
      case 'supply':
        for (let p = 0; p < P; p++) {
          if (!v.prov.supply) break;
          const c = v.prov.ctrl[p];
          if (c === this.me || this.allies.has(c)) set(p, ramp(v.prov.supply[p] / 100), 0.7);
          else set(p, [0.2, 0.22, 0.25], 0.55);
        }
        break;
      case 'diplomacy':
        for (let p = 0; p < P; p++) {
          const c = v.prov.ctrl[p];
          if (c === this.me) set(p, '#e3b453', 0.75);
          else if (this.enemies.has(c)) set(p, '#c9433a', 0.7);
          else if (this.allies.has(c)) set(p, '#4f86c6', 0.7);
          else {
            const o = v.rel[c] / 100;
            set(p, o >= 0 ? [0.45, 0.6 + o * 0.2, 0.55] : [0.6 - o * 0.2, 0.5 + o * 0.2, 0.45], 0.55);
          }
        }
        break;
      case 'intel':
        for (let p = 0; p < P; p++) {
          const lv = v.prov.intel[p];
          r.setFog(p, [220, 150, 90, 30, 0][lv]);
        }
        break;
      case 'economy': {
        let max = 1;
        for (let p = 0; p < P; p++) max = Math.max(max, w.provinces.gdp[p] / Math.max(1, w.provinces.km2[p]));
        for (let p = 0; p < P; p++) set(p, ramp(Math.sqrt(w.provinces.gdp[p] / Math.max(1, w.provinces.km2[p]) / max) * 1.4), 0.7);
        break;
      }
      case 'infrastructure':
        for (let p = 0; p < P; p++) set(p, ramp((v.prov.bld.infra[p] || 0) / 5), v.prov.bld.infra[p] ? 0.7 : 0.35);
        break;
      case 'stability':
        for (let p = 0; p < P; p++) if (v.prov.ctrl[p] === this.me) set(p, ramp(v.prov.stab[p] / 100), 0.7);
        break;
      case 'resources':
        for (let p = 0; p < P; p++) {
          const o = w.provinces.oil[p];
          const m = w.provinces.minerals[p];
          const ra = w.provinces.rare[p];
          const f = w.provinces.food[p];
          const best = Math.max(o, m, ra, f);
          if (best < 2) set(p, [0.25, 0.27, 0.3], 0.5);
          else set(p, best === o ? '#2b2b2b' : best === m ? '#9a8b7a' : best === ra ? '#b06ad0' : '#8cc063', Math.min(0.85, 0.35 + best / 25));
        }
        break;
      case 'empire':
        for (let p = 0; p < P; p++) {
          const c = v.prov.ctrl[p];
          const e = v.empires.find((x) => x.members.some((m) => m.country === c));
          if (e) set(p, e.color, 0.75);
          else set(p, [0.25, 0.27, 0.3], 0.45);
        }
        break;
      case 'weather': {
        const cols = ['#9fc3e6', '#5b86b0', '#7b6a52', '#e8eef5', '#ffffff', '#6f5aa8', '#e89a4c'];
        for (let p = 0; p < P; p++) {
          const st = v.weather[w.provinces.area[p]] || 0;
          if (st) set(p, cols[st], 0.6);
        }
        break;
      }
      case 'fronts':
        for (const fr of v.fronts) for (const q of fr.provs) set(q, this.allies.has(v.prov.ctrl[q]) ? '#e3b453' : '#c9433a', 0.55);
        break;
      default:
        break;
    }
  }

  setSelection(sel, multi = []) {
    this.sel = sel;
    this.multi = multi;
    this.applyFlags();
    this.rebuild();
  }

  setPreview(preview) {
    this.preview = preview;
    this.rebuildArrows();
  }

  zoomChanged() {
    const z = this.r.camera.zoom;
    const bucket = z < 5 ? 0 : z < 8 ? 1 : z < 10 ? 2 : z < 16 ? 3 : 4;
    if (bucket !== this.lastZoomBucket) {
      this.lastZoomBucket = bucket;
      this.rebuild();
    } else this.rebuildLabels();
  }

  // ------------------------------------------------------------ markers
  rebuild() {
    const v = this.view;
    if (!v) return;
    const w = this.w;
    const z = this.r.camera.zoom;
    const inst = [];
    const counters = [];
    const put = (x, y, ox, oy, sx, sy, icon, col, a = 1, flags = 0) => {
      const uv = uvOf(icon);
      inst.push(x, y, ox, oy, sx, sy, uv[0], uv[1], uv[2], uv[3], col[0], col[1], col[2], a, flags, 0, 0);
    };
    const bar = (x, y, ox, oy, sx, sy, col, a = 1) => inst.push(x, y, ox, oy, sx, sy, 0, 0, 0, 0, col[0], col[1], col[2], a, 1, 0, 0);
    const byProv = new Map();
    for (const f of v.formations) {
      if (f.prov >= w.P) continue;
      if (!byProv.has(f.prov)) byProv.set(f.prov, []);
      byProv.get(f.prov).push(f);
    }
    const aggregate = z < 8;
    const scale = Math.max(0.62, Math.min(1.05, 0.55 + z / 30));
    const cw = 34 * scale;
    const ch = 24 * scale;
    const selId = this.sel && this.sel.kind === 'formation' ? this.sel.id : -1;
    const multi = new Set(this.multi);
    for (const [p, list] of byProv) {
      const x = w.wx(p);
      const y = w.wy(p);
      // sort: mine first, then friendly, then hostile
      const rank = (f) => (f.mine ? 0 : this.allies.has(f.owner) ? 1 : this.enemies.has(f.owner) ? 3 : 2);
      list.sort((a, b) => rank(a) - rank(b) || (b.n || 0) - (a.n || 0));
      const groups = aggregate ? groupBySide(list, this) : list.map((f) => [f]);
      const show = groups.slice(0, aggregate ? 2 : 4);
      show.forEach((g, i) => {
        const f = g[0];
        const oy = -ch * 0.9 - i * (ch + 4) + (aggregate ? ch * 0.5 : 0);
        const ox = aggregate && show.length > 1 ? (i === 0 ? -cw * 0.55 : cw * 0.55) : 0;
        const oyy = aggregate ? -ch * 0.4 : oy;
        const col = this.color(f.owner);
        const hostile = this.enemies.has(f.owner);
        const est = f.est;
        const icon = est ? (f.kind ? ICON.est : ICON.unknown) : iconFor(f.comp);
        const isSel = g.some((x) => x.id === selId || multi.has(x.id));
        if (isSel) put(x, y, ox, oyy, cw + 16, ch + 16, ICON.ring, [1, 0.88, 0.45], 1, 2);
        else if (f.mine) put(x, y, ox, oyy, cw + 10, ch + 10, ICON.ring, [0.89, 0.71, 0.33], 0.95);
        else if (hostile) put(x, y, ox, oyy, cw + 10, ch + 10, ICON.ring, [0.85, 0.25, 0.2], 0.9);
        if (g.some((x) => x.encircled)) put(x, y, ox, oyy, cw + 26, cw + 26, ICON.pocket, [0.9, 0.25, 0.2], 0.9, 2);
        put(x, y, ox, oyy, cw, cw, icon, col, f.auto ? 0.8 : 1);
        if (!est && z >= 6 && !aggregate) {
          const str = f.str ?? 1;
          bar(x, y, ox, oyy + ch * 0.62, cw * 0.84, 3.2, [0.08, 0.1, 0.12], 0.9);
          bar(x, y, ox - (cw * 0.84 * (1 - str)) / 2, oyy + ch * 0.62, cw * 0.84 * str, 3.2, str > 0.66 ? [0.4, 0.8, 0.45] : str > 0.33 ? [0.95, 0.75, 0.3] : [0.9, 0.3, 0.25], 1);
          if (z >= 10 && f.org !== undefined) {
            bar(x, y, ox, oyy + ch * 0.62 + 4.2, cw * 0.84, 2.6, [0.08, 0.1, 0.12], 0.9);
            bar(x, y, ox - (cw * 0.84 * (1 - f.org)) / 2, oyy + ch * 0.62 + 4.2, cw * 0.84 * f.org, 2.6, [0.45, 0.65, 0.95], 1);
          }
        }
        counters.push({ x, y, ox, oy: oyy, w: cw, h: ch, ids: g.map((q) => q.id), prov: p, mine: g.some((q) => q.mine), n: g.reduce((a, q) => a + (q.n || 0), 0), count: g.length, est, owner: f.owner });
      });
      const hidden = groups.length - show.length;
      if (hidden > 0) {
        const oy = -ch * 0.9 - show.length * (ch + 4);
        put(x, y, 0, aggregate ? -ch * 1.4 : oy, 18, 18, ICON.badge, [0.15, 0.18, 0.22]);
        counters.push({ x, y, ox: 0, oy: aggregate ? -ch * 1.4 : oy, w: 18, h: 18, ids: groups.slice(show.length).flat().map((q) => q.id), prov: p, more: hidden });
      }
    }
    // battles
    for (const b of v.battles) {
      const x = w.wx(b.prov);
      const y = w.wy(b.prov);
      put(x, y, 0, 12, 30, 30, ICON.battle, b.mine ? [0.95, 0.55, 0.2] : [0.75, 0.3, 0.2], 1, 2);
    }
    // objectives: directives and operations
    for (const d of v.me.directives) if (d.status === 'active' && d.target !== undefined && d.target < w.P) put(w.wx(d.target), w.wy(d.target), 18, -14, 26, 26, ICON.flag, [0.95, 0.75, 0.3]);
    for (const op of v.operations) if (op.status === 'active' || op.status === 'preparing') for (const q of op.objectives) put(w.wx(q), w.wy(q), -18, -14, 24, 24, ICON.flag, [0.9, 0.35, 0.3]);
    // buildings at close zoom
    if (z >= 14) {
      const b = v.prov.bld;
      for (let p = 0; p < w.P; p++) {
        if (!this.r.cssW) break;
        const icons = [];
        if (v.prov.fort[p]) icons.push(ICON.fort);
        if (b.airbase[p]) icons.push(ICON.airbase);
        if (b.port[p]) icons.push(ICON.port);
        if (b.hub[p] || b.depot[p]) icons.push(ICON.hub);
        if (b.radar[p]) icons.push(ICON.radar);
        if (b.command[p]) icons.push(ICON.command);
        if (!icons.length) continue;
        const x = w.wx(p);
        const y = w.wy(p);
        icons.forEach((ic, i) => put(x, y, (i - (icons.length - 1) / 2) * 18, 30, 16, 16, ic, [0.2, 0.24, 0.3]));
      }
    }
    const data = new Float32Array(inst);
    this.r.setMarkers(data, inst.length / STRIDE);
    this.counters = counters;
    this.rebuildArrows();
    this.rebuildLabels();
  }

  rebuildLabels() {
    const v = this.view;
    if (!v) return;
    const w = this.w;
    const z = this.r.camera.zoom;
    const extra = [];
    if (z >= 7) {
      for (const c of this.counters) {
        if (c.more) {
          extra.push({ x: c.x, y: c.y, text: `+${c.more}`, size: 10, color: '#fff', force: true, dx: c.ox, dy: c.oy });
          continue;
        }
        if (c.est) continue;
        const txt = c.count > 1 ? `${c.n}·${c.count}` : `${c.n}`;
        extra.push({ x: c.x, y: c.y, text: txt, size: 9.5, weight: 700, color: c.mine ? '#f6d79a' : '#e8edf2', force: true, dx: c.ox + c.w * 0.5 + 8, dy: c.oy });
      }
    } else {
      for (const c of this.counters) if (c.count > 1 && !c.more) extra.push({ x: c.x, y: c.y, text: `×${c.count}`, size: 9.5, weight: 700, color: '#fff', force: true, dx: c.ox + c.w * 0.5 + 8, dy: c.oy });
    }
    if (z >= 18) {
      for (const c of this.counters) {
        if (c.more || c.est || c.count > 1) continue;
        const f = v.formations.find((q) => q.id === c.ids[0]);
        if (f && f.name) extra.push({ x: c.x, y: c.y, text: f.name, size: 9.5, weight: 500, color: '#c9d2dc', dx: c.ox, dy: c.oy - c.h * 0.85 });
      }
    }
    for (const b of v.battles) if (z >= 9) extra.push({ x: w.wx(b.prov), y: w.wy(b.prov), text: b.name, size: 10, weight: 600, color: '#ffcf9a', dy: 34 });
    this.labels.extra = extra;
    this.labels.dirty = true;
  }

  hit(sx, sy) {
    const r = this.r;
    for (let i = this.counters.length - 1; i >= 0; i--) {
      const c = this.counters[i];
      const [px, py] = r.worldToScreen(c.x, c.y);
      const cx = px + c.ox;
      const cy = py + c.oy;
      if (Math.abs(sx - cx) <= c.w / 2 + 3 && Math.abs(sy - cy) <= c.h / 2 + 3) return c;
    }
    return null;
  }

  // ------------------------------------------------------------ arrows
  rebuildArrows() {
    const v = this.view;
    if (!v) return;
    const w = this.w;
    const out = [];
    const drawPath = (nodes, from, color, width, dashed) => {
      const pts = [];
      let lastX = null;
      const pushPt = (x, y) => {
        if (lastX !== null) {
          while (x - lastX > 180) x -= 360;
          while (lastX - x > 180) x += 360;
        }
        lastX = x;
        pts.push([x, y]);
      };
      if (from) pushPt(from[0], from[1]);
      for (const n of nodes) pushPt(w.wx(n), n < w.P ? w.wy(n) : this.r.regionCenter(n)[1]);
      if (pts.length < 2) return;
      const smooth = catmull(pts, 6);
      arrowGeometry(out, smooth, color, width, dashed);
    };
    const selId = this.sel && this.sel.kind === 'formation' ? this.sel.id : -1;
    for (const f of v.formations) {
      if (!f.order || !f.order.path) continue;
      if (!f.mine && !this.allies.has(f.owner)) continue;
      const rest = f.order.path.slice(f.order.idx);
      if (!rest.length) continue;
      const attack = f.order.type === 'attack';
      const mine = f.mine;
      if (!mine && f.id !== selId && this.r.camera.zoom < 5) continue;
      const col = attack ? [0.93, 0.38, 0.24, mine ? 0.95 : 0.55] : mine ? [0.9, 0.72, 0.33, 0.9] : [0.55, 0.7, 0.85, 0.5];
      drawPath(rest, [w.wx(f.prov), w.wy(f.prov)], col, mine ? 5.5 : 3.2);
    }
    if (this.preview && this.preview.path && this.preview.path.length > 1) {
      const col = this.preview.attack ? [1, 0.45, 0.3, 0.85] : [1, 0.93, 0.75, 0.85];
      drawPath(this.preview.path.slice(1), [w.wx(this.preview.path[0]), w.wy(this.preview.path[0])], col, 6);
    }
    const data = new Float32Array(out);
    this.r.setArrows(data, out.length / 10);
  }
}

function groupBySide(list, ov) {
  const mine = list.filter((f) => f.mine);
  const friendly = list.filter((f) => !f.mine && !ov.enemies.has(f.owner));
  const hostile = list.filter((f) => ov.enemies.has(f.owner));
  return [mine, friendly, hostile].filter((g) => g.length);
}

function iconFor(comp) {
  if (!comp) return ICON.unknown;
  let best = 'inf';
  let bn = -1;
  const n = Object.values(comp).reduce((a, b) => a + b, 0) || 1;
  // armor-heavy formations show as armor even when infantry is the largest share
  if ((comp.armor || 0) / n > 0.25) return ICON.armor;
  if (((comp.mech || 0) + (comp.armor || 0)) / n > 0.3) return ICON.mech;
  for (const [t, c] of Object.entries(comp)) if (c > bn) {
    bn = c;
    best = t;
  }
  return ICON[best] ?? ICON.inf;
}

function catmull(pts, seg) {
  if (pts.length < 3) return pts;
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < seg; k++) {
      const t = k / seg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// Body quads + arrowhead; offsets in pixels live in a_nrm (a_w = 1).
function arrowGeometry(out, pts, color, width) {
  const n = pts.length;
  let dist = 0;
  const hw = width / 2;
  const v = (x, y, nx, ny, d) => out.push(x, y, nx, ny, 1, d, color[0], color[1], color[2], color[3]);
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1e-6;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const last = i === n - 2;
    const back = last ? 12 : 0;
    v(x0, y0, px * hw, py * hw, dist);
    v(x0, y0, -px * hw, -py * hw, dist);
    v(x1, y1, px * hw - ux * back, py * hw - uy * back, dist + len);
    v(x0, y0, -px * hw, -py * hw, dist);
    v(x1, y1, -px * hw - ux * back, -py * hw - uy * back, dist + len);
    v(x1, y1, px * hw - ux * back, py * hw - uy * back, dist + len);
    dist += len;
    if (last) {
      const hl = 16;
      const hwid = width * 1.5 + 4;
      v(x1, y1, 0, 0, dist);
      v(x1, y1, -ux * hl + px * hwid, -uy * hl + py * hwid, dist);
      v(x1, y1, -ux * hl - px * hwid, -uy * hl - py * hwid, dist);
    }
  }
}

export { TERRAIN };
