// Glue between the map, the store and the simulation connection: selection, orders,
// drag-to-move, previews, hotkeys, notifications and turn playback.
import { MapView } from '../map/MapView.js';
import { Overlay } from '../map/Overlay.js';
import { buildAtlas } from '../map/Atlas.js';
import { store, toast } from '../state/store.js';
import { previewPath } from '../../shared/path.js';
import { forecast } from '../../shared/forecast.js';

export class Controller {
  constructor(world, arcs, host, conn) {
    this.w = world;
    this.conn = conn;
    this.map = new MapView(host, world, arcs);
    this.r = this.map.r;
    this.overlay = new Overlay(world, this.r, this.map.labels);
    this.r.setAtlas(buildAtlas());
    this.seenNotes = new Set();
    this.lastTurn = -1;
    window.__gc = { world, view: this.map, ctl: this };
    this.bind();
    this.unsub = conn.on((m) => this.onMessage(m));
  }

  setConnection(conn) {
    if (this.unsub) this.unsub();
    this.conn = conn;
    this.seenNotes = new Set();
    this.unsub = conn.on((m) => this.onMessage(m));
  }

  get view() {
    return store.state.view;
  }

  onMessage(m) {
    if (m.t === 'view') {
      const first = !this.view;
      const turnChanged = this.view && m.view.turn !== this.view.turn;
      store.set({ view: m.view, busy: false });
      this.overlay.setView(m.view);
      if (this.strike) this.strike.setFallout(m.view.fallout || []);
      // drop selection of formations that no longer exist
      const sel = store.state.sel;
      if (sel && sel.kind === 'formation' && !m.view.formations.some((f) => f.id === sel.id)) this.select(null);
      this.processInbox(m.view, first);
      if (first || m.started) this.focusHQ(true);
      if (turnChanged) this.afterTurn(m.view, m.ms);
    } else if (m.t === 'error') {
      toast({ kind: 'error', title: 'Error', text: m.message });
      store.set({ busy: false });
    }
  }

  processInbox(view, silent) {
    const notes = view.me.inbox || [];
    for (const n of notes) {
      const key = `${n.turn}|${n.title}|${n.text}`;
      if (this.seenNotes.has(key)) continue;
      this.seenNotes.add(key);
      if (silent || n.turn < view.turn - 1) continue;
      if (n.kind === 'promotion') store.set({ modal: { kind: 'promotion', rank: n.rank, title: n.title, text: n.text } });
      else if (n.kind === 'battle' && !n.important) continue;
      else toast({ kind: n.kind, title: n.title, text: n.text, prov: n.prov, important: n.important, huge: n.huge });
    }
    const all = store.state.notes || [];
    store.set({ notes: notes.slice().reverse().concat(all).filter((x, i, arr) => arr.findIndex((y) => y.title === x.title && y.turn === x.turn) === i).slice(0, 120) });
  }

  afterTurn(view, ms) {
    store.set({ playback: Date.now(), lastTurnMs: ms });
    if (this.strike) {
      // strikes that landed this turn: arcs from the launch site, then the impact
      const strikes = view.strikes.filter((x) => x.turn === view.turn - 1);
      strikes.forEach((x, i) => this.strike.launch(x.site, x.target, { nuke: x.kind === 'nuke', intercept: x.intercepted, delay: 0.3 + i * 0.25, color: x.kind === 'nuke' ? [255, 255, 235] : [255, 150, 60] }));
      const nukes = strikes.filter((x) => x.kind === 'nuke');
      if (nukes.length) {
        const w = this.w;
        store.set({ ebs: { items: nukes.map((x) => ({ intercepted: x.intercepted, place: `${w.provinces.name[x.target]}, ${w.countries[x.victim]?.name || ''}`, by: w.countries[x.from]?.name || '?' })) } });
        if (!nukes.every((x) => x.intercepted)) this.strike.shake(1.2);
      }
      const list = view.battles.slice().sort((a, b) => b.mine - a.mine).slice(0, 80);
      list.forEach((b, i) => this.strike.burst(b.prov, { color: b.mine ? [255, 92, 60] : [255, 196, 90], big: b.mine, delay: 0.15 + i * 0.035 }));
    }
    const mineBattles = view.reports.filter((r) => r.turn === view.turn - 1 && r.players && r.players.includes(view.me.id));
    if (mineBattles.length && !store.state.modal) store.set({ modal: { kind: 'report', id: mineBattles[mineBattles.length - 1].id } });
  }

  // ------------------------------------------------------------ commands
  async command(cmd, { quiet = false } = {}) {
    const res = await this.conn.command(cmd);
    if (!res.ok && !quiet) toast({ kind: 'error', title: 'Order refused', text: res.reason });
    return res;
  }
  endTurn() {
    if (this.conn.online) {
      // multiplayer: toggle ready; the server resolves when everyone is ready or the timer runs out
      const t = store.state.mpTurn;
      if (t && t.phase === 'resolving') return;
      const me = this.view && this.view.me.id;
      if (t && t.ready.includes(me)) this.conn.unready();
      else this.conn.endTurn();
      return;
    }
    if (store.state.busy) return;
    store.set({ busy: true, preview: null });
    this.overlay.setPreview(null);
    this.conn.endTurn();
  }

