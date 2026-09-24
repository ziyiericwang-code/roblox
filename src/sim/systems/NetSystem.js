// Replication: per-client interest management, binary snapshots, entity
// info (names/cosmetics sent once), batched gameplay events and versioned
// state broadcasts (war, missions, squads, events).
import { ENTITY, INTEREST_RADIUS, LIFE, areHostile, FACTION } from '../../shared/constants.js';
import { MSG, encodeSnapshot } from '../../shared/protocol.js';
import { WEAPON_CODE, VEHICLE_CODE, ROLE_CODE, PROJECTILE_CODE } from '../../shared/combat.js';
import { dist2D } from '../../shared/math.js';

const SPOT_RADIUS = 650;

export class NetSystem {
  constructor(game) {
    this.game = game;
    this.stateTimer = 0;
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

  onJoin(session) {
    session.versions = {};
    this.sendStates(session, true);
    this.game.commands.sendState(session);
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
      return { id: e.id, k: e.k, name: e.name, camo: e.camo, hg: e.headgear, pl: e.isPlayer ? 1 : 0, vip: e.npc && e.npc.vip ? 1 : 0, pid: e.player ? e.player.id : '' };
    }
    if (e.k === ENTITY.VEHICLE) return { id: e.id, k: e.k, type: e.type };
    if (e.k === ENTITY.PROP) return { id: e.id, k: e.k, kind: e.kind, variant: e.variant, squad: e.squadId };
    return { id: e.id, k: e.k, type: e.type };
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const g = this.game;
    for (const session of g.sessions) {
      if (!session.profile || session.closed) continue;
      this.sendSnapshot(session);
      if (session.events.length) {
        session.send({ t: MSG.EVENTS, e: session.events });
        session.events = [];
      }
    }
    this.stateTimer += dt;
    if (this.stateTimer >= 0.5) {
      this.stateTimer = 0;
      for (const session of g.sessions) if (session.profile) this.sendStates(session, false);
    }
  }

  sendSnapshot(session) {
    const g = this.game;
    const c = this.viewCenter(session);
    const items = [];
    const infos = [];
    const seen = new Set();
    const own = session.soldier;
    const push = (e) => {
      if (seen.has(e.id)) return;
      seen.add(e.id);
      let view;
      if (e.k === ENTITY.SOLDIER) view = this.soldierView(e, session);
      else if (e.k === ENTITY.VEHICLE) view = this.vehicleView(e);
      else if (e.k === ENTITY.PROJECTILE) view = { k: ENTITY.PROJECTILE, id: e.id, type: PROJECTILE_CODE[e.type] || 0, x: e.x, y: e.y, z: e.z };
      else view = { k: ENTITY.PROP, id: e.id, type: e.kind, x: e.x, y: e.y, z: e.z, faction: e.faction, health: (e.health / e.maxHealth) * 255, variant: e.variant };
      items.push(view);
      const ver = e.infoVersion || 1;
      if (session.known.get(e.id) !== ver) {
        session.known.set(e.id, ver);
        infos.push(this.info(e));
      }
    };
    if (own) push(own);
    g.spatial.query(c.x, c.z, SPOT_RADIUS, (e) => {
      const d = dist2D(e.x, e.z, c.x, c.z);
      if (d <= INTEREST_RADIUS) push(e);
      else if (e.k === ENTITY.SOLDIER && e.spottedUntil > g.time && areHostile(e.faction, session.faction)) push(e);
      else if (e.k === ENTITY.VEHICLE && d < SPOT_RADIUS) push(e);
    });
    for (const p of g.projectiles) if (dist2D(p.x, p.z, c.x, c.z) < INTEREST_RADIUS) push(p);
    for (const p of g.props) if (dist2D(p.x, p.z, c.x, c.z) < INTEREST_RADIUS || (p.kind === 2 && p.squadId && session.squadId === p.squadId)) push(p);
    // entities that left the interest set
    const gone = session.gone || [];
    session.gone = [];
    for (const id of session.known.keys()) {
      if (!seen.has(id)) {
        session.known.delete(id);
        gone.push(id);
      }
    }
    if (infos.length) session.send({ t: MSG.INFO, list: infos });
    if (gone.length) session.send({ t: MSG.GONE, ids: gone });
    const buf = encodeSnapshot(Math.round(g.time * 1000), session.lastInputSeq, items);
    session.send(buf);
  }

  sendStates(session, force) {
    const g = this.game;
    const v = session.versions;
    const f = session.faction;
    if (force || v.war !== g.war.version) {
      v.war = g.war.version;
      session.send({ t: MSG.WAR, war: g.war.view(), battles: [...g.war.battles.values()].map((b) => ({ id: b.id, tid: b.territory, att: b.attacker })) });
    }
    if (force || v.missions !== g.missions.version) {
      v.missions = g.missions.version;
      session.send({ t: MSG.MISSIONS, ...g.missions.view(), tracked: session.trackedMission, events: g.events.view() });
    } else if (v.events !== g.events.version) {
      v.events = g.events.version;
      session.send({ t: MSG.MISSIONS, ...g.missions.view(), tracked: session.trackedMission, events: g.events.view() });
    }
    const sqKey = `${g.squads.version}:${session.squadId}`;
    if (force || v.squads !== sqKey) {
      v.squads = sqKey;
      session.send({ t: MSG.SQUADS, squads: g.squads.view(f), mine: session.squadId, invites: [...session.invites] });
    }
    if (force) session.send({ t: MSG.WORLDSTATE, ...g.weather.view() });
    // cheap periodic time sync for mission timers
    if (force || !v.missionTick || g.time - v.missionTick > 5) {
      v.missionTick = g.time;
      if (!force) session.send({ t: MSG.MISSIONS, ...g.missions.view(), tracked: session.trackedMission, events: g.events.view() });
    }
    void LIFE;
    void FACTION;
  }
}
