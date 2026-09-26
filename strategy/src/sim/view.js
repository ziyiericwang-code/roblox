// Per-player view of the world: everything the client may see, filtered by intelligence,
// clearance, alliances and permission grants. Nothing hidden ever leaves the server.
import { RANKS, xpToNext, capabilities, rankTitle } from '../../config/ranks.js';
import { MOBILIZATION } from '../../config/economy.js';
import { PERSONALITIES } from '../../config/scenario.js';
import { commandUsage, gateMet } from './career.js';
import { intelLevel, supplyAt } from './logistics.js';
import { controls } from './commands.js';
import { empireOf, PROJECTS, TITLES } from './empire.js';
import { evaluate } from './diplomacy.js';

export function buildView(g, playerId, { since = -1 } = {}) {
  const s = g.s;
  const w = g.w;
  const P = g.P;
  const p = s.players[playerId];
  if (!p) return null;
  const c = p.country;
  const caps = capabilities(p.rank);
  const reveal = !!p.reveal;
  const cl = RANKS[p.rank].cl;
  const intel = new Uint8Array(P);
  for (let q = 0; q < P; q++) {
    let lv = reveal ? 4 : intelLevel(g, c, q);
    // low clearance: detail only near your own command
    if (!reveal && cl < 4 && lv > 1 && !p.area[q] && s.prov.ctrl[q] !== c && !g.allied(c, s.prov.ctrl[q])) lv = 1;
    intel[q] = lv;
  }
  const allies = new Set([c]);
  for (let x = 0; x < g.C; x++) if (g.allied(c, x)) allies.add(x);
  const grantsToMe = (s.grants || []).filter((gr) => gr.grantee === p.id && (!gr.expires || gr.expires >= s.turn));
  const viewArmies = new Set(grantsToMe.filter((gr) => gr.perm === 'VIEW_ARMIES').map((gr) => gr.grantor));

  // ------------------------------------------------------------ formations
  const forms = [];
  for (const f of s.formations.values()) {
    if (f.prov >= P) {
      if (f.owner !== c && !allies.has(f.owner)) continue;
    }
    const own = f.owner === c;
    const friendly = own || allies.has(f.owner) || viewArmies.has(f.owner);
    const lv = f.prov < P ? intel[f.prov] : 4;
    if (!friendly && lv < 1) continue;
    const n = g.elements(f);
    const o = { id: f.id, owner: f.owner, prov: f.prov, battle: f.battle || 0 };
    if (friendly || lv >= 3) {
      Object.assign(o, { name: f.name, n, comp: f.comp, str: +f.str.toFixed(2), org: +f.org.toFixed(2), exp: +f.exp.toFixed(2), entrench: +f.entrench.toFixed(2), encircled: !!f.encircled, power: +g.power(f).toFixed(1) });
      if (friendly) {
        Object.assign(o, { supply: +Math.min(1.2, f.supply).toFixed(2), fuel: +Math.min(1.2, f.fuel).toFixed(2), morale: +f.morale.toFixed(2), posture: f.posture, reinf: f.reinf, auto: !!f.auto, op: f.opId || 0, fallback: f.fallback });
        if (f.order) o.order = { type: f.order.type, path: f.order.path, idx: f.order.idx, target: f.order.target, by: f.order.by === p.id ? 'me' : f.order.by === 'ai' || f.order.by === 'op' ? f.order.by : 'other' };
        o.mine = controls(g, p, f);
        o.ctrl = f.ctrl ? (f.ctrl === p.id ? 'me' : s.players[f.ctrl]?.name || 'ally') : 'ai';
      }
    } else if (lv === 2) {
      // identified: type mix and a ±30% strength band
      const jitter = 0.7 + ((f.id * 7919) % 60) / 100;
      Object.assign(o, { est: true, n: Math.max(1, Math.round(n * jitter)), kind: kindOf(f), power: +(g.power(f) * jitter).toFixed(0) });
    } else {
      Object.assign(o, { est: true, size: n > 40 ? 'Large' : n > 12 ? 'Medium' : 'Small' });
    }
    forms.push(o);
  }

  // ------------------------------------------------------------ provinces (dynamic columns)
  const prov = {
    owner: Array.from(s.prov.owner),
    ctrl: Array.from(s.prov.ctrl),
    intel: Array.from(intel),
    fort: Array.from(s.prov.fort, (v, q) => (intel[q] >= 2 ? v : 0)),
    stab: Array.from(s.prov.stab, (v, q) => (s.prov.ctrl[q] === c ? v : 0)),
  };
  const bld = {};
  for (const k of ['infra', 'rail', 'civ', 'mil', 'depot', 'hub', 'armyBase', 'airbase', 'port', 'radar', 'command', 'damage']) {
    bld[k] = Array.from(s.prov[k], (v, q) => (allies.has(s.prov.ctrl[q]) || intel[q] >= 3 ? v : 0));
  }
  prov.bld = bld;
  if (caps.has('supplyMap') || p.rank >= 14) prov.supply = Array.from({ length: P }, (_, q) => Math.round(supplyAt(g, c, q) * 100));

  // ------------------------------------------------------------ countries
  const countries = s.countries.map((n, i) => {
    const base = { alive: n.alive, atWar: !!n.atWar, stability: Math.round(n.stability), tech: n.tech, personality: PERSONALITIES[n.personality]?.name, capital: n.capital, mob: n.mob, power: Math.round(g.powerOf ? g.powerOf[i] : 0), players: Object.values(s.players).filter((q) => q.country === i).map((q) => q.name) };
    if (i === c || grantsToMe.some((gr) => gr.perm === 'VIEW_ECONOMY' && gr.grantor === i)) {
      Object.assign(base, {
        treasury: +n.treasury.toFixed(1), income: +(n.income || 0).toFixed(2), ic: +(n.ic || 0).toFixed(1), manpower: Math.round(n.manpower), stock: Object.fromEntries(Object.entries(n.stock).map(([k, v]) => [k, Math.round(v)])),
        lines: n.lines.map((l) => ({ item: l.item, share: +l.share.toFixed(1), made: +(l.made || 0).toFixed(1) })), queue: n.queue, milShare: +n.milShare.toFixed(3), mobName: MOBILIZATION[n.mob].name, air: n.air, navy: n.navy, warSupport: Math.round(n.warSupport), stats: n.stats, autoProduction: n.autoProduction !== false, gdp: +(n.gdpNow || 0).toFixed(0),
      });
    } else if (allies.has(i)) {
      Object.assign(base, { air: n.air, navy: n.navy });
    }
    return base;
  });

  // ------------------------------------------------------------ diplomacy
  const rel = Array.from({ length: g.C }, (_, x) => s.rel[c * g.C + x]);
  const opinionOfMe = Array.from({ length: g.C }, (_, x) => s.rel[x * g.C + c]);
  const alliances = [];
  for (let a = 0; a < g.C; a++) for (let b = a + 1; b < g.C; b++) if (s.alliance[a * g.C + b]) alliances.push([a, b]);
  const access = [];
  for (let x = 0; x < g.C; x++) {
    if (s.access[x * g.C + c]) access.push(['in', x]);
    if (s.access[c * g.C + x]) access.push(['out', x]);
  }
  const proposals = (s.proposals || []).filter((pr) => pr.to === c || pr.from === c).map((pr) => ({ ...pr, eval: pr.to === c ? evaluate(g, pr.from, pr.to, pr.type, pr.terms) : null }));

  // ------------------------------------------------------------ battles, fronts, reports
  const battles = [...s.battles.values()].filter((b) => intel[b.prov] >= 1 || allies.has(b.atkCountry) || allies.has(b.defCountry)).map((b) => ({ id: b.id, prov: b.prov, name: b.name, atk: b.atkCountry, def: b.defCountry, rounds: b.rounds, ratio: +(b.lastRatio || 1).toFixed(2), from: [...new Set(Object.values(b.from))], mine: b.attackers.concat(b.defenders).some((id) => s.formations.get(id)?.ctrl === p.id) }));
  const fronts = (s.fronts || []).filter((fr) => fr.sides.some((x) => allies.has(x))).map((fr) => ({ id: fr.id, name: fr.name, status: fr.status, sides: fr.sides, provs: fr.provs, battles: fr.battles, changed: fr.changed, power: fr.power.filter(([x]) => allies.has(x) || cl >= 3) }));
  const reports = s.reports.filter((r) => r.turn > since - 1 && (r.kind === 'operation' ? r.players.includes(p.id) || r.country === c : allies.has(r.atk?.country) || allies.has(r.def?.country))).slice(-60);

  // ------------------------------------------------------------ me
  const r = RANKS[p.rank];
  const use = commandUsage(g, p);
  const nextRank = RANKS[p.rank + 1];
  const me = {
    id: p.id,
    name: p.name,
    country: c,
    rank: p.rank,
    rankName: r.name,
    rankTitle: rankTitle(p.rank),
    short: r.short,
    tier: r.tier,
    xp: Math.floor(p.xp),
    xpNext: nextRank ? xpToNext(p.rank) : 0,
    next: nextRank ? { name: rankTitle(p.rank + 1), text: nextRank.text, unlock: nextRank.unlock } : null,
    gate: r.gate ? { text: r.gate.text, met: gateMet(p) } : null,
    timeInGrade: p.timeInGrade,
    cp: Math.floor(p.cp),
    cpMax: r.cp * 3 + 4,
    influence: Math.floor(p.influence),
    clearance: r.cl,
    caps: [...caps],
    orders: { used: [...s.formations.values()].filter((f) => f.order && f.order.by === p.id).length, max: r.orders },
    command: { elements: use.elements, formations: use.formations, maxElements: r.elements >= 1e8 ? null : r.elements, maxFormations: r.formations >= 1e8 ? null : r.formations },
    area: areaIndices(p.area),
    hq: p.hq,
    directives: p.directives.filter((d) => d.status === 'active' || s.turn - d.issued < 2),
    stats: p.stats,
    rating: +p.rating.toFixed(2),
    turnXp: p.turnXp || [],
    promotions: (p.promotions || []).filter((x) => x.turn >= s.turn - 1),
    ai: p.ai,
    standing: p.standing,
    tutorial: p.tutorial,
    dev: !!p.dev,
    reveal,
    inbox: p.inbox.slice(-40),
    grantsToMe: grantsToMe.map((gr) => ({ id: gr.id, from: s.players[gr.grantorPlayer]?.name, grantor: gr.grantor, perm: gr.perm, assets: gr.assets })),
    grantsFromMe: (s.grants || []).filter((gr) => gr.grantorPlayer === p.id).map((gr) => ({ id: gr.id, to: s.players[gr.grantee]?.name, perm: gr.perm, assets: gr.assets })),
  };

  // ------------------------------------------------------------ empires
  const myEmpire = empireOf(g, c) || (s.empires || []).find((e) => e.officers.some((o) => o.player === p.id));
  const empires = (s.empires || []).map((e) => ({ id: e.id, name: e.name, color: e.color, sovereign: e.sovereign, emperor: e.emperor ? s.players[e.emperor]?.name : null, emperorId: e.emperor, members: e.members, officers: e.officers.map((o) => ({ ...o, name: s.players[o.player]?.name })), charter: e.charter, popShare: +(e.popShare || 0).toFixed(3), dominance: e.dominance, treasury: e === myEmpire ? +e.treasury.toFixed(1) : undefined, projects: e === myEmpire ? e.projects : undefined, done: e.done, council: e === myEmpire ? e.council : undefined, mine: e === myEmpire }));

  return {
    turn: s.turn,
    date: g.dateLabel(),
    scenario: s.scenario,
    mode: s.settings.mode,
    tension: Math.round(s.tension),
    worldWar: !!s.worldWar,
    me,
    countries,
    prov,
    formations: forms,
    battles,
    fronts,
    pockets: (s.pockets || []).filter((pk) => allies.has(pk.country) || pk.provs.some((q) => intel[q] >= 2)),
    wars: s.wars.map((x) => ({ id: x.id, name: x.name, attackers: x.attackers, defenders: x.defenders, start: x.start, score: x.score, battles: x.battles, exhaustA: Math.round(x.exhaustA), exhaustD: Math.round(x.exhaustD) })),
    rel,
    opinionOfMe,
    alliances,
    access,
    claims: Array.from({ length: g.C }, (_, x) => s.claims[c * g.C + x]),
    nap: Array.from({ length: g.C }, (_, x) => s.nap[c * g.C + x]),
    blocs: s.blocs,
    proposals,
    reports,
    events: s.events.slice(-30),
    weather: s.weather ? Array.from(s.weather) : [],
    operations: s.operations.filter((op) => op.owners.includes(p.id) || op.country === c),
    empires,
    empireProjects: PROJECTS,
    empireTitles: TITLES,
    players: Object.values(s.players).map((q) => ({ id: q.id, name: q.name, country: q.country, rank: q.rank, rankTitle: rankTitle(q.rank), online: q.online && !q.away })),
    lastTurn: s.lastTurn || null,
  };
}

function kindOf(f) {
  const c = f.comp;
  const n = Object.values(c).reduce((a, b) => a + b, 0) || 1;
  if (((c.armor || 0) + (c.mech || 0)) / n > 0.35) return 'armored';
  if ((c.art || 0) / n > 0.3) return 'artillery';
  return 'infantry';
}

function areaIndices(area) {
  if (!area) return [];
  let all = true;
  for (let i = 0; i < area.length; i++) if (!area[i]) {
    all = false;
    break;
  }
  if (all) return 'all';
  const out = [];
  for (let i = 0; i < area.length; i++) if (area[i]) out.push(i);
  return out;
}
