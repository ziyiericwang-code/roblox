// Replication: per-client interest management, binary snapshots, entity
// info (names/cosmetics sent once), batched gameplay events and versioned,
// throttled state broadcasts (war, missions, squads, events, buildings).
//
// Network level of detail: snapshots go out every tick, but entities further
// away are included less often (near every tick, mid every 2nd, far every 4th);
// clients interpolate, so distant soldiers still move smoothly. Aircraft are
// visible from much further than soldiers. War views are built once per
// country per change and sent at most once a second.
import { ENTITY, INTEREST_RADIUS, areHostile, COUNTRY_IDS } from '../../shared/constants.js';
import { MSG, encodeSnapshot } from '../../shared/protocol.js';
import { WEAPON_CODE, VEHICLE_CODE, ROLE_CODE, PROJECTILE_CODE } from '../../shared/combat.js';
import { dist2D } from '../../shared/math.js';

const SPOT_RADIUS = 650;
const AIR_RADIUS = 1600;
const NEAR = 150;
const MID = 300;

export class NetSystem {
  constructor(game) {
    this.game = game;
    this.stateTimer = 0;
    this.warCache = new Map(); // faction -> {key, msg}
    this.snapTick = 0;
  }

  // ------------------------------------------------------------------ events
  queue(ev, opts) {
    const g = this.game;
    if (opts.to) {
      const list = Array.isArray(opts.to) ? opts.to : [opts.to];
      for (const s of list) if (s && s.profile) s.events.push(ev);
      return;
    }
    for (const s of g.sessions) {
      if (!s.profile) continue;
      if (opts.faction && s.faction !== opts.faction) continue;
      if (opts.squad && s.squadId !== opts.squad) continue;
      if (opts.pos) {
        const c = this.viewCenter(s);
        if (dist2D(c.x, c.z, opts.pos.x, opts.pos.z) > (opts.range || 500)) continue;
      }
      s.events.push(ev);
    }
  }

  viewCenter(session) {
    const s = session.soldier;
    if (s) return s;
    if (session.viewPos) return session.viewPos;
    return this.game.world.bases[session.faction] || { x: 0, z: 0 };
  }

  send(session, msg) {
    const p = this.game.perf;
    p.msgOut++;
    if (msg instanceof ArrayBuffer) p.bytesOut += msg.byteLength;
    else p.bytesOut += 64; // rough: JSON control messages
    session.send(msg);
  }

  onJoin(session) {
    session.versions = {};
    this.sendStates(session, true);
    this.game.commands.sendState(session);
    const b = this.game.war.buildingState;
    if (b.size) session.send({ t: MSG.BUILDINGS, full: 1, list: [...b.entries()] });
    if (session.admin) this.game.admin.sendState(session);
  }

  onRequest(session, msg) {
    if (msg.what === 'all') {
      session.versions = {};
      session.known.clear();
      this.sendStates(session, true);
    }
  }

  onEntityRemoved(e) {
    for (const s of this.game.sessions) {
      if (s.known.has(e.id)) {
        s.known.delete(e.id);
        (s.gone || (s.gone = [])).push(e.id);
      }
    }
  }

  sendLoadout(session) {
    const s = session.soldier;
    if (!s) return;
    session.send({ t: MSG.LOADOUT, weapons: s.weapons.map((w) => ({ id: w.id, mag: w.mag, reserve: w.reserve, count: w.count })), slot: s.slot });
  }

  // ------------------------------------------------------------------ views
  soldierView(e, viewer) {
    const g = this.game;
    const hostile = areHostile(e.faction, viewer.faction);
    const w = e.weapon;
    return {
      k: ENTITY.SOLDIER, id: e.id, x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch,
      stance: e.stance, lean: e.lean, life: e.life, sprint: e.sprint, ads: e.ads,
      firing: e.firingUntil > g.time, reloading: e.reloadUntil > g.time, carrying: !!e.carrying || (e.activity === 4),
      spotted: hostile && e.spottedUntil > g.time, captive: e.captive, ambient: e.ambient, swimming: e.swimming, isPlayer: e.isPlayer,
      faction: e.faction, role: ROLE_CODE[e.role] || 0, activity: e.activity || 0,
      weapon: w ? WEAPON_CODE[w.id] || 0 : 0,
      health: hostile ? 100 : e.health, rank: e.rank, squad: e.squadId & 0xff,
      vehicle: e.vehicle, seat: e.seat, emote: e.emote, armor: hostile ? 0 : e.armor,
    };
  }

