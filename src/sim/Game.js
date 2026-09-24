// Authoritative game simulation. Platform agnostic: it runs inside the Node
// server (WebSocket transport, file persistence) and inside the browser for
// solo play (in-memory transport, localStorage persistence).
//
// Architecture: Game owns entities and player sessions; gameplay lives in
// systems (combat, war, missions, AI...) that are updated in a fixed order
// every tick. Clients never decide outcomes: they send intents, the systems
// validate and apply them.
import { TICK_RATE, FACTION, LIFE, ENTITY } from '../shared/constants.js';
import { SpatialHash, dist2D } from '../shared/math.js';
import { MSG } from '../shared/protocol.js';
import { GAME } from '../shared/config/game.js';
import { Soldier, Vehicle, Projectile, Prop } from './entities.js';
import { defaultProfile, migrateProfile, profileView, sanitizeName } from './profile.js';
import { ProgressionSystem } from './systems/ProgressionSystem.js';
import { CombatSystem } from './systems/CombatSystem.js';
import { PlayerSystem } from './systems/PlayerSystem.js';
import { DeploySystem } from './systems/DeploySystem.js';
import { SquadSystem } from './systems/SquadSystem.js';
import { CommandSystem } from './systems/CommandSystem.js';
import { WarSystem } from './systems/WarSystem.js';
import { MissionSystem } from './systems/MissionSystem.js';
import { EventSystem } from './systems/EventSystem.js';
import { NPCSystem } from './systems/NPCSystem.js';
import { VehicleSystem } from './systems/VehicleSystem.js';
import { WeatherSystem } from './systems/WeatherSystem.js';
import { TrainingSystem } from './systems/TrainingSystem.js';
import { AmbientSystem } from './systems/AmbientSystem.js';
import { NetSystem } from './systems/NetSystem.js';
import { RateLimiter } from './util/RateLimiter.js';

export class PlayerSession {
  constructor(game, conn) {
    this.game = game;
    this.conn = conn;
    this.id = null; // profile id
    this.name = 'Soldier';
    this.profile = null;
    this.soldier = null;
    this.faction = FACTION.COALITION;
    this.state = 'connecting'; // connecting -> menu -> alive/dead
    this.squadId = 0;
    this.trackedMission = 0;
    this.canDeployAt = 0;
    this.lastDeathPos = null;
    this.rtt = 0.08;
    this.lastInputSeq = 0;
    this.lastInputAt = 0;
    this.lastActiveAt = 0;
    this.known = new Map(); // entityId -> infoVersion known by client
    this.events = [];
    this.limiter = new RateLimiter();
    this.violations = 0;
    this.dirtyProfile = true;
    this.profileSentAt = 0;
    this.versions = {}; // last state versions sent
    this.saveDirty = false;
    this.lastSaveAt = 0;
    this.moveBudget = 0;
    this.deploy = null; // current deployment accounting
    this.training = null;
    this.invites = new Set();
    this.abilityReady = {};
    this.killLog = []; // timestamps of kills outside objectives
    this.battleTime = new Map(); // battleId -> seconds present
    this.range = null; // range qualification session
    this.lastLeadershipMinute = 0;
    this.leadershipThisMinute = 0;
    this.closed = false;
  }
  send(msg) {
    if (this.closed) return;
    try {
      this.conn.send(msg);
    } catch {
      /* transport closed */
    }
  }
  get rankIndex() {
    return this.profile ? this.profile.rank : 0;
  }
}

export class Game {
  constructor({ world, store, log = console, options = {} }) {
    this.world = world;
    this.store = store;
    this.log = log;
    this.options = options;
    this.time = 0; // simulation seconds
    this.tickCount = 0;
    this.nextId = 1;
    this.entities = new Map();
    this.soldiers = new Set();
    this.vehicles = new Set();
    this.projectiles = new Set();
    this.props = new Set();
    this.spatial = new SpatialHash(32);
    this.sessions = new Set();
    this.byProfile = new Map();
    this.npcCap = options.npcCap ?? GAME.npcCap;
    this.tickMsAvg = 0;
    this.running = false;
    this.warDirty = true;

    this.progression = new ProgressionSystem(this);
    this.combat = new CombatSystem(this);
    this.players = new PlayerSystem(this);
    this.deploySys = new DeploySystem(this);
    this.squads = new SquadSystem(this);
    this.commands = new CommandSystem(this);
    this.war = new WarSystem(this);
    this.missions = new MissionSystem(this);
    this.events = new EventSystem(this);
    this.npc = new NPCSystem(this);
    this.vehicleSys = new VehicleSystem(this);
    this.weather = new WeatherSystem(this);
    this.training = new TrainingSystem(this);
    this.ambient = new AmbientSystem(this);
    this.net = new NetSystem(this);
  }

