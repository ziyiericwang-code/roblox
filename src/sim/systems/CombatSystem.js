// Combat: authoritative hit detection (lag compensated), damage, armor,
// downed/revive, explosions, projectiles, smoke and suppression.
import { LIFE, HEALTH, FACTION, ENTITY, PROP_KIND, areHostile, SEA_LEVEL, STANCE } from '../../shared/constants.js';
import { WEAPONS, computeSpread, falloff } from '../../shared/config/weapons.js';
import { ARMOR_CLASS } from '../../shared/config/vehicles.js';
import { XP, KILL_FARM } from '../../shared/config/economy.js';
import { ROLES } from '../../shared/config/roles.js';
import { raySoldier, rayVehicle, ZONE, WEAPON_CODE, pelletDirs, PROJECTILE_CODE, aimPoint } from '../../shared/combat.js';
import { eyeHeight } from '../../shared/physics.js';
import { V } from '../../shared/protocol.js';
import { dist2D, dist3, dirFromYawPitch, angleBetween, rayPointDist, clamp } from '../../shared/math.js';
import { PENETRABLE } from '../../shared/world/materials.js';
import { BF } from '../../shared/world/builder.js';

const DEG = Math.PI / 180;
const NPC_DAMAGE_MULT = 0.8;

export class CombatSystem {
  constructor(game) {
    this.game = game;
    this.smokes = []; // {x,y,z,r,until}
    this.strikes = []; // delayed artillery/smoke shells {at, x,z, type, ownerId, faction}
  }

  // ------------------------------------------------------------------ player fire
  onPlayerFire(session, msg) {
    const g = this.game;
    const s = session.soldier;
    if (!s || !s.alive || s.vehicle || s.carrying || s.swimming) return;
    if (!V.int(msg.slot, 0, 4) || !V.vec(msg.o) || !V.vec(msg.d, 2)) return;
    if (msg.slot !== s.slot) return;
    const ws = s.weapon;
    const w = ws && WEAPONS[ws.id];
    if (!w || (w.kind !== 'gun' && w.kind !== 'launcher')) return;
    if (s.reloadUntil > g.time + 0.12 || s.switchUntil > g.time + 0.1) return;
    if (ws.mag <= 0) return;
    // rate of fire (token bucket tolerates network jitter but not speed hacks)
    const rate = (w.rpm / 60) * 1.12;
    const cap = w.burst ? 3.2 : 2.2;
    s.fireTokens = Math.min(cap, (s.fireTokens ?? cap) + (g.time - (s.fireTokenT ?? g.time)) * rate);
    s.fireTokenT = g.time;
    if (s.fireTokens < 0.98) {
      session.violations += 0.05;
      return;
    }
    s.fireTokens -= 1;
    const o = { x: msg.o[0], y: msg.o[1], z: msg.o[2] };
    let d = { x: msg.d[0], y: msg.d[1], z: msg.d[2] };
    const dl = Math.hypot(d.x, d.y, d.z);
    if (dl < 0.9 || dl > 1.1) return;
    d = { x: d.x / dl, y: d.y / dl, z: d.z / dl };
    const eye = { x: s.x, y: s.y + eyeHeight(s.stance), z: s.z };
    if (dist3(o, eye) > 3.6) {
      session.violations += 0.5;
      return;
    }
    const aim = dirFromYawPitch(s.yaw, s.pitch);
    const spread = computeSpread(w, { ads: s.ads, speed: Math.hypot(s.vx, s.vz), stance: s.stance, grounded: true, bloom: s.bloom, suppression: s.suppression });
    if (angleBetween(aim, d) > (spread * 3 + 12) * DEG) {
      session.violations += 0.3;
      return;
    }
    ws.mag -= 1;
    s.lastFireAt = g.time;
    s.firingUntil = g.time + 0.25;
    s.sprint = false;
    s.invulnerableUntil = 0;
    s.bloom = Math.min(w.bloomMax, s.bloom + w.bloomPerShot);
    session.profile.stats.shots = (session.profile.stats.shots | 0) + 1;
    // lag compensation: rewind hostile hitboxes by the client's latency + interpolation delay
    const rewind = clamp(session.rtt / 2 + 0.1, 0, 0.35);
    const lagT = g.time - rewind;
    if (w.kind === 'launcher') {
      this.fireProjectile(s, w.projectile, o, d, w);
      if (ws.mag <= 0 && ws.reserve > 0) this.game.players.startReload(s);
      return;
    }
    if (w.pellets > 1) {
      const dirs = pelletDirs(d, w.pellets, w.spreadHip * 0.8, (msg.seq >>> 0) ^ s.id);
      let first = true;
      for (const pd of dirs) {
        this.fireHitscan(s, o, pd, w, { lagT, session, silent: !first });
        first = false;
      }
    } else {
      this.fireHitscan(s, o, d, w, { lagT, session });
    }
    this.game.training.onShot(session);
  }

