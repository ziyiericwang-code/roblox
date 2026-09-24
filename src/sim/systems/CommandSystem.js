// Command hierarchy: contextual orders from leaders/officers to units under them,
// leadership rewards for following-through, and rank-gated officer abilities
// limited by per-player cooldowns and the faction's shared Command Points.
import { LIFE, PROP_KIND, HEALTH } from '../../shared/constants.js';
import { ORDERS, ORDER_COOLDOWN, ORDER_LIFETIME, ABILITIES, canUseAbility, abilityRankLabel } from '../../shared/config/commands.js';
import { rankOf, SCOPE, SCOPE_NAMES, RANK } from '../../shared/config/ranks.js';
import { XP, LEADERSHIP } from '../../shared/config/economy.js';
import { MSG, V } from '../../shared/protocol.js';
import { dist2D } from '../../shared/math.js';

export class CommandSystem {
  constructor(game) {
    this.game = game;
    this.offensives = {}; // faction -> {territory, until}
    this.complianceTimer = 0;
  }

  // ------------------------------------------------------------------ orders
  onOrder(session, msg) {
    const g = this.game;
    const s = session.soldier;
    const def = ORDERS[msg.order];
    if (!def) return;
    const rk = rankOf(session.rankIndex);
    let scope = V.int(msg.scope, 1, SCOPE.THEATER) ? msg.scope : SCOPE.SQUAD;
    if (rk.scope < SCOPE.SQUAD) {
      if (g.training.onOrderAttempt(session)) {
        g.notify(session, 'Command wheel works. You can issue real orders from the rank of Corporal.', 'info');
        return;
      }
      g.notify(session, 'Only NCOs and officers can issue orders.', 'warn');
      return;
    }
    if (!rk.orders.includes(def.id)) {
      const who = def.id === 'reinforce' ? 'Captains and above' : 'Sergeants and above';
      g.notify(session, `${def.name.toUpperCase()} orders are given by ${who}.`, 'warn');
      return;
    }
    scope = Math.min(scope, rk.scope);
    if ((session.nextOrderAt || 0) > g.time) return;
    session.nextOrderAt = g.time + ORDER_COOLDOWN;
    let x;
    let z;
    if (def.targetsIssuer) {
      if (!s || s.life !== LIFE.ALIVE) return;
      x = s.x;
      z = s.z;
    } else {
      if (!V.num(msg.x, -3100, 3100) || !V.num(msg.z, -3100, 3100)) return;
      x = msg.x;
      z = msg.z;
      if (s && scope < SCOPE.BATTALION && dist2D(s.x, s.z, x, z) > 1500) return;
    }
    if (msg.order === 'retreat') {
      const t = this.nearestFriendlyAnchor(session.faction, s ? s.x : x, s ? s.z : z);
      if (t) {
        x = t.x;
        z = t.z;
      }
    }
    const targetId = def.needsEntity && V.int(msg.target, 1, 65535) ? msg.target : 0;
    const order = {
      type: def.id, x, z, targetId, radius: def.radius,
      issuer: session.id, issuerName: session.name, issuerRank: session.rankIndex, issuerEntity: s ? s.id : 0,
      issuedAt: g.time, expiresAt: g.time + ORDER_LIFETIME, reached: false, scope,
    };
    const { playerSquads, npcSquads } = this.recipients(session, scope, x, z);
    for (const sq of playerSquads) {
      sq.order = { ...order };
      for (const pid of sq.members) {
        const m = g.byProfile.get(pid);
        if (!m) continue;
        const verb = def.verb;
        g.emit(['order', def.id, Math.round(x), Math.round(z), session.name, session.rankIndex, sq.name], { to: m });
        if (m !== session) g.radio(session.faction, 'order', `${rk.abbr} ${session.name}`, `${sq.name}, ${verb} ${this.placeName(x, z)}.`, { to: m, priority: 1 });
      }
    }
    for (const nsq of npcSquads) g.npc.applyOrder(nsq, order);
    // REINFORCE also calls up the army: reserves march to the territory
    if (def.id === 'reinforce') {
      const t = g.territoryAt(x, z);
      if (t && g.war.ownerOf(t.id) === session.faction) g.war.requestReinforcement(session.faction, t.id, session);
      else if (t) {
        const b = g.war.battleAt(t.id);
        if (b && b.attacker === session.faction) g.war.requestReinforcement(session.faction, t.id, session);
      }
    }
    g.squads.changed();
    g.progression.addStat(session, 'ordersIssued', 1, true);
    const units = playerSquads.length + npcSquads.length;
    g.emit(['orderAck', def.id, units, SCOPE_NAMES[scope]], { to: session });
  }

