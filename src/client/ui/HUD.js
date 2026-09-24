// Heads-up display. Minimal by design: health/armor/stamina, ammo, current
// objective + compass, rank & squad, radio feed, and transient feedback.
import { h, clear, esc } from './dom.js';
import { insigniaSVG } from './insignia.js';
import { rankOf, promotionOptions, clearanceRankName } from '../../shared/config/ranks.js';
import { FACTION_INFO } from '../../shared/constants.js';
import { WEAPONS, computeSpread } from '../../shared/config/weapons.js';
import { MISSION_TYPES } from '../../shared/config/missions.js';
import { ORDERS } from '../../shared/config/commands.js';
import { STANCE, LIFE, STAMINA } from '../../shared/constants.js';
import { formatTime, yawFromDir, wrapAngle } from '../../shared/math.js';
import { MEDAL_BY_ID, MEDAL_TIERS } from '../../shared/config/medals.js';

export class HUD {
  constructor(root, app) {
    this.app = app;
    this.root = root;
    this.el = h('div', { class: 'hud' });
    root.appendChild(this.el);
    this.el.innerHTML = `
      <div class="hud-tl">
        <div class="rankbox"><span class="rk-ins"></span><div><div class="rk-name"></div><div class="rk-sub"></div></div></div>
        <div class="promo-pill"></div>
        <div class="locbox"></div>
        <div class="squadbox"></div>
      </div>
      <div class="hud-top">
        <div class="compass"><div class="compass-strip"></div><div class="compass-marks"></div><div class="compass-center"></div></div>
        <div class="objective"></div>
        <div class="event-banner"></div>
      </div>
      <div class="hud-tr"><div class="radio"></div></div>
      <div class="hud-bl">
        <div class="bars">
          <div class="bar hp"><i></i><span></span></div>
          <div class="bar ar"><i></i></div>
          <div class="bar st"><i></i></div>
        </div>
        <div class="status"></div>
      </div>
      <div class="hud-br">
        <div class="wname"></div>
        <div class="ammo"><b class="mag"></b><span class="res"></span></div>
        <div class="slots"></div>
      </div>
      <div class="crosshair"><i class="c-t"></i><i class="c-b"></i><i class="c-l"></i><i class="c-r"></i><i class="c-dot"></i></div>
      <div class="hitmarker"></div>
      <div class="dmg-ind"></div>
      <div class="prompt"></div>
      <div class="actionbar"><i></i><span></span></div>
      <div class="popups"></div>
      <div class="kills"></div>
      <div class="banner"></div>
      <div class="scope"><div class="scope-ret"></div></div>
      <div class="vignette"></div>
      <div class="downed"></div>
      <div class="trainbox"></div>
      <div class="toast"></div>
      <div class="fps"></div>`;
    const q = (s) => this.el.querySelector(s);
    this.$ = {
      rkIns: q('.rk-ins'), rkName: q('.rk-name'), rkSub: q('.rk-sub'), squad: q('.squadbox'), promo: q('.promo-pill'), loc: q('.locbox'),
      strip: q('.compass-strip'), marks: q('.compass-marks'), objective: q('.objective'), eventBanner: q('.event-banner'),
      radio: q('.radio'), hp: q('.bar.hp i'), hpTxt: q('.bar.hp span'), ar: q('.bar.ar i'), st: q('.bar.st i'), status: q('.status'),
      wname: q('.wname'), mag: q('.ammo .mag'), res: q('.ammo .res'), slots: q('.slots'),
      cross: q('.crosshair'), hit: q('.hitmarker'), dmg: q('.dmg-ind'), prompt: q('.prompt'), action: q('.actionbar'),
      actionFill: q('.actionbar i'), actionTxt: q('.actionbar span'), popups: q('.popups'), kills: q('.kills'), banner: q('.banner'),
      scope: q('.scope'), vignette: q('.vignette'), downed: q('.downed'), train: q('.trainbox'), toast: q('.toast'), fps: q('.fps'),
    };
    // compass strip: ticks every 15 degrees
    let strip = '';
    for (let rep = 0; rep < 3; rep++) {
      for (let d = 0; d < 360; d += 15) {
        const lab = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[d];
        strip += `<span class="${lab ? 'cmaj' : 'cmin'}">${lab || '·'}</span>`;
      }
    }
    this.$.strip.innerHTML = strip;
    this.radioLines = [];
    this.popupList = [];
    this.xpAcc = null;
    this.hitT = 0;
    this.dmgMarks = [];
    this.action = null;
    this.hold = null;
    this.bannerT = 0;
    this.toastT = 0;
    this.lastObjective = '';
    this.lastSquad = '';
    this.lastRank = -1;
    this.visible = true;
    this.downedUntil = 0;
  }

