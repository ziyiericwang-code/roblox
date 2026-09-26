// Supply networks, air superiority, weather and intelligence (all recomputed once per turn).
import { TERRAIN_RULES, WEATHER } from '../../config/terrain.js';
import { Heap, clamp } from './util.js';
import { supplySources } from './fronts.js';
import { equipNeed } from './formations.js';

// ------------------------------------------------------------ supply
export function computeSupply(g) {
  const s = g.s;
  const w = g.w;
  const P = g.P;
  const C = g.C;
  const need = new Set();
  for (const f of s.formations.values()) {
    if (f.prov >= P) continue;
    const o = s.prov.owner[f.prov];
    if (o !== f.owner || g.atWar(f.owner, s.prov.ctrl[f.prov]) || s.countries[f.owner].atWar) need.add(f.owner);
  }
  g.supply = new Map();
  for (const c of need) {
    const lvl = new Float32Array(P);
    const dist = new Float32Array(P).fill(Infinity);
    const heap = new Heap();
    for (const [p, str] of supplySources(g, c)) {
      const d = -Math.log(Math.max(0.05, str)) / 0.45;
      if (d < dist[p]) {
        dist[p] = d;
        heap.push(d, p);
      }
    }
    while (heap.size) {
      const d = heap.topKey();
      const a = heap.pop();
      if (d > dist[a]) continue;
      for (let k = w.adjStart[a]; k < w.adjStart[a + 1]; k++) {
        const b = w.adjTo[k];
        if (b >= P) continue;
        const o = s.prov.ctrl[b];
        if (!(o === c || g.allied(c, o) || s.access[o * C + c])) continue;
        const road = 1 + 0.25 * s.prov.infra[b] + 0.55 * s.prov.rail[b];
        let cost = w.adjKm[k] / road / 380;
        if (g.hostileIn(b, c).length) cost *= 2.5;
        const air = g.airOver ? g.airOver(b, c, -1) : 0.5;
        if (air < 0.4) cost *= 1 + (0.4 - air) * 2;
        const nd = d + cost;
        if (nd < dist[b]) {
          dist[b] = nd;
          heap.push(nd, b);
        }
      }
    }
    const nat = s.countries[c];
    const stockF = Math.min(1, (nat.stock.ammo + nat.stock.food) / Math.max(1, nat.elementsTotal || 1) / 2);
    for (let p = 0; p < P; p++) {
      if (dist[p] === Infinity) continue;
      const cap = TERRAIN_RULES[w.provinces.terrain[p]].supply * (0.65 + 0.08 * s.prov.infra[p] + 0.1 * s.prov.rail[p]);
      lvl[p] = Math.min(Math.exp(-0.45 * dist[p]), cap) * (0.55 + 0.45 * stockF);
    }
    g.supply.set(c, lvl);
  }
  s.supplyOf = null;
}

export function supplyAt(g, c, p) {
  if (p >= g.P) return 0.6;
  const lvl = g.supply && g.supply.get(c);
  if (!lvl) return g.s.prov.ctrl[p] === c ? 1 : 0.7;
  return lvl[p];
}

// Apply supply to formations, attrition, recovery and reinforcement.
export function supplyTurn(g) {
  const s = g.s;
  const P = g.P;
  for (const c of s.countries) c.elementsTotal = 0;
  for (const f of s.formations.values()) s.countries[f.owner].elementsTotal += g.elements(f);
  for (const f of s.formations.values()) {
    const nat = s.countries[f.owner];
    let lvl = f.encircled ? 0.12 : supplyAt(g, f.owner, f.prov);
    // stacked beyond local capacity
    const here = g.byProv[f.prov].reduce((x, id) => x + (s.formations.get(id)?.owner === f.owner ? g.elements(s.formations.get(id)) : 0), 0);
    if (f.prov < P) {
      const cap = 110 * TERRAIN_RULES[g.w.provinces.terrain[f.prov]].supply * (0.6 + 0.12 * s.prov.infra[f.prov]);
      if (here > cap) lvl *= Math.max(0.55, cap / here);
    }
    f.supplyLvl = lvl;
    const priority = f.reinf === 2 ? 1.15 : f.reinf === 0 ? 0.9 : 1;
    f.supply = clamp(f.supply * 0.45 + lvl * 0.6 * priority - (f.battle ? 0.12 : 0), 0, 1.2);
    let fuelUse = 0;
    for (const t in f.comp) if (t === 'mot' || t === 'mech' || t === 'armor') fuelUse += f.comp[t];
    if (fuelUse) {
      const fuelLvl = nat.stock.fuel > 0 ? lvl : lvl * 0.3;
      f.fuel = clamp(f.fuel * 0.5 + fuelLvl * 0.6, 0, 1.2);
      nat.stock.fuel = Math.max(0, nat.stock.fuel - fuelUse * (f.moved ? 0.25 : 0.06));
    } else f.fuel = 1;
    if (f.battle) nat.stock.ammo = Math.max(0, nat.stock.ammo - g.elements(f) * 0.12);
    // attrition
    const terr = f.prov < P ? TERRAIN_RULES[g.w.provinces.terrain[f.prov]] : null;
    const weather = f.prov < P && g.weatherOf ? WEATHER[g.weatherOf(f.prov)] : WEATHER[0];
    let attr = (terr ? terr.attrition : 0.01) + weather.attrition;
    if (f.supply < 0.35) attr += (0.35 - f.supply) * 0.12;
    if (attr > 0) {
      const men0 = g.men(f);
      f.str = clamp(f.str - attr, 0, 1);
      nat.stats.casualties += men0 - g.men(f);
    }
    // recovery
    if (!f.battle) {
      const rec = (f.order ? 0.1 : 0.2) * (0.3 + 0.7 * Math.min(1, f.supply)) + (s.prov.armyBase[f.prov] ? 0.08 : 0) + (s.prov.command[f.prov] ? 0.05 : 0);
      f.org = clamp(f.org + rec, 0, 1);
      f.morale = clamp(f.morale + (0.75 - f.morale) * 0.1 + (f.supply > 0.7 ? 0.01 : -0.03), 0, 1);
      if (!f.order && (f.posture === 'digin' || f.posture === 'hold')) f.entrench = clamp(f.entrench + (f.posture === 'digin' ? 0.3 : 0.12), 0, 1);
    }
    f.moved = 0;
    // reinforcement
    if (f.str < 1 && f.reinf > 0 && f.supply > 0.35 && !f.encircled) reinforce(g, f, nat);
  }
}

