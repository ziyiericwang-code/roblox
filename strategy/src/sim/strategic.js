// Strategic weapons: conventional missile strikes and nuclear arsenals. Launches are queued
// during planning and land at the start of the next turn resolution; missile defence can
// intercept. Nuclear use shatters the world order: tension to maximum, global outrage,
// fallout, and retaliation by nuclear states and their allies.
import { clamp } from './util.js';

// Deliverable strategic strikes in game terms, scaled from public warhead estimates.
export const ARSENALS = { USA: 40, RUS: 40, CHN: 14, FRA: 6, GBR: 6, IND: 5, PAK: 5, ISR: 3, PRK: 3 };
const DEFENCE = { USA: 0.3, ISR: 0.45, RUS: 0.25, CHN: 0.2, FRA: 0.15, GBR: 0.15, JPN: 0.25, KOR: 0.2, DEU: 0.12, POL: 0.12, SAU: 0.15, IND: 0.12 };
export const MISSILE_CP = 3;

export function initStrategic(g) {
  const s = g.s;
  s.nukes = s.nukes || Array.from({ length: g.C }, (_, c) => ARSENALS[g.w.countries[c].iso3] || 0);
  s.strikeQueue = s.strikeQueue || [];
  s.strikeLog = s.strikeLog || [];
  s.fallout = s.fallout || {};
}

