// Sandbox / admin panel and the developer performance monitor. Only shown to
// sessions the server marked as admin; every button is a request that the
// server authorises again.
import { h, clear } from './dom.js';
import { MSG } from '../../shared/protocol.js';
import { RANKS } from '../../shared/config/ranks.js';
import { FACTION_INFO, COUNTRY_IDS } from '../../shared/constants.js';

const WEATHER = ['clear', 'cloudy', 'overcast', 'rain', 'storm', 'fog'];
const MISSIONS = ['capture', 'defend', 'destroy', 'rescue', 'secure', 'hold', 'recon', 'supply', 'convoy', 'vip'];

export class Sandbox {
  constructor(root, app) {
    this.app = app;
    this.admin = false;
    this.el = h('div', { class: 'sandbox' });
    this.perfEl = h('div', { class: 'perfmon' });
    // always-visible button for admins (no need to remember the key)
    this.btn = h('button', { class: 'admin-btn', title: 'Admin panel (` or F2)', onclick: () => this.toggle() }, '⚙ ADMIN');
    root.append(this.el, this.perfEl, this.btn);
    this.state = null;
  }

  setAdmin(v) {
    this.admin = v;
    document.body.classList.toggle('is-admin', v);
  }

  setState(st) {
    this.state = st;
    this.app.adminBypass = !!st.bypass;
    if (this.el.classList.contains('on')) this.render();
  }

  cmd(c) {
    this.app.send({ t: MSG.ADMIN, ...c });
  }

  toggle() {
    if (!this.admin) return;
    const on = !this.el.classList.contains('on');
    this.el.classList.toggle('on', on);
    if (on) {
      this.cmd({ cmd: 'state' });
      this.render();
      this.app.input.releaseLock?.();
    }
  }

