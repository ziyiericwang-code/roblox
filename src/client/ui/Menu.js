// In-game menu: Map, Missions, Squad, Career, Quartermaster, Command, Settings.
import { h, clear, esc, fmtNum } from './dom.js';
import { insigniaSVG, ribbonSVG } from './insignia.js';
import { RANKS, rankOf, promotionOptions, REQ_LABELS, SCOPE_NAMES, RANK, TRACK_NAMES, TRACK_RANGE, CLEARANCE_NAMES } from '../../shared/config/ranks.js';
import { MEDALS, MEDAL_TIERS } from '../../shared/config/medals.js';
import { MISSION_TYPES, DIFFICULTY_NAMES } from '../../shared/config/missions.js';
import { ABILITIES, ORDERS, canUseAbility, abilityRankLabel } from '../../shared/config/commands.js';
import { COSMETIC_TABLES, CAMOS } from '../../shared/config/cosmetics.js';
import { ROLES } from '../../shared/config/roles.js';
import { FACTION_INFO, WORLD_HALF, areHostile } from '../../shared/constants.js';
import { formatTime, formatDuration } from '../../shared/math.js';
import { MSG } from '../../shared/protocol.js';
import { QUALITY } from '../render/Renderer.js';

const TABS = [
  ['map', 'Map'],
  ['missions', 'Missions'],
  ['squad', 'Squad'],
  ['career', 'Career'],
  ['store', 'Quartermaster'],
  ['command', 'Command'],
  ['settings', 'Settings'],
];

const STATE_LABEL = { controlled: 'Controlled', contested: 'Contested', under_attack: 'Under attack', liberated: 'Liberated', captured: 'Captured' };

export class Menu {
  constructor(root, app) {
    this.app = app;
    this.el = h('div', { class: 'menu' });
    this.tabsEl = h('div', { class: 'menu-tabs' });
    this.body = h('div', { class: 'menu-body' });
    const close = h('button', { class: 'menu-close', onclick: () => this.close(), title: 'Close' }, '✕');
    this.el.append(h('div', { class: 'menu-head' }, h('div', { class: 'menu-title' }, 'FRONTLINE COMMAND'), this.tabsEl, close), this.body);
    root.appendChild(this.el);
    for (const [id, label] of TABS) {
      this.tabsEl.appendChild(h('button', { class: 'tab', 'data-tab': id, onclick: () => this.open(id) }, label));
    }
    this.tab = 'map';
    this.isOpen = false;
    this.refreshTimer = 0;
    this.pressing = false;
    this.holdUntil = 0;
    this.body.addEventListener('pointerdown', () => {
      this.pressing = true;
    });
    window.addEventListener('pointerup', () => {
      if (!this.pressing) return;
      this.pressing = false;
      this.holdUntil = performance.now() + 400;
    });
    window.addEventListener('pointercancel', () => {
      this.pressing = false;
    });
    this.pendingAbility = null;
    this.selectedTerritory = null;
  }

  open(tab) {
    const app = this.app;
    if (tab) this.tab = tab;
    this.isOpen = true;
    this.el.classList.add('on');
    app.input.enabled = false;
    app.input.releaseLock();
    for (const b of this.tabsEl.children) b.classList.toggle('on', b.dataset.tab === this.tab);
    const rk = (app.store.get('profile') || {}).rank || 0;
    const commands = rankOf(rk).orders.length || rankOf(rk).map || Object.values(ABILITIES).some((ab) => canUseAbility(rk, ab));
    this.tabsEl.querySelector('[data-tab="command"]').style.display = commands ? '' : 'none';
    this.render();
    app.audio.uiClick();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('on');
    this.app.input.enabled = true;
    this.pendingAbility = null;
    this.app.audio.uiClick();
  }

  toggle(tab) {
    if (this.isOpen && (!tab || tab === this.tab)) this.close();
    else this.open(tab);
  }

  update(dt) {
    if (!this.isOpen) return;
    this.refreshTimer += dt;
    if (this.tab === 'map') this.drawMap();
    if (this.tab === 'settings' || this.tab === 'map' || this.el.contains(document.activeElement)) return;
    // Rebuild when the data changed (or every few seconds for cooldown timers), but
    // never under a press in progress: replacing the element between pointerdown and
    // pointerup would swallow the click.
    const changed = this.app.store.version !== this.renderedVersion;
    if ((changed && this.refreshTimer > 0.5) || this.refreshTimer > 3) {
      if (this.pressing || performance.now() < this.holdUntil) return;
      this.refreshTimer = 0;
      this.render();
    }
  }

  render() {
    const b = this.body;
    this.renderedVersion = this.app.store.version;
    clear(b);
    switch (this.tab) {
      case 'map': return this.renderMap(b);
      case 'missions': return this.renderMissions(b);
      case 'squad': return this.renderSquad(b);
      case 'career': return this.renderCareer(b);
      case 'store': return this.renderStore(b);
      case 'command': return this.renderCommand(b);
      case 'settings': return this.renderSettings(b);
      default: return null;
    }
  }

