// Dynamic missions generated from the live war state. Each mission tracks
// per-player contribution; rewards scale with contribution so passengers and
// AFK players do not profit. Outcomes feed back into the war (supply, intel,
// captured sectors, lost territory...).
import { FACTION, LIFE, PROP_KIND, enemyOf } from '../../shared/constants.js';
import { MISSION_TYPES, CALLSIGNS, VIP_NAMES, OPERATION_NAMES, DIFFICULTY_NAMES } from '../../shared/config/missions.js';
import { GAME } from '../../shared/config/game.js';
import { XP, CREDITS, LEADERSHIP } from '../../shared/config/economy.js';
import { COMMAND_POINTS } from '../../shared/config/commands.js';
import { MSG, V } from '../../shared/protocol.js';
import { Rng, dist2D, clamp } from '../../shared/math.js';

const F = FACTION.COALITION; // missions are issued to the player army
const E = FACTION.DOMINION;

export class MissionSystem {
  constructor(game) {
    this.game = game;
    this.missions = new Map();
    this.nextId = 1;
    this.version = 1;
    this.genTimer = 3;
    this.rng = new Rng(777);
    this.runId = Math.floor(Math.random() * 1e9).toString(36);
    this.recent = new Map(); // key -> time (cooldowns per type/territory)
    this.operations = new Map();
    this.nextOpId = 1;
  }

  init() {}

  get(id) {
    return this.missions.get(id) || null;
  }

  active() {
    return [...this.missions.values()].filter((m) => m.status === 'active');
  }

  changed() {
    this.version++;
  }

