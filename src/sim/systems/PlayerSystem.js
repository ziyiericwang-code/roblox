// Player soldier handling: validated movement input, reloads, weapon switching,
// timed actions (revive / heal / repair / plant / carry / rescue), gadgets.
import { LIFE, STANCE, MOVE, BODY, PROP_KIND, SEA_LEVEL, areHostile, HEALTH } from '../../shared/constants.js';
import { WEAPONS } from '../../shared/config/weapons.js';
import { XP } from '../../shared/config/economy.js';
import { maxHorizontalSpeed, eyeHeight } from '../../shared/physics.js';
import { EMOTE_CODE } from '../../shared/combat.js';
import { MSG, V } from '../../shared/protocol.js';
import { clamp, dist2D, dist3, dirFromYawPitch, rayPointDist } from '../../shared/math.js';

const ACTION_RANGE = { revive: 2.8, heal: 3.2, repair: 6, plant: 3.5, pickup: 2.8, rescue: 2.8 };

export class PlayerSystem {
  constructor(game) {
    this.game = game;
  }

  // ------------------------------------------------------------------ movement
  onInput(session, msg) {
    const g = this.game;
    const s = session.soldier;
    if (!V.int(msg.s, 0, 0x7fffffff)) return;
    if (msg.s <= session.lastInputSeq && session.lastInputSeq - msg.s < 1e6) return;
    session.lastInputSeq = msg.s;
    session.lastInputAt = g.time;
    if (V.vec(msg.p)) session.viewPos = { x: msg.p[0], z: msg.p[2] };
    if (!s || s.life === LIFE.DEAD) return;
    if (V.num(msg.y, -10, 10)) s.yaw = msg.y;
    if (V.num(msg.pi, -1.6, 1.6)) s.pitch = msg.pi;
    if (s.life === LIFE.DOWNED) {
      s.stance = STANCE.PRONE;
      s.lean = 0;
      s.sprint = false;
      s.ads = false;
    } else {
      if (V.int(msg.st, 0, 2) && !s.vehicle) {
        if (msg.st === STANCE.STAND && s.stance !== STANCE.STAND) {
          // cannot stand up under a low ceiling (crawl obstacles)
          const ceil = g.world.colliders.ceilingAbove(s.x, s.z, s.y + 0.3);
          if (ceil - s.y >= BODY.standHeight - 0.05) s.stance = msg.st;
        } else s.stance = msg.st;
      }
      s.lean = V.int(msg.ln, -1, 1) && !s.sprint && s.stance !== STANCE.PRONE ? msg.ln : 0;
      s.sprint = !!msg.sp && s.stance === STANCE.STAND && !s.carrying;
      s.ads = !!msg.ad && !s.sprint;
      if (s.sprint && s.action) this.cancelAction(s);
    }
    if (s.emote && (msg.mv || s.sprint)) s.emote = 0;
    if (s.vehicle) return; // position comes from the vehicle
    if (!V.vec(msg.p) || !V.vec(msg.v, 200)) return;
    const nx = msg.p[0];
    const ny = msg.p[1];
    const nz = msg.p[2];
    const dt = clamp(g.time - (s.lastMoveT || g.time - 0.05), 0.02, 1.0);
    s.lastMoveT = g.time;
    const maxH = maxHorizontalSpeed(s.stance, s.life === LIFE.DOWNED) * 1.3 + 0.9;
    session.moveBudget = Math.min(5, session.moveBudget + maxH * dt * 0.25);
    const horiz = dist2D(nx, nz, s.x, s.z);
    const allowed = maxH * dt + 0.35 + session.moveBudget;
    const col = g.world.colliders;
    let bad = null;
    if (horiz > allowed) bad = 'speed';
    const dy = ny - s.y;
    if (!bad && dy > MOVE.jumpVel * dt + BODY.stepHeight + 0.6) {
      const ground = col.groundHeight(nx, nz, ny);
      if (ny - ground > 0.4) bad = 'vertical';
    }
    if (!bad && col.pointInSolid(nx, ny + (s.stance === STANCE.PRONE ? 0.3 : 0.9), nz)) bad = 'solid';
    if (!bad && g.hierarchy.blockedFor(session, nx, ny, nz)) bad = 'restricted';
    if (!bad) {
      const ground = col.groundHeight(nx, nz, ny);
      if (ny - ground > 3 && msg.v[1] > -3 && !(ny < SEA_LEVEL + 0.5)) {
        s.airTime = (s.airTime || 0) + dt;
        if (s.airTime > 2.4) bad = 'flying';
      } else s.airTime = 0;
      if (ny < ground - 1.5) bad = 'underground';
    }
    if (bad) {
      if (bad === 'flying' || bad === 'underground') {
        // the last accepted position may itself be airborne: put them back on the ground
        s.y = col.groundHeight(s.x, s.z, s.y + 0.5);
        s.airTime = 0;
      }
      if (horiz > 0.05 || bad !== 'speed') {
        if (bad === 'restricted') g.hierarchy.onRestricted(session, nx, ny, nz);
        else session.violations += bad === 'speed' && horiz < allowed * 1.6 ? 0.05 : 0.4;
        session.send({ t: MSG.CORRECT, p: [r2(s.x), r2(s.y), r2(s.z)] });
      }
      return;
    }
    session.moveBudget = Math.max(0, session.moveBudget - Math.max(0, horiz - maxH * dt));
    // fall damage (server derives it from reported landing)
    const vy = msg.v[1];
    if ((s.prevVy || 0) < -13.5 && msg.g && vy > -1) {
      const dmg = (Math.abs(s.prevVy) - 12) * 9;
      if (dmg > 5) g.combat.applyDamage(s, dmg, null, { noDown: false });
    }
    s.prevVy = vy;
    s.x = nx;
    s.y = ny;
    s.z = nz;
    s.vx = clamp(msg.v[0], -20, 20);
    s.vy = clamp(msg.v[1], -60, 20);
    s.vz = clamp(msg.v[2], -20, 20);
    s.grounded = !!msg.g;
    s.swimming = g.world.terrain.waterDepthAt(nx, nz) > 1.25 && ny < SEA_LEVEL - 0.5;
    if (horiz > 0.01) s.lastMovedAt = g.time;
  }

