// The war map. Readable first: which country holds what, where the front
// lines are, where battles are raging and where armies are marching.
// Layers: terrain (built once) · ownership + borders + fronts (rebuilt only
// when territory changes hands) · live overlays (battles, forces, missions,
// squad, you).
import { WORLD_HALF, SEA_LEVEL, FACTION_INFO, COUNTRY_IDS, areHostile } from '../../shared/constants.js';
import { TMAT_COLORS } from '../../shared/world/terrain.js';
import { MISSION_TYPES } from '../../shared/config/missions.js';

export const FCOL = Object.fromEntries([0, ...COUNTRY_IDS].map((f) => [f, FACTION_INFO[f].color]));
const TYPE_ICON = { capital: '★', city: '■', port: '⚓', military: '⛨', airbase: '✈', industrial: '⚙', island: '◆' };

export class MapView {
  constructor(world) {
    this.world = world;
    this.base = null;
    this.own = null;
    this.ownKey = '';
    this.view = { cx: 0, cz: 0, zoom: 1 };
  }

  buildBase(size = 768) {
    if (this.base) return this.base;
    const w = this.world;
    const t = w.terrain;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const px = (WORLD_HALF * 2) / size;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const x = -WORLD_HALF + (i + 0.5) * px;
        const z = -WORLD_HALF + (j + 0.5) * px;
        const h = t.heightAt(x, z);
        const k = (j * size + i) * 4;
        let r;
        let g;
        let b;
        if (h < SEA_LEVEL) {
          const d = Math.min(1, -h / 10);
          r = 38 - d * 18;
          g = 72 - d * 28;
          b = 92 - d * 24;
        } else {
          const col = TMAT_COLORS[t.materialAt(x, z)] || TMAT_COLORS[0];
          const hl = t.heightAt(x - px, z - px);
          const shade = Math.max(0.5, Math.min(1.35, 1 + (h - hl) * 0.05));
          const tint = 0.8 + Math.min(0.35, h / 400);
          r = col[0] * 255 * shade * tint;
          g = col[1] * 255 * shade * tint;
          b = col[2] * 255 * shade * tint;
        }
        img.data[k] = r;
        img.data[k + 1] = g;
        img.data[k + 2] = b;
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const s = size / (WORLD_HALF * 2);
    // towns (building footprints, merged per building)
    ctx.fillStyle = 'rgba(52,50,47,0.8)';
    for (const bd of w.buildings) {
      const x = (bd.x0 + WORLD_HALF) * s;
      const y = (bd.z0 + WORLD_HALF) * s;
      ctx.fillRect(x, y, Math.max(0.7, (bd.x1 - bd.x0) * s), Math.max(0.7, (bd.z1 - bd.z0) * s));
    }
    // roads and railways
    ctx.lineCap = 'round';
    for (const r of w.roads) {
      if (r.kind === 'street') continue;
      ctx.strokeStyle = r.kind === 'highway' ? 'rgba(236,214,160,0.75)' : 'rgba(40,40,42,0.75)';
      ctx.lineWidth = r.kind === 'highway' ? 1.8 : 1;
      path(ctx, r.samples, s);
    }
    for (const r of w.rails) {
      ctx.strokeStyle = 'rgba(25,25,28,0.9)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 2]);
      path(ctx, r.samples, s);
      ctx.setLineDash([]);
    }
    this.base = c;
    return c;
  }