// Six-character authentication code for a launch this turn (shown only to that commander).
export function launchCode(g, p) {
  let h = 2166136261 ^ (g.s.seed || 1);
  for (const ch of `${p.id}:${p.country}:${g.s.turn}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += i % 2 ? String((h >>> (i * 4)) % 10) : A[(h >>> (i * 5)) % A.length];
  }
  return `${out.slice(0, 3)}-${out.slice(3)}`;
}

function launchSite(g, c, target) {
  // the controlled province of c closest to the target (missile fields, subs, bombers abstracted)
  let best = g.s.countries[c].capital;
  let bd = Infinity;
  for (const p of g.w.provincesOf[c]) {
    if (g.s.prov.ctrl[p] !== c) continue;
    const d = g.w.kmBetween(p, target);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

export function queueStrike(g, c, target, kind, by) {
  initStrategic(g);
  const s = g.s;
  if (kind === 'nuke') {
    if (s.nukes[c] <= 0) return 'No strategic weapons left';
    s.nukes[c]--;
  }
  s.strikeQueue.push({ from: c, site: launchSite(g, c, target), target, kind, by, queued: s.turn });
  return null;
}

// Resolved once per turn, before movement.
export function strategicTurn(g) {
  initStrategic(g);
  const s = g.s;
  aiNuclearDoctrine(g);
  const queue = s.strikeQueue;
  s.strikeQueue = [];
  for (const st of queue) land(g, st);
  // fallout attrition and decay
  for (const [k, until] of Object.entries(s.fallout)) {
    const p = Number(k);
    if (until < s.turn) {
      delete s.fallout[k];
      continue;
    }
    for (const f of s.formations.values()) if (f.prov === p) f.str = Math.max(0.05, f.str * 0.96);
    s.prov.stab[p] = Math.max(0, s.prov.stab[p] - 2);
  }
  if (s.strikeLog.length > 60) s.strikeLog.splice(0, s.strikeLog.length - 60);
}

function land(g, st) {
  const s = g.s;
  const w = g.w;
  const p = st.target;
  const victim = s.prov.ctrl[p];
  const iso = w.countries[victim]?.iso3;
  let intercept = (DEFENCE[iso] || 0.02 * (s.countries[victim]?.tech || 1)) + (s.prov.radar[p] ? 0.1 : 0);
  if (st.kind === 'nuke') intercept *= 0.55; // MIRVs and decoys saturate defences
  const intercepted = g.rng.next() < intercept;
  const log = { turn: s.turn, from: st.from, site: st.site, target: p, kind: st.kind, intercepted, victim };
  s.strikeLog.push(log);
  const place = `${w.provinces.name[p]} (${g.countryName(victim)})`;
  if (intercepted) {
    g.notify([st.from, victim], { kind: 'battle', title: `${st.kind === 'nuke' ? 'Nuclear missile' : 'Missile strike'} intercepted over ${place}`, text: `Launched by ${g.countryName(st.from)}.`, prov: p, important: st.kind === 'nuke' });
    if (st.kind === 'nuke') nuclearAftermath(g, st.from, victim, p, true);
    return;
  }
  if (st.kind === 'missile') {
    let hit = 0;
    for (const f of s.formations.values()) {
      if (f.prov !== p || f.owner === st.from || !g.atWar(f.owner, st.from)) continue;
      f.org = Math.max(0, f.org - 0.3);
      f.str = Math.max(0.05, f.str - 0.06);
      hit++;
    }
    s.prov.damage[p] = Math.min(100, s.prov.damage[p] + 15);
    if (s.prov.fort[p] > 0) s.prov.fort[p] = Math.max(0, s.prov.fort[p] - 1);
    g.notify([st.from, victim], { kind: 'battle', title: `Missile strike on ${place}`, text: hit ? `${hit} formation(s) hit: organization shattered.` : 'Infrastructure and defences damaged.', prov: p });
    return;
  }
  // ---- nuclear detonation
  const killed = [];
  for (const f of [...s.formations.values()]) {
    if (f.prov === p) {
      f.str = Math.max(0.03, f.str * 0.12);
      f.org = 0;
      f.morale = Math.max(0.05, f.morale - 0.5);
      killed.push(f.id);
    } else if (w.neighbors(p).includes(f.prov)) {
      f.str = Math.max(0.05, f.str * 0.7);
      f.org = Math.max(0, f.org * 0.5);
    }
  }
  s.prov.damage[p] = 100;
  s.prov.infra[p] = 0;
  s.prov.fort[p] = 0;
  s.prov.civ[p] = Math.floor(s.prov.civ[p] / 3);
  s.prov.mil[p] = Math.floor(s.prov.mil[p] / 3);
  s.prov.stab[p] = 0;
  s.fallout[p] = s.turn + 8;
  const nat = s.countries[victim];
  if (nat) {
    nat.manpower = Math.max(0, nat.manpower - Math.round((w.provinces.pop[p] || 0) * 0.02));
    nat.stability = clamp(nat.stability - 12, 0, 100);
  }
  nuclearAftermath(g, st.from, victim, p, false);
  const ev = { id: s.nextId.e++, turn: s.turn, kind: 'world', title: `NUCLEAR DETONATION: ${w.provinces.name[p]}`, text: `${g.countryName(st.from)} struck ${place}. ${killed.length} formation(s) caught in the blast.` };
  s.events.push(ev);
  if (s.turnLog) s.turnLog.events.push(ev);
  g.notify('all', { kind: 'event', title: ev.title, text: ev.text, prov: p, important: true, huge: true });
}

function nuclearAftermath(g, a, victim, p, intercepted) {
  const s = g.s;
  const C = g.C;
  s.nuclearUsed = s.nuclearUsed ?? s.turn;
  s.tension = intercepted ? Math.min(100, s.tension + 15) : 100;
  // the world recoils from the attacker; its own people waver
  for (let x = 0; x < C; x++) if (x !== a) s.rel[x * C + a] = clamp(s.rel[x * C + a] - (intercepted ? 15 : 40), -100, 100);
  s.countries[a].stability = clamp(s.countries[a].stability - (intercepted ? 3 : 8), 0, 100);
  if (!intercepted && !g.atWar(a, victim)) return;
  // retaliation: the victim (if nuclear and not run by a human) and nuclear allies answer
  const answer = (c, chance) => {
    if (c === a || s.nukes[c] <= 0 || g.humanRuns(c) || !g.atWar(c, a)) return;
    if (g.rng.next() > chance) return;
    const target = retaliationTarget(g, c, a);
    if (target >= 0) queueStrike(g, c, target, 'nuke', 'ai');
  };
  answer(victim, intercepted ? 0.35 : 0.85);
  for (let c = 0; c < C; c++) if (c !== victim && s.nukes[c] > 0 && g.allied(c, victim)) answer(c, intercepted ? 0.1 : 0.4);
  void p;
}

function retaliationTarget(g, c, enemy) {
  // largest enemy army concentration inside the enemy's own or occupied territory, else their capital
  const s = g.s;
  const load = new Map();
  for (const f of s.formations.values()) if (f.owner === enemy && f.prov < g.P) load.set(f.prov, (load.get(f.prov) || 0) + g.elements(f));
  let best = -1;
  let bn = 30;
  for (const [p, n] of load) if (n > bn && s.prov.ctrl[p] === enemy) {
    bn = n;
    best = p;
  }
  return best >= 0 ? best : s.countries[enemy].capital;
}

// AI nuclear doctrine: last resort when the homeland is collapsing.
function aiNuclearDoctrine(g) {
  const s = g.s;
  for (let c = 0; c < g.C; c++) {
    if (s.nukes[c] <= 0 || g.humanRuns(c) || !s.countries[c].alive) continue;
    const home = g.w.provincesOf[c];
    if (!home.length) continue;
    const lost = home.filter((p) => s.prov.ctrl[p] !== c).length / home.length;
    const capitalLost = s.prov.ctrl[s.countries[c].capital] !== c;
    if (lost < 0.35 && !capitalLost) continue;
    if (g.rng.next() > (capitalLost ? 0.3 : 0.12)) continue;
    // strike the biggest enemy force occupying our homeland
    let best = -1;
    let bn = 20;
    const load = new Map();
    for (const f of s.formations.values()) if (f.prov < g.P && g.atWar(f.owner, c) && g.w.provinces.country[f.prov] === c) load.set(f.prov, (load.get(f.prov) || 0) + g.elements(f));
    for (const [p, n] of load) if (n > bn) {
      bn = n;
      best = p;
    }
    if (best >= 0) {
      queueStrike(g, c, best, 'nuke', 'ai');
      g.notify('all', { kind: 'event', title: `${g.countryName(c)} has launched nuclear weapons`, text: 'Its homeland is collapsing. Missiles are in the air.', important: true, huge: true });
    }
  }
}
