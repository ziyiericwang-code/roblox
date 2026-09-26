// Ranks, command authority, operational area, directives and promotions.
import { RANKS, xpToNext, capabilities, rankTitle } from '../../config/ranks.js';
import { ordinal } from './util.js';
import { newFormation } from './formations.js';

const INF = 1e9;
export const can = (p, cap) => p && capabilities(p.rank).has(cap);
export const rankOf = (p) => RANKS[p.rank];

export function award(g, p, xp, why) {
  const pace = g.s.settings.pace || 1;
  const v = Math.max(1, Math.round(xp * pace));
  p.xp += v;
  p.turnXp = p.turnXp || [];
  p.turnXp.push([why, v]);
  if (p.turnXp.length > 30) p.turnXp.shift();
}

function minTimeInGrade(r) {
  return r < 7 ? 1 : r < 19 ? 2 : r < 31 ? 3 : r < 43 ? 4 : 5;
}

export function gateMet(p) {
  const gate = RANKS[p.rank].gate;
  if (!gate) return true;
  const st = p.stats;
  if (gate.alt && st.directives >= gate.alt) return true;
  if (gate.battlesWon) return st.battlesWon >= gate.battlesWon;
  if (gate.supplyTurns) return st.supplyTurns >= gate.supplyTurns;
  if (gate.directives) return st.directives >= gate.directives;
  if (gate.operations) return st.operations >= gate.operations;
  if (gate.opsWon) return st.opsWon >= gate.opsWon;
  if (gate.frontTurns) return st.frontTurns >= gate.frontTurns;
  if (gate.theaterWin) return st.theaterWin >= 1 || st.captured >= 12;
  if (gate.warWon) return st.warWon >= 1 || st.captured >= 30;
  return true;
}

// ------------------------------------------------------------ operational area
export function computeArea(g, p) {
  const w = g.w;
  const P = g.P;
  const s = g.s;
  const area = new Uint8Array(P);
  const r = RANKS[p.rank];
  const forms = p.formations.map((id) => s.formations.get(id)).filter(Boolean);
  if (forms.length) {
    let best = forms[0];
    for (const f of forms) if (g.elements(f) > g.elements(best)) best = f;
    if (best.prov < P) p.hq = best.prov;
  }
  const hq = p.hq;
  const hopsFor = { region: 3, 'region+': 4, regions2: 5, regions3: 7, regions4: 9, front: 12, 'front+': 15, fronts2: 20 };
  let hops = typeof r.area === 'number' ? r.area : hopsFor[r.area];
  if (r.area === 'global' || r.area === 'nation') {
    area.fill(1);
    return area;
  }
  if (r.area === 'theater' || r.area === 'continent') {
    const key = r.area === 'theater' ? w.provinces.theater : w.provinces.continent;
    for (let q = 0; q < P; q++) if (key[q] === key[hq]) area[q] = 1;
    hops = 3;
  }
  // BFS from HQ, from every formation (1 hop) and from command centers (3 hops)
  const bfs = (starts, maxH) => {
    const d = new Map();
    const q = [];
    for (const s0 of starts) {
      if (s0 >= P) continue;
      d.set(s0, 0);
      q.push(s0);
    }
    for (let h = 0; h < q.length; h++) {
      const a = q[h];
      area[a] = 1;
      const da = d.get(a);
      if (da >= maxH) continue;
      for (let k = w.adjStart[a]; k < w.adjStart[a + 1]; k++) {
        const b = w.adjTo[k];
        if (b >= P || d.has(b)) continue;
        d.set(b, da + 1);
        q.push(b);
      }
    }
  };
  bfs([hq], hops);
  bfs(forms.map((f) => f.prov), 1);
  const cc = [];
  for (let q = 0; q < P; q++) if (s.prov.command[q] && s.prov.ctrl[q] === p.country) cc.push(q);
  if (cc.length) bfs(cc, 3);
  return area;
}

export function refreshCareer(g, p) {
  p.formations = p.formations.filter((id) => g.s.formations.has(id));
  p.area = computeArea(g, p);
}