  placeName(x, z) {
    const g = this.game;
    const t = g.territoryAt(x, z);
    if (!t) {
      const p = g.world.placeAt(x, z);
      return p && p.place ? p.place : p && p.region ? `the ${p.region} countryside` : 'the marked position';
    }
    let best = null;
    let bd = 60;
    for (const s of t.sectors) {
      const d = dist2D(x, z, s.x, s.z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best ? `${best.name}, ${t.name}` : t.name;
  }

  nearestFriendlyAnchor(faction, x, z) {
    const g = this.game;
    let best = g.world.bases[faction];
    let bd = dist2D(x, z, best.x, best.z);
    for (const t of g.world.territories) {
      if (t.isBase) continue;
      const wt = g.war.get(t.id);
      if (!wt || wt.owner !== faction) continue;
      const d = dist2D(x, z, t.commandPost.x, t.commandPost.z);
      if (d < bd) {
        bd = d;
        best = { x: t.commandPost.x, z: t.commandPost.z };
      }
    }
    return best;
  }

  squadCentroid(sq) {
    const g = this.game;
    let n = 0;
    let x = 0;
    let z = 0;
    for (const pid of sq.members) {
      const m = g.byProfile.get(pid);
      if (m && m.soldier && m.soldier.life !== LIFE.DEAD) {
        x += m.soldier.x;
        z += m.soldier.z;
        n++;
      }
    }
    return n ? { x: x / n, z: z / n } : null;
  }

  // Units that an order at (x,z) with the given scope reaches.
  recipients(session, scope, x, z) {
    const g = this.game;
    const f = session.faction;
    const playerSquads = [];
    const npcSquads = [];
    const own = session.squadId ? g.squads.get(session.squadId) : null;
    if (own && own.leader === session.id) {
      playerSquads.push(own);
      const followers = g.npc.followerSquadOf(own);
      if (followers) npcSquads.push(followers);
    }
    if (scope <= SCOPE.SQUAD) return { playerSquads, npcSquads };
    const issuerPos = session.soldier && session.soldier.life !== LIFE.DEAD ? session.soldier : { x, z };
    const lowerRanked = (sq) => {
      const leader = g.byProfile.get(sq.leader);
      return leader && leader.rankIndex < session.rankIndex;
    };
    let inScope;
    if (scope === SCOPE.PLATOON) {
      inScope = (px, pz) => dist2D(px, pz, x, z) < 220 || dist2D(px, pz, issuerPos.x, issuerPos.z) < 160;
    } else if (scope === SCOPE.COMPANY) {
      const t = g.territoryAt(x, z);
      inScope = (px, pz) => (t ? dist2D(px, pz, t.x, t.z) < t.radius * 1.4 : dist2D(px, pz, x, z) < 250);
    } else if (scope === SCOPE.BATTALION) {
      const t = g.territoryAt(x, z);
      const set = t ? [t, ...t.adjacent.map((id) => g.world.tById[id]).filter(Boolean)] : [];
      inScope = (px, pz) => (set.length ? set.some((tt) => dist2D(px, pz, tt.x, tt.z) < tt.radius * 1.4) : dist2D(px, pz, x, z) < 400);
    } else if (scope === SCOPE.REGION) {
      inScope = (px, pz) => dist2D(px, pz, x, z) < 1500;
    } else {
      inScope = () => true;
    }
    const cands = [];
    for (const sq of g.squads.list(f)) {
      if (sq === own || !lowerRanked(sq)) continue;
      const c = this.squadCentroid(sq);
      if (c && inScope(c.x, c.z)) cands.push({ sq, d: dist2D(c.x, c.z, x, z), player: true });
    }
    for (const nsq of g.npc.squadsOf(f)) {
      if (nsq.attachedTo || nsq.special) continue;
      const c = g.npc.squadCentroid(nsq);
      if (c && inScope(c.x, c.z)) cands.push({ sq: nsq, d: dist2D(c.x, c.z, x, z), player: false });
    }
    cands.sort((a, b) => a.d - b.d);
    const limit = scope === SCOPE.PLATOON ? 3 : scope === SCOPE.COMPANY ? 6 : scope === SCOPE.BATTALION ? 12 : 99;
    for (const c of cands.slice(0, limit)) (c.player ? playerSquads : npcSquads).push(c.sq);
    return { playerSquads, npcSquads };
  }

  // Called by progression when a soldier earns objective/support XP.
  onFollowerXp(session, xp, pos) {
    const g = this.game;
    const sq = session.squadId ? g.squads.get(session.squadId) : null;
    if (!sq) return;
    const s = session.soldier;
    const p = pos || s;
    if (!p) return;
    // the squad leader leads by example
    if (sq.leader !== session.id) {
      const leader = g.byProfile.get(sq.leader);
      if (leader && leader.soldier && leader.soldier.life !== LIFE.DEAD && dist2D(leader.soldier.x, leader.soldier.z, p.x, p.z) < 90) {
        g.progression.grantLeadership(leader, xp * LEADERSHIP.perMemberObjectiveXp * 0.7, 'Squad performance');
      }
    }
    // the officer/NCO whose order is being carried out
    const o = sq.order;
    if (o && o.issuer !== session.id && o.expiresAt > g.time && this.complying(session, o)) {
      const issuer = g.byProfile.get(o.issuer);
      if (issuer) g.progression.grantLeadership(issuer, xp * LEADERSHIP.perMemberObjectiveXp, 'Orders carried out');
    }
  }

  complying(session, o) {
    const s = session.soldier;
    if (!s || s.life !== LIFE.ALIVE) return false;
    if (o.type === 'follow' || o.type === 'regroup') {
      const issuer = this.game.get(o.issuerEntity);
      if (!issuer) return false;
      return dist2D(s.x, s.z, issuer.x, issuer.z) < 30;
    }
    return dist2D(s.x, s.z, o.x, o.z) < o.radius + 15;
  }

  update(dt) {
    const g = this.game;
    this.complianceTimer += dt;
    if (this.complianceTimer >= 10) {
      this.complianceTimer = 0;
      for (const sq of g.squads.squads.values()) {
        const o = sq.order;
        if (!o || o.expiresAt < g.time) continue;
        const issuer = g.byProfile.get(o.issuer);
        let inPlace = 0;
        let alive = 0;
        for (const pid of sq.members) {
          const m = g.byProfile.get(pid);
          if (!m || !m.soldier || m.soldier.life === LIFE.DEAD) continue;
          alive++;
          if (pid === o.issuer) continue;
          if (this.complying(m, o)) {
            inPlace++;
            g.progression.award(m, { xp: XP.orderComplianceTick, reason: 'Following orders', cat: 'order', pos: m.soldier, silent: true, stats: { ordersFollowed: 1 } });
            if (issuer) g.progression.grantLeadership(issuer, LEADERSHIP.orderCompliance, null);
          }
        }
        if (!o.reached && (o.type === 'move' || o.type === 'attack' || o.type === 'regroup') && alive > 0 && inPlace >= Math.max(1, Math.ceil((alive - 1) / 2))) {
          o.reached = true;
          if (issuer) {
            g.progression.grantLeadership(issuer, 2, 'Squad in position');
            g.emit(['orderDone', sq.name, o.type], { to: issuer });
          }
        }
      }
      // command point regeneration
      g.war.regenCommandPoints(10);
      for (const s of g.sessions) if (s.profile && s.rankIndex >= RANK.SERGEANT) this.sendState(s);
    }
    for (const f of Object.keys(this.offensives)) {
      if (this.offensives[f] && this.offensives[f].until < g.time) {
        g.radio(Number(f), 'command', 'High Command', `The offensive on ${g.world.tById[this.offensives[f].territory].name} has concluded.`);
        this.offensives[f] = null;
      }
    }
  }

  offensiveFor(faction) {
    const o = this.offensives[faction];
    return o && o.until > this.game.time ? o : null;
  }

  // ------------------------------------------------------------------ abilities
  onAbility(session, msg) {
    if (!V.str(msg.id, 24)) return;
    const args = {};
    if (V.num(msg.x, -3100, 3100) && V.num(msg.z, -3100, 3100)) {
      args.x = msg.x;
      args.z = msg.z;
    }
    if (V.str(msg.territory, 24)) args.territory = msg.territory;
    this.useAbility(session, msg.id, args);
  }

  useAbility(session, id, args) {
    const g = this.game;
    const ab = ABILITIES[id];
    if (!ab) return false;
    const fail = (why) => {
      g.notify(session, why, 'warn');
      return false;
    };
    if (!canUseAbility(session.rankIndex, ab)) return fail(`${ab.name} requires ${abilityRankLabel(ab)}.`);
    const ready = session.abilityReady[id] || 0;
    if (ready > g.time) return fail(`${ab.name} ready in ${Math.ceil(ready - g.time)}s.`);
    const f = session.faction;
    if (g.war.cp[f] < ab.cp) return fail(`Not enough Command Points (${Math.floor(g.war.cp[f])}/${ab.cp}).`);
    const s = session.soldier;
    const alive = s && s.life === LIFE.ALIVE;
    let ok = false;
    if (ab.needsPos) {
      if (!alive) return fail('You must be deployed to call that in.');
      if (args.x === undefined) return fail('No target.');
      if (dist2D(s.x, s.z, args.x, args.z) > ab.range) return fail('Target out of range.');
    }
    const t = ab.needsTerritory ? g.world.tById[args.territory] : null;
    if (ab.needsTerritory && (!t || t.isBase)) return fail('Select a territory on the map.');
    switch (id) {
      case 'rally_point':
        ok = g.squads.placeRally(session);
        break;
      case 'ammo_drop':
        g.addProp(PROP_KIND.SUPPLY_CRATE, { x: args.x, y: g.world.terrain.heightAt(args.x, args.z) + 60, z: args.z, vy: -4, falling: true, faction: f, ownerId: s.id, expiresAt: g.time + 150, data: { resupply: true } });
        g.radio(f, 'command', `${rankOf(session.rankIndex).abbr} ${session.name}`, 'Ammunition drop inbound.');
        ok = true;
        break;
      case 'mark_target': {
        let n = 0;
        for (const e of g.soldiersNear(args.x, args.z, ab.radius)) if (g.combat.spot(e, f, session, 30)) n++;
        for (const v of g.vehiclesNear(args.x, args.z, ab.radius)) if (g.combat.spot(v, f, session, 30)) n++;
        g.emit(['mark', Math.round(args.x), Math.round(args.z), ab.radius], { faction: f });
        g.radio(f, 'intel', `${rankOf(session.rankIndex).abbr} ${session.name}`, `Enemy position marked: ${n} contacts.`);
        if (n) g.progression.award(session, { xp: n * XP.spotted * 2, reason: 'Marked enemies', cat: 'support', stats: { spots: n } });
        ok = true;
        break;
      }
      case 'uav_recon': {
        let n = 0;
        for (const e of g.soldiersNear(args.x, args.z, ab.radius)) if (g.combat.spot(e, f, session, 45)) n++;
        for (const v of g.vehiclesNear(args.x, args.z, ab.radius)) if (g.combat.spot(v, f, session, 45)) n++;
        g.emit(['mark', Math.round(args.x), Math.round(args.z), ab.radius], { faction: f });
        g.emit(['drone', Math.round(args.x), Math.round(args.z), 45], { pos: { x: args.x, z: args.z }, range: 900 });
        g.radio(f, 'intel', `${rankOf(session.rankIndex).abbr} ${session.name}`, `Drone on station over ${this.placeName(args.x, args.z)}: ${n} contacts.`);
        if (n) g.progression.award(session, { xp: n * XP.spotted * 2, reason: 'Drone recon', cat: 'support', stats: { spots: n, recons: 1 } });
        ok = true;
        break;
      }
      case 'rally_cry': {
        if (!alive) return fail('You must be deployed.');
        let n = 0;
        for (const e of g.soldiersNear(s.x, s.z, ab.radius, (x) => x.faction === f && x.life === LIFE.ALIVE && x !== s)) {
          e.health = Math.min(HEALTH.max, e.health + 35);
          e.suppression = 0;
          g.combat.resupply(e, s, 0.6);
          e.infoVersion++;
          n++;
        }
        g.npc.say(s, 'On your feet! Hold this line — nobody falls back!');
        g.emit(['rallycry', s.id], { pos: s, range: 120 });
        if (n) g.progression.grantLeadership(session, Math.min(10, n), 'Rally cry');
        ok = true;
        break;
      }
      case 'fireteam': {
        const squad = session.squadId ? g.squads.get(session.squadId) : null;
        if (!squad || squad.leader !== session.id) return fail('Lead a squad to attach a fireteam.');
        if (!alive) return fail('You must be deployed.');
        const n = rankOf(session.rankIndex).npcFollowers;
        ok = g.npc.attachFireteam(session, squad, n);
        if (!ok) return fail('No reinforcements available right now.');
        break;
      }
      case 'smoke_screen':
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          g.combat.strikes.push({ at: g.time + 3 + i * 0.5, x: args.x + Math.cos(a) * 9, z: args.z + Math.sin(a) * 9, type: 'smoke', ownerId: s.id, faction: f });
        }
        g.radio(f, 'command', `${rankOf(session.rankIndex).abbr} ${session.name}`, 'Smoke mission inbound, advance under cover.');
        ok = true;
        break;
      case 'supply_drop':
        for (let i = 0; i < 2; i++) {
          g.addProp(PROP_KIND.SUPPLY_CRATE, { x: args.x + (i ? 3 : -3), y: g.world.terrain.heightAt(args.x, args.z) + 70, z: args.z, vy: -4, falling: true, faction: f, ownerId: s.id, expiresAt: g.time + 300, data: { resupply: true, supply: true } });
        }
        {
          const tt = g.territoryAt(args.x, args.z);
          if (tt) g.war.addSupply(tt.id, 12, f);
        }
        g.radio(f, 'command', `${rankOf(session.rankIndex).abbr} ${session.name}`, 'Supply drop inbound.');
        ok = true;
        break;
      case 'reinforce':
        ok = g.npc.deployReinforcement(f, args.x, args.z, 1, session);
        if (!ok) return fail('No reinforcements can reach that position.');
        g.radio(f, 'command', `${rankOf(session.rankIndex).abbr} ${session.name}`, `Reinforcement squad dispatched to ${this.placeName(args.x, args.z)}.`);
        break;
      case 'artillery': {
        const observers = g.soldiersNear(args.x, args.z, ab.needsObserver, (e) => e.faction === f && e.life === LIFE.ALIVE && !e.ambient);
        if (!observers.length) return fail('No friendly observer within 220 m of the target.');
        const friendlies = g.soldiersNear(args.x, args.z, ab.safety, (e) => e.faction === f && e.isPlayer && e.life !== LIFE.DEAD);
        if (friendlies.length) return fail('Danger close: friendly soldiers near the target.');
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * ab.radius;
          g.combat.strikes.push({ at: g.time + 5 + i * 0.7, x: args.x + Math.cos(a) * r, z: args.z + Math.sin(a) * r, type: 'he', ownerId: s.id, faction: f });
        }
        g.emit(['incoming', Math.round(args.x), Math.round(args.z), ab.radius], { pos: { x: args.x, z: args.z }, range: 400 });
        g.radio(f, 'command', `${rankOf(session.rankIndex).abbr} ${session.name}`, `Fire mission: ${this.placeName(args.x, args.z)}. Shells out!`, { priority: 1 });
        ok = true;
        break;
      }
      case 'priority':
        g.war.priority[f] = { territory: t.id, until: g.time + 600, by: session.name };
        g.radio(f, 'command', `${rankOf(session.rankIndex).abbr} ${session.name}`, `Strategic priority: ${t.name}. All units, focus efforts there.`, { priority: 1 });
        g.missions.onPriorityChanged(f);
        ok = true;
        break;
      case 'operation':
        if (g.playersOnline(f) < ab.minPlayers && !g.options.solo) return fail('Operations need at least 2 soldiers online.');
        ok = g.missions.launchOperation(f, t.id, session);
        if (!ok) return fail('An operation is already underway or the target is not on the front.');
        break;
      case 'air_support':
        ok = g.vehicleSys.spawnGunship(f, args.x, args.z, 60, s.id);
        if (!ok) return fail('Air support unavailable.');
        g.radio(f, 'command', `${rankOf(session.rankIndex).abbr} ${session.name}`, 'Gunship on station. Keep your heads down.', { priority: 1 });
        break;
      case 'offensive': {
        const wt = g.war.get(t.id);
        if (!wt || !g.war.isFront(t.id, f)) return fail('The offensive must target a front-line territory.');
        this.offensives[f] = { territory: t.id, until: g.time + 600, by: session.name };
        g.war.forceBattle(t.id, f);
        g.npc.deployReinforcement(f, t.commandPost.x, t.commandPost.z, 2, session);
        g.emit(['music', 'offensive'], { faction: f });
        g.radio(f, 'command', 'High Command', `GENERAL ${session.name.toUpperCase()} HAS ORDERED A MAJOR OFFENSIVE ON ${t.name.toUpperCase()}. ALL UNITS ADVANCE.`, { priority: 2 });
        ok = true;
        break;
      }
      default:
        return false;
    }
    if (!ok) return false;
    session.abilityReady[id] = g.time + ab.cooldown * rankOf(session.rankIndex).cooldownMult;
    g.war.spendCommandPoints(f, ab.cp);
    this.sendState(session);
    return true;
  }

