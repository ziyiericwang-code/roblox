// Pathfinding and per-impulse movement.
import { TERRAIN_RULES, WEATHER } from '../../config/terrain.js';
import { EDGE_STRAIT } from '../shared/world.js';
import { Heap } from './util.js';
import { moveFormation } from './formations.js';
import { joinOrStartBattle } from './combat.js';
import { onCapture } from './turn-events.js';

export function edgeCost(g, a, b, f) {
  const w = g.w;
  const k = w.edgeIndex(a, b);
  if (k < 0) return Infinity;
  const t = w.provinces.terrain[b] ?? 0;
  const infra = b < g.P ? g.s.prov.infra[b] : 0;
  let cost = w.adjKm[k] / (TERRAIN_RULES[t].move * (1 + 0.15 * infra));
  if (w.adjFlags[k] & EDGE_STRAIT) cost *= 1.6;
  const weather = g.weatherOf ? WEATHER[g.weatherOf(b)] : null;
  if (weather) cost /= weather.move;
  void f;
  return cost;
}

// A* over land provinces for country c. Enemy provinces are passable (they become attacks),
// neutral territory without access is blocked. Returns [start, ..., target] or null.
export function findPath(g, c, from, to, { maxNodes = 4000, avoidEnemy = true } = {}) {
  if (from === to) return [from];
  const w = g.w;
  const P = g.P;
  if (to >= P) return null;
  const s = g.s;
  const passable = (p) => {
    if (p >= P) return false;
    const ctrl = s.prov.ctrl[p];
    return g.canEnter(c, ctrl);
  };
  if (!passable(to)) return null;
  const gScore = new Map([[from, 0]]);
  const came = new Map();
  const h = (p) => w.kmBetween(p, to) / 1.75;
  const open = new Heap();
  open.push(h(from), from);
  const closed = new Set();
  let n = 0;
  while (open.size) {
    const a = open.pop();
    if (a === to) break;
    if (closed.has(a)) continue;
    closed.add(a);
    if (++n > maxNodes) return null;
    const ga = gScore.get(a);
    for (let k = w.adjStart[a]; k < w.adjStart[a + 1]; k++) {
      const b = w.adjTo[k];
      if (b >= P || closed.has(b) || !passable(b)) continue;
      const t = w.provinces.terrain[b];
      let cost = w.adjKm[k] / (TERRAIN_RULES[t].move * (1 + 0.15 * s.prov.infra[b]));
      if (w.adjFlags[k] & EDGE_STRAIT) cost *= 1.6;
      if (avoidEnemy && g.atWar(c, s.prov.ctrl[b]) && b !== to) cost *= 3;
      const gb = ga + cost;
      if (gb < (gScore.get(b) ?? Infinity)) {
        gScore.set(b, gb);
        came.set(b, a);
        open.push(gb + h(b), b);
      }
    }
  }
  if (!came.has(to)) return null;
  const path = [to];
  let x = to;
  while (x !== from) {
    x = came.get(x);
    path.push(x);
  }
  return path.reverse();
}

// Sea route for naval transport: coastal province -> sea zones -> coastal province.
export function findSeaPath(g, c, from, to) {
  const w = g.w;
  const P = g.P;
  if (!w.provinces.coastal[from] || !w.provinces.coastal[to]) return null;
  const dist = new Map([[from, 0]]);
  const came = new Map();
  const open = new Heap();
  open.push(0, from);
  while (open.size) {
    const a = open.pop();
    if (a === to) break;
    const da = dist.get(a);
    for (let k = w.adjStart[a]; k < w.adjStart[a + 1]; k++) {
      const b = w.adjTo[k];
      // only sea zones as intermediate nodes, land only as the destination
      if (b < P && b !== to) continue;
      if (a < P && b < P) continue;
      const nb = da + w.adjKm[k];
      if (nb < (dist.get(b) ?? Infinity)) {
        dist.set(b, nb);
        came.set(b, a);
        open.push(nb, b);
      }
    }
  }
  if (!came.has(to)) return null;
  const path = [to];
  let x = to;
  while (x !== from) {
    x = came.get(x);
    path.push(x);
  }
  void c;
  return path.reverse();
}

