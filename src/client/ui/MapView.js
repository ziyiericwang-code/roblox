// Tactical map: pre-rendered terrain (hillshade, water, roads, buildings)
// with live overlays for territories, sectors, battles, missions and units.
import { WORLD_HALF, SEA_LEVEL, FACTION } from '../../shared/constants.js';
import { TMAT_COLORS } from '../../shared/world/terrain.js';
import { BF } from '../../shared/world/builder.js';
import { MISSION_TYPES } from '../../shared/config/missions.js';

const FCOL = { [FACTION.COALITION]: '#4f86d9', [FACTION.DOMINION]: '#d4483c', 0: '#c9c9c9' };

export class MapView {
  constructor(world) {
    this.world = world;
    this.base = null;
    this.view = { cx: 0, cz: 0, zoom: 1 };
  }

  buildBase(size = 640) {
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
          const d = Math.min(1, -h / 8);
          r = 40 - d * 20;
          g = 78 - d * 30;
          b = 96 - d * 25;
        } else {
          const col = TMAT_COLORS[t.materialAt(x, z)] || TMAT_COLORS[0];
          const hl = t.heightAt(x - px, z - px);
          const shade = Math.max(0.55, Math.min(1.3, 1 + (h - hl) * 0.09));
          const tint = 0.85 + Math.min(0.3, h / 300);
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
    // buildings
    ctx.fillStyle = 'rgba(60,58,54,0.85)';
    for (const bx of w.boxes) {
      if (!(bx.f & BF.BUILDING) && !(bx.f & BF.COVER)) continue;
      if (bx.y1 - bx.y0 < 1.5 && !(bx.f & BF.BUILDING)) continue;
      const x = (bx.x0 + WORLD_HALF) * s;
      const y = (bx.z0 + WORLD_HALF) * s;
      ctx.fillRect(x, y, Math.max(0.6, (bx.x1 - bx.x0) * s), Math.max(0.6, (bx.z1 - bx.z0) * s));
    }
    // roads
    ctx.strokeStyle = 'rgba(40,40,42,0.9)';
    ctx.lineCap = 'round';
    for (const r of w.roads) {
      ctx.lineWidth = Math.max(1.2, r.width * s * 0.9);
      ctx.beginPath();
      r.samples.forEach((p, i) => {
        const x = (p.x + WORLD_HALF) * s;
        const y = (p.z + WORLD_HALF) * s;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let g2 = -WORLD_HALF; g2 <= WORLD_HALF; g2 += 200) {
      const v = (g2 + WORLD_HALF) * s;
      ctx.beginPath();
      ctx.moveTo(v, 0);
      ctx.lineTo(v, size);
      ctx.moveTo(0, v);
      ctx.lineTo(size, v);
      ctx.stroke();
    }
    this.base = c;
    return c;
  }

  // world -> canvas pixel
  toCanvas(canvas, x, z) {
    const v = this.view;
    const S = Math.min(canvas.width, canvas.height) / (WORLD_HALF * 2) * v.zoom;
    return [canvas.width / 2 + (x - v.cx) * S, canvas.height / 2 + (z - v.cz) * S, S];
  }

  toWorld(canvas, px, py) {
    const v = this.view;
    const S = Math.min(canvas.width, canvas.height) / (WORLD_HALF * 2) * v.zoom;
    return [(px - canvas.width / 2) / S + v.cx, (py - canvas.height / 2) / S + v.cz];
  }

  draw(canvas, st) {
    const ctx = canvas.getContext('2d');
    const base = this.buildBase();
    ctx.fillStyle = '#0f1418';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const [x0, y0, S] = this.toCanvas(canvas, -WORLD_HALF, -WORLD_HALF);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(base, x0, y0, WORLD_HALF * 2 * S, WORLD_HALF * 2 * S);
    const war = st.war;
    const owners = new Map();
    const wt = new Map();
    if (war) for (const t of war.territories) wt.set(t.id, t);
    const P = (x, z) => this.toCanvas(canvas, x, z);
    // territory areas
    for (const t of this.world.territories) {
      const w = wt.get(t.id);
      const owner = w ? w.owner : t.initialOwner;
      owners.set(t.id, owner);
      const [cx, cy] = P(t.x, t.z);
      const r = t.radius * S * 1.15;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = hexA(FCOL[owner], w && (w.state === 'contested' || w.state === 'under_attack') ? 0.22 : 0.14);
      ctx.fill();
      ctx.lineWidth = w && w.battle ? 3 : 1.5;
      ctx.setLineDash(w && w.battle ? [8, 5] : []);
      ctx.strokeStyle = hexA(FCOL[owner], 0.9);
      ctx.stroke();
      ctx.setLineDash([]);
      if (st.selected === t.id) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffe28a';
        ctx.stroke();
      }
    }
    // front links
    ctx.lineWidth = 1;
    for (const t of this.world.territories) {
      for (const a of t.adjacent) {
        if (a < t.id) continue;
        const o = this.world.tById[a];
        const [ax, ay] = P(t.x, t.z);
        const [bx, by] = P(o.x, o.z);
        const front = owners.get(a) !== owners.get(t.id);
        ctx.strokeStyle = front ? 'rgba(255,210,120,0.55)' : 'rgba(255,255,255,0.12)';
        ctx.setLineDash(front ? [4, 4] : []);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    // sectors
    for (const t of this.world.territories) {
      const w = wt.get(t.id);
      for (const s of t.sectors) {
        const ws = w && w.sectors.find((q) => q.id === s.id);
        const owner = ws ? ws.owner : t.initialOwner;
        const [x, y] = P(s.x, s.z);
        const rr = Math.max(5, 7 * Math.min(2, S * 3));
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.fillStyle = FCOL[owner];
        ctx.fill();
        if (ws && ws.p !== undefined) {
          ctx.beginPath();
          ctx.arc(x, y, rr + 3, -Math.PI / 2, -Math.PI / 2 + (Math.abs(ws.p) / 100) * Math.PI * 2);
          ctx.strokeStyle = ws.p > 0 ? FCOL[1] : FCOL[2];
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (ws && ws.c) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, rr + 6, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = '#0b0e10';
        ctx.font = `bold ${Math.round(rr * 1.2)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.id, x, y + 0.5);
      }
      const [lx, ly] = P(t.x, t.z - t.radius * 0.8);
      ctx.font = `600 ${Math.max(11, Math.min(15, 12 * S * 2.2))}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(t.name.toUpperCase(), lx + 1, ly + 1);
      ctx.fillStyle = '#eef1f3';
      ctx.fillText(t.name.toUpperCase(), lx, ly);
      const w2 = wt.get(t.id);
      if (w2 && w2.battle) {
        ctx.font = `${Math.max(14, 16 * S * 2)}px system-ui`;
        ctx.fillText('⚔', lx, ly + 16);
      }
    }
    // missions
    for (const m of st.missions || []) {
      if (m.status !== 'active') continue;
      const [x, y] = P(m.x, m.z);
      const tracked = st.tracked === m.id;
      ctx.beginPath();
      ctx.arc(x, y, tracked ? 11 : 8, 0, Math.PI * 2);
      ctx.fillStyle = tracked ? 'rgba(255,214,102,0.95)' : 'rgba(255,214,102,0.55)';
      ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      ctx.font = 'bold 11px system-ui';
      ctx.fillText((MISSION_TYPES[m.type] || {}).icon || '!', x, y + 1);
      if (m.points) for (const [px2, pz, done] of m.points) {
        const [a, b] = P(px2, pz);
        ctx.strokeStyle = done ? '#7bd88f' : '#ffd666';
        ctx.lineWidth = 2;
        ctx.strokeRect(a - 4, b - 4, 8, 8);
      }
      if (m.dest) {
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
      ctx.fillStyle = o.ok ? (sel ? '#ffe28a' : 'rgba(120,200,255,0.9)') : 'rgba(120,120,120,0.7)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0b0e10';
      ctx.stroke();
      ctx.fillStyle = '#0b0e10';
      ctx.font = 'bold 10px system-ui';
      ctx.fillText(o.type === 'base' ? 'HQ' : o.type === 'cp' ? 'CP' : o.type === 'squad' ? 'SL' : o.type === 'rally' ? 'RP' : 'V', x, y + 1);
    }
    // order
    if (st.order) {
      const [x, y] = P(st.order.x, st.order.z);
      ctx.strokeStyle = '#ffb347';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffb347';
      ctx.font = 'bold 10px system-ui';
      ctx.fillText('ORDER', x, y - 18);
    }
    // squad
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
    // me
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
    // map scale
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'left';
    const barM = 200;
    ctx.fillRect(14, canvas.height - 18, barM * S, 2);
    ctx.fillText(`${barM} m`, 14, canvas.height - 24);
  }

  // Hit test for territory / spawn at canvas coords.
  pick(canvas, px, py, st) {
    const [wx, wz] = this.toWorld(canvas, px, py);
    for (const o of st.spawns || []) {
      const [x, y] = this.toCanvas(canvas, o.x, o.z);
      if (Math.hypot(px - x, py - y) < 14) return { type: 'spawn', id: o.id };
    }
    let best = null;
    let bd = Infinity;
    for (const t of this.world.territories) {
      const d = Math.hypot(t.x - wx, t.z - wz);
      if (d < t.radius * 1.2 && d < bd) {
        bd = d;
        best = t;
      }
    }
    return best ? { type: 'territory', id: best.id, x: wx, z: wz } : { type: 'point', x: wx, z: wz };
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export { FCOL };