  vehicleView(v) {
    let turretYaw = 0;
    let turretPitch = 0;
    for (const t of v.turrets) {
      if (t) {
        turretYaw = t.yaw - v.yaw;
        turretPitch = t.pitch;
        break;
      }
    }
    let seats = 0;
    for (let i = 0; i < Math.min(8, v.seats.length); i++) if (v.seats[i]) seats |= 1 << i;
    return {
      k: ENTITY.VEHICLE, id: v.id, type: VEHICLE_CODE[v.type], x: v.x, y: v.y, z: v.z, yaw: v.yaw, pitch: v.pitch || 0, roll: v.roll || 0,
      turretYaw, turretPitch, health: (v.health / v.def.hp) * 255, state: v.state | (v.engine ? 8 : 0), faction: v.faction, seats,
      speed: v.speed || 0, skin: v.skin || 0, cargo: v.cargo || 0,
    };
  }

  info(e) {
    if (e.k === ENTITY.SOLDIER) {
      return {
        id: e.id, k: e.k, name: e.name, camo: e.camo, hg: e.headgear, pl: e.isPlayer ? 1 : 0, vip: e.npc && e.npc.vip ? 1 : 0,
        pid: e.player ? e.player.id : '', ti: e.title || '', st: e.staff ? 1 : 0,
      };
    }
    if (e.k === ENTITY.VEHICLE) return { id: e.id, k: e.k, type: e.type };
    if (e.k === ENTITY.PROP) return { id: e.id, k: e.k, kind: e.kind, variant: e.variant, squad: e.squadId };
    return { id: e.id, k: e.k, type: e.type };
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const g = this.game;
    this.snapTick++;
    const war = g.war;
    let bmsg = null;
    if (war.dirtyBuildings.length) {
      const reset = war.dirtyBuildings.some((x) => x[0] === 'reset');
      bmsg = reset ? { t: MSG.BUILDINGS, full: 1, list: [...war.buildingState.entries()] } : { t: MSG.BUILDINGS, list: war.dirtyBuildings };
      war.dirtyBuildings = [];
    }
    for (const session of g.sessions) {
      if (!session.profile || session.closed) continue;
      if (bmsg) this.send(session, bmsg);
      if (!session.faction) continue;
      this.sendSnapshot(session);
      if (session.events.length) {
        this.send(session, { t: MSG.EVENTS, e: session.events });
        session.events = [];
      }
    }
    this.stateTimer += dt;
    if (this.stateTimer >= 0.5) {
      this.stateTimer = 0;
      for (const session of g.sessions) if (session.profile && session.faction) this.sendStates(session, false);
    }
  }

