// AI soldiers: the physical layer of the war. Squads are materialised from the
// war's battalions around players (live battles, garrison patrols) and vanish
// again when nobody is near; every NPC killed is a casualty of its battalion.
// Also: squad director, perception, cover, combat, medics, retreats,
// followers and special mission NPCs (captives, VIPs).
//
// Simulation levels (per soldier, refreshed every director pass):
//   0 FULL     < aiNearPlayerRadius  think 4x/s, full character physics, shoots
//   1 REDUCED  < aiMidRadius         think ~1x/s, cheap kinematics, shoots at 5 Hz
//   2 LIGHT    beyond                think every 3 s, kinematics every 8 ticks
//   (ABSTRACT: not materialised at all — just a number in a WarSystem battalion)
// Pathfinding requests are budgeted per tick and line-of-sight checks per think
// are capped, so large battles stay within the tick budget. The Game also
// adapts the global NPC cap and its load level to measured tick time.
import { FACTION, LIFE, STANCE, PROP_KIND, areHostile, enemyOf, SEA_LEVEL, HEALTH } from '../../shared/constants.js';
import { GAME } from '../../shared/config/game.js';
import { WAR } from '../../shared/config/war.js';
import { surnameFor } from '../../shared/config/names.js';
import { WEAPONS } from '../../shared/config/weapons.js';
import { stepCharacter, eyeHeight } from '../../shared/physics.js';
import { Rng, dist2D, yawFromDir, approachAngle, angleDiff, clamp, dirFromYawPitch } from '../../shared/math.js';
import { spreadDir } from '../../shared/combat.js';
import { makeWeaponState } from '../entities.js';
import { rankOf } from '../../shared/config/ranks.js';

function rankFollowerCap(rank) {
  const rk = rankOf(rank);
  return rk.npcFollowers || Math.floor(rk.squadSize / 3);
}

// Field uniforms per country.
export const FACTION_CAMO = { [FACTION.ALDMARK]: 'woodland', [FACTION.KARSA]: 'karsa', [FACTION.SERAVIA]: 'seravia' };

const ROLE_KIT = {
  leader: { weapons: ['br4', 'p9', 'smoke', 'frag'], armor: 40, role: 'leader' },
  rifleman: { weapons: ['ar7', 'p9', 'frag', 'smoke'], armor: 45, role: 'rifleman' },
  support: { weapons: ['lmg9', 'p9', 'frag'], armor: 45, role: 'support' },
  medic: { weapons: ['smg5', 'p9', 'medkit', 'smoke'], armor: 30, role: 'medic' },
  engineer: { weapons: ['smg5', 'p9', 'rl3', 'frag'], armor: 35, role: 'engineer' },
  scout: { weapons: ['dmr24', 'p9', 'smoke'], armor: 20, role: 'scout' },
  officer: { weapons: ['p9'], armor: 10, role: 'leader' },
};
const SQUAD_ROLES = ['leader', 'rifleman', 'support', 'medic', 'rifleman', 'engineer', 'scout', 'rifleman'];

const CALLOUTS = {
  contact: ['Contact front!', 'Enemy spotted!', 'Contact!', 'Hostiles!'],
  reload: ['Reloading!', 'Changing mag!', 'Cover me, reloading!'],
  grenade: ['Grenade!', 'Frag out!'],
  down: ['Man down!', 'We\'ve got wounded!', 'Medic!'],
  move: ['Moving!', 'Pushing up!', 'On me!'],
  retreat: ['Fall back!', 'Pull back, pull back!'],
  suppressed: ['I\'m pinned!', 'Suppressed!', 'Taking fire!'],
  vehicle: ['Enemy vehicle!', 'Armour spotted!'],
  capture: ['Taking the flag!', 'Secure the objective!'],
};

export class NPCSystem {
  constructor(game) {
    this.game = game;
    this.squads = new Map();
    this.nextSquadId = 1;
    this.rng = new Rng(31337);
    this.directorTimer = 0;
    this.pathBudget = 0;
    this.nearCache = new Map(); // soldier id -> near flag (refreshed each director pass)
    this.lastGunfire = new Map();
    this.reinforceAt = new Map(); // `${battleId}:${faction}` -> time
    this.garrisonTimer = 0;
    this.live = new Map(); // `${territory}:${faction}` -> materialised soldiers (refreshed each pass)
    this.deferred = []; // mission squads waiting for a player to come near
    this.pathCount = 0;
  }

  // ------------------------------------------------------------------ queries
  squadsOf(f) {
    return [...this.squads.values()].filter((s) => s.faction === f);
  }

  squadCentroid(sq) {
    let n = 0;
    let x = 0;
    let z = 0;
    for (const id of sq.members) {
      const s = this.game.get(id);
      if (s && s.life !== LIFE.DEAD) {
        x += s.x;
        z += s.z;
        n++;
      }
    }
    return n ? { x: x / n, z: z / n } : null;
  }

  followerSquadOf(playerSquad) {
    for (const sq of this.squads.values()) if (sq.attachedSquad === playerSquad.id) return sq;
    return null;
  }

  combatCount() {
    let n = 0;
    for (const s of this.game.soldiers) if (s.npc && !s.ambient && s.life !== LIFE.DEAD) n++;
    return n;
  }

