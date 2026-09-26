// Wars, peace, alliances, access and the acceptance model shared by AI and humans.
import { PERSONALITIES } from '../../config/scenario.js';
import { clamp } from './util.js';

const WAR_NAMES = ['War', 'Conflict', 'Crisis', 'Campaign', 'Border War'];

export function warBetween(g, a, b) {
  return g.s.wars.find((w) => (w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a)));
}
export function warsOf(g, c) {
  return g.s.wars.filter((w) => w.attackers.includes(c) || w.defenders.includes(c));
}
export function sideOf(w, c) {
  return w.attackers.includes(c) ? 'A' : w.defenders.includes(c) ? 'D' : null;
}

function relAdd(g, a, b, d) {
  const C = g.C;
  const s = g.s;
  s.rel[a * C + b] = clamp(s.rel[a * C + b] + d, -100, 100);
  s.rel[b * C + a] = clamp(s.rel[b * C + a] + d, -100, 100);
}
export function opinion(g, a, b) {
  return g.s.rel[a * g.C + b];
}

export function declareWar(g, a, d, { reason = 'Aggression', silent = false } = {}) {
  const s = g.s;
  const C = g.C;
  if (a === d || g.atWar(a, d)) return null;
  const nameA = g.countryName(a);
  const nameD = g.countryName(d);
  const war = {
    id: s.nextId.w++,
    name: `${nameA}–${nameD} ${WAR_NAMES[(a + d) % WAR_NAMES.length]}`,
    attackers: [a],
    defenders: [d],
    start: s.turn,
    reason,
    score: 0,
    battles: 0,
    exhaustA: 0,
    exhaustD: 0,
  };
  s.wars.push(war);
  // alliances between the two break
  s.alliance[a * C + d] = 0;
  s.alliance[d * C + a] = 0;
  s.access[a * C + d] = 0;
  s.access[d * C + a] = 0;
  const justified = s.claims[a * C + d] === 1 || reason === 'Scenario' || reason === 'Retaliation';
  relAdd(g, a, d, -50);
  for (let c = 0; c < C; c++) {
    if (c === a || c === d) continue;
    if (!justified) s.rel[c * C + a] = clamp(s.rel[c * C + a] - 8, -100, 100);
  }
  s.tension = clamp(s.tension + (justified ? 4 : 8), 0, 100);
  if (!justified) s.countries[a].stability = clamp(s.countries[a].stability - 5, 0, 100);
  g.index();
  if (!silent) {
    g.notify('all', { kind: 'war', title: `${nameA} declared war on ${nameD}`, text: reason, countries: [a, d] });
  }
  // call allies
  callAllies(g, war, d, 'D');
  callAllies(g, war, a, 'A');
  return war;
}

function callAllies(g, war, c, side) {
  const s = g.s;
  const C = g.C;
  const enemyLead = side === 'D' ? war.attackers[0] : war.defenders[0];
  for (let x = 0; x < C; x++) {
    if (x === c || !s.countries[x].alive || s.alliance[c * C + x] !== 1) continue;
    if (war.attackers.includes(x) || war.defenders.includes(x)) continue;
    if (s.alliance[enemyLead * C + x] === 1) continue; // allied to both: stays out
    const pers = PERSONALITIES[s.countries[x].personality];
    let join;
    if (side === 'D') join = g.humanRuns(x) ? true : g.rng.next() < 0.35 + 0.65 * pers.loyalty;
    else join = !g.humanRuns(x) && opinion(g, x, enemyLead) < -25 && g.rng.next() < pers.aggression * 0.6;
    if (join) joinWar(g, x, war, side);
  }
}

export function joinWar(g, c, war, side) {
  if (war.attackers.includes(c) || war.defenders.includes(c)) return;
  (side === 'A' ? war.attackers : war.defenders).push(c);
  g.index();
  const enemies = side === 'A' ? war.defenders : war.attackers;
  for (const e of enemies) relAdd(g, c, e, -30);
  g.notify('all', { kind: 'war', title: `${g.countryName(c)} joined the ${war.name}`, text: side === 'A' ? 'on the attacking side' : 'in defense of its allies', countries: [c] });
}