  // ------------------------------------------------------------------ weapons
  onReload(session) {
    const s = session.soldier;
    if (!s || !s.alive) return;
    if (this.startReload(s)) this.game.training.onReload(session);
  }

  startReload(s) {
    const ws = s.weapon;
    const w = ws && WEAPONS[ws.id];
    if (!w || (w.kind !== 'gun' && w.kind !== 'launcher')) return false;
    if (s.reloadUntil > this.game.time) return false;
    if (ws.mag >= w.mag || ws.reserve <= 0) return false;
    s.reloadUntil = this.game.time + w.reload;
    s.reloadSlot = s.slot;
    return true;
  }

  onSwitch(session, msg) {
    const s = session.soldier;
    if (!s || !s.alive || s.vehicle) return;
    if (!V.int(msg.slot, 0, 4) || !s.weapons[msg.slot]) return;
    if (msg.slot === s.slot) return;
    const w = WEAPONS[s.weapons[msg.slot].id];
    s.slot = msg.slot;
    s.reloadUntil = 0;
    s.ads = false;
    s.switchUntil = this.game.time + (w ? w.equipTime || 0.4 : 0.4) * 0.9;
    if (s.carrying && w && w.kind !== 'gadget') s.switchUntil += 0;
  }

  sendLoadout(session) {
    const s = session.soldier;
    if (!s) return;
    session.send({ t: MSG.LOADOUT, slot: s.slot, weapons: s.weapons.map((w) => ({ id: w.id, mag: w.mag, reserve: w.reserve, count: w.count })), armor: Math.round(s.armor), maxArmor: s.maxArmor });
  }

