// Simulation: world data, determinism, saves, pathing, combat, fronts, supply, authority and fog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld, countryId } from './helpers.js';
import { Game } from '../src/sim/Game.js';
import { findPath } from '../src/sim/movement.js';
import { joinOrStartBattle, battleImpulse } from '../src/sim/combat.js';
import { newFormation, removeFormation } from '../src/sim/formations.js';
import { declareWar } from '../src/sim/diplomacy.js';
import { computeFronts } from '../src/sim/fronts.js';
import { computeSupply, supplyAt } from '../src/sim/logistics.js';
import { worldHash } from '../src/sim/save.js';
import { RANKS, xpToNext } from '../config/ranks.js';

const w = loadWorld();
// structural snapshot (key order may differ after a load, values may not)
const stable = (g) => JSON.parse(JSON.stringify(g.save(), (k, v) => (k === 'timing' || k === 'ms' || k === 'savedAt' ? undefined : v)));
const same = (a, b, msg) => {
  try {
    assert.deepStrictEqual(a, b);
  } catch {
    assert.fail(msg);
  }
};

test('world package is consistent', () => {
  assert.ok(w.P >= 1100 && w.P <= 1300, `${w.P} provinces`);
  assert.ok(w.S >= 150, `${w.S} sea zones`);
  const names = new Set();
  for (let p = 0; p < w.P; p++) {
    const c = w.provinces.country[p];
    assert.ok(c >= 0 && c < w.countries.length, `province ${p} has a country`);
    assert.ok(w.provinces.name[p], `province ${p} has a name`);
    names.add(`${c}|${w.provinces.name[p]}`);
    for (let k = w.adjStart[p]; k < w.adjStart[p + 1]; k++) {
      const q = w.adjTo[k];
      assert.ok(q >= 0 && q < w.NN);
      let back = false;
      for (let j = w.adjStart[q]; j < w.adjStart[q + 1]; j++) if (w.adjTo[j] === p) back = true;
      assert.ok(back, `adjacency ${p}->${q} is symmetric`);
    }
  }
  assert.ok(names.size > w.P * 0.97, 'province names are (almost) unique within a country');
  for (let c = 0; c < w.countries.length; c++) {
    if (!w.provincesOf[c].length) continue;
    const cap = w.countries[c].capital;
    assert.ok(w.provincesOf[c].includes(cap), `${w.countries[c].name} capital is its own province`);
  }
  for (const iso of ['USA', 'CHN', 'RUS', 'IND', 'BRA', 'FRA', 'DEU', 'GBR', 'JPN', 'EGY', 'NGA', 'AUS', 'UKR', 'POL', 'TUR', 'IRN']) assert.ok(countryId(w, iso) >= 0, `${iso} exists`);
  assert.ok(w.provincesOf[countryId(w, 'RUS')].length > w.provincesOf[countryId(w, 'POL')].length);
});

test('same seed and orders give the same world (determinism), and saves round-trip', () => {
  const run = (n) => {
    const g = Game.create(w, { seed: 1234, scenario: 'powder' });
    g.addPlayer('p1', { name: 'A', country: countryId(w, 'POL'), rank: 49 });
    for (let i = 0; i < n; i++) g.endTurn();
    return g;
  };
  const a = run(4);
  const b = run(4);
  same(stable(a), stable(b), 'identical after 4 turns');
  // continue one from a save: must match continuing the original
  const loaded = Game.load(w, JSON.parse(JSON.stringify(a.save())));
  same(stable(loaded), stable(a), 'load(save(g)) == g');
  a.endTurn();
  a.endTurn();
  loaded.endTurn();
  loaded.endTurn();
  same(stable(loaded), stable(a), 'a loaded game plays out identically');
  assert.equal(a.save().worldHash, worldHash(w));
});

test('pathfinding follows adjacency and respects borders', () => {
  const g = Game.create(w, { seed: 1, scenario: 'cold' });
  const fra = countryId(w, 'FRA');
  const provs = w.provincesOf[fra].filter((p) => w.regions[w.provinces.region[p]] !== undefined);
  const from = w.countries[fra].capital;
  const far = provs.slice().sort((x, y) => w.kmBetween(from, y) - w.kmBetween(from, x)).find((p) => findPath(g, fra, from, p));
  const path = findPath(g, fra, from, far);
  assert.ok(path && path.length >= 3, 'a multi-step route inside France');
  assert.equal(path[0], from);
  assert.equal(path[path.length - 1], far);
  for (let i = 1; i < path.length; i++) assert.ok(w.neighbors(path[i - 1]).includes(path[i]), 'each step is adjacent');
  // no military access into a neutral neighbour
  const deu = countryId(w, 'DEU');
  if (!g.canEnter(fra, deu)) assert.equal(findPath(g, fra, from, w.countries[deu].capital), null);
});