// value of territory for war score and AI targeting
export function provinceValue(g, p) {
  const w = g.w;
  const pv = w.provinces;
  let v = 1 + Math.sqrt(pv.pop[p] / 1e6) * 1.2 + pv.urban[p] * 1.5 + (pv.oil[p] + pv.minerals[p] + pv.rare[p]) * 0.08;
  const c = g.s.prov.owner[p];
  if (g.s.countries[c] && g.s.countries[c].capital === p) v += 8;
  return v;
}

export function updateWarScores(g) {
  const s = g.s;
  const P = g.P;
  for (const war of s.wars) {
    let valA = 0;
    let valD = 0;
    let occA = 0; // defender land held by attackers
    let occD = 0;
    for (let p = 0; p < P; p++) {
      const o = s.prov.owner[p];
      const c = s.prov.ctrl[p];
      const v = provinceValue(g, p);
      if (war.attackers.includes(o)) {
        valA += v;
        if (war.defenders.includes(c)) occD += v;
      } else if (war.defenders.includes(o)) {
        valD += v;
        if (war.attackers.includes(c)) occA += v;
      }
    }
    const occScore = (occA / Math.max(1, valD)) * 100 - (occD / Math.max(1, valA)) * 100;
    war.score = clamp(Math.round(occScore * 0.8 + (war.battleScore || 0) * 0.2), -100, 100);
    war.occA = occA / Math.max(1, valD);
    war.occD = occD / Math.max(1, valA);
    const dur = s.turn - war.start;
    war.exhaustA = clamp(dur * 0.4 + (war.lossesA || 0) / 20000 + war.occD * 40, 0, 100);
    war.exhaustD = clamp(dur * 0.4 + (war.lossesD || 0) / 20000 + war.occA * 40, 0, 100);
  }
}

// Peace: `winnerSide` takes the listed provinces (must be ones it controls); everything else reverts.
export function makePeace(g, war, { transfers = [], by = null, silent = false } = {}) {
  const s = g.s;
  const P = g.P;
  const members = new Set([...war.attackers, ...war.defenders]);
  const give = new Map(transfers.map(([p, c]) => [p, c]));
  for (let p = 0; p < P; p++) {
    const o = s.prov.owner[p];
    const c = s.prov.ctrl[p];
    if (!members.has(o) && !members.has(c)) continue;
    if (give.has(p)) {
      s.prov.owner[p] = give.get(p);
      s.prov.ctrl[p] = give.get(p);
      s.prov.unrest[p] = 40;
    } else if (c !== o && members.has(c) && members.has(o)) {
      s.prov.ctrl[p] = o;
    }
  }
  s.wars = s.wars.filter((w) => w !== war);
  g.index();
  // truce
  for (const a of war.attackers) for (const d of war.defenders) {
    s.nap[a * g.C + d] = 1;
    s.nap[d * g.C + a] = 1;
    s.countries[a].ai.lastWar = s.turn;
    s.countries[d].ai.lastWar = s.turn;
  }
  // formations stranded in foreign territory go home
  for (const f of s.formations.values()) {
    if (!members.has(f.owner)) continue;
    const ctrl = s.prov.ctrl[f.prov];
    if (f.prov < P && ctrl !== f.owner && !g.allied(f.owner, ctrl) && !s.access[ctrl * g.C + f.owner]) {
      const home = nearestOwned(g, f.prov, f.owner);
      if (home >= 0) {
        const list = g.byProv[f.prov];
        list.splice(list.indexOf(f.id), 1);
        f.prov = home;
        g.byProv[home].push(f.id);
      }
      f.order = null;
    }
    if (f.battle) f.battle = 0;
  }
  for (const [id, b] of s.battles) if (members.has(b.atkCountry) || members.has(b.defCountry)) s.battles.delete(id);
  // commanders of nations that gained land are credited with a won war
  const gainers = new Set(transfers.map(([, c]) => c));
  for (const pl of Object.values(s.players)) if (gainers.has(pl.country)) {
    pl.stats.warWon++;
    pl.stats.theaterWin++;
  }
  checkAnnexations(g);
  if (!silent) {
    const gained = transfers.length ? ` ${transfers.length} province${transfers.length > 1 ? 's' : ''} changed hands.` : ' No territory changed hands.';
    g.notify('all', { kind: 'peace', title: `Peace: ${war.name} is over`, text: `${by ? `${g.countryName(by)} signed the treaty.` : ''}${gained}`, countries: [...members] });
  }
  s.tension = clamp(s.tension - 3, 0, 100);
}

