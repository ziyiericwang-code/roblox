// Player commands. Every command is validated against authority (rank), ownership,
// permissions and game rules. Clients never send numbers the server trusts.
import { RANKS, capabilities } from '../../config/ranks.js';
import { BUILDINGS } from '../../config/economy.js';
import { TEMPLATES } from '../../config/units.js';
import { MOBILIZATION } from '../../config/economy.js';
import { OPERATION_WORDS } from '../../config/scenario.js';
import { findPath, findSeaPath } from './movement.js';
import { splitFormation, mergeFormations, elementCount, moveFormation } from './formations.js';
import { queueBuilding } from './economy.js';
import { declareWar, makePeace, evaluate, formAlliance, breakAlliance, warsOf, sideOf, joinWar } from './diplomacy.js';
import { propose, peaceTerms } from './ai.js';
import { commandUsage, fillCommand, computeArea, award } from './career.js';
import { empireCommand } from './empire.js';
import { devCommand } from './dev.js';

const fail = (reason) => ({ ok: false, reason });
const ok = (extra = {}) => ({ ok: true, ...extra });

function need(p, cap, label) {
  if (capabilities(p.rank).has(cap)) return null;
  const idx = RANKS.findIndex((r) => r.unlock.includes(cap));
  return `${label || 'This'} requires ${idx >= 0 ? RANKS[idx].name : 'a higher rank'}`;
}

// formations a player may order: their own, or ones delegated to them
export function controls(g, p, f) {
  if (!f) return false;
  if (f.ctrl === p.id) return true;
  const grants = g.s.grants || [];
  return grants.some((gr) => gr.grantee === p.id && gr.perm === 'CONTROL_ARMIES' && gr.assets.includes(f.id) && (!gr.expires || gr.expires >= g.s.turn));
}

function activeOrders(g, p) {
  let n = 0;
  for (const f of g.s.formations.values()) if (f.order && f.order.by === p.id) n++;
  return n;
}

