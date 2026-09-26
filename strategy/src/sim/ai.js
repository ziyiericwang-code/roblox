// Nation AI: strategic posture, war and peace decisions, alliances, military operations,
// economy and recruitment. Every AI nation uses the same commands and rules as players.
import { PERSONALITIES } from '../../config/scenario.js';
import { TERRAIN_RULES } from '../../config/terrain.js';
import { clamp, ordinal } from './util.js';
import { declareWar, makePeace, warsOf, sideOf, evaluate, formAlliance, provinceValue, opinion } from './diplomacy.js';
import { findPath, findSeaPath } from './movement.js';
import { queueBuilding } from './economy.js';
import { newFormation } from './formations.js';

const persona = (nat) => PERSONALITIES[nat.personality] || PERSONALITIES.opportunist;

export function aiTurn(g) {
  const s = g.s;
  const C = g.C;
  // per-turn caches
  g.powerOf = new Float64Array(C);
  g.formsOf = Array.from({ length: C }, () => []);
  for (const f of s.formations.values()) {
    g.powerOf[f.owner] += g.power(f);
    g.formsOf[f.owner].push(f);
  }
  for (let c = 0; c < C; c++) {
    const nat = s.countries[c];
    if (!nat.alive) continue;
    const humanRuns = g.humanRuns(c);
    const atWar = warsOf(g, c).length > 0;
    const humanDip = Object.values(s.players).some((p) => p.country === c && !p.ai.diplomacy);
    const humanEco = Object.values(s.players).some((p) => p.country === c && !p.ai.economy);
    if (!humanDip && ((s.turn + c) % 4 === 0 || (atWar && (s.turn + c) % 2 === 0))) strategic(g, c);
    if (!humanEco && (s.turn + c) % 3 === 0) economyAI(g, c);
    if (!humanRuns || g.formsOf[c].some((f) => f.auto)) {
      if (atWar || (s.turn + c) % 6 === 0 || nat.ai.prep > 0) militaryAI(g, c, atWar);
    }
  }
}

// ------------------------------------------------------------ helpers
function neighborsOf(g, c) {
  const s = g.s;
  const w = g.w;
  const out = new Set();
  for (let p = 0; p < g.P; p++) {
    if (s.prov.ctrl[p] !== c) continue;
    for (let k = w.adjStart[p]; k < w.adjStart[p + 1]; k++) {
      const q = w.adjTo[k];
      if (q < g.P && s.prov.ctrl[q] !== c) out.add(s.prov.ctrl[q]);
    }
  }
  return out;
}

function sidePower(g, c, enemy) {
  // our power plus allies likely to help, versus the enemy and its allies
  const s = g.s;
  let mine = g.powerOf[c];
  let theirs = g.powerOf[enemy];
  for (let x = 0; x < g.C; x++) {
    if (!s.countries[x].alive || x === c || x === enemy) continue;
    const loyal = persona(s.countries[x]).loyalty;
    if (s.alliance[c * g.C + x]) mine += g.powerOf[x] * 0.35 * loyal;
    if (s.alliance[enemy * g.C + x]) theirs += g.powerOf[x] * 0.5 * loyal;
  }
  return mine / Math.max(1, theirs);
}