export function nearestOwned(g, from, c) {
  const w = g.w;
  const seen = new Set([from]);
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    const a = q[h];
    if (a < g.P && g.s.prov.ctrl[a] === c) return a;
    for (let k = w.adjStart[a]; k < w.adjStart[a + 1]; k++) {
      const b = w.adjTo[k];
      if (b >= g.P || seen.has(b)) continue;
      seen.add(b);
      q.push(b);
    }
  }
  return g.s.countries[c].capital;
}

// countries with no provinces left are eliminated
export function checkAnnexations(g) {
  const s = g.s;
  const held = new Int32Array(g.C);
  for (let p = 0; p < g.P; p++) held[s.prov.owner[p]]++;
  for (let c = 0; c < g.C; c++) {
    const country = s.countries[c];
    if (!country.alive || held[c] > 0) continue;
    country.alive = false;
    for (const f of [...s.formations.values()]) if (f.owner === c) s.formations.delete(f.id);
    for (const w of s.wars) {
      w.attackers = w.attackers.filter((x) => x !== c);
      w.defenders = w.defenders.filter((x) => x !== c);
    }
    s.wars = s.wars.filter((w) => w.attackers.length && w.defenders.length);
    g.notify('all', { kind: 'war', title: `${g.countryName(c)} has fallen`, text: 'Its territory has been annexed.', countries: [c] });
    g.reindexFormations();
    g.index();
  }
  // capitals move if captured
  for (let c = 0; c < g.C; c++) {
    const country = s.countries[c];
    if (!country.alive) continue;
    const cap = country.capital;
    if (cap >= 0 && s.prov.ctrl[cap] !== c) {
      let best = -1;
      let bv = -1;
      for (const p of g.w.provincesOf[c]) {
        if (s.prov.ctrl[p] !== c || s.prov.owner[p] !== c) continue;
        const v = g.w.provinces.pop[p];
        if (v > bv) {
          bv = v;
          best = p;
        }
      }
      if (best < 0) for (let p = 0; p < g.P; p++) if (s.prov.ctrl[p] === c && s.prov.owner[p] === c) best = p;
      if (best >= 0) {
        country.capital = best;
        country.stability = clamp(country.stability - 15, 0, 100);
        g.notify('all', { kind: 'war', title: `${g.countryName(c)}'s capital has fallen`, text: `The government relocated to ${g.w.provinces.name[best]}.`, prov: cap, countries: [c] });
      }
    }
  }
}

// ------------------------------------------------------------ proposals and acceptance

export const PROPOSALS = {
  alliance: 'Alliance',
  access: 'Military access',
  nap: 'Non-aggression pact',
  peace: 'Peace',
  trade: 'Trade agreement',
  intel: 'Intelligence sharing',
  joinwar: 'Join our war',
  empire: 'Join empire',
};

function powerOf(g, c) {
  let p = 0;
  for (const f of g.s.formations.values()) if (f.owner === c) p += g.power(f);
  return p;
}

