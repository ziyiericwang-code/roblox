// Battle forecast computed on the client from what the player actually knows.
// Mirrors the structure of the server combat model with estimates for hidden values.
import { ELEMENTS } from '../../config/units.js';
import { TERRAIN_RULES, RIVER_ATTACK, STRAIT_ATTACK, URBAN_DEFENSE, FORT_DEFENSE } from '../../config/terrain.js';
import { EDGE_RIVER, EDGE_STRAIT } from './world.js';

const KIND_COMP = {
  infantry: { inf: 0.8, art: 0.12, mech: 0.08 },
  armored: { inf: 0.35, mech: 0.3, armor: 0.3, art: 0.05 },
  artillery: { inf: 0.5, art: 0.5 },
};

function sidePower(list, enemyHard, techOf) {
  let atk = 0;
  let def = 0;
  let brk = 0;
  let n = 0;
  let hard = 0;
  let armor = 0;
  let art = 0;
  for (const f of list) {
    let comp = f.comp;
    let total = f.n || 1;
    if (!comp) {
      const k = KIND_COMP[f.kind] || KIND_COMP.infantry;
      comp = {};
      for (const t in k) comp[t] = k[t] * total;
    } else total = Object.values(comp).reduce((a, b) => a + b, 0);
    const str = f.str ?? 0.85;
    const org = f.org ?? 0.8;
    const tech = techOf(f.owner);
    const k = str * (0.75 + 0.1 * tech) * (0.85 + 0.35 * (f.exp ?? 0.3)) * (0.35 + 0.65 * org);
    for (const t in comp) {
      const e = ELEMENTS[t];
      const c = comp[t];
      atk += c * (e.soft * (1 - enemyHard) + e.hard * enemyHard) * k;
      def += c * e.def * k;
      brk += c * e.brk * k;
      hard += c * e.hardness;
      if (t === 'armor' || t === 'mech') armor += c;
      if (t === 'art') art += c;
    }
    n += total;
  }
  const d = Math.max(1, n);
  return { atk, def, brk, n, hardness: hard / d, armorShare: armor / d, artShare: art / d };
}

