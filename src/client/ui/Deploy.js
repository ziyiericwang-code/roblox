// Deployment screen: choose spawn point, role and loadout.
import { h, clear } from './dom.js';
import { ROLES } from '../../shared/config/roles.js';
import { WEAPONS } from '../../shared/config/weapons.js';
import { rankOf, RANK } from '../../shared/config/ranks.js';
import { MSG } from '../../shared/protocol.js';

export class DeployScreen {
  constructor(root, app) {
    this.app = app;
    this.el = h('div', { class: 'deploy' });
    root.appendChild(this.el);
    this.el.innerHTML = `
      <div class="dp-top"><div class="dp-title">DEPLOY</div><div class="dp-status"></div></div>
      <div class="dp-main">
        <div class="dp-mapbox"><canvas class="dp-map"></canvas><div class="dp-spawns"></div></div>
        <div class="dp-side">
          <div class="dp-roles"></div>
          <div class="dp-loadout"></div>
          <div class="dp-squad"></div>
        </div>
      </div>
      <div class="dp-bottom">
        <button class="btn sec dp-menu">Menu</button>
        <div class="dp-spawnname"></div>
        <button class="btn big dp-go">DEPLOY</button>
      </div>`;
    this.canvas = this.el.querySelector('.dp-map');
    this.$ = {
      status: this.el.querySelector('.dp-status'), roles: this.el.querySelector('.dp-roles'), loadout: this.el.querySelector('.dp-loadout'),
      squad: this.el.querySelector('.dp-squad'), go: this.el.querySelector('.dp-go'), spawnName: this.el.querySelector('.dp-spawnname'),
      spawns: this.el.querySelector('.dp-spawns'),
    };
    this.selectedSpawn = null;
    this.role = null;
    this.choice = {};
    this.info = null;
    this.visible = false;
    this.deathText = '';
    this.$.go.onclick = () => this.deploy();
    this.el.querySelector('.dp-menu').onclick = () => app.menu.open('career');
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const hit = app.mapView.pick(this.canvas, (e.clientX - r.left) * (this.canvas.width / r.width), (e.clientY - r.top) * (this.canvas.height / r.height), { spawns: this.info ? this.info.options : [] });
      if (hit.type === 'spawn') {
        this.selectedSpawn = hit.id;
        this.renderSpawns();
        app.audio.uiClick();
      }
    });
  }

  show(v) {
    if (v === this.visible) return;
    this.visible = v;
    this.el.classList.toggle('on', v);
    if (v) {
      this.app.input.releaseLock();
      this.app.input.enabled = false;
      this.render();
    } else if (!this.app.menu.isOpen) this.app.input.enabled = true;
  }

  setInfo(info) {
    this.info = info;
    const p = this.app.store.get('profile');
    if (!this.role) this.role = (p && p.lastRole) || 'rifleman';
    if (this.role && info.roles && info.roles[this.role]) this.role = 'rifleman';
    const valid = info.options.filter((o) => o.ok);
    if (!this.selectedSpawn || !info.options.find((o) => o.id === this.selectedSpawn && o.ok)) {
      // default: nearest valid to the front (last used) or HQ
      const pref = valid.find((o) => o.id === this.lastSpawn) || valid.find((o) => o.type === 'squad') || valid.find((o) => o.type === 'rally') || valid[0];
      this.selectedSpawn = pref ? pref.id : null;
    }
    if (this.visible) this.render();
  }

  render() {
    this.renderRoles();
    this.renderLoadout();
    this.renderSpawns();
    this.renderSquad();
  }

  renderRoles() {
    const app = this.app;
    const info = this.info;
    const p = app.store.get('profile');
    const box = clear(this.$.roles);
    box.appendChild(h('div', { class: 'dp-h' }, 'ROLE'));
    for (const r of Object.values(ROLES)) {
      const reason = info && info.roles ? info.roles[r.id] : '';
      const card = h('button', { class: `role${this.role === r.id ? ' on' : ''}${reason ? ' locked' : ''}`, title: reason || r.blurb, onclick: () => {
        if (reason) {
          app.hud.toast(reason, 'warn');
          return;
        }
        this.role = r.id;
        this.render();
        app.audio.uiClick();
      } }, h('span', { class: 'ri' }, r.icon), h('span', { class: 'rn' }, r.name), reason ? h('span', { class: 'rl' }, reason === 'Rank too low' ? `${rankOf(r.minRank).abbr}+` : '🔒') : '');
      box.appendChild(card);
    }
    const role = ROLES[this.role];
    if (role) box.appendChild(h('p', { class: 'dimmed small' }, role.blurb));
    void p;
  }

  renderLoadout() {
    const app = this.app;
    const p = app.store.get('profile');
    const role = ROLES[this.role] || ROLES.rifleman;
    const box = clear(this.$.loadout);
    box.appendChild(h('div', { class: 'dp-h' }, 'LOADOUT'));
    const saved = (p && p.loadouts && p.loadouts[role.id]) || {};
    const pick = (label, list, key) => {
      const row = h('div', { class: 'lo-row' }, h('span', { class: 'lo-l' }, label));
      for (const id of list) {
        const w = WEAPONS[id];
        const locked = (w.minRank || 0) > p.rank;
        const cur = (this.choice[key] || saved[key] || list.find((x) => (WEAPONS[x].minRank || 0) <= p.rank)) === id;
        row.appendChild(h('button', { class: `wpn${cur ? ' on' : ''}${locked ? ' locked' : ''}`, title: `${w.desc}${locked ? ` (requires ${rankOf(w.minRank).name})` : ''}`, onclick: () => {
          if (locked) return;
          this.choice[key] = id;
          this.renderLoadout();
        } }, w.name, locked ? h('small', {}, ` ${rankOf(w.minRank).abbr}+`) : ''));
      }
      box.appendChild(row);
    };
    pick('Primary', role.primaries, 'primary');
    pick('Sidearm', role.sidearms, 'sidearm');
    box.appendChild(h('div', { class: 'lo-gear' }, 'Gear: ', role.gear.map((g) => (WEAPONS[g] ? WEAPONS[g].name : g)).join(' · '), ` · Armor ${role.armor}`));
  }

  renderSpawns() {
    const info = this.info;
    const box = clear(this.$.spawns);
    if (!info) return;
    for (const o of info.options) {
      box.appendChild(h('button', { class: `sp${o.id === this.selectedSpawn ? ' on' : ''}${o.ok ? '' : ' off'}`, title: o.reason || '', onclick: () => {
        if (!o.ok) {
          this.app.hud.toast(o.reason || 'Unavailable', 'warn');
          return;
        }
        this.selectedSpawn = o.id;
        this.renderSpawns();
      } }, o.name, o.ok ? '' : h('small', {}, ` — ${o.reason}`)));
    }
    const sel = info.options.find((o) => o.id === this.selectedSpawn);
    this.$.spawnName.textContent = sel ? sel.name : 'Select a spawn point';
  }

  renderSquad() {
    const app = this.app;
    const s = app.store;
    const box = clear(this.$.squad);
    const squads = s.get('squads') || [];
    const mine = squads.find((q) => q.id === s.get('mySquad'));
    const p = s.get('profile');
    box.appendChild(h('div', { class: 'dp-h' }, 'SQUAD'));
    if (mine) {
      box.appendChild(h('div', {}, `Squad ${mine.name} · ${mine.members.length}/${mine.max}`, h('button', { class: 'btn tiny sec', onclick: () => app.menu.open('squad') }, 'Manage')));
    } else {
      const open = squads.filter((q) => !q.locked && q.members.length < q.max).slice(0, 3);
      if (!open.length && (!p || p.rank < RANK.CORPORAL)) box.appendChild(h('div', { class: 'dimmed small' }, 'No open squads. You can still fight alongside the army.'));
      for (const q of open) box.appendChild(h('button', { class: 'btn tiny', onclick: () => app.send({ t: MSG.SQUAD, a: 'join', id: q.id }) }, `Join ${q.name} (${q.members.length}/${q.max})`));
      if (p && p.rank >= RANK.CORPORAL) box.appendChild(h('button', { class: 'btn tiny sec', onclick: () => app.send({ t: MSG.SQUAD, a: 'create' }) }, 'Form squad'));
    }
  }

  deploy() {
    const app = this.app;
    const info = this.info;
    if (!info || !this.selectedSpawn) return;
    const wait = info.canDeployAt - (info.now + (performance.now() / 1000 - this.infoAt));
    if (wait > 0.1) {
      app.hud.toast(`Reinforcements in ${Math.ceil(wait)}s`);
      return;
    }
    app.audio.init();
    this.lastSpawn = this.selectedSpawn;
    const p = app.store.get('profile');
    const saved = (p.loadouts && p.loadouts[this.role]) || {};
    app.send({ t: MSG.DEPLOY, spawn: this.selectedSpawn, role: this.role, primary: this.choice.primary || saved.primary, sidearm: this.choice.sidearm || saved.sidearm });
    app.audio.uiClick('ding');
  }

  update() {
    if (!this.visible) return;
    const app = this.app;
    // map
    const c = this.canvas;
    const r = c.getBoundingClientRect();
    if (c.width !== Math.round(r.width) || c.height !== Math.round(r.height)) {
      c.width = Math.max(100, Math.round(r.width));
      c.height = Math.max(100, Math.round(r.height));
    }
    const s = app.store;
    app.mapView.view = { cx: 0, cz: 0, zoom: 1 };
    app.mapView.draw(c, { war: s.get('war'), missions: s.get('missions'), tracked: s.get('tracked'), squadPos: s.get('squadPos'), spawns: this.info ? this.info.options : [], selectedSpawn: this.selectedSpawn });
    // timer
    const info = this.info;
    let status = this.deathText;
    if (info) {
      const wait = info.canDeployAt - (info.now + (performance.now() / 1000 - this.infoAt));
      if (wait > 0) {
        this.$.go.textContent = `DEPLOY IN ${Math.ceil(wait)}`;
        this.$.go.disabled = true;
      } else {
        this.$.go.textContent = 'DEPLOY';
        this.$.go.disabled = !this.selectedSpawn;
      }
    }
    const tr = s.get('training');
    if (tr && tr.active) status = `Recruit: complete basic training at ${(app.world.bases[app.store.get('faction')] || {}).name || 'headquarters'} to earn the rank of Private.`;
    this.$.status.textContent = status;
  }

  setInfoTime() {
    this.infoAt = performance.now() / 1000;
  }
}
