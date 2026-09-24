// Dynamic world events. They emerge from the war state at a measured pace
// (never spammy) and usually spawn missions, AI movements and radio traffic.
import { FACTION, LIFE, PROP_KIND } from '../../shared/constants.js';
import { GAME } from '../../shared/config/game.js';
import { Rng, dist2D } from '../../shared/math.js';

const F = FACTION.COALITION;
const E = FACTION.DOMINION;

export class EventSystem {
  constructor(game) {
    this.game = game;
    this.rng = new Rng(9001);
    this.nextAt = 90;
    this.active = new Map();
    this.nextId = 1;
    this.version = 1;
    this.lastType = new Map();
  }

  update(dt) {
    const g = this.game;
    void dt;
    for (const [id, ev] of this.active) {
      if (g.time >= ev.until || (ev.check && ev.check())) {
        this.active.delete(id);
        if (ev.onEnd) ev.onEnd();
        this.version++;
      }
    }
    if (g.time < this.nextAt) return;
    this.nextAt = g.time + this.rng.float(GAME.eventMinInterval, GAME.eventMaxInterval);
    if (this.active.size >= GAME.maxConcurrentEvents) return;
    if (!g.playersOnline(F)) return; // the world stays calm when nobody is around to experience it
    this.trigger();
  }

  cooldownOk(type, secs) {
    return this.game.time - (this.lastType.get(type) ?? -1e9) > secs;
  }