  // AI commanders use a subset of abilities with their own pool.
  aiUse(faction, id, x, z) {
    const g = this.game;
    const ab = ABILITIES[id];
    if (!ab || g.war.cp[faction] < ab.cp * 1.5) return false;
    if (id === 'artillery') {
      const friendlies = g.soldiersNear(x, z, 40, (e) => e.faction === faction && e.life !== LIFE.DEAD);
      if (friendlies.length) return false;
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * 24;
        g.combat.strikes.push({ at: g.time + 6 + i * 0.8, x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, type: 'he', ownerId: 0, faction });
      }
      g.emit(['incoming', Math.round(x), Math.round(z), 24], { pos: { x, z }, range: 400 });
      for (const e of g.war.enemies(faction)) g.radio(e, 'intel', 'Forward Observer', `Incoming artillery at ${this.placeName(x, z)}! Take cover!`, { priority: 2 });
    } else if (id === 'smoke_screen') {
      for (let i = 0; i < 4; i++) g.combat.strikes.push({ at: g.time + 3 + i * 0.5, x: x + (Math.random() - 0.5) * 18, z: z + (Math.random() - 0.5) * 18, type: 'smoke', ownerId: 0, faction });
    } else return false;
    g.war.spendCommandPoints(faction, ab.cp);
    return true;
  }

  sendState(session) {
    const g = this.game;
    if (!session.profile) return;
    const ready = {};
    for (const id of Object.keys(ABILITIES)) {
      const r = (session.abilityReady[id] || 0) - g.time;
      if (r > 0) ready[id] = Math.ceil(r);
    }
    const f = session.faction;
    session.send({
      t: MSG.CMDSTATE,
      ready,
      cp: Math.floor(g.war.cp[f]),
      cpMax: g.war.cpMax(f),
      offensive: this.offensiveFor(f),
      priority: g.war.priority[f] && g.war.priority[f].until > g.time ? g.war.priority[f] : null,
    });
  }
}

