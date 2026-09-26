// Application shell: map in the background, title/setup screens, and the in-game HUD.
import { render } from 'preact';
import { store, useStore, toast } from './state/store.js';
import { SoloConnection } from './net/Connection.js';
import { OnlineConnection, serverUrl } from './net/Online.js';
import { Controller } from './game/Controller.js';
import { TitleScreen, SetupScreen } from './ui/Title.jsx';
import { TopBar, CommandCard, TabRail, MapModes, EndTurn, Toasts, HoverTip, Inspector } from './ui/Hud.jsx';
import { Drawer } from './ui/Panels.jsx';
import { Modals, ToolBar } from './ui/Modals.jsx';
import { MultiplayerScreen, LobbyScreen } from './ui/Multiplayer.jsx';
import { DevPanel } from './ui/Dev.jsx';

class AppCore {
  constructor(root, world, arcs) {
    this.world = world;
    this.arcs = arcs;
    root.innerHTML = '';
    this.mapHost = document.createElement('div');
    this.mapHost.className = 'map-host';
    this.uiHost = document.createElement('div');
    this.uiHost.className = 'ui-host';
    root.append(this.mapHost, this.uiHost);
    this.solo = new SoloConnection(world.json);
    this.conn = this.solo;
    this.online = null;
    this.ctl = new Controller(world, arcs, this.mapHost, this.conn);
    this.dev = typeof __DEV_TOOLS__ !== 'undefined' && __DEV_TOOLS__ ? true : new URLSearchParams(location.search).has('dev') && location.hostname === 'localhost';
    this.solo.on((m) => {
      if (m.t === 'ready' || m.t === 'saves') store.set({ saves: m.saves || [] });
      if (m.t === 'view' && m.started) store.set({ screen: 'game', panel: null, modal: null });
      if (m.t === 'saved') toast({ kind: 'build', title: 'Game saved', text: m.meta.date });
      if (m.t === 'export') download(`global-command-turn${m.data.turn}.json`, JSON.stringify(m.data));
    });
    // idle drift on the title screen
    this.ctl.map.hooks = ((orig) => (dt) => {
      orig(dt);
      const s = store.state.screen;
      if ((s === 'title' || s === 'mp') && !this.ctl.r.fly) {
        this.ctl.r.camera.x += dt * 2.2;
        this.ctl.r.clampCamera();
        this.ctl.r.dirty = true;
      }
    })(this.ctl.map.hooks);
    Object.assign(this.ctl.r.camera, { x: 20, y: 40, zoom: this.ctl.r.minZoom() * 1.25 });
    this.pickHandler = null;
    this.ctl.map.on('click', (id, e) => {
      if (store.state.screen === 'setup' || store.state.screen === 'lobby') {
        if (id >= 0 && id < world.P && this.pickHandler) this.pickHandler(world.provinces.country[id]);
        return;
      }
      if (store.state.screen === 'game') this.ctl.onClick(id, e);
    });
    if (new URLSearchParams(location.search).get('join')) store.set({ screen: 'mp' });
    render(<Root app={this} world={world} />, this.uiHost);
  }

  // ------------------------------------------------------------ multiplayer
  goOnline(name) {
    if (this.online) return this.online.ready;
    const conn = new OnlineConnection(serverUrl(), name);
    this.online = conn;
    conn.on((m) => this.onOnline(m));
    return conn.ready.then((w) => {
      store.set({ online: { id: w.id, name: w.name, dev: w.dev } });
      conn.raw({ t: 'mine' });
      return w;
    }).catch((e) => {
      this.online = null;
      conn.close();
      throw e;
    });
  }
  rename(name) {
    clearTimeout(this.renameT);
    this.renameT = setTimeout(() => {
      if (!this.online) return;
      this.online.name = name;
      const id = JSON.parse(localStorage.getItem('gc.identity') || '{}');
      this.online.raw({ t: 'hello', id: id.id, secret: id.secret, name });
    }, 600);
  }
  onOnline(m) {
    const s = store.state;
    if (m.t === 'welcome') store.set({ online: { id: m.id, name: m.name, dev: m.dev } });
    else if (m.t === 'mine') store.set({ myCampaigns: m.list });
    else if (m.t === 'lobby') {
      store.set({ lobby: m.lobby });
      if (m.lobby.status === 'lobby' && s.screen !== 'lobby') store.set({ screen: 'lobby' });
    } else if (m.t === 'chat') {
      if (s.lobby) store.set({ lobby: { ...s.lobby, chat: [...s.lobby.chat, m.msg].slice(-40) } });
      if (s.screen === 'game' && m.msg.id !== s.online?.id) toast({ kind: 'diplo', title: m.msg.from, text: m.msg.text });
    } else if (m.t === 'turn') store.set({ mpTurn: { ready: [], online: [], ...m, localDeadline: m.left ? Date.now() + m.left : 0 }, busy: m.phase === 'resolving' });
    else if (m.t === 'note') {
      if (s.screen === 'lobby' || (s.screen === 'game' && m.note.kind === 'lobby')) toast({ kind: 'lobby', title: m.note.title, text: m.note.text });
    } else if (m.t === 'view' && (m.started || s.screen === 'lobby')) {
      this.ctl.r.clearModeColors();
      store.set({ screen: 'game', panel: null, modal: null });
    } else if (m.t === 'kicked') {
      toast({ kind: 'error', title: 'Removed', text: m.message });
      this.toMenu();
    } else if (m.t === 'error' && m.code === 'superseded') {
      toast({ kind: 'error', title: 'Disconnected', text: m.message });
      this.toMenu();
    } else if (m.t === 'disconnected' && s.screen === 'game') store.set({ offline: true });
    if (m.t === 'welcome' && s.offline) store.set({ offline: false });
  }
  useOnline() {
    if (this.conn === this.online) return;
    this.conn = this.online;
    this.ctl.setConnection(this.online);
    store.set({ view: null, sel: null, notes: [] });
  }
  async createCampaign(cfg) {
    await this.goOnline(cfg.commander);
    this.useOnline();
    const r = await this.online.request({ t: 'create', settings: cfg });
    if (r.ok) store.set({ screen: 'lobby' });
    return r;
  }
  async joinCampaign(code, password) {
    this.useOnline();
    const r = await this.online.request({ t: 'join', code, password });
    if (r.ok && history.replaceState) history.replaceState(null, '', location.pathname);
    return r;
  }
  async rejoinCampaign(id) {
    this.useOnline();
    return this.online.request({ t: 'rejoin', campaign: id });
  }
  async leaveCampaign() {
    if (this.online) await this.online.request({ t: 'leave' });
    this.online && (this.online.campaign = null);
    this.toMenu();
  }
  toMenu() {
    store.set({ screen: 'mp', lobby: null, view: null, sel: null, mpTurn: null, modal: null, panel: null });
    this.ctl.r.clearModeColors();
    if (this.online) this.online.raw({ t: 'mine' });
  }
  leaveOnline() {
    if (this.online) {
      this.online.close();
      this.online = null;
    }
    if (this.conn !== this.solo) {
      this.conn = this.solo;
      this.ctl.setConnection(this.solo);
    }
    store.set({ screen: 'title', online: null, lobby: null, view: null, mpTurn: null });
  }

