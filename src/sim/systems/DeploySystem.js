// Deployment: where a soldier may spawn, role/loadout validation, respawn timers.
import { LIFE, RESPAWN, FACTION_INFO, PROP_KIND, areHostile } from '../../shared/constants.js';
import { ROLES, buildLoadout } from '../../shared/config/roles.js';
import { WEAPONS } from '../../shared/config/weapons.js';
import { RANK } from '../../shared/config/ranks.js';
import { MSG, V } from '../../shared/protocol.js';
import { yawFromDir, dist2D, mulberry32 } from '../../shared/math.js';
import { seatWorld } from '../../shared/physics.js';

export class DeploySystem {
  constructor(game) {
    this.game = game;
    this.rand = mulberry32(99);
    this.timer = 0;
  }

  respawnDelay(session) {
    let d = RESPAWN.base + RESPAWN.afterDeathExtra;
    if (session.lastDeathPos) {
      const t = this.game.territoryAt(session.lastDeathPos.x, session.lastDeathPos.z);
      const wt = t && this.game.war.get(t.id);
      if (wt && wt.owner === session.faction && wt.supply < 25) d += 4; // supply shortage slows reinforcement
    }
    return d;
  }

  options(session) {
    const g = this.game;
    const f = session.faction;
    const out = [];
    const base = g.world.bases[f];
    if (!session.profile.trainingComplete && !session.profile.trainingSkipped) {
      out.push({ id: 'training', type: 'base', name: 'Basic Training — Fort Sentinel', x: base.x, z: base.z, ok: true });
      return out;
    }
    out.push({ id: 'hq', type: 'base', name: g.world.tById[FACTION_INFO[f].hq].name, x: base.x, z: base.z, ok: true });
    for (const t of g.world.territories) {
      if (t.isBase) continue;
      const wt = g.war.get(t.id);
      if (!wt || wt.owner !== f) continue;
      const cp = t.commandPost;
      const block = g.war.spawnBlockedReason(t, f);
      out.push({ id: `t:${t.id}`, type: 'cp', name: t.name, x: cp.x, z: cp.z, ok: !block, reason: block || '' });
    }
    const squad = session.squadId ? g.squads.get(session.squadId) : null;
    if (squad) {
      const leader = g.byProfile.get(squad.leader);
      if (leader && leader !== session) {
        const ls = leader.soldier;
        let reason = '';
        if (!ls || ls.life !== LIFE.ALIVE) reason = 'Leader is down';
        else if (g.time - ls.lastDamageAt < RESPAWN.squadCombatBlock) reason = 'Leader in combat';
        else if (ls.vehicle) reason = 'Leader in vehicle';
        else if (g.isBaseArea(ls.x, ls.z, f)) reason = 'Leader at base';
        else if (this.enemiesNear(ls.x, ls.z, 30, f)) reason = 'Enemies nearby';
        out.push({ id: 'sl', type: 'squad', name: `Squad Leader ${leader.name}`, x: ls ? ls.x : 0, z: ls ? ls.z : 0, ok: !reason, reason });
      }
      if (squad.rally) {
        const r = g.get(squad.rally);
        if (r) {
          const blocked = this.enemiesNear(r.x, r.z, 25, f);
          out.push({ id: 'rally', type: 'rally', name: 'Squad Rally Point', x: r.x, z: r.z, ok: !blocked, reason: blocked ? 'Enemies nearby' : '' });
        }
      }
      for (const v of g.vehicles) {
        if (!v.def.mobileSpawn || v.state === 3 || v.faction !== f) continue;
        const drv = v.seats[0] ? g.get(v.seats[0]) : null;
        if (!drv || !drv.player || !squad.members.includes(drv.player.id)) continue;
        const seat = v.freeSeat((sd) => sd.role === 'passenger');
        out.push({ id: `v:${v.id}`, type: 'vehicle', name: `${v.def.name} (squad)`, x: v.x, z: v.z, ok: seat >= 0, reason: seat >= 0 ? '' : 'Full' });
      }
    }
    return out;
  }

  enemiesNear(x, z, r, faction) {
    return this.game.soldiersNear(x, z, r, (s) => s.life === LIFE.ALIVE && areHostile(s.faction, faction) && !s.captive).length > 0;
  }

  // Roles available to this player right now (rank + squad role limits).
  roleAvailability(session) {
    const g = this.game;
    const squad = session.squadId ? g.squads.get(session.squadId) : null;
    const counts = {};
    if (squad) {
      for (const pid of squad.members) {
        if (pid === session.id) continue;
        const o = g.byProfile.get(pid);
        const role = o && o.soldier && o.soldier.life !== LIFE.DEAD ? o.soldier.role : o && o.profile ? o.profile.lastRole : null;
        if (role) counts[role] = (counts[role] || 0) + 1;
      }
    }
    const out = {};
    for (const r of Object.values(ROLES)) {
      let reason = '';
      if (session.rankIndex < r.minRank) reason = 'Rank too low';
      else if (r.leaderOnly && (!squad || squad.leader !== session.id)) reason = 'Squad leaders only';
      else if (squad && (counts[r.id] || 0) >= r.perSquad) reason = 'Squad slots full';
      else if (!session.profile.trainingComplete && !session.profile.trainingSkipped && r.id !== 'rifleman') reason = 'Finish training';
      out[r.id] = reason;
    }
    return out;
  }