  show(v) {
    this.visible = v;
    this.el.style.display = v ? '' : 'none';
  }

  // ------------------------------------------------------------------ feeds
  radio(channel, from, text, priority = 0) {
    const line = h('div', { class: `rl ch-${channel} p${priority}` }, h('b', {}, from ? `${from}: ` : ''), text);
    this.$.radio.appendChild(line);
    this.radioLines.push({ el: line, t: performance.now() });
    while (this.radioLines.length > 6) this.radioLines.shift().el.remove();
  }

  xp(amount, reason) {
    const now = performance.now();
    if (this.xpAcc && now - this.xpAcc.t < 1200 && this.xpAcc.reason === reason) {
      this.xpAcc.amount += amount;
      this.xpAcc.t = now;
      this.xpAcc.el.innerHTML = `<b>+${this.xpAcc.amount}</b> ${esc(reason)}`;
      return;
    }
    const el = h('div', { class: 'pop' });
    el.innerHTML = `<b>+${amount}</b> ${esc(reason)}`;
    this.$.popups.prepend(el);
    this.xpAcc = { amount, reason, t: now, el };
    this.popupList.push({ el, t: now });
    while (this.popupList.length > 5) this.popupList.shift().el.remove();
  }

  killNote(text) {
    const el = h('div', { class: 'kn' }, text);
    this.$.kills.prepend(el);
    setTimeout(() => el.remove(), 3500);
  }

  hitmarker(kill, head) {
    this.$.hit.className = `hitmarker on${kill ? ' kill' : ''}${head ? ' head' : ''}`;
    this.hitT = performance.now();
  }

