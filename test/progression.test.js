import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, connect, run } from './harness.js';
import { RANK, promotionStatus } from '../src/shared/config/ranks.js';

test('recruit is promoted to Private after basic training (or waiver)', async () => {
  const { game } = await makeGame();
  const { conn, session } = await connect(game, 'prog_player_1');
  assert.equal(session.profile.rank, RANK.RECRUIT);
  conn.deliver({ t: 'training', a: 'skip' });
  run(game, 0.1);
  assert.equal(session.profile.rank, RANK.PRIVATE);
  assert.equal(session.profile.trainingSkipped, true);
  assert.equal(session.profile.medals.basic_training, undefined, 'waived training earns no ribbon');
});

test('promotion needs a combination of requirements, not only XP', async () => {
  const { game } = await makeGame();
  const { conn, session } = await connect(game, 'prog_player_2');
  conn.deliver({ t: 'training', a: 'skip' });
  run(game, 0.1);
  // tons of combat XP alone does not make a PFC (needs a mission and service time)
  game.progression.award(session, { xp: 50000, cat: 'combat', reason: 'test', noMult: true });
  assert.equal(session.profile.rank, RANK.PRIVATE);
  const st = promotionStatus(session.profile);
  assert.ok(st.items.some((i) => i.key === 'missions' && !i.met));
  game.progression.addStat(session, 'missions', 1);
  game.progression.addStat(session, 'service', 20);
  assert.ok(session.profile.rank >= RANK.PFC, 'PFC once missions and service are met');
});

test('rewards are idempotent per rewardId (no duplicates after retries)', async () => {
  const { game } = await makeGame();
  const { session } = await connect(game, 'prog_player_3');
  const before = session.profile.xp;
  const a = game.progression.award(session, { xp: 100, credits: 10, rewardId: 'm:test:1', noMult: true });
  const b = game.progression.award(session, { xp: 100, credits: 10, rewardId: 'm:test:1', noMult: true });
  assert.equal(a, 100);
  assert.equal(b, 0);
  assert.equal(session.profile.xp, before + 100);
  assert.equal(session.profile.credits, 10);
});

test('medals are awarded once per tier with their rewards', async () => {
  const { game, } = await makeGame();
  const { conn, session } = await connect(game, 'prog_player_4');
  game.progression.addStat(session, 'revives', 10);
  assert.equal(session.profile.medals.medical, 0);
  const xp = session.profile.xp;
  game.progression.addStat(session, 'revives', 1);
  assert.equal(session.profile.xp, xp, 'no second bronze award');
  game.progression.addStat(session, 'revives', 70);
  assert.equal(session.profile.medals.medical, 1);
  run(game, 0.1);
  assert.ok(conn.events().some((e) => e[0] === 'medal' && e[1] === 'medical'));
});

test('leadership gain is capped per minute', async () => {
  const { game } = await makeGame();
  const { session } = await connect(game, 'prog_player_5');
  for (let i = 0; i < 100; i++) game.progression.grantLeadership(session, 5, null);
  assert.ok(session.profile.stats.leadership <= 30, `got ${session.profile.stats.leadership}`);
});

test('performance rating rewards objective play per minute', async () => {
  const { game } = await makeGame();
  const { session } = await connect(game, 'prog_player_6');
  game.progression.startDeployment(session);
  run(game, 120);
  game.progression.award(session, { xp: 400, cat: 'objective', noMult: true });
  game.progression.endDeployment(session, 'test');
  const objRating = session.profile.rating;
  const { session: s2 } = await connect(game, 'prog_player_7');
  game.progression.startDeployment(s2);
  run(game, 120);
  game.progression.award(s2, { xp: 400, cat: 'combat', noMult: true });
  game.progression.endDeployment(s2, 'test');
  assert.ok(objRating > s2.profile.rating, 'objective XP counts more than kill XP');
});
