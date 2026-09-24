// Client application: boots the world, connects (solo or multiplayer),
// routes network messages, runs the frame loop and ties rendering, audio,
// input and UI together.
import * as THREE from 'three';
import { WORLD_SEED, ENTITY, LIFE, FACTION, STANCE, SEA_LEVEL, FACTION_INFO, setWars, areHostile } from '../shared/constants.js';
import { generateWorld } from '../shared/world/layout.js';
import { MSG } from '../shared/protocol.js';
import { WEAPONS } from '../shared/config/weapons.js';
import { WEAPON_CODES, raySoldier, rayVehicle, VEHICLE_CODES } from '../shared/combat.js';
import { VEHICLES } from '../shared/config/vehicles.js';
import { rankOf, addressOf, promotionOptions } from '../shared/config/ranks.js';
import { AccessIndex } from '../shared/world/access.js';
import { dirFromYawPitch, rayPointDist } from '../shared/math.js';
import { Renderer } from './render/Renderer.js';
import { WorldScene } from './render/WorldScene.js';
import { SoldierRenderer } from './render/SoldierRenderer.js';
import { VehicleRenderer } from './render/VehicleRenderer.js';
import { PropRenderer } from './render/PropRenderer.js';
import { Effects } from './render/Effects.js';
import { AudioEngine } from './audio/Audio.js';
import { Input, TouchControls } from './input/Input.js';
import { Store } from './state/Store.js';
import { ClientWorld } from './net/ClientWorld.js';
import { WSTransport } from './net/Transport.js';
import { startSolo } from './net/SoloServer.js';
import { LocalPlayer } from './game/LocalPlayer.js';
import { HUD } from './ui/HUD.js';
import { WorldMarkers } from './ui/WorldMarkers.js';
import { Menu } from './ui/Menu.js';
import { DeployScreen } from './ui/Deploy.js';
import { CommandWheel } from './ui/CommandWheel.js';
import { TitleScreen } from './ui/Title.js';
import { MapView } from './ui/MapView.js';
import { CountrySelect } from './ui/CountrySelect.js';
import { Dialog } from './ui/Dialog.js';
import { Sandbox } from './ui/Sandbox.js';
import { h } from './ui/dom.js';

const SETTINGS_KEY = 'frontline.settings';
const ID_KEY = 'frontline.identity';

function loadSettings() {
  const def = { name: '', quality: '', sensitivity: 1, invertY: false, firstPerson: false, showFps: false, touch: null, master: 0.8, sfx: 0.9, ambient: 0.6, music: 0.45, ui: 0.7 };
  try {
    return { ...def, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) };
  } catch {
    return def;
  }
}

function identity() {
  try {
    let v = JSON.parse(localStorage.getItem(ID_KEY));
    if (!v || !v.id || !v.token) {
      const r = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => (b % 36).toString(36)).join('');
      v = { id: `p_${r(20)}`, token: r(40) };
      localStorage.setItem(ID_KEY, JSON.stringify(v));
    }
    return v;
  } catch {
    return { id: `p_${Math.random().toString(36).slice(2, 14)}xx`, token: `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}` };
  }
}

const SOUND_OF = (code) => {
  const w = WEAPONS[WEAPON_CODES[code]];
  return w ? w.sound || 'rifle' : 'rifle';
};

export class App {
  constructor() {
    this.root = document.getElementById('app');
    this.settings = loadSettings();
    this.store = new Store();
    this.cw = new ClientWorld();
    this.audio = new AudioEngine();
    this.time = 0;
    this.last = 0;
    this.deathAt = 0;
    this.started = false;
  }

  get now() {
    return performance.now() / 1000;
  }

