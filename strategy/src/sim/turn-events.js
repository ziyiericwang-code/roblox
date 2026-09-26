// Hooks fired by movement and combat: captures and battle results feed reports,
// notifications, war scores and career progression.
import { award } from './career.js';
import { warBetween, provinceValue } from './diplomacy.js';

export function onCapture(g, p, prev, now, f) {
  const s = g.s;
  s.turnLog.captures.push({ p, from: prev, to: now });
  const war = warBetween(g, prev, now);
  if (war) war.lastCapture = s.turn;
  if (f && f.ctrl) {
    const pl = s.players[f.ctrl];
    if (pl) {
      const v = provinceValue(g, p);
      award(g, pl, Math.round(8 + v * 4), `Captured ${g.w.provinces.name[p]}`);
      pl.stats.captured++;
    }
  }
}

function topFactors(F, positive) {
  return Object.entries(F)
    .map(([k, v]) => [k, v])
    .filter(([, v]) => (positive ? v > 1.02 : v < 0.98))
    .sort((a, b) => (positive ? b[1] - a[1] : a[1] - b[1]))
    .slice(0, 3)
    .map(([k, v]) => [k, Math.round((v - 1) * 100)]);
}

export function onBattleEnd(g, b, winner, { A, D, captured, surrendered }) {
  const s = g.s;
  const atk = b.atkCountry;
  const def = b.defCountry;
  const ca = s.countries[atk];
  const cd = s.countries[def];
  if (winner === 'A') {
    ca.stats.battlesWon++;
    cd.stats.battlesLost++;
  } else {
    cd.stats.battlesWon++;
    ca.stats.battlesLost++;
  }
  const war = warBetween(g, atk, def);
  const size = Math.sqrt((b.lossesA + b.lossesD) / 1000 + 1);
  if (war) {
    const aSide = war.attackers.includes(atk) ? 1 : -1;
    const sign = winner === 'A' ? aSide : -aSide;
    war.battleScore = Math.max(-100, Math.min(100, (war.battleScore || 0) + sign * size * 2));
    war.battles++;
    if (war.attackers.includes(atk)) {
      war.lossesA = (war.lossesA || 0) + b.lossesA;
      war.lossesD = (war.lossesD || 0) + b.lossesD;
    } else {
      war.lossesA = (war.lossesA || 0) + b.lossesD;
      war.lossesD = (war.lossesD || 0) + b.lossesA;
    }
  }
  const win = winner === 'A' ? b.factors.A : b.factors.D;
  const lose = winner === 'A' ? b.factors.D : b.factors.A;
  const key = [];
  const nA = b.startPower ? b.startPower.nA : 0;
  const nD = b.startPower ? b.startPower.nD : 0;
  const ratio = nA / Math.max(1, nD);
  key.push(`Force ratio ${ratio >= 1 ? ratio.toFixed(1) + ' : 1' : '1 : ' + (1 / Math.max(0.01, ratio)).toFixed(1)} (attacker : defender)`);
  for (const [k, v] of topFactors(win, true)) key.push(`${k} +${v}%`);
  for (const [k, v] of topFactors(lose, false)) key.push(`${winner === 'A' ? 'Defender' : 'Attacker'}: ${k} ${v}%`);
  const report = {
    id: s.nextId.r++,
    kind: 'battle',
    turn: s.turn,
    name: b.name,
    prov: b.prov,
    winner,
    result: winner === 'A' ? (captured ? 'Attacker victory — province captured' : 'Attacker victory') : 'Defender held',
    atk: { country: atk, units: A.map((f) => f.name).slice(0, 8), elements: nA },
    def: { country: def, units: D.map((f) => f.name).slice(0, 8), elements: nD },
    lossesA: Math.round(b.lossesA),
    lossesD: Math.round(b.lossesD),
    surrendered: Math.round(surrendered),
    rounds: b.rounds,
    factorsA: Object.entries(b.factors.A).map(([k, v]) => [k, Math.round((v - 1) * 100)]),
    factorsD: Object.entries(b.factors.D).map(([k, v]) => [k, Math.round((v - 1) * 100)]),
    key,
    players: [],
  };
  s.turnLog.battles.push(report);
  // career credit
  const involved = new Map();
  for (const f of A) if (f.ctrl) involved.set(f.ctrl, 'A');
  for (const f of D) if (f.ctrl) involved.set(f.ctrl, 'D');
  for (const [pid, side] of involved) {
    const pl = s.players[pid];
    if (!pl) continue;
    report.players.push(pid);
    pl.stats.battles++;
    const won = side === winner;
    const odds = side === 'A' ? nD / Math.max(1, nA) : nA / Math.max(1, nD);
    const base = 10 + Math.min(40, size * 6);
    if (won) {
      pl.stats.battlesWon++;
      award(g, pl, Math.round(base * (0.8 + Math.min(2, odds))), `Won the ${b.name}`);
    } else award(g, pl, Math.round(base * 0.25), `Fought in the ${b.name}`);
    pl.rating = Math.max(0, Math.min(1, pl.rating * 0.85 + (won ? 0.15 : 0.03)));
  }
  s.reports.push(report);
  if (s.reports.length > 240) s.reports.splice(0, s.reports.length - 240);
  // notify players of both countries (grouped by the client)
  g.notify([atk, def], { kind: 'battle', title: `${report.name}: ${winner === 'A' ? `${g.countryName(atk)} won` : `${g.countryName(def)} held`}`, text: report.key[0], prov: b.prov, report: report.id, important: report.players.length > 0 });
}
