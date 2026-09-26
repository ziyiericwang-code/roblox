// Front lines from province control, with stable ids, status and encirclement detection.

export function computeFronts(g) {
  const s = g.s;
  const w = g.w;
  const P = g.P;
  const ctrl = s.prov.ctrl;
  // union-find over provinces touching a hostile border
  const parent = new Int32Array(P).fill(-1);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const edges = [];
  for (let a = 0; a < P; a++) {
    for (let k = w.adjStart[a]; k < w.adjStart[a + 1]; k++) {
      const b = w.adjTo[k];
      if (b >= P || b < a) continue;
      if (!g.atWar(ctrl[a], ctrl[b])) continue;
      edges.push([a, b]);
      if (parent[a] < 0) parent[a] = a;
      if (parent[b] < 0) parent[b] = b;
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }
  }
  // provinces on the same side that touch each other also chain the front
  for (let a = 0; a < P; a++) {
    if (parent[a] < 0) continue;
    for (let k = w.adjStart[a]; k < w.adjStart[a + 1]; k++) {
      const b = w.adjTo[k];
      if (b >= P || parent[b] < 0) continue;
      if (ctrl[a] === ctrl[b] || g.allied(ctrl[a], ctrl[b])) {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[ra] = rb;
      }
    }
  }
  const groups = new Map();
  for (const [a, b] of edges) {
    const r = find(a);
    if (!groups.has(r)) groups.set(r, { edges: [], provs: new Set(), sides: new Set() });
    const gr = groups.get(r);
    gr.edges.push([a, b]);
    gr.provs.add(a);
    gr.provs.add(b);
    gr.sides.add(ctrl[a]);
    gr.sides.add(ctrl[b]);
  }
  const prev = s.fronts || [];
  const out = [];
  const used = new Set();
  for (const gr of groups.values()) {
    // match to the previous front with the largest overlap
    let best = null;
    let bo = 0;
    for (const pf of prev) {
      if (used.has(pf.id)) continue;
      let o = 0;
      for (const p of pf.provs) if (gr.provs.has(p)) o++;
      if (o > bo) {
        bo = o;
        best = pf;
      }
    }
    const id = best ? best.id : (s.nextId.front = (s.nextId.front || 0) + 1);
    if (best) used.add(best.id);
    // naming: most common strategic area among its provinces
    const cnt = new Map();
    for (const p of gr.provs) cnt.set(w.provinces.area[p], (cnt.get(w.provinces.area[p]) || 0) + 1);
    let area = -1;
    let ac = 0;
    for (const [a, c] of cnt) if (c > ac) {
      ac = c;
      area = a;
    }
    const provs = [...gr.provs];
    // strength per side
    const power = new Map();
    let battles = 0;
    for (const p of provs) {
      for (const id2 of g.byProv[p]) {
        const f = s.formations.get(id2);
        if (!f) continue;
        power.set(f.owner, (power.get(f.owner) || 0) + g.power(f));
      }
    }
    for (const b of s.battles.values()) if (gr.provs.has(b.prov)) battles++;
    const changed = provs.filter((p) => s.prov.lastChange && s.prov.lastChange[p] >= s.turn - 1 && s.turn > 0).length;
    const status = battles === 0 ? (changed ? 'Shifting' : 'Quiet') : changed >= 3 ? 'Breakthrough' : 'Contested';
    out.push({ id, name: `${w.areas[area]?.name || 'Unknown'} Front`, edges: gr.edges, provs, sides: [...gr.sides], power: [...power.entries()], battles, changed, status });
  }
  s.fronts = out;
  detectEncirclement(g);
}

// Formations cut off from every supply source of their side are encircled.
export function detectEncirclement(g) {
  const s = g.s;
  const w = g.w;
  const P = g.P;
  const involved = new Set();
  for (const war of s.wars) for (const c of [...war.attackers, ...war.defenders]) involved.add(c);
  g.reach = new Map();
  for (const f of s.formations.values()) f.encircled = false;
  for (const c of involved) {
    const reach = new Uint8Array(P);
    const q = [];
    const srcs = supplySources(g, c);
    for (const [p] of srcs) {
      if (!reach[p]) {
        reach[p] = 1;
        q.push(p);
      }
    }
    for (let h = 0; h < q.length; h++) {
      const a = q[h];
      for (let k = w.adjStart[a]; k < w.adjStart[a + 1]; k++) {
        const b = w.adjTo[k];
        if (b >= P || reach[b]) continue;
        const o = s.prov.ctrl[b];
        if (o === c || g.allied(c, o) || s.access[o * g.C + c]) {
          reach[b] = 1;
          q.push(b);
        }
      }
    }
    g.reach.set(c, reach);
    for (const f of s.formations.values()) {
      if (f.owner === c && f.prov < P && !reach[f.prov]) f.encircled = true;
    }
  }
  const pockets = new Map();
  for (const f of s.formations.values()) {
    if (!f.encircled) continue;
    const key = f.owner;
    if (!pockets.has(key)) pockets.set(key, new Set());
    pockets.get(key).add(f.prov);
  }
  s.pockets = [...pockets.entries()].map(([c, set]) => ({ country: c, provs: [...set] }));
}

// [province, strength] supply sources of country c
export function supplySources(g, c) {
  const s = g.s;
  const out = [];
  const country = s.countries[c];
  if (country.capital >= 0 && s.prov.ctrl[country.capital] === c) out.push([country.capital, 1]);
  for (const p of g.w.provincesOf[c]) {
    if (s.prov.ctrl[p] !== c) continue;
    if (s.prov.hub[p]) out.push([p, 0.75 + 0.1 * s.prov.hub[p]]);
    else if (g.w.provinces.urban[p] || s.prov.civ[p] >= 3) out.push([p, 0.55 + 0.05 * g.w.provinces.urban[p]]);
    else if (s.prov.port[p] && g.w.provinces.coastal[p] && !(g.blockaded && g.blockaded(p, c))) out.push([p, 0.45 + 0.1 * s.prov.port[p]]);
    else if (s.prov.armyBase[p]) out.push([p, 0.5]);
  }
  // hubs and depots built in occupied/foreign territory
  for (let p = 0; p < g.P; p++) {
    if (s.prov.ctrl[p] !== c || s.prov.owner[p] === c) continue;
    if (s.prov.depot[p]) out.push([p, 0.55]);
    if (s.prov.hub[p]) out.push([p, 0.7]);
  }
  // allied capitals feed expeditionary forces a little
  for (let x = 0; x < g.C; x++) {
    if (x !== c && s.alliance[c * g.C + x] && s.countries[x].alive) {
      const cap = s.countries[x].capital;
      if (cap >= 0 && s.prov.ctrl[cap] === x) out.push([cap, 0.55]);
    }
  }
  return out;
}