  // ------------------------------------------------------------------ hitscan
  /**
   * Resolve one bullet. shooter: Soldier (or null for vehicle guns with opts.faction).
   * Returns {hit: entity|null, point}.
   */
  fireHitscan(shooter, o, d, w, opts = {}) {
    const g = this.game;
    const faction = opts.faction ?? shooter.faction;
    const range = w.range || 300;
    const col = g.world.colliders;
    const wh = col.raycast(o.x, o.y, o.z, d.x, d.y, d.z, range, { penetrate: true });
    let maxT = wh ? wh.t : range;
    let hitEnt = null;
    let hitZone = ZONE.NONE;
    // soldiers: candidates near the ray
    const t = opts.lagT ?? g.time;
    const shooterId = shooter ? shooter.id : 0;
    const mx = o.x + d.x * maxT * 0.5;
    const mz = o.z + d.z * maxT * 0.5;
    const r = maxT * 0.5 + 4;
    const nearMiss = [];
    g.spatial.query(mx, mz, r, (e) => {
      if (e.id === shooterId || e.id === opts.ignoreId) return;
      if (e.k === ENTITY.SOLDIER) {
        if (e.life === LIFE.DEAD) return;
        if (e.vehicle && (e.vehicle === opts.vehicleId || !g.npc.exposed(e))) return;
        if (!areHostile(faction, e.faction) || e.captive) return;
        const st = e.isPlayer && opts.lagT ? e.stateAt(t) : e;
        const res = raySoldier(o, d, maxT, st);
        if (res) {
          maxT = res.t;
          hitEnt = e;
          hitZone = res.zone;
        } else if (e.isPlayer || e.npc) {
          const near = rayPointDist(o, d, maxT, { x: st.x, y: st.y + 1.2, z: st.z });
          if (near.dist < 4) nearMiss.push({ e, dist: near.dist });
        }
      } else if (e.k === ENTITY.VEHICLE) {
        if (e.state === 3) return;
        if (opts.ignoreVehicle === e.id) return;
        const tv = rayVehicle(o, d, maxT, e);
        if (tv >= 0 && tv < maxT) {
          maxT = tv;
          hitEnt = e;
          hitZone = ZONE.NONE;
        }
      }
    });
    const hp = { x: o.x + d.x * maxT, y: o.y + d.y * maxT, z: o.z + d.z * maxT };
    // Hit kind for effects: 0 none, 1 terrain, 2 structure, 3 flesh, 4 vehicle, 5 water
    let kind = 0;
    let mat = 0;
    if (hitEnt) kind = hitEnt.k === ENTITY.SOLDIER ? 3 : 4;
    else if (wh) {
      kind = wh.terrain ? 1 : 2;
      mat = wh.terrain ? g.world.terrain.materialAt(hp.x, hp.z) : wh.mat;
      if (wh.terrain && hp.y < SEA_LEVEL + 0.05) kind = 5;
      if (!wh.terrain && g.world.colliders.flags[wh.i] & BF.RANGE_TARGET) this.onRangeTargetHit(shooter, wh.i);
    }
    if (!opts.silent) {
      g.emit(['shot', shooterId, WEAPON_CODE[w.id] || 0, r1(o.x), r1(o.y), r1(o.z), r1(hp.x), r1(hp.y), r1(hp.z), kind, mat], { pos: o, range: 650 });
    }
    // near misses suppress
    for (const nm of nearMiss) {
      if (nm.e === hitEnt) continue;
      this.suppress(nm.e, (w.suppression || 0.2) * (1 - nm.dist / 4), shooter);
    }
    if (hitEnt) {
      const dist = maxT;
      if (hitEnt.k === ENTITY.SOLDIER) {
        const zm = hitZone === ZONE.HEAD ? w.headMult : hitZone === ZONE.LIMB ? w.limbMult : 1;
        let dmg = w.damage * zm * falloff(w, dist);
        if (shooter && !shooter.isPlayer && hitEnt.isPlayer) dmg *= NPC_DAMAGE_MULT;
        this.applyDamage(hitEnt, dmg, shooter, { zone: hitZone, weaponId: w.id, dir: d, session: opts.session, vehicleId: opts.vehicleId });
      } else if (hitEnt.k === ENTITY.VEHICLE) {
        const ac = ARMOR_CLASS[hitEnt.def.armor];
        let vd = w.vehicleDamageFlat ? w.vehicleDamageFlat * ac.explosive : w.damage * (w.vehicleMult ?? 0.25) * ac.bullet;
        if (areHostile(faction, hitEnt.faction) && vd > 0) {
          g.vehicleSys.damage(hitEnt, vd, shooter, 'bullet');
          if (opts.session) g.emit(['hit', hitEnt.id, Math.round(vd), 0, 0, 1], { to: opts.session });
        }
      }
      if (w.splash) this.explode(hp.x, hp.y, hp.z, { radius: w.splash, damage: w.splashDamage, vehicleDamage: 0, ownerId: shooterId, faction, weaponId: w.id, small: true });
    } else if (w.splash && wh) {
      this.explode(hp.x, hp.y, hp.z, { radius: w.splash, damage: w.splashDamage, vehicleDamage: 0, ownerId: shooterId, faction, weaponId: w.id, small: true });
    }
    // AI hearing
    g.npc.onGunfire(shooter, o, faction);
    return { hit: hitEnt, point: hp };
  }

