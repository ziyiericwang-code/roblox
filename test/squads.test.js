import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, connect, run } from './harness.js';
import { RANK } from '../src/shared/config/ranks.js';
import { SCOPE } from '../src/shared/config/ranks.js';
import { FACTION } from '../src/shared/constants.js';

async function trooper(game, id, rank = RANK.PRIVATE, deploy = true) {
  const p = await connect(game, id, id.slice(0, 12));
  p.conn.deliver({ t: 'training', a: 'skip' });
  run(game, 0.05);
  p.session.profile.rank = rank;
  if (deploy) {
    p.conn.deliver({ t: 'deploy', spawn: 'hq', role: 'rifleman' });
    run(game, 0.1);
  }
  return p;
}

const notices = (conn) => conn.events().filter((e) => e[0] === 'notice').map((e) => e[2]).join(' | ');

test('only Corporals and above can form squads; size follows the leader rank', async () => {
  const { game } = await makeGame({ options: { npcCap: 0 } });
  const pvt = await trooper(game, 'sq_private', RANK.PRIVATE, false);
  pvt.conn.deliver({ t: 'squad', a: 'create' });
  run(game, 0.05);
  assert.equal(pvt.session.squadId, 0);
  assert.match(notices(pvt.conn), /Corporal/);

  const cpl = await trooper(game, 'sq_corporal', RANK.CORPORAL, false);
  cpl.conn.deliver({ t: 'squad', a: 'create' });
  run(game, 0.05);
  const sq = game.squads.get(cpl.session.squadId);
  assert.ok(sq, 'squad created');
  assert.equal(sq.leader, cpl.session.id);
  const joiners = [];
  for (let i = 0; i < 5; i++) {
    const m = await trooper(game, `sq_member_${i}`, RANK.PRIVATE, false);
    m.conn.deliver({ t: 'squad', a: 'join', id: sq.id });
    joiners.push(m);
  }
  run(game, 0.05);
  assert.equal(sq.members.length, 4, 'a Corporal leads a fireteam of four');
  // leader leaves: leadership passes on (or the squad dissolves if nobody qualifies)
  cpl.conn.deliver({ t: 'squad', a: 'leave' });
  run(game, 0.05);
  assert.ok(!sq.members.includes(cpl.session.id));
});

test('locked squads need an invite', async () => {
  const { game } = await makeGame({ options: { npcCap: 0 } });
  const sgt = await trooper(game, 'sq_sergeant', RANK.SERGEANT, false);
  sgt.conn.deliver({ t: 'squad', a: 'create', locked: true });
  run(game, 0.05);
  const sq = game.squads.get(sgt.session.squadId);
  const pvt = await trooper(game, 'sq_invitee', RANK.PRIVATE, false);
  pvt.conn.deliver({ t: 'squad', a: 'join', id: sq.id });
  run(game, 0.05);
  assert.equal(pvt.session.squadId, 0, 'invite only');
  sgt.conn.deliver({ t: 'squad', a: 'invite', player: pvt.session.id });
  run(game, 0.05);
  pvt.conn.deliver({ t: 'squad', a: 'join', id: sq.id });
  run(game, 0.05);
  assert.equal(pvt.session.squadId, sq.id);
});

test('orders need rank, are clamped to the rank scope and rate limited', async () => {
  const { game } = await makeGame({ options: { npcCap: 0 } });
  const pvt = await trooper(game, 'ord_private');
  pvt.conn.deliver({ t: 'order', order: 'move', x: -400, z: 600, scope: SCOPE.THEATER });
  run(game, 0.05);
  assert.equal(pvt.session.profile.stats.ordersIssued, 0);

  const cpl = await trooper(game, 'ord_corporal', RANK.CORPORAL);
  cpl.conn.deliver({ t: 'squad', a: 'create' });
  run(game, 0.05);
  const sq = game.squads.get(cpl.session.squadId);
  const member = await trooper(game, 'ord_member');
  member.conn.deliver({ t: 'squad', a: 'join', id: sq.id });
  run(game, 0.05);
  const s = cpl.session.soldier;
  cpl.conn.deliver({ t: 'order', order: 'move', x: s.x + 30, z: s.z, scope: SCOPE.THEATER });
  run(game, 0.05);
  assert.ok(sq.order, 'squad received the order');
  assert.equal(sq.order.scope, SCOPE.SQUAD, 'a Corporal can only command their squad');
  assert.ok(member.conn.events().some((e) => e[0] === 'order' && e[1] === 'move'));
  const issued = cpl.session.profile.stats.ordersIssued;
  cpl.conn.deliver({ t: 'order', order: 'attack', x: s.x + 40, z: s.z });
  run(game, 0.05);
  assert.equal(cpl.session.profile.stats.ordersIssued, issued, 'order cooldown');
});