  pickMode(fn) {
    this.pickHandler = fn;
    if (fn) this.ctl.setMode('political');
  }
  highlightCountry(c) {
    const r = this.ctl.r;
    r.clearModeColors();
    for (const p of this.world.provincesOf[c]) r.setModeColor(p, 255, 230, 160, 90);
    const cap = this.world.countries[c].capital;
    if (cap >= 0) {
      const [x, y] = r.regionCenter(cap);
      r.flyTo(x, y, Math.max(r.minZoom() * 1.3, Math.min(9, 520 / Math.sqrt(this.world.countries[c].areaKm2 / 1000 + 50))));
    }
  }
  start(settings, player) {
    this.ctl.r.clearModeColors();
    if (this.conn !== this.solo) {
      this.conn = this.solo;
      this.ctl.setConnection(this.solo);
    }
    this.conn.send({ t: 'new', settings, player, dev: this.dev });
    store.set({ busy: true });
  }
  load(slot) {
    if (this.conn !== this.solo) {
      this.conn = this.solo;
      this.ctl.setConnection(this.solo);
    }
    this.conn.send({ t: 'load', slot, dev: this.dev });
  }
  save() {
    this.conn.send({ t: 'save', slot: `save-${Date.now()}` });
    setTimeout(() => this.conn.send({ t: 'saves' }), 500);
  }
  deleteSave(slot) {
    this.conn.send({ t: 'delete', slot });
  }
  exportSave() {
    this.conn.send({ t: 'export' });
  }
  async importSave(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      this.conn.send({ t: 'import', data });
      store.set({ modal: null });
    } catch (e) {
      toast({ kind: 'error', title: 'Import failed', text: e.message });
    }
  }
  quit() {
    if (this.conn === this.online) return this.leaveCampaign();
    store.set({ screen: 'title', modal: null, panel: null, view: null, sel: null });
    this.conn.send({ t: 'saves' });
  }
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function Root({ app, world }) {
  const screen = useStore((s) => s.screen);
  const panel = useStore((s) => s.panel);
  const ctl = app.ctl;
  if (screen === 'title') return (
    <>
      <TitleScreen app={app} />
      <Modals world={world} ctl={ctl} app={app} />
    </>
  );
  if (screen === 'setup') return <SetupScreen app={app} world={world} />;
  if (screen === 'mp') return <MultiplayerScreen app={app} world={world} />;
  if (screen === 'lobby') return <LobbyScreen app={app} world={world} />;
  return (
    <div class="hud">
      <TopBar world={world} ctl={ctl} />
      <CommandCard world={world} ctl={ctl} />
      <TabRail />
      {panel === 'dev' ? <DevPanel world={world} ctl={ctl} /> : <Drawer world={world} ctl={ctl} app={app} />}
      <Inspector world={world} ctl={ctl} />
      <MapModes ctl={ctl} />
      <EndTurn ctl={ctl} />
      <ToolBar ctl={ctl} world={world} />
      <HoverTip world={world} />
      <Toasts ctl={ctl} />
      <Modals world={world} ctl={ctl} app={app} />
    </div>
  );
}

export function startApp(root, world, arcs) {
  const app = new AppCore(root, world, arcs);
  window.__gcApp = app;
  return app;
}
