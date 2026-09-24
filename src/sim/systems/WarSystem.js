// The world war. Three countries, wars declared and ended between them,
// territories that change hands, and a front line that moves.
//
// Two layers:
//   ABSTRACT  Every country has forces (battalions with a strength number) that
//             march along the territory graph, garrison territories and fight
//             battles resolved with strength, morale, supply and fortification.
//             This runs everywhere, all the time, with or without players.
//   PHYSICAL  When players are near a battle it becomes "live": the NPC system
//             materialises part of the forces as real soldiers, sectors are then
//             captured only by soldiers standing on them, and every NPC killed
//             is a casualty of its battalion. When players leave, the battle
//             drops back to the abstract layer and carries on.
//
// Sectors: three capture objectives per territory. A sector has an owner and a
// control value 0..100. Enemies drain control to 0 (neutral), then raise it for
// themselves. A territory changes hands when one country holds all its sectors.
import { FACTION, COUNTRY_IDS, LIFE, FACTION_INFO, setWars, areHostile, enemiesOf } from '../../shared/constants.js';
import { GAME } from '../../shared/config/game.js';
import { WAR, FORCE_KINDS, ordinal } from '../../shared/config/war.js';
import { COMMAND_POINTS } from '../../shared/config/commands.js';
import { XP, CREDITS, LEADERSHIP } from '../../shared/config/economy.js';
import { ROLES } from '../../shared/config/roles.js';
import { rankOf } from '../../shared/config/ranks.js';
import { dist2D, clamp, Rng } from '../../shared/math.js';

const NAME = (f) => FACTION_INFO[f]?.short || 'Neutral';

export class WarSystem {
  constructor(game) {
    this.game = game;
    this.map = new Map(); // territory id -> war state (territories + HQ bases)
    this.adj = new Map(); // node id -> [{id, len, sea}]
    this.wars = []; // [{a, b, since, casualties}]
    this.forces = new Map();
    this.nextForceId = 1;
    this.forceNumbers = { 1: 0, 2: 0, 3: 0 };
    this.battles = new Map();
    this.nextBattleId = 1;
    this.countries = {};
    this.cp = {};
    this.priority = {};
    for (const f of COUNTRY_IDS) {
      this.countries[f] = { reserveFrac: 0, peaceSince: 0, orders: { attack: [], defend: new Map() }, lastMapCmd: new Map() };
      this.cp[f] = COMMAND_POINTS.base;
      this.priority[f] = null;
    }
    this.campaign = 1;
    this.campaignStart = Date.now();
    this.version = 1;
    this.forceVersion = 1;
    this.timers = { cap: 0, battle: 0, force: 0, slow: 0, ai: 0, dip: 0, recruit: 0 };
    this.resetAt = 0;
    this.rng = new Rng(4242);
    this.history = [];
    this.buildingState = new Map(); // building id -> damage state 1..3
    this.buildingVersion = 1;
    this.dirtyBuildings = [];
  }

  // ------------------------------------------------------------------ setup
  init(data) {
    const g = this.game;
    const world = g.world;
    const nodes = [...world.territories, ...world.hqs.map((h) => ({ ...h, isBase: true, radius: 150, value: 0, sectors: [], adjacent: [h.region] }))];
    for (const t of nodes) {
      const saved = data && data.territories && data.territories[t.id];
      const owner = saved ? saved.owner : t.faction;
      const w = {
        id: t.id,
        def: t,
        isBase: !!t.isBase,
        owner,
        state: 'controlled',
        stateUntil: 0,
        supply: saved ? clamp(saved.supply ?? 60, 0, 100) : 60,
        lastChange: 0,
        buildings: [],
        sectors: (t.sectors || []).map((s) => {
          const ss = saved && saved.sectors && saved.sectors[s.id];
          return {
            id: s.id, def: s, owner: ss ? ss.owner : owner, p: ss ? clamp(ss.p ?? 100, 0, 100) : 100, cap: ss ? ss.cap || 0 : 0,
            contested: false, gaining: 0, presence: {}, lastCapture: 0, tickAcc: 0, defAcc: 0,
          };
        }),
      };
      this.map.set(t.id, w);
    }
    // territory graph (HQ bases hang off their home region)
    const link = (a, b) => {
      const ta = this.map.get(a);
      const tb = this.map.get(b);
      if (!ta || !tb) return;
      const list = this.adj.get(a) || [];
      if (list.some((e) => e.id === b)) return;
      const sea = !!(ta.def.bySea || tb.def.bySea || ta.def.type === 'island' || tb.def.type === 'island');
      list.push({ id: b, len: dist2D(ta.def.x, ta.def.z, tb.def.x, tb.def.z), sea });
      this.adj.set(a, list);
    };
    for (const t of nodes) for (const a of t.adjacent || []) {
      link(t.id, a);
      link(a, t.id);
    }
    // destructible buildings per territory (battle damage)
    for (const bd of world.buildings) {
      if (!bd.destructible) continue;
      const x = (bd.x0 + bd.x1) / 2;
      const z = (bd.z0 + bd.z1) / 2;
      for (const w of this.map.values()) {
        if (w.isBase) continue;
        if (dist2D(x, z, w.def.x, w.def.z) < w.def.radius * 1.3) {
          w.buildings.push(bd.id);
          break;
        }
      }
    }
    if (data && data.v === 2) this.restore(data);
    else this.fresh();
    setWars(this.wars.map((w) => [w.a, w.b]));
    for (const f of COUNTRY_IDS) if (!this.enemies(f).length) this.countries[f].peaceSince = g.time;
  }

  fresh() {
    const g = this.game;
    this.wars = WAR.initialWars.map(([a, b]) => ({ a, b, since: g.time, casualties: 0 }));
    setWars(this.wars.map((w) => [w.a, w.b]));
    for (const w of this.map.values()) {
      if (w.isBase) {
        this.createForce(w.owner, w.id, WAR.hqReserve, 'guard', 'reserve');
        continue;
      }
      let n = WAR.initialGarrison[w.def.type] || 80;
      if (this.frontFor(w.id, w.owner)) n = Math.round(n * 1.4);
      this.createForce(w.owner, w.id, n, w.def.type === 'military' ? 'armor' : w.def.type === 'industrial' ? 'mech' : 'infantry', 'garrison');
    }
    // the world opens mid-war: these battles are already raging
    for (const [tid, attacker, n] of WAR.openingBattles) {
      const w = this.map.get(tid);
      if (!w || !this.atWar(attacker, w.owner)) continue;
      this.createForce(attacker, tid, n, 'mech', 'attacking');
      const b = this.startBattle(tid, attacker, 'ai', true);
      if (b) b.started = this.game.time - 600;
    }
  }

  restore(data) {
    const g = this.game;
    this.campaign = data.campaign || 1;
    this.campaignStart = data.campaignStart || Date.now();
    this.history = Array.isArray(data.history) ? data.history.slice(-30) : [];
    this.wars = (data.wars || []).filter((w) => COUNTRY_IDS.includes(w.a) && COUNTRY_IDS.includes(w.b) && w.a !== w.b)
      .map((w) => ({ a: w.a, b: w.b, since: g.time - (w.age || 0), casualties: w.casualties || 0 }));
    for (const f of COUNTRY_IDS) {
      if (data.cp && Number.isFinite(data.cp[f])) this.cp[f] = clamp(data.cp[f], 0, 300);
      if (data.numbers && data.numbers[f]) this.forceNumbers[f] = data.numbers[f] | 0;
    }
    for (const fd of data.forces || []) {
      if (!this.map.has(fd.loc) || !COUNTRY_IDS.includes(fd.f)) continue;
      const force = this.createForce(fd.f, fd.loc, clamp(fd.s | 0, 1, WAR.maxForceStrength * 2), fd.kind || 'infantry', fd.st || 'garrison', fd.name);
      if (fd.path && fd.path.length && fd.st !== 'garrison' && fd.st !== 'reserve') {
        force.origin = fd.origin || fd.loc;
        this.sendForce(force, fd.path[fd.path.length - 1], fd.st);
      }
    }
    for (const bd of data.battles || []) {
      const w = this.map.get(bd.t);
      if (!w || !this.atWar(bd.a, w.owner)) continue;
      const b = this.startBattle(bd.t, bd.a, bd.reason || 'ai', true);
      if (b) {
        b.started = g.time - (bd.age || 0);
        b.initial = bd.initial || b.initial;
      }
    }
    for (const [id, st] of data.buildings || []) if (st > 0) this.buildingState.set(id, Math.min(3, st));
    // guarantee every territory has some defenders after a restore
    for (const w of this.map.values()) if (!this.strengthAt(w.id, w.owner)) this.createForce(w.owner, w.id, WAR.minGarrison, 'infantry', w.isBase ? 'reserve' : 'garrison');
  }

