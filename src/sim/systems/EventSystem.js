// Dynamic world events. Some emerge on their own from the war (a war is
// declared, a major battle begins, a city comes under siege, a base falls);
// others are triggered at a measured pace for countries that have players, and
// usually spawn missions, AI movements and radio traffic. Players choose
// whether to take part.
import { FACTION_INFO, COUNTRY_IDS } from '../../shared/constants.js';
import { GAME } from '../../shared/config/game.js';
import { Rng } from '../../shared/math.js';

export class EventSystem {
  constructor(game) {
    this.game = game;
    this.rng = new Rng(9001);
    this.nextAt = 90;
    this.active = new Map();
    this.nextId = 1;
    this.version = 1;
    this.lastType = new Map(); // `${faction}:${type}` -> time
  }

  update() {
    const g = this.game;
    for (const [id, ev] of this.active) {
      if (g.time >= ev.until || (ev.check && ev.check())) {
        this.active.delete(id);
        if (ev.onEnd) ev.onEnd();
        this.version++;
      }
    }
    if (g.time < this.nextAt) return;
    this.nextAt = g.time + this.rng.float(GAME.eventMinInterval, GAME.eventMaxInterval);
    // the world stays calm for countries nobody plays; the war itself carries on
    const withPlayers = COUNTRY_IDS.filter((f) => g.playersOnline(f) > 0 && g.war.enemies(f).length);
    if (!withPlayers.length) return;
    const f = this.rng.pick(withPlayers);
    if ([...this.active.values()].filter((e) => e.faction === f && e.triggered).length >= GAME.maxConcurrentEvents) return;
    this.trigger(null, f);
  }

  cooldownOk(f, type, secs) {
    return this.game.time - (this.lastType.get(`${f}:${type}`) ?? -1e9) > secs;
  }

  add(ev) {
    const g = this.game;
    ev.id = this.nextId++;
    ev.started = g.time;
    this.active.set(ev.id, ev);
    this.version++;
    return ev;
  }

  // Headline events raised by the war itself (no mission attached).
  headline(type, title, tid, secs, factions) {
    const g = this.game;
    return this.add({ type, title, tid, until: g.time + secs, faction: 0, factions: factions || null });
  }

  onWarDeclared(a, b) {
    this.headline('war', `War: ${FACTION_INFO[a].short} vs ${FACTION_INFO[b].short}`, null, 300);
  }

  onBattleStarted(b) {
    const g = this.game;
    const t = g.world.tById[b.territory];
    if (!t) return;
    const str = g.war.strengthAt(b.territory, b.attacker) + g.war.strengthAt(b.territory, b.defender);
    if (t.type === 'capital') this.headline('siege', `${FACTION_INFO[b.attacker].short} forces attacking the capital ${t.name}!`, t.id, 600);
    else if (t.type === 'city' || t.type === 'port') this.headline('siege', `City under siege: ${t.name}`, t.id, 480);
    else if (str > 200) this.headline('major_battle', `Major battle beginning: ${t.name}`, t.id, 420);
    else if (b.reason === 'players') this.headline('border', `Border conflict at ${t.name}`, t.id, 240, [b.attacker, b.defender]);
  }

  onTerritoryFlipped(w, old) {
    const t = w.def;
    if (t.type === 'military' || t.type === 'airbase') this.headline('base_captured', `Military base captured: ${t.name} fell to ${FACTION_INFO[w.owner].short}`, t.id, 360);
    else if (t.type === 'capital') this.headline('capital_fallen', `${t.name}, capital of ${FACTION_INFO[old].short}, has fallen!`, t.id, 600);
  }