test('following orders earns XP for the soldier and leadership for the issuer', async () => {
  const { game } = await makeGame({ options: { npcCap: 0 } });
  const sgt = await trooper(game, 'cmp_sergeant', RANK.SERGEANT);
  sgt.conn.deliver({ t: 'squad', a: 'create' });
  run(game, 0.05);
  const sq = game.squads.get(sgt.session.squadId);
  const m = await trooper(game, 'cmp_member');
  m.conn.deliver({ t: 'squad', a: 'join', id: sq.id });
  run(game, 0.05);
  const target = { x: m.session.soldier.x + 5, z: m.session.soldier.z };
  sgt.conn.deliver({ t: 'order', order: 'defend', x: target.x, z: target.z });
  const lead = sgt.session.profile.stats.leadership;
  run(game, 41);
  assert.ok(m.session.profile.stats.ordersFollowed >= 1);
  assert.ok(sgt.session.profile.stats.leadership > lead, 'issuer gains leadership');
});

test('officer abilities check rank, command points and cooldowns', async () => {
  const { game } = await makeGame({ options: { npcCap: 0 } });
  const ssg = await trooper(game, 'ab_staffsgt', RANK.STAFF_SERGEANT);
  const s = ssg.session.soldier;
  // artillery is far above a Staff Sergeant
  assert.equal(game.commands.useAbility(ssg.session, 'artillery', { x: s.x + 100, z: s.z }), false);
  run(game, 0.05);
  assert.match(notices(ssg.conn), /requires the rank of Major/);
  game.war.cp[FACTION.COALITION] = 3;
  assert.equal(game.commands.useAbility(ssg.session, 'ammo_drop', { x: s.x + 10, z: s.z }), false, 'not enough CP');
  game.war.cp[FACTION.COALITION] = 50;
  assert.equal(game.commands.useAbility(ssg.session, 'ammo_drop', { x: s.x + 10, z: s.z }), true);
  assert.equal(game.war.cp[FACTION.COALITION], 46, 'CP spent');
  assert.equal(game.commands.useAbility(ssg.session, 'ammo_drop', { x: s.x + 10, z: s.z }), false, 'cooldown');
  assert.equal(game.commands.useAbility(ssg.session, 'ammo_drop', { x: s.x + 900, z: s.z }), false, 'range');
  run(game, 5);
  assert.ok([...game.props].some((p) => p.data && p.data.resupply), 'crate dropped');
});

test('a Major can set the strategic priority and generals launch offensives on the front only', async () => {
  const { game } = await makeGame({ options: { npcCap: 0 } });
  const maj = await trooper(game, 'ab_major', RANK.MAJOR);
  game.war.cp[FACTION.COALITION] = 200;
  assert.equal(game.commands.useAbility(maj.session, 'priority', { territory: 'capital' }), true);
  assert.equal(game.war.priority[FACTION.COALITION].territory, 'capital');
  const gen = await trooper(game, 'ab_general', RANK.GENERAL);
  assert.equal(game.commands.useAbility(gen.session, 'offensive', { territory: 'northland' }), false, 'not a front territory');
  assert.equal(game.commands.useAbility(gen.session, 'offensive', { territory: 'capital' }), true);
  assert.ok([...game.war.battles.values()].some((b) => b.territory === 'capital'));
});
