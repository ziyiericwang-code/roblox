// National economies: revenue, industry, production lines, resources, construction,
// manpower and stability. One pass over provinces per turn.
import { EQUIPMENT } from '../../config/units.js';
import { BUILDINGS, MOBILIZATION, UPKEEP_PER_ELEMENT } from '../../config/economy.js';
import { clamp } from './util.js';
import { equipNeed } from './formations.js';

export function economyTurn(g) {
  const s = g.s;
  const w = g.w;
  const P = g.P;
  const C = g.C;
  const gdp = new Float64Array(C);
  const occupied = new Float64Array(C);
  const res = Array.from({ length: C }, () => ({ oil: 0, minerals: 0, rare: 0, food: 0, pop: 0, civ: 0, mil: 0 }));
  for (let p = 0; p < P; p++) {
    const o = s.prov.owner[p];
    const c = s.prov.ctrl[p];
    const stab = s.prov.stab[p] / 100;
    const dmg = 1 - s.prov.damage[p] / 200;
    const out = w.provinces.gdp[p] * (0.5 + 0.5 * stab) * dmg;
    if (c === o) gdp[o] += out;
    else {
      occupied[o] += out;
      gdp[c] += out * 0.3; // occupiers extract a fraction
    }
    const r = res[c];
    const k = (c === o ? 1 : 0.4) * dmg;
    r.oil += w.provinces.oil[p] * k;
    r.minerals += w.provinces.minerals[p] * k;
    r.rare += w.provinces.rare[p] * k;
    r.food += w.provinces.food[p] * k;
    r.civ += s.prov.civ[p] * k;
    r.mil += s.prov.mil[p] * k;
    if (c === o) r.pop += w.provinces.pop[p];
    // slow stability drift and recovery of damage
    const target = c === o ? 70 : 35;
    s.prov.stab[p] = clamp(s.prov.stab[p] + Math.sign(target - s.prov.stab[p]) * 1, 0, 100);
    if (s.prov.damage[p]) s.prov.damage[p] = Math.max(0, s.prov.damage[p] - 2);
    if (s.prov.unrest[p]) s.prov.unrest[p] = Math.max(0, s.prov.unrest[p] - 1);
  }
  for (let c = 0; c < C; c++) {
    const nat = s.countries[c];
    if (!nat.alive) continue;
    const wc = w.countries[c];
    const r = res[c];
    const mob = MOBILIZATION[nat.mob];
    const gdpBn = gdp[c] / 1000;
    nat.gdpNow = gdpBn;
    nat.atWar = s.wars.some((x) => x.attackers.includes(c) || x.defenders.includes(c));
    // revenue and upkeep ($bn per week)
    const revenue = (gdpBn / 52) * 0.035 * (0.6 + 0.4 * nat.stability / 100) + 0.15 + (s.trade ? tradePartners(g, c) * 0.02 : 0);
    const elements = nat.elementsTotal || 0;
    const airN = nat.air.fighter + nat.air.cas + nat.air.bomber + nat.air.transport;
    const navyN = nat.navy.carrier * 10 + nat.navy.destroyer * 2 + nat.navy.frigate + nat.navy.submarine * 1.5;
    const upkeep = elements * UPKEEP_PER_ELEMENT * (0.6 + 0.1 * nat.tech) + airN * 0.00025 + navyN * 0.0015;
    // the defence budget pays upkeep first; what is left becomes industrial capacity
    const budget = (gdpBn / 52) * nat.milShare;
    nat.upkeep = upkeep;
    nat.income = revenue;
    nat.treasury += revenue;
    if (upkeep > budget * 1.6) nat.stability = clamp(nat.stability - 0.15, 0, 100);
    nat.ic = Math.max(0.2, Math.max(0, budget - upkeep) * 1.3 * mob.industry * (0.85 + 0.05 * r.mil / Math.max(1, w.provincesOf[c].length)) + r.mil * 0.04 + 0.2);
    // raw resources
    nat.stock.fuel += r.oil * 0.9 + 0.5;
    nat.stock.materials += r.minerals * 0.8 + 0.3;
    nat.stock.food += r.food * 0.6 - r.pop / 60e6;
    nat.stock.components += r.rare * 0.25 + nat.tech * 0.12 + r.civ * 0.02;
    if (nat.stock.food < 0) {
      nat.stability = clamp(nat.stability - 1, 0, 100);
      nat.stock.food = 0;
    }
    // import shortfalls with money (crude world market)
    for (const [k, price] of [['fuel', 0.03], ['materials', 0.04], ['components', 0.12]]) {
      if (nat.stock[k] < 20 && nat.treasury > 2 && !nat.embargo) {
        const buy = Math.min(20 - nat.stock[k], (nat.treasury * 0.1) / price);
        nat.stock[k] += buy;
        nat.treasury -= buy * price;
      }
    }
    for (const k of ['fuel', 'materials', 'food', 'components', 'ammo']) nat.stock[k] = Math.min(nat.stock[k], 5000 + elements * 20);
    // manpower
    nat.manpower += (r.pop * mob.manpower) / 52 / 6;
    nat.manpower = Math.min(nat.manpower, r.pop * mob.manpower * 1.5 + 50000);
    // production
    runProduction(g, nat);
    // construction queue
    for (const job of nat.queue) job.left--;
    const done = nat.queue.filter((j) => j.left <= 0);
    nat.queue = nat.queue.filter((j) => j.left > 0);
    for (const j of done) {
      const b = BUILDINGS[j.b];
      s.prov[j.b][j.prov] = Math.min(b.max, s.prov[j.b][j.prov] + 1);
      if (j.by) g.notify(j.by, { kind: 'build', title: `${b.name} completed`, text: `${w.provinces.name[j.prov]} now has ${b.name} level ${s.prov[j.b][j.prov]}.`, prov: j.prov });
    }
    // stability and war support
    const warTarget = nat.atWar ? 45 : 60;
    nat.stability = clamp(nat.stability + (warTarget + mob.stability - nat.stability) * 0.02 - occupied[c] / Math.max(1, wc.gdp) * 3, 0, 100);
    nat.warSupport = clamp(nat.warSupport + (nat.atWar ? -0.3 : 0.2), 0, 100);
  }
}