  async init() {
    let warData = null;
    try {
      warData = await this.store.loadWar();
    } catch (e) {
      this.log.warn('war state load failed, starting fresh', e && e.message);
    }
    this.war.init(warData);
    this.vehicleSys.init();
    this.weather.init();
    this.missions.init();
  }

  start() {
    if (this.running) return;
    this.running = true;
    const stepMs = 1000 / TICK_RATE;
    let last = Date.now();
    let acc = 0;
    this.interval = setInterval(() => {
      const now = Date.now();
      acc += Math.min(250, now - last);
      last = now;
      let n = 0;
      while (acc >= stepMs && n < 4) {
        this.step(1 / TICK_RATE);
        acc -= stepMs;
        n++;
      }
      if (n === 4) acc = 0; // drop time instead of spiralling
    }, stepMs / 2);
  }

  stop() {
    this.running = false;
    if (this.interval) clearInterval(this.interval);
  }

  step(dt) {
    const t0 = performanceNow();
    this.time += dt;
    this.tickCount++;
    this.weather.update(dt);
    this.players.update(dt);
    this.deploySys.update(dt);
    this.npc.update(dt);
    this.vehicleSys.update(dt);
    this.combat.update(dt);
    this.war.update(dt);
    this.missions.update(dt);
    this.events.update(dt);
    this.commands.update(dt);
    this.squads.update(dt);
    this.training.update(dt);
    this.ambient.update(dt);
    this.progression.update(dt);
    for (const s of this.soldiers) {
      s.recordHistory(this.time);
      this.spatial.update(s, s.x, s.z);
    }
    for (const v of this.vehicles) this.spatial.update(v, v.x, v.z);
    this.net.update(dt);
    this.autosave();
    const ms = performanceNow() - t0;
    this.tickMsAvg = this.tickMsAvg * 0.95 + ms * 0.05;
    // adaptive NPC budget: keep ticks comfortably inside the 50 ms frame
    if (this.tickCount % 40 === 0) {
      const base = this.options.npcCap ?? GAME.npcCap;
      if (this.tickMsAvg > 28 && this.npcCap > GAME.npcCapMin) this.npcCap = Math.max(GAME.npcCapMin, this.npcCap - 6);
      else if (this.tickMsAvg < 14 && this.npcCap < base) this.npcCap = Math.min(base, this.npcCap + 2);
    }
  }

  // ---------------------------------------------------------------- entities
  allocId() {
    for (let i = 0; i < 65535; i++) {
      const id = this.nextId;
      this.nextId = this.nextId >= 65000 ? 1 : this.nextId + 1;
      if (!this.entities.has(id)) return id;
    }
    throw new Error('entity ids exhausted');
  }

  addSoldier(opts) {
    const s = new Soldier(this.allocId(), opts);
    s.spawnTime = this.time;
    this.entities.set(s.id, s);
    this.soldiers.add(s);
    this.spatial.update(s, s.x, s.z);
    s.recordHistory(this.time);
    return s;
  }

  addVehicle(type, opts) {
    const v = new Vehicle(this.allocId(), type, opts);
    this.entities.set(v.id, v);
    this.vehicles.add(v);
    this.spatial.update(v, v.x, v.z);
    return v;
  }

  addProjectile(type, opts) {
    const p = new Projectile(this.allocId(), type, { ...opts, bornAt: this.time });
    this.entities.set(p.id, p);
    this.projectiles.add(p);
    return p;
  }

  addProp(kind, opts) {
    const p = new Prop(this.allocId(), kind, opts);
    this.entities.set(p.id, p);
    this.props.add(p);
    return p;
  }

  removeEntity(e) {
    if (!e || !this.entities.has(e.id)) return;
    this.entities.delete(e.id);
    this.soldiers.delete(e);
    this.vehicles.delete(e);
    this.projectiles.delete(e);
    this.props.delete(e);
    this.spatial.remove(e);
    this.net.onEntityRemoved(e);
  }

  get(id) {
    return this.entities.get(id) || null;
  }

  soldiersNear(x, z, r, filter) {
    const out = [];
    const r2 = r * r;
    this.spatial.query(x, z, r, (e) => {
      if (e.k !== ENTITY.SOLDIER) return;
      const dx = e.x - x;
      const dz = e.z - z;
      if (dx * dx + dz * dz > r2) return;
      if (filter && !filter(e)) return;
      out.push(e);
    });
    return out;
  }

  vehiclesNear(x, z, r, filter) {
    const out = [];
    this.spatial.query(x, z, r + 6, (e) => {
      if (e.k !== ENTITY.VEHICLE) return;
      if (dist2D(e.x, e.z, x, z) > r) return;
      if (filter && !filter(e)) return;
      out.push(e);
    });
    return out;
  }