  // ------------------------------------------------------------------ map
  renderMap(b) {
    const wrap = h('div', { class: 'map-wrap' });
    this.mapCanvas = h('canvas', { class: 'map-canvas' });
    this.mapInfo = h('div', { class: 'map-info' });
    wrap.append(this.mapCanvas, this.mapInfo);
    b.appendChild(wrap);
    const c = this.mapCanvas;
    const fit = () => {
      const r = c.getBoundingClientRect();
      c.width = Math.max(200, r.width);
      c.height = Math.max(200, r.height);
    };
    requestAnimationFrame(fit);
    const mv = this.app.mapView;
    let drag = null;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      mv.view.zoom = Math.max(1, Math.min(14, mv.view.zoom * (e.deltaY < 0 ? 1.15 : 0.87)));
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, cx: mv.view.cx, cz: mv.view.cz, moved: false };
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const S = (Math.min(c.width, c.height) / (WORLD_HALF * 2)) * mv.view.zoom;
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
      mv.view.cx = drag.cx - (e.clientX - drag.x) / S;
      mv.view.cz = drag.cz - (e.clientY - drag.y) / S;
    });
    c.addEventListener('pointerup', (e) => {
      const wasDrag = drag && drag.moved;
      drag = null;
      if (wasDrag) return;
      const r = c.getBoundingClientRect();
      const hit = mv.pick(c, e.clientX - r.left, e.clientY - r.top, {});
      if (this.pendingAbility) {
        const ab = ABILITIES[this.pendingAbility];
        if (ab.needsTerritory && hit.type === 'territory') this.app.send({ t: MSG.ABILITY, id: ab.id, territory: hit.id });
        else if (ab.needsPos) this.app.send({ t: MSG.ABILITY, id: ab.id, x: Math.round(hit.x), z: Math.round(hit.z) });
        this.pendingAbility = null;
        this.close();
        return;
      }
      if (this.pendingMove && hit.type === 'territory') {
        this.app.send({ t: MSG.MAPCMD, cmd: 'move', from: this.pendingMove, target: hit.id });
        this.pendingMove = null;
        this.selectedTerritory = hit.id;
        this.renderMapInfo();
        return;
      }
      if (hit.type === 'territory') this.selectedTerritory = hit.id;
      this.renderMapInfo();
    });
    this.renderMapInfo();
  }

  drawMap() {
    if (!this.mapCanvas) return;
    const app = this.app;
    const s = app.store;
    const me = app.player;
    app.mapView.draw(this.mapCanvas, {
      war: s.get('war'), faction: s.get('faction'), missions: s.get('missions'), tracked: s.get('tracked'), squadPos: s.get('squadPos'),
      me: me.alive ? { id: me.id, x: me.s.x, z: me.s.z, yaw: me.yaw } : null,
      selected: this.selectedTerritory, order: this.myOrder(),
    });
  }

  myOrder() {
    const s = this.app.store;
    const sq = (s.get('squads') || []).find((q) => q.id === s.get('mySquad'));
    return sq && sq.order ? sq.order : null;
  }

  renderMapInfo() {
    const el = this.mapInfo;
    if (!el) return;
    clear(el);
    const app = this.app;
    const war = app.store.get('war');
    const f = app.store.get('faction');
    const p = app.store.get('profile') || { rank: 0 };
    const rk = rankOf(p.rank);
    if (this.pendingAbility) {
      el.appendChild(h('div', { class: 'mi-h' }, `Select a target for ${ABILITIES[this.pendingAbility].name}`));
      return;
    }
    if (this.pendingMove) {
      el.appendChild(h('div', { class: 'mi-h' }, `MOVE from ${app.world.tById[this.pendingMove]?.name || 'HQ'}: click the destination`));
      el.appendChild(h('button', { class: 'btn tiny sec', onclick: () => { this.pendingMove = null; this.renderMapInfo(); } }, 'Cancel'));
      return;
    }
    if (war) {
      el.appendChild(h('div', { class: 'mi-h' }, `The war · campaign ${war.campaign}`));
      for (const [a, b2, mins] of war.wars) el.appendChild(h('div', { class: 'mi-row' }, h('b', { style: { color: FACTION_INFO[a].color } }, FACTION_INFO[a].short), ' vs ', h('b', { style: { color: FACTION_INFO[b2].color } }, FACTION_INFO[b2].short), h('span', { class: 'dimmed' }, ` · ${mins} min`)));
      if (!war.wars.length) el.appendChild(h('div', { class: 'mi-row' }, 'No wars — an uneasy peace.'));
      el.appendChild(h('div', { class: 'mi-row dimmed' }, `Army strength (est.): ${Object.entries(war.strength || {}).map(([k, v]) => `${FACTION_INFO[k].short} ${v}`).join(' · ')}`));
      el.appendChild(h('div', { class: 'mi-row dimmed' }, `Command Points ${war.cp[f] ?? 0} · national reserve ${war.reserve}`));
      if (rk.map >= 3) {
        el.appendChild(h('div', { class: 'row' },
          h('button', { class: 'btn tiny', onclick: () => app.send({ t: MSG.MAPCMD, cmd: 'general_offensive' }) }, 'GENERAL OFFENSIVE'),
          h('button', { class: 'btn tiny sec', onclick: () => app.send({ t: MSG.MAPCMD, cmd: 'mobilize' }) }, 'MOBILIZE RESERVE')));
      }
    }
    const id = this.selectedTerritory;
    if (!id || !war) {
      el.appendChild(h('p', { class: 'dimmed' }, rk.map ? 'Click a territory to give strategic orders. Scroll to zoom, drag to pan.' : 'Click a territory for details. Scroll to zoom, drag to pan.'));
      return;
    }
    const t = app.world.tById[id] || app.world.hqs.find((x) => x.id === id);
    const w = war.territories.find((q) => q.id === id);
    if (!t || !w) return;
    el.appendChild(h('div', { class: 'mi-h' }, t.name));
    if (t.blurb) el.appendChild(h('p', { class: 'dimmed' }, t.blurb));
    el.appendChild(h('div', { class: 'mi-row' }, 'Held by: ', h('b', { style: { color: FACTION_INFO[w.owner].color } }, FACTION_INFO[w.owner].name)));
    if (!id.startsWith('hq_')) {
      el.appendChild(h('div', { class: 'mi-row' }, `Status: ${STATE_LABEL[w.state] || w.state}`));
      el.appendChild(h('div', { class: 'mi-row' }, 'Supply: ', h('span', { class: 'meter' }, h('i', { style: { width: `${w.supply}%` } })), ` ${w.supply}%`));
      if (w.str >= 0) el.appendChild(h('div', { class: 'mi-row' }, `Garrison: ${w.owner === f ? '' : '~'}${w.str} soldiers`));
      for (const sc of w.sectors) {
        const sd = t.sectors.find((q) => q.id === sc.id);
        el.appendChild(h('div', { class: 'mi-sector' }, h('b', { style: { color: FACTION_INFO[sc.o]?.color || '#aaa' } }, sc.id), ` ${sd ? sd.name : ''} `, sc.x ? h('span', { class: 'tag' }, 'CONTESTED') : sc.p < 100 ? h('span', { class: 'tag' }, `${sc.p}%`) : ''));
      }
      const b = war.battles.find((x) => x.t === id);
      if (b) el.appendChild(h('div', { class: 'mi-row warn' }, `⚔ Battle: ${FACTION_INFO[b.a].short} ${b.as} vs ${FACTION_INFO[b.d].short} ${b.ds}${b.live ? ' · soldiers on the ground' : ''}`));
    }
    // strategic orders (Colonel: own region, Generals: anywhere)
    if (rk.map && !id.startsWith('hq_')) {
      const row = h('div', { class: 'row map-cmds' });
      const send = (cmd) => app.send({ t: MSG.MAPCMD, cmd, target: id });
      const hostile = areHostile(w.owner, f);
      if (hostile) row.appendChild(h('button', { class: 'btn tiny', onclick: () => send('attack') }, 'ATTACK'));
      if (w.owner === f) {
        row.appendChild(h('button', { class: 'btn tiny', onclick: () => send('defend') }, 'DEFEND'));
        row.appendChild(h('button', { class: 'btn tiny', onclick: () => send('reinforce') }, 'REINFORCE'));
        row.appendChild(h('button', { class: 'btn tiny sec', onclick: () => { this.pendingMove = id; this.renderMapInfo(); } }, 'MOVE FROM HERE…'));
      }
      el.appendChild(h('div', { class: 'mi-h small' }, rk.map === 1 ? 'Regional command (within 1.5 km of you)' : 'Strategic command'));
      el.appendChild(row);
    }
  }

  // ------------------------------------------------------------------ missions
  renderMissions(b) {
    const app = this.app;
    const s = app.store;
    const missions = s.get('missions') || [];
    const ops = s.get('operations') || [];
    const events = s.get('events') || [];
    const tracked = s.get('tracked');
    const profile = s.get('profile');
    const squad = (s.get('squads') || []).find((q) => q.id === s.get('mySquad'));
    const leader = squad && squad.leader === profile.id && profile.rank >= RANK.SERGEANT;
    if (ops.length || events.length) {
      const box = h('div', { class: 'ops' });
      for (const o of ops) box.appendChild(h('div', { class: 'op-card' }, h('b', {}, o.name), ` — ordered by ${o.by} · ${formatTime(o.ends)} left`));
      for (const e of events) box.appendChild(h('div', { class: 'ev-card' }, h('b', {}, e.title), ` · ${formatTime(e.ends)}`));
      b.appendChild(box);
    }
    const list = h('div', { class: 'mission-list' });
    const active = missions.filter((m) => m.status === 'active');
    const done = missions.filter((m) => m.status !== 'active');
    if (!active.length) list.appendChild(h('p', { class: 'dimmed' }, 'Operations is preparing new orders. Missions appear as the war develops.'));
    for (const m of [...active, ...done]) {
      const t = MISSION_TYPES[m.type];
      const terr = m.tid ? app.world.tById[m.tid] : null;
      const dist = Math.round(Math.hypot(m.x - app.player.s.x, m.z - app.player.s.z));
      const card = h('div', { class: `mcard ${m.status}${tracked === m.id ? ' tracked' : ''}` },
        h('div', { class: 'mc-icon' }, t.icon),
        h('div', { class: 'mc-main' },
          h('div', { class: 'mc-title' }, m.title, m.op ? h('span', { class: 'tag op' }, m.op) : ''),
          h('div', { class: 'mc-brief' }, m.brief),
          h('div', { class: 'mc-meta' },
            h('span', {}, terr ? terr.name : ''),
            h('span', {}, `${'★'.repeat(m.diff)}${'☆'.repeat(5 - m.diff)} ${DIFFICULTY_NAMES[m.diff]}`),
            h('span', {}, `Rec. ${rankOf(m.rec).abbr}+`),
            h('span', {}, `${m.xp} XP · ${m.cr} cr`),
            m.status === 'active' ? h('span', {}, `${formatTime(m.ends)} left · ${dist} m`) : h('span', { class: m.status === 'success' ? 'good' : 'bad' }, m.result),
            m.prog ? h('span', {}, m.prog) : '',
            m.n ? h('span', {}, `${m.n} soldier${m.n > 1 ? 's' : ''} involved`) : '',
          )),
        m.status === 'active' ? h('div', { class: 'mc-actions' },
          h('button', { class: 'btn', onclick: () => {
            app.send({ t: MSG.MISSION, a: tracked === m.id ? 'untrack' : 'track', id: m.id });
            app.store.set('tracked', tracked === m.id ? 0 : m.id);
            this.render();
          } }, tracked === m.id ? 'Untrack' : 'Track'),
          leader ? h('button', { class: 'btn sec', onclick: () => {
            app.send({ t: MSG.SQUAD, a: 'mission', id: m.id });
            app.hud.toast('Squad objective set');
          } }, 'Assign squad') : '',
        ) : '');
      list.appendChild(card);
    }
    b.appendChild(list);
  }

  // ------------------------------------------------------------------ squad
  renderSquad(b) {
    const app = this.app;
    const s = app.store;
    const profile = s.get('profile');
    const squads = s.get('squads') || [];
    const mineId = s.get('mySquad');
    const mine = squads.find((q) => q.id === mineId);
    const canLead = profile.rank >= RANK.CORPORAL;
    const col = h('div', { class: 'cols' });
    const left = h('div', { class: 'col' });
    const right = h('div', { class: 'col' });
    col.append(left, right);
    b.appendChild(col);
    if (mine) {
      const isLeader = mine.leader === profile.id;
      left.appendChild(h('h3', {}, `Squad ${mine.name}`, mine.locked ? h('span', { class: 'tag' }, 'INVITE ONLY') : ''));
      left.appendChild(h('p', { class: 'dimmed' }, `Leader: ${rankOf(mine.leaderRank).abbr} ${mine.leaderName} · ${mine.members.length}/${mine.max}${mine.npcs ? ` · ${mine.npcs} attached soldiers` : ''}`));
      if (mine.order) left.appendChild(h('div', { class: 'mi-row warn' }, `Current order: ${mine.order.type.toUpperCase()} (by ${mine.order.by})`));
      const tbl = h('div', { class: 'members' });
      for (const m of mine.members) {
        tbl.appendChild(h('div', { class: 'member' },
          h('span', { html: insigniaSVG(m.rank, 22) }), h('b', {}, `${rankOf(m.rank).abbr} ${m.name}`), h('span', { class: 'dimmed' }, ROLES[m.role] ? ROLES[m.role].name : ''),
          m.id === mine.leader ? h('span', { class: 'tag' }, 'LEADER') : '',
          isLeader && m.id !== profile.id ? h('button', { class: 'btn tiny sec', onclick: () => app.send({ t: MSG.SQUAD, a: 'kick', player: m.id }) }, 'Kick') : '',
          isLeader && m.id !== profile.id && m.rank >= RANK.CORPORAL ? h('button', { class: 'btn tiny sec', onclick: () => app.send({ t: MSG.SQUAD, a: 'promote', player: m.id }) }, 'Make leader') : '',
        ));
      }
      left.appendChild(tbl);
      const actions = h('div', { class: 'row' });
      if (isLeader) {
        actions.appendChild(h('button', { class: 'btn sec', onclick: () => app.send({ t: MSG.SQUAD, a: 'lock', locked: !mine.locked }) }, mine.locked ? 'Open squad' : 'Invite only'));
        if (profile.rank >= RANK.SERGEANT) actions.appendChild(h('button', { class: 'btn sec', onclick: () => app.send({ t: MSG.SQUAD, a: 'rally' }) }, 'Place rally point'));
      }
      actions.appendChild(h('button', { class: 'btn danger', onclick: () => app.send({ t: MSG.SQUAD, a: 'leave' }) }, 'Leave squad'));
      left.appendChild(actions);
      if (isLeader) {
        left.appendChild(h('h4', {}, 'Leader duties'));
        left.appendChild(h('p', { class: 'dimmed' }, `Hold V (or tap ⌖) to order your squad: attack, defend, move, hold, follow, regroup, escort, fall back. Squadmates who carry out orders earn XP and you earn leadership. ${profile.rank >= RANK.SERGEANT ? 'Assign missions from the Missions tab.' : 'From Sergeant you can assign missions and place rally points.'}`));
      }
    } else {
      left.appendChild(h('h3', {}, 'No squad'));
      left.appendChild(h('p', { class: 'dimmed' }, 'Soldiers in a squad earn +10% XP near squadmates, can spawn on their leader and receive orders. Join one on the right.'));
      if (canLead) {
        left.appendChild(h('button', { class: 'btn', onclick: () => app.send({ t: MSG.SQUAD, a: 'create' }) }, `Form a ${profile.rank >= RANK.SERGEANT ? 'squad (8)' : 'fireteam (4)'}`));
      } else left.appendChild(h('p', { class: 'dimmed' }, 'You can lead your own fireteam from the rank of Corporal.'));
    }
    const invites = s.get('invites') || [];
    right.appendChild(h('h3', {}, 'Squads'));
    if (!squads.length) right.appendChild(h('p', { class: 'dimmed' }, 'No squads have been formed yet.'));
    for (const q of squads) {
      if (q.id === mineId) continue;
      const invited = invites.includes(q.id);
      right.appendChild(h('div', { class: 'sq-card' },
        h('b', {}, `Squad ${q.name}`), h('span', { class: 'dimmed' }, ` ${rankOf(q.leaderRank).abbr} ${q.leaderName} · ${q.members.length}/${q.max}`),
        q.locked && !invited ? h('span', { class: 'tag' }, 'INVITE ONLY') : h('button', { class: 'btn tiny', onclick: () => app.send({ t: MSG.SQUAD, a: 'join', id: q.id }) }, invited ? 'Accept invite' : 'Join'),
      ));
    }
  }

  // ------------------------------------------------------------------ career
  renderCareer(b) {
    const app = this.app;
    const p = app.store.get('profile');
    if (!p) return;
    const r = rankOf(p.rank);
    const f = app.store.get('faction');
    const head = h('div', { class: 'career-head' },
      h('div', { class: 'big-ins', html: insigniaSVG(p.rank, 96) }),
      h('div', {},
        h('div', { class: 'ch-rank' }, `${r.name.toUpperCase()} · ${r.grade}`),
        h('div', { class: 'ch-name' }, `${p.name}${f ? ` — ${FACTION_INFO[f].army}` : ''}`),
        h('div', { class: 'ch-role' }, r.role.toUpperCase()),
        h('div', { class: 'ch-duty' }, r.duty),
        h('div', { class: 'ch-stats' }, `${fmtNum(p.xp)} XP · ${formatDuration(p.stats.service || 0)} service · Rating ${p.rating} · ${TRACK_NAMES[r.track]}`),
      ));
    b.appendChild(head);
    const cols = h('div', { class: 'cols' });
    const left = h('div', { class: 'col' });
    const right = h('div', { class: 'col' });
    cols.append(left, right);
    b.appendChild(cols);
    // what this rank can do
    const orders = r.orders.map((o) => ORDERS[o].name.toUpperCase());
    const abilities = Object.values(ABILITIES).filter((ab) => canUseAbility(p.rank, ab)).map((ab) => ab.name);
    left.appendChild(h('h3', {}, 'At your rank'));
    left.appendChild(h('div', { class: 'can' },
      h('div', {}, h('b', {}, 'Orders: '), orders.length ? `${orders.join(', ')} (${SCOPE_NAMES[r.scope].toLowerCase()} scope)` : 'none — you follow orders'),
      h('div', {}, h('b', {}, 'Access: '), `${CLEARANCE_NAMES[r.clearance]} areas`),
      r.map ? h('div', {}, h('b', {}, 'Strategy: '), r.map >= 3 ? 'supreme command from the war map' : r.map === 2 ? 'ATTACK / DEFEND / MOVE / REINFORCE anywhere from the war map' : 'regional orders from the war map') : null,
      abilities.length ? h('div', {}, h('b', {}, 'Abilities: '), abilities.join(', ')) : null,
      r.npcFollowers ? h('div', {}, h('b', {}, 'Attached soldiers: '), String(r.npcFollowers)) : null));
    // promotion paths
    const opts = promotionOptions(p);
    if (!opts.length) left.appendChild(h('h3', {}, 'You hold the highest rank of your career.'));
    for (const o of opts) {
      const next = RANKS[o.to];
      const title = o.kind === 'commission' ? `Officer Candidate School → ${next.name}` : o.kind === 'warrant' ? `Warrant Officer → ${next.name}` : `Next: ${next.name}`;
      left.appendChild(h('h3', { class: o.met ? 'ready' : '' }, h('span', { html: insigniaSVG(o.to, 24) }), ` ${title}`));
      left.appendChild(h('p', { class: 'dimmed' }, `${next.role}. ${next.duty}`));
      for (const it of o.items) {
        const frac = Math.min(1, it.have / Math.max(1, it.need));
        left.appendChild(h('div', { class: `req${it.met ? ' met' : ''}` },
          h('span', { class: 'req-l' }, REQ_LABELS[it.key] || it.key),
          h('span', { class: 'meter' }, h('i', { style: { width: `${frac * 100}%` } })),
          h('span', { class: 'req-v' }, it.key === 'training' ? (it.met ? 'Done' : 'Required') : `${fmtNum(it.have)} / ${fmtNum(it.need)}`)));
      }
      if (o.met) {
        left.appendChild(h('div', { class: 'promo-ready' }, h('b', {}, 'PROMOTION AVAILABLE'), ' Report to any friendly base or a senior officer, then accept.',
          h('button', { class: 'btn', onclick: () => app.requestPromotion(o.to) }, o.kind === 'promotion' ? 'Accept promotion' : 'Apply')));
      }
    }
    // ladder by track
    left.appendChild(h('h4', {}, 'The hierarchy'));
    for (const tr of ['E', 'W', 'O']) {
      const [a, z] = TRACK_RANGE[tr];
      const ladder = h('div', { class: 'ladder' }, h('div', { class: 'lt' }, TRACK_NAMES[tr]));
      for (let i = a; i <= z; i++) {
        const rk = RANKS[i];
        ladder.appendChild(h('div', { class: `lr${i === p.rank ? ' cur' : ''}${i < p.rank && rk.track === r.track ? ' past' : ''}`, title: `${rk.name} (${rk.role}): ${rk.duty}` }, h('span', { html: insigniaSVG(i, 22) }), h('span', {}, rk.abbr)));
      }
      left.appendChild(ladder);
    }
    // stats
    const S = p.stats;
    const statRows = [
      ['Missions completed', S.missions], ['Objectives taken', S.captures], ['Objectives defended', S.defends], ['Territories taken', S.territories],
      ['Battles fought', S.battles], ['Battles won / operations', S.operations], ['Leadership', S.leadership], ['Orders issued', S.ordersIssued],
      ['Revives', S.revives], ['Resupplies', S.resupplies], ['Minutes crewing vehicles', S.crew], ['Enemies neutralised', S.kills], ['KIA', S.deaths],
      ['Supplies delivered', S.supplies], ['Vehicles destroyed', S.vehicleKills], ['Promotions', S.promotions], ['Range best', `${S.rangeBest || 0}/10`], ['Campaigns won', S.campaigns],
    ];
    const grid = h('div', { class: 'statgrid' });
    for (const [k, v] of statRows) grid.appendChild(h('div', { class: 'stat' }, h('span', {}, k), h('b', {}, typeof v === 'number' ? fmtNum(v) : v || 0)));
    left.appendChild(h('h4', {}, 'Statistics'));
    left.appendChild(grid);
    // medals
    right.appendChild(h('h3', {}, 'Medals & Awards'));
    const mg = h('div', { class: 'medals' });
    for (const m of MEDALS) {
      const tier = p.medals[m.id];
      const earned = tier !== undefined;
      const val = m.stat === 'training' ? (p.trainingComplete && !p.trainingSkipped ? 1 : 0) : p.stats[m.stat] || 0;
      const nextTier = earned ? tier + 1 : 0;
      const goal = m.tiers[nextTier];
      mg.appendChild(h('div', { class: `medal${earned ? ' earned' : ''}`, title: m.desc },
        h('span', { html: ribbonSVG(m.id, earned ? tier : 0) }),
        h('div', {}, h('b', {}, m.name), h('div', { class: 'dimmed' }, earned ? (m.tiers.length > 1 ? MEDAL_TIERS[tier] : 'Awarded') + (goal !== undefined ? ` · next ${fmtNum(val)}/${fmtNum(goal)}` : '') : goal !== undefined ? `${fmtNum(val)}/${fmtNum(goal)}` : ''))));
    }
    right.appendChild(mg);
    right.appendChild(h('h4', {}, 'Service record'));
    const rec = h('div', { class: 'record' });
    for (const e of [...(p.record || [])].reverse()) rec.appendChild(h('div', { class: `rec ${e.type}` }, h('span', {}, new Date(e.t).toLocaleDateString()), ` ${e.text}`));
    if (!p.record || !p.record.length) rec.appendChild(h('p', { class: 'dimmed' }, 'Your service record will fill as you serve.'));
    right.appendChild(rec);
  }

  // ------------------------------------------------------------------ store
  renderStore(b) {
    const app = this.app;
    const p = app.store.get('profile');
    b.appendChild(h('div', { class: 'store-head' }, h('h3', {}, 'Quartermaster'), h('span', { class: 'credits' }, `${fmtNum(p.credits)} credits`)));
    b.appendChild(h('p', { class: 'dimmed' }, 'Cosmetics only — nothing here changes combat. Credits come from missions, objectives, leadership and service.'));
    const cats = [['camo', 'Uniform camouflage'], ['headgear', 'Headgear'], ['emote', 'Gestures'], ['vehicle', 'Vehicle finish']];
    for (const [cat, label] of cats) {
      b.appendChild(h('h4', {}, label));
      const row = h('div', { class: 'store-row' });
      for (const item of Object.values(COSMETIC_TABLES[cat])) {
        if (item.national) continue;
        const owned = (p.unlocks[cat] || []).includes(item.id);
        const equipped = p.cosmetics[cat] === item.id;
        const locked = (item.minRank || 0) > p.rank;
        const sw = cat === 'camo' ? h('div', { class: 'swatch' }, ...CAMOS[item.id].colors.map((c) => h('i', { style: { background: c } }))) : h('div', { class: 'swatch icon' }, cat === 'emote' ? '✋' : cat === 'vehicle' ? '▣' : '⛑');
        let btn;
        if (item.premium && !owned) btn = h('span', { class: 'tag' }, 'Supporter pack');
        else if (equipped) btn = h('span', { class: 'tag good' }, 'Equipped');
        else if (owned) btn = cat === 'emote' ? h('span', { class: 'tag' }, 'Owned') : h('button', { class: 'btn tiny', onclick: () => app.send({ t: MSG.COSMETIC, a: 'equip', cat, id: item.id }) }, 'Equip');
        else if (locked) btn = h('span', { class: 'tag' }, `${rankOf(item.minRank).abbr}+`);
        else btn = h('button', { class: 'btn tiny', disabled: p.credits < item.price ? true : undefined, onclick: () => app.send({ t: MSG.COSMETIC, a: 'buy', cat, id: item.id }) }, `${fmtNum(item.price)} cr`);
        row.appendChild(h('div', { class: `item${equipped ? ' eq' : ''}` }, sw, h('div', { class: 'it-name' }, item.name), btn));
      }
      b.appendChild(row);
    }
  }

  // ------------------------------------------------------------------ command
  renderCommand(b) {
    const app = this.app;
    const p = app.store.get('profile');
    const cmd = app.store.get('cmd') || {};
    const r = rankOf(p.rank);
    b.appendChild(h('div', { class: 'store-head' }, h('h3', {}, 'Command'), h('span', { class: 'credits' }, `Command Points ${cmd.cp ?? 0} / ${cmd.cpMax ?? 100}`)));
    b.appendChild(h('p', { class: 'dimmed' }, `${r.role}. Orders: ${r.orders.length ? r.orders.map((o) => ORDERS[o].name).join(', ') : 'none'} · scope ${SCOPE_NAMES[r.scope]}. Command Points are shared by the whole army and regenerate with territory held and supplies delivered.${r.map ? ' Strategic orders are given from the Map tab.' : ''}`));
    if (cmd.offensive) b.appendChild(h('div', { class: 'mi-row warn' }, `Major offensive on ${app.world.tById[cmd.offensive.territory].name} (by ${cmd.offensive.by})`));
    if (cmd.priority) b.appendChild(h('div', { class: 'mi-row' }, `Strategic priority: ${app.world.tById[cmd.priority.territory].name} (set by ${cmd.priority.by})`));
    const grid = h('div', { class: 'abilities' });
    for (const ab of Object.values(ABILITIES)) {
      const locked = !canUseAbility(p.rank, ab);
      const cd = (cmd.ready || {})[ab.id];
      const card = h('div', { class: `ab${locked ? ' locked' : ''}` },
        h('b', {}, ab.name), h('div', { class: 'dimmed' }, ab.desc),
        h('div', { class: 'ab-meta' }, `${abilityRankLabel(ab)} · ${ab.cp} CP · ${ab.cooldown}s cooldown`),
        locked ? h('span', { class: 'tag' }, 'Locked') : cd ? h('span', { class: 'tag' }, `Ready in ${cd}s`) :
          h('button', { class: 'btn tiny', onclick: () => this.useAbility(ab) }, ab.needsTerritory || ab.needsPos ? 'Select target' : 'Use'));
      grid.appendChild(card);
    }
    b.appendChild(grid);
  }

  useAbility(ab) {
    const app = this.app;
    if (ab.needsTerritory || (ab.needsPos && ab.range > 600)) {
      this.pendingAbility = ab.id;
      this.open('map');
      return;
    }
    if (ab.needsPos) {
      // call it on the point under the crosshair
      const hit = app.crosshairPoint(ab.range || 400);
      if (!hit) {
        app.hud.toast('No valid target under your crosshair', 'warn');
        return;
      }
      app.send({ t: MSG.ABILITY, id: ab.id, x: Math.round(hit.x), z: Math.round(hit.z) });
      this.close();
      return;
    }
    app.send({ t: MSG.ABILITY, id: ab.id });
    this.close();
  }

  // ------------------------------------------------------------------ settings
  renderSettings(b) {
    const app = this.app;
    const st = app.settings;
    const row = (label, input) => h('label', { class: 'set' }, h('span', {}, label), input);
    const slider = (key, min, max, step) => {
      const i = h('input', { type: 'range', min, max, step, value: st[key] });
      i.addEventListener('input', () => {
        st[key] = Number(i.value);
        app.applySettings();
      });
      return i;
    };
    const check = (key) => {
      const i = h('input', { type: 'checkbox' });
      i.checked = !!st[key];
      i.addEventListener('change', () => {
        st[key] = i.checked;
        app.applySettings();
      });
      return i;
    };
    const quality = h('select', {}, ...Object.keys(QUALITY).map((q) => h('option', { value: q, selected: st.quality === q ? true : undefined }, q[0].toUpperCase() + q.slice(1))));
    quality.addEventListener('change', () => {
      st.quality = quality.value;
      app.applySettings(true);
    });
    const cam = h('select', {}, h('option', { value: 'third', selected: !st.firstPerson ? true : undefined }, 'Third person'), h('option', { value: 'first', selected: st.firstPerson ? true : undefined }, 'First person'));
    cam.addEventListener('change', () => {
      st.firstPerson = cam.value === 'first';
      app.applySettings();
    });
    b.append(
      h('div', { class: 'cols' },
        h('div', { class: 'col' },
          h('h3', {}, 'Graphics'),
          row('Quality preset', quality),
          row('Camera', cam),
          row('Show FPS', check('showFps')),
          h('p', { class: 'dimmed' }, 'Resolution scales down automatically if the frame rate drops. Changing the preset rebuilds shadows and vegetation.'),
          h('h3', {}, 'Controls'),
          row('Look sensitivity', slider('sensitivity', 0.2, 3, 0.05)),
          row('Invert look', check('invertY')),
          row('Touch controls', check('touch')),
        ),
        h('div', { class: 'col' },
          h('h3', {}, 'Audio'),
          row('Master', slider('master', 0, 1, 0.05)),
          row('Effects', slider('sfx', 0, 1, 0.05)),
          row('Ambience', slider('ambient', 0, 1, 0.05)),
          row('Music', slider('music', 0, 1, 0.05)),
          row('Interface', slider('ui', 0, 1, 0.05)),
          h('h3', {}, 'Keys'),
          h('div', { class: 'keys', html: KEYS_HTML }),
        ),
      ),
      h('div', { class: 'row' },
        h('button', { class: 'btn sec', onclick: () => {
          this.close();
          app.send({ t: MSG.RETURN });
        } }, 'Redeploy'),
        app.store.get('solo') ? h('span', { class: 'dimmed' }, 'Solo campaign — progress is saved in this browser.') : h('span', { class: 'dimmed' }, 'Connected to multiplayer server.'),
      ),
    );
  }
}

const KEYS_HTML = `
<div><b>WASD</b> move · <b>Shift</b> sprint · <b>Space</b> jump · <b>C</b> crouch · <b>Z</b> prone · <b>Q/E</b> lean</div>
<div><b>LMB</b> fire · <b>RMB</b> aim · <b>R</b> reload · <b>1-5</b>/wheel weapons · <b>B</b> fire mode · <b>G</b> grenade (hold to cook)</div>
<div><b>F</b> interact / enter vehicle · <b>T</b> spot enemy · <b>V</b> command wheel · <b>Y</b> salute · <b>X</b> hold to redeploy</div>
<div><b>M</b> map · <b>J</b> missions · <b>P</b> squad · <b>Tab</b> menu · <b>K</b> first/third person</div>
<div>Vehicles: <b>WASD</b> drive · <b>Space/C</b> climb/descend · mouse aim · <b>1-5</b> change seat · <b>F</b> exit</div>`;