  serialize() {
    const g = this.game;
    const territories = {};
    for (const w of this.map.values()) {
      territories[w.id] = {
        owner: w.owner,
        supply: Math.round(w.supply),
        sectors: Object.fromEntries(w.sectors.map((s) => [s.id, { owner: s.owner, p: Math.round(s.p), cap: s.cap }])),
      };
    }
    return {
      v: 2,
      campaign: this.campaign,
      campaignStart: this.campaignStart,
      territories,
      wars: this.wars.map((w) => ({ a: w.a, b: w.b, age: Math.round(g.time - w.since), casualties: Math.round(w.casualties) })),
      forces: [...this.forces.values()].map((f) => ({
        f: f.faction, loc: f.loc, s: Math.round(f.strength), kind: f.kind, st: f.state, name: f.name, origin: f.origin,
        path: f.path && f.path.length ? f.path.slice() : undefined,
      })),
      battles: [...this.battles.values()].map((b) => ({ t: b.territory, a: b.attacker, age: Math.round(g.time - b.started), reason: b.reason, initial: b.initial })),
      numbers: this.forceNumbers,
      cp: this.cp,
      buildings: [...this.buildingState.entries()],
      history: this.history.slice(-30),
      saved: Date.now(),
    };
  }

  changed() {
    this.version++;
    this.game.warDirty = true;
  }

  logEvent(text) {
    this.history.push({ t: Date.now(), text });
    if (this.history.length > 30) this.history.shift();
  }

  // ------------------------------------------------------------------ queries
  get(id) {
    return this.map.get(id) || null;
  }

  ownerOf(id) {
    const w = this.map.get(id);
    return w ? w.owner : 0;
  }

  atWar(a, b) {
    return areHostile(a, b);
  }

  enemies(f) {
    return enemiesOf(f);
  }

  warBetween(a, b) {
    return this.wars.find((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a)) || null;
  }

  neighbours(id) {
    return this.adj.get(id) || [];
  }

  // Territory `id` borders territory owned by `f` (and is not f's own).
  frontFor(id, f) {
    const w = this.map.get(id);
    if (!w || w.isBase) return false;
    if (w.owner === f) return this.neighbours(id).some((e) => {
      const o = this.ownerOf(e.id);
      return o !== f && this.atWar(o, f) && !this.map.get(e.id).isBase;
    });
    return false;
  }

  // Territory `id` can be attacked by `f`: owned by a country at war with f and
  // next to something f holds (or already under attack by f).
  isFront(id, f) {
    const w = this.map.get(id);
    if (!w || w.isBase || w.owner === f || !this.atWar(w.owner, f)) return false;
    if (this.neighbours(id).some((e) => this.ownerOf(e.id) === f)) return true;
    const b = this.battleAt(id);
    return !!(b && b.attacker === f);
  }

  canCapture(w, f) {
    if (w.isBase || !f) return false;
    if (w.owner === f) return true;
    return this.isFront(w.id, f);
  }

  battleAt(tid) {
    for (const b of this.battles.values()) if (b.territory === tid) return b;
    return null;
  }

  territoriesOf(f) {
    return [...this.map.values()].filter((w) => !w.isBase && w.owner === f);
  }

  isObjectiveArea(x, z) {
    return !!this.sectorNear(x, z, 44);
  }

  sectorNear(x, z, r) {
    for (const w of this.map.values()) {
      if (w.isBase) continue;
      if (dist2D(x, z, w.def.x, w.def.z) > w.def.radius * 1.6) continue;
      for (const s of w.sectors) if (dist2D(x, z, s.def.x, s.def.z) < r) return { w, s };
    }
    return null;
  }

  isDefendingKill(attacker, victim) {
    const hit = this.sectorNear(victim.x, victim.z, 34);
    return !!(hit && hit.s.owner === attacker.faction);
  }

  spawnBlockedReason(t, f) {
    const w = this.map.get(t.id);
    if (!w) return 'Unavailable';
    if (w.owner !== f) return 'Not ours';
    if (w.sectors[0] && w.sectors[0].owner !== f) return 'Command post lost';
    for (const s of w.sectors) if (s.contested || (s.gaining && s.gaining !== f)) return 'Under attack';
    if (this.game.deploySys.enemiesNear(t.commandPost.x, t.commandPost.z, 55, f)) return 'Enemies nearby';
    return '';
  }

  // ------------------------------------------------------------------ command points & supply
  cpMax(f) {
    let bonus = 0;
    for (const s of this.game.sessionsOf(f)) bonus = Math.max(bonus, rankOf(s.rankIndex).cpCapBonus || 0);
    return COMMAND_POINTS.cap + bonus;
  }

  regenCommandPoints(dt) {
    for (const f of COUNTRY_IDS) {
      let owned = 0;
      for (const w of this.map.values()) if (!w.isBase && w.owner === f) owned += 0.5 + (w.supply > 60 ? 0.15 : 0);
      this.cp[f] = Math.min(this.cpMax(f), this.cp[f] + (COMMAND_POINTS.perTerritoryPerMin / 60) * dt * Math.max(1, owned));
    }
  }

  spendCommandPoints(f, n) {
    this.cp[f] = Math.max(0, (this.cp[f] || 0) - n);
  }

  addSupply(id, amount, f) {
    const w = this.map.get(id);
    if (!w || (f && w.owner !== f)) return;
    w.supply = clamp(w.supply + amount, 0, 100);
    this.changed();
  }

  // ------------------------------------------------------------------ forces
  createForce(f, loc, strength, kind = 'infantry', state = 'garrison', name = null) {
    const id = this.nextForceId++;
    if (!name) {
      this.forceNumbers[f] = (this.forceNumbers[f] || 0) + 1;
      name = `${ordinal(this.forceNumbers[f])} ${FACTION_INFO[f].adj} ${FORCE_KINDS[kind]?.name || 'Battalion'}`;
    }
    const w = this.map.get(loc);
    const force = {
      id, faction: f, kind, name, strength, loc, state, origin: loc, path: null, edge: null,
      x: w ? w.def.x : 0, z: w ? w.def.z : 0, morale: 1, arrivedAt: this.game.time, order: null,
    };
    this.forces.set(id, force);
    this.forceVersion++;
    return force;
  }

  removeForce(force) {
    this.forces.delete(force.id);
    this.forceVersion++;
  }

  forcesAt(tid, f, filter) {
    const out = [];
    for (const force of this.forces.values()) {
      if (force.loc !== tid || force.edge) continue;
      if (f && force.faction !== f) continue;
      if (filter && !filter(force)) continue;
      out.push(force);
    }
    return out;
  }

  strengthAt(tid, f, states) {
    let n = 0;
    for (const force of this.forces.values()) {
      if (force.loc !== tid || force.edge || force.faction !== f) continue;
      if (states && !states.includes(force.state)) continue;
      n += force.strength;
    }
    return n;
  }

  countryStrength(f) {
    let n = 0;
    for (const force of this.forces.values()) if (force.faction === f) n += force.strength;
    return n;
  }

  // Shortest path (by distance) from `from` to `to` through territory that is
  // not hostile to f (the destination itself may be hostile).
  route(f, from, to) {
    if (from === to) return [];
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const open = [from];
    while (open.length) {
      open.sort((a, b) => dist.get(a) - dist.get(b));
      const cur = open.shift();
      if (cur === to) break;
      for (const e of this.neighbours(cur)) {
        const o = this.ownerOf(e.id);
        if (e.id !== to && o !== f && this.atWar(o, f)) continue;
        if (e.id !== to && o !== f && !this.map.get(e.id).isBase && o) continue; // do not march through neutral countries
        if (this.map.get(e.id).isBase && e.id !== to && o !== f) continue;
        const d = dist.get(cur) + e.len * (e.sea ? 1 / WAR.seaSpeedMult : 1);
        if (d < (dist.get(e.id) ?? Infinity)) {
          dist.set(e.id, d);
          prev.set(e.id, cur);
          if (!open.includes(e.id)) open.push(e.id);
        }
      }
    }
    if (!prev.has(to)) return null;
    const path = [];
    for (let c = to; c !== from; c = prev.get(c)) path.unshift(c);
    return path;
  }

  // Order a force to march to `dest`. state: 'moving' | 'attacking' | 'retreating'
  sendForce(force, dest, state = 'moving') {
    const path = this.route(force.faction, force.loc, dest);
    if (!path) return false;
    if (!path.length) {
      force.state = state === 'retreating' ? 'garrison' : force.state;
      return true;
    }
    force.origin = force.loc;
    force.path = path;
    force.state = state;
    this.startEdge(force);
    this.forceVersion++;
    return true;
  }

  startEdge(force) {
    const next = force.path[0];
    const e = this.neighbours(force.loc).find((x) => x.id === next);
    force.edge = { from: force.loc, to: next, d: 0, len: e ? e.len : 500, sea: !!(e && e.sea) };
  }

  splitForce(force, n) {
    n = Math.floor(Math.min(n, force.strength - 1));
    if (n < 5) return null;
    force.strength -= n;
    const part = this.createForce(force.faction, force.loc, n, force.kind, force.state === 'reserve' ? 'garrison' : force.state);
    return part;
  }

