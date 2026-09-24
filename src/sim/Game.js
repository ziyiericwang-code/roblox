// Authoritative game simulation. Platform agnostic: it runs inside the Node
// server (WebSocket transport, file persistence) and inside the browser for
// solo play (in-memory transport, localStorage persistence).
//
// Architecture: Game owns entities and player sessions; gameplay lives in
// systems (combat, war, missions, AI...) that are updated in a fixed order
// every tick. Clients never decide outcomes: they send intents, the systems
// validate and apply them.
import { TICK_RATE, FACTION, LIFE, ENTITY, COUNTRY_IDS, FACTION_INFO } from '../shared/constants.js';
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
import { NetSystem } from './systems/NetSystem.js';
import { AdminSystem } from './systems/AdminSystem.js';
import { HierarchySystem } from './systems/HierarchySystem.js';
import { RateLimiter } from './util/RateLimiter.js';

export class PlayerSession {
  constructor(game, conn) {
    this.game = game;
    this.conn = conn;
    this.id = null; // profile id
    this.name = 'Soldier';
    this.profile = null;
    this.soldier = null;
    this.faction = FACTION.NONE; // the profile's country once enlisted
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
    this.soldierPool = []; // recycled NPC soldier objects
    this.sessions = new Set();
    this.byProfile = new Map();
    this.npcCap = options.npcCap ?? GAME.npcCap;
    this.tickMsAvg = 0;
    this.running = false;
    this.warDirty = true;
    this.load = 0; // automatic performance scaling level 0..3

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
    this.net = new NetSystem(this);
    this.hierarchy = new HierarchySystem(this);
    this.admin = new AdminSystem(this);
    // developer performance monitor: rolling per-system cost (ms per tick)
    this.perf = { systems: {}, msgIn: 0, msgOut: 0, bytesOut: 0, lastReset: 0 };
  }

  async init() {
    let warData = null;
    try {
      warData = await this.store.loadWar();
    } catch (e) {
      this.log.warn('war state load failed, starting fresh', e && e.message);
    }
    this.war.init(warData);
    this.hierarchy.init();
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
    this.timed('weather', () => this.weather.update(dt));
    this.timed('players', () => this.players.update(dt));
    this.timed('deploy', () => this.deploySys.update(dt));
    this.timed('npc', () => this.npc.update(dt));
    this.timed('vehicles', () => this.vehicleSys.update(dt));
    this.timed('combat', () => this.combat.update(dt));
    this.timed('war', () => this.war.update(dt));
    this.timed('missions', () => this.missions.update(dt));
    this.timed('events', () => this.events.update(dt));
    this.timed('commands', () => this.commands.update(dt));
    this.timed('squads', () => this.squads.update(dt));
    this.timed('training', () => this.training.update(dt));
    this.timed('hierarchy', () => this.hierarchy.update(dt));
    this.timed('progression', () => this.progression.update(dt));
    this.timed('spatial', () => {
      for (const s of this.soldiers) {
        s.recordHistory(this.time);
        this.spatial.update(s, s.x, s.z);
      }
      for (const v of this.vehicles) this.spatial.update(v, v.x, v.z);
    });
    this.timed('net', () => this.net.update(dt));
    this.admin.update(dt);
    this.autosave();
    const ms = performanceNow() - t0;
    this.tickMsAvg = this.tickMsAvg * 0.95 + ms * 0.05;
    // Automatic performance scaling. The tick must stay inside its 50 ms
    // frame; as it gets heavier the server sheds detail gracefully:
    //   load 1  fewer live squads per battle, slower distant AI
    //   load 2  smaller NPC materialisation radius, fewer staff and effects
    //   load 3  minimum NPC budget
    // Gameplay rules never change, only how much of the world is simulated in detail.
    if (this.tickCount % 40 === 0) {
      const base = this.options.npcCap ?? GAME.npcCap;
      if (this.tickMsAvg > 28 && this.npcCap > GAME.npcCapMin) this.npcCap = Math.max(GAME.npcCapMin, this.npcCap - 6);
      else if (this.tickMsAvg < 14 && this.npcCap < base) this.npcCap = Math.min(base, this.npcCap + 2);
      const t = this.tickMsAvg;
      const up = t > 40 ? 3 : t > 30 ? 2 : t > 22 ? 1 : 0;
      const down = t < 16 ? 0 : t < 24 ? 1 : t < 33 ? 2 : 3;
      if (up > this.load) this.load = up;
      else if (down < this.load) this.load = down;
    }
  }

