// Headless simulation smoke run: boots the world and game, enlists a player,
// deploys them at the front and runs the war for a while, printing what
// happened (wars, battles, forces, NPCs, tick cost, errors).
// Usage: node scripts/sim-smoke.mjs [minutes=3] [country=1]
import { makeGame, connect, run } from '../test/harness.js';
import { FACTION_INFO } from '../src/shared/constants.js';

const minutes = Number(process.argv[2] || 3);
const country = Number(process.argv[3] || 1);
const t0 = Date.now();
const { game, log } = await makeGame();
console.log(`world+game ready in ${Date.now() - t0} ms`);
const { conn, session } = await connect(game, 'smoke_tester', 'Smoke', undefined, country);
conn.deliver({ t: 'training', a: 'skip' });
run(game, 1);
const opts = game.deploySys.options(session);
console.log('deploy options:', opts.map((o) => `${o.id}${o.ok ? '' : `(${o.reason})`}`).join(', '));
const front = opts.find((o) => o.id.startsWith('t:') && o.ok) || opts[0];
conn.deliver({ t: 'deploy', spawn: front.id, role: 'rifleman' });
run(game, 1);
console.log('deployed at', front.name, session.soldier ? `${Math.round(session.soldier.x)},${Math.round(session.soldier.z)}` : 'NO SOLDIER');
const war = game.war;
const report = (label) => {
  const npcs = [...game.soldiers].filter((s) => s.npc && s.npc.kind !== 'ambient').length;
  const staff = [...game.soldiers].filter((s) => s.npc && s.npc.kind === 'ambient').length;
  const battles = [...war.battles.values()].map((b) => `${b.territory}(${FACTION_INFO[b.attacker].short}${b.live ? ',LIVE' : ''})`).join(' ');
  const str = [1, 2, 3].map((f) => `${FACTION_INFO[f].short}:${Math.round(war.countryStrength(f))}/${war.territoriesOf(f).length}t`).join(' ');
  console.log(`[${label}] tick ${game.tickMsAvg.toFixed(2)}ms load ${game.load} | npcs ${npcs} staff ${staff} veh ${game.vehicles.size} | forces ${war.forces.size} ${str} | wars ${war.wars.map((w) => `${w.a}-${w.b}`).join(',')} | battles ${battles}`);
};
report('start');
const steps = Math.round(minutes * 60);
for (let i = 1; i <= steps; i++) {
  // keep the soldier alive and in place: we only watch the world
  if (session.soldier) session.soldier.health = 100;
  run(game, 1);
  if (i % 30 === 0) report(`${Math.round(i / 60 * 10) / 10}m`);
}
console.log('history:', war.history.slice(-8).map((h) => h.text).join(' | '));
console.log('missions:', game.missions.active().filter((m) => m.faction === country).map((m) => m.title).join(' | '));
console.log('events:', game.events.view(country).map((e) => e.title).join(' | '));
console.log('perf systems (ms):', Object.entries(game.perf.systems).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' '));
console.log('errors:', log.errors.length, log.errors.slice(0, 5).join('\n'));
process.exit(0);