  // ------------------------------------------------------------------ creation
  fill(template, vars) {
    return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ''));
  }

  create(type, p) {
    const g = this.game;
    const T = MISSION_TYPES[type];
    const terr = p.tid ? g.world.tById[p.tid] : null;
    const vars = { territory: terr ? terr.name : '', sector: p.sectorName || '', place: p.place || (terr ? terr.name : ''), target: p.target || '', callsign: p.callsign || '', vip: p.vip || '', minutes: p.minutes || '' };
    const difficulty = clamp(Math.round(p.difficulty ?? T.baseDifficulty + (terr && terr.value >= 2 ? 1 : 0)), 1, 5);
    const m = {
      id: this.nextId++,
      type,
      title: p.title || this.fill(this.rng.pick(T.titles), vars),
      brief: this.fill(T.brief, vars),
      tid: p.tid || null,
      x: p.x ?? (terr ? terr.x : 0),
      z: p.z ?? (terr ? terr.z : 0),
      r: p.r ?? 45,
      difficulty,
      recRank: Math.max(T.recRank, difficulty >= 4 ? 4 : difficulty >= 3 ? 2 : 1),
      startedAt: g.time,
      endsAt: g.time + (p.time ?? T.time),
      status: 'active',
      result: '',
      contrib: new Map(),
      expected: p.expected ?? 30,
      data: p.data || {},
      opId: p.opId || 0,
      eventId: p.eventId || 0,
      bonus: p.bonus || 1,
      progress: '',
      endedAt: 0,
    };
    m.rewards = { xp: Math.round(XP.missionBase[difficulty] * m.bonus * (m.opId ? 1.2 : 1)), credits: Math.round(CREDITS.missionBase[difficulty] * m.bonus) };
    this.missions.set(m.id, m);
    this.setup(m);
    this.recent.set(`${type}:${m.tid}`, g.time);
    g.radio(F, 'intel', 'Operations', `New mission: ${m.title} (${DIFFICULTY_NAMES[m.difficulty]}).`);
    this.changed();
    return m;
  }

  setup(m) {
    const g = this.game;
    const d = m.data;
    switch (m.type) {
      case 'defend': {
        g.npc.launchAssault(E, d.tid, d.sid, d.waves || 2, m.id);
        break;
      }
      case 'convoy': {
        const trucks = g.vehicleSys.spawnConvoy(F, d.route, 2, m.id);
        d.trucks = trucks.map((v) => v.id);
        if (!trucks.length) this.finish(m, false, 'Convoy could not depart');
        else {
          const amb = d.route[Math.floor(d.route.length * 0.55)];
          if (amb) g.npc.spawnSquad(E, amb.x + 25, amb.z + 20, { type: 'ambush', x: amb.x, z: amb.z, r: 30 }, { size: 5, mission: m.id, special: true });
        }
        break;
      }
      case 'destroy': {
        d.targets = [];
        const variant = MISSION_TYPES.destroy.targets.indexOf(d.targetName);
        for (let i = 0; i < (d.count || 1); i++) {
          const x = m.x + (i ? this.rng.float(-12, 12) : 0);
          const z = m.z + (i ? this.rng.float(-12, 12) : 0);
          const y = g.world.colliders.groundHeight(x, z, 300);
          const p = g.addProp(PROP_KIND.TARGET, { x, y, z, faction: E, health: 600, variant: Math.max(0, variant), data: { mission: m.id } });
          d.targets.push(p.id);
        }
        g.npc.spawnSquad(E, m.x + 10, m.z + 10, { type: 'defend', x: m.x, z: m.z, r: 25 }, { size: 5, mission: m.id, special: true });
        break;
      }
      case 'rescue': {
        d.captives = [];
        for (let i = 0; i < 3; i++) {
          const c = g.npc.spawnCaptive(F, m.x + this.rng.float(-4, 4), m.z + this.rng.float(-4, 4), m.id);
          if (c) d.captives.push(c.id);
        }
        d.extracted = 0;
        d.extract = g.commands.nearestFriendlyAnchor(F, m.x, m.z);
        g.npc.spawnSquad(E, m.x + 15, m.z - 12, { type: 'defend', x: m.x, z: m.z, r: 25 }, { size: 4, mission: m.id, special: true });
        break;
      }
      case 'secure': {
        g.npc.spawnSquad(E, m.x, m.z, { type: 'defend', x: m.x, z: m.z, r: 25 }, { size: 6, mission: m.id, special: true });
        d.clearFor = 0;
        d.touched = false;
        break;
      }
      case 'hold': {
        d.held = 0;
        d.need = d.need || 180;
        d.nextWave = this.game.time + 25;
        break;
      }
      case 'recon': {
        const t = g.world.tById[m.tid];
        d.points = t.overlooks.slice(0, 3).map((o) => ({ x: o.x, z: o.z, prog: 0, done: false }));
        break;
      }
      case 'supply': {
        const base = g.world.bases[F];
        const yard = base.markers.find((mk) => mk.type === 'spawn_yard') || base;
        d.crates = [];
        for (let i = 0; i < d.need + 1; i++) {
          const x = yard.x + 14 + (i % 3) * 1.6;
          const z = yard.z - 6 + Math.floor(i / 3) * 1.6;
          const p = g.addProp(PROP_KIND.SUPPLY_CRATE, { x, y: g.world.colliders.groundHeight(x, z, 300), z, faction: F, data: { mission: m.id } });
          d.crates.push(p.id);
        }
        d.delivered = 0;
        break;
      }
      case 'vip': {
        const vip = g.npc.spawnVip(F, d.start.x, d.start.z, d.dest, m.id, d.vipName);
        d.vipId = vip ? vip.id : 0;
        if (!vip) this.finish(m, false, 'VIP transport cancelled');
        else {
          const mid = { x: (d.start.x + d.dest.x) / 2, z: (d.start.z + d.dest.z) / 2 };
          g.npc.spawnSquad(E, mid.x + 30, mid.z + 20, { type: 'ambush', x: mid.x, z: mid.z, r: 35 }, { size: 5, mission: m.id, special: true });
        }
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ generation
  generate() {
    const g = this.game;
    const war = g.war;
    const act = this.active();
    const cands = [];
    const cool = (key, secs) => g.time - (this.recent.get(key) ?? -1e9) > secs;
    const has = (pred) => act.some(pred);
    const prio = war.priority[F] && war.priority[F].until > g.time ? war.priority[F].territory : null;
    const off = g.commands.offensiveFor(F);
    const boost = (tid) => (tid === prio ? 3 : 1) * (off && off.territory === tid ? 2 : 1);
    for (const b of war.battles.values()) {
      const w = war.get(b.territory);
      const t = w.def;
      if (b.attacker === F) {
        for (const s of w.sectors) {
          if (s.owner === F) continue;
          if (has((m) => m.type === 'capture' && m.data.tid === t.id && m.data.sid === s.id)) continue;
          cands.push({ w: 6 * boost(t.id), make: () => this.create('capture', { tid: t.id, sectorName: s.def.name, x: s.def.x, z: s.def.z, r: s.def.r * 1.6, data: { tid: t.id, sid: s.id }, expected: 30 }) });
        }
        if (cool(`destroy:${t.id}`, 420) && !has((m) => m.type === 'destroy' && m.tid === t.id)) cands.push({ w: 2 * boost(t.id), make: () => this.makeDestroy(t) });
        if (cool(`recon:${t.id}`, 600)) cands.push({ w: 1.4 * boost(t.id), make: () => this.create('recon', { tid: t.id, expected: 20 }) });
        if (cool(`rescue:${t.id}`, 600)) cands.push({ w: 1.1, make: () => this.makeRescue(t) });
        if (cool(`secure:${t.id}`, 300)) cands.push({ w: 1.3 * boost(t.id), make: () => this.makeSecure(t) });
      } else if (w.owner === F) {
        for (const s of w.sectors) {
          if (s.owner !== F) continue;
          if (has((m) => m.type === 'defend' && m.data.tid === t.id && m.data.sid === s.id)) continue;
          if (!cool(`defend:${t.id}:${s.id}`, 180)) continue;
          cands.push({ w: 5 * boost(t.id), make: () => {
            this.recent.set(`defend:${t.id}:${s.id}`, g.time);
            return this.create('defend', { tid: t.id, sectorName: s.def.name, x: s.def.x, z: s.def.z, r: s.def.r * 1.8, data: { tid: t.id, sid: s.id, waves: 2 }, expected: 25 });
          } });
          if (/Bridge/.test(s.def.name) && cool(`hold:${t.id}`, 400)) {
            cands.push({ w: 2.5, make: () => this.create('hold', { tid: t.id, place: s.def.name, title: 'Hold the Bridge', x: s.def.x, z: s.def.z, r: 32, minutes: 3, data: { need: 180 }, expected: 30 }) });
          }
        }
        if (cool(`vip:${t.id}`, 900)) cands.push({ w: 0.9, make: () => this.makeVip(t) });
      }
    }
    // logistics for friendly front territories
    for (const w of war.map.values()) {
      const t = w.def;
      if (t.isBase || w.owner !== F) continue;
      const frontline = t.adjacent.some((a) => war.ownerOf(a) === E);
      if (!frontline) continue;
      if (w.supply < 65 && cool(`supply:${t.id}`, 420) && !has((m) => m.type === 'supply')) cands.push({ w: 2.2 * (w.supply < 30 ? 2 : 1), make: () => this.makeSupply(t) });
      if (cool(`convoy:${t.id}`, 700) && !has((m) => m.type === 'convoy')) cands.push({ w: 1.2, make: () => this.makeConvoy(t) });
    }
    // enemy front territories without an active battle: scouting and sabotage
    for (const w of war.map.values()) {
      const t = w.def;
      if (!war.isFront(t.id, F)) continue;
      if ([...war.battles.values()].some((b) => b.territory === t.id)) continue;
      if (cool(`recon:${t.id}`, 700)) cands.push({ w: 0.8 * boost(t.id), make: () => this.create('recon', { tid: t.id, expected: 20 }) });
      if (cool(`destroy:${t.id}`, 700)) cands.push({ w: 0.6 * boost(t.id), make: () => this.makeDestroy(t) });
      for (const s of w.sectors) {
        if (s.owner === F || has((m) => m.type === 'capture' && m.data.sid === s.id && m.data.tid === t.id)) continue;
        cands.push({ w: 0.7 * boost(t.id), make: () => this.create('capture', { tid: t.id, sectorName: s.def.name, x: s.def.x, z: s.def.z, r: s.def.r * 1.6, data: { tid: t.id, sid: s.id }, expected: 30 }) });
      }
    }
    if (!cands.length) return null;
    const pick = this.rng.weighted(cands.map((c) => ({ w: c.w, v: c })));
    return pick ? pick.make() : null;
  }

  makeDestroy(t) {
    const g = this.game;
    const name = this.rng.pick(MISSION_TYPES.destroy.targets);
    // somewhere near the territory, off the sector flags
    const a = this.rng.float(0, Math.PI * 2);
    let p = { x: t.x + Math.cos(a) * t.radius * 0.6, z: t.z + Math.sin(a) * t.radius * 0.6 };
    if (g.world.nav) p = g.world.nav.randomPointNear(p.x, p.z, 25, () => this.rng.next());
    return this.create('destroy', { tid: t.id, target: name, x: p.x, z: p.z, r: 40, data: { targetName: name, count: name === 'Fuel Depot' ? 2 : 1 }, expected: 25, difficulty: 3 });
  }

  makeRescue(t) {
    const g = this.game;
    const s = this.rng.pick(t.sectors);
    let p = { x: s.x + this.rng.float(-50, 50), z: s.z + this.rng.float(-50, 50) };
    if (g.world.nav) p = g.world.nav.randomPointNear(p.x, p.z, 20, () => this.rng.next());
    return this.create('rescue', { tid: t.id, sectorName: s.name, callsign: this.rng.pick(CALLSIGNS), x: p.x, z: p.z, r: 40, expected: 25 });
  }

  makeSecure(t) {
    const g = this.game;
    const a = this.rng.float(0, Math.PI * 2);
    let p = { x: t.x + Math.cos(a) * t.radius * 0.5, z: t.z + Math.sin(a) * t.radius * 0.5 };
    if (g.world.nav) p = g.world.nav.randomPointNear(p.x, p.z, 20, () => this.rng.next());
    const place = `${this.rng.pick(['the Crossroads', 'the Ridge Line', 'the Outskirts', 'the Old Quarter', 'the Tree Line', 'the Depot'])}, ${t.name}`;
    return this.create('secure', { tid: t.id, place, x: p.x, z: p.z, r: 45, expected: 22 });
  }

  makeSupply(t) {
    const cp = t.commandPost;
    return this.create('supply', { tid: t.id, x: cp.x, z: cp.z, r: 20, data: { need: 3, dest: { x: cp.x, z: cp.z }, tid: t.id }, expected: 18, difficulty: 1 });
  }

  makeConvoy(t) {
    const g = this.game;
    const route = g.world.routeBetween('hq_coalition', t.id);
    if (!route || route.length < 5) return null;
    return this.create('convoy', { tid: t.id, x: route[route.length - 1].x, z: route[route.length - 1].z, r: 40, data: { route, tid: t.id }, expected: 20 });
  }

  makeVip(t) {
    const g = this.game;
    const base = g.world.bases[F];
    const start = { x: base.spawns[0].x, z: base.spawns[0].z };
    const dest = { x: t.commandPost.x, z: t.commandPost.z };
    const vip = this.rng.pick(VIP_NAMES);
    return this.create('vip', { tid: t.id, vip, vipName: `Col. ${vip}`, x: dest.x, z: dest.z, r: 30, data: { start, dest, vipName: `Col. ${vip}` }, expected: 25 });
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const g = this.game;
    this.genTimer -= dt;
    if (this.genTimer <= 0) {
      this.genTimer = 8;
      const n = this.active().length;
      if (n < GAME.missionTarget) this.generate();
      // cleanup finished missions after a short display period
      for (const [id, m] of this.missions) {
        if (m.status !== 'active' && g.time - m.endedAt > 20) {
          this.missions.delete(id);
          this.changed();
        }
      }
    }
    for (const m of this.active()) {
      this.updateMission(m, dt);
      if (m.status === 'active' && g.time >= m.endsAt) this.timeout(m);
    }
    for (const op of this.operations.values()) {
      if (op.status !== 'active') continue;
      if (g.war.ownerOf(op.tid) === F) this.finishOperation(op, true);
      else if (g.time > op.endsAt) this.finishOperation(op, false);
    }
  }

  updateMission(m, dt) {
    const g = this.game;
    const d = m.data;
    const war = g.war;
    switch (m.type) {
      case 'capture': {
        const w = war.get(d.tid);
        const s = w && w.sectors.find((x) => x.id === d.sid);
        if (!s) return this.finish(m, false, 'Objective no longer valid');
        m.progress = `${Math.round(Math.max(0, s.progress))}%`;
        if (s.owner === F) this.finish(m, true, 'Objective captured');
        break;
      }
      case 'defend': {
        const w = war.get(d.tid);
        const s = w && w.sectors.find((x) => x.id === d.sid);
        if (!s || s.owner === E) return this.finish(m, false, 'Position overrun');
        m.progress = `${Math.max(0, Math.round(m.endsAt - g.time))}s`;
        break;
      }
      case 'convoy': {
        const trucks = d.trucks.map((id) => g.get(id)).filter((v) => v && v.state !== 3);
        if (!trucks.length) return this.finish(m, false, 'Convoy destroyed');
        const dest = d.route[d.route.length - 1];
        m.x = trucks[0].x;
        m.z = trucks[0].z;
        m.progress = `${trucks.length} truck${trucks.length > 1 ? 's' : ''}`;
        if (trucks.some((v) => dist2D(v.x, v.z, dest.x, dest.z) < 40)) {
          war.addSupply(d.tid, 40, F);
          war.cp[F] = Math.min(war.cpMax(F), war.cp[F] + 8);
          for (const v of trucks) g.vehicleSys.retire(v);
          this.finish(m, true, 'Convoy arrived');
          break;
        }
        if (g.tickCount % 100 === 0) {
          for (const v of trucks) {
            for (const s of g.soldiersNear(v.x, v.z, 45, (e) => e.player && e.faction === F && e.life === LIFE.ALIVE)) {
              this.contribute(m, s.player, 2);
              g.progression.award(s.player, { xp: XP.escortTick, reason: 'Escort', cat: 'objective', pos: s, silent: true });
            }
          }
        }
        break;
      }
      case 'destroy': {
        const left = d.targets.map((id) => g.get(id)).filter((p) => p && p.health > 0);
        m.progress = `${d.targets.length - left.length}/${d.targets.length}`;
        if (!left.length) {
          war.addSupply(m.tid, -25);
          this.finish(m, true, 'Target destroyed');
        }
        break;
      }
      case 'rescue': {
        const caps = d.captives.map((id) => g.get(id)).filter((c) => c && c.life !== LIFE.DEAD);
        if (!caps.length && d.extracted === 0) return this.finish(m, false, 'Recon team lost');
        for (const c of caps) {
          if (!c.captive && d.extract && dist2D(c.x, c.z, d.extract.x, d.extract.z) < 45) {
            d.extracted++;
            const rescuer = c.npc && c.npc.rescuer ? g.byProfile.get(c.npc.rescuer) : null;
            if (rescuer) {
              this.contribute(m, rescuer, 10);
              g.progression.award(rescuer, { xp: XP.rescue, reason: 'Soldier extracted', cat: 'objective', pos: c });
            }
            g.npc.despawn(c);
          }
        }
        const remaining = caps.filter((c) => g.get(c.id)).length;
        m.progress = `${d.extracted} extracted`;
        if (d.extracted > 0 && remaining === 0) this.finish(m, true, `${d.extracted} soldiers brought home`);
        break;
      }
      case 'secure': {
        const hostile = g.soldiersNear(m.x, m.z, m.r, (s) => s.faction === E && s.life === LIFE.ALIVE).length;
        const friendlyPlayers = g.soldiersNear(m.x, m.z, m.r, (s) => s.player && s.faction === F && s.life === LIFE.ALIVE);
        if (friendlyPlayers.length) d.touched = true;
        for (const s of friendlyPlayers) if (g.tickCount % 40 === 0) this.contribute(m, s.player, 1);
        m.progress = `${hostile} hostiles`;
        if (d.touched && hostile === 0) {
          d.clearFor += dt;
          if (d.clearFor > 6) this.finish(m, true, 'Area secured');
        } else d.clearFor = 0;
        break;
      }
      case 'hold': {
        const fr = g.soldiersNear(m.x, m.z, m.r, (s) => s.faction === F && s.life === LIFE.ALIVE && !s.ambient);
        const en = g.soldiersNear(m.x, m.z, m.r, (s) => s.faction === E && s.life === LIFE.ALIVE);
        const players = fr.filter((s) => s.player);
        if (players.length && fr.length >= en.length) {
          d.held += dt;
          if (g.tickCount % 40 === 0) for (const s of players) this.contribute(m, s.player, 2);
        }
        if (g.time >= d.nextWave) {
          d.nextWave = g.time + 70;
          const a = this.rng.float(0, Math.PI * 2);
          g.npc.spawnSquad(E, m.x + Math.cos(a) * 140, m.z + Math.sin(a) * 140, { type: 'attack', x: m.x, z: m.z, r: 20 }, { size: 5, mission: m.id, special: true });
        }
        m.progress = `${Math.floor(d.held)}/${d.need}s`;
        if (d.held >= d.need) this.finish(m, true, 'Position held');
        break;
      }
      case 'recon': {
        let done = 0;
        for (const p of d.points) {
          if (p.done) {
            done++;
            continue;
          }
          for (const s of g.soldiersNear(p.x, p.z, 16, (e) => e.player && e.faction === F && e.life === LIFE.ALIVE)) {
            p.prog += dt * (s.role === 'scout' ? 1.6 : 1);
            if (p.prog >= 6) {
              p.done = true;
              this.contribute(m, s.player, 8);
              g.progression.award(s.player, { xp: XP.reconPoint, reason: 'Observation complete', cat: 'objective', pos: s });
              g.notify(s.player, 'Observation point reported.', 'good');
              break;
            }
          }
        }
        m.progress = `${done}/${d.points.length}`;
        if (done >= d.points.length) {
          const t = g.world.tById[m.tid];
          for (const e of g.soldiersNear(t.x, t.z, t.radius * 1.3)) g.combat.spot(e, F, null, 60);
          g.radio(F, 'intel', 'Intelligence', `Recon of ${t.name} complete. Enemy positions marked for 60 seconds.`, { priority: 1 });
          this.finish(m, true, 'Recon complete');
        }
        break;
      }
      case 'supply': {
        for (const id of d.crates) {
          const p = g.get(id);
          if (!p) continue;
          if (p.carriedBy && dist2D(p.x, p.z, d.dest.x, d.dest.z) < 20) {
            const carrier = g.get(p.carriedBy);
            if (carrier) carrier.carrying = 0;
            g.removeEntity(p);
            this.delivered(m, carrier && carrier.player, 1);
          }
        }
        for (const v of g.vehiclesNear(d.dest.x, d.dest.z, 30, (v) => v.cargo > 0 && v.faction === F)) {
          const n = v.cargo;
          v.cargo = 0;
          const drv = v.seats[0] ? g.get(v.seats[0]) : null;
          this.delivered(m, drv && drv.player, n);
        }
        m.progress = `${d.delivered}/${d.need}`;
        if (d.delivered >= d.need) this.finish(m, true, 'Supplies delivered');
        break;
      }
      case 'vip': {
        const vip = g.get(d.vipId);
        if (!vip || vip.life === LIFE.DEAD) return this.finish(m, false, `${d.vipName} was killed`);
        m.progress = `${Math.round(dist2D(vip.x, vip.z, d.dest.x, d.dest.z))}m`;
        if (g.tickCount % 60 === 0) for (const s of g.soldiersNear(vip.x, vip.z, 30, (e) => e.player && e.faction === F && e.life === LIFE.ALIVE)) this.contribute(m, s.player, 2);
        if (dist2D(vip.x, vip.z, d.dest.x, d.dest.z) < 20) {
          g.npc.despawn(vip);
          war.cp[F] = Math.min(war.cpMax(F), war.cp[F] + 10);
          this.finish(m, true, `${d.vipName} arrived safely`);
        }
        break;
      }
      default:
        break;
    }
  }

  delivered(m, session, n) {
    const g = this.game;
    m.data.delivered += n;
    g.war.addSupply(m.data.tid, 15 * n, F);
    g.war.cp[F] = Math.min(g.war.cpMax(F), g.war.cp[F] + COMMAND_POINTS.perSupplyDelivered * n);
    if (session) {
      this.contribute(m, session, 8 * n);
      g.progression.award(session, { xp: XP.supplyDelivered * n, reason: 'Supplies delivered', cat: 'support', stats: { supplies: n } });
    }
    this.changed();
  }

  timeout(m) {
    if (m.type === 'defend') {
      const w = this.game.war.get(m.data.tid);
      const s = w && w.sectors.find((x) => x.id === m.data.sid);
      this.finish(m, !!(s && s.owner === F), s && s.owner === F ? 'Assault repelled' : 'Position lost');
      return;
    }
    this.finish(m, false, 'Time expired');
  }

  finish(m, success, result) {
    const g = this.game;
    if (m.status !== 'active') return;
    m.status = success ? 'success' : 'failed';
    m.result = result;
    m.endedAt = g.time;
    const base = m.rewards;
    for (const [pid, pts] of m.contrib) {
      const session = g.byProfile.get(pid);
      if (!session || pts < 4) continue;
      if (success) {
        const share = clamp(pts / m.expected, 0.35, 1);
        const tracked = session.trackedMission === m.id ? 1.1 : 1;
        const stats = { missions: 1 };
        if (m.type === 'defend') stats.defends = 1;
        if (m.type === 'recon') stats.recons = 1;
        if (m.type === 'rescue') stats.rescues = 1;
        if (m.type === 'destroy') stats.targets = 1;
        g.progression.award(session, {
          xp: base.xp * share * tracked, credits: base.credits * share, reason: `Mission complete: ${m.title}`, cat: 'objective',
          stats, rewardId: `m:${this.runId}:${m.id}`,
        });
        const sq = session.squadId ? g.squads.get(session.squadId) : null;
        if (sq && sq.missionId === m.id && sq.leader !== session.id) {
          const leader = g.byProfile.get(sq.leader);
          if (leader) g.progression.grantLeadership(leader, LEADERSHIP.squadMissionComplete, 'Squad mission complete');
        }
      } else {
        g.progression.award(session, { xp: XP.missionFailParticipation, reason: 'Mission participation', cat: 'objective', stats: { missionsFailed: 1 }, rewardId: `mf:${this.runId}:${m.id}` });
      }
    }
    g.radio(F, 'intel', 'Operations', `${m.title}: ${success ? 'SUCCESS' : 'FAILED'} — ${result}.`, { priority: 1 });
    g.emit(['mission', m.id, success ? 1 : 0, m.title], { faction: F });
    this.cleanupEntities(m);
    for (const sq of g.squads.squads.values()) if (sq.missionId === m.id) sq.missionId = 0;
    this.changed();
  }

  cleanupEntities(m) {
    const g = this.game;
    const d = m.data;
    if (d.targets) for (const id of d.targets) {
      const p = g.get(id);
      if (p) p.expiresAt = g.time + 20;
    }
    if (d.crates) for (const id of d.crates) {
      const p = g.get(id);
      if (p && !p.carriedBy) g.removeEntity(p);
      else if (p) p.data.mission = 0;
    }
    if (d.trucks) for (const id of d.trucks) {
      const v = g.get(id);
      if (v) g.vehicleSys.retire(v, 30);
    }
    if (d.captives) for (const id of d.captives) {
      const c = g.get(id);
      if (c && c.captive) g.npc.despawn(c);
    }
    g.npc.releaseMissionSquads(m.id);
  }

  contribute(m, session, pts) {
    if (!session || !session.id) return;
    m.contrib.set(session.id, (m.contrib.get(session.id) || 0) + pts);
  }

  // ------------------------------------------------------------------ hooks
  onPlayerAction(session, kind, amount, pos) {
    if (!pos || session.faction !== F) return;
    for (const m of this.missions.values()) {
      if (m.status !== 'active') continue;
      if (dist2D(pos.x, pos.z, m.x, m.z) <= m.r * 1.5) this.contribute(m, session, amount);
    }
    void kind;
  }

  isMissionArea(x, z) {
    for (const m of this.missions.values()) if (m.status === 'active' && dist2D(x, z, m.x, m.z) <= m.r * 1.5) return true;
    return false;
  }

  onSectorChanged() {
    this.changed();
  }

  onTerritoryFlipped(w) {
    // missions tied to a territory that changed hands resolve naturally in update;
    // capture missions for a lost territory are cancelled.
    for (const m of this.active()) {
      if (m.tid === w.id && (m.type === 'capture' || m.type === 'recon' || m.type === 'destroy') && w.owner === F) {
        if (m.type === 'capture') this.finish(m, true, 'Territory liberated');
      }
    }
  }

  onBattleStarted(b) {
    void b;
    this.genTimer = Math.min(this.genTimer, 1);
  }

  onSoldierKilled(target, attacker) {
    void target;
    void attacker;
  }

  onRescue(captive, rescuer) {
    const g = this.game;
    if (!captive.captive) return;
    g.npc.freeCaptive(captive, rescuer);
    if (rescuer.player) {
      for (const m of this.active()) {
        if (m.type === 'rescue' && m.data.captives.includes(captive.id)) this.contribute(m, rescuer.player, 6);
      }
      g.notify(rescuer.player, 'Soldier freed. Lead them back to friendly lines.', 'good');
    }
  }

  damageTarget(prop, dmg, owner) {
    const g = this.game;
    if (prop.health <= 0) return;
    prop.health = Math.max(0, prop.health - dmg);
    const m = this.get(prop.data.mission);
    if (owner && owner.player && m) this.contribute(m, owner.player, Math.min(15, dmg / 25));
    if (prop.health <= 0) {
      g.emit(['boom', Math.round(prop.x), Math.round(prop.y + 1), Math.round(prop.z), 8, 2], { pos: prop, range: 1400 });
      if (owner && owner.player) g.progression.award(owner.player, { xp: XP.targetDestroyed, reason: 'Target destroyed', cat: 'objective', pos: prop, stats: { repairs: 1 } });
      prop.expiresAt = g.time + 25;
    }
  }

  onPriorityChanged() {
    this.genTimer = 1;
  }

  launchOperation(f, tid, session) {
    const g = this.game;
    if (f !== F) return false;
    if ([...this.operations.values()].some((o) => o.status === 'active')) return false;
    if (!g.war.isFront(tid, f)) return false;
    const w = g.war.get(tid);
    const op = {
      id: this.nextOpId++, name: `Operation ${this.rng.pick(OPERATION_NAMES)}`, tid, faction: f,
      startedAt: g.time, endsAt: g.time + 900, status: 'active', by: session.name, byId: session.id, missions: [],
    };
    this.operations.set(op.id, op);
    g.war.forceBattle(tid, f);
    for (const s of w.sectors) {
      if (s.owner === f) continue;
      const m = this.create('capture', { tid, sectorName: s.def.name, x: s.def.x, z: s.def.z, r: s.def.r * 1.6, data: { tid, sid: s.id }, opId: op.id, time: 900, expected: 30, bonus: 1.2 });
      op.missions.push(m.id);
    }
    const dm = this.makeDestroy(w.def);
    if (dm) {
      dm.opId = op.id;
      op.missions.push(dm.id);
    }
    g.radio(f, 'command', 'High Command', `${op.name} is launched against ${w.def.name}, ordered by ${session.name}. All units, take ${w.def.name}!`, { priority: 2 });
    g.emit(['music', 'operation'], { faction: f });
    this.changed();
    return true;
  }

  finishOperation(op, success) {
    const g = this.game;
    op.status = success ? 'success' : 'failed';
    const t = g.world.tById[op.tid];
    if (success) {
      const people = new Set();
      for (const mid of op.missions) {
        const m = this.missions.get(mid);
        if (m) for (const [pid, pts] of m.contrib) if (pts >= 4) people.add(pid);
      }
      for (const s of g.soldiersNear(t.x, t.z, t.radius * 1.4, (e) => e.player && e.faction === F)) people.add(s.player.id);
      people.add(op.byId);
      for (const pid of people) {
        const s = g.byProfile.get(pid);
        if (!s) continue;
        g.progression.award(s, { xp: XP.operationSuccess, credits: CREDITS.operationSuccess, reason: op.name, cat: 'objective', stats: { operations: 1 }, rewardId: `op:${this.runId}:${op.id}` });
        g.progression.record(s, 'operation', `Took part in the successful ${op.name}`);
      }
      const leader = g.byProfile.get(op.byId);
      if (leader) g.progression.grantLeadership(leader, 20, 'Operation success');
      g.radio(F, 'command', 'High Command', `${op.name} succeeded. ${t.name} is ours.`, { priority: 2 });
    } else {
      g.radio(F, 'command', 'High Command', `${op.name} has failed to take ${t.name}.`, { priority: 1 });
    }
    this.changed();
  }

  onCampaignReset() {
    for (const m of this.active()) this.finish(m, false, 'Campaign ended');
    for (const op of this.operations.values()) op.status = 'failed';
  }

  onLeave(session) {
    void session;
  }

  onMessage(session, msg) {
    if (msg.a === 'track' && V.int(msg.id, 1, 1e7)) {
      if (this.get(msg.id)) session.trackedMission = msg.id;
    } else if (msg.a === 'untrack') session.trackedMission = 0;
    this.changed();
  }

  broadcastTracked() {
    this.changed();
  }

  view() {
    const g = this.game;
    return {
      missions: [...this.missions.values()].map((m) => ({
        id: m.id, type: m.type, title: m.title, brief: m.brief, tid: m.tid, x: Math.round(m.x), z: Math.round(m.z), r: Math.round(m.r),
        diff: m.difficulty, rec: m.recRank, xp: m.rewards.xp, cr: m.rewards.credits, ends: Math.max(0, Math.round(m.endsAt - g.time)),
        status: m.status, result: m.result, prog: m.progress, op: m.opId ? (this.operations.get(m.opId) || {}).name : '', n: m.contrib.size,
        points: m.type === 'recon' ? m.data.points.map((p) => [Math.round(p.x), Math.round(p.z), p.done ? 1 : 0]) : undefined,
        dest: m.data.dest ? [Math.round(m.data.dest.x), Math.round(m.data.dest.z)] : m.data.extract ? [Math.round(m.data.extract.x), Math.round(m.data.extract.z)] : undefined,
      })),
      operations: [...this.operations.values()].filter((o) => o.status === 'active').map((o) => ({ id: o.id, name: o.name, tid: o.tid, ends: Math.round(o.endsAt - g.time), by: o.by })),
    };
  }
}

export { enemyOf };