  timed(name, fn) {
    const t0 = performanceNow();
    fn();
    const ms = performanceNow() - t0;
    const p = this.perf.systems;
    p[name] = (p[name] ?? ms) * 0.95 + ms * 0.05;
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
    const pooled = !opts.player && this.soldierPool.length ? this.soldierPool.pop() : null;
    const s = pooled ? pooled.init(this.allocId(), opts) : new Soldier(this.allocId(), opts);
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
    if (e.k === ENTITY.SOLDIER && e.npc && !e.player && this.soldierPool.length < 256) {
      e.npc = null;
      this.soldierPool.push(e);
    }
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
    session.faction = COUNTRY_IDS.includes(profile.country) ? profile.country : FACTION.NONE;
    session.admin = this.admin.isAdmin(id);
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
      admin: !!session.admin,
      solo: !!this.options.solo,
    });
    this.net.onJoin(session);
    if (session.faction) this.onEnlisted(session, false);
  }

  // Country chosen (first join or a transfer). Rank and career are kept.
  onEnlist(session, msg) {
    const f = msg.country;
    if (!COUNTRY_IDS.includes(f) || f === session.faction) return;
    const p = session.profile;
    if (session.faction) {
      if (session.soldier && session.soldier.life !== LIFE.DEAD) {
        this.notify(session, 'Return to the deployment screen before requesting a transfer.', 'warn');
        return;
      }
      const wait = (p.countryChangedAt || 0) + 30 * 60 * 1000 - Date.now();
      if (wait > 0 && !session.admin) {
        this.notify(session, `Transfer requests are allowed every 30 minutes (${Math.ceil(wait / 60000)} min left).`, 'warn');
        return;
      }
      this.squads.onLeave(session);
      this.missions.onLeave(session);
      p.countryChangedAt = Date.now();
      this.progression.record(session, 'transfer', `Transferred to the ${FACTION_INFO[f].army}`);
    } else {
      this.progression.record(session, 'enlist', `Enlisted in the ${FACTION_INFO[f].army}`);
    }
    p.country = f;
    session.faction = f;
    session.saveDirty = true;
    session.dirtyProfile = true;
    this.onEnlisted(session, true);
  }

  onEnlisted(session, fresh) {
    session.send({ t: MSG.WELCOME, id: session.id, seed: this.world.seed, serverTime: this.time, tick: TICK_RATE, profile: profileView(session.profile), faction: session.faction, admin: !!session.admin, solo: !!this.options.solo, enlisted: true });
    this.net.onJoin(session);
    this.training.onJoin(session);
    this.deploySys.sendOptions(session);
    this.radio(session.faction, 'system', 'HQ', fresh && !session.profile.trainingComplete
      ? `${this.progression.title(session)} has enlisted in the ${FACTION_INFO[session.faction].army}.`
      : `${this.progression.title(session)} has reported for duty.`);
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
    this.perf.msgIn++;
    if (msg.t === MSG.ENLIST) return this.onEnlist(session, msg);
    if (msg.t === MSG.ADMIN) return this.admin.onMessage(session, msg);
    if (msg.t === MSG.REQUEST) return this.net.onRequest(session, msg);
    if (msg.t === MSG.PING) return session.send({ t: MSG.PONG, c: msg.c, s: this.time });
    if (msg.t === MSG.SETTINGS) return this.progression.onSettings(session, msg);
    if (!session.faction) return; // everything else needs a country
    switch (msg.t) {
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
      case MSG.TRAINING: this.training.onMessage(session, msg); break;
      case MSG.PROMOTE: this.progression.onPromote(session, msg); break;
      case MSG.MAPCMD: this.war.mapCommand(session, msg.cmd, msg.target, msg.from); break;
      case MSG.TALK: this.hierarchy.onTalk(session, msg); break;
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

  // Inside faction's army headquarters (or any HQ when faction is omitted).
  isBaseArea(x, z, faction) {
    for (const b of Object.values(this.world.bases)) {
      if (faction && b.faction !== faction) continue;
      const dx = x - b.x;
      const dz = z - b.z;
      const c = Math.cos(-(b.rot || 0) * Math.PI / 2);
      const sn = Math.sin(-(b.rot || 0) * Math.PI / 2);
      const lx = dx * c - dz * sn;
      const lz = dx * sn + dz * c;
      if (Math.abs(lx) < b.rect[0] + 10 && Math.abs(lz) < b.rect[1] + 10) return true;
      if (Math.hypot(dx, dz) < Math.max(b.rect[0], b.rect[1]) * 0.9) return true;
    }
    return false;
  }

  // Battle area of a territory (sectors and the town around them), or null.
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

  // Region (always a territory on land): which province a point belongs to.
  regionAt(x, z) {
    return this.world.territoryAt(x, z);
  }

  // A friendly base: army HQ, or a territory command post held by the faction
  // that is not under attack (used for promotions and resupply).
  isFriendlyBase(x, z, faction) {
    if (this.isBaseArea(x, z, faction)) return true;
    for (const t of this.world.territories) {
      if (this.war.ownerOf(t.id) !== faction) continue;
      const cp = t.commandPost;
      if (dist2D(x, z, cp.x, cp.z) > 70) continue;
      const w = this.war.get(t.id);
      if (w && (w.state === 'controlled' || w.state === 'liberated')) return true;
    }
    return false;
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