  // Ownership layer: region cells coloured by owner, country borders and
  // front lines (borders between countries at war).
  buildOwnership(war) {
    const reg = this.world.regions;
    const owners = new Map();
    for (const t of war.territories) owners.set(t.id, t.owner);
    const key = `${[...owners.values()].join('')}|${war.wars.map((w) => `${w[0]}${w[1]}`).join(',')}`;
    if (key === this.ownKey && this.own) return this.own;
    this.ownKey = key;
    const n = reg.n;
    const c = this.own || document.createElement('canvas');
    c.width = n;
    c.height = n;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(n, n);
    const ts = reg.territories;
    const ownerOf = (k) => {
      const v = reg.idx[k];
      return v && reg.land[k] ? owners.get(ts[v - 1].id) || 0 : -1;
    };
    const rgb = {};
    for (const f of [0, ...COUNTRY_IDS]) rgb[f] = hexRgb(FCOL[f]);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const o = ownerOf(k);
        const p = k * 4;
        if (o < 0) continue;
        const nb = [i > 0 ? ownerOf(k - 1) : o, i < n - 1 ? ownerOf(k + 1) : o, j > 0 ? ownerOf(k - n) : o, j < n - 1 ? ownerOf(k + n) : o];
        const front = nb.some((q) => q > 0 && q !== o && areHostile(q, o));
        const border = !front && nb.some((q) => q >= 0 && q !== o);
        const inner = !front && !border && reg.idx[k] !== reg.idx[i > 0 ? k - 1 : k];
        const c3 = rgb[o];
        if (front) {
          img.data[p] = 255;
          img.data[p + 1] = 70;
          img.data[p + 2] = 40;
          img.data[p + 3] = 255;
        } else if (border) {
          img.data[p] = 20;
          img.data[p + 1] = 20;
          img.data[p + 2] = 24;
          img.data[p + 3] = 230;
        } else {
          img.data[p] = c3[0];
          img.data[p + 1] = c3[1];
          img.data[p + 2] = c3[2];
          img.data[p + 3] = inner ? 110 : 62;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    this.own = c;
    return c;
  }

  // world -> canvas pixel
  toCanvas(canvas, x, z) {
    const v = this.view;
    const S = (Math.min(canvas.width, canvas.height) / (WORLD_HALF * 2)) * v.zoom;
    return [canvas.width / 2 + (x - v.cx) * S, canvas.height / 2 + (z - v.cz) * S, S];
  }

  toWorld(canvas, px, py) {
    const v = this.view;
    const S = (Math.min(canvas.width, canvas.height) / (WORLD_HALF * 2)) * v.zoom;
    return [(px - canvas.width / 2) / S + v.cx, (py - canvas.height / 2) / S + v.cz];
  }

  draw(canvas, st) {
    const ctx = canvas.getContext('2d');
    const base = this.buildBase();
    const now = performance.now() / 1000;
    ctx.fillStyle = '#0f1418';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const [x0, y0, S] = this.toCanvas(canvas, -WORLD_HALF, -WORLD_HALF);
    const W = WORLD_HALF * 2 * S;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(base, x0, y0, W, W);
    const war = st.war;
    const P = (x, z) => this.toCanvas(canvas, x, z);
    const wt = new Map();
    if (war) {
      for (const t of war.territories) wt.set(t.id, t);
      ctx.imageSmoothingEnabled = S * 16 < 3;
      ctx.drawImage(this.buildOwnership(war), x0, y0, W, W);
      ctx.imageSmoothingEnabled = true;
    }
    const zoomed = this.view.zoom >= 2.2;
    const mine = st.faction;
    // marching battalions (own exact, others where intel reaches)
    if (war) {
      for (const f of war.forces) {
        if (!f.to || f.st === 'garrison' || f.st === 'reserve') continue;
        const dest = this.world.tById[f.to];
        if (!dest) continue;
        const [ax, ay] = P(f.x, f.z);
        const [bx, by] = P(dest.x, dest.z);
        const col = FCOL[f.f];
        ctx.strokeStyle = hexA(col, f.f === mine ? 0.9 : 0.6);
        ctx.lineWidth = Math.min(5, 1.5 + f.s / 60);
        ctx.setLineDash(f.st === 'retreating' ? [3, 3] : []);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.setLineDash([]);
        // arrow head at the force's position pointing to its destination
        const a = Math.atan2(by - ay, bx - ax);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(ax + Math.cos(a) * 8, ay + Math.sin(a) * 8);
        ctx.lineTo(ax + Math.cos(a + 2.5) * 6, ay + Math.sin(a + 2.5) * 6);
        ctx.lineTo(ax + Math.cos(a - 2.5) * 6, ay + Math.sin(a - 2.5) * 6);
        ctx.fill();
      }
    }
    // headquarters
    for (const b of Object.values(this.world.bases)) {
      const [x, y] = P(b.x, b.z);
      ctx.fillStyle = FCOL[b.faction];
      ctx.strokeStyle = '#0b0e10';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(x - 7, y - 7, 14, 14);
      ctx.fill();
      ctx.stroke();
      label(ctx, b.name.toUpperCase(), x, y + 17, 10, '#f3efe4');
      ctx.fillStyle = '#0b0e10';
      ctx.font = 'bold 9px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('HQ', x, y + 0.5);
    }
    // territories: name, type, battle
    for (const t of this.world.territories) {
      const w = wt.get(t.id);
      const owner = w ? w.owner : t.faction;
      const [cx, cy] = P(t.x, t.z);
      if (st.selected === t.id) {
        ctx.strokeStyle = '#ffe28a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(14, t.radius * S), 0, Math.PI * 2);
        ctx.stroke();
      }
      if (zoomed && w) {
        for (const s of t.sectors) {
          const ws = w.sectors.find((q) => q.id === s.id);
          const [x, y] = P(s.x, s.z);
          const rr = 5;
          ctx.beginPath();
          ctx.arc(x, y, rr, 0, Math.PI * 2);
          ctx.fillStyle = FCOL[ws ? ws.o : owner] || FCOL[0];
          ctx.fill();
          if (ws && ws.p < 100) {
            ctx.beginPath();
            ctx.arc(x, y, rr + 3, -Math.PI / 2, -Math.PI / 2 + (ws.p / 100) * Math.PI * 2);
            ctx.strokeStyle = FCOL[ws.o || ws.c] || '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
      }
      const icon = TYPE_ICON[t.type] || '•';
      ctx.fillStyle = FCOL[owner];
      ctx.font = `bold ${t.type === 'capital' ? 16 : 12}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeText(icon, cx, cy);
      ctx.fillText(icon, cx, cy);
      label(ctx, t.name.toUpperCase(), cx, cy - 14, t.type === 'capital' ? 12 : 10.5, '#f3efe4');
      if (w && w.str >= 0 && owner === mine) label(ctx, `${w.str}`, cx, cy + 13, 9, 'rgba(230,236,240,0.75)');
      if (w && w.battle) {
        const pulse = 0.6 + Math.sin(now * 5) * 0.4;
        ctx.strokeStyle = hexA(FCOL[w.battle], pulse);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 16 + pulse * 3, 0, Math.PI * 2);
        ctx.stroke();
        label(ctx, '⚔', cx + 16, cy - 16, 14, '#ffd27a');
      }
    }
    // missions
    for (const m of st.missions || []) {
      if (m.status !== 'active') continue;
      const [x, y] = P(m.x, m.z);
      const tracked = st.tracked === m.id;
      ctx.beginPath();
      ctx.arc(x, y, tracked ? 10 : 7, 0, Math.PI * 2);
      ctx.fillStyle = tracked ? 'rgba(255,214,102,0.95)' : 'rgba(255,214,102,0.6)';
      ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      ctx.font = 'bold 10px system-ui';
      ctx.fillText((MISSION_TYPES[m.type] || {}).icon || '!', x, y + 1);
      if (m.points && zoomed) for (const [px2, pz, done] of m.points) {
        const [a, b] = P(px2, pz);
        ctx.strokeStyle = done ? '#7bd88f' : '#ffd666';
        ctx.lineWidth = 2;
        ctx.strokeRect(a - 4, b - 4, 8, 8);
      }
      if (m.dest && tracked) {
        const [a, b] = P(m.dest[0], m.dest[1]);
        ctx.strokeStyle = 'rgba(255,214,102,0.7)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(a, b);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // spawn options (deploy)
    for (const o of st.spawns || []) {
      const [x, y] = P(o.x, o.z);
      const sel = st.selectedSpawn === o.id;
      ctx.beginPath();
      ctx.arc(x, y, sel ? 12 : 9, 0, Math.PI * 2);
      ctx.fillStyle = o.ok ? (sel ? '#ffe28a' : 'rgba(120,200,255,0.95)') : 'rgba(120,120,120,0.7)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0b0e10';
      ctx.stroke();
      ctx.fillStyle = '#0b0e10';
      ctx.font = 'bold 10px system-ui';
      ctx.fillText(o.type === 'base' ? 'HQ' : o.type === 'cp' ? 'CP' : o.type === 'squad' ? 'SL' : o.type === 'rally' ? 'RP' : 'V', x, y + 1);
    }
    if (st.order) {
      const [x, y] = P(st.order.x, st.order.z);
      ctx.strokeStyle = '#ffb347';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.stroke();
      label(ctx, 'ORDER', x, y - 18, 10, '#ffb347');
    }
    for (const [id, x, z, life, lead] of st.squadPos || []) {
      if (st.me && id === st.me.id) continue;
      const [a, b] = P(x, z);
      ctx.fillStyle = life === 1 ? '#ff9a6a' : lead === 2 ? '#8fc7ff' : '#7bd88f';
      ctx.beginPath();
      if (lead === 1) {
        ctx.moveTo(a, b - 6);
        ctx.lineTo(a + 5, b + 4);
        ctx.lineTo(a - 5, b + 4);
      } else ctx.arc(a, b, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (st.me) {
      const [x, y] = P(st.me.x, st.me.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-st.me.yaw);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(6, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    // legend: countries and who fights whom
    if (war) {
      let y = 16;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const f of COUNTRY_IDS) {
        const foes = war.wars.filter((w) => w[0] === f || w[1] === f).map((w) => FACTION_INFO[w[0] === f ? w[1] : w[0]].short);
        ctx.fillStyle = FCOL[f];
        ctx.fillRect(12, y - 5, 10, 10);
        ctx.font = f === mine ? 'bold 12px system-ui' : '12px system-ui';
        ctx.fillStyle = '#eef1f3';
        ctx.fillText(`${FACTION_INFO[f].short}${foes.length ? ` — at war with ${foes.join(', ')}` : ' — at peace'}`, 28, y);
        y += 17;
      }
      ctx.fillStyle = '#ff4628';
      ctx.fillRect(12, y - 1.5, 10, 3);
      ctx.fillStyle = 'rgba(238,241,243,0.8)';
      ctx.font = '11px system-ui';
      ctx.fillText('Front line', 28, y);
    }
    // scale
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'left';
    const barM = this.view.zoom > 3 ? 200 : 1000;
    ctx.fillRect(14, canvas.height - 18, barM * S, 2);
    ctx.fillText(`${barM >= 1000 ? `${barM / 1000} km` : `${barM} m`}`, 14, canvas.height - 26);
  }

  // Hit test for territory / spawn / base at canvas coords.
  pick(canvas, px, py, st) {
    const [wx, wz] = this.toWorld(canvas, px, py);
    for (const o of st.spawns || []) {
      const [x, y] = this.toCanvas(canvas, o.x, o.z);
      if (Math.hypot(px - x, py - y) < 14) return { type: 'spawn', id: o.id };
    }
    for (const b of this.world.hqs) {
      const [x, y] = this.toCanvas(canvas, b.x, b.z);
      if (Math.hypot(px - x, py - y) < 12) return { type: 'territory', id: b.id, x: wx, z: wz };
    }
    const t = this.world.territoryAt(wx, wz);
    if (t) return { type: 'territory', id: t.id, x: wx, z: wz };
    return { type: 'point', x: wx, z: wz };
  }
}

function path(ctx, samples, s) {
  ctx.beginPath();
  samples.forEach((p, i) => {
    const x = (p.x + WORLD_HALF) * s;
    const y = (p.z + WORLD_HALF) * s;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function label(ctx, text, x, y, size, color) {
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexA(hex, a) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