export function evaluate(g, from, to, type, terms = {}) {
  const s = g.s;
  const C = g.C;
  const reasons = [];
  const add = (t, v) => {
    if (v) reasons.push([t, Math.round(v)]);
  };
  const op = s.rel[to * C + from];
  const pers = PERSONALITIES[s.countries[to].personality] || PERSONALITIES.opportunist;
  add('Opinion of you', op / 2);
  // shared enemies
  let shared = 0;
  for (let c = 0; c < C; c++) if (c !== from && c !== to && s.rel[from * C + c] < -40 && s.rel[to * C + c] < -40) shared++;
  if (type === 'alliance') {
    add('Shared rivals', Math.min(40, shared * 15));
    add('Alliance appetite', (pers.alliance - 0.5) * 40);
    const wars = warsOf(g, from).length;
    add('You are at war', -wars * 15 * pers.caution);
    const ratio = powerOf(g, from) / Math.max(1, powerOf(g, to));
    add('Your relative strength', clamp((ratio - 1) * 10, -15, 25));
    add('Base reluctance', -25);
  } else if (type === 'access') {
    add('Base reluctance', -10);
    add('Shared rivals', Math.min(30, shared * 10));
    if (g.allied(from, to)) add('Allies', 40);
  } else if (type === 'nap') {
    add('Base', 15);
    add('Caution', pers.caution * 20);
  } else if (type === 'trade') {
    add('Mercantile interest', pers.name === 'Mercantile' ? 30 : 15);
  } else if (type === 'intel') {
    add('Base reluctance', -15);
    if (g.allied(from, to)) add('Allies', 35);
  } else if (type === 'joinwar') {
    const war = s.wars.find((w) => w.id === terms.war);
    if (!war) return { score: -100, reasons: [['No such war', -100]] };
    const enemy = sideOf(war, from) === 'A' ? war.defenders[0] : war.attackers[0];
    add('Opinion of the enemy', -s.rel[to * C + enemy] / 2);
    add('Allies', g.allied(from, to) ? 25 : -20);
    add('Aggression', (pers.aggression - 0.5) * 40);
    add('Risk', -pers.caution * 25);
  } else if (type === 'peace') {
    const war = s.wars.find((w) => w.id === terms.war);
    if (!war) return { score: -100, reasons: [['No such war', -100]] };
    const side = sideOf(war, to);
    const myScore = side === 'A' ? war.score : -war.score;
    const exh = side === 'A' ? war.exhaustA : war.exhaustD;
    add('War exhaustion', exh * 0.8);
    add('War score', -myScore * 0.9);
    const cede = (terms.transfers || []).filter(([, c]) => c !== to).length;
    const gain = (terms.transfers || []).filter(([, c]) => c === to).length;
    add('Territory demanded', -cede * 9);
    add('Territory offered', gain * 7);
    add('Warmongering', -(pers.aggression - 0.4) * 20);
    if (s.turn - war.start < 3) add('War just started', -30);
  } else if (type === 'empire') {
    const ratio = powerOf(g, from) / Math.max(1, powerOf(g, to));
    add('Protection', clamp((ratio - 2) * 8, -30, 40));
    add('Independence', -40 * (1 - pers.loyalty * 0.5));
    add('Shared rivals', Math.min(30, shared * 10));
  }
  const score = reasons.reduce((a, [, v]) => a + v, 0);
  return { score, reasons };
}

export function formAlliance(g, a, b) {
  const s = g.s;
  const C = g.C;
  s.alliance[a * C + b] = 1;
  s.alliance[b * C + a] = 1;
  relAdd(g, a, b, 20);
  g.notify('all', { kind: 'diplomacy', title: `${g.countryName(a)} and ${g.countryName(b)} formed an alliance`, text: '', countries: [a, b] });
}
export function breakAlliance(g, a, b) {
  const s = g.s;
  const C = g.C;
  s.alliance[a * C + b] = 0;
  s.alliance[b * C + a] = 0;
  relAdd(g, a, b, -25);
  g.notify('all', { kind: 'diplomacy', title: `${g.countryName(a)} left its alliance with ${g.countryName(b)}`, text: '', countries: [a, b] });
}
