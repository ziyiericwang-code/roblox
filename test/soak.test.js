// Multi-minute soak: bot players fight alongside the AI in a full war.
// Checks for exceptions, NaN positions, entity leaks and tick cost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, connect } from './harness.js';
import { stepCharacter, eyeHeight } from '../src/shared/physics.js';
import { LIFE, FACTION, STANCE } from '../src/shared/constants.js';
import { yawFromDir } from '../src/shared/math.js';
import { WEAPONS } from '../src/shared/config/weapons.js';

const ROLES = ['rifleman', 'medic', 'engineer', 'support', 'scout', 'rifleman'];

test('five simulated minutes of war with bot players stay healthy', { timeout: 300000 }, async () => {
  const { game, log } = await makeGame({ options: { solo: false } });
  const bots = [];
  for (let i = 0; i < 6; i++) {
    const { conn, session } = await connect(game, `soak_bot_${i}`, `Bot ${i}`);
    conn.deliver({ t: 'training', a: 'skip' });
    bots.push({ conn, session, seq: 1, me: null, fireAt: 0, role: ROLES[i] });
  }
  // a front-line battle so there is fighting
  game.war.startBattle('capital', FACTION.COALITION);
  const dt = 0.05;
  let maxSoldiers = 0;
  let maxTickMs = 0;
  const t0 = Date.now();
  const target = game.war.get('capital').sectors[0].def;
  for (let tick = 0; tick < 5 * 60 * 20; tick++) {
    for (const b of bots) {
      const s = b.session.soldier;
      if (!s || s.life === LIFE.DEAD) {
        b.me = null;
        if (tick % 20 === 0) b.conn.deliver({ t: 'deploy', spawn: tick % 40 === 0 ? 't:iron_valley' : 'hq', role: b.role });
        continue;
      }
      if (s.life === LIFE.DOWNED) {
        if (tick % 200 === 0) b.conn.deliver({ t: 'return' });
        continue;
      }
      if (!b.me || b.me.id !== s.id) b.me = { id: s.id, x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, yaw: s.yaw, stance: STANCE.STAND, grounded: true };
      const me = b.me;
      // head for the objective, strafing a bit
      me.yaw = yawFromDir(target.x - me.x, target.z - me.z);
      stepCharacter(me, { fwd: 1, right: Math.sin(tick * 0.01 + bots.indexOf(b)) * 0.5, sprint: tick % 400 < 250, jump: false }, dt, game.world.colliders);
      b.conn.deliver({ t: 'in', s: b.seq++, p: [me.x, me.y, me.z], v: [me.vx, me.vy, me.vz], y: me.yaw, pi: 0, st: me.stance, sp: 1, g: me.grounded ? 1 : 0, mv: 1 });
      // shoot at the nearest visible enemy
      const wdef = WEAPONS[s.weapons[s.slot].id];
      if (game.time >= b.fireAt) {
        b.fireAt = game.time + Math.max(0.12, (60 / (wdef.rpm || 300)) * 1.05);
        const foes = game.soldiersNear(s.x, s.z, 80, (e) => e.faction === FACTION.DOMINION && e.life === LIFE.ALIVE);
        const eye = { x: s.x, y: s.y + eyeHeight(s.stance), z: s.z };
        const foe = foes.find((e) => game.world.colliders.lineOfSight(eye.x, eye.y, eye.z, e.x, e.y + 1.2, e.z));
        const w = s.weapons[s.slot];
        if (w && w.mag === 0) b.conn.deliver({ t: 'reload' });
        else if (foe) {
          const d = [foe.x - eye.x, foe.y + 1.2 - eye.y, foe.z - eye.z];
          const l = Math.hypot(...d);
          b.conn.deliver({ t: 'fire', slot: s.slot, o: [eye.x, eye.y, eye.z], d: d.map((v) => v / l), y: yawFromDir(d[0], d[2]), pi: Math.asin(d[1] / l), seq: tick });
        }
      }
    }
    const a = performance.now();
    game.step(dt);
    maxTickMs = Math.max(maxTickMs, performance.now() - a);
    maxSoldiers = Math.max(maxSoldiers, game.soldiers.size);
    if (tick % 200 === 0) {
      for (const e of [...game.soldiers, ...game.vehicles, ...game.projectiles]) {
        assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.z), `entity ${e.id} has a finite position`);
      }
    }
  }
  const wall = (Date.now() - t0) / 1000;
  const shots = bots.reduce((n, b) => n + b.session.profile.stats.shots, 0);
  const xp = bots.reduce((n, b) => n + b.session.profile.xp, 0);
  console.log(`soak: ${wall.toFixed(1)}s wall, avg tick ${game.tickMsAvg.toFixed(2)} ms, max tick ${maxTickMs.toFixed(1)} ms, max soldiers ${maxSoldiers}, shots ${shots}, xp ${xp}, missions ${game.missions.missions.size}, props ${game.props.size}`);
  assert.deepEqual(log.errors, [], 'no errors logged');
  assert.ok(game.tickMsAvg < 25, `tick budget (${game.tickMsAvg.toFixed(2)} ms)`);
  assert.ok(game.soldiers.size <= game.npcCap + 60, 'soldier count bounded');
  assert.ok(game.props.size < 400, `props bounded (${game.props.size})`);
  assert.ok(game.projectiles.size < 100);
  assert.ok(shots > 0, 'bots fought');
  assert.ok(xp > 0, 'bots earned XP');
  for (const b of bots) assert.equal(b.session.violations < 5, true, `bot ${b.session.id} violations ${b.session.violations}`);
});