  trigger(forced) {
    const g = this.game;
    const war = g.war;
    const owned = [...war.map.values()].filter((w) => !w.def.isBase && w.owner === F);
    const enemyOwned = [...war.map.values()].filter((w) => !w.def.isBase && w.owner === E);
    const front = owned.filter((w) => w.def.adjacent.some((a) => war.ownerOf(a) === E));
    const recent = owned.filter((w) => g.time - w.lastChange < 900 && w.lastChange > 0);
    const opts = [];
    if (recent.length && this.cooldownOk('counterattack', 400)) opts.push({ w: 4, v: 'counterattack' });
    else if (front.length && this.cooldownOk('counterattack', 600)) opts.push({ w: 1.5, v: 'counterattack' });
    if (enemyOwned.length >= 5 && this.cooldownOk('base_invasion', 1800)) opts.push({ w: 1, v: 'base_invasion' });
    if (front.length && this.cooldownOk('supply_shortage', 700)) opts.push({ w: 1.5, v: 'supply_shortage' });
    if (front.length && this.cooldownOk('convoy', 600)) opts.push({ w: 1.5, v: 'convoy' });
    const rear = owned.filter((w) => !front.includes(w));
    if (rear.length && this.cooldownOk('uprising', 900)) opts.push({ w: 1, v: 'uprising' });
    if (front.length && this.cooldownOk('emergency_defense', 500)) opts.push({ w: 1.6, v: 'emergency_defense' });
    if (this.cooldownOk('recon_intel', 700)) opts.push({ w: 1, v: 'recon_intel' });
    if (war.battles.size && this.cooldownOk('air_support', 700)) opts.push({ w: 1.1, v: 'air_support' });
    if (front.length && this.cooldownOk('evacuation', 1000)) opts.push({ w: 0.9, v: 'evacuation' });
    const type = forced || this.rng.weighted(opts);
    if (!type) return null;
    this.lastType.set(type, g.time);
    const pickW = (list) => this.rng.pick(list);
    let ev = null;
    switch (type) {
      case 'counterattack': {
        const w = recent.length ? pickW(recent) : pickW(front);
        war.startBattle(w.id, E, 'event');
        g.npc.deployReinforcement(E, w.def.commandPost.x, w.def.commandPost.z, 2, null);
        ev = { title: `Enemy Counterattack: ${w.def.name}`, tid: w.id, until: g.time + 480 };
        g.radio(F, 'command', 'High Command', `Dominion armour and infantry are counterattacking ${w.def.name}! Hold your ground!`, { priority: 2 });
        g.emit(['music', 'battle'], { faction: F });
        break;
      }
      case 'base_invasion': {
        const base = g.world.bases[F];
        g.npc.launchBaseAssault(E, base, 3);
        g.emit(['siren', Math.round(base.x), Math.round(base.z), 90], {});
        g.missions.create('hold', { tid: null, title: 'Protect Command Headquarters', x: base.x, z: base.z - 72, r: 70, data: { need: 240 }, time: 330, difficulty: 4, expected: 25, eventId: this.nextId });
        ev = { title: 'Base Invasion: Fort Sentinel', tid: 'hq_coalition', until: g.time + 330 };
        g.radio(F, 'command', 'Fort Sentinel', 'ALERT! ALERT! Enemy forces inside the perimeter! All personnel to defensive positions!', { priority: 2 });
        g.emit(['music', 'battle'], { faction: F });
        g.ambient.onBaseAlarm(F, true);
        ev.onEnd = () => g.ambient.onBaseAlarm(F, false);
        break;
      }
      case 'supply_shortage': {
        const w = pickW(front);
        w.supply = Math.min(w.supply, 12);
        g.missions.makeSupply(w.def);
        const m = g.missions.active().find((mm) => mm.type === 'supply' && mm.tid === w.id);
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
        const m = g.missions.makeConvoy(w.def);
        if (!m) return null;
        ev = { title: `Convoy to ${w.def.name}`, tid: w.id, until: g.time + 540, check: () => m.status !== 'active' };
        break;
      }
      case 'uprising': {
        const w = pickW(rear);
        const t = w.def;
        for (let i = 0; i < 2; i++) {
          const s = this.rng.pick(t.sectors);
          g.npc.spawnSquad(E, s.x + this.rng.float(-30, 30), s.z + this.rng.float(-30, 30), { type: 'attack', x: s.x, z: s.z, r: 20 }, { size: 4, special: true, insurgent: true });
        }
        const m = g.missions.makeSecure(t);
        ev = { title: `Uprising in ${t.name}`, tid: t.id, until: g.time + 480, check: () => m && m.status !== 'active' };
        g.radio(F, 'intel', 'Intelligence', `Insurgent cells have risen in ${t.name}, behind our lines. Deal with them.`, { priority: 1 });
        break;
      }
      case 'emergency_defense': {
        const w = pickW(front);
        const s = w.sectors[0];
        g.npc.launchAssault(E, w.id, s.id, 3, 0);
        const m = g.missions.create('defend', { tid: w.id, sectorName: `${s.def.name} Command Post`, title: `Emergency: Defend ${w.def.name} Command Post`, x: s.def.x, z: s.def.z, r: s.def.r * 1.8, data: { tid: w.id, sid: s.id, waves: 0 }, time: 210, difficulty: 3, bonus: 1.3, expected: 20 });
        ev = { title: `Command Post Under Attack: ${w.def.name}`, tid: w.id, until: g.time + 220, check: () => m.status !== 'active' };
        g.radio(F, 'command', w.def.name, 'Command post under heavy attack! Requesting immediate reinforcement!', { priority: 2 });
        break;
      }
      case 'recon_intel': {
        const targets = [...war.map.values()].filter((w) => war.isFront(w.id, F));
        if (!targets.length) return null;
        const w = pickW(targets);
        const m = g.missions.create('recon', { tid: w.id, bonus: 1.3, expected: 20 });
        ev = { title: `Intel Request: ${w.def.name}`, tid: w.id, until: g.time + 600, check: () => m.status !== 'active' };
        break;
      }
      case 'air_support': {
        const b = this.rng.pick([...war.battles.values()]);
        const t = g.world.tById[b.territory];
        const tgt = t.sectors.find((s) => war.get(t.id).sectors.find((x) => x.id === s.id).owner !== F) || t.sectors[0];
        g.vehicleSys.spawnGunship(F, tgt.x, tgt.z, 60, 0);
        ev = { title: `Air Support over ${t.name}`, tid: t.id, until: g.time + 70 };
        g.radio(F, 'command', 'Air Wing', `Gunship Harrier-1 on station over ${t.name} for sixty seconds.`, { priority: 1 });
        break;
      }
      case 'evacuation': {
        const w = pickW(front);
        const t = w.def;
        const s = this.rng.pick(t.sectors);
        const m = g.missions.create('rescue', { tid: t.id, title: `Evacuate Civilians from ${t.name}`, callsign: 'civilians', sectorName: s.name, x: s.x + 20, z: s.z + 15, r: 40, expected: 20, difficulty: 2 });
        g.npc.deployReinforcement(E, t.x, t.z, 1, null);
        ev = { title: `Evacuation: ${t.name}`, tid: t.id, until: g.time + 540, check: () => m.status !== 'active' };
        g.radio(F, 'command', 'High Command', `Civilians trapped in ${t.name} as the enemy advances. Get them out.`, { priority: 1 });
        break;
      }
      default:
        return null;
    }
    if (!ev) return null;
    ev.id = this.nextId++;
    ev.type = type;
    ev.started = g.time;
    this.active.set(ev.id, ev);
    this.version++;
    return ev;
  }

  view() {
    const g = this.game;
    return [...this.active.values()].map((e) => ({ id: e.id, type: e.type, title: e.title, tid: e.tid, ends: Math.max(0, Math.round(e.until - g.time)) }));
  }
}

export { LIFE, PROP_KIND, dist2D };
