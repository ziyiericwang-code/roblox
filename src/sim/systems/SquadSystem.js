// Squads: creation (rank gated), joining, invites, kicks, leadership transfer,
// squad objectives, rally points and attached NPC followers.
import { LIFE, PROP_KIND, RESPAWN } from '../../shared/constants.js';
import { rankOf, RANK } from '../../shared/config/ranks.js';
import { MSG, V } from '../../shared/protocol.js';

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima'];

export class SquadSystem {
  constructor(game) {
    this.game = game;
    this.squads = new Map(); // id -> squad
    this.nextId = 1;
    this.version = 1;
    this.posTimer = 0;
  }

  get(id) {
    return this.squads.get(id) || null;
  }

  list(faction) {
    return [...this.squads.values()].filter((s) => s.faction === faction);
  }

  maxSize(leaderSession) {
    return Math.max(4, rankOf(leaderSession.rankIndex).squadSize || 4);
  }

  create(session, opts = {}) {
    const g = this.game;
    if (session.rankIndex < RANK.CORPORAL) {
      g.notify(session, 'You must be a Corporal to lead a squad.', 'warn');
      return null;
    }
    if (session.squadId) this.leave(session, true);
    const used = new Set(this.list(session.faction).map((s) => s.name));
    const name = NAMES.find((n) => !used.has(n)) || `Squad ${this.nextId}`;
    const squad = {
      id: this.nextId++,
      name,
      faction: session.faction,
      leader: session.id,
      members: [session.id],
      locked: !!opts.locked,
      rally: 0,
      missionId: 0,
      order: null,
      npcs: [], // attached NPC follower soldier ids
      created: g.time,
    };
    this.squads.set(squad.id, squad);
    this.setSquad(session, squad.id);
    g.radio(session.faction, 'squad', 'HQ', `${session.name} formed Squad ${name}.`);
    this.changed();
    return squad;
  }

  setSquad(session, id) {
    session.squadId = id;
    if (session.soldier) {
      session.soldier.squadId = id;
      session.soldier.infoVersion++;
    }
  }

  join(session, squadId, viaInvite = false) {
    const g = this.game;
    const squad = this.get(squadId);
    if (!squad || squad.faction !== session.faction) return false;
    if (squad.members.includes(session.id)) return true;
    const leader = g.byProfile.get(squad.leader);
    if (squad.locked && !viaInvite) {
      g.notify(session, 'That squad is invite only.', 'warn');
      return false;
    }
    if (leader && squad.members.length >= this.maxSize(leader)) {
      g.notify(session, 'That squad is full.', 'warn');
      return false;
    }
    if (session.squadId) this.leave(session, true);
    squad.members.push(session.id);
    this.setSquad(session, squad.id);
    session.invites.delete(squad.id);
    g.radio(session.faction, 'squad', squad.name, `${session.name} joined the squad.`, { squad: squad.id });
    this.changed();
    return true;
  }

  leave(session, silent = false) {
    const squad = this.get(session.squadId);
    this.setSquad(session, 0);
    if (!squad) return;
    squad.members = squad.members.filter((id) => id !== session.id);
    if (!silent) this.game.radio(session.faction, 'squad', squad.name, `${session.name} left the squad.`, { squad: squad.id });
    if (squad.leader === session.id) this.transferLeadership(squad);
    this.cleanup(squad);
    this.changed();
  }

  transferLeadership(squad) {
    const g = this.game;
    // highest ranked eligible member takes over; otherwise the squad disbands
    let best = null;
    for (const pid of squad.members) {
      const s = g.byProfile.get(pid);
      if (!s || s.rankIndex < RANK.CORPORAL) continue;
      if (!best || s.rankIndex > best.rankIndex) best = s;
    }
    if (best) {
      squad.leader = best.id;
      g.radio(best.faction, 'squad', squad.name, `${best.name} has taken command of the squad.`, { squad: squad.id });
      if (best.soldier && best.soldier.role !== 'leader') g.notify(best, 'You now lead the squad. Redeploy as Squad Leader for full tools.', 'info');
    } else {
      for (const pid of squad.members) {
        const s = g.byProfile.get(pid);
        if (s) {
          this.setSquad(s, 0);
          g.notify(s, `Squad ${squad.name} disbanded (no eligible leader).`, 'warn');
        }
      }
      squad.members = [];
    }
  }

  cleanup(squad) {
    if (squad.members.length > 0) return;
    const g = this.game;
    if (squad.rally) {
      const r = g.get(squad.rally);
      if (r) g.removeEntity(r);
    }
    g.npc.releaseFollowers(squad);
    this.squads.delete(squad.id);
  }

  invite(session, targetId) {
    const g = this.game;
    const squad = this.get(session.squadId);
    if (!squad || squad.leader !== session.id) return;
    const target = g.byProfile.get(targetId);
    if (!target || target.faction !== session.faction || target.squadId === squad.id) return;
    target.invites.add(squad.id);
    target.send({ t: MSG.NOTICE, kind: 'invite', squad: squad.id, name: squad.name, from: session.name });
    g.notify(session, `Invited ${target.name}.`, 'good');
  }

  kick(session, targetId) {
    const g = this.game;
    const squad = this.get(session.squadId);
    if (!squad || squad.leader !== session.id || targetId === session.id) return;
    const target = g.byProfile.get(targetId);
    if (!target || target.squadId !== squad.id) return;
    this.leave(target, true);
    g.notify(target, `You were removed from Squad ${squad.name}.`, 'warn');
  }