  // Move `n` soldiers of f from territory `from` towards `dest`.
  dispatch(f, from, dest, n, state) {
    let left = n;
    const sent = [];
    const pool = this.forcesAt(from, f, (x) => x.state === 'garrison' || x.state === 'reserve').sort((a, b) => b.strength - a.strength);
    for (const force of pool) {
      if (left < 5) break;
      let unit = force;
      if (force.strength > left + 4) unit = this.splitForce(force, left);
      if (!unit) continue;
      if (!this.sendForce(unit, dest, state)) {
        // no route: fold back
        if (unit !== force) {
          force.strength += unit.strength;
          this.removeForce(unit);
        }
        break;
      }
      left -= unit.strength;
      sent.push(unit);
    }
    return sent;
  }

  updateForces(dt) {
    let moved = false;
    for (const force of [...this.forces.values()]) {
      if (!force.edge) continue;
      moved = true;
      const e = force.edge;
      e.d += WAR.forceSpeed * (e.sea ? WAR.seaSpeedMult : 1) * dt;
      const a = this.map.get(e.from).def;
      const b = this.map.get(e.to).def;
      const t = Math.min(1, e.d / e.len);
      force.x = a.x + (b.x - a.x) * t;
      force.z = a.z + (b.z - a.z) * t;
      if (e.d < e.len) continue;
      force.loc = e.to;
      force.edge = null;
      force.path.shift();
      force.arrivedAt = this.game.time;
      const w = this.map.get(force.loc);
      const hostile = this.atWar(w.owner, force.faction) && w.owner !== force.faction;
      if (force.path.length && !hostile) {
        // re-validate the rest of the route (the map may have changed)
        const dest = force.path[force.path.length - 1];
        const path = this.route(force.faction, force.loc, dest);
        if (path && path.length) {
          force.path = path;
          this.startEdge(force);
          continue;
        }
      }
      force.path = null;
      this.arrive(force, w, hostile);
    }
    if (moved) this.forceVersion++;
  }

  arrive(force, w, hostile) {
    if (hostile && !w.isBase) {
      force.state = 'attacking';
      const b = this.battleAt(w.id);
      if (b && b.attacker !== force.faction) {
        // somebody else is already fighting here: wait next door
        this.retreat(force);
        return;
      }
      if (b) b.initial.a += force.strength;
      else this.startBattle(w.id, force.faction, force.order ? 'order' : 'ai');
      return;
    }
    if (w.owner !== force.faction) {
      // arrived at a neutral / allied place: go home
      this.retreat(force);
      return;
    }
    force.state = w.isBase ? 'reserve' : 'garrison';
    this.mergeAt(force);
  }

  mergeAt(force) {
    for (const other of this.forcesAt(force.loc, force.faction, (x) => x !== force && (x.state === 'garrison' || x.state === 'reserve'))) {
      if (other.strength + force.strength <= WAR.maxForceStrength) {
        other.strength += force.strength;
        this.removeForce(force);
        return other;
      }
    }
    return force;
  }

  // Send a force back to the nearest territory its country owns.
  retreat(force) {
    let best = null;
    let bd = Infinity;
    for (const w of this.map.values()) {
      if (w.owner !== force.faction) continue;
      const d = dist2D(w.def.x, w.def.z, force.x, force.z);
      if (d < bd && (w.id !== force.loc || !force.edge)) {
        const path = this.route(force.faction, force.loc, w.id);
        if (path) {
          bd = d;
          best = w;
        }
      }
    }
    if (!best) {
      this.removeForce(force);
      return;
    }
    if (best.id === force.loc) {
      force.state = best.isBase ? 'reserve' : 'garrison';
      this.mergeAt(force);
      return;
    }
    this.sendForce(force, best.id, 'retreating');
  }

  // A physical NPC of f died in/near territory tid: one casualty for its battalion.
  onCasualty(f, tid, n = 1) {
    let best = null;
    for (const force of this.forces.values()) {
      if (force.faction !== f || force.loc !== tid || force.edge) continue;
      if (!best || force.strength > best.strength) best = force;
    }
    if (!best) return;
    best.strength -= n;
    const b = this.battleAt(tid);
    if (b) b.losses[b.attacker === f ? 'a' : 'd'] += n;
    const war = this.warBetween(f, this.ownerOf(tid) === f && b ? b.attacker : this.ownerOf(tid));
    if (war) war.casualties += n;
    if (best.strength <= 0) this.removeForce(best);
    this.forceVersion++;
  }

  recruit(dt) {
    for (const f of COUNTRY_IDS) {
      const c = this.countries[f];
      const owned = this.territoriesOf(f);
      let rate = WAR.recruitBase + owned.reduce((n, w) => n + (w.def.value || 1), 0) * WAR.recruitPerValue;
      if (owned.length <= 3) rate *= WAR.mobilizeBonus;
      if (!this.enemies(f).length) rate *= 0.5;
      const total = this.countryStrength(f);
      if (total >= WAR.countryCap) continue;
      c.reserveFrac += (rate / 60) * dt;
      const whole = Math.floor(c.reserveFrac);
      if (whole <= 0) continue;
      c.reserveFrac -= whole;
      const hq = FACTION_INFO[f].hq;
      const res = this.forcesAt(hq, f, (x) => x.state === 'reserve')[0];
      if (res && res.strength < WAR.maxForceStrength * 1.5) res.strength += whole;
      else this.createForce(f, hq, whole, this.rng.chance(0.3) ? 'mech' : 'infantry', 'reserve');
    }
  }

  // ------------------------------------------------------------------ diplomacy
  declareWar(a, b, reason = '') {
    if (a === b || this.warBetween(a, b)) return false;
    const g = this.game;
    this.wars.push({ a, b, since: g.time, casualties: 0 });
    setWars(this.wars.map((w) => [w.a, w.b]));
    const text = `${FACTION_INFO[a].name} has declared war on ${FACTION_INFO[b].name}${reason ? ` ${reason}` : ''}.`;
    for (const f of COUNTRY_IDS) g.radio(f, 'command', 'World News', text, { priority: 2 });
    g.emit(['war', 'declared', a, b], {});
    this.logEvent(`${NAME(a)} declared war on ${NAME(b)}`);
    for (const f of [a, b]) this.countries[f].peaceSince = 0;
    g.events.onWarDeclared?.(a, b);
    this.changed();
    this.forceVersion++;
    return true;
  }

  endWar(a, b, reason = 'ceasefire') {
    const war = this.warBetween(a, b);
    if (!war) return false;
    const g = this.game;
    this.wars = this.wars.filter((w) => w !== war);
    setWars(this.wars.map((w) => [w.a, w.b]));
    for (const [id, bt] of [...this.battles]) {
      const pair = [bt.attacker, bt.defender];
      if (pair.includes(a) && pair.includes(b)) this.endBattle(id, bt.defender, 'ceasefire');
    }
    for (const force of [...this.forces.values()]) {
      if (force.faction !== a && force.faction !== b) continue;
      const target = force.path && force.path.length ? force.path[force.path.length - 1] : force.loc;
      const o = this.ownerOf(target);
      if (o !== force.faction && (o === a || o === b)) this.retreat(force);
    }
    // sectors held inside the other country go back to the territory owner
    for (const w of this.map.values()) {
      for (const s of w.sectors) {
        if (s.owner !== w.owner && (s.owner === a || s.owner === b || s.owner === 0)) {
          s.owner = w.owner;
          s.p = 100;
          s.cap = 0;
        }
      }
    }
    const text = reason === 'surrender'
      ? `${FACTION_INFO[b].name} has surrendered to ${FACTION_INFO[a].name}. The war is over.`
      : `${FACTION_INFO[a].short} and ${FACTION_INFO[b].short} have signed a ceasefire. The front falls silent.`;
    for (const f of COUNTRY_IDS) g.radio(f, 'command', 'World News', text, { priority: 2 });
    g.emit(['war', 'ended', a, b], {});
    this.logEvent(`${NAME(a)}–${NAME(b)} war ended (${reason})`);
    for (const f of [a, b]) if (!this.enemies(f).length) this.countries[f].peaceSince = g.time;
    this.changed();
    this.forceVersion++;
    return true;
  }

