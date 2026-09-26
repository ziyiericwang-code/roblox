// Land battles: multi-formation, multi-round, factor-based. Every modifier is logged so
// reports can explain *why* a battle went the way it did.
import { ELEMENTS } from '../../config/units.js';
import { TERRAIN_RULES, WEATHER, RIVER_ATTACK, STRAIT_ATTACK, AMPHIBIOUS_ATTACK, URBAN_DEFENSE, FORT_DEFENSE } from '../../config/terrain.js';
import { EDGE_RIVER, EDGE_STRAIT } from '../shared/world.js';
import { clamp } from './util.js';
import { moveFormation, removeFormation } from './formations.js';
import { captureProvince } from './movement.js';
import { onBattleEnd } from './turn-events.js';

export function joinOrStartBattle(g, f, prov, kind) {
  const s = g.s;
  for (const b of s.battles.values()) {
    if (b.prov !== prov) continue;
    if (g.atWar(f.owner, b.defCountry) || b.attackers.some((id) => g.allied(g.formation(id)?.owner ?? -1, f.owner))) {
      if (!b.attackers.includes(f.id)) {
        b.attackers.push(f.id);
        b.from[f.id] = f.prov;
        if (kind === 'amphibious') b.amphibious = true;
      }
      f.battle = b.id;
      return b;
    }
  }
  const defenders = g.hostileIn(prov, f.owner);
  if (!defenders.length) return null;
  const b = {
    id: s.nextId.b++,
    prov,
    name: battleName(g, prov),
    atkCountry: f.owner,
    defCountry: defenders[0].owner,
    attackers: [f.id],
    defenders: defenders.map((d) => d.id),
    from: { [f.id]: f.prov },
    start: s.turn,
    rounds: 0,
    lossesA: 0,
    lossesD: 0,
    factors: { A: {}, D: {} },
    amphibious: kind === 'amphibious',
    support: { artillery: 0, cas: 0 },
    startPower: null,
  };
  s.battles.set(b.id, b);
  f.battle = b.id;
  for (const d of defenders) {
    d.battle = b.id;
    if (d.order && d.order.type !== 'hold') d.order = null;
  }
  return b;
}

function battleName(g, prov) {
  const s = g.s;
  const base = g.w.provinces.name[prov];
  s.battleCount = s.battleCount || {};
  const n = (s.battleCount[prov] = (s.battleCount[prov] || 0) + 1);
  const ord = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh'][n] || `${n}th`;
  return n === 1 ? `Battle of ${base}` : `${ord} Battle of ${base}`;
}

function sidePower(g, list, enemyHardness) {
  let atk = 0;
  let def = 0;
  let brk = 0;
  let aa = 0;
  let n = 0;
  let armor = 0;
  let art = 0;
  let recon = 0;
  let hard = 0;
  let morale = 0;
  let supply = 0;
  let org = 0;
  for (const f of list) {
    const tech = 0.75 + 0.1 * g.s.countries[f.owner].tech;
    const exp = 0.85 + 0.35 * f.exp;
    const k = f.str * tech * exp;
    for (const t in f.comp) {
      const e = ELEMENTS[t];
      const c = f.comp[t];
      const fuelPenalty = e.fuel > 0 && f.fuel < 0.3 ? 0.6 : 1;
      atk += c * (e.soft * (1 - enemyHardness) + e.hard * enemyHardness) * k * fuelPenalty;
      def += c * e.def * k;
      brk += c * e.brk * k * fuelPenalty;
      aa += c * e.aa * k;
      recon += c * e.recon;
      hard += c * e.hardness;
      if (t === 'armor' || t === 'mech') armor += c;
      if (t === 'art') art += c;
      n += c;
    }
    morale += f.morale * g.elements(f);
    supply += Math.min(1, f.supply) * g.elements(f);
    org += f.org * g.elements(f);
  }
  const div = Math.max(1, n);
  return { atk, def, brk, aa, n, armorShare: armor / div, artShare: art / div, recon, hardness: hard / div, morale: morale / div, supply: supply / div, org: org / div };
}

