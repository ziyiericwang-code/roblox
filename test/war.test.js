import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, connect, run } from './harness.js';
import { FACTION } from '../src/shared/constants.js';
import { GAME } from '../src/shared/config/game.js';
import { MemoryStore } from '../src/sim/MemoryStore.js';

// A deployed Coalition player standing on a given sector. NPCs are disabled
// (npcCap 0) so the capture maths is deterministic.
async function soldierAt(game, id, tid, sid) {
  const { conn, session } = await connect(game, id);
  conn.deliver({ t: 'training', a: 'skip' });
  run(game, 0.1);
  conn.deliver({ t: 'deploy', spawn: 'hq', role: 'rifleman' });
  run(game, 0.1);
  const s = session.soldier;
  assert.ok(s, 'deployed');
  const sec = game.war.get(tid).sectors.find((x) => x.id === sid);
  s.x = sec.def.x + 2;
  s.z = sec.def.z + 2;
  s.y = game.world.colliders.groundHeight(s.x, s.z, 400);
  s.invulnerableUntil = game.time + 1e6;
  return { conn, session, s, sec };
}

test('a lone soldier neutralises then captures a front-line sector', async () => {
  const { game } = await makeGame({ options: { npcCap: 0 } });
  const { session, sec } = await soldierAt(game, 'war_cap_1', 'capital', 'A');
  assert.equal(game.war.isFront('capital', FACTION.COALITION), true);
  assert.equal(sec.owner, FACTION.DOMINION);
  run(game, GAME.captureTime + 2);
  assert.equal(sec.owner, FACTION.NONE, 'enemy flag is down');
  run(game, GAME.captureTime + 2);
  assert.equal(sec.owner, FACTION.COALITION, 'sector captured');
  assert.equal(session.profile.stats.captures, 1);
  assert.equal(game.war.get('capital').owner, FACTION.DOMINION, 'territory needs every sector');
});

test('territories behind the front cannot be captured', async () => {
  const { game } = await makeGame({ options: { npcCap: 0 } });
  assert.equal(game.war.isFront('northland', FACTION.COALITION), false);
  const { sec } = await soldierAt(game, 'war_cap_2', 'northland', 'A');
  const before = sec.progress;
  run(game, 20);
  assert.equal(sec.progress, before);
  assert.equal(sec.owner, FACTION.DOMINION);
});

test('taking the last sector flips the territory and moves the front', async () => {
  const { game } = await makeGame({ options: { npcCap: 0 } });
  const w = game.war.get('capital');
  for (const s of w.sectors) {
    if (s.id === 'A') continue;
    s.owner = FACTION.COALITION;
    s.progress = 100;
  }
  game.war.startBattle('capital', FACTION.COALITION);
  const { session } = await soldierAt(game, 'war_flip_1', 'capital', 'A');
  run(game, GAME.captureTime * 2 + 4);
  assert.equal(w.owner, FACTION.COALITION);
  assert.equal(w.state, 'liberated');
  assert.equal(session.profile.stats.territories, 1);
  assert.ok(![...game.war.battles.values()].some((b) => b.territory === 'capital'), 'battle ended');
  // Northland borders the Capital, so it is now on the Coalition front
  assert.equal(game.war.isFront('northland', FACTION.COALITION), true);
});

test('campaign ends when one side holds every territory, then resets', async () => {
  const { game } = await makeGame({ options: { npcCap: 0 } });
  const { session } = await connect(game, 'war_campaign_1');
  session.profile.stats.service = 30;
  for (const w of game.war.map.values()) {
    if (w.def.isBase || w.owner === FACTION.COALITION) continue;
    for (const s of w.sectors) {
      s.owner = FACTION.COALITION;
      s.progress = 100;
    }
    game.war.flipTerritory(w, FACTION.COALITION);
  }
  assert.ok(game.war.resetAt > 0, 'campaign victory scheduled');
  assert.equal(session.profile.stats.campaigns, 1);
  run(game, GAME.campaignResetDelay + 1);
  assert.equal(game.war.campaign, 2);
  assert.equal(game.war.get('capital').owner, FACTION.DOMINION, 'front redrawn');
  assert.equal(game.war.get('harbor').owner, FACTION.COALITION);
});

test('war state survives a restart', async () => {
  const store = new MemoryStore();
  const { game } = await makeGame({ store, options: { npcCap: 0 } });
  const w = game.war.get('westport');
  for (const s of w.sectors) s.owner = FACTION.COALITION;
  game.war.flipTerritory(w, FACTION.COALITION);
  w.sectors[1].progress = 40;
  await game.shutdown();
  const { game: g2 } = await makeGame({ store, options: { npcCap: 0 } });
  assert.equal(g2.war.get('westport').owner, FACTION.COALITION);
  assert.equal(g2.war.get('westport').sectors[1].progress, 40);
  assert.equal(g2.war.get('capital').owner, FACTION.DOMINION);
});

test('command points regenerate with held territory and are capped', async () => {
  const { game } = await makeGame({ options: { npcCap: 0 } });
  game.war.cp[FACTION.COALITION] = 0;
  run(game, 60);
  const cp = game.war.cp[FACTION.COALITION];
  assert.ok(cp > 0, `regenerated ${cp}`);
  run(game, 3600, 1);
  assert.ok(game.war.cp[FACTION.COALITION] <= game.war.cpMax(FACTION.COALITION));
});

test('missions are generated for the front and pay out once on success', async () => {
  const { game } = await makeGame({ options: { npcCap: 0 } });
  game.war.startBattle('capital', FACTION.COALITION);
  run(game, 60);
  const act = game.missions.active();
  assert.ok(act.length >= 2, `generated ${act.length} missions`);
  // a player captures a sector that has a capture mission
  const m = game.missions.create('capture', {
    tid: 'capital', sectorName: 'Parliament Square', data: { tid: 'capital', sid: 'A' }, expected: 30,
    x: game.war.get('capital').sectors[0].def.x, z: game.war.get('capital').sectors[0].def.z, r: 40,
  });
  const { session } = await soldierAt(game, 'war_mission_1', 'capital', 'A');
  const missionsBefore = session.profile.stats.missions;
  run(game, GAME.captureTime * 2 + 4);
  assert.equal(m.status, 'success');
  assert.equal(session.profile.stats.missions, missionsBefore + 1);
  // finishing again (e.g. a duplicate event) does not pay twice
  const xp = session.profile.xp;
  m.status = 'active';
  game.missions.finish(m, true, 'dup');
  assert.equal(session.profile.xp, xp, 'mission reward ledger prevents duplicates');
});

test('supply delivery raises territory supply and command points', async () => {
  const { game } = await makeGame({ options: { npcCap: 0 } });
  const { session } = await connect(game, 'war_supply_1');
  const w = game.war.get('iron_valley');
  w.supply = 20;
  const m = game.missions.makeSupply(w.def);
  assert.ok(m, 'supply mission created');
  const cp = game.war.cp[FACTION.COALITION];
  game.missions.delivered(m, session, 1);
  assert.ok(w.supply > 20);
  assert.ok(game.war.cp[FACTION.COALITION] > cp);
  assert.equal(session.profile.stats.supplies, 1);
});