export function applyCommand(g, p, cmd) {
  const s = g.s;
  const w = g.w;
  const P = g.P;
  const caps = capabilities(p.rank);
  const r = RANKS[p.rank];
  const F = (id) => s.formations.get(id);
  switch (cmd.type) {
    // ------------------------------------------------------------ movement
    case 'move':
    case 'attack': {
      const f = F(cmd.f);
      if (!controls(g, p, f)) return fail('You do not command that formation');
      if (f.battle) return fail('The formation is in battle. Withdraw first.');
      const to = cmd.to | 0;
      if (to < 0 || to >= P) return fail('Invalid destination');
      if (!p.area[to] && !(cmd.via && cmd.via.every((x) => p.area[x]))) return fail('Outside your operational area');
      if (cmd.via && cmd.via.length && !caps.has('waypoints')) return fail(need(p, 'waypoints', 'Waypoints'));
      const hostile = g.atWar(f.owner, s.prov.ctrl[to]) || g.hostileIn(to, f.owner).length > 0;
      if (hostile && !caps.has('attack')) return fail(need(p, 'attack', 'Attacking'));
      const stops = [...(cmd.via || []), to].map((x) => x | 0);
      let path = [f.prov];
      for (const stop of stops) {
        const seg = findPath(g, f.owner, path[path.length - 1], stop);
        if (!seg) return fail(`No route to ${w.provinces.name[stop]}`);
        path = path.concat(seg.slice(1));
      }
      if (path.length < 2) return fail('Already there');
      // enemy territory along the route must be inside the operational area
      for (const q of path) if (g.atWar(f.owner, s.prov.ctrl[q]) && !p.area[q]) return fail('The route attacks outside your operational area');
      const had = !!(f.order && f.order.by === p.id);
      if (!had && activeOrders(g, p) >= r.orders) return fail(`Order limit reached (${r.orders} at your rank)`);
      f.order = { type: hostile ? 'attack' : 'move', path, idx: 1, target: to, by: p.id, then: cmd.then || (hostile ? 'hold' : 'hold') };
      f.progress = 0;
      f.posture = f.order.type;
      return ok({ path });
    }
    case 'sea': {
      const f = F(cmd.f);
      if (!controls(g, p, f)) return fail('You do not command that formation');
      if (f.battle) return fail('In battle');
      if (!s.prov.port[f.prov] || s.prov.ctrl[f.prov] !== f.owner) return fail('Embark from a province with a naval base you control');
      const to = cmd.to | 0;
      const hostile = g.atWar(f.owner, s.prov.ctrl[to]);
      if (hostile && !caps.has('amphibious')) return fail(need(p, 'amphibious', 'Amphibious landings'));
      if (!hostile && p.rank < 19) return fail('Sea transport requires an officer rank');
      if (!p.area[to]) return fail('Outside your operational area');
      const path = findSeaPath(g, f.owner, f.prov, to);
      if (!path) return fail('No sea route');
      if (activeOrders(g, p) >= r.orders && !(f.order && f.order.by === p.id)) return fail('Order limit reached');
      f.order = { type: 'sea', path, idx: 1, target: to, by: p.id };
      f.progress = 0;
      return ok({ path });
    }
    case 'hold':
    case 'digin': {
      const f = F(cmd.f);
      if (!controls(g, p, f)) return fail('You do not command that formation');
      if (cmd.type === 'digin' && !caps.has('digin')) return fail(need(p, 'digin', 'Digging in'));
      f.order = null;
      f.progress = 0;
      f.posture = cmd.type;
      return ok();
    }
    case 'withdraw': {
      const f = F(cmd.f);
      if (!controls(g, p, f)) return fail('You do not command that formation');
      if (!caps.has('withdraw')) return fail(need(p, 'withdraw', 'Withdrawing'));
      if (f.battle) {
        const b = s.battles.get(f.battle);
        if (b) {
          b.attackers = b.attackers.filter((id) => id !== f.id);
          b.defenders = b.defenders.filter((id) => id !== f.id);
        }
        f.battle = 0;
        f.org = Math.max(0.05, f.org - 0.15);
      }
      const back = w.neighbors(f.prov).filter((q) => q < P && (s.prov.ctrl[q] === f.owner || g.allied(f.owner, s.prov.ctrl[q])) && !g.hostileIn(q, f.owner).length);
      const to = cmd.to !== undefined && back.includes(cmd.to) ? cmd.to : f.fallback !== undefined && back.includes(f.fallback) ? f.fallback : back[0];
      if (to === undefined) return fail('Nowhere to withdraw to');
      f.order = { type: 'move', path: [f.prov, to], idx: 1, target: to, by: p.id, then: 'digin' };
      f.progress = 0;
      return ok();
    }
    case 'fallback': {
      const f = F(cmd.f);
      if (!controls(g, p, f)) return fail('You do not command that formation');
      if (!caps.has('fallback')) return fail(need(p, 'fallback', 'Fallback positions'));
      f.fallback = cmd.to | 0;
      return ok();
    }
    // ------------------------------------------------------------ structure
    case 'split': {
      const f = F(cmd.f);
      if (!controls(g, p, f)) return fail('You do not command that formation');
      if (!caps.has('split')) return fail(need(p, 'split', 'Splitting'));
      if (f.battle) return fail('In battle');
      if (commandUsage(g, p).formations >= r.formations) return fail(`Formation limit reached (${r.formations})`);
      let part = cmd.part;
      if (!part) {
        part = {};
        for (const t in f.comp) {
          const n = Math.floor(f.comp[t] / 2);
          if (n > 0) part[t] = n;
        }
      }
      if (elementCount(part) <= 0 || elementCount(part) >= elementCount(f.comp)) return fail('Cannot split that way');
      const nf = splitFormation(g, f, part, `${f.name} — B`);
      if (!nf) return fail('Invalid split');
      nf.ctrl = p.id;
      p.formations.push(nf.id);
      return ok({ id: nf.id });
    }
    case 'merge': {
      const a = F(cmd.a);
      const b = F(cmd.b);
      if (!controls(g, p, a) || !controls(g, p, b)) return fail('You do not command both formations');
      if (!caps.has('merge')) return fail(need(p, 'merge', 'Merging'));
      if (a.prov !== b.prov) return fail('Formations must be in the same province');
      if (a.battle || b.battle) return fail('In battle');
      if (elementCount(a.comp) + elementCount(b.comp) > TEMPLATES.division.max) return fail(`Too large (max ${TEMPLATES.division.max} elements)`);
      mergeFormations(g, a, b);
      p.formations = p.formations.filter((id) => id !== b.id);
      return ok();
    }
    case 'transfer': {
      const a = F(cmd.from);
      const b = F(cmd.to);
      if (!controls(g, p, a) || !controls(g, p, b)) return fail('You do not command both formations');
      if (!caps.has('transfer')) return fail(need(p, 'transfer', 'Transferring elements'));
      if (a.prov !== b.prov) return fail('Same province required');
      const n = Math.min(cmd.n | 0, a.comp[cmd.t] || 0);
      if (n <= 0 || elementCount(a.comp) - n < 1) return fail('Nothing to transfer');
      a.comp[cmd.t] -= n;
      if (!a.comp[cmd.t]) delete a.comp[cmd.t];
      b.comp[cmd.t] = (b.comp[cmd.t] || 0) + n;
      return ok();
    }
    case 'rename': {
      const f = F(cmd.f);
      if (!controls(g, p, f)) return fail('You do not command that formation');
      const name = String(cmd.name || '').replace(/[<>]/g, '').trim().slice(0, 40);
      if (!name) return fail('Empty name');
      f.name = name;
      return ok();
    }
    case 'reinf': {
      const f = F(cmd.f);
      if (!controls(g, p, f)) return fail('You do not command that formation');
      if (!caps.has('reinforcePriority')) return fail(need(p, 'reinforcePriority', 'Reinforcement priority'));
      f.reinf = Math.max(0, Math.min(2, cmd.level | 0));
      return ok();
    }
    case 'auto': {
      const f = F(cmd.f);
      if (!controls(g, p, f)) return fail('You do not command that formation');
      if (!caps.has('aiSub1') && cmd.on) return fail(need(p, 'aiSub1', 'AI subordinates'));
      f.auto = !!cmd.on;
      if (f.auto) f.order = null;
      return ok();
    }
    case 'release': {
      const f = F(cmd.f);
      if (!f || f.ctrl !== p.id) return fail('Not yours');
      if (p.formations.length <= 1) return fail('You must keep at least one formation');
      f.ctrl = null;
      f.auto = false;
      p.formations = p.formations.filter((id) => id !== f.id);
      return ok();
    }
    case 'request': {
      const f = F(cmd.f);
      if (!f || f.owner !== p.country || f.ctrl) return fail('That formation is not available');
      if (!p.area[f.prov]) return fail('Outside your operational area');
      const use = commandUsage(g, p);
      if (use.formations >= r.formations) return fail(`Formation limit (${r.formations})`);
      if (use.elements + g.elements(f) > r.elements) return fail(`Too large for your command (${r.elements} elements max)`);
      f.ctrl = p.id;
      f.order = null;
      p.formations.push(f.id);
      return ok();
    }
    // ------------------------------------------------------------ support
    case 'recon': {
      const f = F(cmd.f);
      if (!controls(g, p, f)) return fail('You do not command that formation');
      if (!caps.has('recon')) return fail(need(p, 'recon', 'Recon'));
      const deep = caps.has('deepRecon');
      const d = hops(g, f.prov, cmd.prov | 0, deep ? 3 : 1);
      if (d < 0) return fail(deep ? 'Target must be within 3 provinces' : 'Target must be adjacent');
      if (p.cp < 1) return fail('Not enough Command Points');
      p.cp -= 1;
      s.recon = (s.recon || []).filter((x) => x.until >= s.turn);
      s.recon.push({ country: p.country, prov: cmd.prov | 0, until: s.turn + 2 });
      p.recon = [...(p.recon || []), cmd.prov | 0].slice(-10);
      g.intelCache = null;
      return ok();
    }
    case 'support': {
      const kind = cmd.kind;
      const cost = { artillery: 2, cas: 3, resupply: 1 }[kind];
      if (!cost) return fail('Unknown support');
      const capName = { artillery: 'artillery', cas: 'cas', resupply: 'resupply' }[kind];
      if (!caps.has(capName)) return fail(need(p, capName, 'This support'));
      if (p.cp < cost) return fail(`Needs ${cost} Command Points`);
      if (kind === 'resupply') {
        const f = F(cmd.f);
        if (!controls(g, p, f)) return fail('You do not command that formation');
        f.supply = Math.min(1.2, f.supply + 0.35);
        f.fuel = Math.min(1.2, f.fuel + 0.35);
      } else {
        const b = [...s.battles.values()].find((x) => x.id === cmd.battle || x.attackers.some((id) => controls(g, p, F(id))) || x.defenders.some((id) => controls(g, p, F(id))));
        if (!b) return fail('No battle involving your forces');
        b.support[kind] = (b.support[kind] || 0) + 1;
      }
      p.cp -= cost;
      return ok();
    }
    // ------------------------------------------------------------ fronts and lines
    case 'line': {
      if (!caps.has('lines')) return fail(need(p, 'lines', 'Defensive lines'));
      const provs = (cmd.provs || []).map((x) => x | 0).filter((q) => q < P && p.area[q] && (s.prov.ctrl[q] === p.country || g.allied(p.country, s.prov.ctrl[q])));
      const forms = (cmd.forms || p.formations).map(F).filter((f) => controls(g, p, f) && !f.battle);
      if (!provs.length || !forms.length) return fail('Pick friendly provinces and formations');
      spread(g, p, forms, provs, 'digin');
      return ok();
    }
    case 'assignFront': {
      if (!caps.has('assignFront')) return fail(need(p, 'assignFront', 'Front assignment'));
      const front = (s.fronts || []).find((x) => x.id === cmd.front);
      if (!front) return fail('Unknown front');
      const provs = front.provs.filter((q) => s.prov.ctrl[q] === p.country || g.allied(p.country, s.prov.ctrl[q]));
      const forms = (cmd.forms || p.formations).map(F).filter((f) => controls(g, p, f) && !f.battle);
      if (!provs.length || !forms.length) return fail('Nothing to assign');
      spread(g, p, forms, provs, 'digin');
      for (const f of forms) f.frontId = front.id;
      return ok();
    }
    // ------------------------------------------------------------ operations
    case 'operation': {
      if (!caps.has('operations')) return fail(need(p, 'operations', 'Named operations'));
      const objectives = (cmd.objectives || []).map((x) => x | 0).filter((q) => q < P && p.area[q]);
      const maxObj = caps.has('opsMulti') ? (caps.has('phasedOps') ? 8 : 3) : 1;
      if (!objectives.length) return fail('Pick at least one objective in your area');
      if (objectives.length > maxObj) return fail(`Your rank allows ${maxObj} objective${maxObj > 1 ? 's' : ''}`);
      const forms = (cmd.forms || []).map(F).filter((f) => controls(g, p, f));
      if (!forms.length) return fail('Assign at least one formation');
      const name = String(cmd.name || '').replace(/[<>]/g, '').trim().slice(0, 32) || `OPERATION ${g.rng.pick(OPERATION_WORDS.a)} ${g.rng.pick(OPERATION_WORDS.b)}`;
      const prep = Math.max(0, Math.min(3, cmd.prep | 0));
      const op = { id: s.nextId.op++, name: name.toUpperCase(), owner: p.id, owners: [p.id], country: p.country, objectives, forces: forms.map((f) => f.id), prep, start: s.turn + prep, status: prep ? 'preparing' : 'active', created: s.turn, estimate: estimateOp(g, forms, objectives) };
      s.operations.push(op);
      for (const f of forms) {
        f.opId = op.id;
        f.order = null;
        f.posture = 'digin';
      }
      g.notify(p.id, { kind: 'operation', title: `${op.name} planned`, text: `${objectives.length} objective(s), ${forms.length} formation(s). ${prep ? `Launch in ${prep} turn(s).` : 'Launching now.'}` });
      return ok({ op: op.id });
    }
    case 'opCancel': {
      const op = s.operations.find((o) => o.id === cmd.op && o.owners.includes(p.id));
      if (!op) return fail('Unknown operation');
      op.status = 'cancelled';
      for (const id of op.forces) {
        const f = F(id);
        if (f && f.opId === op.id) {
          f.opId = 0;
          f.prep = 0;
        }
      }
      return ok();
    }
    // ------------------------------------------------------------ construction
    case 'build': {
      const b = BUILDINGS[cmd.b];
      if (!b) return fail('Unknown building');
      if (!caps.has(b.cap)) return fail(need(p, b.cap, b.name));
      if (b.cap === 'fortify1' && s.prov.fort[cmd.prov] >= 1 && !caps.has('fortify2')) return fail(need(p, 'fortify2', 'Higher fortification levels'));
      if (!p.area[cmd.prov]) return fail('Outside your operational area');
      const err = queueBuilding(g, p.country, cmd.prov | 0, cmd.b, p.id);
      if (err) return fail(err);
      return ok();
    }
    // ------------------------------------------------------------ national authority
    case 'mobilize': {
      if (!caps.has('mobilization')) return fail(need(p, 'mobilization', 'Mobilization laws'));
      const lvl = Math.max(0, Math.min(MOBILIZATION.length - 1, cmd.level | 0));
      s.countries[p.country].mob = lvl;
      return ok();
    }
    case 'milShare': {
      if (!caps.has('economy')) return fail(need(p, 'economy', 'Budget control'));
      s.countries[p.country].milShare = Math.max(0.005, Math.min(0.2, Number(cmd.v) || 0.02));
      return ok();
    }
    case 'production': {
      if (!caps.has('production') && !caps.has('productionAdvice')) return fail(need(p, 'productionAdvice', 'Production'));
      const nat = s.countries[p.country];
      if (cmd.auto) {
        nat.autoProduction = true;
        return ok();
      }
      const lines = (cmd.lines || []).filter((l) => l && typeof l.item === 'string').slice(0, 10).map((l) => ({ item: l.item, share: Math.max(0, Math.min(100, Number(l.share) || 0)) }));
      if (!lines.length) return fail('No production lines');
      nat.autoProduction = false;
      nat.lines = lines;
      return ok();
    }
    case 'aiAssist': {
      if (p.rank < 49) return fail('Only a Supreme Commander can hand areas to the AI');
      if (cmd.area === 'economy') p.ai.economy = !!cmd.on;
      if (cmd.area === 'diplomacy') p.ai.diplomacy = !!cmd.on;
      return ok();
    }
    case 'emergency': {
      if (!caps.has('emergency')) return fail(need(p, 'emergency', 'National emergency'));
      const nat = s.countries[p.country];
      if (s.turn - (nat.emergency || -99) < 12) return fail('Recently declared');
      nat.emergency = s.turn;
      nat.mob = Math.min(3, nat.mob + 1);
      nat.manpower += g.w.countries[p.country].pop * 0.002;
      nat.stability = Math.max(0, nat.stability - 6);
      g.notify('all', { kind: 'event', title: `${g.countryName(p.country)} declares a national emergency`, text: 'Mass mobilization is under way.' });
      return ok();
    }
    case 'hotline': {
      // outcome of a leader-to-leader call (the words come from the client; the sim only
      // accepts a bounded mood swing, once per nation per turn, for national authorities)
      const t = cmd.target | 0;
      if (t === p.country || !s.countries[t]?.alive) return fail('Invalid nation');
      if (!caps.has('diplomacy')) return fail(need(p, 'diplomacy', 'Speaking for the nation'));
      const mood = Math.max(-2, Math.min(2, Math.round(Number(cmd.mood) || 0)));
      s.hotline = s.hotline || {};
      const key = `${p.id}:${t}`;
      if (s.hotline[key] === s.turn) return fail('You already spoke with them this turn');
      s.hotline[key] = s.turn;
      const i = t * g.C + p.country;
      s.rel[i] = Math.max(-100, Math.min(100, s.rel[i] + mood * 3));
      if (mood <= -2) s.tension = Math.min(100, s.tension + 0.5);
      return ok({ mood, opinion: s.rel[i] });
    }
    case 'advise': {
      if (!caps.has('advise')) return fail(need(p, 'advise', 'Advising national command'));
      if (p.influence < 10) return fail('Not enough Influence (10)');
      p.influence -= 10;
      const nat = s.countries[p.country];
      if (cmd.kind === 'mobilize') nat.mob = Math.min(3, nat.mob + 1);
      else if (cmd.kind === 'fortify') queueBuilding(g, p.country, cmd.prov | 0, 'fort');
      else if (cmd.kind === 'war' && cmd.target !== undefined) {
        if (g.rng.chance(0.35 + p.rank * 0.005)) {
          nat.ai.target = cmd.target | 0;
          nat.ai.prep = 2;
          return ok({ accepted: true });
        }
        return ok({ accepted: false });
      }
      return ok();
    }
    // ------------------------------------------------------------ diplomacy
    case 'declareWar': {
      if (!caps.has('war')) return fail(need(p, 'war', 'Declaring war'));
      const t = cmd.target | 0;
      if (t === p.country || !s.countries[t]?.alive) return fail('Invalid target');
      if (g.allied(p.country, t)) return fail('Leave the alliance first');
      if (s.nap[p.country * g.C + t]) s.nap[p.country * g.C + t] = s.nap[t * g.C + p.country] = 0;
      declareWar(g, p.country, t, { reason: s.claims[p.country * g.C + t] ? 'Territorial claim' : 'Aggression' });
      award(g, p, 5, 'Declared war');
      return ok();
    }
    case 'propose': {
      const type = cmd.kind;
      const t = cmd.target | 0;
      const needCap = type === 'alliance' || type === 'trade' || type === 'nap' ? 'diplomacy' : 'militaryDiplomacy';
      if (!caps.has(needCap) && !caps.has('diplomacy')) return fail(need(p, needCap, 'This diplomacy'));
      if (!s.countries[t]?.alive || t === p.country) return fail('Invalid country');
      const terms = { ...(cmd.terms || {}) };
      if (type === 'peace') {
        const war = warsOf(g, p.country).find((x) => x.attackers.includes(t) || x.defenders.includes(t));
        if (!war) return fail('Not at war with them');
        terms.war = war.id;
        const mine = sideOf(war, p.country);
        if (cmd.demand) terms.transfers = peaceTerms(g, war, mine);
        else if (cmd.concede) terms.transfers = peaceTerms(g, war, mine === 'A' ? 'D' : 'A');
        else terms.transfers = [];
      }
      if (type === 'joinwar') {
        const war = warsOf(g, p.country)[0];
        if (!war) return fail('You are not at war');
        terms.war = war.id;
      }
      // human recipient: queue; AI: decide now
      if (g.humanRuns(t) || g.playersOf(t).some((q) => !q.ai.diplomacy)) {
        propose(g, p.country, t, type, terms);
        return ok({ pending: true });
      }
      const ev = evaluate(g, p.country, t, type, terms);
      if (ev.score <= 0) return ok({ accepted: false, reasons: ev.reasons });
      acceptProposal(g, { from: p.country, to: t, type, terms });
      return ok({ accepted: true, reasons: ev.reasons });
    }
    case 'respond': {
      const pr = (s.proposals || []).find((x) => x.id === cmd.id && x.to === p.country);
      if (!pr) return fail('Proposal not found');
      if (!caps.has('diplomacy') && !caps.has('militaryDiplomacy')) return fail(need(p, 'militaryDiplomacy', 'Answering proposals'));
      s.proposals = s.proposals.filter((x) => x !== pr);
      if (cmd.accept) acceptProposal(g, pr);
      else g.notify(pr.from, { kind: 'diplomacy', title: `${g.countryName(p.country)} declined your ${pr.type} proposal`, text: '' });
      return ok();
    }
    case 'breakAlliance': {
      if (!caps.has('diplomacy')) return fail(need(p, 'diplomacy', 'Leaving alliances'));
      breakAlliance(g, p.country, cmd.target | 0);
      return ok();
    }
    case 'grant':
    case 'revoke':
      return grantCommand(g, p, cmd);
    case 'empire':
      return empireCommand(g, p, cmd);
    case 'standing': {
      if (!['defensive', 'hold', 'continue', 'ai'].includes(cmd.mode)) return fail('Unknown standing orders');
      p.standing = cmd.mode;
      return ok();
    }
    case 'tutorial': {
      p.tutorial = cmd.step;
      return ok();
    }
    case 'dev':
      if (!p.dev) return fail('Developer tools are not available');
      return devCommand(g, p, cmd);
    default:
      return fail(`Unknown command ${cmd.type}`);
  }
}