  render() {
    const st = this.state || {};
    const app = this.app;
    clear(this.el);
    const row = (label, ...kids) => h('div', { class: 'sb-row' }, h('span', { class: 'sb-l' }, label), ...kids);
    const sel = (options, value) => h('select', {}, ...options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) ? true : undefined }, t)));
    const btn = (t, fn, cls = '') => h('button', { class: `btn tiny ${cls}`, onclick: fn }, t);
    const rank = sel(RANKS.map((r, i) => [i, `${r.abbr} — ${r.name}`]), (app.store.get('profile') || {}).rank || 0);
    const place = sel([...(st.territories || []).map(([id, name]) => [id, name]), ...app.world.hqs.map((b) => [b.id, b.name])], 'midvale');
    const veh = sel((st.vehicles || []).map(([id, n]) => [id, n]), 'jeep');
    const wpn = sel((st.weapons || []).map(([id, n]) => [id, n]), 'ar7');
    const cA = sel(COUNTRY_IDS.map((f) => [f, FACTION_INFO[f].short]), 1);
    const cB = sel(COUNTRY_IDS.map((f) => [f, FACTION_INFO[f].short]), 3);
    const terr = sel((st.territories || []).map(([id, name, o]) => [id, `${name} (${FACTION_INFO[o]?.short || '-'})`]), 'midvale');
    const owner = sel(COUNTRY_IDS.map((f) => [f, FACTION_INFO[f].short]), 1);
    const weather = sel(WEATHER.map((w) => [w, w]), 'clear');
    const clock = h('input', { type: 'range', min: 0, max: 24, step: 0.5, value: 12 });
    const npcF = sel([['', 'Enemy'], ...COUNTRY_IDS.map((f) => [f, FACTION_INFO[f].short])], '');
    const mission = sel(MISSIONS.map((m) => [m, m]), 'capture');
    const country = sel(COUNTRY_IDS.map((f) => [f, FACTION_INFO[f].short]), app.store.get('faction'));
    this.el.append(
      h('div', { class: 'sb-h' }, 'SANDBOX · ADMIN', btn('×', () => this.toggle(), 'sec')),
      h('div', { class: 'sb-quick' },
        btn('★ Make me General of the Army', () => this.cmd({ cmd: 'rank', rank: RANKS.length - 1 })),
        btn('Full Command Points', () => this.cmd({ cmd: 'cp' }), 'sec'),
        btn('God mode + open doors', () => {
          this.cmd({ cmd: 'god', on: true });
          this.cmd({ cmd: 'bypass', on: true });
        }, 'sec'),
        btn('Open war map', () => {
          this.toggle();
          app.menu.open('map');
        }, 'sec')),
      row('Rank', rank, btn('Set', () => this.cmd({ cmd: 'rank', rank: Number(rank.value) }))),
      row('Country', country, btn('Transfer', () => this.cmd({ cmd: 'country', country: Number(country.value) }))),
      row('Teleport', place, btn('Go', () => this.cmd({ cmd: 'tp', to: place.value }))),
      row('Vehicle', veh, btn('Spawn', () => this.cmd({ cmd: 'vehicle', type: veh.value }))),
      row('Weapon', wpn, btn('Equip', () => this.cmd({ cmd: 'weapon', id: wpn.value, slot: 0 }))),
      row('Soldiers', npcF, btn('Spawn squad', () => this.cmd({ cmd: 'npc', n: 6, faction: npcF.value ? Number(npcF.value) : undefined }))),
      row('War', cA, cB, btn('Declare', () => this.cmd({ cmd: 'war', a: Number(cA.value), b: Number(cB.value), on: true })), btn('End', () => this.cmd({ cmd: 'war', a: Number(cA.value), b: Number(cB.value), on: false }), 'sec')),
      row('Territory', terr, owner, btn('Give', () => this.cmd({ cmd: 'territory', id: terr.value, owner: Number(owner.value) })), btn('Battle', () => this.cmd({ cmd: 'battle', id: terr.value }), 'sec')),
      row('Weather', weather, btn('Set', () => this.cmd({ cmd: 'weather', kind: weather.value }))),
      row('Time', clock, btn('Set', () => this.cmd({ cmd: 'time', clock: Number(clock.value) }))),
      row('Mission', mission, btn('Start', () => this.cmd({ cmd: 'mission', kind: mission.value }))),
      row('Destroy', btn('Damage buildings (40 m)', () => this.cmd({ cmd: 'destroy', r: 40, n: 1 })), btn('Level them', () => this.cmd({ cmd: 'destroy', r: 40, n: 3 }), 'sec')),
      row('Player', btn(st.god ? 'God: ON' : 'God: off', () => this.cmd({ cmd: 'god', on: !st.god }), st.god ? '' : 'sec'),
        btn(st.bypass ? 'Doors: open' : 'Doors: enforced', () => this.cmd({ cmd: 'bypass', on: !st.bypass }), st.bypass ? '' : 'sec'),
        btn('+5000 XP', () => this.cmd({ cmd: 'xp', n: 5000 }), 'sec')),
      row('Monitor', btn(st.perf ? 'Performance: ON' : 'Performance: off', () => this.cmd({ cmd: 'perf', on: !st.perf }), st.perf ? '' : 'sec')),
      h('div', { class: 'sb-foot dimmed' }, 'Every action is authorised by the server. ` toggles this panel.'),
    );
  }

  perf(p) {
    const sys = Object.entries(p.systems).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ');
    const r = this.app.renderer;
    const info = r.renderer.info.render;
    this.perfEl.classList.add('on');
    this.perfEl.innerHTML = [
      `<b>SERVER</b> tick ${p.tick} ms · load ${p.load} · players ${p.players}`,
      `NPC ${p.npcs}/${p.npcCap} (full ${p.lod[0]} · reduced ${p.lod[1]} · light ${p.lod[2]}) · staff ${p.staff} · squads ${p.squads}`,
      `battles ${p.battles} (${p.live} live) · battalions ${p.forces} · vehicles ${p.vehicles} · projectiles ${p.projectiles}`,
      `net in ${p.msgIn}/s · out ${p.msgOut}/s · ${p.kbOut} KB/s · entities ${p.entities} · paths ${p.paths} · heap ${p.mem} MB`,
      `<span class="dimmed">${sys}</span>`,
      `<b>CLIENT</b> ${Math.round(r.fps)} fps · ${info.calls} draws · ${Math.round(info.triangles / 1000)}k tris · quality ${r.qualityName}`,
    ].join('<br>');
    clearTimeout(this.perfTimer);
    this.perfTimer = setTimeout(() => this.perfEl.classList.remove('on'), 3000);
  }
}