export function commandUsage(g, p) {
  let elements = 0;
  for (const id of p.formations) {
    const f = g.s.formations.get(id);
    if (f) elements += g.elements(f);
  }
  return { elements, formations: p.formations.length };
}

// Hand the player more forces as their authority grows.
export function fillCommand(g, p) {
  const s = g.s;
  const r = RANKS[p.rank];
  const country = s.countries[p.country];
  if (!country.alive) return;
  if (p.rank >= 49) {
    for (const f of s.formations.values()) {
      if (f.owner === p.country && !f.ctrl) {
        f.ctrl = p.id;
        p.formations.push(f.id);
      }
    }
    return;
  }
  let use = commandUsage(g, p);
  if (!p.formations.length) {
    const home = country.capital;
    const f = newFormation(g, { owner: p.country, prov: home, comp: { inf: Math.min(r.elements, 2 + Math.floor(p.rank / 3)) }, name: `${ordinal(s.nextId.f % 90 + 1)} Rifle Detachment`, exp: 0.3 });
    f.ctrl = p.id;
    p.formations.push(f.id);
    g.notify(p.id, { kind: 'career', title: 'New command', text: `You take command of ${f.name} in ${g.w.provinces.name[home]}.`, prov: home });
    use = commandUsage(g, p);
  }
  p.area = computeArea(g, p);
  // take over AI formations that fit the remaining capacity
  const cands = [];
  for (const f of s.formations.values()) {
    if (f.owner !== p.country || f.ctrl || f.battle) continue;
    if (!p.area[f.prov]) continue;
    const n = g.elements(f);
    cands.push([g.w.kmBetween(f.prov, p.hq) + n * 5, f, n]);
  }
  cands.sort((a, b) => a[0] - b[0]);
  for (const [, f, n] of cands) {
    if (use.formations >= r.formations) break;
    if (use.elements + n > r.elements) continue;
    f.ctrl = p.id;
    p.formations.push(f.id);
    use.elements += n;
    use.formations++;
    g.notify(p.id, { kind: 'career', title: `You now command the ${f.name}`, text: `${n} elements in ${g.w.provinces.name[f.prov]}.`, prov: f.prov, formation: f.id });
  }
  // grow the player's own formations with fresh elements up to capacity
  if (use.elements < r.elements && r.elements < INF) {
    const caps = capabilities(p.rank);
    const types = ['inf'];
    if (caps.has('mech')) types.push('mech', 'mot');
    if (caps.has('art')) types.push('art');
    if (caps.has('armor')) types.push('armor');
    if (caps.has('sf')) types.push('sf');
    const own = p.formations.map((id) => s.formations.get(id)).filter((f) => f && !f.battle);
    if (own.length) {
      own.sort((a, b) => g.elements(a) - g.elements(b));
      const f = own[0];
      let add = Math.min(r.elements - use.elements, Math.max(1, Math.ceil(r.elements * 0.25)));
      const got = {};
      while (add-- > 0 && country.manpower > 200) {
        const t = types[(g.elements(f) + p.rank) % types.length];
        f.comp[t] = (f.comp[t] || 0) + 1;
        got[t] = (got[t] || 0) + 1;
        country.manpower -= 150;
      }
      const txt = Object.entries(got).map(([t, n]) => `${n} × ${t.toUpperCase()}`).join(', ');
      if (txt) g.notify(p.id, { kind: 'career', title: 'Reinforcements assigned', text: `${f.name} receives ${txt}.`, prov: f.prov, formation: f.id });
    }
  }
}