  selectedFormations() {
    const v = this.view;
    const s = store.state;
    if (!v || !s.sel || s.sel.kind !== 'formation') return [];
    const ids = new Set([s.sel.id, ...s.multi]);
    return v.formations.filter((f) => ids.has(f.id));
  }

  select(sel, multi = []) {
    store.set({ sel, multi, preview: null });
    this.overlay.setSelection(sel, multi);
    this.overlay.setPreview(null);
  }

  async orderTo(target, opts = {}) {
    const forms = this.selectedFormations().filter((f) => f.mine);
    if (!forms.length) return;
    let okAny = false;
    for (const f of forms) {
      const res = await this.command({ type: 'move', f: f.id, to: target, via: opts.via }, { quiet: forms.length > 1 });
      if (res.ok) okAny = true;
      else if (forms.length > 1) toast({ kind: 'error', title: `${f.name}: order refused`, text: res.reason });
    }
    if (okAny) {
      this.overlay.setPreview(null);
      store.set({ preview: null });
    }
  }

  // ------------------------------------------------------------ input
  bind() {
    const m = this.map;
    m.hooks = () => this.overlay.zoomChanged();
    m.on('click', (id, e) => this.onClick(id, e));
    m.on('rightclick', (id, e) => this.onRightClick(id, e));
    m.on('hover', (id, x, y) => this.onHover(id, x, y));
    m.on('hovermove', (id, x, y) => store.set({ hoverPos: [x, y] }));
    m.on('dragstart', (d) => {
      const c = this.overlay.hit(d.x, d.y);
      if (c && c.mine && c.ids.length) {
        this.select({ kind: 'formation', id: c.ids[0] }, c.ids.slice(1));
        return 'move';
      }
      return null;
    });
    m.on('dragmove', (d, x, y, id) => this.previewTo(id));
    m.on('dragend', (d, id) => {
      if (id >= 0 && id < this.w.P) this.orderTo(id);
    });
    m.on('key', (e) => this.onKey(e));
  }

  onClick(id, e) {
    const s = store.state;
    const [x, y] = [e.offsetX, e.offsetY];
    if (s.tool) {
      if (id >= 0 && id < this.w.P) {
        const list = s.toolProvs.includes(id) ? s.toolProvs.filter((q) => q !== id) : [...s.toolProvs, id];
        store.set({ toolProvs: list });
        this.overlay.r.selected = id;
      }
      return;
    }
    const c = this.overlay.hit(x, y);
    if (c && c.ids.length) {
      if (e.shiftKey && s.sel && s.sel.kind === 'formation') {
        const extra = new Set([...s.multi, ...c.ids.filter((q) => q !== s.sel.id)]);
        this.select(s.sel, [...extra]);
      } else {
        // clicking the same stack again cycles through it
        const cur = s.sel && s.sel.kind === 'formation' ? c.ids.indexOf(s.sel.id) : -1;
        const next = cur >= 0 && c.count === 1 && c.ids.length > 1 ? c.ids[(cur + 1) % c.ids.length] : c.ids[0];
        this.select({ kind: 'formation', id: next }, e.ctrlKey || e.metaKey ? c.ids.filter((q) => q !== next) : []);
      }
      return;
    }
    const battle = this.view && this.view.battles.find((b) => b.prov === id);
    if (id < 0) this.select(null);
    else if (battle && e.altKey) this.select({ kind: 'battle', id: battle.id });
    else this.select({ kind: 'province', id });
  }

  onRightClick(id, e) {
    if (store.state.tool) {
      store.set({ tool: null, toolProvs: [] });
      return;
    }
    if (id < 0 || id >= this.w.P) return;
    const s = store.state;
    if (!s.sel || s.sel.kind !== 'formation') return;
    const f = this.view.formations.find((q) => q.id === s.sel.id);
    if (!f || !f.mine) return;
    if (e && e.shiftKey && s.preview && s.preview.target !== undefined) {
      // waypoint: route via the previous target
      this.orderTo(id, { via: [...(s.waypoints || []), s.preview.target] });
      store.set({ waypoints: [] });
      return;
    }
    this.orderTo(id);
  }

  onHover(id) {
    store.set({ hover: id });
    const s = store.state;
    if (s.sel && s.sel.kind === 'formation' && id >= 0 && id < this.w.P) this.previewTo(id);
    else if (s.preview) {
      store.set({ preview: null });
      this.overlay.setPreview(null);
    }
  }