// Resolve all active battles for one impulse (3 rounds each).
export function battleImpulse(g) {
  const s = g.s;
  for (const b of [...s.battles.values()]) {
    for (let r = 0; r < 3; r++) {
      if (!s.battles.has(b.id)) break;
      battleRound(g, b);
    }
  }
}

function battleRound(g, b) {
  const s = g.s;
  const w = g.w;
  const A = b.attackers.map((id) => s.formations.get(id)).filter((f) => f && f.battle === b.id);
  // defenders: original ones still here, plus any friendly reinforcements that arrived
  for (const f of g.hostileIn(b.prov, s.formations.get(b.attackers[0])?.owner ?? b.atkCountry)) {
    if (!b.defenders.includes(f.id) && f.battle !== b.id && !f.battle) {
      b.defenders.push(f.id);
      f.battle = b.id;
    }
  }
  const D = b.defenders.map((id) => s.formations.get(id)).filter((f) => f && f.battle === b.id && f.prov === b.prov);
  b.attackers = A.map((f) => f.id);
  b.defenders = D.map((f) => f.id);
  if (!A.length) return endBattle(g, b, 'D');
  if (!D.length) return endBattle(g, b, 'A');
  b.rounds++;

  const p = b.prov;
  const terr = TERRAIN_RULES[w.provinces.terrain[p]];
  const weather = WEATHER[g.weatherOf ? g.weatherOf(p) : 0];
  const sa0 = sidePower(g, A, 0);
  const sd0 = sidePower(g, D, 0);
  const sa = sidePower(g, A, sd0.hardness);
  const sd = sidePower(g, D, sa0.hardness);
  if (!b.startPower) b.startPower = { A: sa.atk, D: sd.def, nA: sa.n, nD: sd.n };
  b.startPower.nA = Math.max(b.startPower.nA, sa.n);
  b.startPower.nD = Math.max(b.startPower.nD, sd.n);

  // frontage and flanking
  const origins = new Set(A.map((f) => b.from[f.id] ?? f.prov));
  const dirs = origins.size;
  const frontA = terr.frontage * (1 + 0.5 * Math.min(2, dirs - 1));
  const engA = Math.min(1, frontA / Math.max(1, sa.n));
  const engD = Math.min(1, terr.frontage / Math.max(1, sd.n));

  const FA = {};
  const FD = {};
  // terrain (armor suffers in close terrain)
  FA.Terrain = terr.attack * (1 - sa.armorShare * (1 - terr.armor));
  FD.Terrain = terr.defense;
  // crossings: weighted by attacking elements per origin
  let cross = 0;
  let wsum = 0;
  for (const f of A) {
    const from = b.from[f.id] ?? f.prov;
    const k = w.edgeIndex(from, p);
    let m = 1;
    if (from >= g.P || b.amphibious) m = AMPHIBIOUS_ATTACK;
    else if (k >= 0 && w.adjFlags[k] & EDGE_STRAIT) m = STRAIT_ATTACK;
    else if (k >= 0 && w.adjFlags[k] & EDGE_RIVER) m = RIVER_ATTACK + (b.bridging ? 0.14 : 0);
    const n = g.elements(f);
    cross += m * n;
    wsum += n;
  }
  const crossM = cross / Math.max(1, wsum);
  if (crossM < 0.99) FA[crossM <= AMPHIBIOUS_ATTACK + 0.01 ? 'Amphibious landing' : crossM <= STRAIT_ATTACK + 0.05 ? 'Strait crossing' : 'River crossing'] = crossM;
  if (dirs > 1) FA['Attack from several sides'] = 1 + 0.1 * Math.min(3, dirs - 1);
  const fort = s.prov.fort[p];
  if (fort) FD.Fortifications = 1 + FORT_DEFENSE * fort * (1 - Math.min(0.6, sa.artShare * 2 + b.support.artillery * 0.15));
  if (w.provinces.urban[p]) FD['Urban terrain'] = URBAN_DEFENSE[w.provinces.urban[p]];
  const ent = D.reduce((x, f) => x + f.entrench * g.elements(f), 0) / Math.max(1, sd.n);
  if (ent > 0.05) FD['Dug in'] = 1 + 0.25 * ent;
  FA.Supply = 0.5 + 0.5 * sa.supply;
  FD.Supply = 0.7 + 0.3 * sd.supply;
  if (weather && weather.attack < 1) FA[`Weather (${weather.name})`] = weather.attack;
  // air superiority over the battle
  const airA = g.airOver ? g.airOver(p, b.atkCountry, b.defCountry) : 0.5;
  const airEff = (x) => 1 + (x - 0.5) * 0.5;
  if (Math.abs(airA - 0.5) > 0.05) {
    FA[airA > 0.5 ? 'Air superiority' : 'Enemy air superiority'] = airEff(airA);
    FD[airA < 0.5 ? 'Air superiority' : 'Enemy air superiority'] = airEff(1 - airA);
  }
  // artillery preparation in the opening rounds
  if (b.rounds <= 3 && (sa.artShare > 0.05 || b.support.artillery)) FA['Artillery preparation'] = 1 + Math.min(0.3, sa.artShare * 1.2 + b.support.artillery * 0.1);
  if (b.support.cas) FA['Close air support'] = 1 + 0.12 * b.support.cas * (1 - Math.min(0.7, sd.aa / Math.max(1, sd.n) / 3));
  // combined arms
  const inf = 1 - sa.armorShare - sa.artShare;
  if (sa.armorShare > 0.15 && inf > 0.25 && sa.artShare > 0.05) FA['Combined arms'] = 1.1;
  // intel
  const intel = g.intelLevel ? g.intelLevel(b.atkCountry, p) : 2;
  if (intel <= 1) FA['Poor intelligence'] = 0.9;
  else if (intel >= 3) FA['Good intelligence'] = 1.08;
  // preparation from operations
  const prep = A.reduce((x, f) => Math.max(x, f.prep || 0), 0);
  if (prep > 0) FA['Operation preparation'] = 1 + prep;
  // encirclement
  if (D.some((f) => f.encircled)) FD.Encircled = 0.75;
  if (A.some((f) => f.encircled)) FA.Encircled = 0.8;
  // morale
  FA.Morale = 0.85 + 0.3 * sa.morale;
  FD.Morale = 0.85 + 0.3 * sd.morale;

  const prod = (F) => Object.values(F).reduce((x, y) => x * y, 1);
  const mA = prod(FA);
  const mD = prod(FD);
  for (const [k, v] of Object.entries(FA)) b.factors.A[k] = v;
  for (const [k, v] of Object.entries(FD)) b.factors.D[k] = v;

  const ratioA = (sa.atk * engA * mA) / Math.max(0.01, sd.def * engD * mD);
  const ratioD = (sd.atk * engD * (FD.Supply * (FD['Dug in'] || 1) * (FD.Morale || 1) * (airA < 0.5 ? airEff(1 - airA) : 1))) / Math.max(0.01, sa.brk * engA * (FA.Morale || 1));
  const rng = g.rng;
  const orgD = 0.055 * Math.pow(ratioA, 0.75) * rng.tri(0.12) * (1.3 - 0.6 * sd.morale);
  const orgA = 0.055 * Math.pow(ratioD, 0.75) * rng.tri(0.12) * (1.3 - 0.6 * sa.morale);
  b.lastRatio = ratioA / Math.max(0.01, ratioD);
  applyDamage(g, A, orgA, b, 'A');
  applyDamage(g, D, orgD, b, 'D');

  const orgOf = (L) => L.reduce((x, f) => x + f.org * g.elements(f), 0) / Math.max(1, L.reduce((x, f) => x + g.elements(f), 0));
  const dBroken = orgOf(D) < 0.08;
  const aBroken = orgOf(A) < 0.08;
  if (dBroken && !aBroken) endBattle(g, b, 'A');
  else if (aBroken) endBattle(g, b, 'D');
}