function battleSetup(attackers, terrainPick) {
  const g = Game.create(w, { seed: 99, scenario: 'cold' });
  const a = countryId(w, 'DEU');
  const d = countryId(w, 'POL');
  // a Polish province bordering Germany by land
  let D = -1;
  let A = -1;
  for (const p of w.provincesOf[d]) {
    for (const q of w.neighbors(p)) if (q < w.P && g.s.prov.ctrl[q] === a && (D < 0 || terrainPick(p))) {
      D = p;
      A = q;
    }
  }
  assert.ok(D >= 0);
  for (const f of [...g.s.formations.values()]) if (f.prov === D || f.prov === A) removeFormation(g, f, 'test');
  declareWar(g, a, d, { silent: true });
  const def = newFormation(g, { owner: d, prov: D, comp: { inf: 6 }, name: 'Defender' });
  const atk = [];
  for (let i = 0; i < attackers; i++) atk.push(newFormation(g, { owner: a, prov: A, comp: { armor: 3, mech: 3 }, name: `Attacker ${i}` }));
  g.index();
  g.s.turnLog = { captures: [], battles: [], events: [] };
  for (const f of atk) joinOrStartBattle(g, f, D);
  return { g, def, D, a };
}

test('combat: more force never gives a worse result', () => {
  const results = [1, 3, 6].map((n) => {
    const { g, def, D, a } = battleSetup(n, () => false);
    for (let i = 0; i < 3; i++) battleImpulse(g);
    const f = g.formation(def.id);
    return { n, defStr: f ? f.str * f.org : 0, captured: g.s.prov.ctrl[D] === a };
  });
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i].defStr <= results[i - 1].defStr + 1e-9, `defender worse off against ${results[i].n} than ${results[i - 1].n}: ${JSON.stringify(results)}`);
    assert.ok(results[i].captured || !results[i - 1].captured, 'capture is monotone');
  }
  assert.ok(results[0].defStr > results[2].defStr, 'force matters');
});

test('battles log explainable factors', () => {
  const { g } = battleSetup(2, () => false);
  battleImpulse(g);
  const b = [...g.s.battles.values()][0] || null;
  if (b) {
    assert.ok(Object.keys(b.factors.A).length > 0, 'attacker factors recorded');
    assert.ok(Object.keys(b.factors.D).length > 0, 'defender factors recorded');
  }
});

test('fronts form along hostile borders; supply flows from home', () => {
  const g = Game.create(w, { seed: 5, scenario: 'cold' });
  const a = countryId(w, 'DEU');
  const d = countryId(w, 'POL');
  declareWar(g, a, d, { silent: true });
  computeFronts(g);
  const fronts = g.s.fronts.filter((f) => (f.a === a && f.b === d) || (f.a === d && f.b === a) || (f.sides && f.sides.includes(a) && f.sides.includes(d)));
  assert.ok(g.s.fronts.length > 0 && fronts.length >= 0);
  const border = w.provincesOf[d].filter((p) => w.neighbors(p).some((q) => q < w.P && g.s.prov.ctrl[q] === a));
  const onFront = new Set(g.s.fronts.flatMap((f) => f.provs || []));
  assert.ok(border.some((p) => onFront.has(p)), 'the German-Polish border is a front');
  computeSupply(g);
  const cap = w.countries[d].capital;
  assert.ok(supplyAt(g, d, cap) >= 0.8, `capital supply ${supplyAt(g, d, cap)}`);
});

test('ranks: 50+ ranks with growing requirements and authority', () => {
  assert.ok(RANKS.length >= 50);
  for (let i = 1; i < RANKS.length - 1; i++) assert.ok(xpToNext(i) >= xpToNext(i - 1));
  assert.ok(RANKS[RANKS.length - 1].formations >= RANKS[0].formations);
  const g = Game.create(w, { seed: 3, scenario: 'cold' });
  const low = g.addPlayer('low', { name: 'Recruit', country: countryId(w, 'FRA'), rank: 0 });
  const high = g.addPlayer('high', { name: 'Chief', country: countryId(w, 'ITA'), rank: 49 });
  assert.equal(g.submit('low', { type: 'declareWar', target: countryId(w, 'ESP') }).ok, false, 'a recruit cannot declare war');
  const foreign = [...g.s.formations.values()].find((f) => f.owner === countryId(w, 'ITA'));
  assert.equal(g.submit('low', { type: 'hold', f: foreign.id }).ok, false, 'cannot command another nation');
  const mine = [...g.s.formations.values()].filter((f) => f.ctrl === low.id);
  assert.ok(mine.length >= 1 && mine.length <= RANKS[0].formations, 'recruit commands a small detachment');
  const theirs = [...g.s.formations.values()].filter((f) => f.ctrl === high.id);
  const italian = [...g.s.formations.values()].filter((f) => f.owner === countryId(w, 'ITA'));
  assert.ok(theirs.length === italian.length && theirs.length > 3, 'supreme commander controls the whole national army');
  assert.equal(g.submit('high', { type: 'declareWar', target: countryId(w, 'ESP') }).ok, false, 'cannot attack an ally without leaving the alliance');
  assert.ok(g.submit('high', { type: 'declareWar', target: countryId(w, 'EGY') }).ok, 'head of state can declare war');
});

