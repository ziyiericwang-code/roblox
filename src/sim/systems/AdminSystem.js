// Sandbox / admin mode and the developer performance monitor.
//
// Permission is decided on the server only: a profile id must be on the admin
// list (ADMIN_IDS environment variable, data/admins.json, or options.admins).
// In solo play the local player may start a separate *sandbox* career, which
// is an admin of its own offline world. Every admin action is validated and
// logged; normal players can never reach any of it from the client.
import { LIFE, COUNTRY_IDS, FACTION_INFO } from '../../shared/constants.js';
import { MAX_RANK, rankOf } from '../../shared/config/ranks.js';
import { VEHICLES } from '../../shared/config/vehicles.js';
import { WEAPONS } from '../../shared/config/weapons.js';
import { MSG, V } from '../../shared/protocol.js';
import { dist2D } from '../../shared/math.js';
import { makeWeaponState } from '../entities.js';

const WEATHER = ['clear', 'cloudy', 'overcast', 'rain', 'storm', 'fog'];

export class AdminSystem {
  constructor(game) {
    this.game = game;
    const opts = game.options || {};
    this.ids = new Set(opts.admins || []);
    this.soloSandbox = !!opts.sandbox;
    this.perfTimer = 0;
    this.lastMsgIn = 0;
    this.lastMsgOut = 0;
    this.lastBytes = 0;
  }

  isAdmin(id) {
    return this.soloSandbox || this.ids.has(id);
  }

  deny(session, what) {
    session.violations += 2;
    this.game.log.warn(`admin command refused for ${session.name} (${session.id}): ${what}`);
    this.game.notify(session, 'Not authorised.', 'warn');
  }