function reinforce(g, f, nat) {
  const rate = (f.reinf === 2 ? 0.2 : 0.1) * Math.min(1, f.supply);
  let add = Math.min(1 - f.str, rate);
  const menFull = g.men({ ...f, str: 1 });
  const men = menFull * add;
  if (nat.manpower < men) add *= Math.max(0, nat.manpower / Math.max(1, men));
  const need = equipNeed(f.comp);
  for (const k in need) {
    const req = need[k] * add;
    if (req <= 0) continue;
    const have = nat.stock[k] || 0;
    if (have < req) add *= Math.max(0.25, have / req);
  }
  if (add <= 0.001) return;
  nat.manpower -= menFull * add;
  for (const k in need) nat.stock[k] = Math.max(0, (nat.stock[k] || 0) - need[k] * add);
  f.str = clamp(f.str + add, 0, 1);
}

// ------------------------------------------------------------ air superiority (abstract air power per strategic area)
export function computeAir(g) {
  const s = g.s;
  const w = g.w;
  const P = g.P;
  const areas = w.areas.length;
  const power = new Map(); // country -> Float32Array(areas)
  for (const war of s.wars) {
    for (const c of [...war.attackers, ...war.defenders]) {
      if (power.has(c)) continue;
      const nat = s.countries[c];
      const air = (nat.air.fighter * 1 + nat.air.cas * 0.4 + nat.air.bomber * 0.2) * (0.6 + 0.12 * nat.tech);
      const arr = new Float32Array(areas);
      // front areas get most of the air force; home areas keep some
      const front = new Map();
      for (let p = 0; p < P; p++) {
        if (s.prov.ctrl[p] !== c) continue;
        for (let k = w.adjStart[p]; k < w.adjStart[p + 1]; k++) {
          const q = w.adjTo[k];
          if (q < P && g.atWar(c, s.prov.ctrl[q])) {
            const a = w.provinces.area[p];
            front.set(a, (front.get(a) || 0) + 1 + (s.prov.airbase[p] ? 1 : 0));
            front.set(w.provinces.area[q], (front.get(w.provinces.area[q]) || 0) + 0.5);
          }
        }
      }
      let tot = 0;
      for (const v of front.values()) tot += v;
      for (const [a, v] of front) arr[a] = (air * 0.8 * v) / Math.max(1, tot);
      for (const p of w.provincesOf[c]) if (s.prov.airbase[p]) arr[w.provinces.area[p]] += (air * 0.2) / 8;
      if (nat.airFocus !== undefined && nat.airFocus >= 0) arr[nat.airFocus] += air * 0.3;
      power.set(c, arr);
    }
  }
  g.airPower = power;
  g.airOver = (p, a, d) => {
    const area = w.provinces.area[p];
    let pa = 0;
    let pd = 0;
    for (const [c, arr] of power) {
      if (c === a || g.allied(c, a)) pa += arr[area];
      else if (d < 0 ? g.atWar(c, a) : c === d || g.allied(c, d)) pd += arr[area];
    }
    if (pa + pd < 1) return 0.5;
    return pa / (pa + pd);
  };
}