  previewTo(id) {
    const v = this.view;
    const forms = this.selectedFormations().filter((f) => f.mine);
    if (!v || !forms.length || id < 0 || id >= this.w.P) return;
    const f = forms[0];
    if (f.prov === id) {
      store.set({ preview: null });
      this.overlay.setPreview(null);
      return;
    }
    const pp = previewPath(this.w, v, f.prov, id);
    if (!pp) {
      store.set({ preview: { target: id, blocked: true } });
      this.overlay.setPreview(null);
      return;
    }
    let fc = null;
    const hostileTarget = pp.attack && pp.path.length >= 2;
    if (hostileTarget) {
      // forecast the first hostile step (all selected formations adjacent to it join)
      const firstHostile = pp.path.find((q) => this.overlay.enemies.has(v.prov.ctrl[q]));
      const adj = forms.filter((x) => this.w.edgeIndex(x.prov, firstHostile) >= 0);
      if (firstHostile !== undefined && adj.length) fc = forecast(this.w, v, adj, firstHostile);
      else if (firstHostile !== undefined) fc = forecast(this.w, v, forms, firstHostile);
    }
    const speed = Math.min(...forms.map((x) => speedOf(x)));
    const turns = Math.max(1, Math.ceil(pp.km / Math.max(60, speed)));
    const inArea = v.me.area === 'all' || v.me.area.includes(id);
    store.set({ preview: { target: id, path: pp.path, attack: pp.attack, forecast: fc, turns, inArea } });
    this.overlay.setPreview({ path: pp.path, attack: pp.attack });
  }

  onKey(e) {
    const k = e.key.toLowerCase();
    const forms = this.selectedFormations().filter((f) => f.mine);
    const one = forms[0];
    if (e.key === 'Escape') {
      if (store.state.modal) store.set({ modal: null });
      else if (store.state.tool) store.set({ tool: null, toolProvs: [] });
      else if (store.state.panel) store.set({ panel: null });
      else this.select(null);
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !one)) {
      this.endTurn();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      this.cycleFormation(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'Home') {
      this.focusHQ();
      return;
    }
    const modes = ['political', 'terrain', 'supply', 'diplomacy', 'intel', 'fronts', 'economy', 'infrastructure', 'resources', 'empire'];
    if (/^[1-9]$/.test(e.key) && !e.ctrlKey) {
      this.setMode(modes[Number(e.key) - 1]);
      return;
    }
    if (!one) return;
    const act = { h: 'hold', d: 'digin', w: 'withdraw' }[k];
    if (act) for (const f of forms) this.command({ type: act, f: f.id });
    if (k === 's') this.command({ type: 'split', f: one.id });
    if (k === 'm' && forms.length >= 2) this.command({ type: 'merge', a: forms[0].id, b: forms[1].id });
    if (k === 'f') this.focusProv(one.prov);
  }

  cycleFormation(dir) {
    const v = this.view;
    if (!v) return;
    const mine = v.formations.filter((f) => f.mine);
    if (!mine.length) return;
    const s = store.state;
    const idx = s.sel && s.sel.kind === 'formation' ? mine.findIndex((f) => f.id === s.sel.id) : -1;
    // idle formations first
    const order = mine.slice().sort((a, b) => (a.order ? 1 : 0) - (b.order ? 1 : 0));
    const cur = idx >= 0 ? order.findIndex((f) => f.id === s.sel.id) : -1;
    const next = order[(cur + dir + order.length) % order.length];
    this.select({ kind: 'formation', id: next.id });
    this.focusProv(next.prov, Math.max(this.r.camera.zoom, 18));
  }

  setMode(mode) {
    store.set({ mode });
    this.overlay.setMode(mode);
  }

  focusProv(p, zoom) {
    const [x, y] = this.r.regionCenter(p);
    this.r.flyTo(x, y, zoom ?? Math.max(this.r.camera.zoom, 10));
  }
  focusHQ(instant) {
    const v = this.view;
    if (!v) return;
    const p = v.me.hq >= 0 ? v.me.hq : v.countries[v.me.country].capital;
    if (p < 0) return;
    const [x, y] = this.r.regionCenter(p);
    const zoom = v.me.rank >= 44 ? 8 : v.me.rank >= 32 ? 14 : v.me.rank >= 20 ? 20 : 30;
    if (instant) {
      this.r.fly = null;
      Object.assign(this.r.camera, { x, y, zoom });
      this.r.clampCamera();
      this.r.dirty = true;
    } else this.r.flyTo(x, y, zoom);
  }

  destroy() {
    this.unsub();
    this.map.destroy();
  }
}

function speedOf(f) {
  const speeds = { inf: 180, mot: 380, mech: 340, armor: 310, art: 160, ad: 250, sf: 220 };
  let s = Infinity;
  for (const t in f.comp || {}) if (f.comp[t] > 0) s = Math.min(s, speeds[t]);
  return (s === Infinity ? 180 : s) * (0.55 + 0.45 * Math.min(1, f.supply ?? 1)) * (0.6 + 0.4 * (f.org ?? 1));
}