export function forecast(world, view, attackers, target) {
  const w = world;
  const me = view.me.country;
  const enemies = view.formations.filter((f) => f.prov === target && f.owner !== me && isHostile(view, me, f.owner));
  const techOf = (c) => view.countries[c]?.tech ?? 3;
  const known = enemies.every((f) => f.comp);
  if (!enemies.length) return { odds: 0.97, empty: true, factors: [['Undefended', 0]], text: 'Undefended: your forces will walk in.', known: true };
  const unknownSize = enemies.some((f) => f.size && !f.n);
  const est = enemies.map((f) => (f.size && !f.n ? { ...f, n: f.size === 'Large' ? 50 : f.size === 'Medium' ? 24 : 8, kind: 'infantry' } : f));
  const sa0 = sidePower(attackers, 0, techOf);
  const sd0 = sidePower(est, 0, techOf);
  const sa = sidePower(attackers, sd0.hardness, techOf);
  const sd = sidePower(est, sa0.hardness, techOf);
  const t = TERRAIN_RULES[w.provinces.terrain[target]];
  const factors = [];
  let mA = 1;
  let mD = 1;
  const fa = (name, v) => {
    if (Math.abs(v - 1) > 0.01) factors.push([name, Math.round((v - 1) * 100), 'A']);
    mA *= v;
  };
  const fd = (name, v) => {
    if (Math.abs(v - 1) > 0.01) factors.push([name, Math.round((v - 1) * 100), 'D']);
    mD *= v;
  };
  fa('Terrain', t.attack * (1 - sa.armorShare * (1 - t.armor)));
  fd('Terrain', t.defense);
  const origins = new Set(attackers.map((f) => f.prov));
  let cross = 0;
  let wsum = 0;
  for (const f of attackers) {
    const k = w.edgeIndex(f.prov, target);
    let m = 1;
    if (k >= 0 && w.adjFlags[k] & EDGE_STRAIT) m = STRAIT_ATTACK;
    else if (k >= 0 && w.adjFlags[k] & EDGE_RIVER) m = RIVER_ATTACK;
    cross += m * (f.n || 1);
    wsum += f.n || 1;
  }
  const cm = cross / Math.max(1, wsum);
  if (cm < 0.99) fa(cm <= STRAIT_ATTACK + 0.05 ? 'Strait crossing' : 'River crossing', cm);
  if (origins.size > 1) fa('Attack from several sides', 1 + 0.1 * Math.min(3, origins.size - 1));
  const fort = view.prov.fort[target] || 0;
  if (fort) fd('Fortifications', 1 + FORT_DEFENSE * fort * (1 - Math.min(0.6, sa.artShare * 2)));
  if (w.provinces.urban[target]) fd('Urban terrain', URBAN_DEFENSE[w.provinces.urban[target]]);
  const ent = est.reduce((a, f) => a + (f.entrench ?? 0.4) * (f.n || 1), 0) / Math.max(1, est.reduce((a, f) => a + (f.n || 1), 0));
  if (ent > 0.05) fd('Dug in', 1 + 0.25 * ent);
  const sup = attackers.reduce((a, f) => a + Math.min(1, f.supply ?? 1), 0) / Math.max(1, attackers.length);
  fa('Supply', 0.5 + 0.5 * sup);
  if (sa.artShare > 0.05) fa('Artillery preparation', 1 + Math.min(0.3, sa.artShare * 1.2));
  if (sa.armorShare > 0.15 && 1 - sa.armorShare - sa.artShare > 0.25 && sa.artShare > 0.05) fa('Combined arms', 1.1);
  const lv = view.prov.intel[target];
  if (lv <= 1) fa('Poor intelligence', 0.9);
  else if (lv >= 3) fa('Good intelligence', 1.08);
  const frontage = t.frontage * (1 + 0.5 * Math.min(2, origins.size - 1));
  const engA = Math.min(1, frontage / Math.max(1, sa.n));
  const engD = Math.min(1, t.frontage / Math.max(1, sd.n));
  const ratioA = (sa.atk * engA * mA) / Math.max(0.01, sd.def * engD * mD);
  const ratioD = (sd.atk * engD * (ent > 0.05 ? 1 + 0.25 * ent : 1)) / Math.max(0.01, sa.brk * engA);
  // rounds to break each side (org starts ~ average org)
  const orgA = attackers.reduce((a, f) => a + (f.org ?? 0.8), 0) / Math.max(1, attackers.length);
  const orgD = est.reduce((a, f) => a + (f.org ?? 0.8), 0) / Math.max(1, est.length);
  const dmgD = 0.055 * Math.pow(ratioA, 0.75);
  const dmgA = 0.055 * Math.pow(ratioD, 0.75);
  const tD = orgD / Math.max(0.001, dmgD);
  const tA = orgA / Math.max(0.001, dmgA);
  const edge = Math.log(tA / Math.max(0.001, tD));
  const odds = 1 / (1 + Math.exp(-edge * 2.2));
  const uncertain = !known || unknownSize;
  const lossesA = Math.round(sa.n * 150 * Math.min(1, Math.min(tA, tD) * dmgA * 0.16));
  const lossesD = Math.round(sd.n * 150 * Math.min(1, Math.min(tA, tD) * dmgD * 0.16));
  factors.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const label = odds > 0.75 ? 'Favorable' : odds > 0.55 ? 'Slightly favorable' : odds > 0.42 ? 'Even' : odds > 0.25 ? 'Unfavorable' : 'Very unfavorable';
  return { odds, label, ratio: sa.n / Math.max(1, sd.n), factors, lossesA, lossesD, uncertain, known: !uncertain, turns: Math.max(1, Math.ceil(Math.min(tA, tD) / 12)) };
}

function isHostile(view, me, c) {
  return view.wars.some((w) => (w.attackers.includes(me) && w.defenders.includes(c)) || (w.defenders.includes(me) && w.attackers.includes(c)));
}