  playersOnline(faction) {
    let n = 0;
    for (const s of this.sessions) if (s.profile && (!faction || s.faction === faction)) n++;
    return n;
  }

  sessionsOf(faction) {
    const out = [];
    for (const s of this.sessions) if (s.profile && (!faction || s.faction === faction)) out.push(s);
    return out;
  }

  // ---------------------------------------------------------------- messaging
  // Queue a gameplay event for clients. opts: {to, pos, range, faction}
  emit(ev, opts = {}) {
    this.net.queue(ev, opts);
  }

  radio(faction, channel, from, text, opts = {}) {
    this.net.queue(['radio', channel, from, text, opts.priority || 0], { faction, to: opts.to, squad: opts.squad });
  }

  notify(session, text, kind = 'info') {
    this.net.queue(['notice', kind, text], { to: session });
  }

  // ---------------------------------------------------------------- sessions
  addConnection(conn) {
    const session = new PlayerSession(this, conn);
    this.sessions.add(session);
    conn.onMessage((msg) => {
      try {
        this.onMessage(session, msg);
      } catch (e) {
        this.log.error('message handler error', e && e.stack ? e.stack : e);
      }
    });
    conn.onClose(() => this.onDisconnect(session));
    return session;
  }

  async onHello(session, msg) {
    if (session.state !== 'connecting' || session.helloPending) return;
    session.helloPending = true;
    const id = typeof msg.id === 'string' && /^[A-Za-z0-9_-]{8,48}$/.test(msg.id) ? msg.id : null;
    const token = typeof msg.token === 'string' && msg.token.length >= 16 && msg.token.length <= 128 ? msg.token : null;
    if (!id || !token) {
      session.send({ t: MSG.REJECT, reason: 'Invalid identity' });
      session.conn.close();
      return;
    }
    if (this.sessions.size > GAME.maxPlayers + 4) {
      session.send({ t: MSG.REJECT, reason: 'Server full' });
      session.conn.close();
      return;
    }
    const name = sanitizeName(msg.name);
    // Session lock: an existing session for this profile is closed and saved first,
    // so a profile is only ever live in one place (no duplicated rewards).
    const existing = this.byProfile.get(id);
    if (existing && existing !== session) {
      existing.send({ t: MSG.KICK, reason: 'Signed in from another window' });
      await this.onDisconnect(existing);
      try {
        existing.conn.close();
      } catch {
        /* ignore */
      }
    }
    let data = null;
    try {
      data = await this.store.loadProfile(id);
    } catch (e) {
      this.log.error('profile load failed', e && e.message);
      session.send({ t: MSG.REJECT, reason: 'Could not load your service record. Please retry.' });
      session.conn.close();
      return;
    }
    const tokenHash = await this.store.hashToken(token);
    let profile;
    if (data) {
      profile = migrateProfile(data, id, name);
      if (profile.tokenHash && profile.tokenHash !== tokenHash) {
        session.send({ t: MSG.REJECT, reason: 'Identity token mismatch' });
        session.conn.close();
        return;
      }
    } else {
      profile = defaultProfile(id, name);
    }
    profile.tokenHash = tokenHash;
    profile.name = name;
    profile.lastSeen = Date.now();
    if (session.closed) return;
    session.id = id;
    session.name = name;
    session.profile = profile;
    session.state = 'menu';
    session.saveDirty = true;
    this.byProfile.set(id, session);
    session.send({
      t: MSG.WELCOME,
      id,
      seed: this.world.seed,
      serverTime: this.time,
      tick: TICK_RATE,
      profile: profileView(profile),
      faction: session.faction,
      solo: !!this.options.solo,
    });
    this.net.onJoin(session);
    this.training.onJoin(session);
    this.deploySys.sendOptions(session);
    this.radio(session.faction, 'system', 'HQ', `${this.progression.title(session)} has reported for duty.`);
  }

