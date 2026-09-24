// Real multiplayer over WebSockets against the actual Node server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../src/server/index.js';
import { decodeSnapshot } from '../src/shared/protocol.js';

function client(port, id, name) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const c = { ws, msgs: [], snap: null, snaps: 0, id: null };
  ws.binaryType = 'arraybuffer';
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const ab = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      c.snap = decodeSnapshot(ab);
      c.snaps++;
    } else c.msgs.push(JSON.parse(data.toString()));
  });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = async (pred, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const r = pred(c);
      if (r) return r;
      await new Promise((res) => setTimeout(res, 20));
    }
    throw new Error(`timeout waiting in ${name}`);
  };
  c.find = (t) => c.msgs.find((m) => m.t === t);
  c.open = new Promise((r) => ws.on('open', r)).then(() => c.send({ t: 'hello', id, token: `${id}-token-secret`, name }));
  return c;
}

test('two players join over WebSockets, see each other and exchange fire', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'frontline-net-'));
  const srv = await startServer({ port: 0, dataDir: dir, quiet: true });
  try {
    const info = await (await fetch(`http://localhost:${srv.port}/api/info`)).json();
    assert.equal(info.multiplayer, true);
    const a = client(srv.port, 'net_player_alpha', 'Alpha');
    const b = client(srv.port, 'net_player_bravo', 'Bravo');
    await Promise.all([a.open, b.open]);
    const wa = await a.wait((c) => c.find('welcome'));
    const wb = await b.wait((c) => c.find('welcome'));
    assert.equal(wa.seed, wb.seed, 'same world');
    for (const c of [a, b]) {
      c.send({ t: 'training', a: 'skip' });
      c.send({ t: 'deploy', spawn: 'hq', role: 'rifleman' });
    }
    const sa = await a.wait((c) => c.find('spawned'));
    const sb = await b.wait((c) => c.find('spawned'));
    // each sees the other in its snapshots (same faction, same base)
    await a.wait((c) => c.snap && c.snap.items.some((it) => it.id === sb.id));
    await b.wait((c) => c.snap && c.snap.items.some((it) => it.id === sa.id));
    // Alpha walks; Bravo sees the movement
    const p = [...sa.p];
    let seq = 1;
    for (let i = 0; i < 20; i++) {
      p[0] += 0.2;
      a.send({ t: 'in', s: seq++, p, v: [4, 0, 0], y: 0, pi: 0, st: 0, g: 1, mv: 1 });
      await new Promise((r) => setTimeout(r, 50));
    }
    await b.wait((c) => {
      const it = c.snap && c.snap.items.find((x) => x.id === sa.id);
      return it && it.x > sa.p[0] + 2;
    });
    // radio/chat style broadcasts reach both
    assert.ok(a.snaps > 5 && b.snaps > 5);
    // Alpha's server-side soldier exists and matches the reported position
    const sess = srv.game.byProfile.get('net_player_alpha');
    assert.ok(Math.abs(sess.soldier.x - p[0]) < 0.01);
    // friendly fire is off: Alpha shooting Bravo does nothing
    const bs = srv.game.byProfile.get('net_player_bravo').soldier;
    bs.invulnerableUntil = 0;
    const eye = [sess.soldier.x, sess.soldier.y + 1.6, sess.soldier.z];
    const d = [bs.x - eye[0], bs.y + 1.2 - eye[1], bs.z - eye[2]];
    const l = Math.hypot(...d);
    a.send({ t: 'fire', slot: 0, o: eye, d: d.map((v) => v / l), seq: 1 });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(bs.health, 100);
    a.ws.close();
    b.ws.close();
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(srv.game.playersOnline(), 0);
  } finally {
    await srv.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test('oversized and malformed WebSocket frames do not crash the server', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'frontline-net-'));
  const srv = await startServer({ port: 0, dataDir: dir, quiet: true });
  try {
    const bad = new WebSocket(`ws://localhost:${srv.port}/ws`);
    await new Promise((r) => bad.on('open', r));
    bad.on('error', () => {});
    bad.send('not json');
    bad.send(Buffer.from([1, 2, 3]));
    bad.send(JSON.stringify({ t: 'hello', id: '../../../etc', token: 'x' }));
    bad.send('x'.repeat(40000));
    await new Promise((r) => setTimeout(r, 200));
    const ok = client(srv.port, 'net_player_after', 'After');
    await ok.open;
    await ok.wait((c) => c.find('welcome'));
    ok.ws.close();
  } finally {
    await srv.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});
