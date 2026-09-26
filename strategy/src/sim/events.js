// Dynamic world events. Each has a cheap trigger check and real effects on the simulation.
import { clamp } from './util.js';
import { declareWar, warsOf, joinWar, sideOf } from './diplomacy.js';
import { newFormation } from './formations.js';
import { PERSONALITIES } from '../../config/scenario.js';

function record(g, e) {
  const s = g.s;
  const ev = { id: s.nextId.e++, turn: s.turn, ...e };
  s.events.push(ev);
  if (s.events.length > 120) s.events.shift();
  s.turnLog.events.push(ev);
  return ev;
}

export function eventsTurn(g) {
  const s = g.s;
  const C = g.C;
  const r = g.rng;
  const w = g.w;
  // ---- world events
  if (r.chance(0.008)) {
    for (const nat of s.countries) nat.stock.fuel *= 0.7;
    s.tension = clamp(s.tension + 3, 0, 100);
    const ev = record(g, { kind: 'world', title: 'Global oil shock', text: 'Fuel reserves worldwide fall by 30%.' });
    g.notify('all', { kind: 'event', title: ev.title, text: ev.text, important: true });
  }
  if (r.chance(0.004)) {
    s.solarStorm = s.turn + 3;
    const ev = record(g, { kind: 'world', title: 'Solar storm', text: 'Satellites are blinded for three weeks. Long-range intelligence is degraded.' });
    g.notify('all', { kind: 'event', title: ev.title, text: ev.text });
  }
  // World War cascade: when tension peaks, the great blocs are dragged in
  if (s.tension >= 90 && s.wars.length >= 3 && !s.worldWar) {
    s.worldWar = s.turn;
    record(g, { kind: 'world', title: 'WORLD WAR', text: 'The great alliances are at war. Every bloc member is called to arms.' });
    g.notify('all', { kind: 'event', title: 'WORLD WAR', text: 'Tension has boiled over. The great alliances are mobilizing for global war.', important: true, huge: true });
    for (const war of [...s.wars]) {
      for (const side of ['A', 'D']) {
        const members = side === 'A' ? war.attackers : war.defenders;
        for (const m of [...members]) {
          for (let x = 0; x < C; x++) {
            if (s.alliance[m * C + x] && s.countries[x].alive && !g.humanRuns(x) && !war.attackers.includes(x) && !war.defenders.includes(x) && r.chance(0.6)) joinWar(g, x, war, side);
          }
        }
      }
    }
  }
  // ---- country events (each country checked every ~6 turns)
  for (let c = 0; c < C; c++) {
    const nat = s.countries[c];
    if (!nat.alive || (s.turn + c) % 6 !== 0) continue;
    const name = g.countryName(c);
    // border incident with a rival neighbour
    if (r.chance(0.12)) {
      for (let x = 0; x < C; x++) {
        if (x === c || g.atWar(c, x) || s.rel[c * C + x] > -40 || !s.countries[x].alive) continue;
        if (!sharesBorder(g, c, x)) continue;
        s.rel[c * C + x] = clamp(s.rel[c * C + x] - 12, -100, 100);
        s.rel[x * C + c] = clamp(s.rel[x * C + c] - 12, -100, 100);
        s.claims[c * C + x] = 1;
        s.claims[x * C + c] = 1;
        s.tension = clamp(s.tension + 2, 0, 100);
        const ev = record(g, { kind: 'incident', title: `Border incident: ${name} and ${g.countryName(x)}`, text: 'Shots were exchanged across the border. Both sides now claim the incident as a cause for war.', countries: [c, x] });
        g.notify([c, x], { kind: 'event', title: ev.title, text: ev.text, important: true });
        break;
      }
    }
    // coup in an unstable state
    if (nat.stability < 30 && r.chance(0.18)) {
      const aggressive = ['expansionist', 'revanchist', 'unstable', 'opportunist'];
      nat.personality = r.pick(aggressive);
      nat.stability = clamp(nat.stability + 12, 0, 100);
      nat.mob = Math.max(nat.mob, 1);
      const ev = record(g, { kind: 'coup', title: `Coup in ${name}`, text: `A military junta seized power. ${name} is now ${PERSONALITIES[nat.personality].name.toLowerCase()}.`, countries: [c] });
      g.notify('all', { kind: 'event', title: ev.title, text: ev.text, countries: [c] });
    }
    // economic crisis
    if (r.chance(0.025)) {
      const loss = Math.max(1, nat.treasury * 0.25);
      nat.treasury -= loss;
      nat.stability = clamp(nat.stability - 6, 0, 100);
      const ev = record(g, { kind: 'economy', title: `Economic crisis in ${name}`, text: `Markets crash. ${loss.toFixed(1)} bn lost and stability falls.`, countries: [c] });
      g.notify(c, { kind: 'event', title: ev.title, text: ev.text });
    }
    // natural disaster
    if (r.chance(0.03)) {
      const provs = w.provincesOf[c];
      const p = provs[r.int(provs.length)];
      const lat = Math.abs(w.provinces.lat[p]);
      const kind = w.provinces.coastal[p] && lat < 30 ? 'Typhoon' : lat > 30 && w.provinces.terrain[p] >= 3 ? 'Earthquake' : 'Flood';
      s.prov.damage[p] = Math.min(200, s.prov.damage[p] + 80);
      s.prov.infra[p] = Math.max(0, s.prov.infra[p] - 1);
      s.prov.stab[p] = Math.max(0, s.prov.stab[p] - 15);
      const ev = record(g, { kind: 'disaster', title: `${kind} strikes ${w.provinces.name[p]}`, text: 'Infrastructure is damaged and output falls while it recovers.', prov: p, countries: [c] });
      g.notify(c, { kind: 'event', title: ev.title, text: ev.text, prov: p });
    }
    // technology breakthrough
    if (nat.tech < 5 && r.chance(0.01 + nat.tech * 0.002)) {
      nat.tech++;
      const ev = record(g, { kind: 'tech', title: `${name} fields next-generation equipment`, text: `Military technology rises to level ${nat.tech}.`, countries: [c] });
      g.notify(c, { kind: 'event', title: ev.title, text: ev.text });
    }
    // volunteers flood recruiting offices during a defensive war
    if (warsOf(g, c).some((war) => sideOf(war, c) === 'D') && r.chance(0.3)) {
      const men = Math.round(w.countries[c].pop * 0.001);
      nat.manpower += men;
      record(g, { kind: 'war', title: `Volunteers rally in ${name}`, text: `${Math.round(men / 1000)}k volunteers join the defense.`, countries: [c] });
    }
  }
  // ---- uprisings in occupied land
  for (let p = 0; p < g.P; p++) {
    const o = s.prov.owner[p];
    const c = s.prov.ctrl[p];
    if (o === c || !s.countries[o].alive || !g.atWar(o, c)) continue;
    if (s.prov.stab[p] > 20 || g.byProv[p].some((id) => s.formations.get(id)?.owner === c)) continue;
    if (!r.chance(0.08)) continue;
    s.prov.ctrl[p] = o;
    newFormation(g, { owner: o, prov: p, comp: { inf: 4 }, name: `${w.provinces.name[p]} Partisans`, exp: 0.1, str: 0.7, org: 0.6 });
    const ev = record(g, { kind: 'uprising', title: `Uprising in ${w.provinces.name[p]}`, text: `Partisans drove out the ${g.countryName(c)} occupiers.`, prov: p, countries: [o, c] });
    g.notify([o, c], { kind: 'event', title: ev.title, text: ev.text, prov: p });
  }
  void declareWar;
}

function sharesBorder(g, a, b) {
  const s = g.s;
  const w = g.w;
  for (const p of w.provincesOf[a]) {
    if (s.prov.ctrl[p] !== a) continue;
    for (let k = w.adjStart[p]; k < w.adjStart[p + 1]; k++) {
      const q = w.adjTo[k];
      if (q < g.P && s.prov.ctrl[q] === b) return true;
    }
  }
  return false;
}