  onMessage(session, msg) {
    const g = this.game;
    switch (msg.a) {
      case 'create':
        this.create(session, { locked: !!msg.locked });
        break;
      case 'join':
        if (V.int(msg.id, 1, 1e6)) this.join(session, msg.id, session.invites.has(msg.id));
        break;
      case 'leave':
        this.leave(session);
        break;
      case 'invite':
        if (V.str(msg.player, 48)) this.invite(session, msg.player);
        break;
      case 'kick':
        if (V.str(msg.player, 48)) this.kick(session, msg.player);
        break;
      case 'lock': {
        const sq = this.get(session.squadId);
        if (sq && sq.leader === session.id) {
          sq.locked = !!msg.locked;
          this.changed();
        }
        break;
      }
      case 'promote': {
        const sq = this.get(session.squadId);
        const target = V.str(msg.player, 48) ? g.byProfile.get(msg.player) : null;
        if (sq && sq.leader === session.id && target && target.squadId === sq.id && target.rankIndex >= RANK.CORPORAL) {
          sq.leader = target.id;
          g.radio(session.faction, 'squad', sq.name, `${target.name} now leads the squad.`, { squad: sq.id });
          this.changed();
        }
        break;
      }
      case 'mission': {
        const sq = this.get(session.squadId);
        if (!sq || sq.leader !== session.id) return;
        if (session.rankIndex < RANK.SERGEANT) {
          g.notify(session, 'Squad objectives require the rank of Sergeant.', 'warn');
          return;
        }
        const m = V.int(msg.id, 0, 1e7) ? g.missions.get(msg.id) : null;
        sq.missionId = m ? m.id : 0;
        if (m) {
          g.radio(session.faction, 'squad', sq.name, `Squad objective: ${m.title}.`, { squad: sq.id, priority: 1 });
          for (const pid of sq.members) {
            const o = g.byProfile.get(pid);
            if (o) o.trackedMission = m.id;
          }
          g.missions.broadcastTracked(sq);
        }
        this.changed();
        break;
      }
      case 'rally':
        g.commands.useAbility(session, 'rally_point', {});
        break;
      default:
        break;
    }
  }

  placeRally(session) {
    const g = this.game;
    const squad = this.get(session.squadId);
    const s = session.soldier;
    if (!squad || squad.leader !== session.id || !s || s.life !== LIFE.ALIVE) return false;
    if (g.deploySys.enemiesNear(s.x, s.z, 35, s.faction)) {
      g.notify(session, 'Too close to enemies to place a rally point.', 'warn');
      return false;
    }
    if (squad.rally) {
      const old = g.get(squad.rally);
      if (old) g.removeEntity(old);
    }
    const p = g.addProp(PROP_KIND.RALLY_POINT, { x: s.x, y: s.y, z: s.z, faction: s.faction, squadId: squad.id, ownerId: s.id, expiresAt: g.time + RESPAWN.rallyLifetime });
    squad.rally = p.id;
    g.radio(s.faction, 'squad', squad.name, 'Rally point established.', { squad: squad.id });
    this.changed();
    return true;
  }

  onLeave(session) {
    if (session.squadId) this.leave(session);
  }

  onRankChanged(session) {
    this.changed();
    void session;
  }

  changed() {
    this.version++;
  }

  broadcast() {
    this.changed();
  }

  // Serialised squad list for a faction.
  view(faction) {
    const g = this.game;
    return this.list(faction).map((sq) => {
      const leader = g.byProfile.get(sq.leader);
      return {
        id: sq.id,
        name: sq.name,
        leader: sq.leader,
        leaderName: leader ? leader.name : '?',
        leaderRank: leader ? leader.rankIndex : 0,
        max: leader ? this.maxSize(leader) : 4,
        locked: sq.locked,
        missionId: sq.missionId,
        order: sq.order ? { type: sq.order.type, x: sq.order.x, z: sq.order.z, by: sq.order.issuerName, byRank: sq.order.issuerRank, until: sq.order.expiresAt } : null,
        rally: sq.rally ? (() => {
          const r = g.get(sq.rally);
          return r ? [Math.round(r.x), Math.round(r.z)] : null;
        })() : null,
        npcs: sq.npcs.length,
        members: sq.members.map((pid) => {
          const s = g.byProfile.get(pid);
          return s ? { id: pid, name: s.name, rank: s.rankIndex, role: s.soldier ? s.soldier.role : s.profile.lastRole, alive: !!(s.soldier && s.soldier.life !== 2), eid: s.soldier ? s.soldier.id : 0 } : { id: pid, name: '?', rank: 0 };
        }),
      };
    });
  }

  update(dt) {
    const g = this.game;
    // expire rally points that were removed
    for (const sq of this.squads.values()) {
      if (sq.rally && !g.get(sq.rally)) {
        sq.rally = 0;
        this.changed();
      }
      if (sq.order && sq.order.expiresAt < g.time) {
        sq.order = null;
        this.changed();
      }
    }
    // squad member positions for HUD/map (low rate)
    this.posTimer += dt;
    if (this.posTimer >= 1) {
      this.posTimer = 0;
      for (const sq of this.squads.values()) {
        const pos = [];
        for (const pid of sq.members) {
          const s = g.byProfile.get(pid);
          if (s && s.soldier && s.soldier.life !== 2) pos.push([s.soldier.id, Math.round(s.soldier.x), Math.round(s.soldier.z), s.soldier.life, pid === sq.leader ? 1 : 0]);
        }
        for (const nid of sq.npcs) {
          const n = g.get(nid);
          if (n && n.life !== 2) pos.push([n.id, Math.round(n.x), Math.round(n.z), n.life, 2]);
        }
        for (const pid of sq.members) {
          const s = g.byProfile.get(pid);
          if (s) s.send({ t: MSG.SQUADPOS, p: pos });
        }
      }
    }
  }
}