  sendSnapshot(session) {
    const g = this.game;
    const c = this.viewCenter(session);
    const items = [];
    const infos = [];
    const seen = new Set();
    const own = session.soldier;
    const tick = this.snapTick;
    // distance-based update rate (network LOD); entities skipped this tick stay known
    const due = (e, d) => {
      if (e === own || e.k === ENTITY.PROJECTILE) return true;
      if (d < NEAR) return true;
      const phase = (tick + e.id) | 0;
      if (d < MID) return (phase & 1) === 0;
      return (phase & 3) === 0;
    };
    const push = (e, d) => {
      if (seen.has(e.id)) return;
      seen.add(e.id);
      const ver = e.infoVersion || 1;
      const fresh = session.known.get(e.id) !== ver;
      if (!fresh && !due(e, d)) return;
      let view;
      if (e.k === ENTITY.SOLDIER) view = this.soldierView(e, session);
      else if (e.k === ENTITY.VEHICLE) view = this.vehicleView(e);
      else if (e.k === ENTITY.PROJECTILE) view = { k: ENTITY.PROJECTILE, id: e.id, type: PROJECTILE_CODE[e.type] || 0, x: e.x, y: e.y, z: e.z };
      else view = { k: ENTITY.PROP, id: e.id, type: e.kind, x: e.x, y: e.y, z: e.z, faction: e.faction, health: (e.health / e.maxHealth) * 255, variant: e.variant };
      items.push(view);
      if (fresh) {
        session.known.set(e.id, ver);
        infos.push(this.info(e));
      }
    };
    if (own) push(own, 0);
    g.spatial.query(c.x, c.z, SPOT_RADIUS, (e) => {
      const d = dist2D(e.x, e.z, c.x, c.z);
      if (d <= INTEREST_RADIUS) push(e, d);
      else if (e.k === ENTITY.SOLDIER && e.spottedUntil > g.time && areHostile(e.faction, session.faction)) push(e, d);
      else if (e.k === ENTITY.VEHICLE && d < SPOT_RADIUS) push(e, d);
    });
    for (const v of g.vehicles) {
      if (!v.def.air || seen.has(v.id)) continue;
      const d = dist2D(v.x, v.z, c.x, c.z);
      if (d < AIR_RADIUS) push(v, d);
    }
    for (const p of g.projectiles) {
      const d = dist2D(p.x, p.z, c.x, c.z);
      if (d < INTEREST_RADIUS) push(p, d);
    }
    for (const p of g.props) {
      const d = dist2D(p.x, p.z, c.x, c.z);
      if (d < INTEREST_RADIUS || (p.kind === 2 && p.squadId && session.squadId === p.squadId)) push(p, d);
    }
    // entities that left the interest set
    const gone = session.gone || [];
    session.gone = [];
    for (const id of session.known.keys()) {
      if (!seen.has(id)) {
        session.known.delete(id);
        gone.push(id);
      }
    }
    if (infos.length) this.send(session, { t: MSG.INFO, list: infos });
    if (gone.length) this.send(session, { t: MSG.GONE, ids: gone });
    this.send(session, encodeSnapshot(Math.round(g.time * 1000), session.lastInputSeq, items));
  }

  // War view per country, rebuilt only when the war changed: at most once a
  // second for territory/battle changes, every 5 s for marching battalions.
  warMessage(f) {
    const war = this.game.war;
    const now = this.game.time;
    let c = this.warCache.get(f);
    const verChanged = !c || c.ver !== war.version;
    const forceChanged = !c || c.fver !== war.forceVersion;
    if (!c || (verChanged && now - c.at >= 1) || (forceChanged && now - c.at >= 5)) {
      c = { ver: war.version, fver: war.forceVersion, at: now, key: `${war.version}:${war.forceVersion}`, msg: { t: MSG.WAR, war: war.view(f) } };
      this.warCache.set(f, c);
    }
    return c;
  }

  sendStates(session, force) {
    const g = this.game;
    const v = session.versions;
    const f = session.faction;
    const wc = this.warMessage(f);
    if (force || v.war !== wc.key) {
      v.war = wc.key;
      this.send(session, wc.msg);
    }
    const missionKey = `${g.missions.version}:${g.events.version}`;
    const mview = () => ({ t: MSG.MISSIONS, ...g.missions.view(f), tracked: session.trackedMission, events: g.events.view(f) });
    if (force || v.missions !== missionKey) {
      v.missions = missionKey;
      this.send(session, mview());
    }
    const sqKey = `${g.squads.version}:${session.squadId}`;
    if (force || v.squads !== sqKey) {
      v.squads = sqKey;
      this.send(session, { t: MSG.SQUADS, squads: g.squads.view(f), mine: session.squadId, invites: [...session.invites] });
    }
    if (force) this.send(session, { t: MSG.WORLDSTATE, ...g.weather.view() });
    // cheap periodic time sync for mission timers
    if (force || !v.missionTick || g.time - v.missionTick > 5) {
      v.missionTick = g.time;
      if (!force) this.send(session, mview());
    }
  }

  // Countries with players (for broadcasts).
  activeCountries() {
    return COUNTRY_IDS.filter((f) => this.game.playersOnline(f) > 0);
  }
}
