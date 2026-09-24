import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, connect, run } from './harness.js';
import { stepCharacter } from '../src/shared/physics.js';
import { STANCE } from '../src/shared/constants.js';

async function deployed(id) {
  const ctx = await makeGame({ options: { npcCap: 0 } });
  const { conn, session } = await connect(ctx.game, id);
  conn.deliver({ t: 'training', a: 'skip' });
  run(ctx.game, 0.05);
  conn.deliver({ t: 'deploy', spawn: 'hq', role: 'rifleman' });
  run(ctx.game, 0.1);
  return { ...ctx, conn, session, s: session.soldier };
}

// Drive a client-side copy of the soldier with the shared physics (exactly what
// the browser does) and stream the resulting positions to the server.
function drive(game, conn, start, seconds, plan) {
  const me = { x: start.x, y: start.y, z: start.z, vx: 0, vy: 0, vz: 0, yaw: start.yaw, stance: STANCE.STAND, grounded: true };
  let seq = 1;
  const dt = 0.05;
  for (let i = 0; i < seconds / dt; i++) {
    const inp = plan(i * dt, me);
    me.yaw = inp.yaw ?? me.yaw;
    stepCharacter(me, inp, dt, game.world.colliders);
    conn.deliver({ t: 'in', s: seq++, p: [me.x, me.y, me.z], v: [me.vx, me.vy, me.vz], y: me.yaw, pi: 0, st: me.stance, sp: inp.sprint ? 1 : 0, g: me.grounded ? 1 : 0, mv: 1 });
    game.step(dt);
  }
  return me;
}

test('honest movement produced by the shared physics is never corrected', async () => {
  const { game, conn, session, s } = await deployed('mv_honest');
  const start = { x: s.x, y: s.y, z: s.z, yaw: s.yaw };
  // sprint around the base (buildings, fences, slopes), jumping now and then
  const me = drive(game, conn, start, 20, (t) => ({ fwd: 1, right: Math.sin(t * 0.7) * 0.4, sprint: true, jump: Math.floor(t * 10) % 37 === 0, yaw: start.yaw + Math.sin(t * 0.3) * 2.5 }));
  assert.equal(conn.of('correct').length, 0, 'no corrections');
  assert.ok(session.violations < 0.5, `violations ${session.violations}`);
  assert.ok(Math.hypot(me.x - start.x, me.z - start.z) > 10, 'actually moved');
  assert.ok(Math.abs(s.x - me.x) < 0.01 && Math.abs(s.z - me.z) < 0.01, 'server accepted the positions');
});

test('teleporting and speed hacks are rejected and corrected', async () => {
  const { game, conn, session, s } = await deployed('mv_teleport');
  const x0 = s.x;
  const z0 = s.z;
  conn.deliver({ t: 'in', s: 1, p: [s.x + 60, s.y, s.z], v: [0, 0, 0], y: 0, pi: 0, st: 0, g: 1 });
  game.step(0.05);
  assert.equal(s.x, x0);
  assert.equal(conn.of('correct').length, 1);
  // sustained 3x sprint speed
  let seq = 2;
  for (let i = 0; i < 40; i++) {
    const p = [s.x + 1.2, game.world.colliders.groundHeight(s.x + 1.2, s.z, s.y + 1), s.z];
    conn.deliver({ t: 'in', s: seq++, p, v: [24, 0, 0], y: 0, pi: 0, st: 0, sp: 1, g: 1 });
    game.step(0.05);
  }
  const moved = s.x - x0;
  assert.ok(moved < 2 * 20 * 0.05 * 7.5 * 1.4, `speed capped (moved ${moved.toFixed(1)} m in 2 s)`);
  assert.ok(session.violations > 0);
  void z0;
});

test('walking through walls and flying are rejected', async () => {
  const { game, conn, s } = await deployed('mv_noclip');
  const col = game.world.colliders;
  // nearest tall solid box (a building wall)
  let best = null;
  for (const b of col.ref) {
    if (b.y1 - b.y0 < 3 || b.x1 - b.x0 < 1.5 || b.z1 - b.z0 < 1.5) continue;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const d = Math.hypot(cx - s.x, cz - s.z);
    if (!best || d < best.d) best = { b, cx, cz, d };
  }
  assert.ok(best, 'found a wall');
  s.x = best.cx + (best.b.x1 - best.b.x0) / 2 + 1.2;
  s.z = best.cz;
  s.y = col.groundHeight(s.x, s.z, best.b.y0 + 1);
  const y = best.b.y0 + 0.2;
  conn.deliver({ t: 'in', s: 1, p: [best.b.x1 - 0.2, y, best.cz], v: [0, 0, 0], y: 0, pi: 0, st: 0, g: 1 });
  game.step(0.05);
  assert.ok(conn.of('correct').length >= 1, 'moving into a wall is corrected');
  // hovering 8 m above the ground for several seconds
  let seq = 2;
  const x = s.x;
  const z = s.z;
  const gy = col.groundHeight(x, z, s.y + 1);
  for (let i = 0; i < 80; i++) {
    const hy = gy + Math.min(8, i * 0.4);
    conn.deliver({ t: 'in', s: seq++, p: [x, hy, z], v: [0, 0, 0], y: 0, pi: 0, st: 0, g: 0 });
    game.step(0.05);
  }
  assert.ok(s.y - gy < 4, `flying rejected (height ${(s.y - gy).toFixed(1)})`);
});

test('malformed and out-of-order input is ignored safely', async () => {
  const { game, conn, s } = await deployed('mv_garbage');
  const x0 = s.x;
  for (const bad of [
    { t: 'in', s: 'x' },
    { t: 'in', s: 5, p: [NaN, 0, 0], v: [0, 0, 0] },
    { t: 'in', s: 6, p: [1e9, 0, 0], v: [0, 0, 0] },
    { t: 'in', s: 7, p: [s.x, s.y, s.z], v: [1e9, 0, 0] },
    { t: 'fire', slot: 99, o: 'a', d: null },
    { t: 'squad', a: 'join', id: -1 },
    { t: 'order', order: '__proto__', x: 0, z: 0 },
    { t: 'ability', id: { a: 1 } },
    { t: 'deploy', spawn: 12, role: 'god' },
    { t: 'unknown_type' },
    null,
    42,
  ]) conn.deliver(bad);
  game.step(0.05);
  conn.deliver({ t: 'in', s: 10, p: [s.x + 0.2, s.y, s.z], v: [4, 0, 0], y: 0, pi: 0, st: 0, g: 1 });
  conn.deliver({ t: 'in', s: 9, p: [s.x + 0.4, s.y, s.z], v: [4, 0, 0], y: 0, pi: 0, st: 0, g: 1 });
  game.step(0.05);
  assert.ok(Math.abs(s.x - (x0 + 0.2)) < 1e-6, 'stale sequence number ignored');
  assert.equal(game.log.errors?.length ?? 0, 0);
});
