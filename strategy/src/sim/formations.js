// Formation lifecycle helpers.
import { ELEMENTS } from '../../config/units.js';

export function newFormation(g, { owner, prov, comp, name, exp = 0.3, str = 1, org = 1, ctrl = null }) {
  const s = g.s;
  const id = s.nextId.f++;
  const f = {
    id,
    owner,
    name: name || `Formation ${id}`,
    prov,
    comp: { ...comp },
    str,
    org,
    morale: 0.75,
    exp,
    supply: 1,
    fuel: 1,
    entrench: 0,
    posture: 'hold',
    order: null,
    progress: 0,
    ctrl,
    reinf: 1,
    battle: 0,
    opId: 0,
    born: s.turn,
    moved: 0,
    kills: 0,
    losses: 0,
  };
  s.formations.set(id, f);
  if (g.byProv) g.byProv[prov].push(id);
  return f;
}

export function removeFormation(g, f, reason = 'destroyed') {
  const s = g.s;
  s.formations.delete(f.id);
  if (g.byProv) {
    const list = g.byProv[f.prov];
    const i = list.indexOf(f.id);
    if (i >= 0) list.splice(i, 1);
  }
  if (f.ctrl) {
    const p = s.players[f.ctrl];
    if (p) {
      p.formations = p.formations.filter((id) => id !== f.id);
      g.notify(p.id, { kind: 'loss', title: `${f.name} ${reason}`, text: `Your formation was ${reason} in ${g.w.provinces.name[f.prov] || 'the field'}.`, prov: f.prov });
    }
  }
}

export function moveFormation(g, f, to) {
  if (f.prov === to) return;
  const list = g.byProv[f.prov];
  const i = list.indexOf(f.id);
  if (i >= 0) list.splice(i, 1);
  f.prov = to;
  g.byProv[to].push(f.id);
}

export function elementCount(comp) {
  let n = 0;
  for (const t in comp) n += comp[t];
  return n;
}

// Split off `part` (element counts) into a new formation in the same province.
export function splitFormation(g, f, part, name) {
  for (const t in part) {
    if (!(part[t] > 0) || !(f.comp[t] >= part[t])) return null;
  }
  const rest = { ...f.comp };
  for (const t in part) {
    rest[t] -= part[t];
    if (rest[t] <= 0) delete rest[t];
  }
  if (!elementCount(rest) || !elementCount(part)) return null;
  f.comp = rest;
  const nf = newFormation(g, { owner: f.owner, prov: f.prov, comp: part, name: name || `${f.name} (detached)`, exp: f.exp, str: f.str, org: f.org, ctrl: f.ctrl });
  nf.supply = f.supply;
  nf.fuel = f.fuel;
  nf.morale = f.morale;
  nf.entrench = f.entrench;
  return nf;
}

// Merge `b` into `a` (same province, same owner).
export function mergeFormations(g, a, b) {
  const na = elementCount(a.comp);
  const nb = elementCount(b.comp);
  const tot = na + nb;
  for (const t in b.comp) a.comp[t] = (a.comp[t] || 0) + b.comp[t];
  const mix = (x, y) => (x * na + y * nb) / tot;
  a.str = mix(a.str, b.str);
  a.org = mix(a.org, b.org);
  a.exp = mix(a.exp, b.exp);
  a.morale = mix(a.morale, b.morale);
  a.supply = mix(a.supply, b.supply);
  a.fuel = mix(a.fuel, b.fuel);
  a.entrench = Math.min(a.entrench, b.entrench);
  removeFormation(g, b, 'merged');
}

// Equipment needed per element (sets)
export function equipNeed(comp) {
  const need = {};
  for (const t in comp) {
    for (const [k, v] of Object.entries(ELEMENTS[t].equip)) need[k] = (need[k] || 0) + v * comp[t];
  }
  return need;
}