// ------------------------------------------------------------ weather (per strategic area, seasonal)
export function updateWeather(g) {
  const s = g.s;
  const w = g.w;
  const areas = w.areas.length;
  if (!s.weather || s.weather.length !== areas) s.weather = new Uint8Array(areas);
  const week = (s.turn + 1) % 52;
  // representative latitude per area
  if (!g.areaLat) {
    g.areaLat = new Float32Array(areas);
    const cnt = new Float32Array(areas);
    for (let p = 0; p < g.P; p++) {
      g.areaLat[w.provinces.area[p]] += w.provinces.lat[p];
      cnt[w.provinces.area[p]]++;
    }
    for (let a = 0; a < areas; a++) g.areaLat[a] /= Math.max(1, cnt[a]);
  }
  for (let a = 0; a < areas; a++) {
    const lat = g.areaLat[a];
    const north = lat >= 0;
    const winter = north ? week < 10 || week > 47 : week > 22 && week < 36;
    const thaw = north ? (week >= 11 && week <= 16) || (week >= 42 && week <= 46) : (week >= 36 && week <= 40) || (week >= 16 && week <= 20);
    const summer = north ? week > 24 && week < 36 : week < 8 || week > 48;
    const r = g.rng.next();
    let st = 0;
    if (Math.abs(lat) > 45 && winter) st = r < 0.25 ? 4 : r < 0.75 ? 3 : 0;
    else if (Math.abs(lat) > 35 && thaw) st = r < 0.45 ? 2 : r < 0.7 ? 1 : 0;
    else if (Math.abs(lat) < 25 && summer) st = r < 0.3 ? 5 : r < 0.5 ? 1 : 0;
    else if (Math.abs(lat) < 35 && Math.abs(lat) > 12 && summer) st = r < 0.25 ? 6 : 0;
    else st = r < 0.18 ? 1 : 0;
    s.weather[a] = st;
  }
  g.weatherOf = (p) => (p < g.P ? s.weather[w.provinces.area[p]] : 0);
}

// ------------------------------------------------------------ intelligence
// Levels per province for country c: 0 unknown, 1 detected, 2 identified, 3 assessed, 4 full.
export function computeIntel(g, c) {
  const s = g.s;
  const w = g.w;
  const P = g.P;
  const lv = new Uint8Array(P);
  const raise = (p, v) => {
    if (lv[p] < v) lv[p] = v;
  };
  const spread = (starts, levels) => {
    // levels: [atDistance0, atDistance1, ...]
    const d = new Map();
    const q = [];
    for (const p of starts) {
      d.set(p, 0);
      q.push(p);
    }
    for (let h = 0; h < q.length; h++) {
      const a = q[h];
      const da = d.get(a);
      raise(a, levels[da]);
      if (da + 1 >= levels.length) continue;
      for (let k = w.adjStart[a]; k < w.adjStart[a + 1]; k++) {
        const b = w.adjTo[k];
        if (b >= P || d.has(b)) continue;
        d.set(b, da + 1);
        q.push(b);
      }
    }
  };
  const nat = s.countries[c];
  const friends = [];
  for (let x = 0; x < g.C; x++) if (x === c || (s.alliance[c * g.C + x] && s.intelShare && s.intelShare[c * g.C + x])) friends.push(x);
  const own = [];
  for (let p = 0; p < P; p++) {
    const o = s.prov.ctrl[p];
    if (o === c || g.allied(c, o)) {
      lv[p] = o === c ? 4 : 3;
      own.push(p);
    }
  }
  // borders of our territory are watched
  const border = [];
  for (const p of own) for (let k = w.adjStart[p]; k < w.adjStart[p + 1]; k++) {
    const q = w.adjTo[k];
    if (q < P && lv[q] < 2) border.push(q);
  }
  for (const q of border) raise(q, 2);
  const fs = [];
  for (const f of s.formations.values()) if (friends.includes(f.owner) && f.prov < P) fs.push(f.prov);
  spread(fs, [4, 3, 1]);
  const radar = [];
  for (let p = 0; p < P; p++) if (s.prov.radar[p] && s.prov.ctrl[p] === c) radar.push(p);
  if (radar.length) spread(radar, [3, 3, 2, 2]);
  // satellites and national intelligence: tech-based detection everywhere we are at war
  if (nat.tech >= 4) for (let p = 0; p < P; p++) if (g.atWar(c, s.prov.ctrl[p])) raise(p, nat.tech >= 5 ? 2 : 1);
  // recon probes
  for (const r of s.recon || []) if (r.country === c && r.until >= s.turn) raise(r.prov, 3);
  return lv;
}

export function intelLevel(g, c, p) {
  if (!g.intelCache) g.intelCache = new Map();
  let lv = g.intelCache.get(c);
  if (!lv) {
    lv = computeIntel(g, c);
    g.intelCache.set(c, lv);
  }
  return p < g.P ? lv[p] : 2;
}
