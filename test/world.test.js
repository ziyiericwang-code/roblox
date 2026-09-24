import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/shared/world/layout.js';
import { getWorld } from './harness.js';
import { encodeSnapshot, decodeSnapshot } from '../src/shared/protocol.js';
import { ENTITY, SEA_LEVEL } from '../src/shared/constants.js';
import { TERRITORIES } from '../src/shared/config/territories.js';


test('world generation is deterministic', () => {
  const a = getWorld();
  const b = generateWorld(1947, { nav: false });
  assert.equal(a.colliders.count, b.colliders.count);
  assert.equal(a.trees.length, b.trees.length);
  for (const [x, z] of [[0, 0], [-490, 600], [140, -655], [300, 300], [-700, -700]]) {
    assert.equal(a.terrain.heightAt(x, z), b.terrain.heightAt(x, z));
  }
});

test('every territory and sector is on dry land and reachable', () => {
  const w = getWorld();
  const base = w.bases[1];
  for (const t of w.territories) {
    const pts = [t.commandPost, ...t.sectors.map((s) => s.def || s)];
    for (const p of pts) {
      assert.ok(w.terrain.heightAt(p.x, p.z) > SEA_LEVEL + 0.3, `${t.id} point at ${p.x},${p.z} is dry`);
    }
    if (t.isBase) continue;
    const path = w.nav.findPath(base.x, base.z, t.commandPost.x, t.commandPost.z);
    assert.ok(path && path.length > 1, `path from the Coalition base to ${t.id}`);
  }
  assert.equal(w.territories.filter((t) => !t.isBase).length, 8);
  assert.deepEqual(TERRITORIES.filter((t) => !t.isBase).map((t) => t.name).sort(), ['Black Ridge', 'Capital Zone', 'Eastreach', 'Harbor District', 'Iron Valley', 'Northland', 'Red Canyon', 'Westport']);
});

test('territory adjacency is symmetric', () => {
  const w = getWorld();
  for (const t of w.territories) {
    for (const a of t.adjacent) {
      assert.ok(w.tById[a], `${t.id} -> ${a} exists`);
      assert.ok(w.tById[a].adjacent.includes(t.id), `${a} lists ${t.id}`);
    }
  }
});

test('raycasts hit terrain and buildings; line of sight is blocked by walls', () => {
  const w = getWorld();
  const col = w.colliders;
  const h = w.terrain.heightAt(0, 0);
  const hit = col.raycast(0, h + 50, 0, 0, -1, 0, 200);
  assert.ok(hit && Math.abs(hit.t - 50) < 3, 'downward ray lands on the ground (or a roof)');
  const b = col.ref.find((x) => x.y1 - x.y0 > 3 && x.x1 - x.x0 > 3 && x.z1 - x.z0 > 1);
  const cz = (b.z0 + b.z1) / 2;
  const y = b.y0 + 1.5;
  assert.equal(col.lineOfSight(b.x0 - 5, y, cz, b.x1 + 5, y, cz), false);
});

test('cover points exist near every objective', () => {
  const w = getWorld();
  for (const t of w.territories) {
    if (t.isBase) continue;
    const near = w.cover.points.filter((c) => Math.hypot(c.x - t.x, c.z - t.z) < t.radius);
    assert.ok(near.length >= 10, `${t.id} has ${near.length} cover points`);
  }
});

test('snapshots round-trip within quantisation error', () => {
  const items = [
    { k: ENTITY.SOLDIER, id: 17, x: -512.34, y: 12.5, z: 700.01, yaw: 1.2, pitch: -0.3, stance: 1, lean: -1, life: 1, sprint: false, ads: true, firing: true, reloading: false, carrying: false, spotted: true, captive: false, ambient: false, swimming: false, isPlayer: true, faction: 2, role: 3, activity: 1, weapon: 4, health: 73, rank: 12, squad: 5, vehicle: 0, seat: 0, emote: 0, armor: 40 },
    { k: ENTITY.VEHICLE, id: 300, type: 2, x: 100, y: 5, z: -100, yaw: -2, pitch: 0.1, roll: -0.05, turretYaw: 0.5, turretPitch: 0.1, health: 80, state: 1, seats: 3, speed: 12, variant: 1, faction: 1 },
  ];
  const d = decodeSnapshot(encodeSnapshot(123456, 99, items));
  assert.equal(d.time, 123456);
  assert.equal(d.ack, 99);
  const s = d.items[0];
  assert.equal(s.id, 17);
  assert.ok(Math.abs(s.x - items[0].x) < 0.06 && Math.abs(s.z - items[0].z) < 0.06);
  assert.ok(Math.abs(s.yaw - 1.2) < 0.01);
  assert.equal(s.stance, 1);
  assert.equal(s.lean, -1);
  assert.equal(s.ads, true);
  assert.equal(s.isPlayer, true);
  assert.equal(s.faction, 2);
  assert.equal(s.role, 3);
  assert.equal(s.health, 73);
  assert.equal(s.rank, 12);
  assert.equal(s.armor, 40);
  const v = d.items[1];
  assert.equal(v.id, 300);
  assert.ok(Math.abs(v.x - 100) < 0.06);
});