  // ------------------------------------------------------------------ actions
  onAction(session, msg) {
    const g = this.game;
    const s = session.soldier;
    if (!s || !s.alive) return;
    if (msg.a === 'stop') {
      if (s.action) this.cancelAction(s);
      return;
    }
    if (msg.a !== 'start' || !V.str(msg.type, 16)) return;
    const target = V.int(msg.target, 0, 65535) ? g.get(msg.target) : null;
    const type = msg.type;
    if (type === 'drop') {
      g.combat.dropCarried(s);
      return;
    }
    if (type === 'load' || type === 'unload') {
      g.vehicleSys.cargoAction(s, target, type);
      return;
    }
    if (s.action || s.vehicle) return;
    const range = ACTION_RANGE[type];
    if (!range || !target) return;
    if (dist3(s, target) > range + (target.def ? target.def.halfSize[2] : 0)) return;
    let dur = 0;
    const gadget = (id) => s.weapons.find((w) => w.id === id);
    switch (type) {
      case 'revive': {
        if (target.k !== 1 || target.life !== LIFE.DOWNED || target.faction !== s.faction) return;
        const kit = gadget('medkit');
        dur = kit && kit.count > 0 ? 2.6 : 6.0;
        break;
      }
      case 'heal': {
        const kit = gadget('medkit');
        if (!kit || kit.count <= 0) return;
        if (target.k !== 1 || target.life !== LIFE.ALIVE || target.faction !== s.faction || target.health >= HEALTH.max) return;
        dur = Infinity;
        break;
      }
      case 'repair': {
        if (!gadget('repair')) return;
        if (target.k !== 2 || target.state === 3 || target.faction !== s.faction || target.health >= target.def.hp) return;
        dur = Infinity;
        break;
      }
      case 'plant': {
        const ch = gadget('charge');
        if (!ch || ch.count <= 0) return;
        const ok = (target.k === 4 && target.kind === PROP_KIND.TARGET && target.health > 0 && areHostile(s.faction, target.faction)) ||
          (target.k === 2 && target.state !== 3 && areHostile(s.faction, target.faction));
        if (!ok) return;
        dur = 3;
        break;
      }
      case 'pickup': {
        if (s.carrying || target.k !== 4 || target.kind !== PROP_KIND.SUPPLY_CRATE || target.carriedBy || target.falling) return;
        if (target.faction && target.faction !== s.faction) return;
        dur = 0.8;
        break;
      }
      case 'rescue': {
        if (target.k !== 1 || !target.captive || target.faction !== s.faction || target.life === LIFE.DEAD) return;
        dur = 3;
        break;
      }
      default:
        return;
    }
    s.action = { type, target: target.id, start: g.time, end: g.time + dur, x: s.x, z: s.z, last: g.time };
    s.sprint = false;
    g.emit(['action', type, dur === Infinity ? 0 : dur, target.id], { to: session });
    if (type === 'revive' && target.player) g.emit(['reviving', dur, s.name], { to: target.player });
  }

  cancelAction(s) {
    if (!s.action) return;
    const a = s.action;
    s.action = null;
    if (s.player) this.game.emit(['actionEnd', a.type, 0], { to: s.player });
  }