  damage(amount, fx, fz) {
    const me = this.app.player;
    const ang = wrapAngle(yawFromDir(fx, fz) - me.yaw);
    const el = h('i', { class: 'dm' });
    el.style.transform = `rotate(${-ang}rad)`;
    el.style.opacity = Math.min(1, 0.4 + amount / 40);
    this.$.dmg.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  banner(title, sub, kind = 'info', insignia = null) {
    this.$.banner.className = `banner on ${kind}`;
    this.$.banner.innerHTML = `${insignia || ''}<div class="bt">${esc(title)}</div><div class="bs">${esc(sub || '')}</div>`;
    this.bannerT = performance.now() + 4200;
  }

  promotion(rank, kind, by) {
    const r = rankOf(rank);
    const title = kind === 'commission' ? `COMMISSIONED: ${r.name.toUpperCase()}` : kind === 'warrant' ? `APPOINTED: ${r.name.toUpperCase()}` : kind === 'admin' ? `RANK SET: ${r.name.toUpperCase()}` : `PROMOTED: ${r.name.toUpperCase()}`;
    this.banner(title, `${by ? `Presented by ${by}. ` : ''}${r.role.toUpperCase()} — ${r.duty}`, 'promo', insigniaSVG(rank, 72));
    this.promoKey = '';
  }

  promotionReady(to, kind) {
    const r = rankOf(to);
    const what = kind === 'commission' ? 'Officer Candidate School' : kind === 'warrant' ? 'Warrant Officer appointment' : r.name;
    this.banner('PROMOTION AVAILABLE', `${what}. Report to a friendly base or a senior officer.`, 'promo', insigniaSVG(to, 60));
  }

  restricted(name, level) {
    this.toast(`RESTRICTED — ${name}: ${clearanceRankName(level)} only`, 'warn');
  }

  medal(id, tier) {
    const m = MEDAL_BY_ID[id];
    if (!m) return;
    this.banner(`AWARDED: ${m.name.toUpperCase()}`, m.tiers.length > 1 ? `${MEDAL_TIERS[tier]} — ${m.desc}` : m.desc, 'medal');
  }

  toast(text, kind = 'info') {
    this.$.toast.className = `toast on ${kind}`;
    this.$.toast.textContent = text;
    this.toastT = performance.now() + 2600;
  }

  setInteract(it) {
    const p = this.$.prompt;
    if (!it) {
      p.classList.remove('on');
      return;
    }
    const key = this.app.input.touchMode ? '' : it.hold ? '[Hold F] ' : '[F] ';
    p.textContent = `${key}${it.label}`;
    p.classList.add('on');
    if (this.app.touch) this.app.touch.setContext({ interact: it.label.split(' ')[0].toUpperCase().slice(0, 8), air: this.app.player.veh && this.app.player.veh.def.air, vehicle: !!this.app.player.vehicle });
  }

  setAction(type, dur) {
    this.action = type ? { type, dur, start: performance.now() } : null;
  }

  setHold(kind, frac, label) {
    this.hold = kind ? { frac, label } : null;
  }

  setTraining(t) {
    const el = this.$.train;
    if (!t || !t.active) {
      el.classList.remove('on');
      return;
    }
    if (!this.tb) {
      // built once and updated in place so the buttons stay clickable
      el.innerHTML = '<div class="tb-h">BASIC TRAINING <span class="tb-n"></span></div><div class="tb-t"></div><div class="tb-hint"></div><div class="tb-p"><i></i></div>'
        + '<button class="tb-skip">Skip training</button>'
        + '<div class="tb-confirm"><div>Skip basic training? You will be promoted to Private, but without the Basic Training Ribbon.</div>'
        + '<button class="btn tiny tb-yes">Skip training</button><button class="btn tiny sec tb-no">Keep training</button></div>';
      const q = (s) => el.querySelector(s);
      this.tb = { n: q('.tb-n'), t: q('.tb-t'), hint: q('.tb-hint'), p: q('.tb-p'), bar: q('.tb-p i') };
      q('.tb-skip').onclick = () => el.classList.add('confirming');
      q('.tb-no').onclick = () => el.classList.remove('confirming');
      q('.tb-yes').onclick = () => {
        el.classList.remove('confirming');
        this.app.skipTraining();
      };
    }
    el.classList.add('on');
    const tb = this.tb;
    tb.n.textContent = `${t.step + 1}/${t.total}`;
    tb.t.textContent = t.text;
    tb.hint.textContent = t.hint || '';
    tb.p.style.display = t.prog ? '' : 'none';
    tb.bar.style.width = `${Math.round((t.prog || 0) * 100)}%`;
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    if (!this.visible) return;
    const app = this.app;
    const me = app.player;
    const store = app.store;
    const now = performance.now();
    const profile = store.get('profile');
    // rank & name
    if (profile && profile.rank !== this.lastRank) {
      this.lastRank = profile.rank;
      this.$.rkIns.innerHTML = insigniaSVG(profile.rank, 34);
      this.$.rkName.textContent = `${rankOf(profile.rank).name} ${profile.name}`;
    }
    if (profile) this.$.rkSub.textContent = `${rankOf(profile.rank).role.toUpperCase()}${me.role ? ` · ${me.role.toUpperCase()}` : ''}`;
    // promotion available: ready paths and where to receive it
    if (profile && now - (this.promoCheck || 0) > 700) {
      this.promoCheck = now;
      const ready = promotionOptions(profile).filter((o) => o.met);
      const key = ready.map((o) => o.to).join(',');
      if (key !== this.promoKey) {
        this.promoKey = key;
        const o = ready[0];
        this.$.promo.innerHTML = o ? `<b>PROMOTION AVAILABLE</b> ${esc(rankOf(o.to).abbr)}${ready.length > 1 ? ` +${ready.length - 1}` : ''} · ${app.input.touchMode ? 'Career tab' : '[U] at a base or talk to an officer'}` : '';
        this.$.promo.classList.toggle('on', !!o);
      }
      // current location: place, region and who holds it
      const pl = app.world.placeAt(me.s.x, me.s.z);
      const war = store.get('war');
      const terr = pl.territory && war ? war.territories.find((t) => t.id === pl.territory) : null;
      const owner = terr ? FACTION_INFO[terr.owner] : null;
      const inBase = Object.values(app.world.bases).find((b) => Math.hypot(b.x - me.s.x, b.z - me.s.z) < Math.max(b.rect[0], b.rect[1]));
      const where = inBase ? inBase.name : pl.place || pl.region || 'Open country';
      const locKey = `${where}|${pl.region}|${owner ? owner.short : ''}|${terr ? terr.state : ''}`;
      if (locKey !== this.locKey) {
        this.locKey = locKey;
        const st = terr && terr.state !== 'controlled' ? ` · <span class="loc-st">${esc(terr.state.replace('_', ' ').toUpperCase())}</span>` : '';
        this.$.loc.innerHTML = `<b>${esc(where)}</b>${pl.region && pl.region !== where ? ` · ${esc(pl.region)}` : ''}${owner ? ` <span class="loc-own" style="color:${owner.color}">${esc(owner.short)}</span>` : ''}${st}`;
      }
    }
    // squad
    const squads = store.get('squads') || [];
    const mine = squads.find((s) => s.id === store.get('mySquad'));
    const sqKey = mine ? JSON.stringify(mine.members.map((m) => [m.name, m.alive, m.role])) + mine.name : '';
    if (sqKey !== this.lastSquad) {
      this.lastSquad = sqKey;
      clear(this.$.squad);
      if (mine) {
        this.$.squad.appendChild(h('div', { class: 'sq-h' }, `SQUAD ${mine.name.toUpperCase()}`));
        for (const m of mine.members) {
          this.$.squad.appendChild(h('div', { class: `sq-m${m.alive ? '' : ' dead'}${m.id === mine.leader ? ' lead' : ''}` }, `${rankOf(m.rank).abbr} ${m.name}`, h('span', {}, (m.role || '').slice(0, 3).toUpperCase())));
        }
        if (mine.npcs) this.$.squad.appendChild(h('div', { class: 'sq-m npc' }, `+ ${mine.npcs} attached soldiers`));
      }
    }
    // bars
    const hp = Math.max(0, me.health);
    this.$.hp.style.width = `${hp}%`;
    this.$.hp.parentElement.classList.toggle('low', hp < 35);
    this.$.hpTxt.textContent = Math.ceil(hp);
    const maxA = me.maxArmor || 50;
    this.$.ar.style.width = `${Math.min(100, (me.armor / maxA) * 100)}%`;
    this.$.ar.parentElement.style.display = maxA > 0 ? '' : 'none';
    this.$.st.style.width = `${(me.stamina / STAMINA.max) * 100}%`;
    this.$.st.parentElement.classList.toggle('full', me.stamina >= STAMINA.max - 1);
    // status icons
    const stance = me.s.stance === STANCE.PRONE ? 'PRONE' : me.s.stance === STANCE.CROUCH ? 'CROUCH' : '';
    this.$.status.textContent = [stance, me.suppression > 0.35 ? 'SUPPRESSED' : '', me.carrying ? 'CARRYING SUPPLIES' : ''].filter(Boolean).join(' · ');
    // weapon
    const ws = me.weapon;
    const w = me.wdef;
    if (me.vehicle) {
      this.$.wname.textContent = 'VEHICLE';
      this.$.mag.textContent = '';
      this.$.res.textContent = '[F] exit · [1-5] seats';
    } else if (ws && w) {
      this.$.wname.textContent = `${w.name}${w.auto ? ` · ${me.fireMode.toUpperCase()}` : w.burst ? ' · BURST' : ''}`;
      if (w.kind === 'gun' || w.kind === 'launcher') {
        this.$.mag.textContent = me.reloadUntil > me.now ? '—' : ws.mag;
        this.$.res.textContent = `/ ${ws.reserve}`;
        this.$.mag.classList.toggle('low', ws.mag <= Math.ceil(w.mag * 0.2));
      } else {
        this.$.mag.textContent = ws.count ?? '';
        this.$.res.textContent = w.kind === 'gadget' ? 'uses' : '';
      }
    }
    const slotKey = me.weapons.map((x) => x.id).join(',') + me.slot;
    if (slotKey !== this.slotKey) {
      this.slotKey = slotKey;
      this.$.slots.innerHTML = me.weapons.map((x, i) => `<span class="${i === me.slot ? 'on' : ''}">${i + 1} ${esc((WEAPONS[x.id] || {}).name || x.id).split(' ')[0]}</span>`).join('');
    }
    // crosshair spread
    const scoped = me.scoped;
    this.$.scope.classList.toggle('on', !!scoped);
    this.$.cross.style.display = scoped || me.vehicle && me.seat === 0 && !(me.veh && me.veh.def.air) ? 'none' : '';
    if (w && !scoped) {
      const sp = computeSpread(w, { ads: me.ads, speed: Math.hypot(me.s.vx, me.s.vz), stance: me.s.stance, grounded: me.s.grounded, bloom: me.bloom, suppression: me.suppression });
      const px = Math.max(3, Math.tan((sp * Math.PI) / 180) * (window.innerHeight / 2) / Math.tan((app.camera.fov * Math.PI) / 360));
      this.$.cross.style.setProperty('--gap', `${px}px`);
      this.$.cross.classList.toggle('ads', me.ads);
    }
    if (now - this.hitT > 180) this.$.hit.className = 'hitmarker';
    // objective line + compass markers
    this.updateObjective();
    this.updateCompass();
    // radio fade
    for (const r of this.radioLines) r.el.style.opacity = Math.max(0.15, 1 - (now - r.t - 9000) / 3000);
    // popups fade
    for (const p of this.popupList) p.el.style.opacity = Math.max(0, 1 - (now - p.t - 1800) / 800);
    // banner
    if (this.bannerT && now > this.bannerT) {
      this.$.banner.classList.remove('on');
      this.bannerT = 0;
    }
    if (this.toastT && now > this.toastT) {
      this.$.toast.classList.remove('on');
      this.toastT = 0;
    }
    // action progress
    const bar = this.$.action;
    if (this.hold) {
      bar.classList.add('on');
      this.$.actionFill.style.width = `${Math.min(100, this.hold.frac * 100)}%`;
      this.$.actionTxt.textContent = this.hold.label;
    } else if (this.action) {
      bar.classList.add('on');
      const f = this.action.dur ? Math.min(1, (now - this.action.start) / (this.action.dur * 1000)) : ((now / 1000) % 1);
      this.$.actionFill.style.width = `${f * 100}%`;
      this.$.actionTxt.textContent = this.action.type.toUpperCase();
    } else bar.classList.remove('on');
    // suppression / low health vignette
    const vig = Math.max(me.suppression * 0.8, me.health < 40 ? (40 - me.health) / 50 : 0);
    this.$.vignette.style.opacity = vig.toFixed(2);
    // downed
    if (me.life === LIFE.DOWNED) {
      const left = Math.max(0, Math.ceil((this.downedUntil - now) / 1000));
      this.$.downed.className = 'downed on';
      this.$.downed.innerHTML = `<div class="dt">YOU ARE DOWN</div><div>Stay low — medics can see you. Bleeding out in <b>${left}s</b></div><div class="dh">${app.input.touchMode ? 'Tap ☰ → Give up' : 'Hold X to give up'}</div>`;
    } else this.$.downed.className = 'downed';
    if (app.settings.showFps) this.$.fps.textContent = `${Math.round(app.renderer.fps)} fps`;
    else this.$.fps.textContent = '';
  }

  updateObjective() {
    const app = this.app;
    const store = app.store;
    const me = app.player;
    const squads = store.get('squads') || [];
    const mine = squads.find((s) => s.id === store.get('mySquad'));
    let text = '';
    let cls = '';
    const order = mine && mine.order && mine.order.until ? mine.order : null;
    const tracked = (store.get('missions') || []).find((m) => m.id === store.get('tracked') && m.status === 'active');
    const dist = (x, z) => Math.round(Math.hypot(x - me.s.x, z - me.s.z));
    if (order) {
      const od = ORDERS[order.type];
      text = `<span class="oi" style="color:${od.color}">${od.icon}</span> <b>ORDER</b> ${esc(od.name)} — ${esc(rankOf(order.byRank).abbr)} ${esc(order.by)} <span class="od">${dist(order.x, order.z)} m</span>`;
      cls = 'order';
    }
    if (tracked) {
      const t = MISSION_TYPES[tracked.type];
      const line = `<span class="oi">${t.icon}</span> ${esc(tracked.title)} ${tracked.prog ? `<span class="op">${esc(tracked.prog)}</span>` : ''} <span class="od">${dist(tracked.x, tracked.z)} m · ${formatTime(tracked.ends)}</span>`;
      text = text ? `${text}<br>${line}` : line;
    }
    const tr = store.get('training');
    if (!text && tr && tr.active) text = '<span class="oi">★</span> Basic training in progress';
    if (!text) text = '<span class="dimmed">No active objective — open Missions (J) or follow your squad</span>';
    if (text !== this.lastObjective) {
      this.lastObjective = text;
      this.$.objective.innerHTML = text;
      this.$.objective.className = `objective ${cls}`;
    }
    const evs = store.get('events') || [];
    const ev = evs[0];
    const et = ev ? `${ev.title} · ${formatTime(ev.ends)}` : '';
    if (et !== this.lastEvent) {
      this.lastEvent = et;
      this.$.eventBanner.textContent = et;
      this.$.eventBanner.classList.toggle('on', !!ev);
    }
  }

  updateCompass() {
    const app = this.app;
    const me = app.player;
    // heading in degrees, 0 = north, clockwise
    let heading = (-me.yaw * 180) / Math.PI;
    heading = ((heading % 360) + 360) % 360;
    const pxPerDeg = 4; // each span = 15 deg = 60px
    this.$.strip.style.transform = `translateX(${-(heading + 360) * pxPerDeg}px)`;
    // markers
    const marks = [];
    const add = (x, z, cls, label) => {
      const dx = x - me.s.x;
      const dz = z - me.s.z;
      let bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
      let rel = bearing - heading;
      rel = ((rel + 540) % 360) - 180;
      if (Math.abs(rel) > 95) return;
      marks.push(`<i class="cm ${cls}" style="left:calc(50% + ${rel * pxPerDeg}px)">${label || ''}</i>`);
    };
    const store = app.store;
    const tracked = (store.get('missions') || []).find((m) => m.id === store.get('tracked') && m.status === 'active');
    if (tracked) add(tracked.x, tracked.z, 'mission', MISSION_TYPES[tracked.type].icon);
    const squads = store.get('squads') || [];
    const mine = squads.find((s) => s.id === store.get('mySquad'));
    if (mine && mine.order) add(mine.order.x, mine.order.z, 'order', ORDERS[mine.order.type].icon);
    const tr = store.get('training');
    if (tr && tr.active && tr.target) add(tr.target[0], tr.target[1], 'mission', '★');
    for (const p of store.get('squadPos') || []) if (p[0] !== me.id) add(p[1], p[2], p[4] === 1 ? 'sl' : 'sq', '');
    this.$.marks.innerHTML = marks.join('');
  }
}
