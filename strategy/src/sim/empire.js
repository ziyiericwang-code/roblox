// Empires: player- or AI-founded unions of nations with a charter, a council, tribute,
// imperial titles and megaprojects. Built on alliances, access and permission grants.
import { clamp } from './util.js';
import { capabilities } from '../../config/ranks.js';
import { formAlliance, evaluate, warsOf, joinWar, sideOf } from './diplomacy.js';

export const TITLES = {
  chancellor: { name: 'Imperial Chancellor', text: 'Runs imperial diplomacy and invitations.' },
  marshal: { name: 'Imperial Marshal', text: 'Assigns officers and commands contributed forces.' },
  viceroy: { name: 'Viceroy', text: "Commands an AI member state's armies." },
  governor: { name: 'Governor', text: 'Builds in the provinces of the imperial capital region.' },
  officer: { name: 'Imperial Officer', text: 'Commands an assigned imperial formation.' },
};

export const PROJECTS = {
  rail: { name: 'Continental Rail Grid', cost: 60, turns: 14, text: '+1 rail across member heartlands: supply reaches much further.' },
  orbital: { name: 'Orbital Recon Network', cost: 90, turns: 18, text: 'Satellites watch every enemy border: +1 intelligence at war.' },
  strike: { name: 'Hypersonic Strike Network', cost: 120, turns: 22, text: 'The Emperor may strike any province every 4 turns.' },
  shield: { name: 'Imperial Air Shield', cost: 80, turns: 16, text: '+30% air power for every member.' },
  yards: { name: 'Deep-Water Fleet Yards', cost: 70, turns: 15, text: 'Two destroyers join the imperial fleet every 4 turns.' },
  academy: { name: 'Imperial War Academy', cost: 50, turns: 12, text: 'Veterancy for every formation of the empire.' },
};

const DEFAULT_CHARTER = { war: 'vote', tribute: 0.05, sharedSupply: true, intel: true, leaveNotice: 3 };

export function empireOf(g, c) {
  return (g.s.empires || []).find((e) => e.members.some((m) => m.country === c));
}

function isLeader(e, p) {
  return e.emperor === p.id || e.officers.some((o) => o.player === p.id && o.title === 'chancellor');
}

function join(g, e, c, tier = 'member') {
  if (e.members.some((m) => m.country === c)) return;
  const s = g.s;
  for (const m of e.members) {
    if (!g.allied(m.country, c)) formAlliance(g, m.country, c);
    s.access[m.country * g.C + c] = 1;
    s.access[c * g.C + m.country] = 1;
    if (e.charter.intel) {
      s.intelShare = s.intelShare || new Uint8Array(g.C * g.C);
      s.intelShare[m.country * g.C + c] = s.intelShare[c * g.C + m.country] = 1;
    }
  }
  e.members.push({ country: c, tier, joined: s.turn, paid: 0 });
  g.intelCache = null;
  g.notify('all', { kind: 'empire', title: `${g.countryName(c)} joined the ${e.name}`, text: `The empire now has ${e.members.length} member states.`, important: true });
}

export function foundEmpire(g, sovereign, emperor, name, color) {
  const s = g.s;
  s.empires = s.empires || [];
  const e = {
    id: (s.nextId.emp = (s.nextId.emp || 0) + 1),
    name: name || `${g.countryName(sovereign)} Empire`,
    color: color || g.w.countries[sovereign].color,
    sovereign,
    emperor,
    members: [{ country: sovereign, tier: 'sovereign', joined: s.turn, paid: 0 }],
    officers: [],
    charter: { ...DEFAULT_CHARTER },
    council: [],
    projects: [],
    done: [],
    treasury: 0,
    founded: s.turn,
    dominance: 0,
  };
  s.empires.push(e);
  g.notify('all', { kind: 'empire', title: `The ${e.name} is proclaimed`, text: `${g.countryName(sovereign)} founds a new empire.`, important: true, huge: true });
  return e;
}