// ------------------------------------------------------------ directives
let directiveSeq = 1;
export function issueDirectives(g, p) {
  const s = g.s;
  p.directives = p.directives.filter((d) => d.status === 'active');
  if (p.directives.length >= 2 || p.rank >= 49) return;
  if (p.nextDirective && s.turn < p.nextDirective) return;
  const w = g.w;
  const P = g.P;
  const forms = p.formations.map((id) => s.formations.get(id)).filter(Boolean);
  if (!forms.length) return;
  const reward = Math.round(22 * (1 + p.rank * 0.09));
  const add = (d) => {
    if (p.directives.some((x) => x.type === d.type && x.target === d.target)) return;
    d.id = `d${s.turn}-${directiveSeq++}`;
    d.status = 'active';
    d.issued = s.turn;
    d.reward = d.reward || reward;
    p.directives.push(d);
    g.notify(p.id, { kind: 'directive', title: `New directive: ${d.title}`, text: d.text, prov: d.target });
  };
  // enemy provinces adjacent to our forces
  const enemyNear = [];
  const ownFront = [];
  for (const f of forms) {
    for (let k = w.adjStart[f.prov]; k < w.adjStart[f.prov + 1]; k++) {
      const q = w.adjTo[k];
      if (q >= P) continue;
      if (g.atWar(p.country, s.prov.ctrl[q])) {
        enemyNear.push(q);
        ownFront.push(f.prov);
      }
    }
  }
  const tut = p.tutorial;
  if (tut === 0) {
    // first command: a short march
    let dest = -1;
    for (let k = w.adjStart[forms[0].prov]; k < w.adjStart[forms[0].prov + 1]; k++) {
      const q = w.adjTo[k];
      if (q < P && s.prov.ctrl[q] === p.country) dest = q;
    }
    if (dest >= 0) {
      add({ type: 'move', target: dest, due: s.turn + 3, title: `March to ${w.provinces.name[dest]}`, text: `Select your detachment and right-click ${w.provinces.name[dest]} to move there.`, reward: 40 });
      p.tutorial = 1;
      return;
    }
    p.tutorial = 1;
  }
  if (p.tutorial === 1 && !p.directives.length) {
    add({ type: 'digin', target: forms[0].prov, due: s.turn + 3, title: 'Dig in', text: 'Order Dig In (D) and hold for a turn. Entrenched troops defend much better.', reward: 40 });
    p.tutorial = 2;
    return;
  }
  const r = g.rng;
  if (enemyNear.length && (p.rank >= 1 || !ownFront.length)) {
    const t = enemyNear[r.int(enemyNear.length)];
    if (r.chance(0.6) && p.rank >= 1) add({ type: 'capture', target: t, due: s.turn + 5, title: `Capture ${w.provinces.name[t]}`, text: `Take ${w.provinces.name[t]} from ${g.countryName(s.prov.ctrl[t])}.`, reward: reward * 1.6 });
    else add({ type: 'win', due: s.turn + 5, title: 'Win a battle', text: 'Defeat the enemy in any battle.', reward: reward * 1.2 });
  } else if (ownFront.length) {
    const t = ownFront[r.int(ownFront.length)];
    add({ type: 'hold', target: t, due: s.turn + 4, start: s.turn, title: `Hold ${w.provinces.name[t]}`, text: `Keep ${w.provinces.name[t]} under control for 4 turns.`, reward });
  } else {
    const opts = [];
    const f = forms[r.int(forms.length)];
    const nbrs = w.neighbors(f.prov).filter((q) => q < P && s.prov.ctrl[q] === p.country && p.area[q]);
    if (nbrs.length) opts.push(() => {
      const q = nbrs[r.int(nbrs.length)];
      add({ type: 'move', target: q, due: s.turn + 4, title: `Redeploy to ${w.provinces.name[q]}`, text: `Move a formation to ${w.provinces.name[q]}.` });
    });
    opts.push(() => add({ type: 'digin', target: f.prov, due: s.turn + 3, title: `Fortify ${w.provinces.name[f.prov]}`, text: 'Have a formation dug in (Dig In order).' }));
    if (p.rank >= 3) {
      const foreign = w.neighbors(f.prov).filter((q) => q < P && s.prov.ctrl[q] !== p.country);
      if (foreign.length) opts.push(() => {
        const q = foreign[r.int(foreign.length)];
        add({ type: 'recon', target: q, due: s.turn + 4, title: `Reconnoitre ${w.provinces.name[q]}`, text: `Order a recon probe into ${w.provinces.name[q]}.` });
      });
    }
    opts.push(() => add({ type: 'supply', due: s.turn + 4, start: s.turn, title: 'Keep supplied', text: 'Keep all your formations above 80% supply for 3 turns.', count: 0 }));
    r.pick(opts)();
  }
  p.nextDirective = s.turn + 1;
}