  updateDiplomacy() {
    const g = this.game;
    // ceasefires in long, exhausting wars
    for (const war of [...this.wars]) {
      const minutes = (g.time - war.since) / 60;
      if (minutes < WAR.minWarMinutes) continue;
      const exhaustion = war.casualties / 900 + (minutes - WAR.minWarMinutes) / 60;
      if (this.rng.chance(WAR.ceasefireChancePerMin * (1 + exhaustion))) this.endWar(war.a, war.b);
    }
    // surrender: a country that lost every territory to one enemy
    for (const f of COUNTRY_IDS) {
      if (this.territoriesOf(f).length) continue;
      const foe = this.enemies(f)[0];
      if (foe) this.endWar(foe, f, 'surrender');
    }
    // countries at peace for too long pick a fight with a neighbour
    for (const f of COUNTRY_IDS) {
      const c = this.countries[f];
      if (this.enemies(f).length) {
        c.peaceSince = 0;
        // opportunistic second front against a weaker neighbour
        if (this.rng.chance(WAR.newWarChancePerMin)) {
          const weak = COUNTRY_IDS.filter((o) => o !== f && !this.atWar(o, f) && this.borders(f, o) && this.countryStrength(o) < this.countryStrength(f) * 0.8);
          if (weak.length) this.declareWar(f, weak[0], 'to seize a weakened border');
        }
        continue;
      }
      if (!c.peaceSince) c.peaceSince = g.time;
      if ((g.time - c.peaceSince) / 60 < WAR.peaceMaxMinutes) continue;
      const cands = COUNTRY_IDS.filter((o) => o !== f && this.borders(f, o));
      if (!cands.length) continue;
      // grievance: territory the other country took from us
      const grievance = (o) => [...this.map.values()].filter((w) => !w.isBase && w.def.faction === f && w.owner === o).length;
      cands.sort((x, y) => grievance(y) - grievance(x) || this.countryStrength(x) - this.countryStrength(y));
      this.declareWar(f, cands[0], grievance(cands[0]) ? 'to reclaim its lost provinces' : 'after a border incident');
    }
  }