export function empireCommand(g, p, cmd) {
  const s = g.s;
  s.empires = s.empires || [];
  const fail = (reason) => ({ ok: false, reason });
  const ok = (x = {}) => ({ ok: true, ...x });
  const caps = p ? capabilities(p.rank) : null;
  const e = cmd.empire ? s.empires.find((x) => x.id === cmd.empire) : p ? empireOf(g, p.country) || s.empires.find((x) => x.officers.some((o) => o.player === p.id)) : null;
  switch (cmd.op) {
    case 'found': {
      if (!caps.has('diplomacy')) return fail('Founding an empire requires national authority (Supreme Commander)');
      if (empireOf(g, p.country)) return fail('Your nation already belongs to an empire');
      const name = String(cmd.name || '').replace(/[<>]/g, '').trim().slice(0, 40);
      return ok({ empire: foundEmpire(g, p.country, p.id, name, cmd.color).id });
    }
    case 'invite': {
      if (!e || !isLeader(e, p)) return fail('Only the Emperor or Chancellor can invite');
      const t = cmd.target | 0;
      if (empireOf(g, t)) return fail('That nation already belongs to an empire');
      const humans = g.playersOf(t);
      if (humans.length && humans.some((q) => q.rank >= 49 || !q.ai.diplomacy)) {
        s.proposals = s.proposals || [];
        s.proposals.push({ id: `pr${s.turn}-${e.sovereign}-${t}-empire`, from: e.sovereign, to: t, type: 'empire', terms: { empire: e.id, tier: cmd.tier || 'member' }, turn: s.turn });
        g.notify(t, { kind: 'proposal', title: `Invitation to join the ${e.name}`, text: 'Open Diplomacy to respond.', important: true });
        return ok({ pending: true });
      }
      const ev = evaluate(g, e.sovereign, t, 'empire');
      if (ev.score <= 0) return ok({ accepted: false, reasons: ev.reasons });
      join(g, e, t, cmd.tier || 'member');
      return ok({ accepted: true, reasons: ev.reasons });
    }
    case 'accept': {
      // from acceptProposal: `from` is the sovereign (invitation) or applicant (request)
      const emp = s.empires.find((x) => x.id === cmd.terms.empire);
      if (!emp) return fail('Empire gone');
      const joiner = cmd.terms.request ? cmd.from : cmd.to;
      join(g, emp, joiner, cmd.terms.tier || 'member');
      return ok();
    }
    case 'request': {
      if (!caps.has('diplomacy')) return fail('Joining an empire requires national authority');
      const emp = s.empires.find((x) => x.id === cmd.empire);
      if (!emp) return fail('Unknown empire');
      if (empireOf(g, p.country)) return fail('Already in an empire');
      const sovPlayers = g.playersOf(emp.sovereign);
      if (sovPlayers.length) {
        s.proposals = s.proposals || [];
        s.proposals.push({ id: `pr${s.turn}-${p.country}-${emp.sovereign}-empire`, from: p.country, to: emp.sovereign, type: 'empire', terms: { empire: emp.id, request: true, tier: cmd.tier || 'member' }, turn: s.turn });
        g.notify(emp.sovereign, { kind: 'proposal', title: `${g.countryName(p.country)} asks to join your empire`, text: 'Open the Empire panel to respond.', important: true });
        return ok({ pending: true });
      }
      join(g, emp, p.country, cmd.tier || 'member');
      return ok({ accepted: true });
    }
    case 'serve': {
      // become an Imperial Officer inside the empire's sovereign nation
      const emp = s.empires.find((x) => x.id === cmd.empire);
      if (!emp) return fail('Unknown empire');
      if (p.rank >= 49 && p.country !== emp.sovereign) return fail('A head of state cannot serve another empire; step down first');
      for (const id of p.formations) {
        const f = s.formations.get(id);
        if (f) f.ctrl = null;
      }
      p.formations = [];
      p.country = emp.sovereign;
      p.hq = s.countries[emp.sovereign].capital;
      emp.officers.push({ player: p.id, title: 'officer', since: s.turn });
      g.notify('all', { kind: 'empire', title: `${p.name} now serves the ${emp.name}`, text: 'A new Imperial Officer takes the oath.' });
      return ok();
    }
    case 'title': {
      if (!e || e.emperor !== p.id) return fail('Only the Emperor grants titles');
      if (!TITLES[cmd.title]) return fail('Unknown title');
      const target = s.players[cmd.player];
      if (!target) return fail('Unknown player');
      const inEmpire = e.members.some((m) => m.country === target.country) || e.officers.some((o) => o.player === target.id);
      if (!inEmpire) return fail('That commander is not part of the empire');
      e.officers = e.officers.filter((o) => o.player !== target.id);
      e.officers.push({ player: target.id, title: cmd.title, since: s.turn, country: cmd.country });
      g.notify(target.id, { kind: 'empire', title: `You are now ${TITLES[cmd.title].name}`, text: TITLES[cmd.title].text, important: true });
      return ok();
    }
    case 'charter': {
      if (!e || e.emperor !== p.id) return fail('Only the Emperor proposes charter changes');
      const key = cmd.key;
      if (!(key in DEFAULT_CHARTER)) return fail('Unknown charter field');
      e.council.push({ id: `c${s.turn}-${e.council.length}`, kind: 'charter', key, value: cmd.value, votes: { [e.sovereign]: true }, turn: s.turn });
      return ok();
    }
    case 'vote': {
      if (!e) return fail('Not in an empire');
      const item = e.council.find((x) => x.id === cmd.id);
      if (!item) return fail('Unknown motion');
      item.votes[p.country] = !!cmd.yes;
      return ok();
    }
    case 'project': {
      if (!e || !isLeader(e, p)) return fail('Only the Emperor or Chancellor starts projects');
      const def = PROJECTS[cmd.project];
      if (!def) return fail('Unknown project');
      if (e.projects.some((x) => x.type === cmd.project) || e.done.includes(cmd.project)) return fail('Already under way');
      e.projects.push({ type: cmd.project, progress: 0, funded: 0 });
      g.notify(e.members.map((m) => m.country), { kind: 'empire', title: `Megaproject started: ${def.name}`, text: def.text });
      return ok();
    }
    case 'contribute': {
      if (!e) return fail('Not in an empire');
      const nat = s.countries[p.country];
      const amt = Math.max(0, Math.min(nat.treasury, Number(cmd.amount) || 0));
      nat.treasury -= amt;
      e.treasury += amt;
      return ok({ amount: amt });
    }
    case 'strike': {
      if (!e || e.emperor !== p.id || !e.done.includes('strike')) return fail('The strike network is not available');
      if (s.turn - (e.lastStrike || -99) < 4) return fail('The network is recharging');
      const q = cmd.prov | 0;
      if (q < 0 || q >= g.P) return fail('Invalid target');
      e.lastStrike = s.turn;
      s.prov.damage[q] = Math.min(200, s.prov.damage[q] + 90);
      s.prov.fort[q] = Math.max(0, s.prov.fort[q] - 2);
      for (const id of g.byProv[q]) {
        const f = s.formations.get(id);
        if (f && g.atWar(e.sovereign, f.owner)) {
          f.org = Math.max(0, f.org - 0.5);
          f.str = Math.max(0.05, f.str - 0.12);
        }
      }
      g.notify('all', { kind: 'event', title: `Hypersonic strike on ${g.w.provinces.name[q]}`, text: `The ${e.name} unleashed its strike network.`, prov: q, important: true });
      return ok();
    }
    case 'leave': {
      if (!e) return fail('Not in an empire');
      if (p.country === e.sovereign) return fail('The sovereign cannot leave; dissolve instead');
      if (!caps.has('diplomacy')) return fail('Leaving requires national authority');
      e.members = e.members.filter((m) => m.country !== p.country);
      g.notify('all', { kind: 'empire', title: `${g.countryName(p.country)} left the ${e.name}`, text: '' });
      return ok();
    }
    case 'dissolve': {
      if (!e || e.emperor !== p.id) return fail('Only the Emperor');
      s.empires = s.empires.filter((x) => x !== e);
      g.notify('all', { kind: 'empire', title: `The ${e.name} is dissolved`, text: '' });
      return ok();
    }
    default:
      return fail('Unknown empire action');
  }
}

