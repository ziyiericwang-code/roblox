import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeGame, connect, run, FakeConn } from './harness.js';
import { MemoryStore } from '../src/sim/MemoryStore.js';
import { FileStore } from '../src/server/FileStore.js';
import { migrateProfile, PROFILE_VERSION } from '../src/sim/profile.js';

test('profiles save on disconnect and load on reconnect', async () => {
  const store = new MemoryStore();
  const { game } = await makeGame({ store });
  const a = await connect(game, 'persist_1', 'Alpha');
  game.progression.award(a.session, { xp: 250, credits: 40, rewardId: 'x:1', noMult: true });
  a.conn.close();
  await new Promise((r) => setTimeout(r, 20));
  const saved = await store.loadProfile('persist_1');
  assert.equal(saved.xp, 250);
  const b = await connect(game, 'persist_1', 'Alpha');
  assert.equal(b.session.profile.xp, 250);
  assert.equal(b.session.profile.credits, 40);
  // the ledger survives too, so the same reward cannot be claimed again
  assert.equal(game.progression.award(b.session, { xp: 250, rewardId: 'x:1', noMult: true }), 0);
});

test('failed saves are retried and nothing is lost', async () => {
  const store = new MemoryStore();
  const { game } = await makeGame({ store });
  const a = await connect(game, 'persist_2');
  game.progression.award(a.session, { xp: 90, noMult: true });
  store.failNext = 2;
  const ok = await game.saveProfile(a.session);
  assert.equal(ok, true, 'third attempt succeeded');
  assert.equal((await store.loadProfile('persist_2')).xp, 90);
  store.failNext = 99;
  const ok2 = await game.saveProfile(a.session);
  assert.equal(ok2, false);
  assert.equal(a.session.saveDirty, true, 'kept dirty for the next autosave');
  assert.equal(a.session.profile.xp, 90, 'in-memory profile untouched');
});

test('a second login kicks the first session (no duplicate live profiles)', async () => {
  const { game } = await makeGame();
  const a = await connect(game, 'persist_3');
  game.progression.award(a.session, { xp: 10, noMult: true });
  const b = await connect(game, 'persist_3');
  assert.ok(a.conn.of('kick').length === 1 || a.conn.closed, 'old session kicked');
  assert.equal(game.byProfile.get('persist_3'), b.session);
  assert.equal(b.session.profile.xp, 10, 'the new session sees the saved progress');
});

test('a wrong identity token is rejected', async () => {
  const { game } = await makeGame();
  const a = await connect(game, 'persist_4', 'Owner', 'correct-token-123456');
  a.conn.close();
  await new Promise((r) => setTimeout(r, 20));
  const conn = new FakeConn();
  const session = game.addConnection(conn);
  conn.deliver({ t: 'hello', id: 'persist_4', token: 'wrong-token-abcdefgh', name: 'Thief' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(session.profile, null);
  assert.match(conn.last('reject').reason, /token/i);
});

test('old profiles migrate without losing data', () => {
  const v1 = { v: 1, id: 'old_player', name: 'Veteran', rank: 7, xp: 12000, stats: { kills: 50, captures: 12, defends: 8 }, unlocks: { camo: ['arctic'] }, medals: { marksman: 1 } };
  const p = migrateProfile(v1, 'old_player', 'Veteran');
  assert.equal(p.v, PROFILE_VERSION);
  assert.equal(p.rank, 7);
  assert.equal(p.xp, 12000);
  assert.equal(p.stats.kills, 50);
  assert.equal(p.stats.objectives, 20);
  assert.equal(p.stats.revives, 0, 'new stats default to zero');
  assert.ok(p.unlocks.camo.includes('arctic') && p.unlocks.camo.includes('woodland'));
  assert.equal(p.medals.marksman, 1);
  assert.equal(migrateProfile(null, 'x_player', 'X').rank, 0);
  assert.equal(migrateProfile('garbage', 'x_player', 'X').rank, 0);
});

test('FileStore writes atomically and recovers from a corrupted file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'frontline-'));
  try {
    const fs1 = new FileStore(dir);
    await fs1.init();
    await fs1.saveProfile('file_player', { xp: 1 });
    await fs1.saveProfile('file_player', { xp: 2 });
    // concurrent writes are serialised in order
    await Promise.all([fs1.saveProfile('file_player', { xp: 3 }), fs1.saveProfile('file_player', { xp: 4 })]);
    assert.equal((await fs1.loadProfile('file_player')).xp, 4);
    // simulate a torn write of the main file: the backup is used
    await writeFile(join(dir, 'players', 'p_file_player.json'), '{"xp": 5, "trunc');
    const rec = await fs1.loadProfile('file_player');
    assert.equal(rec.xp, 3, 'previous good copy restored from backup');
    assert.equal(await fs1.loadProfile('missing_player'), null);
    await fs1.saveWar({ campaign: 3 });
    assert.equal(JSON.parse(await readFile(join(dir, 'war.json'), 'utf8')).campaign, 3);
    // path traversal in ids is neutralised
    await fs1.saveProfile('../../evil', { xp: 9 });
    assert.equal((await fs1.loadProfile('../../evil')).xp, 9);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('autosave writes dirty profiles periodically', async () => {
  const store = new MemoryStore();
  const { game } = await makeGame({ store, options: { npcCap: 0 } });
  const a = await connect(game, 'persist_5');
  game.progression.award(a.session, { xp: 33, noMult: true });
  run(game, 130, 0.25);
  await new Promise((r) => setTimeout(r, 20));
  const saved = await store.loadProfile('persist_5');
  assert.ok(saved && saved.xp === 33, 'autosaved');
  assert.ok(store.war, 'war state autosaved');
});
