import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, connect, run } from './harness.js';
import { FACTION, LIFE, STANCE } from '../src/shared/constants.js';
import { eyeHeight } from '../src/shared/physics.js';
import { yawFromDir } from '../src/shared/math.js';

// Deploy a player at an open spot and place a hostile NPC in front of them.
async function duel(id, dist = 20) {
  const ctx = await makeGame();
  const { game } = ctx;
  const { conn, session } = await connect(game, id);
  conn.deliver({ t: 'training', a: 'skip' });
  run(game, 0.1);
  conn.deliver({ t: 'deploy', spawn: 'hq', role: 'rifleman' });
  run(game, 0.1);
  const s = session.soldier;
  // open field east of the base
  const x = -300;
  const z = 700;
  s.x = x;
  s.z = z;
  s.y = game.world.colliders.groundHeight(x, z, 400);
  s.yaw = yawFromDir(1, 0); // facing +x
  s.invulnerableUntil = 0;
  const enemy = game.npc.spawnSoldier(FACTION.DOMINION, x + dist, z, { kit: 'rifleman' });
  enemy.npc.nextThink = 1e9; // keep it passive
  enemy.armor = 0;
  run(game, 0.1);
  return { ...ctx, conn, session, s, enemy };
}

function shoot(conn, s, target, extra = {}) {
  const eye = { x: s.x, y: s.y + eyeHeight(s.stance), z: s.z };
  const ty = target.y + (extra.head ? 1.6 : 1.2);
  const d = [target.x - eye.x, ty - eye.y, target.z - eye.z];
  const l = Math.hypot(...d);
  s.pitch = Math.asin(d[1] / l);
  s.yaw = yawFromDir(d[0], d[2]);
  conn.deliver({ t: 'fire', slot: s.slot, o: [eye.x, eye.y, eye.z], d: d.map((v) => v / l), seq: Math.floor(Math.random() * 1e6) });
}

test('server-authoritative hitscan damages a hostile in the line of fire', async () => {
  const { game, conn, s, enemy } = await duel('cb_1');
  const hp = enemy.health;
  shoot(conn, s, enemy);
  run(game, 0.05);
  assert.ok(enemy.health < hp, 'enemy took damage');
  assert.ok(conn.events().some((e) => e[0] === 'hit' && e[1] === enemy.id), 'hitmarker sent to shooter');
  assert.equal(s.weapons[0].mag, 29, 'ammo is tracked on the server');
});

test('rate of fire and empty magazines are enforced', async () => {
  const { game, conn, s, enemy } = await duel('cb_2');
  const mag = s.weapons[0].mag;
  for (let i = 0; i < 20; i++) shoot(conn, s, enemy); // 20 shots in one instant
  run(game, 0.05);
  const fired = mag - s.weapons[0].mag;
  assert.ok(fired <= 4, `burst of impossible shots was rejected (fired ${fired})`);
  s.weapons[0].mag = 0;
  const hp = enemy.health;
  run(game, 1);
  shoot(conn, s, enemy);
  run(game, 0.05);
  assert.equal(enemy.health, hp, 'no damage with an empty magazine');
});

test('shots from an impossible origin are rejected', async () => {
  const { game, conn, s, enemy } = await duel('cb_3');
  const hp = enemy.health;
  const d = [1, 0, 0];
  conn.deliver({ t: 'fire', slot: 0, o: [enemy.x - 2, enemy.y + 1.2, enemy.z], d, seq: 1 });
  run(game, 0.05);
  assert.equal(enemy.health, hp);
  assert.ok(game.byProfile.get('cb_3_player').violations > 0);
});

test('armor absorbs part of the damage', async () => {
  const { game, conn, s, enemy } = await duel('cb_4');
  enemy.armor = 50;
  shoot(conn, s, enemy);
  run(game, 0.05);
  assert.ok(enemy.armor < 50, 'armor was reduced');
  assert.ok(100 - enemy.health < 25, 'health loss reduced by armor');
});

test('players are downed, bleed out, and can be revived by a medic', async () => {
  const { game } = await makeGame();
  const a = await connect(game, 'cb_med');
  const b = await connect(game, 'cb_victim');
  for (const p of [a, b]) {
    p.conn.deliver({ t: 'training', a: 'skip' });
  }
  run(game, 0.1);
  a.session.profile.rank = 3;
  a.conn.deliver({ t: 'deploy', spawn: 'hq', role: 'medic' });
  b.conn.deliver({ t: 'deploy', spawn: 'hq', role: 'rifleman' });
  run(game, 0.1);
  const victim = b.session.soldier;
  const medic = a.session.soldier;
  assert.equal(medic.role, 'medic');
  medic.x = victim.x + 1;
  medic.z = victim.z;
  medic.y = victim.y;
  victim.invulnerableUntil = 0;
  victim.armor = 0;
  game.combat.applyDamage(victim, 120, null, {});
  assert.equal(victim.life, LIFE.DOWNED);
  assert.equal(victim.stance, STANCE.PRONE);
  a.conn.deliver({ t: 'act', a: 'start', type: 'revive', target: victim.id });
  run(game, 3.0);
  assert.equal(victim.life, LIFE.ALIVE, 'revived');
  assert.equal(a.session.profile.stats.revives, 1);
  assert.equal(b.session.profile.stats.revived, 1);
  // massive explosive damage kills outright (no downed state)
  victim.invulnerableUntil = 0;
  game.combat.applyDamage(victim, 200, null, { explosive: true });
  assert.equal(victim.life, LIFE.DEAD, 'massive explosive damage kills outright');
  assert.equal(b.session.profile.stats.deaths, 1);
});

test('headshots can kill outright; kill XP favours objectives', async () => {
  const { game, conn, session, s, enemy } = await duel('cb_5', 12);
  enemy.health = 30;
  const xp = session.profile.xp;
  shoot(conn, s, enemy, { head: true });
  run(game, 0.05);
  assert.equal(enemy.life, LIFE.DEAD);
  assert.equal(session.profile.stats.kills, 1);
  const gained = session.profile.xp - xp;
  assert.ok(gained > 0 && gained < 40, `kill xp is modest (${gained})`);
});

test('explosions respect cover and never hurt friendly soldiers', async () => {
  const { game, s } = await duel('cb_6');
  const friend = game.npc.spawnSoldier(FACTION.COALITION, s.x + 3, s.z, { kit: 'rifleman' });
  friend.npc.nextThink = 1e9;
  const foe = game.npc.spawnSoldier(FACTION.DOMINION, s.x - 3, s.z, { kit: 'rifleman' });
  foe.npc.nextThink = 1e9;
  foe.armor = 0;
  game.combat.explode(s.x, s.y + 0.5, s.z, { radius: 7, damage: 100, ownerId: s.id, faction: FACTION.COALITION, weaponId: 'frag' });
  assert.equal(friend.health, 100);
  assert.ok(foe.health < 100 || foe.life !== LIFE.ALIVE);
});