  borders(a, b) {
    for (const w of this.map.values()) {
      if (w.isBase || w.owner !== a) continue;
      if (this.neighbours(w.id).some((e) => this.ownerOf(e.id) === b && !this.map.get(e.id).isBase)) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const g = this.game;
    if (this.resetAt && g.time >= this.resetAt) this.resetCampaign();
    const T = this.timers;
    T.cap += dt;
    if (T.cap >= 0.5) {
      this.updateSectors(T.cap);
      T.cap = 0;
    }
    T.force += dt;
    if (T.force >= 1) {
      this.updateForces(T.force);
      T.force = 0;
    }
    T.battle += dt;
    if (T.battle >= WAR.battleTick) {
      this.updateBattles(T.battle);
      T.battle = 0;
    }
    T.slow += dt;
    if (T.slow >= 5) {
      this.updateSlow(T.slow);
      T.slow = 0;
    }
    T.recruit += dt;
    if (T.recruit >= 10) {
      this.recruit(T.recruit);
      T.recruit = 0;
    }
    T.ai += dt;
    if (T.ai >= WAR.aiInterval) {
      T.ai = 0;
      for (const f of COUNTRY_IDS) this.aiStrategy(f);
      this.aiArtillery();
    }
    T.dip += dt;
    if (T.dip >= 60) {
      T.dip = 0;
      this.updateDiplomacy();
    }
  }

  presenceWeight(s) {
    if (s.life !== LIFE.ALIVE || s.captive || s.ambient) return 0;
    if (s.vehicle) {
      const v = this.game.get(s.vehicle);
      if (v && v.def.air) return 0;
    }
    let w = s.isPlayer ? 1 : 0.75;
    const role = ROLES[s.role];
    if (role && role.perks.captureMult) w *= role.perks.captureMult;
    return w;
  }

  // Physical capture: soldiers standing on sectors (players and live NPCs).
  updateSectors(dt) {
    const g = this.game;
    for (const w of this.map.values()) {
      if (w.isBase) continue;
      const b = this.battleAt(w.id);
      if (b && !b.live && !this.playersNearTerritory(w, 60)) continue; // abstract battle owns the sectors
      let anyChange = false;
      for (const sec of w.sectors) {
        const pres = { 1: 0, 2: 0, 3: 0 };
        const present = { 1: [], 2: [], 3: [] };
        let any = false;
        for (const s of g.soldiersNear(sec.def.x, sec.def.z, sec.def.r)) {
          const wt = this.presenceWeight(s);
          if (wt <= 0 || !(s.faction in pres)) continue;
          pres[s.faction] += wt;
          present[s.faction].push(s);
          any = true;
        }
        sec.presence = pres;
        const beforeP = sec.p;
        const beforeOwner = sec.owner;
        const wasContested = sec.contested;
        const holder = sec.owner || sec.cap;
        // strongest capable challenger of the current holder
        let atk = 0;
        let atkF = 0;
        for (const f of COUNTRY_IDS) {
          if (f === holder || !pres[f] || !this.canCapture(w, f)) continue;
          if (holder && !this.atWar(f, holder) && f !== w.owner) continue;
          if (pres[f] > atk) {
            atk = pres[f];
            atkF = f;
          }
        }
        const def = holder ? pres[holder] : 0;
        sec.contested = def > 0 && atk > 0;
        let gain = 0; // + holder gaining, - challenger gaining
        if (atk && (!def || atk >= def * 2)) gain = -Math.min(GAME.captureMaxRate, atk - def * 0.5);
        else if (def && (!atk || def >= atk * 2)) gain = Math.min(GAME.captureMaxRate, def - atk * 0.5);
        const rate = (100 / GAME.captureTime) * dt;
        if (gain < 0) {
          sec.p -= rate * -gain;
          if (sec.p <= 0) {
            if (sec.owner) this.sectorNeutralized(w, sec, atkF);
            sec.owner = 0;
            sec.cap = atkF;
            sec.p = 0;
          }
          sec.gaining = atkF;
        } else if (gain > 0 && sec.p < 100) {
          sec.p = Math.min(100, sec.p + rate * gain);
          sec.gaining = holder;
          if (sec.p >= 100 && !sec.owner && sec.cap) this.sectorCaptured(w, sec, sec.cap, present[sec.cap]);
        } else {
          sec.gaining = 0;
          if (!any && sec.owner && sec.p < 100) sec.p = Math.min(100, sec.p + 3 * dt);
        }
        if (Math.round(sec.p) !== Math.round(beforeP) || sec.owner !== beforeOwner || wasContested !== sec.contested) anyChange = true;
        // capture & defence ticks for players
        if (sec.gaining) {
          sec.tickAcc += dt;
          if (sec.tickAcc >= 2) {
            sec.tickAcc = 0;
            for (const s of present[sec.gaining] || []) {
              if (!s.player) continue;
              g.progression.award(s.player, { xp: XP.captureTick, reason: 'Capturing', cat: 'objective', pos: s, silent: true });
              g.missions.onPlayerAction(s.player, 'capture', 2, s);
              s.player.lastCaptureAt = g.time;
              s.player.captureSector = `${w.id}:${sec.id}`;
            }
          }
        }
        if (sec.contested && sec.owner) {
          sec.defAcc += dt;
          if (sec.defAcc >= 4) {
            sec.defAcc = 0;
            const defenders = present[sec.owner];
            const attackers = COUNTRY_IDS.filter((f) => this.atWar(f, sec.owner)).flatMap((f) => present[f]);
            for (const s of defenders) {
              if (!s.player) continue;
              g.progression.award(s.player, { xp: XP.defendTick, reason: 'Defending', cat: 'objective', pos: s, silent: true });
              g.missions.onPlayerAction(s.player, 'defend', 2, s);
              if (attackers.length >= Math.max(3, defenders.length * 3)) {
                s.player.valorHold = (s.player.valorHold || 0) + 4;
                if (s.player.valorHold >= 40) {
                  s.player.valorHold = -1e9;
                  g.progression.addStat(s.player, 'valor', 1);
                  g.notify(s.player, 'Held the line against overwhelming odds. Valor noted.', 'good');
                }
              }
            }
          }
        }
        // players pushing into an enemy territory start a battle
        if (sec.gaining && sec.gaining !== w.owner && !this.battleAt(w.id) && this.atWar(sec.gaining, w.owner)) {
          this.startBattle(w.id, sec.gaining, 'players');
        }
      }
      if (this.checkFlip(w)) anyChange = true;
      const st = this.computeState(w);
      if (st !== w.state) {
        w.state = st;
        anyChange = true;
      }
      if (anyChange) this.version++;
    }
  }

  checkFlip(w) {
    const owners = new Set(w.sectors.map((s) => s.owner));
    if (owners.size !== 1) return false;
    const f = w.sectors[0].owner;
    if (f === FACTION.NONE || f === w.owner || w.sectors.some((s) => s.p < 100)) return false;
    this.flipTerritory(w, f);
    return true;
  }

  computeState(w) {
    const g = this.game;
    if (w.stateUntil > g.time) return w.state;
    if (w.sectors.some((s) => s.contested)) return 'contested';
    if (w.sectors.some((s) => s.owner !== w.owner || (s.gaining && s.gaining !== w.owner))) return 'under_attack';
    const b = this.battleAt(w.id);
    if (b && b.attacker !== w.owner) return 'under_attack';
    return 'controlled';
  }

  sectorCaptured(w, sec, f, presentList) {
    const g = this.game;
    sec.owner = f;
    sec.cap = 0;
    sec.p = 100;
    sec.lastCapture = g.time;
    const t = w.def;
    const label = `${sec.def.name} (${t.name})`;
    g.radio(f, 'intel', 'HQ', `${label} secured.`, { priority: 1 });
    if (w.owner !== f) g.radio(w.owner, 'intel', 'HQ', `We've lost ${label}!`, { priority: 1 });
    g.emit(['cap', t.id, sec.id, f], {});
    this.cp[f] = Math.min(this.cpMax(f), this.cp[f] + COMMAND_POINTS.perObjectiveCaptured);
    const officers = new Set();
    for (const s of presentList || []) {
      if (!s.player) continue;
      g.progression.award(s.player, {
        xp: XP.sectorCaptured, credits: CREDITS.sectorCaptured, reason: `Captured ${sec.def.name}`, cat: 'objective', pos: s,
        stats: { captures: 1 }, rewardId: `cap:${t.id}:${sec.id}:${Math.floor(g.time)}`,
      });
      const sq = s.player.squadId ? g.squads.get(s.player.squadId) : null;
      if (sq && sq.order && sq.order.expiresAt > g.time && dist2D(sq.order.x, sq.order.z, sec.def.x, sec.def.z) < 80) officers.add(sq.order.issuer);
    }
    for (const oid of officers) {
      const o = g.byProfile.get(oid);
      if (o) g.progression.grantLeadership(o, LEADERSHIP.officerUnitsCapture, 'Units captured objective');
    }
    g.missions.onSectorChanged(w, sec);
    g.npc.onSectorChanged(w, sec);
    this.logEvent(`${NAME(f)} captured ${label}`);
    this.changed();
  }

  sectorNeutralized(w, sec, byFaction) {
    const g = this.game;
    const lost = sec.owner;
    g.radio(lost, 'intel', 'HQ', `${sec.def.name} (${w.def.name}) has been neutralized!`, { priority: 1 });
    if (byFaction) g.radio(byFaction, 'intel', 'HQ', `Enemy flag down at ${sec.def.name}. Keep pushing!`);
    g.missions.onSectorChanged(w, sec);
    g.npc.onSectorChanged(w, sec);
    this.changed();
  }

  flipTerritory(w, f) {
    const g = this.game;
    const old = w.owner;
    w.owner = f;
    w.lastChange = g.time;
    w.state = f === w.def.faction ? 'liberated' : 'captured';
    w.stateUntil = g.time + GAME.territoryStateHold;
    w.supply = 40;
    for (const s of w.sectors) {
      s.owner = f;
      s.p = 100;
      s.cap = 0;
    }
    const t = w.def;
    g.radio(f, 'command', 'High Command', `${t.name} is ours! Outstanding work, soldiers.`, { priority: 2 });
    g.radio(old, 'command', 'High Command', `${t.name} has fallen to ${FACTION_INFO[f].short}. Regroup and counterattack!`, { priority: 2 });
    for (const o of COUNTRY_IDS) if (o !== f && o !== old) g.radio(o, 'intel', 'World News', `${t.name} has fallen: ${FACTION_INFO[f].short} took it from ${FACTION_INFO[old].short}.`);
    g.emit(['territory', t.id, f, old], {});
    g.emit(['music', 'victory'], { faction: f });
    g.emit(['music', 'defeat'], { faction: old });
    for (const s of g.soldiersNear(t.x, t.z, t.radius * 1.4, (e) => e.player && e.faction === f && e.life !== LIFE.DEAD)) {
      g.progression.award(s.player, {
        xp: XP.territoryCaptured, credits: CREDITS.territoryCaptured, reason: `${t.name} taken`, cat: 'objective', pos: s,
        stats: { territories: 1 }, rewardId: `terr:${t.id}:${this.campaign}:${Math.floor(g.time)}`,
      });
    }
    // forces: the losers fall back, the winners garrison
    for (const force of [...this.forces.values()]) {
      if (force.loc !== w.id || force.edge) continue;
      if (force.faction === old) this.retreat(force);
      else if (force.faction === f) {
        force.state = 'garrison';
        this.mergeAt(force);
      }
    }
    const b = this.battleAt(w.id);
    if (b) this.endBattle(b.id, f, 'captured');
    // generals who ordered this attack earn the credit
    const c = this.countries[f];
    for (const o of c.orders.attack) {
      if (o.tid !== w.id || o.until < g.time) continue;
      const sess = g.byProfile.get(o.by);
      if (sess) {
        g.progression.grantLeadership(sess, 40, `Your offensive took ${t.name}`);
        g.progression.addStat(sess, 'operations', 1);
      }
      o.until = 0;
    }
    this.logEvent(`${NAME(f)} took ${t.name} from ${NAME(old)}`);
    g.missions.onTerritoryFlipped(w, old);
    g.npc.onTerritoryFlipped(w, old);
    g.vehicleSys.onTerritoryFlipped(w);
    g.events.onTerritoryFlipped?.(w, old);
    this.changed();
    this.forceVersion++;
    this.checkCampaign();
  }

  // ------------------------------------------------------------------ battles
  startBattle(tid, attacker, reason = 'ai', silent = false) {
    const g = this.game;
    const existing = this.battleAt(tid);
    if (existing) return existing;
    const w = this.map.get(tid);
    if (!w || w.isBase || !this.atWar(attacker, w.owner)) return null;
    const b = {
      id: this.nextBattleId++, territory: tid, attacker, defender: w.owner, started: g.time, reason, lastProgress: g.time,
      live: false, liveSince: 0, lastPlayerAt: 0, intensity: 0,
      initial: { a: this.strengthAt(tid, attacker), d: this.strengthAt(tid, w.owner) }, losses: { a: 0, d: 0 },
    };
    this.battles.set(b.id, b);
    if (!silent) {
      const name = w.def.name;
      g.radio(attacker, 'command', 'High Command', `Assault on ${name} is underway. Move to the front!`, { priority: 1 });
      g.radio(w.owner, 'command', 'High Command', `${FACTION_INFO[attacker].short} forces are attacking ${name}! Reinforce the defence!`, { priority: 2 });
      g.emit(['battle', b.id, tid, attacker, w.owner], {});
      this.logEvent(`Battle of ${name} began (${NAME(attacker)} attacking)`);
    }
    g.npc.onBattleStarted(b);
    g.missions.onBattleStarted(b);
    g.events.onBattleStarted?.(b);
    this.changed();
    return b;
  }

  forceBattle(tid, attacker) {
    const w = this.map.get(tid);
    if (!w) return null;
    // commit what is available next door so the battle has troops
    const from = this.neighbours(tid).map((e) => e.id).filter((id) => this.ownerOf(id) === attacker);
    for (const id of from) this.dispatch(attacker, id, tid, Math.max(0, this.strengthAt(id, attacker) - WAR.minGarrison), 'attacking');
    return this.startBattle(tid, attacker, 'order');
  }

  endBattle(id, winner, why = '') {
    const g = this.game;
    const b = this.battles.get(id);
    if (!b) return;
    this.battles.delete(id);
    const w = this.map.get(b.territory);
    if (winner === b.defender) {
      // attackers withdraw, sectors return to the defender over time
      for (const force of this.forcesAt(b.territory, b.attacker)) this.retreat(force);
      for (const s of w.sectors) if (s.owner !== w.owner) {
        s.owner = w.owner;
        s.cap = 0;
        s.p = Math.max(s.p, 50);
      }
      if (why !== 'ceasefire') {
        g.radio(b.defender, 'command', 'High Command', `The attack on ${w.def.name} has been repelled!`, { priority: 1 });
        g.radio(b.attacker, 'command', 'High Command', `The assault on ${w.def.name} has failed. Our forces are falling back.`, { priority: 1 });
        this.logEvent(`${NAME(b.defender)} held ${w.def.name}`);
      }
    }
    // service record: battles won
    for (const s of g.sessions) {
      const t = s.battleTime.get(b.id) || 0;
      if (t >= 120 && s.faction === winner) {
        g.progression.addStat(s, 'operations', 1);
        g.notify(s, `Victory at ${w.def.name} recorded in your service record.`, 'good');
      }
      s.battleTime.delete(b.id);
    }
    g.npc.onBattleEnded(b, winner);
    g.emit(['battleEnd', b.id, b.territory, winner], {});
    this.changed();
  }

  playersNearTerritory(w, extra) {
    const t = w.def;
    const r = t.radius + extra;
    for (const sess of this.game.sessions) {
      const s = sess.soldier;
      const p = s && s.life !== LIFE.DEAD ? s : sess.viewPos;
      if (p && dist2D(p.x, p.z, t.x, t.z) < r) return true;
    }
    return false;
  }

  // Abstract resolution of battles nobody is watching; liveness of the rest.
  updateBattles(dt) {
    const g = this.game;
    const dtMin = dt / 60;
    for (const [id, b] of [...this.battles]) {
      const w = this.map.get(b.territory);
      if (!w || w.owner === b.attacker || !this.atWar(b.attacker, w.owner)) {
        this.endBattle(id, w ? w.owner : 0);
        continue;
      }
      b.defender = w.owner;
      // liveness (physical layer)
      const near = this.playersNearTerritory(w, WAR.liveRadius);
      if (near) b.lastPlayerAt = g.time;
      const wasLive = b.live;
      b.live = near || (b.live && g.time - b.lastPlayerAt < WAR.unliveDelay);
      if (b.live && !wasLive) b.liveSince = g.time;
      if (b.live !== wasLive) this.changed();
      const A = this.strengthAt(w.id, b.attacker, ['attacking']);
      const D = this.strengthAt(w.id, w.owner);
      b.intensity = clamp((A + D) / 220, 0.15, 1);
      if (A <= 0 && (!b.live || g.time - b.started > 60) && !this.attackersEnRoute(b)) {
        if (b.reason !== 'players' || !this.playersNearTerritory(w, 0)) {
          this.endBattle(id, w.owner);
          continue;
        }
      }
      // stalemate
      if (w.sectors.some((s) => s.gaining)) b.lastProgress = g.time;
      if (g.time - b.lastProgress > 600 && g.time - b.started > 900) {
        this.endBattle(id, w.owner, 'stalled');
        continue;
      }
      if (b.live) continue;
      // ---- abstract combat
      const pa = this.powerOf(w.id, b.attacker);
      const pd = this.powerOf(w.id, w.owner);
      const fort = WAR.fortBonus[w.def.type] || 1;
      const supply = 0.75 + w.supply / 400;
      const Ae = A * pa * this.rng.float(0.85, 1.15);
      const De = D * pd * WAR.defenderBonus * fort * supply * this.rng.float(0.85, 1.15);
      const lossA = Math.min(A, WAR.lethality * De * dtMin);
      const lossD = Math.min(D, WAR.lethality * Ae * dtMin);
      this.applyLosses(w.id, b.attacker, lossA, ['attacking']);
      this.applyLosses(w.id, w.owner, lossD);
      b.losses.a += lossA;
      b.losses.d += lossD;
      const war = this.warBetween(b.attacker, w.owner);
      if (war) war.casualties += lossA + lossD;
      w.supply = clamp(w.supply - 0.6 * dtMin * 10, 5, 100);
      // battle damage to the town
      if (w.buildings.length && this.rng.chance(Math.min(1, WAR.battleDamagePerMin * dtMin * b.intensity * 2))) this.damageBuilding(this.rng.pick(w.buildings), 1);
      // sectors
      const ratio = D <= 0.5 ? 10 : Ae / Math.max(1, De);
      const rate = WAR.sectorRate * clamp(ratio - 1, -1, 3) * dt;
      if (rate > 0) {
        b.lastProgress = g.time;
        const order = [...w.sectors].reverse(); // command post (A) falls last
        const sec = order.find((s) => s.owner !== b.attacker);
        if (sec) {
          if (sec.owner) {
            sec.p -= rate;
            sec.gaining = b.attacker;
            if (sec.p <= 0) {
              this.sectorNeutralized(w, sec, b.attacker);
              sec.owner = 0;
              sec.cap = b.attacker;
              sec.p = 0;
            }
          } else {
            if (sec.cap !== b.attacker) sec.cap = b.attacker;
            sec.p += rate;
            sec.gaining = b.attacker;
            if (sec.p >= 100) this.sectorCaptured(w, sec, b.attacker, []);
          }
          this.version++;
        }
        if (this.checkFlip(w)) continue;
      } else if (rate < 0) {
        const sec = w.sectors.find((s) => s.owner !== w.owner || s.p < 100);
        if (sec) {
          if (!sec.owner) {
            sec.p += rate; // challenger loses its progress
            if (sec.p <= 0) {
              sec.owner = w.owner;
              sec.cap = 0;
              sec.p = 5;
            }
          } else if (sec.owner === w.owner) sec.p = Math.min(100, sec.p - rate);
          else {
            sec.p += rate;
            if (sec.p <= 0) {
              sec.owner = 0;
              sec.cap = w.owner;
              sec.p = 0;
            }
          }
          sec.gaining = w.owner;
          this.version++;
        }
      }
      // attack collapses
      if ((ratio < WAR.attackFailRatio && g.time - b.started > 60) || A < b.initial.a * WAR.attackFailFraction) {
        if (!this.attackersEnRoute(b)) this.endBattle(id, w.owner, 'failed');
      }
    }
  }

  attackersEnRoute(b) {
    for (const force of this.forces.values()) {
      if (force.faction !== b.attacker || !force.path || !force.path.length) continue;
      if (force.path[force.path.length - 1] === b.territory) return true;
    }
    return false;
  }

  powerOf(tid, f) {
    let s = 0;
    let p = 0;
    for (const force of this.forcesAt(tid, f)) {
      s += force.strength;
      p += force.strength * (FORCE_KINDS[force.kind]?.power || 1) * force.morale;
    }
    return s ? p / s : 1;
  }

  applyLosses(tid, f, n, states) {
    let left = n;
    const list = this.forcesAt(tid, f, states ? (x) => states.includes(x.state) : null);
    const total = list.reduce((a, x) => a + x.strength, 0);
    if (!total) return;
    for (const force of list) {
      const share = (force.strength / total) * n;
      force.strength -= share;
      force.morale = clamp(force.morale - share / 300, 0.5, 1);
      left -= share;
      if (force.strength < 1) this.removeForce(force);
    }
    this.forceVersion++;
  }

  // ------------------------------------------------------------------ destruction
  // Buildings move through predefined states: 0 intact, 1 damaged, 2 heavily damaged, 3 destroyed.
  damageBuilding(bid, n = 1) {
    const cur = this.buildingState.get(bid) || 0;
    const next = Math.min(3, cur + n);
    if (next === cur) return;
    this.buildingState.set(bid, next);
    this.buildingVersion++;
    this.dirtyBuildings.push([bid, next]);
    this.game.warDirty = true;
  }

  repairBuildings() {
    // reconstruction behind the lines: one step per pass on a quiet territory
    for (const w of this.map.values()) {
      if (this.battleAt(w.id) || !w.buildings.length) continue;
      for (const bid of w.buildings) {
        const st = this.buildingState.get(bid);
        if (!st || !this.rng.chance(0.08)) continue;
        if (st <= 1) this.buildingState.delete(bid);
        else this.buildingState.set(bid, st - 1);
        this.buildingVersion++;
        this.dirtyBuildings.push([bid, st - 1]);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ periodic
  updateSlow(dt) {
    const g = this.game;
    for (const w of this.map.values()) {
      if (w.isBase) continue;
      const fighting = w.state === 'contested' || w.state === 'under_attack';
      w.supply = clamp(w.supply - ((fighting ? GAME.supplyDecayPerMin * 2 : GAME.supplyDecayPerMin) / 60) * dt + (fighting ? 0 : 0.02 * dt), 5, 100);
      const st = this.computeState(w);
      if (st !== w.state) {
        w.state = st;
        this.version++;
      }
    }
    this.regenCommandPoints(dt);
    if (this.rng.chance(dt / 60)) this.repairBuildings();
    // battle participation for players
    for (const s of g.sessions) {
      const sol = s.soldier;
      if (!sol || sol.life === LIFE.DEAD) continue;
      for (const b of this.battles.values()) {
        const t = this.map.get(b.territory).def;
        if (dist2D(sol.x, sol.z, t.x, t.z) > t.radius * 1.3) continue;
        const cur = (s.battleTime.get(b.id) || 0) + dt;
        s.battleTime.set(b.id, cur);
        if (cur >= 120 && cur - dt < 120) {
          g.progression.addStat(s, 'battles', 1);
          g.notify(s, `Battle of ${t.name} recorded in your service record.`, 'good');
        }
      }
    }
    // expire map orders
    for (const f of COUNTRY_IDS) {
      const o = this.countries[f].orders;
      o.attack = o.attack.filter((x) => x.until > g.time);
      for (const [k, v] of o.defend) if (v.until < g.time) o.defend.delete(k);
    }
    // dissolve tiny forces into neighbours
    for (const force of [...this.forces.values()]) {
      if (force.edge || force.strength >= 5) continue;
      const other = this.forcesAt(force.loc, force.faction, (x) => x !== force)[0];
      if (other) {
        other.strength += force.strength;
        this.removeForce(force);
      } else if (force.strength < 1) this.removeForce(force);
    }
  }

  // ------------------------------------------------------------------ AI commanders
  threatTo(tid, f) {
    let n = 0;
    const b = this.battleAt(tid);
    if (b && b.attacker !== f) n += this.strengthAt(tid, b.attacker);
    for (const e of this.neighbours(tid)) {
      const o = this.ownerOf(e.id);
      if (o === f || !this.atWar(o, f)) continue;
      n += this.strengthAt(e.id, o);
    }
    for (const force of this.forces.values()) {
      if (!force.path || !this.atWar(force.faction, f)) continue;
      if (force.path[force.path.length - 1] === tid) n += force.strength;
    }
    return n;
  }

  aiStrategy(f) {
    const g = this.game;
    const c = this.countries[f];
    const own = this.territoriesOf(f);
    if (!own.length) return;
    const hq = FACTION_INFO[f].hq;
    const busy = (w) => this.battleAt(w.id) && this.battleAt(w.id).defender === f;
    // 1. garrison needs
    const need = new Map();
    for (const w of own) {
      const threat = this.threatTo(w.id, f);
      let want = threat > 0 ? Math.max(WAR.minGarrison * 2, threat * WAR.frontGarrisonFactor) : WAR.minGarrison;
      const d = c.orders.defend.get(w.id);
      if (d) want = want * 1.6 + 40;
      need.set(w.id, want);
    }
    const incoming = (tid) => {
      let n = 0;
      for (const force of this.forces.values()) if (force.faction === f && force.path && force.path[force.path.length - 1] === tid) n += force.strength;
      return n;
    };
    const surplus = (w) => this.strengthAt(w.id, f, ['garrison', 'reserve']) - (need.get(w.id) ?? 0);
    const deficits = own.map((w) => ({ w, gap: (need.get(w.id) || 0) - this.strengthAt(w.id, f) - incoming(w.id) })).filter((x) => x.gap > 8).sort((a, b) => b.gap - a.gap);
    for (const { w, gap } of deficits.slice(0, 3)) {
      let left = gap;
      // nearest sources with surplus (HQ reserve counts)
      const sources = [...own.filter((o) => o !== w && !busy(o)), this.map.get(hq)]
        .filter((o) => o && o.owner === f && surplus(o) > 10)
        .sort((a, b) => dist2D(a.def.x, a.def.z, w.def.x, w.def.z) - dist2D(b.def.x, b.def.z, w.def.x, w.def.z));
      for (const src of sources) {
        if (left < 8) break;
        const n = Math.min(left, surplus(src) - (src.isBase ? 0 : 5));
        if (n < 8) continue;
        const sent = this.dispatch(f, src.id, w.id, n, 'moving');
        left -= sent.reduce((a, x) => a + x.strength, 0);
      }
    }
    // 2. feed attacks already under way
    if (!this.enemies(f).length) return;
    for (const b of this.battles.values()) {
      if (b.attacker !== f) continue;
      const A = this.strengthAt(b.territory, f, ['attacking']) + incoming(b.territory);
      const D = this.strengthAt(b.territory, b.defender) * WAR.defenderBonus;
      if (A >= D * 1.2) continue;
      for (const e of this.neighbours(b.territory)) {
        const src = this.map.get(e.id);
        if (src.owner !== f || busy(src)) continue;
        const n = this.strengthAt(src.id, f, ['garrison', 'reserve']) - Math.max(WAR.minGarrison, this.threatTo(src.id, f) * 0.5);
        if (n >= 10) this.dispatch(f, src.id, b.territory, Math.min(n, D * 1.3 - A), 'attacking');
      }
    }
    // 3. offensives
    const running = [...this.battles.values()].filter((b) => b.attacker === f).length;
    if (running) c.lastOffensive = g.time;
    const ordered = c.orders.attack.filter((o) => o.until > g.time).map((o) => o.tid);
    // the war must keep moving: after a quiet spell, attack at worse odds
    const quiet = g.time - (c.lastOffensive ?? g.time - 60) > WAR.offensiveTempo;
    const reserve = this.strengthAt(hq, f, ['reserve']);
    if (running >= WAR.maxOffensivesPerCountry && !ordered.some((tid) => !this.battleAt(tid))) return;
    const cands = [];
    for (const w of this.map.values()) {
      if (!this.isFront(w.id, f) || this.battleAt(w.id)) continue;
      const def = this.strengthAt(w.id, w.owner) * WAR.defenderBonus * (WAR.fortBonus[w.def.type] || 1);
      let avail = 0;
      const froms = [];
      for (const e of this.neighbours(w.id)) {
        const src = this.map.get(e.id);
        if (src.owner !== f || busy(src)) continue;
        const s = Math.max(0, this.strengthAt(src.id, f, ['garrison', 'reserve']) - Math.max(WAR.minGarrison, this.threatTo(src.id, f) * 0.5 - def * 0.3));
        if (s > 8) {
          avail += s;
          froms.push({ src, s });
        }
      }
      const isOrdered = ordered.includes(w.id);
      const prio = this.priority[f] && this.priority[f].until > g.time && this.priority[f].territory === w.id;
      const off = g.commands.offensiveFor(f);
      const boost = (isOrdered ? 20 : 0) + (prio ? 4 : 0) + (off && off.territory === w.id ? 8 : 0);
      // the national reserve can join any offensive (it marches from HQ)
      const withReserve = avail + reserve * 0.7;
      if (reserve > 20) froms.push({ src: this.map.get(hq), s: reserve * 0.7 });
      const ratio = withReserve / Math.max(10, def);
      if (!isOrdered && ratio < (quiet ? WAR.attackRatio * 0.55 : WAR.attackRatio)) continue;
      if (isOrdered && avail < 15) continue;
      cands.push({ w, froms, ratio, score: ratio + (w.def.value || 1) * 0.4 + boost + this.rng.float(0, 0.5) });
    }
    cands.sort((a, b) => b.score - a.score);
    let launched = running;
    for (const cand of cands) {
      if (launched >= WAR.maxOffensivesPerCountry && !ordered.includes(cand.w.id)) break;
      let sent = 0;
      for (const { src, s } of cand.froms) sent += this.dispatch(f, src.id, cand.w.id, s, 'attacking').reduce((a, x) => a + x.strength, 0);
      if (sent > 0) {
        launched++;
        c.lastOffensive = g.time;
        g.radio(f, 'intel', 'High Command', `Our forces are advancing on ${cand.w.def.name}.`);
      }
    }
  }

  // AI artillery on sectors that players are taking from AI-held ground
  aiArtillery() {
    const g = this.game;
    for (const w of this.map.values()) {
      for (const sec of w.sectors) {
        if (!sec.owner || !sec.gaining || sec.gaining === sec.owner) continue;
        if (!this.playersNearTerritory(w, 0) || g.playersOnline(sec.owner) > 0) continue;
        if (this.rng.chance(0.3)) g.commands.aiUse(sec.owner, 'artillery', sec.def.x + this.rng.float(-12, 12), sec.def.z + this.rng.float(-12, 12));
      }
    }
  }

  // ------------------------------------------------------------------ map commands (generals)
  // cmd: attack | defend | move | reinforce | general_offensive | mobilize
  mapCommand(session, cmd, tid, from) {
    const g = this.game;
    const f = session.faction;
    const rk = rankOf(session.rankIndex);
    const fail = (text) => {
      g.notify(session, text, 'warn');
      return false;
    };
    if (!rk.map) return fail('Strategic map commands require the rank of Colonel.');
    const c = this.countries[f];
    const key = cmd;
    if ((c.lastMapCmd.get(`${session.id}:${key}`) || -1e9) + WAR.mapCommandCooldown > g.time) return fail('Command staff are still carrying out your last order.');
    const w = this.map.get(tid);
    if (!w && cmd !== 'general_offensive' && cmd !== 'mobilize') return fail('Unknown location.');
    if (cmd === 'general_offensive' || cmd === 'mobilize') {
      if (rk.map < 3) return fail('Only the General of the Army can order that.');
    } else if (rk.map === 1) {
      const s = session.soldier || session.viewPos;
      if (!s || dist2D(s.x, s.z, w.def.x, w.def.z) > WAR.colonelRange) return fail('Colonels command their own region: that location is too far away.');
    }
    const title = g.progression.title(session);
    let text = '';
    switch (cmd) {
      case 'attack': {
        if (!this.isFront(tid, f)) return fail(w.owner === f ? 'That territory is already ours.' : !this.atWar(w.owner, f) ? 'We are not at war with them.' : 'We have no ground next to that territory.');
        c.orders.attack.push({ tid, by: session.id, until: g.time + 600 });
        this.aiStrategy(f);
        if (!this.battleAt(tid)) {
          const b = this.forceBattle(tid, f);
          if (!b) return fail('No forces available for that attack.');
        }
        text = `${title} orders: ATTACK ${w.def.name}. The army is moving.`;
        break;
      }
      case 'defend': {
        if (w.owner !== f) return fail('We can only defend our own territory.');
        c.orders.defend.set(tid, { by: session.id, until: g.time + 600 });
        this.aiStrategy(f);
        text = `${title} orders: DEFEND ${w.def.name}. Reinforcements are on their way.`;
        break;
      }
      case 'move': {
        const src = this.map.get(from);
        if (!src || src.owner !== f || w.owner !== f) return fail('Move orders go between our own territories.');
        const n = Math.max(0, this.strengthAt(src.id, f, ['garrison', 'reserve']) - WAR.minGarrison);
        if (n < 10) return fail(`No spare forces at ${src.def.name}.`);
        const sent = this.dispatch(f, src.id, tid, n, 'moving');
        if (!sent.length) return fail('No route for that move.');
        text = `${title} orders: MOVE forces from ${src.def.name} to ${w.def.name}.`;
        break;
      }
      case 'reinforce': {
        if (w.owner !== f) return fail('We can only reinforce our own territory.');
        const hq = FACTION_INFO[f].hq;
        const n = Math.min(120, this.strengthAt(hq, f, ['reserve']));
        if (n < 10) return fail('The national reserve is empty.');
        const sent = this.dispatch(f, hq, tid, n, 'moving');
        if (!sent.length) return fail('No route from headquarters.');
        text = `${title} orders: REINFORCE ${w.def.name} with ${Math.round(n)} troops from the reserve.`;
        break;
      }
      case 'general_offensive': {
        const fronts = [...this.map.values()].filter((x) => this.isFront(x.id, f) && !this.battleAt(x.id));
        if (!fronts.length) return fail('There is no front to attack.');
        fronts.sort((a, b) => this.strengthAt(a.id, a.owner) - this.strengthAt(b.id, b.owner));
        for (const x of fronts.slice(0, 3)) c.orders.attack.push({ tid: x.id, by: session.id, until: g.time + 600 });
        this.aiStrategy(f);
        text = `${title} orders a GENERAL OFFENSIVE on every front!`;
        break;
      }
      case 'mobilize': {
        if (this.countryStrength(f) >= WAR.countryCap) return fail('The army is at full strength.');
        this.createForce(f, FACTION_INFO[f].hq, WAR.battalionSize * 2, 'guard', 'reserve');
        text = `${title} orders a national mobilization. Two fresh battalions report to headquarters.`;
        break;
      }
      default:
        return fail('Unknown command.');
    }
    c.lastMapCmd.set(`${session.id}:${key}`, g.time);
    g.radio(f, 'command', 'High Command', text, { priority: 2 });
    g.progression.addStat(session, 'ordersIssued', 1);
    this.changed();
    this.forceVersion++;
    return true;
  }

  // REINFORCE order from a Captain or above: up to 50 soldiers from the nearest
  // spare garrison or the national reserve march to the territory.
  requestReinforcement(f, tid, session) {
    const g = this.game;
    const c = this.countries[f];
    if ((c.lastReinforce || -1e9) + 60 > g.time) {
      g.notify(session, 'Reinforcements are already on the move. Hold on.', 'info');
      return false;
    }
    const w = this.map.get(tid);
    if (!w) return false;
    const hq = this.map.get(FACTION_INFO[f].hq);
    const sources = [...this.territoriesOf(f), hq].filter((o) => o && o.id !== tid && !this.battleAt(o.id))
      .map((o) => ({ o, spare: this.strengthAt(o.id, f, ['garrison', 'reserve']) - (o.isBase ? 0 : Math.max(WAR.minGarrison, this.threatTo(o.id, f) * 0.6)) }))
      .filter((x) => x.spare >= 10)
      .sort((a, b) => dist2D(a.o.def.x, a.o.def.z, w.def.x, w.def.z) - dist2D(b.o.def.x, b.o.def.z, w.def.x, w.def.z));
    let left = 50;
    for (const { o, spare } of sources) {
      if (left < 10) break;
      const sent = this.dispatch(f, o.id, tid, Math.min(left, spare), w.owner === f ? 'moving' : 'attacking');
      left -= sent.reduce((a, x) => a + x.strength, 0);
    }
    if (left >= 50) {
      g.notify(session, 'No spare troops can reach that territory.', 'warn');
      return false;
    }
    c.lastReinforce = g.time;
    g.radio(f, 'command', 'High Command', `${Math.round(50 - left)} troops are marching to ${w.def.name} on ${g.progression.title(session)}'s request.`);
    this.forceVersion++;
    return true;
  }

  // ------------------------------------------------------------------ campaign
  checkCampaign() {
    const g = this.game;
    const land = [...this.map.values()].filter((w) => !w.isBase);
    for (const f of COUNTRY_IDS) {
      const share = land.filter((w) => w.owner === f).length / land.length;
      if (share < 0.8 || this.resetAt) continue;
      this.resetAt = g.time + GAME.campaignResetDelay;
      for (const o of COUNTRY_IDS) {
        g.radio(o, 'command', 'High Command', o === f
          ? `VICTORY! ${FACTION_INFO[f].name} controls the continent. Campaign ${this.campaign} is won.`
          : `${FACTION_INFO[f].name} has conquered the continent. Campaign ${this.campaign} is lost. We regroup for the next campaign.`, { priority: 2 });
      }
      for (const s of g.sessionsOf(f)) {
        if ((s.profile.stats.service | 0) < 10) continue;
        g.progression.award(s, { xp: XP.campaignVictory, credits: CREDITS.campaignVictory, reason: 'Campaign victory', cat: 'service', stats: { campaigns: 1 }, rewardId: `campaign:${this.campaign}`, noMult: true });
        g.progression.record(s, 'campaign', `Served in the victorious Campaign ${this.campaign}`);
      }
      g.emit(['campaign', f, this.campaign, GAME.campaignResetDelay], {});
      this.logEvent(`Campaign ${this.campaign} ended: ${NAME(f)} victory`);
    }
  }

  resetCampaign() {
    const g = this.game;
    this.resetAt = 0;
    this.campaign++;
    this.campaignStart = Date.now();
    for (const id of [...this.battles.keys()]) this.endBattle(id, 0, 'ceasefire');
    this.forces.clear();
    for (const w of this.map.values()) {
      w.owner = w.def.faction;
      w.supply = 60;
      w.state = 'controlled';
      w.stateUntil = 0;
      for (const s of w.sectors) {
        s.owner = w.owner;
        s.p = 100;
        s.cap = 0;
        s.contested = false;
        s.gaining = 0;
      }
    }
    this.buildingState.clear();
    this.buildingVersion++;
    this.dirtyBuildings.push(['reset']);
    this.fresh();
    for (const f of COUNTRY_IDS) g.radio(f, 'command', 'High Command', `Campaign ${this.campaign} begins. The borders have been redrawn.`, { priority: 2 });
    g.npc.onCampaignReset();
    g.missions.onCampaignReset();
    g.vehicleSys.onCampaignReset();
    this.changed();
  }

  // ------------------------------------------------------------------ views
  // Per-country view: own forces exactly, enemy forces only near our territory.
  view(f) {
    const g = this.game;
    const visible = (force) => {
      if (force.faction === f) return true;
      const w = this.map.get(force.loc);
      if (w && w.owner === f) return true;
      return this.neighbours(force.loc).some((e) => this.ownerOf(e.id) === f);
    };
    const round = (n, own) => (own ? Math.round(n) : Math.round(n / 10) * 10);
    return {
      campaign: this.campaign,
      wars: this.wars.map((w) => [w.a, w.b, Math.round((g.time - w.since) / 60)]),
      territories: [...this.map.values()].map((w) => ({
        id: w.id,
        owner: w.owner,
        state: w.state,
        supply: Math.round(w.supply),
        battle: this.battleAt(w.id)?.attacker || 0,
        str: w.owner === f || this.isFront(w.id, f) ? round(this.strengthAt(w.id, w.owner), w.owner === f) : -1,
        sectors: w.sectors.map((s) => ({ id: s.id, o: s.owner, p: Math.round(s.p), c: s.cap, x: s.contested ? 1 : 0, m: s.gaining })),
      })),
      battles: [...this.battles.values()].map((b) => ({
        id: b.id, t: b.territory, a: b.attacker, d: b.defender, live: b.live ? 1 : 0, int: Math.round(b.intensity * 100) / 100,
        as: round(this.strengthAt(b.territory, b.attacker, ['attacking']), b.attacker === f), ds: round(this.strengthAt(b.territory, b.defender), b.defender === f),
        age: Math.round(g.time - b.started),
      })),
      forces: [...this.forces.values()].filter(visible).map((x) => ({
        id: x.id, f: x.faction, n: x.name, x: Math.round(x.x), z: Math.round(x.z), s: round(x.strength, x.faction === f), st: x.state,
        to: x.path && x.path.length ? x.path[x.path.length - 1] : null, loc: x.loc,
      })),
      reserve: Math.round(this.strengthAt(FACTION_INFO[f]?.hq, f, ['reserve'])),
      orders: f ? this.countries[f].orders.attack.map((o) => o.tid) : [],
      cp: Object.fromEntries(COUNTRY_IDS.map((x) => [x, Math.floor(this.cp[x])])),
      strength: Object.fromEntries(COUNTRY_IDS.map((x) => [x, Math.round(this.countryStrength(x) / 10) * 10])),
      resetIn: this.resetAt ? Math.max(0, Math.round(this.resetAt - g.time)) : 0,
      history: this.history.slice(-10),
    };
  }
}