  onMessage(session, msg) {
    const g = this.game;
    if (!session.admin || !this.isAdmin(session.id)) return this.deny(session, String(msg.cmd).slice(0, 20));
    const s = session.soldier;
    const ok = (text) => {
      g.notify(session, `[Sandbox] ${text}`, 'good');
      g.log.info?.(`admin ${session.name}: ${text}`);
      this.sendState(session);
    };
    const fail = (text) => g.notify(session, `[Sandbox] ${text}`, 'warn');
    switch (msg.cmd) {
      case 'rank': {
        if (!V.int(msg.rank, 0, MAX_RANK)) return fail('Bad rank');
        g.progression.promote(session, msg.rank, 'admin');
        return ok(`Rank set to ${rankOf(msg.rank).name}`);
      }
      case 'country': {
        if (!COUNTRY_IDS.includes(msg.country)) return fail('Bad country');
        if (s && s.life !== LIFE.DEAD) g.players.onReturn(session, { force: true });
        session.profile.countryChangedAt = 0;
        g.onEnlist(session, { country: msg.country });
        return ok(`Transferred to ${FACTION_INFO[msg.country].short}`);
      }
      case 'tp': {
        if (!s || s.life === LIFE.DEAD) return fail('Deploy first');
        let x;
        let z;
        if (V.str(msg.to, 32) && g.world.tById[msg.to]) {
          const t = g.world.tById[msg.to];
          ({ x, z } = t.commandPost);
        } else if (V.str(msg.to, 32) && g.world.hqs.find((h) => h.id === msg.to)) {
          const b = Object.values(g.world.bases).find((bb) => bb.id === msg.to);
          ({ x, z } = b.spawns[0]);
        } else if (V.num(msg.x, -3070, 3070) && V.num(msg.z, -3070, 3070)) {
          x = msg.x;
          z = msg.z;
        } else return fail('Bad destination');
        if (s.vehicle) g.vehicleSys.ejectSoldier(s, true);
        const y = g.world.colliders.groundHeight(x, z, 800) + 0.1;
        s.x = x;
        s.y = y;
        s.z = z;
        s.vx = s.vy = s.vz = 0;
        s.airTime = 0;
        s.lastMoveT = g.time;
        session.send({ t: MSG.CORRECT, p: [x, y, z], tp: 1 });
        return ok(`Teleported to ${Math.round(x)}, ${Math.round(z)}`);
      }
      case 'vehicle': {
        if (!s || s.life === LIFE.DEAD) return fail('Deploy first');
        if (!V.str(msg.type, 24) || !VEHICLES[msg.type]) return fail('Unknown vehicle');
        const fx = -Math.sin(s.yaw);
        const fz = -Math.cos(s.yaw);
        const v = g.vehicleSys.spawnVehicle(msg.type, s.x + fx * 9, s.z + fz * 9, s.yaw, session.faction);
        if (!v) return fail('No room there');
        v.sandbox = true;
        return ok(`Spawned ${VEHICLES[msg.type].name}`);
      }
      case 'npc': {
        if (!s || s.life === LIFE.DEAD) return fail('Deploy first');
        const n = V.int(msg.n, 1, 12) ? msg.n : 6;
        const f = COUNTRY_IDS.includes(msg.faction) ? msg.faction : g.war.enemies(session.faction)[0] || COUNTRY_IDS.find((c) => c !== session.faction);
        const fx = -Math.sin(s.yaw);
        const fz = -Math.cos(s.yaw);
        const d = f === session.faction ? 8 : 60;
        const sq = g.npc.spawnSquad(f, s.x + fx * d, s.z + fz * d, { type: f === session.faction ? 'follow' : 'attack', targetId: s.id, x: s.x, z: s.z, r: 12 }, { size: n, force: true, special: true });
        if (!sq) return fail('Could not spawn');
        return ok(`Spawned ${sq.members.length} ${FACTION_INFO[f].adj} soldiers`);
      }
      case 'war': {
        const a = msg.a;
        const b = msg.b;
        if (!COUNTRY_IDS.includes(a) || !COUNTRY_IDS.includes(b) || a === b) return fail('Pick two countries');
        const done = msg.on ? g.war.declareWar(a, b, '(sandbox)') : g.war.endWar(a, b);
        return done ? ok(`${msg.on ? 'War declared' : 'Ceasefire'}: ${FACTION_INFO[a].short} / ${FACTION_INFO[b].short}`) : fail('No change');
      }
      case 'territory': {
        const w = g.war.get(msg.id);
        if (!w || w.isBase || !COUNTRY_IDS.includes(msg.owner) || w.owner === msg.owner) return fail('Bad territory/owner');
        g.war.createForce(msg.owner, w.id, 60, 'infantry', 'attacking');
        g.war.flipTerritory(w, msg.owner);
        return ok(`${w.def.name} now belongs to ${FACTION_INFO[msg.owner].short}`);
      }
      case 'battle': {
        const w = g.war.get(msg.id);
        if (!w || w.isBase) return fail('Bad territory');
        const attacker = COUNTRY_IDS.includes(msg.attacker) ? msg.attacker : g.war.enemies(w.owner)[0];
        if (!attacker || !g.war.atWar(attacker, w.owner)) return fail('Declare a war first');
        g.war.createForce(attacker, w.id, 90, 'mech', 'attacking');
        const b = g.war.startBattle(w.id, attacker, 'order');
        return b ? ok(`Battle of ${w.def.name} started`) : fail('Could not start');
      }
      case 'weather': {
        if (!WEATHER.includes(msg.kind)) return fail('Bad weather');
        g.weather.type = msg.kind;
        g.weather.version++;
        g.weather.nextChangeAt = g.time + 900;
        return ok(`Weather: ${msg.kind}`);
      }
      case 'time': {
        if (!V.num(msg.clock, 0, 24)) return fail('Bad time');
        g.weather.clock = msg.clock % 24;
        g.weather.version++;
        return ok(`Time: ${msg.clock.toFixed(1)}h`);
      }
      case 'weapon': {
        if (!s || s.life === LIFE.DEAD) return fail('Deploy first');
        const w = WEAPONS[msg.id];
        if (!w || !V.int(msg.slot ?? 0, 0, 4)) return fail('Unknown weapon');
        const slot = msg.slot ?? 0;
        s.weapons[slot] = makeWeaponState(msg.id);
        s.slot = slot;
        s.infoVersion++;
        g.net.sendLoadout?.(session);
        return ok(`Equipped ${w.name}`);
      }
      case 'destroy': {
        if (!s) return fail('Deploy first');
        let n = 0;
        for (const b of g.world.buildings) {
          if (!b.destructible) continue;
          if (dist2D((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, s.x, s.z) > (V.num(msg.r, 5, 200) ? msg.r : 40)) continue;
          g.war.damageBuilding(b.id, V.int(msg.n, 1, 3) ? msg.n : 1);
          n++;
        }
        return ok(`Damaged ${n} buildings`);
      }
      case 'mission': {
        const m = g.missions.debugStart ? g.missions.debugStart(session, msg.kind) : null;
        return m ? ok(`Mission started: ${m.title}`) : fail('No mission of that kind here');
      }
      case 'god':
        session.god = !!msg.on;
        return ok(`Invulnerability ${session.god ? 'on' : 'off'}`);
      case 'bypass':
        session.adminBypass = !!msg.on;
        return ok(`Restricted areas ${session.adminBypass ? 'open' : 'enforced'}`);
      case 'perf':
        session.perf = !!msg.on;
        return ok(`Performance monitor ${session.perf ? 'on' : 'off'}`);
      case 'xp': {
        const n = V.int(msg.n, 1, 1000000) ? msg.n : 1000;
        g.progression.award(session, { xp: n, reason: 'Sandbox', cat: 'service', noMult: true });
        return ok(`+${n} XP`);
      }
      case 'state':
        return this.sendState(session);
      default:
        return fail('Unknown command');
    }
  }

  sendState(session) {
    const g = this.game;
    session.send({
      t: MSG.ADMINSTATE,
      god: !!session.god, bypass: !!session.adminBypass, perf: !!session.perf,
      wars: g.war.wars.map((w) => [w.a, w.b]),
      territories: [...g.war.map.values()].filter((w) => !w.isBase).map((w) => [w.id, w.def.name, w.owner]),
      vehicles: Object.values(VEHICLES).filter((v) => !v.aiOnly).map((v) => [v.id, v.name]),
      weapons: Object.values(WEAPONS).filter((w) => w.kind !== 'gadget').map((w) => [w.id, w.name]),
    });
  }

  // Performance monitor stream for admins who switched it on.
  update(dt) {
    const g = this.game;
    this.perfTimer += dt;
    if (this.perfTimer < 1) return;
    const secs = this.perfTimer;
    this.perfTimer = 0;
    const watchers = [...g.sessions].filter((s) => s.perf && s.admin);
    const p = g.perf;
    const msgIn = (p.msgIn - this.lastMsgIn) / secs;
    const msgOut = (p.msgOut - this.lastMsgOut) / secs;
    const bytes = (p.bytesOut - this.lastBytes) / secs;
    this.lastMsgIn = p.msgIn;
    this.lastMsgOut = p.msgOut;
    this.lastBytes = p.bytesOut;
    if (!watchers.length) return;
    let npcs = 0;
    let staff = 0;
    const lod = [0, 0, 0];
    for (const s of g.soldiers) {
      if (!s.npc) continue;
      if (s.npc.kind === 'ambient') staff++;
      else {
        npcs++;
        lod[s.npc.lod || 0]++;
      }
    }
    let mem = 0;
    if (typeof process !== 'undefined' && process.memoryUsage) mem = process.memoryUsage().heapUsed / 1048576;
    else if (typeof performance !== 'undefined' && performance.memory) mem = performance.memory.usedJSHeapSize / 1048576;
    const battles = [...g.war.battles.values()];
    const data = {
      t: MSG.PERF,
      tick: Math.round(g.tickMsAvg * 100) / 100,
      load: g.load || 0,
      systems: Object.fromEntries(Object.entries(p.systems).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      players: g.playersOnline(),
      npcs, staff, lod, npcCap: g.npcCap,
      squads: g.npc.squads.size,
      battles: battles.length, live: battles.filter((b) => b.live).length,
      forces: g.war.forces.size,
      vehicles: g.vehicles.size, projectiles: g.projectiles.size, entities: g.entities.size,
      msgIn: Math.round(msgIn), msgOut: Math.round(msgOut), kbOut: Math.round(bytes / 102.4) / 10,
      mem: Math.round(mem),
      paths: g.npc.pathCount || 0,
    };
    for (const s of watchers) s.send(data);
  }
}