export function speedKm(g, f) {
  let v = g.speed(f);
  if (f.fuel < 0.3) {
    // vehicles crawl without fuel
    let veh = 0;
    let n = 0;
    for (const t in f.comp) {
      n += f.comp[t];
      if (t === 'mot' || t === 'mech' || t === 'armor') veh += f.comp[t];
    }
    if (veh / Math.max(1, n) > 0.3) v = Math.min(v, 120);
  }
  v *= 0.55 + 0.45 * Math.min(1, f.supply);
  v *= 0.6 + 0.4 * f.org;
  if (f.order && f.order.type === 'sea') v = 900;
  if (f.order && f.order.type === 'rail') v = 1600;
  return v;
}

// One movement impulse (a quarter of a turn).
export function moveImpulse(g) {
  const s = g.s;
  const movers = [];
  for (const f of s.formations.values()) if (f.order && f.order.path && !f.battle) movers.push(f);
  movers.sort((a, b) => g.speed(b) - g.speed(a) || a.id - b.id);
  for (const f of movers) stepFormation(g, f);
}

function stepFormation(g, f) {
  const s = g.s;
  const o = f.order;
  const P = g.P;
  if (!o || !o.path || f.battle || !s.formations.has(f.id)) return;
  f.progress += speedKm(g, f) / 4;
  f.entrench = Math.max(0, f.entrench - 0.35);
  for (let guard = 0; guard < 8 && f.order === o && o.idx < o.path.length; guard++) {
    const next = o.path[o.idx];
    let cost;
    if (o.type === 'sea') {
      const k = g.w.edgeIndex(f.prov, next);
      cost = k >= 0 ? g.w.adjKm[k] : 300;
    } else cost = edgeCost(g, f.prov, next, f);
    if (!isFinite(cost)) {
      f.order = null;
      break;
    }
    // attacks against defended provinces start at the border, without waiting to cross
    if (next < P && o.type !== 'sea' && g.hostileIn(next, f.owner).length) {
      joinOrStartBattle(g, f, next, null);
      break;
    }
    const need = next < P && g.atWar(f.owner, s.prov.ctrl[next]) ? cost * 0.6 : cost;
    if (f.progress < need) break;
    if (next >= P) {
      // at sea (naval transport)
      moveFormation(g, f, next);
      f.progress -= cost;
      o.idx++;
      continue;
    }
    const ctrl = s.prov.ctrl[next];
    const enemies = g.hostileIn(next, f.owner);
    if (enemies.length) {
      f.progress = cost;
      joinOrStartBattle(g, f, next, o.type === 'sea' ? 'amphibious' : null);
      break;
    }
    if (g.atWar(f.owner, ctrl)) {
      // walk into an undefended enemy province: capture it
      moveFormation(g, f, next);
      f.moved = 1;
      f.progress -= need;
      o.idx++;
      captureProvince(g, next, f.owner, f);
      if (o.stopOnCapture) {
        f.order = null;
        break;
      }
      continue;
    }
    if (!g.canEnter(f.owner, ctrl)) {
      f.order = null;
      break;
    }
    moveFormation(g, f, next);
    f.moved = 1;
    f.progress -= cost;
    o.idx++;
  }
  if (f.order === o && o.idx >= o.path.length) {
    f.order = null;
    f.progress = 0;
    f.posture = o.then || 'hold';
    if (f.prov >= P) {
      // stranded at sea: return to origin coast
      f.prov = o.path[0];
    }
  }
}

export function captureProvince(g, p, c, f) {
  const s = g.s;
  const prev = s.prov.ctrl[p];
  if (prev === c) return;
  // liberate to owner if the owner is on our side
  const owner = s.prov.owner[p];
  const newCtrl = owner !== c && g.allied(c, owner) && !g.atWar(c, owner) ? owner : c;
  s.prov.ctrl[p] = newCtrl;
  s.prov.lastChange[p] = s.turn;
  s.prov.stab[p] = Math.max(10, s.prov.stab[p] - 25);
  s.prov.fort[p] = Math.max(0, s.prov.fort[p] - 1);
  s.countries[c].stats.captured++;
  s.countries[prev].stats.lost++;
  onCapture(g, p, prev, newCtrl, f);
}