export function acceptProposal(g, pr) {
  const s = g.s;
  const C = g.C;
  const { from, to, type, terms } = pr;
  switch (type) {
    case 'alliance':
      formAlliance(g, from, to);
      break;
    case 'access':
      s.access[to * C + from] = 1;
      g.notify([from, to], { kind: 'diplomacy', title: `${g.countryName(to)} granted military access to ${g.countryName(from)}`, text: '' });
      break;
    case 'nap':
      s.nap[from * C + to] = s.nap[to * C + from] = 1;
      g.notify([from, to], { kind: 'diplomacy', title: `Non-aggression pact: ${g.countryName(from)} and ${g.countryName(to)}`, text: '' });
      break;
    case 'trade':
      s.trade = s.trade || new Uint8Array(C * C);
      s.trade[from * C + to] = s.trade[to * C + from] = 1;
      g.notify([from, to], { kind: 'diplomacy', title: `Trade agreement: ${g.countryName(from)} and ${g.countryName(to)}`, text: '' });
      break;
    case 'intel':
      s.intelShare = s.intelShare || new Uint8Array(C * C);
      s.intelShare[from * C + to] = s.intelShare[to * C + from] = 1;
      g.intelCache = null;
      g.notify([from, to], { kind: 'diplomacy', title: `Intelligence sharing: ${g.countryName(from)} and ${g.countryName(to)}`, text: '' });
      break;
    case 'peace': {
      const war = s.wars.find((x) => x.id === terms.war);
      if (war) makePeace(g, war, { transfers: terms.transfers || [], by: to });
      break;
    }
    case 'joinwar': {
      const war = s.wars.find((x) => x.id === terms.war);
      if (war) joinWar(g, to, war, sideOf(war, from));
      break;
    }
    case 'empire':
      empireCommand(g, null, { op: 'accept', from, to, terms });
      break;
    default:
      break;
  }
}