  onRangeTargetHit(shooter, colliderIndex) {
    if (!shooter || !shooter.player) return;
    this.game.training.onRangeHit(shooter.player, colliderIndex);
  }

  suppress(e, amount, source) {
    if (amount <= 0 || e.life === LIFE.DEAD) return;
    e.suppression = Math.min(1, e.suppression + amount);
    if (e.player && (e.lastSupSent || 0) + 0.25 < this.game.time) {
      e.lastSupSent = this.game.time;
      this.game.emit(['sup', Math.round(e.suppression * 100)], { to: e.player });
    }
    if (e.npc) this.game.npc.onSuppressed(e, source);
  }

  // ------------------------------------------------------------------ damage
  /**
   * opts: {zone, weaponId, explosive, dir, session (attacker session), noDown}
   */
  applyDamage(target, amount, attacker, opts = {}) {
    const g = this.game;
    if (target.life === LIFE.DEAD || amount <= 0) return;
    if (target.invulnerableUntil > g.time) return;
    if (attacker && attacker.id === target.id && !opts.explosive) return;
    if (target.ambient && !target.combatReady) return;
    const selfHit = attacker && attacker.id === target.id;
    if (selfHit) amount *= 0.5;
    // armor absorbs a share of body damage (not headshots from rifles)
    let dmg = amount;
    if (target.armor > 0 && opts.zone !== ZONE.HEAD) {
      const absorb = Math.min(target.armor, dmg * HEALTH.armorAbsorb);
      target.armor -= absorb;
      dmg -= absorb;
    }
    target.lastDamageAt = g.time;
    if (attacker && attacker.id !== target.id) {
      const rec = target.damagers.get(attacker.id) || { dmg: 0, t: 0 };
      rec.dmg += dmg;
      rec.t = g.time;
      target.damagers.set(attacker.id, rec);
    }
    const attackerSession = opts.session || (attacker && attacker.player) || null;
    if (target.player) {
      const from = opts.dir ? [r1(-opts.dir.x), r1(-opts.dir.z)] : attacker ? [r1(attacker.x - target.x), r1(attacker.z - target.z)] : [0, 0];
      g.emit(['dmg', Math.round(dmg), from[0], from[1], opts.explosive ? 1 : 0], { to: target.player });
    }
    if (target.npc) g.npc.onDamaged(target, attacker);
    if (target.life === LIFE.DOWNED) {
      this.kill(target, attacker, { ...opts, attackerSession });
      return;
    }
    target.health -= dmg;
    const killed = target.health <= 0;
    if (attackerSession && !selfHit) {
      g.emit(['hit', target.id, Math.round(dmg), opts.zone === ZONE.HEAD ? 1 : 0, killed ? 1 : 0, 0], { to: attackerSession });
    }
    if (!killed) return;
    const overkill = -target.health;
    const canDown = !opts.noDown && !target.ambient && (target.isPlayer || (target.faction === FACTION.COALITION && target.npc && !target.npc.vip)) && !target.swimming && !target.vehicle;
    const lethal = (opts.zone === ZONE.HEAD && overkill > 40) || (opts.explosive && overkill > 70) || overkill > 120;
    if (canDown && !lethal) this.down(target, attacker, attackerSession, opts);
    else this.kill(target, attacker, { ...opts, attackerSession });
  }

  down(target, attacker, attackerSession, opts) {
    const g = this.game;
    target.life = LIFE.DOWNED;
    target.health = 0;
    target.downedAt = g.time;
    target.bleedoutAt = g.time + HEALTH.downedTime;
    target.stance = STANCE.PRONE;
    target.sprint = false;
    target.ads = false;
    target.action = null;
    this.dropCarried(target);
    if (target.player) {
      g.emit(['downed', HEALTH.downedTime, attacker ? attacker.name : ''], { to: target.player });
      g.radio(target.faction, 'squad', target.name, 'I\'m hit! Need a medic!', { squad: target.squadId });
    }
    g.npc.onDowned(target, attacker);
    this.creditTakedown(target, attacker, attackerSession, opts, false);
  }

