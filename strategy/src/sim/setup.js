// New campaign: provinces, countries, starting forces, diplomacy, and players.
import { initStrategic } from './strategic.js';
import { Rng, ordinal, clamp } from './util.js';
import { MILITARY, estimateMilitary } from '../../config/military.js';
import { PERSONALITY_OF, BLOCS, PACTS, RIVALRIES, SCENARIOS, PERSONALITIES } from '../../config/scenario.js';
import { RANKS } from '../../config/ranks.js';
import { declareWar } from './diplomacy.js';
import { newFormation } from './formations.js';
import { PROV_FIELDS } from './Game.js';

export function setupCampaign(g, settings) {
  const w = g.w;
  const C = g.C;
  const P = w.P;
  const seed = settings.seed ?? Math.floor(Math.random() * 2 ** 31);
  g.rng = new Rng(seed);
  const scenario = SCENARIOS[settings.scenario] ? settings.scenario : 'cold';
  const sc = SCENARIOS[scenario];
  const s = {
    version: 1,
    seed,
    turn: 0,
    scenario,
    settings: { pace: 1, fog: true, mode: 'solo', ...settings, scenario },
    tension: sc.tension,
    aggression: sc.aggression * ([0.5, 1, 1.6].includes(Number(settings.aggression)) ? Number(settings.aggression) : 1),
    prov: {},
    countries: [],
    formations: new Map(),
    battles: new Map(),
    wars: [],
    rel: new Int8Array(C * C),
    alliance: new Uint8Array(C * C),
    access: new Uint8Array(C * C),
    claims: new Uint8Array(C * C),
    nap: new Uint8Array(C * C),
    blocs: [],
    empires: [],
    players: {},
    operations: [],
    events: [],
    reports: [],
    modifiers: [],
    log: [],
    nextId: { f: 1, b: 1, w: 1, op: 1, r: 1, e: 1 },
    lastBattles: [],
  };
  g.s = s;

  // ------------------------------------------------------------ provinces
  for (const k of PROV_FIELDS) s.prov[k] = k === 'owner' || k === 'ctrl' || k === 'lastChange' ? new Uint16Array(P) : new Uint8Array(P);
  const pv = w.provinces;
  for (let p = 0; p < P; p++) {
    const c = pv.country[p];
    const country = w.countries[c];
    s.prov.owner[p] = c;
    s.prov.ctrl[p] = c;
    const rich = /^1|^2/.test(country.income || '') ? 1 : /^3/.test(country.income || '') ? 0.6 : 0.3;
    const density = pv.pop[p] / Math.max(1, pv.km2[p]);
    s.prov.infra[p] = clamp(Math.round(1 + rich * 2.2 + Math.min(1.8, density / 150) + pv.urban[p] * 0.4), 1, 5);
    s.prov.rail[p] = clamp(Math.round(rich * 1.5 + Math.min(1.5, density / 200) - (pv.terrain[p] >= 4 ? 1 : 0)), 0, 3);
    const gdpShare = pv.gdp[p] / Math.max(1, country.gdp);
    s.prov.civ[p] = clamp(Math.round(Math.sqrt(pv.gdp[p] / 20000)), 0, 10);
    s.prov.mil[p] = clamp(Math.round(Math.sqrt(pv.gdp[p] / 60000) * (0.5 + gdpShare * 2)), 0, 10);
    s.prov.port[p] = pv.port[p];
    s.prov.airbase[p] = pv.airbase[p];
    s.prov.stab[p] = 70;
  }

  // ------------------------------------------------------------ countries
  for (let c = 0; c < C; c++) {
    const wc = w.countries[c];
    const mil = MILITARY[wc.iso3] || estimateMilitary(wc.pop, wc.gdp, wc.income);
    const gdpBn = wc.gdp / 1000;
    const persona = PERSONALITY_OF[wc.iso3] || (mil.tech >= 4 ? 'mercantile' : g.rng.chance(0.5) ? 'isolationist' : 'opportunist');
    const milShare = clamp(mil.budget / Math.max(1, gdpBn), 0.008, 0.12);
    const cap = wc.capital;
    const country = {
      id: c,
      alive: true,
      treasury: Math.round(gdpBn * 0.04 + 2),
      manpower: Math.round(mil.reserve * 1000 + wc.pop * 0.003),
      stock: { small: 0, vehicles: 0, tanks: 0, guns: 0, ad: 0, aircraft: 0, ships: 0, ammo: 0, fuel: 0, materials: 0, food: 0, components: 0 },
      lines: [],
      queue: [],
      mob: mil.active > 500 || persona === 'unstable' ? 1 : 0,
      stability: persona === 'unstable' ? 45 : 65 + Math.round(mil.tech * 3),
      warSupport: 40,
      exhaustion: 0,
      tech: mil.tech,
      personality: persona,
      milShare,
      mil,
      air: { fighter: mil.fighters, cas: mil.cas, bomber: mil.bombers, recon: Math.round(mil.fighters * 0.08), transport: mil.transport },
      navy: { carrier: mil.carriers, destroyer: mil.destroyers, frigate: mil.frigates, submarine: mil.subs, transport: Math.round(mil.transport / 10) },
      capital: cap,
      ai: { next: g.rng.int(4), target: -1, prep: 0, lastWar: -99, plan: null },
      stats: { battlesWon: 0, battlesLost: 0, captured: 0, lost: 0, casualties: 0, kills: 0 },
      income: 0,
      ic: 0,
      supplyAvg: 1,
      score: 0,
    };
    s.countries.push(country);
  }

  // ------------------------------------------------------------ diplomacy
  const iso = (x) => w.countryByIso.get(x);
  const rng = g.rng;
  // neighbours start mildly positive, everyone else neutral
  for (let a = 0; a < P; a++) {
    for (let k = w.adjStart[a]; k < w.adjStart[a + 1]; k++) {
      const b = w.adjTo[k];
      if (b >= P) continue;
      const ca = pv.country[a];
      const cb = pv.country[b];
      if (ca !== cb) {
        s.rel[ca * C + cb] = 10;
        s.rel[cb * C + ca] = 10;
      }
    }
  }
  const setRel = (a, b, v) => {
    s.rel[a * C + b] = v;
    s.rel[b * C + a] = v;
  };
  for (const bloc of BLOCS) {
    const members = bloc.members.map(iso).filter((x) => x !== undefined);
    s.blocs.push({ id: s.blocs.length, name: bloc.name, color: bloc.color, members, leader: members[0] });
    for (const a of members) for (const b of members) if (a !== b) {
      s.alliance[a * C + b] = 1;
      setRel(a, b, 55);
    }
  }
  for (const [x, y] of PACTS) {
    const a = iso(x);
    const b = iso(y);
    if (a === undefined || b === undefined) continue;
    s.alliance[a * C + b] = 1;
    s.alliance[b * C + a] = 1;
    setRel(a, b, 60);
  }
  for (const [x, y, v, claim] of RIVALRIES) {
    const a = iso(x);
    const b = iso(y);
    if (a === undefined || b === undefined) continue;
    setRel(a, b, v + rng.int(10) - 5);
    if (claim) {
      s.claims[a * C + b] = 1;
      s.claims[b * C + a] = 1;
    }
  }

  // ------------------------------------------------------------ forces
  for (let c = 0; c < C; c++) deployForces(g, c);
  g.index();

  // ------------------------------------------------------------ scenario wars
  for (const [x, y] of sc.wars) {
    const a = iso(x);
    const b = iso(y);
    if (a === undefined || b === undefined) continue;
    declareWar(g, a, b, { reason: 'Scenario', silent: true });
  }
  void PERSONALITIES;
  initStrategic(g);
}