  nearPlayer(x, z, r) {
    for (const sess of this.game.sessions) {
      const s = sess.soldier;
      const p = s && s.life !== LIFE.DEAD ? s : sess.viewPos;
      if (p && dist2D(p.x, p.z, x, z) < r) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ spawning
  spawnSoldier(faction, x, z, opts = {}) {
    const g = this.game;
    const kitName = opts.kit || 'rifleman';
    const kit = ROLE_KIT[kitName] || ROLE_KIT.rifleman;
    let px = x;
    let pz = z;
    if (!opts.exact && g.world.nav && !g.world.nav.isWalkable(px, pz)) {
      const p = g.world.nav.randomPointNear(px, pz, 12, () => this.rng.next());
      px = p.x;
      pz = p.z;
    }
    const y = g.world.colliders.groundHeight(px, pz, opts.y !== undefined ? opts.y + 1 : 800);
    if (y < SEA_LEVEL - 0.8) return null;
    const rank = opts.rank ?? (kitName === 'leader' ? this.rng.int(5, 8) : this.rng.int(1, 4));
    const desert = g.world.biomeAt && /desert|canyon/.test(g.world.biomeAt(px, pz) || '');
    const s = g.addSoldier({
      faction, name: opts.name || surnameFor(faction, this.rng.int(0, 999)), rank, role: kit.role,
      x: px, y, z: pz, yaw: opts.yaw ?? this.rng.float(-Math.PI, Math.PI), weapons: kit.weapons, armor: opts.armor ?? kit.armor,
      camo: opts.camo || (desert && faction !== FACTION.KARSA ? 'desert' : FACTION_CAMO[faction] || 'woodland'), headgear: opts.headgear || 'helmet',
      ambient: !!opts.ambient, captive: !!opts.captive,
    });
    s.npc = {
      squad: 0, skill: opts.skill ?? this.rng.float(0.35, 0.75), state: opts.state || 'idle',
      path: null, pathIdx: 0, pathGoal: null, repathAt: 0, moveTarget: null, arriveR: 1.2,
      target: 0, targetSeenAt: -99, lastKnown: null, alertUntil: 0, alertPos: null,
      cover: -1, coverUntil: 0, nextThink: g.time + this.rng.float(0, 0.3), nextShot: 0, burst: 0,
      reactionAt: 0, stuckT: 0, lastX: px, lastZ: pz, lastCheck: g.time, calloutAt: 0, grenadeAt: g.time + 15,
      rocketAt: 0, sprint: false, far: false, stance: STANCE.STAND, slot: 0, vip: !!opts.vip, rescuer: null,
      mission: opts.mission || 0, kind: opts.ambient ? 'ambient' : 'combat', holdPos: null, jump: false, crouchT: 0,
      lod: 0, tid: opts.tid || null, post: null, amb: null, followId: 0, peek: false,
    };
    for (const w of s.weapons) if (WEAPONS[w.id] && WEAPONS[w.id].kind === 'gun') w.reserve = 9999;
    if (opts.health) s.health = opts.health;
    return s;
  }

  spawnSquad(faction, x, z, task, opts = {}) {
    const g = this.game;
    const size = opts.size || GAME.squadSize;
    // mission squads far from every player wait (abstractly) until someone comes
    if (opts.mission && !opts.force && !opts.deferred && !this.nearPlayer(x, z, 650)) {
      this.deferred.push({ faction, x, z, task, opts: { ...opts, deferred: true } });
      return null;
    }
    if (!opts.force && this.combatCount() + size > g.npcCap + (opts.special ? 8 : 0)) return null;
    const sq = {
      id: this.nextSquadId++, faction, members: [], leaderId: 0, task: { ...task }, battleId: opts.battle || 0,
      mission: opts.mission || 0, special: !!opts.special, attachedTo: opts.attachedTo || null, attachedSquad: opts.attachedSquad || 0,
      spawned: g.time, original: size, alertPos: null, alertUntil: 0, retreating: false, orderedUntil: 0, lastTaskAt: g.time,
      insurgent: !!opts.insurgent, noPlayerSince: g.time, tid: opts.tid || null, garrison: null,
    };
    for (let i = 0; i < size; i++) {
      const kit = opts.kits ? opts.kits[i % opts.kits.length] : SQUAD_ROLES[i % SQUAD_ROLES.length];
      const a = (i / size) * Math.PI * 2;
      const s = this.spawnSoldier(faction, x + Math.cos(a) * 2.5, z + Math.sin(a) * 2.5, { kit, mission: opts.mission, tid: opts.tid, skill: opts.insurgent ? this.rng.float(0.2, 0.45) : undefined });
      if (!s) continue;
      s.npc.squad = sq.id;
      s.squadId = 100 + (sq.id % 150);
      sq.members.push(s.id);
    }
    if (!sq.members.length) return null;
    sq.leaderId = sq.members[0];
    this.squads.set(sq.id, sq);
    this.assignSquadTask(sq, sq.task);
    return sq;
  }

  despawn(s) {
    const g = this.game;
    if (!s) return;
    const sq = s.npc ? this.squads.get(s.npc.squad) : null;
    if (sq) this.removeMember(sq, s.id);
    g.removeEntity(s);
  }

  removeMember(sq, id) {
    sq.members = sq.members.filter((m) => m !== id);
    if (sq.leaderId === id) sq.leaderId = sq.members.find((m) => {
      const e = this.game.get(m);
      return e && e.life === LIFE.ALIVE;
    }) || sq.members[0] || 0;
    if (!sq.members.length) {
      this.squads.delete(sq.id);
      if (sq.attachedSquad) {
        const ps = this.game.squads.get(sq.attachedSquad);
        if (ps) ps.npcs = [];
      }
    }
  }

  disbandSquad(sq) {
    for (const id of [...sq.members]) {
      const s = this.game.get(id);
      if (s) this.game.removeEntity(s);
    }
    this.squads.delete(sq.id);
  }

  // Spawn location for reinforcements heading to (x,z): nearest friendly anchor,
  // or the edge of the target territory on the friendly side.
  reinforcementOrigin(faction, x, z) {
    const g = this.game;
    const t = g.territoryAt(x, z);
    if (t && g.war.ownerOf(t.id) === faction && !t.isBase) {
      return { x: t.commandPost.x + this.rng.float(-8, 8), z: t.commandPost.z + this.rng.float(-8, 8) };
    }
    if (t && t.entries && t.entries.length) {
      // entry closest to something we own
      let best = null;
      let bd = Infinity;
      for (const e of t.entries) {
        let d = Infinity;
        for (const a of t.adjacent) {
          if (g.war.ownerOf(a) !== faction) continue;
          const at = g.world.tById[a];
          d = Math.min(d, dist2D(e.x, e.z, at.x, at.z));
        }
        if (d === Infinity) d = dist2D(e.x, e.z, g.world.bases[faction].x, g.world.bases[faction].z);
        // avoid spawning in sight of hostile players
        if (this.hostilePlayersNear(e.x, e.z, 70, faction)) d += 10000;
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      if (best) return { x: best.x, z: best.z };
    }
    const b = g.world.bases[faction];
    return { x: b.spawns[0].x, z: b.spawns[0].z };
  }

  hostilePlayersNear(x, z, r, faction) {
    return this.game.soldiersNear(x, z, r, (s) => s.isPlayer && areHostile(s.faction, faction) && s.life !== LIFE.DEAD).length > 0;
  }

  deployReinforcement(faction, x, z, n, session) {
    const g = this.game;
    let ok = false;
    for (let i = 0; i < n; i++) {
      const o = this.reinforcementOrigin(faction, x, z);
      const t = g.territoryAt(x, z);
      const type = t && g.war.ownerOf(t.id) === faction ? 'defend' : 'attack';
      const sq = this.spawnSquad(faction, o.x + i * 6, o.z + i * 4, { type, x: x + this.rng.float(-10, 10), z: z + this.rng.float(-10, 10), r: 22 }, { size: 6, force: !!session, special: false });
      if (sq) {
        ok = true;
        sq.orderedUntil = g.time + 240;
        if (session) sq.orderedBy = session.id;
        const b = t ? [...g.war.battles.values()].find((bb) => bb.territory === t.id) : null;
        if (b) sq.battleId = b.id;
      }
    }
    return ok;
  }

  launchAssault(faction, tid, sid, n, missionId) {
    const g = this.game;
    const t = g.world.tById[tid];
    if (!t) return;
    const sec = t.sectors.find((s) => s.id === sid) || t.sectors[0];
    for (let i = 0; i < n; i++) {
      const o = this.reinforcementOrigin(faction, sec.x, sec.z);
      this.spawnSquad(faction, o.x + i * 5, o.z - i * 5, { type: 'attack', x: sec.x, z: sec.z, r: sec.r * 0.8, tid, sid: sec.id }, { size: 5, mission: missionId, special: !!missionId, force: true });
    }
  }

  launchBaseAssault(faction, base, n) {
    for (let i = 0; i < n; i++) {
      const a = this.rng.float(0, Math.PI * 2);
      const x = base.x + Math.cos(a) * 185;
      const z = base.z + Math.sin(a) * 150;
      this.spawnSquad(faction, x, z, { type: 'attack', x: base.x + this.rng.float(-30, 30), z: base.z - 60 + this.rng.float(-20, 20), r: 25 }, { size: 6, special: true, force: true });
    }
  }

  attachFireteam(session, squad, n) {
    const g = this.game;
    const s = session.soldier;
    if (!s) return false;
    const existing = this.followerSquadOf(squad);
    if (existing) this.disbandSquad(existing);
    const back = dirFromYawPitch(s.yaw, 0);
    const x = s.x - back.x * 14;
    const z = s.z - back.z * 14;
    const sq = this.spawnSquad(s.faction, x, z, { type: 'follow', targetId: s.id, r: 6 }, { size: n, force: true, attachedTo: session.id, attachedSquad: squad.id, kits: ['rifleman', 'support', 'medic', 'rifleman', 'engineer'] });
    if (!sq) return false;
    squad.npcs = [...sq.members];
    for (const id of sq.members) {
      const e = g.get(id);
      if (e) e.squadId = squad.id;
    }
    g.radio(s.faction, 'squad', squad.name, `Fireteam of ${sq.members.length} attached to ${session.name}.`, { squad: squad.id });
    return true;
  }

  releaseFollowers(playerSquad) {
    const sq = this.followerSquadOf(playerSquad);
    if (sq) {
      sq.attachedTo = null;
      sq.attachedSquad = 0;
      sq.task = { type: 'hold', x: this.squadCentroid(sq)?.x || 0, z: this.squadCentroid(sq)?.z || 0, r: 15 };
    }
  }

  spawnCaptive(faction, x, z, missionId) {
    const s = this.spawnSoldier(faction, x, z, { kit: 'rifleman', captive: true, mission: missionId, state: 'captive' });
    if (!s) return null;
    s.weapons = [makeWeaponState('p9')];
    s.stance = STANCE.CROUCH;
    s.npc.state = 'captive';
    return s;
  }

  freeCaptive(c, rescuer) {
    c.captive = false;
    c.infoVersion++;
    c.npc.state = 'follow';
    c.npc.followId = rescuer.id;
    c.npc.rescuer = rescuer.player ? rescuer.player.id : null;
    c.stance = STANCE.STAND;
  }

  spawnVip(faction, x, z, dest, missionId, name) {
    const s = this.spawnSoldier(faction, x, z, { kit: 'rifleman', vip: true, mission: missionId, name, rank: 16, armor: 60, health: 100, state: 'vip' });
    if (!s) return null;
    s.weapons = [makeWeaponState('p9')];
    s.npc.state = 'vip';
    s.npc.dest = dest;
    s.headgear = 'beret';
    return s;
  }

  releaseMissionSquads(missionId) {
    this.deferred = this.deferred.filter((d) => d.opts.mission !== missionId);
    for (const sq of this.squads.values()) if (sq.mission === missionId) {
      sq.mission = 0;
      sq.special = false;
    }
  }

  // ------------------------------------------------------------------ tasks
  assignSquadTask(sq, task) {
    sq.task = { ...task };
    sq.lastTaskAt = this.game.time;
    let i = 0;
    for (const id of sq.members) {
      const s = this.game.get(id);
      if (!s || !s.npc) continue;
      s.npc.holdPos = null;
      s.npc.slotIndex = i++;
      s.npc.repathAt = 0;
    }
  }

  applyOrder(sq, order) {
    const g = this.game;
    let task;
    switch (order.type) {
      case 'attack': task = { type: 'attack', x: order.x, z: order.z, r: 20 }; break;
      case 'defend': task = { type: 'defend', x: order.x, z: order.z, r: 22 }; break;
      case 'hold': task = { type: 'hold', x: order.x, z: order.z, r: 14 }; break;
      case 'move': task = { type: 'move', x: order.x, z: order.z, r: 10 }; break;
      case 'follow': task = { type: 'follow', targetId: order.issuerEntity, r: 6 }; break;
      case 'regroup': task = { type: 'move', x: order.x, z: order.z, r: 8 }; break;
      case 'escort': task = order.targetId ? { type: 'follow', targetId: order.targetId, r: 10 } : { type: 'move', x: order.x, z: order.z, r: 10 }; break;
      case 'retreat': task = { type: 'retreat', x: order.x, z: order.z, r: 15 }; break;
      case 'reinforce': task = { type: 'defend', x: order.x, z: order.z, r: 26 }; break;
      default: return;
    }
    sq.orderedUntil = order.expiresAt;
    sq.orderedBy = order.issuer;
    this.assignSquadTask(sq, task);
    const leader = g.get(sq.leaderId);
    if (leader) this.callout(leader, order.type === 'retreat' ? 'retreat' : 'move');
  }

  // ------------------------------------------------------------------ director
  playerPoints() {
    const out = [];
    for (const sess of this.game.sessions) {
      const s = sess.soldier;
      const p = s && s.life !== LIFE.DEAD ? s : sess.viewPos;
      if (p) out.push({ x: p.x, z: p.z, faction: sess.faction });
    }
    return out;
  }

  nearestPlayerDist(x, z, pts) {
    let d = Infinity;
    for (const p of pts) {
      const dd = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (dd < d) d = dd;
    }
    return Math.sqrt(d);
  }

  liveCount(tid, f) {
    return this.live.get(`${tid}:${f}`) || 0;
  }

  director() {
    const g = this.game;
    const war = g.war;
    const pts = this.playerPoints();
    const load = g.load || 0;
    // simulation level per soldier + materialised counts per territory/side
    this.live.clear();
    const nearR = GAME.aiNearPlayerRadius;
    const midR = GAME.aiMidRadius;
    for (const s of g.soldiers) {
      const b = s.npc;
      if (!b || b.kind === 'ambient') continue;
      const d = this.nearestPlayerDist(s.x, s.z, pts);
      b.lod = d < nearR ? 0 : d < midR ? 1 : 2;
      b.far = b.lod > 0;
      if (b.tid && s.life !== LIFE.DEAD) {
        const k = `${b.tid}:${s.faction}`;
        this.live.set(k, (this.live.get(k) || 0) + 1);
      }
    }
    // live battles: both sides materialise from their battalions
    for (const b of war.battles.values()) {
      if (!b.live) continue;
      const w = war.get(b.territory);
      const t = w.def;
      const near = pts.filter((p) => dist2D(p.x, p.z, t.x, t.z) < t.radius * 2);
      for (const f of [b.attacker, b.defender]) {
        const attacking = f === b.attacker;
        const own = near.filter((p) => p.faction === f).length;
        const foe = near.filter((p) => areHostile(p.faction, f)).length;
        const off = g.commands.offensiveFor(f);
        let want = WAR.liveSquadsPerSide + (attacking ? 0 : WAR.liveSquadsDefenderBonus) + (off && off.territory === t.id ? 1 : 0);
        want += Math.min(2, Math.floor(foe / 4)) - Math.floor(own / 3) - (load >= 1 ? 1 : 0) - (load >= 3 ? 1 : 0);
        if (!near.length) want = Math.min(want, 2);
        want = clamp(want, 1, 5);
        const mine = [...this.squads.values()].filter((sq) => sq.battleId === b.id && sq.faction === f && this.aliveCount(sq) >= 2);
        const pool = war.strengthAt(t.id, f, attacking ? ['attacking'] : null) - this.liveCount(t.id, f);
        const key = `${b.id}:${f}`;
        if (mine.length < want && pool >= 3 && (this.reinforceAt.get(key) || 0) <= g.time) {
          this.reinforceAt.set(key, g.time + (mine.length === 0 ? 4 : GAME.reinforceInterval));
          const o = attacking ? this.reinforcementOrigin(f, t.x, t.z) : this.defenderOrigin(t, f);
          const size = Math.min(GAME.squadSize, Math.floor(pool));
          const sq = this.spawnSquad(f, o.x, o.z, { type: 'idle' }, { battle: b.id, size, tid: t.id });
          if (sq) this.battleTask(sq, b);
        }
        for (const sq of mine) {
          if (sq.orderedUntil > g.time) continue;
          if (g.time - sq.lastTaskAt > 25 || !sq.task || sq.task.type === 'idle') this.battleTask(sq, b);
        }
      }
    }
    // garrisons: quiet territories near players get patrols from their garrison
    this.garrisonTimer += 2;
    if (this.garrisonTimer >= 6) {
      this.garrisonTimer = 0;
      const radius = WAR.liveRadius - (load >= 2 ? 150 : 0);
      for (const w of war.map.values()) {
        if (w.isBase || war.battleAt(w.id) || !w.owner) continue;
        const t = w.def;
        if (!pts.some((p) => dist2D(p.x, p.z, t.x, t.z) < t.radius + radius)) continue;
        const has = [...this.squads.values()].filter((sq) => sq.garrison === t.id).length;
        const want = load >= 2 ? 1 : WAR.garrisonSquads;
        const pool = war.strengthAt(t.id, w.owner) - this.liveCount(t.id, w.owner);
        if (has >= want || pool < 4) continue;
        const pts2 = w.sectors.map((x) => ({ x: x.def.x, z: x.def.z }));
        const start = this.rng.pick(pts2);
        const sq = this.spawnSquad(w.owner, start.x + this.rng.float(-15, 15), start.z + this.rng.float(-15, 15), { type: 'patrol', points: this.rng.chance(0.5) ? pts2 : [...pts2].reverse(), idx: 0, r: 12 }, { size: 4, tid: t.id });
        if (sq) sq.garrison = t.id;
      }
    }
    // deferred mission squads appear when a player approaches
    if (this.deferred.length) {
      this.deferred = this.deferred.filter((d) => {
        const m = d.opts.mission ? g.missions.get(d.opts.mission) : null;
        if (!m || m.status !== 'active') return false;
        if (this.nearestPlayerDist(d.x, d.z, pts) > 650) return true;
        this.spawnSquad(d.faction, d.x, d.z, d.task, d.opts);
        return false;
      });
    }
    // dematerialise squads that nobody is near any more
    for (const sq of [...this.squads.values()]) {
      if (sq.special || sq.attachedTo || sq.orderedUntil > g.time) continue;
      const c = this.squadCentroid(sq);
      if (!c) {
        this.squads.delete(sq.id);
        continue;
      }
      const nearD = this.nearestPlayerDist(c.x, c.z, pts);
      if (nearD < 560) sq.noPlayerSince = g.time;
      const battle = sq.battleId ? war.battles.get(sq.battleId) : null;
      // a garrison caught up in a new battle joins it
      if (!battle && sq.garrison) {
        const b = war.battleAt(sq.garrison);
        if (b && b.live && (sq.faction === b.attacker || sq.faction === b.defender)) {
          sq.battleId = b.id;
          sq.garrison = null;
          this.battleTask(sq, b);
          continue;
        }
      }
      const idleFor = g.time - sq.noPlayerSince;
      if (battle && !battle.live && nearD > 300) this.disbandSquad(sq);
      else if (idleFor > (battle ? 60 : 30)) this.disbandSquad(sq);
      else if (!battle && sq.battleId) {
        sq.battleId = 0;
        this.assignSquadTask(sq, { type: 'hold', x: c.x, z: c.z, r: 15 });
      } else if (sq.garrison && war.ownerOf(sq.garrison) !== sq.faction && !war.battleAt(sq.garrison)) {
        // territory changed hands: survivors fall back
        const home = g.commands.nearestFriendlyAnchor(sq.faction, c.x, c.z);
        sq.garrison = null;
        this.assignSquadTask(sq, { type: 'retreat', x: home.x, z: home.z, r: 20 });
      }
    }
    // hard cap: trim far squads if the adaptive cap dropped
    let count = this.combatCount();
    if (count > g.npcCap + 6) {
      const list = [...this.squads.values()].filter((sq) => !sq.special && !sq.attachedTo).map((sq) => {
        const c = this.squadCentroid(sq);
        return { sq, d: c ? this.nearestPlayerDist(c.x, c.z, pts) : 1e9 };
      }).sort((a, b) => b.d - a.d);
      for (const { sq, d } of list) {
        if (count <= g.npcCap || d < 250) break;
        count -= sq.members.length;
        this.disbandSquad(sq);
      }
    }
  }

  // An NCO recruits a soldier (base staff) into their squad's attached fireteam.
  recruitFollower(session, npc) {
    const g = this.game;
    const ps = session.soldier;
    if (!ps) return false;
    let squad = session.squadId ? g.squads.get(session.squadId) : null;
    if (!squad) {
      g.squads.onMessage(session, { a: 'create' });
      squad = session.squadId ? g.squads.get(session.squadId) : null;
    }
    if (!squad) return false;
    let fsq = this.followerSquadOf(squad);
    const cap = Math.max(2, rankFollowerCap(session.rankIndex));
    if (fsq && fsq.members.length >= cap) return false;
    npc.ambient = false;
    npc.activity = 0;
    npc.staff = 0;
    npc.title = '';
    npc.npc.kind = 'combat';
    npc.npc.amb = null;
    npc.npc.post = null;
    if (npc.weapons.length < 2) npc.weapons = [makeWeaponState('ar7'), makeWeaponState('p9')];
    for (const w of npc.weapons) if (WEAPONS[w.id] && WEAPONS[w.id].kind === 'gun') w.reserve = 9999;
    if (!fsq) {
      fsq = {
        id: this.nextSquadId++, faction: npc.faction, members: [], leaderId: npc.id, task: { type: 'follow', targetId: ps.id, r: 6 },
        battleId: 0, mission: 0, special: true, attachedTo: session.id, attachedSquad: squad.id, spawned: g.time, original: 1,
        alertPos: null, alertUntil: 0, retreating: false, orderedUntil: 0, lastTaskAt: g.time, noPlayerSince: g.time, tid: null, garrison: null,
      };
      this.squads.set(fsq.id, fsq);
    }
    fsq.members.push(npc.id);
    fsq.original = fsq.members.length;
    npc.npc.squad = fsq.id;
    npc.squadId = squad.id;
    npc.infoVersion++;
    squad.npcs = [...fsq.members];
    this.assignSquadTask(fsq, { type: 'follow', targetId: ps.id, r: 6 });
    return true;
  }

  aliveCount(sq) {
    let n = 0;
    for (const id of sq.members) {
      const s = this.game.get(id);
      if (s && s.life === LIFE.ALIVE) n++;
    }
    return n;
  }

  defenderOrigin(t, f) {
    const g = this.game;
    const w = g.war.get(t.id);
    const held = w.sectors.filter((s) => s.owner === f);
    const s = held.length ? this.rng.pick(held).def : t.commandPost;
    if (this.hostilePlayersNear(s.x, s.z, 60, f)) return this.reinforcementOrigin(f, t.x, t.z);
    return { x: s.x + this.rng.float(-20, 20), z: s.z + this.rng.float(-20, 20) };
  }

  battleTask(sq, b) {
    const g = this.game;
    const w = g.war.get(b.territory);
    const f = sq.faction;
    const c = this.squadCentroid(sq) || { x: w.def.x, z: w.def.z };
    let cands;
    if (f === b.attacker) cands = w.sectors.filter((s) => s.owner !== f);
    else {
      cands = w.sectors.filter((s) => s.owner === f && (s.contested || s.moving !== 0));
      if (!cands.length) cands = w.sectors.filter((s) => s.owner !== f);
      if (!cands.length) cands = w.sectors;
    }
    if (!cands.length) cands = w.sectors;
    // spread squads over objectives, preferring close ones
    const load = new Map();
    for (const other of this.squads.values()) {
      if (other === sq || other.faction !== f || !other.task || !other.task.sid) continue;
      load.set(other.task.sid, (load.get(other.task.sid) || 0) + 1);
    }
    let best = null;
    let bs = Infinity;
    for (const s of cands) {
      const score = dist2D(c.x, c.z, s.def.x, s.def.z) + (load.get(s.id) || 0) * 120 + this.rng.float(0, 40);
      if (score < bs) {
        bs = score;
        best = s;
      }
    }
    const type = f === b.attacker || best.owner !== f ? 'attack' : 'defend';
    this.assignSquadTask(sq, { type, x: best.def.x, z: best.def.z, r: best.def.r * 0.8, tid: w.id, sid: best.id });
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const g = this.game;
    this.directorTimer += dt;
    if (this.directorTimer >= 2) {
      this.directorTimer = 0;
      this.director();
    }
    this.pathBudget = GAME.aiPathBudgetPerTick - ((g.load || 0) >= 2 ? 1 : 0);
    const midStep = g.tickCount % 4 === 0;
    const lightStep = g.tickCount % 8 === 0;
    const thinkMult = 1 + (g.load || 0) * 0.35;
    for (const s of g.soldiers) {
      const b = s.npc;
      if (!b || b.kind === 'ambient') continue;
      if (s.life === LIFE.DEAD) continue;
      if (s.vehicle) {
        this.thinkInVehicle(s);
        continue;
      }
      if (g.time >= b.nextThink) {
        const iv = b.lod === 0 ? GAME.aiThinkInterval : b.lod === 1 ? GAME.aiFarThinkInterval * thinkMult : GAME.aiLightThinkInterval * thinkMult;
        b.nextThink = g.time + iv * this.rng.float(0.85, 1.15);
        if (s.life === LIFE.ALIVE) this.think(s);
      }
      if (s.life === LIFE.DOWNED) continue;
      if (b.lod === 0) this.move(s, dt, false);
      else if (b.lod === 1 ? midStep : lightStep) this.move(s, dt * (b.lod === 1 ? 4 : 8), true);
      if (s.life === LIFE.ALIVE && b.target && (b.lod === 0 || (b.lod === 1 && midStep))) this.combatTick(s);
    }
  }

  // ------------------------------------------------------------------ brain
  think(s) {
    const g = this.game;
    const b = s.npc;
    const sq = this.squads.get(b.squad);
    // special states
    if (b.state === 'captive') {
      s.stance = STANCE.CROUCH;
      b.moveTarget = null;
      return;
    }
    if (b.state === 'vip') return this.thinkVip(s);
    if (b.state === 'follow' && b.followId) return this.thinkFollowEntity(s, b.followId, 4);
    // grenade avoidance
    for (const p of g.projectiles) {
      if (p.type !== 'frag' || !areHostile(p.faction, s.faction)) continue;
      const d = dist2D(p.x, p.z, s.x, s.z);
      if (d < 7 && p.fuseAt - g.time < 3) {
        const ax = s.x - p.x;
        const az = s.z - p.z;
        const l = Math.hypot(ax, az) || 1;
        this.setMove(s, s.x + (ax / l) * 9, s.z + (az / l) * 9, true);
        b.sprint = true;
        this.callout(s, 'grenade');
        return;
      }
    }
    this.perceive(s);
    const tgt = b.target ? g.get(b.target) : null;
    // medics prioritise downed friends when not under direct threat
    if (s.role === 'medic' && (!tgt || dist2D(tgt.x, tgt.z, s.x, s.z) > 45)) {
      const down = g.soldiersNear(s.x, s.z, 35, (e) => e.faction === s.faction && e.life === LIFE.DOWNED)[0];
      if (down) {
        const d = dist2D(down.x, down.z, s.x, s.z);
        if (d < 2.2) {
          if (!s.action) {
            s.action = { type: 'revive', target: down.id, start: g.time, end: g.time + 3.2, x: s.x, z: s.z, last: g.time };
            s.stance = STANCE.CROUCH;
          }
          b.moveTarget = null;
          b.path = null;
        } else this.setMove(s, down.x, down.z, true);
        return;
      }
    }
    if (tgt) {
      this.thinkCombat(s, tgt, sq);
      return;
    }
    // investigate recent contacts
    if (b.lastKnown && g.time - b.targetSeenAt < 12) {
      s.stance = STANCE.CROUCH;
      this.setMove(s, b.lastKnown.x, b.lastKnown.z, false);
      return;
    }
    if (sq && sq.alertPos && sq.alertUntil > g.time && dist2D(s.x, s.z, sq.alertPos.x, sq.alertPos.z) < 90 && sq.task.type !== 'follow') {
      s.stance = STANCE.CROUCH;
      this.setMove(s, sq.alertPos.x + this.rng.float(-6, 6), sq.alertPos.z + this.rng.float(-6, 6), false);
      return;
    }
    if (s.stance !== STANCE.STAND && g.time - b.targetSeenAt > 8) s.stance = STANCE.STAND;
    this.thinkTask(s, sq);
  }

  perceive(s) {
    const g = this.game;
    const b = s.npc;
    const vis = g.weather.visibility();
    const range = GAME.aiDetectRange * vis * (b.far ? 0.8 : 1);
    const eye = { x: s.x, y: s.y + eyeHeight(s.stance), z: s.z };
    // keep current target if still visible
    if (b.target) {
      const t = g.get(b.target);
      if (!t || (t.k === 1 && (t.life !== LIFE.ALIVE || t.captive)) || (t.k === 2 && t.state === 3)) {
        b.target = 0;
      } else {
        const tp = this.targetPoint(t);
        if (dist2D(t.x, t.z, s.x, s.z) < range * 1.3 && g.combat.losClear(eye.x, eye.y, eye.z, tp.x, tp.y, tp.z)) {
          b.targetSeenAt = g.time;
          b.lastKnown = { x: t.x, z: t.z };
          return;
        }
        b.target = 0;
      }
    }
    const cands = [];
    g.spatial.query(s.x, s.z, range, (e) => {
      if (e.k === 1) {
        if (e.life !== LIFE.ALIVE || !areHostile(e.faction, s.faction) || e.captive || (e.ambient && !e.combatReady)) return;
        if (e.vehicle && !this.exposed(e)) return;
      } else if (e.k === 2) {
        if (e.state === 3 || !areHostile(e.faction, s.faction) || !e.seats.some((x) => x)) return;
      } else return;
      const d = dist2D(e.x, e.z, s.x, s.z);
      let eff = range;
      if (e.k === 1) {
        if (e.stance === STANCE.PRONE) eff *= 0.45;
        else if (e.stance === STANCE.CROUCH) eff *= 0.75;
        if (e.spottedUntil > g.time) eff *= 1.6;
        if (e.firingUntil > g.time) eff *= 1.8;
        if (g.combat.inSmoke(e.x, e.z)) eff *= 0.2;
      } else eff *= 1.5;
      if (d > eff) return;
      cands.push({ e, d });
    });
    if (!cands.length) return;
    cands.sort((a, c) => a.d - c.d);
    const checks = b.far ? 1 : 2;
    for (let i = 0; i < Math.min(checks, cands.length); i++) {
      const e = cands[i].e;
      const tp = this.targetPoint(e);
      if (!g.combat.losClear(eye.x, eye.y, eye.z, tp.x, tp.y, tp.z)) continue;
      const fresh = b.target !== e.id;
      b.target = e.id;
      b.targetSeenAt = g.time;
      b.lastKnown = { x: e.x, z: e.z };
      if (fresh) {
        b.reactionAt = g.time + this.rng.float(0.35, 0.9) * (1.3 - b.skill);
        this.callout(s, e.k === 2 ? 'vehicle' : 'contact');
        const sq = this.squads.get(b.squad);
        if (sq) {
          sq.alertPos = { x: e.x, z: e.z };
          sq.alertUntil = g.time + 20;
        }
      }
      return;
    }
  }

  exposed(e) {
    const v = this.game.get(e.vehicle);
    if (!v) return true;
    const seat = v.def.seats[e.seat];
    return v.def.armor === 'light' || (seat && seat.cupola);
  }

  targetPoint(e) {
    if (e.k === 2) return { x: e.x, y: e.y + 1, z: e.z };
    if (e.stance === STANCE.PRONE || e.life === LIFE.DOWNED) return { x: e.x, y: e.y + 0.35, z: e.z };
    return { x: e.x, y: e.y + (e.stance === STANCE.CROUCH ? 0.95 : 1.35), z: e.z };
  }

  thinkCombat(s, tgt, sq) {
    const g = this.game;
    const b = s.npc;
    const d = dist2D(tgt.x, tgt.z, s.x, s.z);
    b.sprint = false;
    // retreat when the squad is shattered or badly hurt
    if (sq && !sq.retreating && sq.original >= 3 && this.aliveCount(sq) <= Math.floor(sq.original * 0.35) && sq.task.type === 'attack' && !sq.attachedTo) {
      sq.retreating = true;
      const home = g.commands.nearestFriendlyAnchor(s.faction, s.x, s.z);
      this.assignSquadTask(sq, { type: 'retreat', x: home.x, z: home.z, r: 18 });
      this.callout(s, 'retreat');
    }
    if (sq && sq.task.type === 'retreat' && !sq.attachedTo) {
      this.setMove(s, sq.task.x, sq.task.z, true);
      b.sprint = true;
      return;
    }
    // cover selection
    const wantCover = s.suppression > 0.25 || s.health < 65 || d > 22;
    const cp = b.cover >= 0 ? g.world.cover.points[b.cover] : null;
    const coverGood = cp && this.coverProtects(cp, tgt);
    if (wantCover && !coverGood && g.time > b.coverUntil) {
      const best = this.findCover(s, tgt, 18);
      b.coverUntil = g.time + 3;
      if (best >= 0) {
        this.releaseCover(s);
        b.cover = best;
        const p = g.world.cover.points[best];
        p.occupied = s.id;
        this.setMove(s, p.x, p.z, true);
        b.sprint = d > 12;
      }
    }
    const inCover = cp && dist2D(cp.x, cp.z, s.x, s.z) < 1.4 && coverGood;
    if (inCover) {
      b.moveTarget = null;
      b.path = null;
      // peek cycle: low cover -> crouch/stand, high cover -> stand
      b.crouchT -= GAME.aiThinkInterval;
      if (cp.low) {
        if (b.crouchT <= 0) {
          b.crouchT = this.rng.float(1.2, 3);
          b.peek = !b.peek;
        }
        s.stance = b.peek || s.suppression < 0.4 ? STANCE.CROUCH : STANCE.PRONE;
      } else s.stance = STANCE.STAND;
    } else if (!b.moveTarget) {
      // no cover: advance or hold depending on the task
      if (sq && sq.task.type === 'attack' && d > 35) {
        const ax = tgt.x - s.x;
        const az = tgt.z - s.z;
        this.setMove(s, s.x + (ax / d) * 10 + this.rng.float(-4, 4), s.z + (az / d) * 10 + this.rng.float(-4, 4), false);
        s.stance = STANCE.STAND;
      } else if (d > 45 && b.skill > 0.5) s.stance = STANCE.PRONE;
      else s.stance = STANCE.CROUCH;
    }
    // grenades against clustered or covered enemies
    if (tgt.k === 1 && d > 10 && d < 32 && g.time > b.grenadeAt) {
      const frag = s.weapons.find((w) => w.id === 'frag' && w.count > 0);
      const cluster = g.soldiersNear(tgt.x, tgt.z, 5, (e) => areHostile(e.faction, s.faction) && e.life === LIFE.ALIVE).length;
      if (frag && (cluster >= 2 || this.rng.chance(0.18))) {
        b.grenadeAt = g.time + this.rng.float(25, 45);
        this.throwGrenade(s, tgt, frag);
      } else b.grenadeAt = g.time + 6;
    }
  }

  coverProtects(cp, tgt) {
    const dx = tgt.x - cp.x;
    const dz = tgt.z - cp.z;
    const l = Math.hypot(dx, dz) || 1;
    return (dx / l) * cp.nx + (dz / l) * cp.nz > 0.35;
  }

  findCover(s, tgt, r) {
    const g = this.game;
    let best = -1;
    let bs = Infinity;
    const td = dist2D(tgt.x, tgt.z, s.x, s.z);
    g.world.cover.near(s.x, s.z, r, (p, idx) => {
      if (p.occupied && p.occupied !== s.id) {
        const o = g.get(p.occupied);
        if (o && o.life !== LIFE.DEAD && o.npc && o.npc.cover === idx) return;
      }
      if (!this.coverProtects(p, tgt)) return;
      const dd = dist2D(p.x, p.z, tgt.x, tgt.z);
      if (dd < 6) return;
      const score = dist2D(p.x, p.z, s.x, s.z) + Math.max(0, dd - td) * 0.4 + (p.low ? 0 : 2);
      if (score < bs) {
        bs = score;
        best = idx;
      }
    });
    return best;
  }

  releaseCover(s) {
    const b = s.npc;
    if (b.cover >= 0) {
      const p = this.game.world.cover.points[b.cover];
      if (p && p.occupied === s.id) p.occupied = 0;
    }
    b.cover = -1;
  }

  // Per-tick shooting for NPCs with a target (near LOD only).
  combatTick(s) {
    const g = this.game;
    const b = s.npc;
    const tgt = g.get(b.target);
    if (!tgt || g.time < b.reactionAt || s.action) return;
    if (g.time - b.targetSeenAt > 0.6) return;
    // face the target
    const tp = this.targetPoint(tgt);
    const aimYaw = yawFromDir(tp.x - s.x, tp.z - s.z);
    s.yaw = approachAngle(s.yaw, aimYaw, 7 * (1 / 20));
    if (Math.abs(angleDiff(s.yaw, aimYaw)) > 0.35) return;
    // weapon choice: rockets for vehicles
    let ws = s.weapons[0];
    if (tgt.k === 2) {
      const rl = s.weapons.find((w) => w.id === 'rl3');
      if (rl && g.time > b.rocketAt && dist2D(tgt.x, tgt.z, s.x, s.z) < 140) {
        b.rocketAt = g.time + 9;
        const eye = { x: s.x, y: s.y + eyeHeight(s.stance), z: s.z };
        const d = norm(tp.x - eye.x, tp.y - eye.y + 0.5, tp.z - eye.z);
        g.combat.fireProjectile(s, 'rocket', eye, spreadDir(d, 1.5, () => this.rng.next()), WEAPONS.rl3);
        g.emit(['shot', s.id, 0, r1(eye.x), r1(eye.y), r1(eye.z), r1(tp.x), r1(tp.y), r1(tp.z), 9, 0], { pos: eye, range: 650 });
        return;
      }
      if (this.game.get(tgt.id) && tgt.def.armor !== 'light') return;
    }
    const w = WEAPONS[ws.id];
    if (!w || w.kind !== 'gun') return;
    if (s.reloadUntil > g.time) return;
    if (ws.mag <= 0) {
      s.reloadUntil = g.time + w.reload * 1.1;
      ws.mag = w.mag;
      this.callout(s, 'reload');
      return;
    }
    if (g.time < b.nextShot) return;
    const interval = 60 / w.rpm;
    if (b.burst <= 0) {
      b.burst = w.auto ? this.rng.int(3, 6) : w.burst ? 3 : this.rng.int(1, 3);
    }
    b.burst--;
    b.nextShot = g.time + (b.burst > 0 ? interval : this.rng.float(0.45, 1.2) * (w.auto ? 1 : 1.4));
    if (b.burst <= 0 && !w.auto && !w.burst) b.nextShot += 0.3;
    ws.mag--;
    s.lastFireAt = g.time;
    s.firingUntil = g.time + 0.3;
    // accuracy model
    const dist = dist2D(tp.x, tp.z, s.x, s.z);
    const tspeed = tgt.k === 1 ? Math.hypot(tgt.vx || 0, tgt.vz || 0) : Math.abs(tgt.speed || 0);
    let err = 2.8 * (1.25 - b.skill) + dist * 0.018 + tspeed * 0.22 + s.suppression * 3.5;
    err *= s.stance === STANCE.PRONE ? 0.7 : s.stance === STANCE.CROUCH ? 0.85 : 1;
    err *= 1 / Math.max(0.5, g.weather.visibility());
    err *= 1 / GAME.aiAccuracy;
    if (b.far) err *= 1.5;
    const eye = { x: s.x, y: s.y + eyeHeight(s.stance), z: s.z };
    const head = tgt.k === 1 && this.rng.chance(0.08 + b.skill * 0.1);
    const aim = tgt.k === 1 ? g.combat.aimPointOf(tgt, head) : tp;
    const d = norm(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z);
    g.combat.fireHitscan(s, eye, spreadDir(d, err * 0.5 + w.spreadAds, () => this.rng.next()), w, {});
  }

  throwGrenade(s, tgt, frag) {
    const g = this.game;
    frag.count--;
    const dx = tgt.x - s.x;
    const dz = tgt.z - s.z;
    const d = Math.hypot(dx, dz);
    // simple ballistic solution for ~45 degree throw
    const v = Math.min(20, Math.sqrt(d * 19 * 0.95));
    const dir = { x: (dx / d) * 0.707, y: 0.707, z: (dz / d) * 0.707 };
    g.addProjectile('frag', {
      x: s.x, y: s.y + 1.6, z: s.z, vx: dir.x * v, vy: dir.y * v, vz: dir.z * v,
      ownerId: s.id, faction: s.faction, weaponId: 'frag', fuseAt: g.time + 3.2,
    });
    this.callout(s, 'grenade');
  }

  thinkTask(s, sq) {
    const g = this.game;
    const b = s.npc;
    if (!sq) {
      b.moveTarget = null;
      return;
    }
    const task = sq.task;
    const leader = g.get(sq.leaderId);
    const isLeader = leader === s;
    b.sprint = false;
    switch (task.type) {
      case 'follow': {
        const tgt = g.get(task.targetId) || (sq.attachedTo && g.byProfile.get(sq.attachedTo) && g.byProfile.get(sq.attachedTo).soldier);
        if (!tgt || tgt.life === LIFE.DEAD) {
          // leader of attached fireteam is gone: hold here
          b.moveTarget = null;
          s.stance = STANCE.CROUCH;
          if (sq.attachedTo) {
            const sess = g.byProfile.get(sq.attachedTo);
            if (sess && sess.soldier && sess.soldier.life !== LIFE.DEAD) task.targetId = sess.soldier.id;
          }
          return;
        }
        this.thinkFollowEntity(s, tgt.id, 5 + (b.slotIndex || 0) * 1.6);
        return;
      }
      case 'patrol': {
        const pts = task.points;
        if (!pts || !pts.length) return;
        const p = pts[task.idx % pts.length];
        if (isLeader) {
          if (dist2D(s.x, s.z, p.x, p.z) < 10) task.idx = (task.idx + 1) % pts.length;
          this.setMove(s, p.x, p.z, false);
        } else this.formationMove(s, leader);
        return;
      }
      case 'idle':
        return;
      default:
        break;
    }
    // point tasks: attack / defend / hold / move / retreat / ambush
    const tx = task.x;
    const tz = task.z;
    const dl = dist2D(s.x, s.z, tx, tz);
    if (task.type === 'retreat' && dl < task.r + 5) {
      // regrouped: rejoin the fight later or disband
      if (!sq.attachedTo && g.time - sq.lastTaskAt > 30) {
        sq.retreating = false;
        this.assignSquadTask(sq, { type: 'defend', x: tx, z: tz, r: 20 });
      }
    }
    const leaderAt = leader && dist2D(leader.x, leader.z, tx, tz) < task.r + 12;
    if (isLeader || leaderAt || !leader || leader.life !== LIFE.ALIVE || dl < task.r + 20) {
      // take a position around the objective
      if (!b.holdPos || dist2D(b.holdPos.x, b.holdPos.z, tx, tz) > task.r + 6) {
        b.holdPos = this.pickHoldPosition(s, tx, tz, task.type === 'attack' ? task.r * 0.7 : task.r);
      }
      const hp = b.holdPos;
      if (dist2D(s.x, s.z, hp.x, hp.z) > 1.5) {
        this.setMove(s, hp.x, hp.z, task.type === 'retreat' || dl > 60);
        b.sprint = task.type === 'retreat' || (task.type === 'attack' && dl > 40 && dl < 120);
      } else {
        b.moveTarget = null;
        b.path = null;
        s.stance = hp.cover !== undefined && hp.low ? STANCE.CROUCH : task.type === 'ambush' ? STANCE.PRONE : STANCE.STAND;
        // look out towards likely threats
        const away = yawFromDir(s.x - tx, s.z - tz);
        s.yaw = approachAngle(s.yaw, task.type === 'attack' ? away : away + this.rng.float(-0.8, 0.8), 0.3);
        if (task.type === 'attack' && g.tickCount % 60 === 0 && isLeader) this.callout(s, 'capture');
      }
    } else {
      this.formationMove(s, leader);
    }
  }

  pickHoldPosition(s, x, z, r) {
    const g = this.game;
    let best = null;
    let bs = Infinity;
    g.world.cover.near(x, z, r, (p, idx) => {
      if (p.occupied && p.occupied !== s.id) return;
      const score = this.rng.float(0, 10) + dist2D(p.x, p.z, s.x, s.z) * 0.2;
      if (score < bs) {
        bs = score;
        best = { x: p.x, z: p.z, cover: idx, low: p.low };
      }
    });
    if (best && this.rng.chance(0.75)) {
      this.releaseCover(s);
      s.npc.cover = best.cover;
      g.world.cover.points[best.cover].occupied = s.id;
      return best;
    }
    const nav = g.world.nav;
    const p = nav ? nav.randomPointNear(x, z, r, () => this.rng.next()) : { x: x + this.rng.float(-r, r), z: z + this.rng.float(-r, r) };
    return { x: p.x, z: p.z };
  }

  formationMove(s, leader) {
    if (!leader) return;
    const b = s.npc;
    const i = (b.slotIndex || 1) - 1;
    const side = i % 2 === 0 ? 1 : -1;
    const row = Math.floor(i / 2) + 1;
    const fy = leader.yaw;
    const fx = -Math.sin(fy);
    const fz = -Math.cos(fy);
    const rx = Math.cos(fy);
    const rz = -Math.sin(fy);
    const x = leader.x - fx * row * 3.5 + rx * side * row * 2.5;
    const z = leader.z - fz * row * 3.5 + rz * side * row * 2.5;
    if (dist2D(s.x, s.z, x, z) > 2.5) {
      this.setMove(s, x, z, dist2D(s.x, s.z, leader.x, leader.z) > 25);
      b.sprint = dist2D(s.x, s.z, leader.x, leader.z) > 18 || leader.sprint;
    } else {
      b.moveTarget = null;
      b.path = null;
      s.stance = leader.stance === STANCE.PRONE ? STANCE.CROUCH : leader.stance;
      s.yaw = approachAngle(s.yaw, leader.yaw + side * 0.5, 0.5);
    }
  }

  thinkFollowEntity(s, id, dist) {
    const g = this.game;
    const b = s.npc;
    const t = g.get(id);
    if (!t || t.life === LIFE.DEAD) {
      b.moveTarget = null;
      return;
    }
    if (t.vehicle) {
      // try to board the same vehicle as a passenger
      const v = g.get(t.vehicle);
      if (v && dist2D(v.x, v.z, s.x, s.z) < 8) {
        const seat = v.freeSeat((sd) => sd.role === 'passenger' || sd.role === 'gunner');
        if (seat >= 0) {
          g.vehicleSys.seat(s, v, seat);
          return;
        }
      }
    }
    const d = dist2D(s.x, s.z, t.x, t.z);
    if (d > dist) {
      const a = (b.slotIndex || 0) * 1.3;
      this.setMove(s, t.x + Math.cos(a) * 2.5, t.z + Math.sin(a) * 2.5, d > 20);
      b.sprint = d > 14 || t.sprint;
    } else {
      b.moveTarget = null;
      b.path = null;
      s.stance = t.stance === STANCE.PRONE ? STANCE.CROUCH : t.stance;
    }
  }

  thinkVip(s) {
    const g = this.game;
    const b = s.npc;
    const escorts = g.soldiersNear(s.x, s.z, 25, (e) => e.isPlayer && e.faction === s.faction && e.life === LIFE.ALIVE);
    if (!escorts.length) {
      b.moveTarget = null;
      b.path = null;
      s.stance = STANCE.CROUCH;
      if (g.tickCount % 200 === 0) this.say(s, 'I need an escort before I move!');
      return;
    }
    s.stance = STANCE.STAND;
    this.setMove(s, b.dest.x, b.dest.z, false);
  }

  thinkInVehicle(s) {
    const g = this.game;
    const v = g.get(s.vehicle);
    if (!v) return;
    const b = s.npc;
    // passengers dismount when the vehicle stops near their objective or is burning
    const sq = this.squads.get(b.squad);
    if (v.state >= 2 || (v.seats[0] !== s.id && Math.abs(v.speed) < 0.5 && sq && sq.task && sq.task.x !== undefined && dist2D(v.x, v.z, sq.task.x, sq.task.z) < 60)) {
      g.vehicleSys.ejectSoldier(s, false);
    }
    if (b.state === 'follow' && b.followId) {
      const t = g.get(b.followId);
      if (!t || !t.vehicle) g.vehicleSys.ejectSoldier(s, false);
    }
  }

  // ------------------------------------------------------------------ movement
  setMove(s, x, z, urgent) {
    const b = s.npc;
    const g = this.game;
    if (b.moveTarget && dist2D(b.moveTarget.x, b.moveTarget.z, x, z) < 2.5 && b.path) return;
    b.moveTarget = { x, z };
    const d = dist2D(s.x, s.z, x, z);
    const nav = g.world.nav;
    if (!nav || d < 6 || nav.clearWalk(s.x, s.z, x, z)) {
      b.path = [{ x, z }];
      b.pathIdx = 0;
      return;
    }
    if (this.pathBudget <= 0 && !urgent) {
      b.path = [{ x, z }];
      b.pathIdx = 0;
      b.repathAt = g.time + 0.5;
      return;
    }
    this.pathBudget--;
    this.pathCount++;
    const p = nav.findPath(s.x, s.z, x, z, b.far ? 3000 : 6000);
    b.path = p && p.length ? p : [{ x, z }];
    b.pathIdx = 0;
    b.repathAt = g.time + (p && p.coarse ? 6 : 12);
  }

  move(s, dt, far) {
    const g = this.game;
    const b = s.npc;
    const col = g.world.colliders;
    let fwd = 0;
    let right = 0;
    let wp = b.path && b.pathIdx < b.path.length ? b.path[b.pathIdx] : null;
    if (wp) {
      const dx = wp.x - s.x;
      const dz = wp.z - s.z;
      const d = Math.hypot(dx, dz);
      const last = b.pathIdx >= b.path.length - 1;
      if (d < (last ? 0.8 : 2.2)) {
        b.pathIdx++;
        if (b.pathIdx >= b.path.length) {
          b.path = null;
          if (b.moveTarget && dist2D(s.x, s.z, b.moveTarget.x, b.moveTarget.z) > 3 && b.repathAt < g.time) {
            const mt = b.moveTarget;
            b.moveTarget = null;
            this.setMove(s, mt.x, mt.z, false);
          }
        }
      } else {
        const moveYaw = yawFromDir(dx, dz);
        if (b.target && g.time - b.targetSeenAt < 1.5) {
          const rel = moveYaw - s.yaw;
          fwd = Math.cos(rel);
          right = -Math.sin(rel);
        } else {
          s.yaw = approachAngle(s.yaw, moveYaw, 6 * dt);
          const diff = Math.abs(angleDiff(s.yaw, moveYaw));
          fwd = diff < 1.2 ? 1 : 0.2;
        }
      }
    }
    const moving = fwd !== 0 || right !== 0;
    if (moving && s.stance === STANCE.PRONE && (b.sprint || !b.target)) s.stance = STANCE.CROUCH;
    if (moving && b.sprint) s.stance = STANCE.STAND;
    s.sprint = !!(b.sprint && moving && s.stance === STANCE.STAND && fwd > 0.7);
    if (far) {
      // cheap kinematic step for distant soldiers
      const speed = s.sprint ? 6 : 4;
      const len = Math.hypot(fwd, right);
      if (len > 0) {
        const fx = -Math.sin(s.yaw);
        const fz = -Math.cos(s.yaw);
        const rx = Math.cos(s.yaw);
        const rz = -Math.sin(s.yaw);
        const wx = (fx * fwd + rx * right) / len;
        const wz = (fz * fwd + rz * right) / len;
        s.vx = wx * speed;
        s.vz = wz * speed;
        const nx = s.x + s.vx * dt;
        const nz = s.z + s.vz * dt;
        const pos = { x: nx, y: s.y, z: nz };
        col.resolveCylinder(pos, 0.35, 1.8);
        s.x = pos.x;
        s.z = pos.z;
      } else {
        s.vx = 0;
        s.vz = 0;
      }
      s.y = col.groundHeight(s.x, s.z, s.y + 1);
      s.vy = 0;
      s.grounded = true;
    } else {
      stepCharacter(s, { fwd, right, sprint: s.sprint, jump: b.jump, downed: s.life === LIFE.DOWNED }, dt, col);
      b.jump = false;
    }
    // stuck detection
    if (g.time - b.lastCheck > 1.5) {
      const moved = dist2D(s.x, s.z, b.lastX, b.lastZ);
      if (wp && moved < 0.4) {
        b.stuckT++;
        if (b.stuckT === 1) b.jump = true;
        else if (b.stuckT === 2 && b.moveTarget) {
          const mt = b.moveTarget;
          b.moveTarget = null;
          b.repathAt = 0;
          this.pathBudget++;
          this.setMove(s, mt.x, mt.z, true);
        } else if (b.stuckT >= 3) {
          b.pathIdx++;
          if (b.stuckT >= 5 && g.world.nav && !this.nearPlayer(s.x, s.z, 60)) {
            const p = g.world.nav.randomPointNear(s.x, s.z, 6, () => this.rng.next());
            s.x = p.x;
            s.z = p.z;
            s.y = col.groundHeight(p.x, p.z, s.y + 3);
            b.stuckT = 0;
          }
        }
      } else b.stuckT = 0;
      b.lastX = s.x;
      b.lastZ = s.z;
      b.lastCheck = g.time;
    }
  }

  // ------------------------------------------------------------------ comms
  callout(s, kind) {
    const g = this.game;
    const b = s.npc;
    if (!b || g.time < b.calloutAt || b.far) return;
    b.calloutAt = g.time + this.rng.float(5, 9);
    const lines = CALLOUTS[kind];
    if (!lines) return;
    this.say(s, this.rng.pick(lines));
  }

  say(s, text) {
    this.game.emit(['callout', s.id, text], { pos: s, range: 55 });
  }

  // ------------------------------------------------------------------ hooks
  onGunfire(shooter, o, faction) {
    const g = this.game;
    if (!shooter) return;
    const last = this.lastGunfire.get(shooter.id) || 0;
    if (g.time - last < 0.8) return;
    this.lastGunfire.set(shooter.id, g.time);
    const range = shooter.weaponDef && shooter.weaponDef.cls === 'pistol' ? 60 : 130;
    for (const n of g.soldiersNear(o.x, o.z, range, (e) => e.npc && e.life === LIFE.ALIVE && areHostile(e.faction, faction))) {
      const sq = this.squads.get(n.npc.squad);
      if (!n.npc.target) {
        n.npc.lastKnown = { x: o.x + this.rng.float(-8, 8), z: o.z + this.rng.float(-8, 8) };
        n.npc.targetSeenAt = g.time - 4;
      }
      if (sq) {
        sq.alertPos = { x: o.x, z: o.z };
        sq.alertUntil = g.time + 15;
      }
    }
  }

  onSuppressed(e, source) {
    const b = e.npc;
    if (!b) return;
    if (e.suppression > 0.6) {
      this.callout(e, 'suppressed');
      if (b.cover < 0 && source) {
        const best = this.findCover(e, source, 14);
        if (best >= 0) {
          b.cover = best;
          this.game.world.cover.points[best].occupied = e.id;
          const p = this.game.world.cover.points[best];
          this.setMove(e, p.x, p.z, true);
          b.sprint = true;
        } else e.stance = STANCE.PRONE;
      }
    }
  }

  onDamaged(target, attacker) {
    const b = target.npc;
    if (!b || !attacker) return;
    if (!b.target || this.rng.chance(0.5)) {
      b.lastKnown = { x: attacker.x, z: attacker.z };
      b.targetSeenAt = this.game.time - 1;
      b.nextThink = Math.min(b.nextThink, this.game.time + 0.1);
    }
  }

  onDowned(target) {
    if (target.npc) {
      this.releaseCover(target);
      target.action = null;
      this.callout(target, 'down');
    }
    // nearby friendly NPCs call it out too
    const g = this.game;
    const buddy = g.soldiersNear(target.x, target.z, 20, (e) => e.npc && e.faction === target.faction && e.life === LIFE.ALIVE)[0];
    if (buddy) this.callout(buddy, 'down');
  }

  onKilled(target) {
    if (target.npc) {
      // a materialised soldier of a battalion: one real casualty
      if (target.npc.tid && target.npc.kind !== 'ambient') this.game.war.onCasualty(target.faction, target.npc.tid);
      this.releaseCover(target);
      const sq = this.squads.get(target.npc.squad);
      if (sq) {
        // keep the corpse in the world briefly but out of the squad
        this.removeMember(sq, target.id);
        const ps = sq.attachedSquad ? this.game.squads.get(sq.attachedSquad) : null;
        if (ps) ps.npcs = ps.npcs.filter((id) => id !== target.id);
      }
    }
  }

  onRevived(target) {
    if (target.npc) {
      target.npc.target = 0;
      target.stance = STANCE.CROUCH;
    }
  }

  onExplosion(x, z, r) {
    for (const n of this.game.soldiersNear(x, z, r * 3, (e) => e.npc && e.life === LIFE.ALIVE)) {
      n.suppression = Math.min(1, n.suppression + 0.4);
    }
  }

  onGrenade() {}

  onSectorChanged(w) {
    for (const sq of this.squads.values()) {
      if (sq.task && sq.task.tid === w.id && !(sq.orderedUntil > this.game.time)) sq.lastTaskAt = -1e9;
    }
  }

  onTerritoryFlipped(w) {
    this.onSectorChanged(w);
  }

  onBattleStarted() {
    this.directorTimer = 2;
  }

  onBattleEnded(b, winner) {
    const g = this.game;
    for (const sq of this.squads.values()) {
      if (sq.battleId !== b.id) continue;
      sq.battleId = 0;
      if (sq.faction !== winner && winner) {
        const home = g.commands.nearestFriendlyAnchor(sq.faction, g.world.tById[b.territory].x, g.world.tById[b.territory].z);
        this.assignSquadTask(sq, { type: 'retreat', x: home.x, z: home.z, r: 20 });
      }
    }
  }

  onCampaignReset() {
    for (const sq of [...this.squads.values()]) if (!sq.attachedTo) this.disbandSquad(sq);
  }
}

function norm(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}
function r1(v) {
  return Math.round(v * 10) / 10;
}

export { HEALTH, PROP_KIND, enemyOf, clamp };