function grantCommand(g, p, cmd) {
  const s = g.s;
  s.grants = s.grants || [];
  if (cmd.type === 'revoke') {
    const before = s.grants.length;
    s.grants = s.grants.filter((gr) => !(gr.id === cmd.id && gr.grantorPlayer === p.id));
    return before === s.grants.length ? fail('Grant not found') : ok();
  }
  const PERMS = ['VIEW_ARMIES', 'VIEW_ECONOMY', 'VIEW_INTELLIGENCE', 'REQUEST_MOVEMENT', 'CONTROL_ARMIES', 'CONTROL_AIR', 'CONTROL_NAVAL', 'MANAGE_OPERATIONS'];
  if (!PERMS.includes(cmd.perm)) return fail('Unknown permission');
  const grantee = s.players[cmd.grantee];
  if (!grantee || grantee.id === p.id) return fail('Unknown player');
  if (!g.allied(p.country, grantee.country) && grantee.country !== p.country && !sameEmpire(g, p.country, grantee.country)) return fail('Permissions can only be granted to allies');
  const assets = (cmd.assets || []).filter((id) => s.formations.get(id)?.ctrl === p.id);
  if (cmd.perm.startsWith('CONTROL') && !assets.length) return fail('Pick the formations to delegate');
  const gr = { id: `g${s.turn}-${p.id}-${s.grants.length}`, grantorPlayer: p.id, grantor: p.country, grantee: grantee.id, perm: cmd.perm, assets, expires: cmd.turns ? s.turn + (cmd.turns | 0) : 0, created: s.turn };
  s.grants.push(gr);
  g.notify(grantee.id, { kind: 'permission', title: `${p.name} (${g.countryName(p.country)}) granted you ${cmd.perm.replace('_', ' ').toLowerCase()}`, text: assets.length ? `${assets.length} formation(s)` : '' });
  return ok({ grant: gr.id });
}