// Convert real-world force levels into formations placed on the map.
export function deployForces(g, c) {
  const w = g.w;
  const s = g.s;
  const country = s.countries[c];
  const mil = country.mil;
  const provs = w.provincesOf[c];
  if (!provs.length) return;
  const landShare = mil.carriers > 2 ? 0.42 : mil.active > 800 ? 0.6 : 0.5;
  const total = Math.max(2, Math.round((mil.active * 1000 * landShare) / 330));
  const cap = (x, frac) => Math.min(Math.round(x), Math.round(total * frac));
  const comp = { armor: cap(mil.tanks / 14, 0.22), mech: cap(mil.afv / 45, 0.28), art: cap(mil.artillery / 8, 0.16), ad: Math.round(total * 0.035), sf: Math.round(total * 0.02) };
  comp.mot = mil.tech >= 3 ? Math.round(total * 0.08) : 0;
  comp.inf = Math.max(1, total - comp.armor - comp.mech - comp.art - comp.ad - comp.sf - comp.mot);
  // equipment reserve for reinforcements (~15% of the force)
  country.stock.small = Math.round((comp.inf + comp.mot + comp.mech + comp.sf) * 0.15);
  country.stock.vehicles = Math.round((comp.mot * 0.5 + comp.mech) * 0.15);
  country.stock.tanks = Math.round(comp.armor * 0.15);
  country.stock.guns = Math.round(comp.art * 0.15);
  country.stock.ad = Math.round(comp.ad * 0.15);
  country.stock.ammo = total * 3;
  country.stock.fuel = total * 3;
  country.stock.materials = 20 + Math.round(w.countries[c].gdp / 50000);
  country.stock.food = 20;
  country.stock.components = 5 + mil.tech * 3;
  country.stock.aircraft = Math.round(mil.fighters * 0.1);
  country.stock.ships = 0;

  // split into formations of ~48 elements; small countries get 1–3
  const nForm = Math.max(1, Math.min(120, Math.round(total / 48)));
  const types = Object.keys(comp).filter((t) => comp[t] > 0);
  const left = { ...comp };
  const forms = [];
  for (let i = 0; i < nForm; i++) {
    const part = {};
    for (const t of types) {
      const n = i === nForm - 1 ? left[t] : Math.round(comp[t] / nForm);
      if (n > 0) {
        part[t] = n;
        left[t] -= n;
      }
    }
    if (Object.keys(part).length) forms.push(part);
  }
  // placement weights: capital, borders with rivals/foreign land, population
  const weight = new Map();
  const pv = w.provinces;
  for (const p of provs) {
    let wgt = 1 + Math.sqrt(pv.pop[p] / 1e6);
    if (p === country.capital) wgt += 4;
    for (let k = w.adjStart[p]; k < w.adjStart[p + 1]; k++) {
      const q = w.adjTo[k];
      if (q >= w.P) continue;
      const o = pv.country[q];
      if (o !== c) {
        wgt += 1.5;
        if (s.rel[c * g.C + o] < -30) wgt += 6;
      }
    }
    weight.set(p, wgt);
  }
  const armored = (part) => (part.armor || 0) + (part.mech || 0) > (part.inf || 0) * 0.6;
  let totalW = 0;
  for (const v of weight.values()) totalW += v;
  forms.sort((a, b) => Object.values(b).reduce((x, y) => x + y, 0) - Object.values(a).reduce((x, y) => x + y, 0));
  forms.forEach((part, i) => {
    // pick provinces proportionally to weight, spreading formations out
    let r = g.rng.next() * totalW;
    let prov = provs[0];
    for (const [p, wgt] of weight) {
      r -= wgt;
      if (r <= 0) {
        prov = p;
        break;
      }
    }
    weight.set(prov, weight.get(prov) * 0.55);
    totalW = 0;
    for (const v of weight.values()) totalW += v;
    const kind = armored(part) ? 'Armored' : (part.mot || 0) + (part.mech || 0) > (part.inf || 0) * 0.3 ? 'Mechanized' : 'Infantry';
    const n = Object.values(part).reduce((x, y) => x + y, 0);
    const echelon = n > 40 ? 'Division' : n > 16 ? 'Brigade' : n > 6 ? 'Task Force' : 'Detachment';
    newFormation(g, { owner: c, prov, comp: part, name: `${ordinal(i + 1)} ${kind} ${echelon}`, exp: 0.2 + mil.tech * 0.06 });
  });
}