  kill(target, attacker, opts = {}) {
    const g = this.game;
    const wasDowned = target.life === LIFE.DOWNED;
    target.life = LIFE.DEAD;
    target.health = 0;
    target.action = null;
    target.deathAt = g.time;
    this.dropCarried(target);
    if (target.vehicle) g.vehicleSys.ejectSoldier(target, false);
    if (!wasDowned) this.creditTakedown(target, attacker, opts.attackerSession, opts, true);
    if (target.player) {
      const sess = target.player;
      g.progression.addStat(sess, 'deaths', 1);
      g.progression.endDeployment(sess, 'death');
      sess.state = 'dead';
      sess.lastDeathPos = { x: target.x, z: target.z };
      sess.canDeployAt = g.time + g.deploySys.respawnDelay(sess);
      g.emit(['died', attacker ? attacker.name : '', attacker && WEAPON_CODE[opts.weaponId] ? WEAPON_CODE[opts.weaponId] : 0], { to: sess });
      g.deploySys.sendOptions(sess);
    }
    g.npc.onKilled(target, attacker);
    g.missions.onSoldierKilled(target, attacker);
  }

  // XP & stats for taking an enemy out of the fight (first time it goes down).
  creditTakedown(target, attacker, attackerSession, opts, final) {
    const g = this.game;
    void final;
    const pos = { x: target.x, z: target.z };
    if (attackerSession && attacker && areHostile(attacker.faction, target.faction)) {
      const inObj = g.war.isObjectiveArea(target.x, target.z) || g.war.isObjectiveArea(attacker.x, attacker.z) || g.missions.isMissionArea(target.x, target.z);
      let xp = inObj ? XP.killInObjective : XP.kill;
      if (!inObj) {
        // diminishing returns for kill streaks away from objectives
        const log = attackerSession.killLog;
        log.push(g.time);
        while (log.length && log[0] < g.time - KILL_FARM.window) log.shift();
        if (log.length > KILL_FARM.freeKills) xp *= KILL_FARM.decayedMult;
      }
      const defending = g.war.isDefendingKill(attacker, target);
      if (defending) xp = Math.max(xp, XP.defendKill);
      if (opts.zone === ZONE.HEAD) {
        xp += XP.headshotBonus;
        g.progression.addStat(attackerSession, 'headshots', 1, true);
      }
      g.progression.award(attackerSession, { xp, reason: defending ? 'Defensive kill' : inObj ? 'Objective kill' : 'Enemy down', cat: 'combat', pos, stats: { kills: 1 } });
      attackerSession.profile.stats.hits = (attackerSession.profile.stats.hits | 0) + 1;
      g.missions.onPlayerAction(attackerSession, 'kill', 3, pos);
      g.emit(['kill', target.name, WEAPON_CODE[opts.weaponId] || 0, opts.zone === ZONE.HEAD ? 1 : 0], { to: attackerSession });
    }
    // assists
    for (const [id, rec] of target.damagers) {
      if (attacker && id === attacker.id) continue;
      if (g.time - rec.t > 12 || rec.dmg < 15) continue;
      const e = g.get(id);
      if (e && e.player && areHostile(e.faction, target.faction)) {
        g.progression.award(e.player, { xp: XP.assist, reason: 'Assist', cat: 'combat', pos, stats: { assists: 1 } });
      }
    }
    // spot assist
    if (target.spottedBy && target.spottedUntil > g.time) {
      const spotter = g.byProfile.get(target.spottedBy);
      if (spotter && (!attackerSession || spotter !== attackerSession)) g.progression.award(spotter, { xp: XP.spotAssist, reason: 'Spot assist', cat: 'support', pos });
    }
    target.damagers.clear();
  }

  revive(target, reviver, medic) {
    const g = this.game;
    if (target.life !== LIFE.DOWNED) return false;
    target.life = LIFE.ALIVE;
    target.health = medic ? 60 : 30;
    target.stance = STANCE.CROUCH;
    target.invulnerableUntil = g.time + 1.5;
    target.damagers.clear();
    if (target.player) {
      g.progression.addStat(target.player, 'revived', 1);
      g.emit(['revived', reviver ? reviver.name : ''], { to: target.player });
    }
    if (reviver && reviver.player) {
      const sess = reviver.player;
      const underFire = g.time - reviver.lastDamageAt < 5 || reviver.suppression > 0.4;
      g.progression.award(sess, { xp: XP.revive, credits: 3, reason: underFire ? 'Revive under fire' : 'Revive', cat: 'support', pos: target, stats: { revives: 1 } });
      g.missions.onPlayerAction(sess, 'revive', 8, target);
      if (underFire) {
        sess.underFireRevives = (sess.underFireRevives || 0) + 1;
        if (sess.underFireRevives === 3) g.progression.addStat(sess, 'valor', 1);
      }
    }
    g.npc.onRevived(target);
    return true;
  }