  async boot() {
    let multiplayer = false;
    if (location.protocol.startsWith('http')) {
      try {
        const r = await fetch('/api/info', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          multiplayer = !!j.multiplayer;
        }
      } catch {
        /* static hosting: solo only */
      }
    }
    const touch = this.settings.touch ?? (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
    this.title = new TitleScreen(this.root, { settings: this.settings, multiplayer, touch, onStart: (o) => this.start(o) });
  }

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* private mode */
    }
  }

  applySettings(qualityChanged) {
    const s = this.settings;
    this.saveSettings();
    if (this.input) {
      this.input.sensitivity = s.sensitivity;
      this.input.invertY = s.invertY;
    }
    this.audio.setVolumes({ master: s.master, sfx: s.sfx, ambient: s.ambient, music: s.music, ui: s.ui });
    if (this.player) this.player.firstPerson = s.firstPerson;
    if (this.touch) this.touch.show(!!s.touch);
    if (qualityChanged && this.renderer) {
      this.renderer.setQuality(s.quality);
      this.hud.toast('Some graphics changes apply fully after a reload.');
    }
    if (this.transport && this.store.get('profile')) this.send({ t: MSG.SETTINGS, settings: { sensitivity: s.sensitivity, invertY: s.invertY, firstPerson: s.firstPerson } });
  }

  loading(text) {
    if (!this.loadEl) {
      this.loadEl = h('div', { class: 'loading' }, h('div', { class: 'ld-spin' }), h('div', { class: 'ld-text' }));
      this.root.appendChild(this.loadEl);
    }
    this.loadEl.querySelector('.ld-text').textContent = text;
    return new Promise((r) => setTimeout(r, 30));
  }

  async start({ mode, name, quality }) {
    this.audio.init();
    this.settings.name = name;
    this.settings.quality = quality;
    if (this.settings.touch === null || this.settings.touch === undefined) this.settings.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.saveSettings();
    this.mode = mode;
    try {
      await this.loading('Surveying the theatre of war…');
      this.world = generateWorld(WORLD_SEED, { nav: mode !== 'mp' });
      await this.loading('Building terrain, towns and fortifications…');
      this.initScene(quality);
      await this.loading('Briefing the troops…');
      this.initUI();
      await this.loading(mode !== 'mp' ? 'Starting the war…' : 'Connecting to the front…');
      if (mode === 'solo' || mode === 'sandbox') {
        const { transport, game } = await startSolo(this.world, { sandbox: mode === 'sandbox' });
        this.transport = transport;
        this.soloGame = game;
      } else {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.transport = new WSTransport(`${proto}//${location.host}/ws`);
        await this.transport.ready();
      }
      this.transport.onMessage((m) => this.onMessage(m));
      this.transport.onClose(() => this.onDisconnected());
      const idv = identity();
      this.send({ t: MSG.HELLO, id: idv.id, token: idv.token, name });
      this.pingTimer = setInterval(() => this.send({ t: MSG.PING, c: performance.now() }), 2000);
    } catch (e) {
      console.error(e);
      this.fatal(`Could not start: ${e.message || e}`);
      return;
    }
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  fatal(text) {
    const box = h('div', { class: 'fatal' }, h('div', {}, text), h('button', { class: 'btn', onclick: () => location.reload() }, 'Reload'));
    this.root.appendChild(box);
    if (this.loadEl) this.loadEl.remove();
  }

  initScene(quality) {
    const canvas = h('canvas', { class: 'view' });
    this.root.prepend(canvas);
    this.canvas = canvas;
    this.renderer = new Renderer(canvas, quality);
    const q = this.renderer.q;
    const scene = this.renderer.scene;
    this.camera = this.renderer.camera;
    this.worldScene = new WorldScene(this.world, this.renderer);
    this.structures = this.worldScene.structures;
    this.access = new AccessIndex(this.world.zones);
    this.effects = new Effects(scene, q, (x, z) => this.world.terrain.heightAt(x, z));
    this.soldiers = new SoldierRenderer(scene, q);
    this.vehicles = new VehicleRenderer(scene);
    this.props = new PropRenderer(scene);
    this.mapView = new MapView(this.world);
    this.mapView.buildBase();
    const mid = this.world.tById.midvale;
    this.camera.position.set(mid.x + 300, mid.y + 260, mid.z + 400);
    this.camera.lookAt(mid.x, mid.y, mid.z);
  }

  initUI() {
    this.input = new Input(this.canvas);
    this.input.sensitivity = this.settings.sensitivity;
    this.input.invertY = this.settings.invertY;
    const ui = h('div', { class: 'ui' });
    this.root.appendChild(ui);
    this.ui = ui;
    this.markers = new WorldMarkers(ui, this);
    this.hud = new HUD(ui, this);
    this.deploy = new DeployScreen(ui, this);
    this.menu = new Menu(ui, this);
    this.wheel = new CommandWheel(ui, this);
    this.dialog = new Dialog(ui, this);
    this.sandbox = new Sandbox(ui, this);
    if (this.settings.touch) {
      this.touch = new TouchControls(ui);
      this.input.touch = this.touch;
      this.input.touchMode = true;
      document.body.classList.add('touch-mode');
    }
    this.player = new LocalPlayer(this);
    this.player.firstPerson = this.settings.firstPerson;
    this.audio.setVolumes(this.settings);
    this.hud.show(false);
    // deploy button click is a user gesture: grab the pointer for FPS controls
    this.deploy.$.go.addEventListener('click', () => this.input.requestLock());
    this.input.onLockChange = (locked) => {
      document.body.classList.toggle('mouse-locked', locked);
      if (!locked && this.player.alive && !this.menu.isOpen && !this.deploy.visible && !this.input.touchMode && this.started) this.showPausedHint(true);
      else this.showPausedHint(false);
    };
  }

  showPausedHint(v) {
    if (!this.pauseEl) {
      this.pauseEl = h('div', { class: 'paused' }, h('div', {}, 'Click to resume'), h('small', {}, 'Tab / Esc for menus'));
      this.pauseEl.addEventListener('click', () => {
        this.input.requestLock();
        this.showPausedHint(false);
      });
      this.ui.appendChild(this.pauseEl);
    }
    this.pauseEl.classList.toggle('on', v);
  }

  send(msg) {
    if (this.transport) this.transport.send(msg);
  }

  onDisconnected() {
    if (this.kicked) return;
    this.fatal('Disconnected from the server.');
  }

  skipTraining() {
    this.send({ t: MSG.TRAINING, a: 'skip' });
  }

  // ------------------------------------------------------------------ messages
  onMessage(msg) {
    if (msg instanceof ArrayBuffer) {
      this.cw.applySnapshot(msg);
      return;
    }
    const s = this.store;
    switch (msg.t) {
      case MSG.WELCOME:
        s.patch({ id: msg.id, faction: msg.faction, profile: msg.profile, solo: msg.solo, admin: !!msg.admin });
        if (this.title) this.title.hide();
        if (this.loadEl) {
          this.loadEl.remove();
          this.loadEl = null;
        }
        this.sandbox.setAdmin(!!msg.admin);
        if (!msg.faction) {
          // first time: choose a country to serve
          this.countrySelect = new CountrySelect(this.ui, this, (country) => this.send({ t: MSG.ENLIST, country }));
          break;
        }
        if (this.countrySelect) {
          this.countrySelect.close();
          this.countrySelect = null;
        }
        this.started = true;
        this.props.myFaction = msg.faction;
        this.deploy.show(true);
        this.radioWelcome(msg.profile);
        break;
      case MSG.REJECT:
      case MSG.KICK:
        this.kicked = true;
        this.fatal(msg.reason || 'Disconnected');
        break;
      case MSG.PROFILE:
        s.set('profile', msg.profile);
        break;
      case MSG.WAR:
        setWars(msg.war.wars.map(([a, b]) => [a, b]));
        s.set('war', msg.war);
        s.set('battles', msg.war.battles || []);
        break;
      case MSG.BUILDINGS:
        this.structures.setBuildingStates(msg.list, !!msg.full);
        break;
      case MSG.DIALOG:
        this.dialog.show(msg);
        break;
      case MSG.PERF:
        this.sandbox.perf(msg);
        break;
      case MSG.ADMINSTATE:
        this.sandbox.setState(msg);
        break;
      case MSG.MISSIONS:
        s.patch({ missions: msg.missions, operations: msg.operations || [], events: msg.events || [], tracked: msg.tracked });
        break;
      case MSG.SQUADS:
        s.patch({ squads: msg.squads, mySquad: msg.mine, invites: msg.invites || [] });
        break;
      case MSG.WORLDSTATE:
        s.set('world', msg);
        break;
      case MSG.DEPLOYINFO:
        this.deploy.setInfoTime();
        this.deploy.setInfo(msg);
        s.set('deploy', msg);
        break;
      case MSG.SPAWNED:
        this.player.onSpawned(msg);
        this.deploy.show(false);
        this.menu.close();
        this.hud.show(true);
        this.input.enabled = true;
        this.deathAt = 0;
        if (this.touch) this.touch.show(true);
        break;
      case MSG.LOADOUT:
        this.player.onLoadout(msg);
        break;
      case MSG.CORRECT:
        this.player.onCorrect(msg);
        break;
      case MSG.NOTICE:
        if (msg.kind === 'vehicle') this.player.onVehicleNotice(msg);
        else if (msg.kind === 'invite') {
          this.hud.toast(`${msg.from} invited you to Squad ${msg.name} — open Squad (P) to accept`);
          this.audio.radio(1);
        }
        break;
      case MSG.TRAININGSTATE:
        s.set('training', msg);
        this.hud.setTraining(msg);
        if (msg.done && !msg.skipped) {
          this.audio.fanfare('promotion');
        }
        break;
      case MSG.CMDSTATE:
        s.set('cmd', msg);
        break;
      case MSG.SQUADPOS:
        s.set('squadPos', msg.p);
        break;
      case MSG.INFO:
        this.cw.onInfo(msg.list);
        break;
      case MSG.GONE:
        this.cw.onGone(msg.ids);
        break;
      case MSG.PONG:
        this.rtt = (performance.now() - msg.c) / 1000;
        break;
      case MSG.EVENTS:
        this.processEvents(msg.e);
        break;
      default:
        break;
    }
  }

  radioWelcome(p) {
    const f = this.store.get('faction');
    const base = this.world.bases[f];
    if (!p.trainingComplete) this.hud.radio('command', base ? base.name : 'HQ', `Welcome to the ${FACTION_INFO[f].army}, Recruit ${p.name}. Report to the training grounds.`, 1);
    else this.hud.radio('command', 'HQ', `Welcome back, ${addressOf(p.rank)} ${p.name}. The front is waiting.`, 1);
  }

  processEvents(list) {
    const me = this.player;
    const hud = this.hud;
    const fx = this.effects;
    const au = this.audio;
    const cam = this.camera.position;
    for (const ev of list) {
      switch (ev[0]) {
        case 'shot': {
          const [, shooter, wcode, ox, oy, oz, hx, hy, hz, kind, mat] = ev;
          if (shooter === me.id && !me.vehicle && kind !== 9) break;
          const o = { x: ox, y: oy, z: oz };
          const hp = { x: hx, y: hy, z: hz };
          const len = Math.hypot(hx - ox, hy - oy, hz - oz) || 1;
          const d = { x: (hx - ox) / len, y: (hy - oy) / len, z: (hz - oz) / len };
          if (kind === 9) {
            au.gunshot('rocket', o);
            fx.muzzle(o, d, true);
            break;
          }
          const w = WEAPONS[WEAPON_CODES[wcode]];
          au.gunshot(kind === 8 ? w?.sound || 'cannon' : SOUND_OF(wcode), o);
          fx.muzzle(o, d, kind === 8);
          if (kind === 8) break;
          if (!w || Math.random() < 1 / (w.tracerEvery || 3) || w.cls === 'vehicle') fx.tracer(o, hp, shooter && this.isHostileEnt(shooter) ? 0xffb080 : 0xffd27a);
          if (kind) {
            fx.impact(hp, kind, mat);
            au.impact(hp, kind);
          }
          // near miss
          if (shooter !== me.id && this.isHostileEnt(shooter)) {
            const r = rayPointDist(o, d, len, cam);
            if (r.dist < 3.5 && r.t > 5) au.whiz(cam);
          }
          const se = this.cw.ents.get(shooter);
          if (se) this.soldiers.kick(shooter);
          break;
        }
        case 'boom': {
          const [, x, y, z, size, big] = ev;
          if (size <= 3) fx.smallBoom(x, y, z);
          else fx.explosion(x, y, z, size, big === 2);
          au.explosion({ x, y, z }, size > 3 ? (big === 2 ? 1.6 : 1) : 0.5);
          const d = Math.hypot(x - cam.x, z - cam.z);
          fx.shake = Math.max(fx.shake, Math.min(1, (size * 4) / Math.max(8, d)));
          break;
        }
        case 'hit':
          hud.hitmarker(ev[4], ev[3]);
          au.uiClick(ev[4] ? 'kill' : 'hit');
          if (!ev[5]) this.soldiers.flinch(ev[1]);
          break;
        case 'dmg':
          hud.damage(ev[1], ev[2], ev[3]);
          me.shake = Math.min(1, me.shake + ev[1] / 60);
          au.impact(cam, 3);
          break;
        case 'sup':
          me.suppression = Math.max(me.suppression, ev[1] / 100);
          break;
        case 'kill':
          hud.killNote(`${ev[3] ? 'HEADSHOT · ' : ''}${ev[1]} neutralised`);
          break;
        case 'xp':
          hud.xp(ev[1], ev[2]);
          break;
        case 'lp':
          hud.xp(ev[1], `Leadership · ${ev[2]}`);
          break;
        case 'radio':
          hud.radio(ev[1], ev[2], ev[3], ev[4]);
          au.radio(ev[4]);
          break;
        case 'notice':
          hud.toast(ev[2], ev[1]);
          if (ev[1] === 'warn') au.uiClick('deny');
          break;
        case 'promo':
          hud.promotion(ev[1], ev[3], ev[4]);
          au.fanfare('promotion');
          break;
        case 'promoReady':
          hud.promotionReady(ev[1], ev[2]);
          au.uiClick('ding');
          break;
        case 'restricted':
          hud.restricted(ev[1], ev[2]);
          au.uiClick('deny');
          break;
        case 'war': {
          const a = FACTION_INFO[ev[2]];
          const b = FACTION_INFO[ev[3]];
          const mine = this.store.get('faction');
          const involved = ev[2] === mine || ev[3] === mine;
          hud.banner(ev[1] === 'declared' ? 'WAR DECLARED' : 'CEASEFIRE', `${a.name} ${ev[1] === 'declared' ? 'vs' : 'and'} ${b.name}`, ev[1] === 'declared' && involved ? 'bad' : 'promo');
          if (ev[1] === 'declared' && involved) au.playMusic('battle');
          break;
        }
        case 'battle': {
          const t = this.world.tById[ev[2]];
          const mine = this.store.get('faction');
          if (t && (ev[3] === mine || ev[4] === mine)) hud.toast(`${ev[3] === mine ? 'ASSAULT' : 'UNDER ATTACK'}: ${t.name}`, ev[3] === mine ? 'order' : 'warn');
          break;
        }
        case 'assignment':
          hud.banner('NEW ASSIGNMENT', ev[2], 'promo');
          break;
        case 'drone':
          fx.drone && fx.drone(ev[1], ev[2], ev[3]);
          break;
        case 'rallycry':
          au.fanfare('medal');
          break;
        case 'medal':
          hud.medal(ev[1], ev[2]);
          au.fanfare('medal');
          break;
        case 'callout': {
          const e = this.cw.ents.get(ev[1]);
          if (e && e.latest) this.floatText(e.latest, ev[2]);
          break;
        }
        case 'smoke':
          fx.smokeScreen(ev[1], ev[2], ev[3], ev[4], ev[5]);
          au.explosion({ x: ev[1], y: ev[2], z: ev[3] }, 0.2);
          break;
        case 'sparks':
          fx.sparks(ev[1], ev[2], ev[3]);
          break;
        case 'cap': {
          const t = this.world.tById[ev[1]];
          const sd = t && t.sectors.find((q) => q.id === ev[2]);
          if (sd && Math.hypot(sd.x - me.s.x, sd.z - me.s.z) < 120) {
            hud.banner(ev[3] === this.store.get('faction') ? `${sd.name.toUpperCase()} SECURED` : `${sd.name.toUpperCase()} LOST`, t.name, ev[3] === this.store.get('faction') ? 'good' : 'bad');
          }
          break;
        }
        case 'territory': {
          const t = this.world.tById[ev[1]];
          const mine = this.store.get('faction');
          const ours = ev[2] === mine;
          if (!ours && ev[3] !== mine) {
            hud.toast(`${t.name} fell to ${FACTION_INFO[ev[2]].short}`);
            break;
          }
          hud.banner(ours ? `${t.name.toUpperCase()} ${t.faction === mine ? 'LIBERATED' : 'CAPTURED'}` : `${t.name.toUpperCase()} HAS FALLEN`, ours ? 'The front line moves forward.' : 'Regroup and counterattack.', ours ? 'good' : 'bad');
          break;
        }
        case 'mission':
          au.uiClick(ev[2] ? 'ding' : 'deny');
          break;
        case 'order':
          hud.toast(`ORDER from ${rankOf(ev[5]).abbr} ${ev[4]}: ${ev[1].toUpperCase()}`, 'order');
          break;
        case 'orderAck':
          hud.toast(`Order sent to ${ev[2]} unit${ev[2] === 1 ? '' : 's'} (${ev[3]})`);
          break;
        case 'orderDone':
          hud.toast(`Squad ${ev[1]} is in position`);
          break;
        case 'downed':
          hud.downedUntil = performance.now() + ev[1] * 1000;
          au.uiClick('deny');
          break;
        case 'died':
          this.deathAt = this.now;
          this.player.alive = false;
          this.deploy.deathText = ev[1] ? `Killed by ${ev[1]}` : 'You were killed in action';
          break;
        case 'revived':
          hud.toast(ev[1] ? `Revived by ${ev[1]}` : 'Revived', 'good');
          break;
        case 'reviving':
          hud.toast(`${ev[2]} is reviving you…`, 'good');
          break;
        case 'action':
          hud.setAction(ev[1], ev[2]);
          break;
        case 'actionEnd':
          hud.setAction(null);
          break;
        case 'spotted':
          hud.toast(`Spotted ${ev[1]} enem${ev[1] === 1 ? 'y' : 'ies'}`);
          break;
        case 'mark':
          hud.toast('Enemy positions marked');
          break;
        case 'incoming':
          au.incoming({ x: ev[1], y: this.world.terrain.heightAt(ev[1], ev[2]), z: ev[2] });
          if (Math.hypot(ev[1] - me.s.x, ev[2] - me.s.z) < ev[3] + 40) hud.banner('INCOMING ARTILLERY', 'Take cover!', 'bad');
          break;
        case 'siren':
          au.siren({ x: ev[1], y: 20, z: ev[2] }, ev[3]);
          break;
        case 'thunder':
          au.thunder({ x: ev[1], y: 300, z: ev[2] });
          this.renderer.env.flash = 1;
          break;
        case 'music':
          au.playMusic(ev[1]);
          break;
        case 'campaign':
          hud.banner(ev[1] === this.store.get('faction') ? `CAMPAIGN ${ev[2]} WON` : `CAMPAIGN ${ev[2]} LOST`, `A new campaign begins in ${ev[3]} seconds.`, ev[1] === this.store.get('faction') ? 'promo' : 'bad');
          au.playMusic(ev[1] === this.store.get('faction') ? 'victory' : 'defeat');
          break;
        case 'sfx':
          au.uiClick(ev[1] === 'ding' ? 'ding' : 'xp');
          break;
        default:
          break;
      }
    }
  }

  isHostileEnt(id) {
    const e = this.cw.ents.get(id);
    return !!(e && e.latest && areHostile(e.latest.faction, this.store.get('faction')));
  }

  floatText(pos, text) {
    if (!this.floats) this.floats = [];
    if (Math.hypot(pos.x - this.player.s.x, pos.z - this.player.s.z) > 60) return;
    this.floats.push({ x: pos.x, y: pos.y + 2.4, z: pos.z, text, t: this.now });
  }

  // ------------------------------------------------------------------ queries
  raycastScene(o, d, maxT, opts = {}) {
    const col = this.world.colliders;
    const wh = col.raycast(o.x, o.y, o.z, d.x, d.y, d.z, maxT, { penetrate: true });
    let best = wh ? wh.t : maxT;
    let kind = wh ? (wh.terrain ? 1 : 2) : 0;
    let mat = wh ? (wh.terrain ? 0 : wh.mat) : 0;
    let ent = 0;
    for (const e of this.cw.ents.values()) {
      if (e.id === opts.ignore) continue;
      const st = e.latest;
      if (!st) continue;
      if (e.k === ENTITY.SOLDIER) {
        if (st.life === LIFE.DEAD || st.vehicle) continue;
        const s = this.cw.sample(e);
        const r = raySoldier(o, d, best, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, stance: s.stance, lean: s.lean, downed: s.life === LIFE.DOWNED });
        if (r && r.t < best) {
          best = r.t;
          kind = 3;
          ent = e.id;
        }
      } else if (e.k === ENTITY.VEHICLE) {
        if (e.id === this.player.vehicle) continue;
        const s = this.cw.sample(e);
        const def = VEHICLES[VEHICLE_CODES[s.type]];
        if (!def) continue;
        const t = rayVehicle(o, d, best, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, def });
        if (t >= 0 && t < best) {
          best = t;
          kind = 4;
          ent = e.id;
        }
      }
    }
    if (!kind) return null;
    const point = { x: o.x + d.x * best, y: o.y + d.y * best, z: o.z + d.z * best };
    if (kind === 1 && point.y < SEA_LEVEL + 0.1) kind = 5;
    return { t: best, point, kind, mat, ent };
  }

  crosshairPoint(maxT = 800) {
    const cd = new THREE.Vector3();
    this.camera.getWorldDirection(cd);
    const hit = this.raycastScene(this.camera.position, cd, maxT, { ignore: this.player.id });
    if (!hit) return null;
    return { x: hit.point.x, y: hit.point.y, z: hit.point.z, ent: hit.kind === 4 ? hit.ent : 0 };
  }

  // ------------------------------------------------------------------ frame
  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    // real frame time (for fps tracking) and the simulation step: gameplay stays
    // real-time down to 10 fps (physics is sub-stepped), below that it slows down
    this.realDt = Math.min(1, Math.max(0.001, (t - this.last) / 1000));
    const dt = Math.min(0.1, this.realDt);
    this.last = t;
    this.time += dt;
    const input = this.input;
    input.pollGamepad();
    this.handleGlobalKeys();
    const me = this.player;
    // own snapshot sync
    const mine = me.id ? this.cw.ents.get(me.id) : null;
    if (mine && mine.latest) {
      me.syncFromSnapshot(mine.latest);
      if (mine.latest.life === LIFE.DEAD && me.alive) {
        me.alive = false;
        this.deathAt = this.now;
      }
    }
    // command wheel consumes mouse movement while open
    if (this.wheel.open) {
      this.wheel.update(input.lookDX, input.lookDY, input.wheel);
      input.lookDX = 0;
      input.lookDY = 0;
      input.wheel = 0;
    }
    this.dialog.update();
    if (me.alive && this.started) me.update(dt, input);
    else input.look();
    // death -> deploy screen after a short pause
    if (this.started && !me.alive && !this.deploy.visible && (!this.deathAt || this.now - this.deathAt > 3.5)) {
      this.deploy.show(true);
      this.hud.show(false);
    }
    // camera
    if (me.alive) me.updateCamera(this.camera, dt);
    else this.spectatorCamera(dt);
    this.renderScene(dt);
    // UI
    this.hud.update(dt);
    this.markers.draw();
    this.drawFloats();
    this.menu.update(dt);
    this.deploy.update(dt);
    // touch controls only while actually playing (not under the deploy screen or menus)
    if (this.touch) this.touch.show(!!this.player.alive && !this.menu.isOpen && !this.deploy.visible);
    input.endFrame();
  }

  handleGlobalKeys() {
    const input = this.input;
    if (!this.started) return;
    if (input.pressed('escape')) {
      if (this.wheel.open) this.wheel.hide(false);
      else if (this.menu.isOpen) this.menu.close();
      else if (!this.deploy.visible) this.menu.open('settings');
    }
    if (input.pressed('menu')) this.menu.toggle(this.menu.isOpen ? undefined : this.menu.tab === 'map' ? 'career' : this.menu.tab);
    if (input.pressed('map')) this.menu.toggle('map');
    if (!this.menu.isOpen) {
      if (input.pressed('missions')) this.menu.open('missions');
      if (input.pressed('squad')) this.menu.open('squad');
    }
    if (input.pressed('promote')) this.requestPromotion();
    if (input.pressed('sandbox') && this.store.get('admin')) this.sandbox.toggle();
    if (this.player.alive && !this.menu.isOpen) {
      if (input.pressed('command')) this.wheel.show();
      if (this.wheel.open && input.released('command') && !input.touchMode) this.wheel.hide(true);
    }
  }

  // Accept the first available promotion (the server checks the venue).
  requestPromotion(to) {
    const p = this.store.get('profile');
    if (!p) return;
    const ready = promotionOptions(p).filter((o) => o.met);
    const pick = to !== undefined ? ready.find((o) => o.to === to) : ready[0];
    if (!pick) {
      this.hud.toast('No promotion available yet — see the Career tab (Tab).');
      return;
    }
    this.send({ t: MSG.PROMOTE, to: pick.to });
  }

  spectatorCamera(dt) {
    const cam = this.camera;
    const me = this.player;
    let focus;
    if (this.deathAt && this.now - this.deathAt < 3.5 && me.s) focus = me.s;
    else {
      const sel = this.deploy.info && this.deploy.info.options.find((o) => o.id === this.deploy.selectedSpawn);
      focus = sel ? { x: sel.x, y: this.world.terrain.heightAt(sel.x, sel.z), z: sel.z } : this.world.bases[this.store.get('faction')] || this.world.tById.midvale;
    }
    this.specAngle = (this.specAngle || 0) + dt * 0.05;
    const y = Math.max(this.world.terrain.heightAt(focus.x, focus.z), focus.y || 0);
    const tx = focus.x + Math.cos(this.specAngle) * 70;
    const tz = focus.z + Math.sin(this.specAngle) * 70;
    const ty = Math.max(y + 35, this.world.terrain.heightAt(tx, tz) + 12);
    cam.position.lerp(new THREE.Vector3(tx, ty, tz), Math.min(1, dt * 1.5));
    cam.lookAt(focus.x, y + 2, focus.z);
    cam.fov = 60;
    cam.updateProjectionMatrix();
  }

  renderScene(dt) {
    const r = this.renderer;
    const me = this.player;
    const time = this.time;
    const ws = this.store.get('world');
    r.updateEnvironment(ws, dt, time);
    const cam = this.camera;
    const focus = me.alive ? me.s : { x: cam.position.x, y: cam.position.y - 20, z: cam.position.z };
    r.updateShadow(focus);
    // soldiers
    const list = [];
    const rt = this.cw.renderTime();
    for (const e of this.cw.ents.values()) {
      if (e.k !== ENTITY.SOLDIER) continue;
      let st = this.cw.sample(e, rt);
      if (!st) continue;
      if (e.id === me.id && me.alive) {
        st = { ...st, x: me.s.x, y: me.s.y, z: me.s.z, yaw: me.yaw, pitch: me.pitch, stance: me.s.stance, lean: me.lean, sprint: me.sprint, ads: me.ads };
        if (me.vehicle && me.veh) {
          st.vehicle = me.vehicle;
          st.seat = me.seat;
        }
      }
      list.push({ e: st, info: this.cw.infos.get(e.id), hidden: e.id === me.id && me.hideSelf() });
    }
    this.soldiers.update(list, dt, time, cam.position);
    // vehicles (own driven vehicle uses prediction)
    const vlist = [];
    const engines = [];
    for (const e of this.cw.ents.values()) {
      if (e.k !== ENTITY.VEHICLE) continue;
      let st = this.cw.sample(e, rt);
      if (!st) continue;
      if (me.veh && me.veh.id === e.id) st = { ...st, x: me.veh.x, y: me.veh.y, z: me.veh.z, yaw: me.veh.yaw, pitch: me.veh.pitch || 0, roll: me.veh.roll || 0, speed: me.veh.speed };
      vlist.push(st);
      const def = VEHICLES[VEHICLE_CODES[st.type]];
      if (def) engines.push({ id: e.id, x: st.x, y: st.y, z: st.z, speed: st.speed, maxSpeed: def.maxSpeed, engine: (st.state & 8) !== 0 && (st.state & 7) !== 3, kind: def.air ? 'air' : def.tracked ? 'tank' : def.water ? 'boat' : 'car' });
    }
    this.vehicles.update(vlist, dt, time, r.daylight, this.effects, cam.position);
    // props & projectiles
    const plist = [];
    for (const e of this.cw.ents.values()) {
      if (e.k !== ENTITY.PROJECTILE && e.k !== ENTITY.PROP) continue;
      const st = this.cw.sample(e, rt);
      if (st) plist.push(st);
    }
    this.props.update(plist, dt, time, this.effects);
    this.effects.update(dt, time, cam, ws);
    const war = this.store.get('war');
    this.worldScene.update(cam, dt, time, { effects: this.effects, war, wind: ws ? ws.wind : 0.3, windDir: ws ? ws.windDir : 0.6 });
    this.effects.updateBattles(war ? war.battles : [], this.world, cam.position, dt);
    // audio
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    this.audio.setListener(cam.position, fwd);
    this.audio.updateEngines(engines);
    const base = this.world.bases[this.store.get('faction')] || this.world.tById.midvale;
    const battles = (this.store.get('battles') || []).map((b) => this.world.tById[b.t]).filter(Boolean);
    const biome = this.world.biomeAt(cam.position.x, cam.position.z);
    this.audio.updateAmbience({
      rain: r.env.rain, wind: ws ? ws.wind : 0.3, daylight: r.daylight, altitude: cam.position.y - this.world.terrain.heightAt(cam.position.x, cam.position.z),
      nearBase: Math.hypot(cam.position.x - base.x, cam.position.z - base.z) < 200, battles, nature: biome === 'wild' || biome === 'forest' || biome === 'farmland' || biome === 'mountain',
    }, dt);
    // other soldiers' footsteps (nearby only)
    this.footTimer = (this.footTimer || 0) + dt;
    if (this.footTimer > 0.3) {
      this.footTimer = 0;
      for (const it of list) {
        const e = it.e;
        if (e.id === me.id || e.vehicle || e.life !== LIFE.ALIVE) continue;
        const d = Math.hypot(e.x - cam.position.x, e.z - cam.position.z);
        if (d > 25) continue;
        const st = this.soldiers.state.get(e.id);
        if (st && st.speed > 1.2) this.audio.footstep(e, 'dirt', e.sprint ? 1.1 : e.stance === STANCE.STAND ? 0.8 : 0.4);
      }
    }
    r.render();
    r.trackFps(this.realDt);
  }

  drawFloats() {
    if (!this.floats || !this.floats.length) return;
    const ctx = this.markers.ctx;
    const now = this.now;
    this.floats = this.floats.filter((f) => now - f.t < 2.5);
    ctx.font = 'italic 600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const f of this.floats) {
      const p = this.markers.project(f.x, f.y + (now - f.t) * 0.3, f.z);
      if (p.behind) continue;
      ctx.globalAlpha = Math.max(0, 1 - (now - f.t) / 2.5);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(`"${f.text}"`, p.x + 1, p.y + 1);
      ctx.fillStyle = '#f2ead0';
      ctx.fillText(`"${f.text}"`, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }
}

export { dirFromYawPitch, FACTION };