  trigger(forced, F) {
    const g = this.game;
    const war = g.war;
    const foes = war.enemies(F);
    if (!foes.length) return null;
    const owned = war.territoriesOf(F);
    const front = owned.filter((w) => war.frontFor(w.id, F));
    const enemyNext = (w) => {
      const list = war.neighbours(w.id).map((e) => war.ownerOf(e.id)).filter((o) => foes.includes(o));
      return list.length ? this.rng.pick(list) : foes[0];
    };
    const recent = owned.filter((w) => g.time - w.lastChange < 900 && w.lastChange > 0);
    const opts = [];
    const ok = (type, secs) => this.cooldownOk(F, type, secs);
    if (recent.length && ok('counterattack', 400)) opts.push({ w: 4, v: 'counterattack' });
    else if (front.length && ok('counterattack', 600)) opts.push({ w: 1.5, v: 'counterattack' });
    if (front.length >= 2 && ok('base_invasion', 2400)) opts.push({ w: 0.6, v: 'base_invasion' });
    if (front.length && ok('supply_shortage', 700)) opts.push({ w: 1.5, v: 'supply_shortage' });
    if (front.length && ok('convoy', 600)) opts.push({ w: 1.5, v: 'convoy' });
    const rear = owned.filter((w) => !front.includes(w));
    if (rear.length && ok('uprising', 900)) opts.push({ w: 1, v: 'uprising' });
    if (front.length && ok('emergency_defense', 500)) opts.push({ w: 1.6, v: 'emergency_defense' });
    if (ok('recon_intel', 700)) opts.push({ w: 1, v: 'recon_intel' });
    if ([...war.battles.values()].some((b) => b.attacker === F || b.defender === F) && ok('air_support', 700)) opts.push({ w: 1.1, v: 'air_support' });
    if (front.length && ok('evacuation', 1000)) opts.push({ w: 0.9, v: 'evacuation' });
    if (ok('reinforcements', 800)) opts.push({ w: 0.8, v: 'reinforcements' });
    const type = forced || this.rng.weighted(opts);
    if (!type) return null;
    this.lastType.set(`${F}:${type}`, g.time);
    const pickW = (list) => this.rng.pick(list);
    const name = FACTION_INFO[F].short;
    let ev = null;
    switch (type) {
      case 'counterattack': {
        const w = recent.length ? pickW(recent) : pickW(front);
        if (!w) return null;
        const E = enemyNext(w);
        war.createForce(E, w.id, 60, 'mech', 'attacking');
        war.startBattle(w.id, E, 'event');
        ev = { title: `Enemy Counterattack: ${w.def.name}`, tid: w.id, until: g.time + 480 };
        g.radio(F, 'command', 'High Command', `${FACTION_INFO[E].adj} armour and infantry are counterattacking ${w.def.name}! Hold your ground!`, { priority: 2 });
        g.emit(['music', 'battle'], { faction: F });
        break;
      }
      case 'base_invasion': {
        const base = g.world.bases[F];
        const E = foes[0];
        g.npc.launchBaseAssault(E, base, 3);
        g.emit(['siren', Math.round(base.x), Math.round(base.z), 90], {});
        g.missions.create('hold', { faction: F, tid: null, title: `Protect ${base.name}`, x: base.x, z: base.z, r: 70, data: { need: 240 }, time: 330, difficulty: 4, expected: 25, eventId: this.nextId });
        ev = { title: `Enemy Invasion: ${base.name}`, tid: base.id, until: g.time + 330 };
        g.radio(F, 'command', base.name, 'ALERT! ALERT! Enemy forces inside the perimeter! All personnel to defensive positions!', { priority: 2 });
        g.emit(['music', 'battle'], { faction: F });
        g.hierarchy.onBaseAlarm(F, true);
        ev.onEnd = () => g.hierarchy.onBaseAlarm(F, false);
        break;
      }
      case 'supply_shortage': {
        const w = pickW(front);
        w.supply = Math.min(w.supply, 12);
        const m = g.missions.makeSupply(w.def, F);
        if (m) {
          m.bonus = 1.4;
          m.rewards.xp = Math.round(m.rewards.xp * 1.4);
          m.rewards.credits = Math.round(m.rewards.credits * 1.4);
        }
        ev = { title: `Supply Shortage: ${w.def.name}`, tid: w.id, until: g.time + 600, check: () => w.supply > 45 };
        g.radio(F, 'command', 'Logistics', `${w.def.name} is running out of ammunition. Reinforcements there are delayed until resupplied.`, { priority: 1 });
        war.changed();
        break;
      }
      case 'convoy': {
        const w = pickW(front);
        const m = g.missions.makeConvoy(w.def, F);
        if (!m) return null;
        ev = { title: `Convoy to ${w.def.name}`, tid: w.id, until: g.time + 540, check: () => m.status !== 'active' };
        break;
      }
      case 'uprising': {
        const w = pickW(rear);
        const t = w.def;
        const E = foes[0];
        for (let i = 0; i < 2; i++) {
          const s = this.rng.pick(t.sectors);
          g.npc.spawnSquad(E, s.x + this.rng.float(-30, 30), s.z + this.rng.float(-30, 30), { type: 'attack', x: s.x, z: s.z, r: 20 }, { size: 4, special: true, insurgent: true });
        }
        const m = g.missions.makeSecure(t, F);
        ev = { title: `Uprising in ${t.name}`, tid: t.id, until: g.time + 480, check: () => m && m.status !== 'active' };
        g.radio(F, 'intel', 'Intelligence', `Insurgent cells have risen in ${t.name}, behind our lines. Deal with them.`, { priority: 1 });
        break;
      }
      case 'emergency_defense': {
        const w = pickW(front);
        const s = w.sectors[0];
        g.npc.launchAssault(enemyNext(w), w.id, s.id, 3, 0);
        const m = g.missions.create('defend', { faction: F, tid: w.id, sectorName: `${s.def.name} Command Post`, title: `Emergency: Defend ${w.def.name} Command Post`, x: s.def.x, z: s.def.z, r: s.def.r * 1.8, data: { tid: w.id, sid: s.id, waves: 0 }, time: 210, difficulty: 3, bonus: 1.3, expected: 20 });
        ev = { title: `Command Post Under Attack: ${w.def.name}`, tid: w.id, until: g.time + 220, check: () => m.status !== 'active' };
        g.radio(F, 'command', w.def.name, 'Command post under heavy attack! Requesting immediate reinforcement!', { priority: 2 });
        break;
      }
      case 'recon_intel': {
        const targets = [...war.map.values()].filter((w) => war.isFront(w.id, F));
        if (!targets.length) return null;
        const w = pickW(targets);
        const m = g.missions.create('recon', { faction: F, tid: w.id, bonus: 1.3, expected: 20 });
        ev = { title: `Intel Request: ${w.def.name}`, tid: w.id, until: g.time + 600, check: () => m.status !== 'active' };
        break;
      }
      case 'air_support': {
        const b = this.rng.pick([...war.battles.values()].filter((x) => x.attacker === F || x.defender === F));
        const t = g.world.tById[b.territory];
        const tgt = t.sectors.find((s) => war.get(t.id).sectors.find((x) => x.id === s.id).owner !== F) || t.sectors[0];
        g.vehicleSys.spawnGunship(F, tgt.x, tgt.z, 60, 0);
        ev = { title: `Air Support over ${t.name}`, tid: t.id, until: g.time + 70 };
        g.radio(F, 'command', 'Air Wing', `Gunship on station over ${t.name} for sixty seconds.`, { priority: 1 });
        break;
      }
      case 'evacuation': {
        const w = pickW(front);
        const t = w.def;
        const s = this.rng.pick(t.sectors);
        const m = g.missions.create('rescue', { faction: F, tid: t.id, title: `Evacuate Civilians from ${t.name}`, callsign: 'civilians', sectorName: s.name, x: s.x + 20, z: s.z + 15, r: 40, expected: 20, difficulty: 2 });
        g.npc.deployReinforcement(enemyNext(w), t.x, t.z, 1, null);
        ev = { title: `Evacuation: ${t.name}`, tid: t.id, until: g.time + 540, check: () => m.status !== 'active' };
        g.radio(F, 'command', 'High Command', `Civilians trapped in ${t.name} as the enemy advances. Get them out.`, { priority: 1 });
        break;
      }
      case 'reinforcements': {
        const hq = FACTION_INFO[F].hq;
        war.createForce(F, hq, 80, 'mech', 'reserve');
        ev = { title: `Reinforcements arriving at ${g.world.bases[F].name}`, tid: hq, until: g.time + 180 };
        g.radio(F, 'command', 'High Command', `A fresh ${name} battalion has arrived at ${g.world.bases[F].name}. It will move to the front shortly.`);
        break;
      }
      default:
        return null;
    }
    if (!ev) return null;
    ev.type = type;
    ev.faction = F;
    ev.triggered = true;
    return this.add(ev);
  }

  // Events visible to a country (headlines are visible to everyone).
  view(f) {
    const g = this.game;
    return [...this.active.values()]
      .filter((e) => !e.faction || e.faction === f || (e.factions && e.factions.includes(f)))
      .map((e) => ({ id: e.id, type: e.type, title: e.title, tid: e.tid, ends: Math.max(0, Math.round(e.until - g.time)), own: e.faction === f ? 1 : 0 }));
  }
}