  heal(target, amount, healer) {
    if (target.life !== LIFE.ALIVE || target.health >= HEALTH.max) return 0;
    const before = target.health;
    target.health = Math.min(HEALTH.max, target.health + amount);
    const healed = target.health - before;
    if (healer && healer.player && healer !== target) {
      const sess = healer.player;
      sess.healAcc = (sess.healAcc || 0) + healed;
      while (sess.healAcc >= 10) {
        sess.healAcc -= 10;
        sess.healPoints = (sess.healPoints || 0) + 1;
        g_award(this.game, sess, XP.healPer10, 'Healing', target);
        if (sess.healPoints % 5 === 0) this.game.progression.addStat(sess, 'heals', 1);
      }
    }
    return healed;
  }

  resupply(target, byEntity, fraction = 0.5) {
    let gave = false;
    for (const ws of target.weapons) {
      const w = WEAPONS[ws.id];
      if (!w) continue;
      if (w.kind === 'gun' || w.kind === 'launcher') {
        const max = w.reserve;
        if (ws.reserve < max) {
          ws.reserve = Math.min(max, ws.reserve + Math.ceil(max * fraction));
          gave = true;
        }
      } else if (w.kind === 'throwable') {
        const role = ROLES[target.role];
        const max = (w.count || 1) + (ws.id === 'frag' && role && role.perks.grenades ? role.perks.grenades - w.count : 0);
        if (ws.count < max) {
          ws.count += 1;
          gave = true;
        }
      } else if (w.kind === 'gadget' && (w.count || w.uses)) {
        const max = w.count || w.uses;
        if (ws.count < max) {
          ws.count = Math.min(max, ws.count + Math.ceil(max * fraction));
          gave = true;
        }
      }
    }
    if (target.armor < target.maxArmor) {
      target.armor = Math.min(target.maxArmor, target.armor + target.maxArmor * 0.5);
      gave = true;
    }
    if (gave && target.player) this.game.players.sendLoadout(target.player);
    if (gave && byEntity && byEntity.player && byEntity !== target) {
      const sess = byEntity.player;
      const key = `rs:${target.id}`;
      sess.resupplyCd = sess.resupplyCd || new Map();
      if ((sess.resupplyCd.get(key) || 0) < this.game.time) {
        sess.resupplyCd.set(key, this.game.time + 20);
        this.game.progression.award(sess, { xp: XP.resupply, reason: 'Resupply', cat: 'support', pos: target, stats: { resupplies: 1 } });
        if ((sess.profile.stats.resupplies | 0) % 5 === 0) this.game.progression.addStat(sess, 'supplies', 1);
      }
    }
    return gave;
  }

  // ------------------------------------------------------------------ explosives
  onPlayerThrow(session, msg) {
    const g = this.game;
    const s = session.soldier;
    if (!s || !s.alive || s.vehicle || s.carrying) return;
    if (!V.int(msg.slot, 0, 4) || !V.vec(msg.d, 2) || !V.num(msg.cook, 0, 5)) return;
    const ws = s.weapons[msg.slot];
    const w = ws && WEAPONS[ws.id];
    if (!w || w.kind !== 'throwable' || ws.count <= 0) return;
    if ((s.nextThrowAt || 0) > g.time) return;
    s.nextThrowAt = g.time + 1.0;
    ws.count -= 1;
    let d = { x: msg.d[0], y: msg.d[1], z: msg.d[2] };
    const l = Math.hypot(d.x, d.y, d.z) || 1;
    d = { x: d.x / l, y: d.y / l, z: d.z / l };
    const o = { x: s.x + d.x * 0.5, y: s.y + eyeHeight(s.stance) - 0.1, z: s.z + d.z * 0.5 };
    const speed = w.throwSpeed * (s.stance === STANCE.PRONE ? 0.6 : 1);
    const cook = Math.min(msg.cook, w.fuse - 0.3);
    g.addProjectile(w.id, {
      x: o.x, y: o.y, z: o.z,
      vx: d.x * speed + s.vx * 0.5, vy: d.y * speed + 2.5, vz: d.z * speed + s.vz * 0.5,
      ownerId: s.id, faction: s.faction, weaponId: w.id, fuseAt: g.time + w.fuse - cook,
    });
    s.invulnerableUntil = 0;
    this.game.players.sendLoadout(session);
    this.game.training.onThrow(session);
    if (w.id === 'frag') g.npc.onGrenade(o, s.faction);
  }