function tradePartners(g, c) {
  let n = 0;
  for (let x = 0; x < g.C; x++) if (g.s.trade[c * g.C + x]) n++;
  return n;
}

// Production: automatic lines by default (fill equipment gaps, then stockpile ammo).
function runProduction(g, nat) {
  const s = g.s;
  let ic = nat.ic;
  if (!nat.lines.length || nat.autoProduction !== false) nat.lines = autoLines(g, nat);
  const totalShare = nat.lines.reduce((a, l) => a + l.share, 0) || 1;
  for (const l of nat.lines) {
    const item = EQUIPMENT[l.item];
    if (!item) continue;
    const budget = (ic * l.share) / totalShare;
    l.eff = Math.min(1, (l.eff || 0.4) + 0.05);
    const want = (budget * l.eff) / item.ic;
    const mat = item.materials * want;
    const comp = item.components * want;
    const k = Math.min(1, nat.stock.materials / Math.max(0.001, mat), comp > 0 ? nat.stock.components / comp : 1);
    const made = want * Math.max(0, k);
    nat.stock.materials -= item.materials * made;
    nat.stock.components -= item.components * made;
    nat.stock[l.item] = (nat.stock[l.item] || 0) + made;
    l.made = made;
    if (l.item === 'aircraft' && nat.stock.aircraft >= 1) {
      const n = Math.floor(nat.stock.aircraft);
      nat.stock.aircraft -= n;
      nat.air.fighter += Math.ceil(n * 0.6);
      nat.air.cas += Math.floor(n * 0.4);
    }
    if (l.item === 'ships' && nat.stock.ships >= 1) {
      const n = Math.floor(nat.stock.ships);
      nat.stock.ships -= n;
      nat.navy.frigate += n;
    }
  }
  void s;
}

export function autoLines(g, nat) {
  const s = g.s;
  const need = {};
  for (const f of s.formations.values()) {
    if (f.owner !== nat.id || f.str >= 0.98) continue;
    const e = equipNeed(f.comp);
    for (const k in e) need[k] = (need[k] || 0) + e[k] * (1 - f.str);
  }
  const lines = [];
  const reserve = { small: 12, vehicles: 6, tanks: 3, guns: 3, ad: 2 };
  for (const k of Object.keys(reserve)) {
    const gap = Math.max(0, (need[k] || 0) + reserve[k] * (nat.atWar ? 3 : 1) - (nat.stock[k] || 0));
    if (gap > 0) lines.push({ item: k, share: gap * EQUIPMENT[k].ic });
  }
  lines.push({ item: 'ammo', share: nat.atWar ? 6 : 2 });
  if (nat.tech >= 3) lines.push({ item: 'aircraft', share: nat.atWar ? 6 : 2 });
  if (nat.navy.frigate + nat.navy.destroyer > 0 && !nat.atWar) lines.push({ item: 'ships', share: 1 });
  const prev = new Map((nat.lines || []).map((l) => [l.item, l.eff]));
  for (const l of lines) l.eff = prev.get(l.item) ?? 0.5;
  return lines;
}

// Queue a building. Returns an error string or null.
export function queueBuilding(g, c, prov, key, by) {
  const s = g.s;
  const b = BUILDINGS[key];
  if (!b) return 'Unknown building';
  const nat = s.countries[c];
  if (s.prov.ctrl[prov] !== c) return 'You must control the province';
  if (s.battles && [...s.battles.values()].some((x) => x.prov === prov)) return 'Cannot build during a battle';
  const cur = s.prov[key][prov] + nat.queue.filter((j) => j.prov === prov && j.b === key).length;
  if (cur >= b.max) return `${b.name} is already at maximum level`;
  if (key === 'port' && !g.w.provinces.coastal[prov]) return 'Naval bases need a coast';
  const scale = 0.4 + Math.min(2, Math.sqrt((g.w.countries[c].gdp / 1000) / 400));
  const cost = b.cost * scale;
  if (nat.treasury < cost) return `Not enough funds (${cost.toFixed(1)} needed)`;
  if (nat.stock.materials < b.materials) return `Not enough materials (${b.materials} needed)`;
  nat.treasury -= cost;
  nat.stock.materials -= b.materials;
  nat.queue.push({ b: key, prov, left: b.turns, cost, by });
  return null;
}