  sendOptions(session) {
    if (!session.profile) return;
    session.send({
      t: MSG.DEPLOYINFO,
      options: this.options(session),
      canDeployAt: session.canDeployAt,
      now: this.game.time,
      roles: this.roleAvailability(session),
      state: session.state,
    });
  }

  onDeploy(session, msg) {
    const g = this.game;
    if (session.soldier && session.soldier.life !== LIFE.DEAD) return;
    if (g.time < session.canDeployAt - 0.2) return;
    if (!V.str(msg.spawn, 32)) return;
    const opts = this.options(session);
    const opt = opts.find((o) => o.id === msg.spawn);
    if (!opt || !opt.ok) {
      g.notify(session, opt ? opt.reason || 'Spawn unavailable' : 'Spawn unavailable', 'warn');
      this.sendOptions(session);
      return;
    }
    const roles = this.roleAvailability(session);
    let roleId = V.str(msg.role, 16) && ROLES[msg.role] ? msg.role : 'rifleman';
    if (roles[roleId]) roleId = 'rifleman';
    const choice = { primary: V.str(msg.primary, 16) ? msg.primary : undefined, sidearm: V.str(msg.sidearm, 16) ? msg.sidearm : undefined };
    const lo = buildLoadout(roleId, choice, session.rankIndex, WEAPONS);
    const p = session.profile;
    p.lastRole = roleId;
    p.loadouts[roleId] = { primary: lo.weapons[0], sidearm: lo.weapons[1] };
    session.saveDirty = true;
    // spawn position
    let pos = null;
    let yaw = 0;
    let vehicle = null;
    const f = session.faction;
    const base = g.world.bases[f];
    const frontYaw = (x, z) => {
      const enemyHq = g.world.bases[f === 1 ? 2 : 1];
      return yawFromDir(enemyHq.x - x, enemyHq.z - z);
    };
    if (opt.id === 'hq' || opt.id === 'training') {
      const sp = base.spawns[Math.floor(this.rand() * base.spawns.length)];
      pos = { x: sp.x + (this.rand() - 0.5) * 3, z: sp.z + (this.rand() - 0.5) * 3 };
      yaw = frontYaw(pos.x, pos.z);
    } else if (opt.id.startsWith('t:')) {
      const t = g.world.tById[opt.id.slice(2)];
      const sp = t.spawns[Math.floor(this.rand() * t.spawns.length)] || t.commandPost;
      pos = { x: sp.x + (this.rand() - 0.5) * 2, z: sp.z + (this.rand() - 0.5) * 2 };
      yaw = frontYaw(pos.x, pos.z);
    } else if (opt.id === 'sl') {
      const squad = g.squads.get(session.squadId);
      const ls = g.byProfile.get(squad.leader).soldier;
      const a = this.rand() * Math.PI * 2;
      pos = { x: ls.x + Math.cos(a) * 2.5, z: ls.z + Math.sin(a) * 2.5 };
      yaw = ls.yaw;
    } else if (opt.id === 'rally') {
      const r = g.get(g.squads.get(session.squadId).rally);
      const a = this.rand() * Math.PI * 2;
      pos = { x: r.x + Math.cos(a) * 2, z: r.z + Math.sin(a) * 2 };
      yaw = frontYaw(pos.x, pos.z);
    } else if (opt.id.startsWith('v:')) {
      vehicle = g.get(Number(opt.id.slice(2)));
      if (!vehicle) return;
      pos = { x: vehicle.x, z: vehicle.z };
      yaw = vehicle.yaw;
    }
    if (!pos) return;
    // resolve to walkable ground
    const col = g.world.colliders;
    let y = col.groundHeight(pos.x, pos.z, 400);
    if (col.pointInSolid(pos.x, y + 0.9, pos.z)) {
      const tgt = opt.x !== undefined ? { x: opt.x, z: opt.z } : pos;
      pos = { x: tgt.x, z: tgt.z };
      y = col.groundHeight(pos.x, pos.z, 400);
    }
    const s = g.addSoldier({
      faction: f, name: session.name, rank: p.rank, role: roleId, player: session, squadId: session.squadId,
      x: pos.x, y: y + 0.05, z: pos.z, yaw, weapons: lo.weapons, armor: lo.armor,
      grenadeBonus: ROLES[roleId].perks.grenades ? ROLES[roleId].perks.grenades - 2 : 0,
      camo: p.cosmetics.camo, headgear: p.cosmetics.headgear,
    });
    s.invulnerableUntil = g.time + 3;
    session.soldier = s;
    session.state = 'alive';
    session.underFireRevives = 0;
    g.progression.startDeployment(session);
    if (vehicle) {
      const seat = vehicle.freeSeat((sd) => sd.role === 'passenger');
      if (seat >= 0) {
        g.vehicleSys.seat(s, vehicle, seat);
        const sw = seatWorld(vehicle, vehicle.def.seats[seat].offset);
        s.x = sw.x;
        s.y = sw.y;
        s.z = sw.z;
      }
    }
    session.send({ t: MSG.SPAWNED, id: s.id, p: [s.x, s.y, s.z], yaw, role: roleId });
    g.players.sendLoadout(session);
    g.training.onDeployed(session, opt.id);
    g.squads.broadcast();
  }

  update(dt) {
    this.timer += dt;
    if (this.timer < 2) return;
    this.timer = 0;
    for (const s of this.game.sessions) {
      if (s.profile && (!s.soldier || s.soldier.life === LIFE.DEAD)) this.sendOptions(s);
    }
  }
}

export { dist2D, PROP_KIND, RANK };
