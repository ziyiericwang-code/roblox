// Headless run: create a campaign and resolve turns, printing what happens.
import { loadWorld, countryId } from '../test/helpers.js';
import { Game } from '../src/sim/Game.js';

const turns = Number(process.argv[2] || 20);
const scenario = process.argv[3] || 'cold';
const w = loadWorld();
let t0 = Date.now();
const g = Game.create(w, { seed: 42, scenario });
console.log('setup', Date.now() - t0, 'ms; formations', g.s.formations.size, 'wars', g.s.wars.length);
const me = g.addPlayer('p1', { name: 'Tester', country: countryId(w, 'POL'), rank: 0 });
for (let i = 0; i < turns; i++) {
  const ms = g.endTurn();
  const s = g.s;
  const lt = s.lastTurn;
  if (i % 5 === 4 || i === turns - 1) console.log(`turn ${s.turn} ${g.dateLabel()} ${ms}ms wars=${s.wars.length} battles=${s.battles.size} caps=${lt.captures.length} forms=${s.formations.size} tension=${s.tension.toFixed(0)} timing=${JSON.stringify(lt.timing)}`);
}
for (const war of g.s.wars) console.log(' war', war.name, 'score', war.score, 'attackers', war.attackers.map((c) => g.countryName(c)).join('/'), 'vs', war.defenders.map((c) => g.countryName(c)).join('/'));
const v = g.view('p1');
console.log('view formations', v.formations.length, 'size', JSON.stringify(v).length, 'bytes; me', v.me.rankTitle, 'xp', v.me.xp, '/', v.me.xpNext, 'directives', v.me.directives.map((d) => d.title));
t0 = Date.now();
const saved = g.save();
const txt = JSON.stringify(saved);
const g2 = Game.load(w, JSON.parse(txt));
console.log('save', txt.length, 'bytes, roundtrip', Date.now() - t0, 'ms, formations', g2.s.formations.size);
console.log('events', g.s.events.slice(-8).map((e) => e.title));
void me;