  updateAction(s, dt) {
    const g = this.game;
    const a = s.action;
    const target = g.get(a.target);
    const range = ACTION_RANGE[a.type] || 3;
    const fail = () => this.cancelAction(s);
    if (!target || s.life !== LIFE.ALIVE || s.vehicle) return fail();
    if (dist3(s, target) > range + 1 + (target.def ? target.def.halfSize[2] : 0)) return fail();
    if (a.end !== Infinity && dist2D(s.x, s.z, a.x, a.z) > 1.8) return fail();
    const sess = s.player;
    switch (a.type) {
      case 'revive':
        if (target.life !== LIFE.DOWNED) return fail();
        if (g.time >= a.end) {
          const kit = s.weapons.find((w) => w.id === 'medkit');
          const medic = !!(kit && kit.count > 0);
          if (medic) kit.count = Math.max(0, kit.count - 1);
          g.combat.revive(target, s, medic);
          s.action = null;
          if (sess) {
            g.emit(['actionEnd', 'revive', 1], { to: sess });
            this.sendLoadout(sess);
          }
        }
        break;
      case 'heal': {
        const kit = s.weapons.find((w) => w.id === 'medkit');
        if (!kit || kit.count <= 0 || target.life !== LIFE.ALIVE || target.health >= HEALTH.max) {
          s.action = null;
          if (sess) g.emit(['actionEnd', 'heal', 1], { to: sess });
          return;
        }
        const healed = g.combat.heal(target, 22 * dt, s);
        a.used = (a.used || 0) + healed;
        if (a.used >= 25) {
          a.used -= 25;
          kit.count -= 1;
          if (sess) this.sendLoadout(sess);
        }
        break;
      }
      case 'repair': {
        if (target.state === 3 || target.health >= target.def.hp) {
          s.action = null;
          if (sess) g.emit(['actionEnd', 'repair', 1], { to: sess });
          return;
        }
        const amt = Math.min(60 * dt, target.def.hp - target.health);
        g.vehicleSys.repair(target, amt);
        if (sess) {
          sess.repairAcc = (sess.repairAcc || 0) + amt;
          while (sess.repairAcc >= 50) {
            sess.repairAcc -= 50;
            g.progression.award(sess, { xp: XP.repairPer50, reason: 'Repair', cat: 'support', pos: target, silent: true });
            sess.repairUnits = (sess.repairUnits || 0) + 1;
            if (sess.repairUnits % 2 === 0) g.progression.addStat(sess, 'repairs', 1);
          }
        }
        if (g.tickCount % 10 === 0) g.emit(['sparks', r1(target.x), r1(target.y + 1), r1(target.z)], { pos: target, range: 120 });
        break;
      }
      case 'plant':
        if (g.time >= a.end) {
          const ch = s.weapons.find((w) => w.id === 'charge');
          if (!ch || ch.count <= 0) return fail();
          ch.count -= 1;
          const w = WEAPONS.charge;
          const p = g.addProjectile('charge', { x: target.x, y: target.y + 1, z: target.z, ownerId: s.id, faction: s.faction, weaponId: 'charge', fuseAt: g.time + w.fuse, gravity: 0 });
          p.attachedTo = target.id;
          p.ax = s.x - target.x > 0 ? 0.6 : -0.6;
          p.ay = 0.8;
          p.az = 0;
          p.rest = true;
          s.action = null;
          if (sess) {
            g.emit(['actionEnd', 'plant', 1], { to: sess });
            g.notify(sess, 'Charge planted. Get clear!', 'warn');
            this.sendLoadout(sess);
          }
        }
        break;
      case 'pickup':
        if (target.carriedBy) return fail();
        if (g.time >= a.end) {
          target.carriedBy = s.id;
          target.expiresAt = Infinity;
          s.carrying = target.id;
          s.action = null;
          if (sess) g.emit(['actionEnd', 'pickup', 1], { to: sess });
        }
        break;
      case 'rescue':
        if (!target.captive) return fail();
        if (g.time >= a.end) {
          s.action = null;
          g.missions.onRescue(target, s);
          if (sess) g.emit(['actionEnd', 'rescue', 1], { to: sess });
        }
        break;
      default:
        fail();
    }
  }

