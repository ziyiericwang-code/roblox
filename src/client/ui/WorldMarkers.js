// Screen-space markers drawn on a 2D canvas over the 3D view: objective flags,
// mission/order waypoints, squadmates, friendly nametags, spotted enemies,
// downed allies and training targets.
import * as THREE from 'three';
import { FACTION, LIFE } from '../../shared/constants.js';
import { rankOf } from '../../shared/config/ranks.js';
import { MISSION_TYPES } from '../../shared/config/missions.js';
import { ORDERS } from '../../shared/config/commands.js';
import { FCOL } from './MapView.js';

const v = new THREE.Vector3();

export class WorldMarkers {
  constructor(root, app) {
    this.app = app;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'markers';
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
  }

  project(x, y, z) {
    const cam = this.app.camera;
    v.set(x, y, z).project(cam);
    const behind = v.z > 1;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, behind };
  }

  // Edge-clamped projection for important waypoints.
  projectClamped(x, y, z) {
    const p = this.project(x, y, z);
    const W = window.innerWidth;
    const H = window.innerHeight;
    const m = 40;
    if (p.behind) {
      p.x = W - p.x;
      p.y = H - m;
    }
    p.edge = p.behind || p.x < m || p.x > W - m || p.y < m || p.y > H - m;
    p.x = Math.max(m, Math.min(W - m, p.x));
    p.y = Math.max(m, Math.min(H - m, p.y));
    return p;
  }

  draw() {
    const app = this.app;
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!app.hud.visible || !app.player.alive) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const me = app.player;
    const store = app.store;
    const f = store.get('faction');
    const myPos = me.s;
    const dist = (x, z) => Math.hypot(x - myPos.x, z - myPos.z);
    // sector flags in battles / nearby
    const war = store.get('war');
    if (war) {
      for (const tw of war.territories) {
        const t = app.world.tById[tw.id];
        if (!t || t.isBase) continue;
        const near = dist(t.x, t.z) < t.radius * 2.2;
        if (!near && !tw.battle) continue;
        for (const s of tw.sectors) {
          const sd = t.sectors.find((q) => q.id === s.id);
          if (!sd) continue;
          const d = dist(sd.x, sd.z);
          if (d > 700) continue;
          const p = this.project(sd.x, sd.y + 12, sd.z);
          if (p.behind) continue;
          const r = d < 30 ? 15 : 12;
          ctx.globalAlpha = d < 25 ? 0.95 : 0.8;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(10,12,14,0.55)';
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = FCOL[s.owner];
          ctx.stroke();
          if (s.p !== 0 && Math.abs(s.p) < 100) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, r + 4, -Math.PI / 2, -Math.PI / 2 + (Math.abs(s.p) / 100) * Math.PI * 2);
            ctx.strokeStyle = s.p > 0 ? FCOL[1] : FCOL[2];
            ctx.lineWidth = 3;
            ctx.stroke();
          }
          ctx.fillStyle = s.c ? '#ffd666' : '#fff';
          ctx.font = 'bold 13px system-ui, sans-serif';
          ctx.fillText(s.id, p.x, p.y + 1);
          ctx.font = '11px system-ui, sans-serif';
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.fillText(`${Math.round(d)}m`, p.x, p.y + r + 11);
          ctx.globalAlpha = 1;
        }
      }
    }
    // tracked mission & squad order waypoints
    const tracked = (store.get('missions') || []).find((m) => m.id === store.get('tracked') && m.status === 'active');
    if (tracked) {
      const y = app.world.terrain.heightAt(tracked.x, tracked.z) + 6;
      this.waypoint(tracked.x, y, tracked.z, MISSION_TYPES[tracked.type].icon, '#ffd666', `${Math.round(dist(tracked.x, tracked.z))}m`);
      if (tracked.points) for (const [px, pz, done] of tracked.points) if (!done) {
        const py = app.world.terrain.heightAt(px, pz) + 3;
        this.waypoint(px, py, pz, '◈', '#ffd666', `${Math.round(dist(px, pz))}m`, true);
      }
      if (tracked.dest) {
        const [dx, dz] = tracked.dest;
        this.waypoint(dx, app.world.terrain.heightAt(dx, dz) + 4, dz, '⚑', '#9be7a8', 'DEST', true);
      }
    }
    const squads = store.get('squads') || [];
    const mine = squads.find((s) => s.id === store.get('mySquad'));
    if (mine && mine.order) {
      const od = ORDERS[mine.order.type];
      this.waypoint(mine.order.x, app.world.terrain.heightAt(mine.order.x, mine.order.z) + 5, mine.order.z, od.icon, od.color, `${od.name.toUpperCase()} ${Math.round(dist(mine.order.x, mine.order.z))}m`);
    }
    if (mine && mine.rally) this.waypoint(mine.rally[0], app.world.terrain.heightAt(mine.rally[0], mine.rally[1]) + 2.5, mine.rally[1], '⚐', '#8fc7ff', 'RALLY', true);
    const tr = store.get('training');
    if (tr && tr.active && tr.target) this.waypoint(tr.target[0], app.world.terrain.heightAt(tr.target[0], tr.target[1]) + 3, tr.target[1], '★', '#ffd666', `${Math.round(dist(tr.target[0], tr.target[1]))}m`);
    // soldiers: squadmates, friendly nametags, spotted enemies, downed allies
    const squadIds = new Set((store.get('squadPos') || []).map((p) => p[0]));
    for (const e of app.cw.ents.values()) {
      if (e.k !== 1 || e.id === me.id) continue;
      const st = app.cw.sample(e);
      if (!st || st.life === LIFE.DEAD) continue;
      const d = dist(st.x, st.z);
      const info = app.cw.infos.get(e.id) || {};
      const friendly = st.faction === f;
      const head = st.stance === 2 ? 0.8 : st.stance === 1 ? 1.5 : 2.1;
      if (friendly) {
        const inSquad = squadIds.has(e.id);
        if (st.life === LIFE.DOWNED && d < 80) {
          const p = this.project(st.x, st.y + 1.2, st.z);
          if (!p.behind) {
            ctx.fillStyle = '#ff5a4a';
            ctx.font = 'bold 18px system-ui';
            ctx.fillText('✚', p.x, p.y);
            ctx.font = '10px system-ui';
            ctx.fillText(`${Math.round(d)}m`, p.x, p.y + 13);
          }
          continue;
        }
        if (st.ambient && d > 25) continue;
        if (!inSquad && d > 60) continue;
        if (inSquad && d > 900) continue;
        const p = this.project(st.x, st.y + head + 0.35, st.z);
        if (p.behind) continue;
        const alpha = inSquad ? 0.95 : Math.max(0, 1 - d / 60);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = inSquad ? '#7bd88f' : '#8fc7ff';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y + 5);
        ctx.lineTo(p.x + 5, p.y);
        ctx.lineTo(p.x, p.y - 5);
        ctx.lineTo(p.x - 5, p.y);
        ctx.closePath();
        ctx.fill();
        if (d < 35 || inSquad) {
          ctx.font = '600 11px system-ui, sans-serif';
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          const label = `${rankOf(st.rank).abbr} ${info.name || ''}`;
          ctx.fillText(label, p.x + 1, p.y - 12);
          ctx.fillStyle = inSquad ? '#b9f0c3' : '#d4e8ff';
          ctx.fillText(label, p.x, p.y - 13);
        }
        ctx.globalAlpha = 1;
      } else if (st.spotted) {
        const p = this.project(st.x, st.y + head + 0.4, st.z);
        if (p.behind) continue;
        ctx.fillStyle = '#ff4d3d';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y + 6);
        ctx.lineTo(p.x + 6, p.y);
        ctx.lineTo(p.x, p.y - 6);
        ctx.lineTo(p.x - 6, p.y);
        ctx.closePath();
        ctx.fill();
      }
    }
    // spotted enemy vehicles
    for (const e of app.cw.ents.values()) {
      if (e.k !== 2) continue;
      const st = e.latest;
      if (!st || st.faction === f || (st.state & 7) === 3) continue;
      const d = dist(st.x, st.z);
      if (d > 500) continue;
      const p = this.project(st.x, st.y + 4, st.z);
      if (p.behind) continue;
      ctx.strokeStyle = '#ff4d3d';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x - 7, p.y - 7, 14, 14);
    }
    void FACTION;
  }

  waypoint(x, y, z, icon, color, label, small = false) {
    const ctx = this.ctx;
    const p = this.projectClamped(x, y, z);
    const r = small ? 9 : 12;
    ctx.globalAlpha = p.edge ? 0.75 : 0.95;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,12,14,0.6)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `bold ${small ? 11 : 13}px system-ui`;
    ctx.fillText(icon, p.x, p.y + 1);
    if (label) {
      ctx.font = '600 11px system-ui';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(label, p.x, p.y + r + 10);
    }
    ctx.globalAlpha = 1;
  }
}