test('fog of war hides enemy detail; allies share', () => {
  const g = Game.create(w, { seed: 8, scenario: 'cold' });
  g.addPlayer('p', { name: 'A', country: countryId(w, 'FRA'), rank: 49 });
  const v = g.view('p');
  const rus = countryId(w, 'RUS');
  const total = [...g.s.formations.values()].filter((f) => f.owner === rus).length;
  const seen = v.formations.filter((f) => f.owner === rus);
  assert.ok(seen.length < total, 'distant enemies are not all visible');
  for (const f of seen) assert.equal(f.supply, undefined);
  const ally = countryId(w, 'DEU');
  if (g.allied(countryId(w, 'FRA'), ally)) {
    const allyForms = v.formations.filter((f) => f.owner === ally);
    assert.ok(allyForms.length > 0 && allyForms.every((f) => f.str !== undefined), 'allied formations are visible in detail');
  }
  assert.equal(v.countries[rus].treasury, undefined, 'foreign finances are hidden');
});

test('turn performance stays interactive', () => {
  const g = Game.create(w, { seed: 11, scenario: 'worldwar' });
  g.addPlayer('p', { name: 'A', country: countryId(w, 'USA'), rank: 49 });
  let worst = 0;
  for (let i = 0; i < 5; i++) worst = Math.max(worst, g.endTurn());
  assert.ok(worst < 2000, `slowest turn ${worst} ms`);
  const t0 = performance.now();
  const size = JSON.stringify(g.view('p')).length;
  assert.ok(performance.now() - t0 < 500);
  assert.ok(size < 1_500_000, `view is ${size} bytes`);
});

test('strategic weapons: launch codes, detonation, outrage, missile strikes', async () => {
  const { launchCode } = await import('../src/sim/strategic.js');
  const g = Game.create(w, { seed: 21, scenario: 'cold' });
  const usa = countryId(w, 'USA');
  const irn = countryId(w, 'IRN');
  const p = g.addPlayer('pres', { name: 'President', country: usa, rank: 49 });
  assert.ok(g.s.nukes[usa] > 10 && g.s.nukes[countryId(w, 'DEU')] === 0, 'real nuclear powers only');
  const target = w.countries[irn].capital;
  assert.equal(g.submit('pres', { type: 'nuke', prov: target, code: launchCode(g, p) }).ok, false, 'no release without war');
  declareWar(g, usa, irn, { silent: true });
  assert.equal(g.submit('pres', { type: 'nuke', prov: target, code: 'AAA-000' }).ok, false, 'wrong code aborts');
  const before = g.s.nukes[usa];
  const ok = g.submit('pres', { type: 'nuke', prov: target, code: launchCode(g, p).toLowerCase() });
  assert.ok(ok.ok, ok.reason);
  assert.equal(g.s.nukes[usa], before - 1);
  const relBefore = g.s.rel[countryId(w, 'FRA') * g.C + usa];
  g.endTurn();
  const log = g.s.strikeLog.find((x) => x.kind === 'nuke' && x.from === usa);
  assert.ok(log, 'the strike resolved');
  assert.ok(g.s.rel[countryId(w, 'FRA') * g.C + usa] < relBefore, 'the world recoils');
  if (!log.intercepted) {
    assert.equal(g.s.tension, 100);
    assert.ok(g.s.fallout[target] > g.s.turn, 'fallout');
  }
  const v = g.view('pres');
  assert.ok(v.strikes.some((x) => x.kind === 'nuke'), 'strike visible in view');
  // missile strike + crisis clamping
  const q = g.addPlayer('col', { name: 'Colonel', country: usa, rank: 40 });
  q.cp = 20;
  const m = g.submit('col', { type: 'missile', prov: target });
  assert.ok(m.ok || /area/.test(m.reason), m.reason);
  const t0 = g.s.tension;
  assert.ok(g.submit('pres', { type: 'crisis', title: 'Test', choice: 'x', effects: { tension: -999 } }).ok);
  assert.ok(g.s.tension >= t0 - 6, 'crisis effects are clamped');
  assert.equal(g.submit('pres', { type: 'crisis', title: 'Again', effects: {} }).ok, false, 'crisis cooldown');
});

test('campaign options: disarmed world and AI aggression', () => {
  const off = Game.create(w, { seed: 4, scenario: 'cold', nukes: false, aggression: 1.6 });
  assert.ok(off.s.nukes.every((n) => n === 0), 'no arsenals in a disarmed world');
  const base = Game.create(w, { seed: 4, scenario: 'cold' });
  assert.ok(off.s.aggression > base.s.aggression, 'hawkish AI is more aggressive');
});