export function checkDirectives(g, p) {
  const s = g.s;
  for (const d of p.directives) {
    if (d.status !== 'active') continue;
    const forms = p.formations.map((id) => s.formations.get(id)).filter(Boolean);
    let done = false;
    switch (d.type) {
      case 'move':
        done = forms.some((f) => f.prov === d.target);
        break;
      case 'digin':
        done = forms.some((f) => f.entrench >= 0.3 && (d.target === undefined || f.prov === d.target || d.title.startsWith('Fortify')));
        break;
      case 'capture':
        done = s.prov.ctrl[d.target] === p.country || g.allied(p.country, s.prov.ctrl[d.target]);
        break;
      case 'hold':
        if (s.prov.ctrl[d.target] !== p.country) d.status = 'failed';
        else if (s.turn - d.start >= 4) done = true;
        break;
      case 'win':
        done = (p.stats.battlesWon || 0) > (d.base ?? (d.base = p.stats.battlesWon));
        break;
      case 'recon':
        done = (p.recon || []).includes(d.target);
        break;
      case 'supply':
        if (forms.every((f) => f.supply >= 0.8)) d.count = (d.count || 0) + 1;
        done = d.count >= 3;
        break;
      default:
        break;
    }
    if (done) {
      d.status = 'done';
      p.stats.directives++;
      award(g, p, d.reward, `Directive complete: ${d.title}`);
      p.cp = Math.min(p.cp + 2, RANKS[p.rank].cp * 3 + 4);
      p.rating = Math.min(1, p.rating * 0.85 + 0.15);
      g.notify(p.id, { kind: 'directive-done', title: `Directive complete: ${d.title}`, text: `+${d.reward} merit`, prov: d.target });
    } else if (d.status === 'active' && s.turn > d.due) {
      d.status = 'failed';
      p.rating = Math.max(0, p.rating * 0.9);
      g.notify(p.id, { kind: 'directive-failed', title: `Directive expired: ${d.title}`, text: 'Command noted the failure.' });
    }
  }
}

// ------------------------------------------------------------ turn processing
export function careerTurn(g, p) {
  const s = g.s;
  const r = RANKS[p.rank];
  p.turnXp = [];
  p.timeInGrade++;
  p.cp = Math.min(p.cp + r.cp, r.cp * 3 + 4);
  p.influence = Math.min(100, p.influence + 0.5 + p.rank * 0.02);
  award(g, p, 3 + Math.floor(p.rank / 8), 'Service');
  const forms = p.formations.map((id) => s.formations.get(id)).filter(Boolean);
  if (forms.length && forms.every((f) => f.supply >= 0.8)) p.stats.supplyTurns++;
  const atWar = s.wars.some((w) => w.attackers.includes(p.country) || w.defenders.includes(p.country));
  if (atWar && forms.some((f) => g.w.neighbors(f.prov).some((q) => q < g.P && g.atWar(p.country, s.prov.ctrl[q])))) p.stats.frontTurns++;
  checkDirectives(g, p);
  // promotions
  let promoted = false;
  while (p.rank < RANKS.length - 1 && p.xp >= xpToNext(p.rank) && p.timeInGrade >= minTimeInGrade(p.rank) && gateMet(p)) {
    p.xp -= xpToNext(p.rank);
    p.rank++;
    p.timeInGrade = 0;
    p.stats.promotions++;
    promoted = true;
    const nr = RANKS[p.rank];
    p.promotions = p.promotions || [];
    p.promotions.push({ turn: s.turn, rank: p.rank });
    g.notify(p.id, { kind: 'promotion', title: `Promoted to ${rankTitle(p.rank)}`, text: nr.text, rank: p.rank, important: true });
    if (p.rank >= 49) {
      p.ai.economy = false;
      p.ai.diplomacy = false;
    }
  }
  if (promoted || s.turn % 3 === 0) fillCommand(g, p);
  issueDirectives(g, p);
  p.area = computeArea(g, p);
}

export { rankTitle };
