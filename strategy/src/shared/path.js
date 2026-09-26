// Client-side route preview (the server recomputes and validates every route).
import { TERRAIN_RULES } from '../../config/terrain.js';
import { EDGE_STRAIT } from './world.js';

export function previewPath(world, view, from, to) {
  const w = world;
  const P = w.P;
  if (from === to || to >= P || from >= P) return null;
  const me = view.me.country;
  const ctrl = view.prov.ctrl;
  const allies = new Set([me]);
  for (const [a, b] of view.alliances) {
    if (a === me) allies.add(b);
    if (b === me) allies.add(a);
  }
  const access = new Set(view.access.filter(([d]) => d === 'in').map(([, c]) => c));
  const hostile = new Set();
  for (const war of view.wars) {
    if (war.attackers.includes(me)) war.defenders.forEach((c) => hostile.add(c));
    if (war.defenders.includes(me)) war.attackers.forEach((c) => hostile.add(c));
  }
  const passable = (p) => allies.has(ctrl[p]) || access.has(ctrl[p]) || hostile.has(ctrl[p]);
  if (!passable(to)) return null;
  const infra = view.prov.bld.infra;
  const dist = new Map([[from, 0]]);
  const came = new Map();
  const open = [[w.kmBetween(from, to) / 1.75, from]];
  const closed = new Set();
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, a] = open.splice(bi, 1)[0];
    if (a === to) break;
    if (closed.has(a)) continue;
    closed.add(a);
    if (closed.size > 3000) return null;
    for (let k = w.adjStart[a]; k < w.adjStart[a + 1]; k++) {
      const b = w.adjTo[k];
      if (b >= P || closed.has(b) || !passable(b)) continue;
      let cost = w.adjKm[k] / (TERRAIN_RULES[w.provinces.terrain[b]].move * (1 + 0.15 * (infra[b] || 2)));
      if (w.adjFlags[k] & EDGE_STRAIT) cost *= 1.6;
      if (hostile.has(ctrl[b]) && b !== to) cost *= 3;
      const nd = dist.get(a) + cost;
      if (nd < (dist.get(b) ?? Infinity)) {
        dist.set(b, nd);
        came.set(b, a);
        open.push([nd + w.kmBetween(b, to) / 1.75, b]);
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
  path.reverse();
  return { path, attack: path.some((q) => hostile.has(ctrl[q])), km: Math.round(dist.get(to)) };
}