  // ------------------------------------------------------------------ gadgets
  onGadget(session, msg) {
    const g = this.game;
    const s = session.soldier;
    if (!s || !s.alive || s.vehicle) return;
    if (msg.g === 'ammobag') {
      const bag = s.weapons.find((w) => w.id === 'ammobag');
      if (!bag || bag.count <= 0 || s.nextAmmoBagAt > g.time) return;
      bag.count -= 1;
      s.nextAmmoBagAt = g.time + WEAPONS.ammobag.cooldown;
      g.addProp(PROP_KIND.AMMO_BAG, { x: s.x, y: s.y, z: s.z, faction: s.faction, ownerId: s.id, expiresAt: g.time + WEAPONS.ammobag.lifetime });
      this.sendLoadout(session);
      return;
    }
    if (msg.g === 'spot') {
      if (s.nextSpotAt > g.time || !V.vec(msg.d, 2)) return;
      const hasBino = s.weapon && s.weapon.id === 'binoculars';
      s.nextSpotAt = g.time + (hasBino ? 1.5 : 3);
      const range = hasBino ? WEAPONS.binoculars.spotRange : 160;
      const cone = hasBino ? 0.07 : 0.045;
      const eye = { x: s.x, y: s.y + eyeHeight(s.stance), z: s.z };
      let d = { x: msg.d[0], y: msg.d[1], z: msg.d[2] };
      const l = Math.hypot(d.x, d.y, d.z) || 1;
      d = { x: d.x / l, y: d.y / l, z: d.z / l };
      const aim = dirFromYawPitch(s.yaw, s.pitch);
      if (aim.x * d.x + aim.y * d.y + aim.z * d.z < 0.9) return;
      const scout = s.role === 'scout';
      let spotted = 0;
      const candidates = [];
      g.spatial.query(eye.x + d.x * range * 0.5, eye.z + d.z * range * 0.5, range * 0.5 + 10, (e) => {
        if (e.k !== 1 && e.k !== 2) return;
        if (!areHostile(s.faction, e.faction) || (e.k === 1 && e.life === LIFE.DEAD) || (e.k === 2 && e.state === 3)) return;
        const c = { x: e.x, y: e.y + 1.1, z: e.z };
        const rp = rayPointDist(eye, d, range, c);
        if (rp.dist > Math.max(2, rp.t * cone)) return;
        candidates.push({ e, c, t: rp.t });
      });
      candidates.sort((a, b) => a.t - b.t);
      for (const { e, c } of candidates.slice(0, 6)) {
        if (!g.combat.losClear(eye.x, eye.y, eye.z, c.x, c.y, c.z)) continue;
        const fresh = g.combat.spot(e, s.faction, session, (hasBino ? WEAPONS.binoculars.spotTime : 12) * (scout ? 1.5 : 1));
        if (fresh) spotted++;
      }
      if (spotted > 0) {
        g.progression.award(session, { xp: XP.spotted * spotted, reason: `Spotted ${spotted}`, cat: 'support', pos: s, stats: { spots: spotted } });
        g.emit(['spotted', spotted], { to: session });
        g.missions.onPlayerAction(session, 'spot', spotted * 2, s);
      }
    }
  }

  onEmote(session, msg) {
    const s = session.soldier;
    if (!s || !s.alive || s.vehicle || !V.str(msg.id, 16)) return;
    if (!session.profile.unlocks.emote.includes(msg.id)) return;
    const code = EMOTE_CODE[msg.id];
    if (!code) return;
    s.emote = code;
    s.emoteUntil = this.game.time + (msg.id === 'attention' || msg.id === 'at_ease' ? 6 : 2.6);
  }

  // Give up while downed, or return to the deployment screen when out of combat.
  onReturn(session) {
    const g = this.game;
    const s = session.soldier;
    if (!s) return;
    if (s.life === LIFE.DOWNED) {
      g.combat.kill(s, null, {});
      return;
    }
    if (s.life !== LIFE.ALIVE) return;
    const safe = g.time - s.lastDamageAt > 10 || g.isBaseArea(s.x, s.z, s.faction);
    if (!safe) {
      g.notify(session, 'Cannot redeploy while under fire.', 'warn');
      return;
    }
    g.vehicleSys.ejectSoldier(s, true);
    g.combat.dropCarried(s);
    g.progression.endDeployment(session, 'redeploy');
    g.removeEntity(s);
    session.soldier = null;
    session.state = 'menu';
    session.canDeployAt = g.time + 2;
    g.deploySys.sendOptions(session);
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const g = this.game;
    for (const session of g.sessions) {
      const s = session.soldier;
      if (!s) continue;
      if (s.action) this.updateAction(s, dt);
      if (s.reloadUntil && g.time >= s.reloadUntil) {
        const ws = s.weapons[s.reloadSlot];
        const w = ws && WEAPONS[ws.id];
        if (w && s.slot === s.reloadSlot) {
          const need = w.mag - ws.mag;
          const take = Math.min(need, ws.reserve);
          ws.mag += take;
          ws.reserve -= take;
        }
        s.reloadUntil = 0;
        this.sendLoadout(session);
      }
      if (s.emote && g.time > s.emoteUntil) s.emote = 0;
      // carried crate follows its carrier
      if (s.carrying) {
        const p = g.get(s.carrying);
        if (p) {
          p.x = s.x;
          p.y = s.y + 1.2;
          p.z = s.z;
        } else s.carrying = 0;
      }
    }
    // NPC timed actions (medics) use the same code path
    for (const s of g.soldiers) {
      if (!s.player && s.action) this.updateAction(s, dt);
    }
  }
}

function r2(v) {
  return Math.round(v * 100) / 100;
}
function r1(v) {
  return Math.round(v * 10) / 10;
}