// Per-turn empire processing: tribute, projects, council, war obligations, AI empires.
export function empireTurn(g) {
  const s = g.s;
  s.empires = s.empires || [];
  const totalPop = g.w.countries.reduce((a, c) => a + c.pop, 0);
  for (const e of s.empires) {
    const sov = s.countries[e.sovereign];
    if (!sov.alive) {
      s.empires = s.empires.filter((x) => x !== e);
      continue;
    }
    // tribute
    for (const m of e.members) {
      if (m.country === e.sovereign) continue;
      const nat = s.countries[m.country];
      const pay = Math.max(0, nat.income * e.charter.tribute);
      nat.treasury -= pay;
      e.treasury += pay;
      m.paid += pay;
    }
    // megaprojects
    for (const pr of e.projects) {
      const def = PROJECTS[pr.type];
      const step = def.cost / def.turns;
      const use = Math.min(step, e.treasury);
      e.treasury -= use;
      pr.funded += use;
      pr.progress = pr.funded / def.cost;
      if (pr.progress >= 1) {
        e.done.push(pr.type);
        applyProject(g, e, pr.type);
        g.notify(e.members.map((m) => m.country), { kind: 'empire', title: `${def.name} completed`, text: def.text, important: true });
      }
    }
    e.projects = e.projects.filter((pr) => pr.progress < 1);
    if (e.done.includes('yards') && s.turn % 4 === 0) sov.navy.destroyer += 2;
    // council motions resolve by majority after one turn
    for (const item of e.council) {
      if (s.turn - item.turn < 1) continue;
      for (const m of e.members) {
        if (item.votes[m.country] !== undefined) continue;
        if (g.playersOf(m.country).some((q) => q.rank >= 49)) continue;
        item.votes[m.country] = g.rng.chance(0.6);
      }
      const yes = Object.values(item.votes).filter(Boolean).length;
      if (yes * 2 > e.members.length) {
        if (item.kind === 'charter') e.charter[item.key] = item.value;
        item.passed = true;
      }
      item.closed = true;
    }
    e.council = e.council.filter((x) => !x.closed).concat(e.council.filter((x) => x.closed).slice(-5));
    // war obligations: members join the sovereign's wars
    for (const war of warsOf(g, e.sovereign)) {
      const side = sideOf(war, e.sovereign);
      for (const m of e.members) {
        if (war.attackers.includes(m.country) || war.defenders.includes(m.country)) continue;
        if (g.humanRuns(m.country)) continue;
        if (side === 'D' || e.charter.war !== 'defensive') joinWar(g, m.country, war, side);
      }
    }
    // dominance victory tracking
    let pop = 0;
    for (let p = 0; p < g.P; p++) if (e.members.some((m) => m.country === s.prov.ctrl[p])) pop += g.w.provinces.pop[p];
    e.popShare = pop / totalPop;
    e.dominance = e.popShare >= 0.4 ? e.dominance + 1 : 0;
    if (e.dominance === 20) g.notify('all', { kind: 'event', title: `The ${e.name} dominates the world`, text: 'Imperial victory: 40% of humanity has lived under its banner for 20 turns.', huge: true, important: true });
  }
  // AI hegemons may proclaim empires and gather clients
  if (s.turn % 10 === 5) {
    for (const nat of s.countries) {
      if (!nat.alive || nat.personality !== 'hegemon' || empireOf(g, nat.id) || g.playersOf(nat.id).some((q) => q.rank >= 49)) continue;
      if (s.tension < 55 || !g.rng.chance(0.35)) continue;
      const e = foundEmpire(g, nat.id, null, null);
      for (let x = 0; x < g.C && e.members.length < 6; x++) {
        if (x === nat.id || !s.countries[x].alive || empireOf(g, x) || g.playersOf(x).length) continue;
        if (!g.allied(nat.id, x) && s.rel[nat.id * g.C + x] < 30) continue;
        if (evaluate(g, nat.id, x, 'empire').score > 0) join(g, e, x, 'associate');
      }
    }
  }
}

function applyProject(g, e, type) {
  const s = g.s;
  if (type === 'rail') {
    for (const m of e.members) for (const p of g.w.provincesOf[m.country]) s.prov.rail[p] = Math.min(3, s.prov.rail[p] + 1);
  }
  if (type === 'shield') for (const m of e.members) {
    const a = s.countries[m.country].air;
    a.fighter = Math.round(a.fighter * 1.3);
  }
  if (type === 'academy') for (const f of s.formations.values()) if (e.members.some((m) => m.country === f.owner)) f.exp = clamp(f.exp + 0.2, 0, 1);
  if (type === 'orbital') g.intelCache = null;
}