  fireProjectile(shooter, type, o, d, w, opts = {}) {
    const g = this.game;
    return g.addProjectile(type, {
      x: o.x + d.x * 1.2, y: o.y + d.y * 1.2, z: o.z + d.z * 1.2,
      vx: d.x * w.speed, vy: d.y * w.speed, vz: d.z * w.speed,
      ownerId: shooter ? shooter.id : 0, faction: opts.faction ?? (shooter ? shooter.faction : 0), weaponId: w.id,
      gravity: w.gravity ?? 2, impact: true, fuseAt: g.time + 8, ignoreVehicle: opts.ignoreVehicle,
    });
  }

  /**
   * opts: {radius, damage, vehicleDamage, targetDamage, ownerId, faction, weaponId, small}
   */
  explode(x, y, z, opts) {
    const g = this.game;
    const R = opts.radius;
    const owner = opts.ownerId ? g.get(opts.ownerId) : null;
    const faction = opts.faction ?? (owner ? owner.faction : 0);
    const session = owner && owner.player ? owner.player : null;
    if (!opts.small) g.emit(['boom', r1(x), r1(y), r1(z), r1(R), opts.weaponId === 'cannon' || opts.weaponId === 'artillery' ? 2 : 1], { pos: { x, z }, range: 1400 });
    else g.emit(['boom', r1(x), r1(y), r1(z), r1(R), 0], { pos: { x, z }, range: 500 });
    const col = g.world.colliders;
    // soldiers
    for (const s of g.soldiersNear(x, z, R * 2.2)) {
      if (s.life === LIFE.DEAD) continue;
      const cy = s.y + (s.stance === STANCE.PRONE ? 0.3 : 1.0);
      const d = Math.hypot(s.x - x, cy - y, s.z - z);
      if (d > R) {
        if (d < R * 2.2 && (areHostile(faction, s.faction) || s.id === opts.ownerId)) this.suppress(s, 0.5 * (1 - d / (R * 2.2)), owner);
        continue;
      }
      const hostile = areHostile(faction, s.faction);
      const self = s.id === opts.ownerId;
      if (!hostile && !self) continue;
      if (s.vehicle) continue;
      let f = Math.pow(1 - d / R, 0.8);
      if (!col.lineOfSight(x, y + 0.4, z, s.x, cy, s.z)) f *= 0.25;
      if (s.stance === STANCE.PRONE) f *= 0.75;
      const dmg = opts.damage * f;
      if (dmg < 2) continue;
      this.applyDamage(s, dmg, owner, { explosive: true, weaponId: opts.weaponId, dir: { x: s.x - x, y: 0, z: s.z - z }, session: self ? null : session });
      this.suppress(s, 0.8, owner);
    }
    // vehicles
    if (opts.vehicleDamage) {
      for (const v of g.vehiclesNear(x, z, R + 6)) {
        if (v.state === 3) continue;
        const d = Math.max(0, dist3(v, { x, y, z }) - v.def.halfSize[0]);
        if (d > R) continue;
        const ac = ARMOR_CLASS[v.def.armor];
        const vd = opts.vehicleDamage * Math.pow(1 - d / R, 0.6) * ac.explosive;
        if (areHostile(faction, v.faction) || v.faction === 0) {
          g.vehicleSys.damage(v, vd, owner, 'explosive');
          if (session) g.emit(['hit', v.id, Math.round(vd), 0, 0, 1], { to: session });
        }
      }
    }
    // destructible mission targets
    for (const p of g.props) {
      if (p.kind !== PROP_KIND.TARGET || p.health <= 0) continue;
      const d = dist3(p, { x, y, z });
      if (d > R + 3) continue;
      if (!areHostile(faction, p.faction)) continue;
      const dmg = (opts.targetDamage || opts.vehicleDamage || opts.damage * 2) * (1 - Math.min(1, d / (R + 3)) * 0.6);
      g.missions.damageTarget(p, dmg, owner);
    }
    g.npc.onExplosion(x, z, R);
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const g = this.game;
    const col = g.world.colliders;
    // projectiles
    for (const p of [...g.projectiles]) {
      if (p.attachedTo) {
        const host = g.get(p.attachedTo);
        if (host) {
          p.x = host.x + (p.ax || 0);
          p.y = host.y + (p.ay || 1);
          p.z = host.z + (p.az || 0);
        }
      } else if (!p.rest) {
        const ox = p.x;
        const oy = p.y;
        const oz = p.z;
        p.vy -= p.gravity * dt;
        const nx = ox + p.vx * dt;
        const ny = oy + p.vy * dt;
        const nz = oz + p.vz * dt;
        const dx = nx - ox;
        const dy = ny - oy;
        const dz = nz - oz;
        const len = Math.hypot(dx, dy, dz);
        if (len > 1e-5) {
          const d = { x: dx / len, y: dy / len, z: dz / len };
          let hit = col.raycast(ox, oy, oz, d.x, d.y, d.z, len, { penetrate: p.impact });
          let hitT = hit ? hit.t : Infinity;
          let hitEnt = null;
          if (p.impact) {
            // direct hits on soldiers/vehicles
            g.spatial.query((ox + nx) / 2, (oz + nz) / 2, len / 2 + 6, (e) => {
              if (e.id === p.ownerId) return;
              if (e.k === ENTITY.SOLDIER && e.life !== LIFE.DEAD && !e.vehicle && areHostile(p.faction, e.faction)) {
                const r = raySoldier({ x: ox, y: oy, z: oz }, d, Math.min(len, hitT), e);
                if (r && r.t < hitT) {
                  hitT = r.t;
                  hitEnt = e;
                }
              } else if (e.k === ENTITY.VEHICLE && e.state !== 3 && e.id !== p.ignoreVehicle) {
                const owner = g.get(p.ownerId);
                if (owner && owner.vehicle === e.id) return;
                const t = rayVehicle({ x: ox, y: oy, z: oz }, d, Math.min(len, hitT), e);
                if (t >= 0 && t < hitT) {
                  hitT = t;
                  hitEnt = e;
                }
              }
            });
          }
          if (hitT < Infinity) {
            const hx = ox + d.x * hitT;
            const hy = oy + d.y * hitT;
            const hz = oz + d.z * hitT;
            if (p.impact) {
              p.x = hx;
              p.y = hy;
              p.z = hz;
              this.detonate(p, hitEnt);
              continue;
            }
            // bounce
            let n;
            if (hit && hit.terrain) n = g.world.terrain.normalAt(hx, hz);
            else if (hit) n = col.boxNormal(hit.i, hx, hy, hz);
            else n = { x: 0, y: 1, z: 0 };
            const vd = p.vx * n.x + p.vy * n.y + p.vz * n.z;
            p.vx = (p.vx - 2 * vd * n.x) * 0.38;
            p.vy = (p.vy - 2 * vd * n.y) * 0.3;
            p.vz = (p.vz - 2 * vd * n.z) * 0.38;
            p.x = hx + n.x * 0.06;
            p.y = hy + n.y * 0.06;
            p.z = hz + n.z * 0.06;
            if (Math.hypot(p.vx, p.vy, p.vz) < 1.2 && n.y > 0.5) {
              p.rest = true;
              p.vx = p.vy = p.vz = 0;
            }
          } else {
            p.x = nx;
            p.y = ny;
            p.z = nz;
          }
          if (p.y < SEA_LEVEL - 0.5 && g.world.terrain.heightAt(p.x, p.z) < SEA_LEVEL) {
            // splashed into water
            if (p.impact) {
              this.detonate(p, null);
              continue;
            }
            p.vx *= 0.5;
            p.vz *= 0.5;
            p.vy = Math.max(p.vy, -2);
          }
        }
      }
      if (g.time >= p.fuseAt) this.detonate(p, null);
    }
    // smoke expiry
    if (this.smokes.length) this.smokes = this.smokes.filter((s) => s.until > g.time);
    // delayed strikes
    if (this.strikes.length) {
      const due = this.strikes.filter((s) => s.at <= g.time);
      this.strikes = this.strikes.filter((s) => s.at > g.time);
      for (const st of due) {
        const y = g.world.terrain.heightAt(st.x, st.z) + 90;
        g.addProjectile(st.type === 'smoke' ? 'smoke' : 'mortar', {
          x: st.x, y, z: st.z, vx: 0, vy: -70, vz: 0, gravity: 10, impact: true, ownerId: st.ownerId, faction: st.faction,
          weaponId: st.type === 'smoke' ? 'smoke' : 'artillery', fuseAt: g.time + 6,
        });
      }
    }
    // soldiers: suppression decay, bleedout, regen, bloom
    for (const s of g.soldiers) {
      if (s.suppression > 0) s.suppression = Math.max(0, s.suppression - dt * 0.35);
      if (s.bloom > 0) {
        const w = s.weaponDef;
        s.bloom = Math.max(0, s.bloom - dt * (w ? w.bloomRecover || 6 : 6));
      }
      if (s.life === LIFE.DOWNED) {
        if (g.time >= s.bleedoutAt) this.kill(s, null, {});
      } else if (s.life === LIFE.ALIVE) {
        const role = ROLES[s.role];
        const cap = role && role.perks.selfRegenCap ? role.perks.selfRegenCap : HEALTH.regenCap;
        if (s.health < cap && g.time - s.lastDamageAt > HEALTH.regenDelay) s.health = Math.min(cap, s.health + HEALTH.regenRate * dt);
      }
    }
    // ammo bags / crates resupply nearby friendlies
    if (g.tickCount % 20 === 0) {
      for (const p of g.props) {
        if (p.kind !== PROP_KIND.AMMO_BAG && p.kind !== PROP_KIND.SUPPLY_CRATE) continue;
        if (p.carriedBy || p.falling) continue;
        if (p.kind === PROP_KIND.SUPPLY_CRATE && !p.data.resupply) continue;
        const r = p.kind === PROP_KIND.AMMO_BAG ? 6 : 8;
        const owner = p.ownerId ? g.get(p.ownerId) : null;
        for (const s of g.soldiersNear(p.x, p.z, r)) {
          if (s.life !== LIFE.ALIVE || s.faction !== p.faction) continue;
          this.resupply(s, owner, p.kind === PROP_KIND.AMMO_BAG ? 0.34 : 0.5);
        }
      }
    }
    // props falling (drops) & expiry
    for (const p of [...g.props]) {
      if (p.falling) {
        p.vy = Math.max(-9, p.vy - 6 * dt); // parachute
        p.y += p.vy * dt;
        const gy = g.world.colliders.groundHeight(p.x, p.z, p.y + 0.5);
        if (p.y <= gy) {
          p.y = gy;
          p.falling = false;
          p.vy = 0;
        }
      }
      if (p.expiresAt <= g.time) g.removeEntity(p);
    }
    // corpses
    for (const s of [...g.soldiers]) {
      if (s.life === LIFE.DEAD && g.time - s.deathAt > 9) {
        if (s.player && s.player.soldier === s) s.player.soldier = null;
        g.removeEntity(s);
      }
    }
  }