// Add a human commander to the campaign.
export function addPlayer(g, id, { name = 'Commander', country, rank = 0 }) {
  const s = g.s;
  const r = clamp(rank | 0, 0, RANKS.length - 1);
  const p = {
    id,
    name,
    country,
    rank: r,
    xp: 0,
    cp: RANKS[r].cp * 2,
    influence: 10,
    hq: s.countries[country].capital,
    formations: [],
    directives: [],
    stats: { battles: 0, battlesWon: 0, captured: 0, directives: 0, operations: 0, opsWon: 0, supplyTurns: 0, frontTurns: 0, warWon: 0, theaterWin: 0, promotions: 0 },
    rating: 0.6,
    timeInGrade: 0,
    inbox: [],
    unlockSeen: r,
    standing: 'defensive',
    online: true,
    away: false,
    joined: s.turn,
    orderCount: 0,
    tutorial: r === 0 ? 0 : -1,
    ai: { economy: r < 49, diplomacy: r < 49 },
  };
  s.players[id] = p;
  // starting command
  if (r >= 49) {
    for (const f of s.formations.values()) if (f.owner === country) {
      f.ctrl = id;
      p.formations.push(f.id);
    }
  } else {
    const hq = pickStartProvince(g, country);
    p.hq = hq;
    const cap = RANKS[r];
    const f = newFormation(g, { owner: country, prov: hq, comp: { inf: Math.min(cap.elements, 2 + Math.floor(r / 3)) }, name: `${name}'s Detachment`, exp: 0.3 });
    f.ctrl = id;
    f.str = 1;
    p.formations.push(f.id);
    s.countries[country].manpower -= g.men(f);
  }
  g.notify(id, { kind: 'career', title: `Welcome, ${RANKS[r].name}`, text: `You serve ${g.countryName(country)}.` });
  return p;
}

// Where a new recruit reports: the most threatened border province, else the capital.
function pickStartProvince(g, c) {
  const w = g.w;
  const s = g.s;
  let best = s.countries[c].capital;
  let bv = -1;
  for (const p of w.provincesOf[c]) {
    let v = 0;
    for (let k = w.adjStart[p]; k < w.adjStart[p + 1]; k++) {
      const q = w.adjTo[k];
      if (q >= w.P) continue;
      const o = s.prov.ctrl[q];
      if (o === c) continue;
      if (g.atWar(c, o)) v += 100;
      v += Math.max(0, -s.rel[c * g.C + o]) / 10 + 1;
    }
    v += g.rng.next();
    if (v > bv) {
      bv = v;
      best = p;
    }
  }
  return best;
}
