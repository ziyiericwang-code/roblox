// Contextual command wheel: hold V (or tap the command button), point at a
// location, pick an order. Officers can widen the scope (squad -> theater);
// quick officer abilities sit under the wheel.
import { h, clear } from './dom.js';
import { ORDERS, ORDER_IDS, ABILITIES } from '../../shared/config/commands.js';
import { rankOf, SCOPE_NAMES, SCOPE } from '../../shared/config/ranks.js';
import { MSG } from '../../shared/protocol.js';

const QUICK = ['rally_point', 'ammo_drop', 'mark_target', 'fireteam', 'smoke_screen', 'supply_drop', 'reinforce', 'artillery', 'air_support'];

export class CommandWheel {
  constructor(root, app) {
    this.app = app;
    this.el = h('div', { class: 'cwheel' });
    root.appendChild(this.el);
    this.open = false;
    this.sel = -1;
    this.mx = 0;
    this.my = 0;
    this.scope = SCOPE.SQUAD;
    this.target = null;
  }

  show() {
    const app = this.app;
    const p = app.store.get('profile');
    if (!p) return;
    this.open = true;
    this.mx = 0;
    this.my = 0;
    this.sel = -1;
    this.target = app.crosshairPoint(1500);
    const r = rankOf(p.rank);
    this.scope = Math.min(Math.max(SCOPE.SQUAD, this.scope), Math.max(SCOPE.SQUAD, r.scope));
    this.render();
    this.el.classList.add('on');
    if (app.input.touchMode) app.input.enabled = false;
  }

  hide(issue) {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('on');
    this.app.input.enabled = !this.app.menu.isOpen && !this.app.deploy.visible;
    if (issue && this.sel >= 0) this.issue(ORDER_IDS[this.sel]);
  }

  issue(orderId) {
    const app = this.app;
    const t = this.target;
    const msg = { t: MSG.ORDER, order: orderId, scope: this.scope };
    if (t) {
      msg.x = Math.round(t.x);
      msg.z = Math.round(t.z);
      if (t.ent) msg.target = t.ent;
    } else {
      msg.x = Math.round(app.player.s.x);
      msg.z = Math.round(app.player.s.z);
    }
    app.send(msg);
    app.audio.radio(1);
  }

  render() {
    const app = this.app;
    const el = clear(this.el);
    const p = app.store.get('profile');
    const r = rankOf(p.rank);
    const ring = h('div', { class: 'cw-ring' });
    ORDER_IDS.forEach((id, i) => {
      const o = ORDERS[id];
      const a = (i / ORDER_IDS.length) * Math.PI * 2 - Math.PI / 2;
      const b = h('button', { class: `cw-opt${this.sel === i ? ' on' : ''}`, style: { left: `${50 + Math.cos(a) * 38}%`, top: `${50 + Math.sin(a) * 38}%`, '--c': o.color }, onclick: () => {
        this.sel = i;
        this.hide(true);
      } }, h('span', { class: 'cw-i' }, o.icon), h('span', {}, o.name));
      ring.appendChild(b);
    });
    const tgt = this.target ? `${Math.round(Math.hypot(this.target.x - app.player.s.x, this.target.z - app.player.s.z))} m` : 'your position';
    ring.appendChild(h('div', { class: 'cw-center' }, h('div', { class: 'cw-scope' }, SCOPE_NAMES[this.scope].toUpperCase()), h('div', { class: 'dimmed small' }, `Target: ${tgt}`), r.scope > SCOPE.SQUAD ? h('div', { class: 'dimmed small' }, 'Scroll / tap to change scope') : ''));
    el.appendChild(ring);
    if (r.scope > SCOPE.SQUAD) {
      const sc = h('div', { class: 'cw-scopes' });
      for (let s = SCOPE.SQUAD; s <= r.scope; s++) sc.appendChild(h('button', { class: `btn tiny${s === this.scope ? '' : ' sec'}`, onclick: () => {
        this.scope = s;
        this.render();
      } }, SCOPE_NAMES[s]));
      el.appendChild(sc);
    }
    const cmd = app.store.get('cmd') || {};
    const quick = QUICK.filter((id) => p.rank >= ABILITIES[id].minRank);
    if (quick.length) {
      const row = h('div', { class: 'cw-abilities' });
      for (const id of quick) {
        const ab = ABILITIES[id];
        const cd = (cmd.ready || {})[id];
        row.appendChild(h('button', { class: `btn tiny${cd ? ' sec' : ''}`, disabled: cd ? true : undefined, title: ab.desc, onclick: () => {
          this.hide(false);
          const t = this.target;
          if (ab.needsPos && t) app.send({ t: MSG.ABILITY, id, x: Math.round(t.x), z: Math.round(t.z) });
          else if (!ab.needsPos) app.send({ t: MSG.ABILITY, id });
          else app.hud.toast('Aim at a target location', 'warn');
        } }, `${ab.name}${cd ? ` ${cd}s` : ` · ${ab.cp}CP`}`));
      }
      el.appendChild(row);
    }
    if (p.rank < 4) el.appendChild(h('div', { class: 'cw-note' }, 'You can issue orders from the rank of Corporal. Follow your leaders\' orders to earn bonus XP.'));
  }

  // mouse movement selects a wedge while the wheel is held
  update(dx, dy, wheel) {
    if (!this.open) return;
    this.mx += dx;
    this.my += dy;
    const d = Math.hypot(this.mx, this.my);
    if (d > 30) {
      let a = Math.atan2(this.my, this.mx) + Math.PI / 2;
      if (a < 0) a += Math.PI * 2;
      const i = Math.round((a / (Math.PI * 2)) * ORDER_IDS.length) % ORDER_IDS.length;
      if (i !== this.sel) {
        this.sel = i;
        this.render();
        this.app.audio.uiClick('hover');
      }
      if (d > 140) {
        this.mx *= 140 / d;
        this.my *= 140 / d;
      }
    }
    if (wheel) {
      const r = rankOf(this.app.store.get('profile').rank);
      this.scope = Math.max(SCOPE.SQUAD, Math.min(r.scope, this.scope + (wheel > 0 ? 1 : -1)));
      this.render();
    }
  }
}