function applyDamage(g, list, org, b, side) {
  const s = g.s;
  for (const f of list) {
    const hard = g.hardness(f);
    const men0 = g.men(f);
    f.org = clamp(f.org - org, 0, 1);
    f.str = clamp(f.str - org * 0.16 * (1 - hard * 0.35), 0, 1);
    const lost = men0 - g.men(f);
    f.losses += lost;
    if (side === 'A') b.lossesA += lost;
    else b.lossesD += lost;
    s.countries[f.owner].stats.casualties += lost;
    f.entrench = Math.max(0, f.entrench - 0.02);
  }
}

// winner: 'A' attackers or 'D' defenders
export function endBattle(g, b, winner) {
  const s = g.s;
  if (!s.battles.has(b.id)) return;
  s.battles.delete(b.id);
  const A = b.attackers.map((id) => s.formations.get(id)).filter(Boolean);
  const D = b.defenders.map((id) => s.formations.get(id)).filter(Boolean);
  for (const f of [...A, ...D]) if (f.battle === b.id) f.battle = 0;
  let captured = false;
  let surrendered = 0;
  if (winner === 'A') {
    // defenders retreat or surrender
    for (const f of D) {
      if (f.prov !== b.prov) continue;
      const to = retreatTarget(g, f, b);
      if (to < 0) {
        surrendered += g.men(f);
        b.lossesD += g.men(f);
        removeFormation(g, f, 'forced to surrender');
      } else {
        moveFormation(g, f, to);
        f.org = Math.max(0.02, f.org * 0.5);
        f.str = Math.max(0.05, f.str - 0.04);
        f.order = null;
        f.entrench = 0;
      }
    }
    if (!g.hostileIn(b.prov, A[0]?.owner ?? b.atkCountry).length) {
      // attackers that were advancing into the province move in
      const mover = A.filter((f) => f.order && f.order.path && f.order.path[f.order.idx] === b.prov);
      const first = mover[0] || A[0];
      if (first) {
        for (const f of mover.length ? mover : [first]) {
          moveFormation(g, f, b.prov);
          if (f.order) f.order.idx++;
          f.progress = 0;
          if (f.order && f.order.idx >= f.order.path.length) f.order = null;
        }
        if (g.atWar(first.owner, s.prov.ctrl[b.prov])) {
          captureProvince(g, b.prov, first.owner, first);
          captured = true;
        }
      }
    }
    for (const f of A) f.morale = clamp(f.morale + 0.06, 0, 1);
    for (const f of D) f.morale = clamp(f.morale - 0.08, 0, 1);
  } else {
    for (const f of A) {
      if (f.order && f.order.path && f.order.path[f.order.idx] === b.prov) f.order = null;
      f.progress = 0;
      f.morale = clamp(f.morale - 0.06, 0, 1);
    }
    for (const f of D) f.morale = clamp(f.morale + 0.05, 0, 1);
  }
  for (const f of [...A, ...D]) f.exp = clamp(f.exp + 0.03, 0, 1);
  // shattered formations dissolve
  for (const f of [...A, ...D]) if (s.formations.has(f.id) && f.str < 0.08) {
    if (f.owner === b.atkCountry) b.lossesA += g.men(f);
    else b.lossesD += g.men(f);
    removeFormation(g, f, 'shattered');
  }
  onBattleEnd(g, b, winner, { A, D, captured, surrendered });
}

function retreatTarget(g, f, b) {
  const w = g.w;
  const s = g.s;
  let best = -1;
  let bv = -Infinity;
  const attackerOrigins = new Set(Object.values(b.from));
  for (let k = w.adjStart[f.prov]; k < w.adjStart[f.prov + 1]; k++) {
    const q = w.adjTo[k];
    if (q >= g.P) continue;
    const ctrl = s.prov.ctrl[q];
    if (!(ctrl === f.owner || g.allied(f.owner, ctrl))) continue;
    if (g.hostileIn(q, f.owner).length) continue;
    let v = (ctrl === f.owner ? 2 : 1) + (s.supplyOf ? s.supplyOf(f.owner, q) : 0) - (attackerOrigins.has(q) ? 5 : 0) + g.rng.next() * 0.1;
    if (g.byProv[q].some((id) => s.formations.get(id)?.encircled)) v -= 1;
    if (v > bv) {
      bv = v;
      best = q;
    }
  }
  return best;
}