function sameEmpire(g, a, b) {
  return (g.s.empires || []).some((e) => e.members.some((m) => m.country === a) && e.members.some((m) => m.country === b));
}

function hops(g, a, b, max) {
  if (a === b) return 0;
  const w = g.w;
  const d = new Map([[a, 0]]);
  const q = [a];
  for (let h = 0; h < q.length; h++) {
    const x = q[h];
    if (d.get(x) >= max) continue;
    for (const y of w.neighbors(x)) {
      if (y >= g.P || d.has(y)) continue;
      d.set(y, d.get(x) + 1);
      if (y === b) return d.get(y);
      q.push(y);
    }
  }
  return -1;
}

// Spread formations across provinces (weakest province first) and dig in.
function spread(g, p, forms, provs, then) {
  const s = g.s;
  const load = new Map(provs.map((q) => [q, 0]));
  for (const f of forms) {
    let best = provs[0];
    let bl = Infinity;
    for (const q of provs) {
      const l = load.get(q) + g.w.kmBetween(f.prov, q) / 2000;
      if (l < bl) {
        bl = l;
        best = q;
      }
    }
    load.set(best, load.get(best) + 1);
    if (best === f.prov) {
      f.order = null;
      f.posture = then;
      continue;
    }
    const path = findPath(g, f.owner, f.prov, best);
    if (path && path.length > 1) {
      f.order = { type: 'move', path, idx: 1, target: best, by: p.id, then };
      f.progress = 0;
    }
  }
  void s;
}

function estimateOp(g, forms, objectives) {
  let km = 0;
  for (const q of objectives) {
    let best = Infinity;
    for (const f of forms) best = Math.min(best, g.w.kmBetween(f.prov, q));
    km += best;
  }
  const speed = Math.min(...forms.map((f) => g.speed(f)));
  return Math.max(1, Math.round(km / Math.max(100, speed * 0.6)) + objectives.length);
}

export { fillCommand, computeArea, moveFormation };