  detonate(p, hitEnt) {
    const g = this.game;
    const w = WEAPONS[p.weaponId] || {};
    g.removeEntity(p);
    if (p.type === 'smoke') {
      const r = w.smokeRadius || 11;
      this.smokes.push({ x: p.x, y: p.y, z: p.z, r, until: g.time + (w.smokeTime || 26) });
      g.emit(['smoke', r1(p.x), r1(p.y), r1(p.z), r, w.smokeTime || 26], { pos: p, range: 900 });
      return;
    }
    if (p.type === 'mortar') {
      this.explode(p.x, p.y, p.z, { radius: 9, damage: 120, vehicleDamage: 380, targetDamage: 250, ownerId: p.ownerId, faction: p.faction, weaponId: 'artillery' });
      return;
    }
    if (hitEnt && hitEnt.k === ENTITY.SOLDIER) {
      // direct rocket hit
      const owner = g.get(p.ownerId);
      this.applyDamage(hitEnt, (w.splashDamage || 100) * 1.3, owner, { explosive: true, weaponId: w.id, session: owner && owner.player });
    }
    this.explode(p.x, p.y, p.z, {
      radius: w.splash || 6, damage: w.splashDamage || 100, vehicleDamage: w.vehicleDamage || 0, targetDamage: w.targetDamage,
      ownerId: p.ownerId, faction: p.faction, weaponId: w.id,
    });
  }

