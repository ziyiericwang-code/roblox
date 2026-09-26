// Application shell: map in the background, title/setup screens, and the in-game HUD.
import { render } from 'preact';
import { store, useStore, toast } from './state/store.js';
import { SoloConnection } from './net/Connection.js';
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
    this.conn = new SoloConnection(world.json);
    this.ctl = new Controller(world, arcs, this.mapHost, this.conn);
    this.dev = typeof __DEV_TOOLS__ !== 'undefined' && __DEV_TOOLS__ ? true : new URLSearchParams(location.search).has('dev') && location.hostname === 'localhost';
    this.conn.on((m) => {
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
      if (store.state.screen === 'setup') {
        if (id >= 0 && id < world.P && this.pickHandler) this.pickHandler(world.provinces.country[id]);
        return;
      }
      if (store.state.screen === 'game') this.ctl.onClick(id, e);
    });
    render(<Root app={this} world={world} />, this.uiHost);
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
    this.conn.send({ t: 'new', settings, player, dev: this.dev });
    store.set({ busy: true });
  }
  load(slot) {
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