  onMessage(session, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === MSG.HELLO) {
      this.onHello(session, msg).catch((e) => this.log.error('hello failed', e));
      return;
    }
    if (!session.profile) return;
    if (!session.limiter.allow(msg.t, this.time)) {
      session.violations += 0.1;
      return;
    }
    session.lastActiveAt = this.time;
    switch (msg.t) {
      case MSG.PING: session.send({ t: MSG.PONG, c: msg.c, s: this.time }); break;
      case MSG.INPUT: this.players.onInput(session, msg); break;
      case MSG.FIRE: this.combat.onPlayerFire(session, msg); break;
      case MSG.RELOAD: this.players.onReload(session); break;
      case MSG.SWITCH: this.players.onSwitch(session, msg); break;
      case MSG.THROW: this.combat.onPlayerThrow(session, msg); break;
      case MSG.ACTION: this.players.onAction(session, msg); break;
      case MSG.GADGET: this.players.onGadget(session, msg); break;
      case MSG.DEPLOY: this.deploySys.onDeploy(session, msg); break;
      case MSG.RETURN: this.players.onReturn(session, msg); break;
      case MSG.SQUAD: this.squads.onMessage(session, msg); break;
      case MSG.ORDER: this.commands.onOrder(session, msg); break;
      case MSG.ABILITY: this.commands.onAbility(session, msg); break;
      case MSG.MISSION: this.missions.onMessage(session, msg); break;
      case MSG.VEHICLE: this.vehicleSys.onMessage(session, msg); break;
      case MSG.VSTATE: this.vehicleSys.onDriverState(session, msg); break;
      case MSG.VAIM: this.vehicleSys.onAim(session, msg); break;
      case MSG.VFIRE: this.vehicleSys.onFire(session, msg); break;
      case MSG.EMOTE: this.players.onEmote(session, msg); break;
      case MSG.COSMETIC: this.progression.onCosmetic(session, msg); break;
      case MSG.SETTINGS: this.progression.onSettings(session, msg); break;
      case MSG.TRAINING: this.training.onMessage(session, msg); break;
      case MSG.REQUEST: this.net.onRequest(session, msg); break;
      default: break;
    }
    if (session.violations > 60) {
      this.log.warn(`kicking ${session.name} for repeated invalid messages`);
      session.send({ t: MSG.KICK, reason: 'Too many invalid actions' });
      session.conn.close();
    }
  }

  async onDisconnect(session) {
    if (session.closed) return;
    session.closed = true;
    this.sessions.delete(session);
    if (session.id && this.byProfile.get(session.id) === session) this.byProfile.delete(session.id);
    if (!session.profile) return;
    try {
      this.squads.onLeave(session);
      this.missions.onLeave(session);
      this.progression.endDeployment(session, 'leave');
      if (session.soldier) {
        this.vehicleSys.ejectSoldier(session.soldier, true);
        this.combat.dropCarried(session.soldier);
        this.removeEntity(session.soldier);
        session.soldier = null;
      }
    } catch (e) {
      this.log.error('disconnect cleanup error', e);
    }
    await this.saveProfile(session, true);
  }

  // ---------------------------------------------------------------- persistence
  async saveProfile(session, final = false) {
    if (!session.profile) return true;
    const data = JSON.parse(JSON.stringify(session.profile));
    data.lastSeen = Date.now();
    // Retries with backoff. Rewards are idempotent (ledger) so a retried save can
    // never duplicate them; the in-memory profile stays authoritative meanwhile.
    for (let attempt = 0; attempt < (final ? 5 : 3); attempt++) {
      try {
        await this.store.saveProfile(session.id, data);
        session.lastSaveAt = this.time;
        session.saveDirty = false;
        return true;
      } catch (e) {
        this.log.warn(`save failed for ${session.id} (attempt ${attempt + 1})`, e && e.message);
        await sleep(200 * 2 ** attempt);
      }
    }
    session.saveDirty = true;
    return false;
  }

  autosave() {
    if (this.tickCount % TICK_RATE !== 0) return;
    for (const s of this.sessions) {
      if (s.profile && s.saveDirty && this.time - s.lastSaveAt > GAME.saveInterval && !s.saving) {
        s.saving = true;
        this.saveProfile(s).finally(() => {
          s.saving = false;
        });
      }
    }
    if (this.warDirty && this.time - (this.lastWarSave || 0) > GAME.warSaveInterval) {
      this.lastWarSave = this.time;
      this.warDirty = false;
      this.store.saveWar(this.war.serialize()).catch((e) => {
        this.warDirty = true;
        this.log.warn('war save failed', e && e.message);
      });
    }
  }

  async shutdown() {
    this.stop();
    const saves = [];
    for (const s of [...this.sessions]) {
      if (s.profile) {
        this.progression.endDeployment(s, 'shutdown');
        saves.push(this.saveProfile(s, true));
      }
    }
    saves.push(this.store.saveWar(this.war.serialize()).catch(() => {}));
    await Promise.all(saves);
  }

  isBaseArea(x, z, faction) {
    const b = this.world.bases[faction];
    if (!b) return false;
    return Math.abs(x - b.x) < b.rect[0] + 10 && Math.abs(z - b.z) < b.rect[1] + 10;
  }

  territoryAt(x, z) {
    let best = null;
    let bd = Infinity;
    for (const t of this.world.territories) {
      const d = dist2D(x, z, t.x, t.z);
      if (d < t.radius * 1.35 && d / t.radius < bd) {
        bd = d / t.radius;
        best = t;
      }
    }
    return best;
  }

  hostileAlive(s) {
    return s.life === LIFE.ALIVE && !s.captive && !s.ambient;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function performanceNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export { Soldier, Vehicle, Projectile, Prop };