  // Line of sight test used by AI: world geometry + smoke.
  losClear(ax, ay, az, bx, by, bz) {
    for (const s of this.smokes) {
      const d = rayPointDist({ x: ax, y: ay, z: az }, norm(bx - ax, by - ay, bz - az), Math.hypot(bx - ax, by - ay, bz - az), s);
      if (d.dist < s.r * 0.8) return false;
    }
    return this.game.world.colliders.lineOfSight(ax, ay, az, bx, by, bz);
  }

  inSmoke(x, z) {
    for (const s of this.smokes) if (dist2D(x, z, s.x, s.z) < s.r * 0.8) return true;
    return false;
  }

  spot(target, faction, bySession, duration) {
    const g = this.game;
    if (!target || target.life === LIFE.DEAD || !areHostile(faction, target.faction)) return false;
    const fresh = target.spottedUntil < g.time;
    target.spottedUntil = g.time + duration;
    if (bySession) target.spottedBy = bySession.id;
    target.infoVersion++;
    return fresh;
  }

  dropCarried(s) {
    if (!s.carrying) return;
    const p = this.game.get(s.carrying);
    s.carrying = 0;
    if (p) {
      p.carriedBy = 0;
      p.x = s.x;
      p.z = s.z;
      p.y = this.game.world.colliders.groundHeight(s.x, s.z, s.y + 0.5);
      p.expiresAt = this.game.time + 240;
    }
  }

  aimPointOf(s, head) {
    return aimPoint(s, head);
  }
}

function r1(v) {
  return Math.round(v * 10) / 10;
}

function norm(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

function g_award(game, sess, xp, reason, pos) {
  game.progression.award(sess, { xp, reason, cat: 'support', pos, silent: true });
}

export { PENETRABLE };