// ------------------------------------------------------------ strategic layer
function strategic(g, c) {
  const s = g.s;
  const nat = s.countries[c];
  const pers = persona(nat);
  const wars = warsOf(g, c);
  const C = g.C;
  // mobilization
  let threat = 0;
  for (const n of neighborsOf(g, c)) if (opinion(g, c, n) < -30) threat = Math.max(threat, g.powerOf[n] / Math.max(1, g.powerOf[c]));
  if (wars.length) nat.mob = Math.max(nat.mob, wars.some((w) => (sideOf(w, c) === 'A' ? w.score : -w.score) < -25) ? 3 : 2);
  else if (threat > 1.3 || s.tension > 75) nat.mob = Math.max(nat.mob, 1);
  else if (s.turn - nat.ai.lastWar > 30 && nat.mob > 0 && g.rng.chance(0.1)) nat.mob--;
  if (wars.length) nat.milShare = Math.min(0.14, nat.milShare * 1.03);

  // peace
  for (const war of wars) {
    const side = sideOf(war, c);
    const lead = side === 'A' ? war.attackers[0] : war.defenders[0];
    if (lead !== c) continue;
    const enemy = side === 'A' ? war.defenders[0] : war.attackers[0];
    const myScore = side === 'A' ? war.score : -war.score;
    const exh = side === 'A' ? war.exhaustA : war.exhaustD;
    const dur = s.turn - war.start;
    const stalemate = dur > 26 && Math.abs(war.score) < 12 && s.turn - (war.lastCapture || war.start) > 8;
    const losing = myScore < -35 || exh > 70;
    const winning = myScore > 45 && dur > 6;
    if (!(stalemate || losing || winning)) continue;
    const transfers = peaceTerms(g, war, myScore >= 0 ? side : side === 'A' ? 'D' : 'A');
    const terms = { war: war.id, transfers };
    if (g.humanRuns(enemy)) {
      propose(g, c, enemy, 'peace', terms);
      continue;
    }
    const ev = evaluate(g, c, enemy, 'peace', terms);
    if (ev.score > 0 || losing) makePeace(g, war, { transfers, by: c });
  }

  // war declaration
  if (nat.ai.prep > 0) {
    nat.ai.prep--;
    if (nat.ai.prep === 0 && nat.ai.target >= 0 && s.countries[nat.ai.target].alive && !g.allied(c, nat.ai.target)) {
      declareWar(g, c, nat.ai.target, { reason: s.claims[c * C + nat.ai.target] ? 'Territorial claim' : 'Aggression' });
      nat.ai.target = -1;
    }
    return;
  }
  if (wars.length > (pers.aggression > 0.6 ? 1 : 0) || s.turn - nat.ai.lastWar < 16 || nat.stability < 35) return;
  let best = -1;
  let bestScore = 0;
  for (const d of neighborsOf(g, c)) {
    if (d >= C || !s.countries[d].alive || g.allied(c, d) || s.nap[c * C + d]) continue;
    const op = opinion(g, c, d);
    const claim = s.claims[c * C + d] === 1;
    if (op > -10 && !claim) continue;
    const ratio = sidePower(g, c, d);
    if (ratio < pers.attackRatio * 0.8) continue;
    const busy = warsOf(g, d).length ? 10 : 0;
    const humanTarget = g.playersOf(d).length ? 5 : 0;
    const desire = 40 + 15 * Math.min(2, ratio - pers.attackRatio) + (claim ? 25 : 0) - op * 0.3 + busy + s.tension * 0.25 + humanTarget;
    const score = pers.aggression * s.aggression * desire - pers.caution * 20;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  if (best >= 0 && bestScore > 42 + g.rng.int(28)) {
    nat.ai.target = best;
    nat.ai.prep = 2;
    nat.mob = Math.max(nat.mob, 1);
    // intelligence services of the target (and its allies) may notice the buildup
    g.notify(best, { kind: 'intel', title: `Military buildup detected: ${g.countryName(c)}`, text: `${g.countryName(c)} is massing forces on our border.`, important: true });
  }

  // alliances with those who share our rivals
  if ((s.turn + c) % 8 === 0 && pers.alliance > 0.3) {
    for (let x = 0; x < C; x++) {
      if (x === c || !s.countries[x].alive || g.allied(c, x) || g.atWar(c, x)) continue;
      if (opinion(g, c, x) < 20) continue;
      let shared = 0;
      for (let e = 0; e < C; e++) if (opinion(g, c, e) < -40 && opinion(g, x, e) < -40) shared++;
      if (!shared) continue;
      if (g.humanRuns(x)) {
        if (g.rng.chance(0.2)) propose(g, c, x, 'alliance', {});
        continue;
      }
      if (evaluate(g, c, x, 'alliance').score > 5 && evaluate(g, x, c, 'alliance').score > 5) formAlliance(g, c, x);
      break;
    }
  }
}

// Provinces the winner keeps: occupied land, most valuable first, capped.
export function peaceTerms(g, war, winnerSide) {
  const s = g.s;
  const winners = winnerSide === 'A' ? war.attackers : war.defenders;
  const losers = winnerSide === 'A' ? war.defenders : war.attackers;
  const score = Math.abs(war.score);
  if (score < 15) return [];
  const cand = [];
  for (let p = 0; p < g.P; p++) {
    const o = s.prov.owner[p];
    const c = s.prov.ctrl[p];
    if (losers.includes(o) && winners.includes(c)) cand.push([provinceValue(g, p), p, c]);
  }
  cand.sort((a, b) => b[0] - a[0]);
  const cap = Math.max(1, Math.round(score / 7));
  return cand.slice(0, cap).map(([, p, c]) => [p, c]);
}

export function propose(g, from, to, type, terms) {
  const s = g.s;
  s.proposals = s.proposals || [];
  if (s.proposals.some((p) => p.from === from && p.to === to && p.type === type)) return;
  s.proposals.push({ id: `pr${s.turn}-${from}-${to}-${type}`, from, to, type, terms, turn: s.turn });
  g.notify(to, { kind: 'proposal', title: `${g.countryName(from)} proposes: ${type === 'peace' ? 'peace' : type}`, text: 'Open Diplomacy to respond.', important: true });
}

// ------------------------------------------------------------ military layer
function militaryAI(g, c, atWar) {
  const s = g.s;
  const w = g.w;
  const P = g.P;
  const nat = s.countries[c];
  const pers = persona(nat);
  const forms = g.formsOf[c].filter((f) => (!f.ctrl || f.auto) && !f.battle && f.prov < P);
  if (!forms.length) return;
  if (!atWar && nat.ai.prep <= 0) {
    peacetimeDeploy(g, c, forms);
    return;
  }
  // 1. front provinces and threat
  const front = new Map(); // prov -> threat
  const targets = new Map(); // enemy prov -> {value, defense}
  for (let p = 0; p < P; p++) {
    const ctrl = s.prov.ctrl[p];
    if (ctrl !== c) continue;
    let threat = 0;
    let isFront = false;
    for (let k = w.adjStart[p]; k < w.adjStart[p + 1]; k++) {
      const q = w.adjTo[k];
      if (q >= P) continue;
      const qc = s.prov.ctrl[q];
      const hostile = g.atWar(c, qc) || (nat.ai.prep > 0 && qc === nat.ai.target);
      if (!hostile) continue;
      isFront = true;
      let dp = 0;
      for (const id of g.byProv[q]) {
        const f = s.formations.get(id);
        if (f && g.atWar(c, f.owner)) dp += g.power(f);
      }
      threat += dp + 1;
      if (!targets.has(q)) {
        const t = TERRAIN_RULES[w.provinces.terrain[q]];
        targets.set(q, { value: provinceValue(g, q), defense: dp * t.defense * (1 + 0.1 * s.prov.fort[q]) * (w.provinces.urban[q] ? 1.2 : 1) });
      }
    }
    if (isFront) front.set(p, threat);
  }
  if (!front.size) {
    // no land front: amphibious or wait
    if (atWar) seaInvasion(g, c, forms);
    return;
  }
  // 2. distance from each own province to the front (BFS)
  const dist = new Int32Array(P).fill(-1);
  const q = [];
  for (const p of front.keys()) {
    dist[p] = 0;
    q.push(p);
  }
  for (let h = 0; h < q.length; h++) {
    const a = q[h];
    for (let k = w.adjStart[a]; k < w.adjStart[a + 1]; k++) {
      const b = w.adjTo[k];
      if (b >= P || dist[b] >= 0) continue;
      const o = s.prov.ctrl[b];
      if (o !== c && !g.allied(c, o)) continue;
      dist[b] = dist[a] + 1;
      q.push(b);
    }
  }
  // 3. power already at each front province
  const have = new Map();
  for (const f of g.formsOf[c]) if (front.has(f.prov)) have.set(f.prov, (have.get(f.prov) || 0) + g.power(f));
  const capital = nat.capital;
  let capitalGuard = forms.find((f) => f.prov === capital);
  // 4. attacks from the front
  const committed = new Set();
  if (nat.ai.prep <= 0) {
    const byTarget = [];
    for (const [tq, t] of targets) {
      const adj = forms.filter((f) => !committed.has(f.id) && f.org > 0.5 && f.supply > 0.3 && w.edgeIndex(f.prov, tq) >= 0 && front.has(f.prov));
      if (!adj.length) continue;
      const pow = adj.reduce((x, f) => x + g.power(f), 0);
      const ratio = pow / Math.max(0.5, t.defense);
      const need = t.defense < 1 ? 0.5 : pers.attackRatio * (0.72 + g.rng.next() * 0.2);
      if (ratio >= need) byTarget.push([t.value * Math.min(3, ratio), tq, adj, ratio]);
    }
    byTarget.sort((a, b) => b[0] - a[0]);
    for (const [, tq, adj] of byTarget) {
      const avail = adj.filter((f) => !committed.has(f.id));
      if (!avail.length) continue;
      // keep at least one formation home in threatened provinces
      for (const f of avail) {
        const others = g.byProv[f.prov].filter((id) => id !== f.id && !committed.has(id) && s.formations.get(id)?.owner === c).length;
        if (others === 0 && front.get(f.prov) > 3 && avail.length > 1 && f !== avail[0]) continue;
        committed.add(f.id);
        if (f.order && f.order.target === tq) continue;
        f.order = { type: 'attack', path: [f.prov, tq], idx: 1, target: tq, by: 'ai' };
        f.progress = 0;
        f.posture = 'attack';
      }
    }
  }
  // 4b. concentrated offensives: stage a strike group next to a target, then attack together
  if (nat.ai.prep <= 0 && targets.size) planOffensives(g, c, forms, front, targets, committed, pers);
  // 5. everyone else: rest, reinforce the front, or guard the capital
  const deficits = [...front.entries()].map(([p, thr]) => [p, thr * (1 + pers.caution) - (have.get(p) || 0)]).sort((a, b) => b[1] - a[1]);
  let di = 0;
  for (const f of forms) {
    if (committed.has(f.id) || f.order) continue;
    if (f.org < 0.3) {
      f.posture = 'hold';
      continue;
    }
    if (capital >= 0 && !capitalGuard && s.prov.ctrl[capital] === c && f.prov !== capital && forms.length > 3) {
      capitalGuard = f;
      orderMove(g, f, capital);
      continue;
    }
    if (front.has(f.prov)) {
      f.posture = 'digin';
      continue;
    }
    if (dist[f.prov] < 0) continue;
    const target = deficits.length ? deficits[di++ % Math.max(1, Math.min(deficits.length, 6))][0] : -1;
    if (target >= 0) orderMove(g, f, target);
  }
}

function planOffensives(g, c, forms, front, targets, committed, pers) {
  const s = g.s;
  const w = g.w;
  const nat = s.countries[c];
  const maxPlans = 1 + Math.floor(forms.length / 12);
  nat.ai.plans = (nat.ai.plans || []).filter((pl) => targets.has(pl.target) && s.turn - pl.since < 10 && front.has(pl.stage));
  const inPlan = new Set(nat.ai.plans.flatMap((pl) => pl.forms));
  // new plans
  while (nat.ai.plans.length < maxPlans) {
    let best = null;
    for (const [tq, t] of targets) {
      if (nat.ai.plans.some((pl) => pl.target === tq)) continue;
      const stages = w.neighbors(tq).filter((q) => front.has(q));
      if (!stages.length) continue;
      const score = (t.value * (1 + g.rng.next() * 0.3)) / (1 + t.defense * 0.15);
      if (!best || score > best.score) best = { tq, t, score, stage: stages[g.rng.int(stages.length)] };
    }
    if (!best) break;
    const needPow = Math.max(2, best.t.defense * pers.attackRatio * 1.15);
    const pool = forms.filter((f) => !committed.has(f.id) && !inPlan.has(f.id) && f.org > 0.55 && f.prov !== nat.capital).map((f) => [w.kmBetween(f.prov, best.stage), f]).sort((a, b) => a[0] - b[0]);
    const group = [];
    let pow = 0;
    for (const [d, f] of pool) {
      if (pow >= needPow || group.length >= Math.max(3, Math.ceil(forms.length * 0.4))) break;
      if (d > 2500) break;
      group.push(f.id);
      inPlan.add(f.id);
      pow += g.power(f);
    }
    if (!group.length || pow < needPow * 0.6) break;
    nat.ai.plans.push({ target: best.tq, stage: best.stage, forms: group, since: s.turn, need: needPow });
  }
  // execute plans
  for (const pl of nat.ai.plans) {
    const group = pl.forms.map((id) => s.formations.get(id)).filter((f) => f && !f.battle);
    pl.forms = group.map((f) => f.id);
    const adjacent = group.filter((f) => w.edgeIndex(f.prov, pl.target) >= 0);
    const staged = adjacent.reduce((x, f) => x + g.power(f), 0);
    const t = targets.get(pl.target);
    const waited = s.turn - pl.since;
    if (adjacent.length && (staged >= t.defense * pers.attackRatio * 0.85 || (waited >= 3 && staged >= t.defense * 0.95) || t.defense < 0.5)) {
      for (const f of adjacent) {
        if (committed.has(f.id) || f.org < 0.45) continue;
        committed.add(f.id);
        if (f.order && f.order.target === pl.target) continue;
        f.order = { type: 'attack', path: [f.prov, pl.target], idx: 1, target: pl.target, by: 'ai' };
        f.progress = 0;
      }
      pl.since = s.turn - 5; // keep pushing next turn if it fails
    }
    for (const f of group) {
      if (committed.has(f.id) || f.order || w.edgeIndex(f.prov, pl.target) >= 0) continue;
      orderMove(g, f, pl.stage);
      committed.add(f.id);
    }
  }
}

function orderMove(g, f, to) {
  if (f.prov === to) return;
  if (f.order && f.order.target === to) return;
  const path = findPath(g, f.owner, f.prov, to, { maxNodes: 1500 });
  if (!path || path.length < 2) return;
  // long moves through friendly territory go by rail (national logistics)
  const friendly = path.every((q) => q < g.P && (g.s.prov.ctrl[q] === f.owner || g.allied(f.owner, g.s.prov.ctrl[q])) && !g.hostileIn(q, f.owner).length);
  const type = friendly && path.length > 3 ? 'rail' : 'move';
  f.order = { type, path, idx: 1, target: to, by: 'ai', then: 'digin' };
  f.progress = 0;
  f.posture = 'move';
}

function peacetimeDeploy(g, c, forms) {
  const s = g.s;
  const w = g.w;
  const P = g.P;
  // borders with rivals attract garrisons; everyone else digs in
  const hot = [];
  for (const p of w.provincesOf[c]) {
    if (s.prov.ctrl[p] !== c) continue;
    let v = 0;
    for (let k = w.adjStart[p]; k < w.adjStart[p + 1]; k++) {
      const q = w.adjTo[k];
      if (q >= P) continue;
      const o = s.prov.ctrl[q];
      if (o !== c && opinion(g, c, o) < -30) v += -opinion(g, c, o) / 30;
    }
    if (v > 0) hot.push([v, p]);
  }
  hot.sort((a, b) => b[0] - a[0]);
  const stationed = new Map();
  for (const f of forms) stationed.set(f.prov, (stationed.get(f.prov) || 0) + 1);
  let moved = 0;
  for (const [, p] of hot.slice(0, 8)) {
    if (stationed.get(p)) continue;
    const f = forms.find((x) => !x.order && (stationed.get(x.prov) || 0) > 1);
    if (!f) break;
    stationed.set(f.prov, stationed.get(f.prov) - 1);
    stationed.set(p, 1);
    orderMove(g, f, p);
    if (++moved >= 3) break;
  }
  for (const f of forms) if (!f.order) f.posture = 'digin';
}

// Amphibious invasion against an enemy with no shared land front.
function seaInvasion(g, c, forms) {
  const s = g.s;
  const nat = s.countries[c];
  if (s.turn - (nat.ai.lastLanding || -99) < 5) return;
  const navy = nat.navy.carrier * 8 + nat.navy.destroyer * 2 + nat.navy.frigate;
  if (navy < 6) return;
  const enemies = warsOf(g, c).flatMap((w) => (sideOf(w, c) === 'A' ? w.defenders : w.attackers));
  let best = null;
  for (const e of enemies) {
    const en = s.countries[e];
    const enavy = en.navy.carrier * 8 + en.navy.destroyer * 2 + en.navy.frigate + en.navy.submarine;
    if (navy < enavy * 1.4) continue;
    for (const p of g.w.provincesOf[e]) {
      if (s.prov.ctrl[p] !== e || !g.w.provinces.coastal[p]) continue;
      const def = g.hostileIn(p, c).reduce((x, f) => x + g.power(f), 0);
      const v = provinceValue(g, p) / (1 + def);
      if (!best || v > best.v) best = { p, v, def };
    }
  }
  if (!best) {
    expedition(g, c, forms, enemies);
    return;
  }
  const ports = forms.filter((f) => g.w.provinces.coastal[f.prov] && s.prov.port[f.prov] && f.org > 0.7);
  const force = ports.sort((a, b) => g.power(b) - g.power(a)).slice(0, 3);
  if (!force.length || force.reduce((x, f) => x + g.power(f), 0) < best.def * 2) return;
  for (const f of force) {
    const path = findSeaPath(g, c, f.prov, best.p);
    if (!path) continue;
    f.order = { type: 'sea', path, idx: 1, target: best.p, by: 'ai' };
    f.progress = 0;
  }
  nat.ai.lastLanding = s.turn;
}

// Ship forces to an ally's port near the fighting (e.g. transatlantic reinforcement).
function expedition(g, c, forms, enemies) {
  const s = g.s;
  const w = g.w;
  const nat = s.countries[c];
  if (s.turn - (nat.ai.lastExpedition || -99) < 6) return;
  // allied coastal provinces with a naval base that border an enemy
  let best = -1;
  let bv = 0;
  for (let p = 0; p < g.P; p++) {
    const o = s.prov.ctrl[p];
    if (o === c || !g.allied(c, o) || !s.prov.port[p] || !w.provinces.coastal[p]) continue;
    let v = 0;
    for (const q of w.neighbors(p)) if (q < g.P && enemies.includes(s.prov.ctrl[q])) v += 1;
    if (!v) {
      // near-front ports count too
      for (const q of w.neighbors(p)) if (q < g.P) for (const r of w.neighbors(q)) if (r < g.P && enemies.includes(s.prov.ctrl[r])) v += 0.3;
    }
    if (v > bv) {
      bv = v;
      best = p;
    }
  }
  if (best < 0) return;
  const ready = forms.filter((f) => w.provinces.coastal[f.prov] && s.prov.port[f.prov] && s.prov.ctrl[f.prov] === c && f.org > 0.7 && !f.order);
  const send = ready.sort((a, b) => g.power(b) - g.power(a)).slice(0, Math.max(1, Math.floor(ready.length * 0.3)));
  let sent = 0;
  for (const f of send) {
    const path = findSeaPath(g, c, f.prov, best);
    if (!path) continue;
    f.order = { type: 'sea', path, idx: 1, target: best, by: 'ai' };
    f.progress = 0;
    sent++;
  }
  if (sent) {
    nat.ai.lastExpedition = s.turn;
    g.notify(s.prov.ctrl[best], { kind: 'diplomacy', title: `${g.countryName(c)} sends an expeditionary force`, text: `${sent} formation(s) are sailing to ${w.provinces.name[best]}.` });
  }
}

// ------------------------------------------------------------ economy layer
function economyAI(g, c) {
  const s = g.s;
  const nat = s.countries[c];
  const atWar = warsOf(g, c).length > 0;
  // construction
  if (nat.treasury > 3 && nat.queue.length < 3) {
    if (atWar) {
      // fortify the most threatened own front province
      let best = -1;
      let bv = 0;
      for (const p of g.w.provincesOf[c]) {
        if (s.prov.ctrl[p] !== c || s.prov.fort[p] >= 3) continue;
        let v = 0;
        for (const q of g.w.neighbors(p)) if (q < g.P && g.atWar(c, s.prov.ctrl[q])) v += 1;
        if (v > bv) {
          bv = v;
          best = p;
        }
      }
      if (best >= 0) queueBuilding(g, c, best, 'fort');
    } else if (g.rng.chance(0.3)) {
      const provs = g.w.provincesOf[c].filter((p) => s.prov.ctrl[p] === c);
      const p = provs[g.rng.int(provs.length)];
      if (p !== undefined) queueBuilding(g, c, p, g.rng.chance(0.5) ? 'infra' : 'civ');
    }
  }
  // recruitment of a new brigade
  const cooldown = atWar ? 3 : 10;
  if (s.turn - (nat.ai.lastRecruit || -99) >= cooldown && nat.manpower > 8000 && nat.stock.small >= 10) {
    const size = Math.min(24, Math.floor(nat.stock.small), Math.floor(nat.manpower / 400));
    if (size >= 6) {
      const comp = { inf: size };
      const mech = Math.min(Math.floor(nat.stock.vehicles), Math.floor(size / 3));
      if (mech > 0) {
        comp.mech = mech;
        comp.inf -= mech;
      }
      const armor = Math.min(Math.floor(nat.stock.tanks), Math.floor(size / 6));
      if (armor > 0) comp.armor = armor;
      let site = nat.capital;
      for (const p of g.w.provincesOf[c]) if (s.prov.armyBase[p] && s.prov.ctrl[p] === c) site = p;
      if (site >= 0 && s.prov.ctrl[site] === c) {
        nat.stock.small -= comp.inf;
        nat.stock.vehicles -= comp.mech || 0;
        nat.stock.tanks -= comp.armor || 0;
        nat.manpower -= size * 150;
        nat.ai.recruited = (nat.ai.recruited || 0) + 1;
        const f = newFormation(g, { owner: c, prov: site, comp, name: `${ordinal(40 + nat.ai.recruited)} Reserve Brigade`, exp: 0.1, str: 0.8, org: 0.6 });
        nat.ai.lastRecruit = s.turn;
        void f;
      }
    }
  }
  nat.milShare = clamp(nat.milShare, 0.008, 0.15);
}
