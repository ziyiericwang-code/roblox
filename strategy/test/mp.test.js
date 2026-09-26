// Multiplayer over real WebSockets: codes, lobby, country exclusivity, empires, turns,
// reconnect, persistence and hidden-information checks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../src/server/index.js';
import { normalizeCode, newCode, CODE_ALPHABET } from '../src/server/codes.js';

let srv;
let dir;
const clients = [];

class Client {
  constructor(port, name, identity) {
    this.port = port;
    this.name = name;
    this.identity = identity || {};
    this.msgs = [];
    this.waiters = [];
    this.seq = 1;
    clients.push(this);
  }
  async open() {
    this.ws = new WebSocket(`ws://localhost:${this.port}/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.msgs.push(m);
      if (m.t === 'lobby') this.lobby = m.lobby;
      if (m.t === 'view') this.view = m.view;
      for (const w of [...this.waiters]) if (w.pred(m)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.res(m);
      }
    });
    await new Promise((r, j) => {
      this.ws.once('open', r);
      this.ws.once('error', j);
    });
    this.send({ t: 'hello', name: this.name, id: this.identity.id, secret: this.identity.secret, devKey: this.devKey });
    const w = await this.wait((m) => m.t === 'welcome');
    this.id = w.id;
    if (w.secret) this.identity = { id: w.id, secret: w.secret };
    return this;
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  wait(pred, ms = 8000) {
    const hit = this.msgs.find((m) => pred(m) && !m._seen);
    if (hit) {
      hit._seen = true;
      return Promise.resolve(hit);
    }
    return new Promise((res, rej) => {
      const w = {
        pred,
        res: (m) => {
          clearTimeout(t);
          m._seen = true;
          res(m);
        },
      };
      const t = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        rej(new Error(`${this.name}: timed out waiting`));
      }, ms);
      this.waiters.push(w);
    });
  }
  async req(m) {
    const id = this.seq++;
    this.msgs = this.msgs.filter((x) => x.t !== 'ack' || x.id !== id);
    this.send({ ...m, id });
    return (await this.wait((x) => x.t === 'ack' && x.id === id)).res;
  }
  cmd(cmd) {
    return this.req({ t: 'cmd', cmd });
  }
  nextView(pred = () => true) {
    this.msgs.forEach((m) => m.t === 'view' && (m._seen = true));
    return this.wait((m) => m.t === 'view' && pred(m));
  }
  close() {
    return new Promise((r) => {
      if (!this.ws || this.ws.readyState === 3) return r();
      this.ws.once('close', r);
      this.ws.close();
    });
  }
}

const countryId = (iso) => srv.server.world.countries.findIndex((c) => c.iso3 === iso);

before(async () => {
  process.env.DEV_SECRET = 'test-dev-key';
  dir = mkdtempSync(join(tmpdir(), 'gc-mp-'));
  srv = await startServer({ port: 0, dataDir: dir, quiet: true });
});
after(async () => {
  for (const c of clients) await c.close();
  await srv.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

test('join codes are readable and validated', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const c = newCode(seen);
    assert.equal(c.length, 6);
    for (const ch of c) assert.ok(CODE_ALPHABET.includes(ch));
    assert.ok(!seen.has(c));
    seen.add(c);
  }
  assert.equal(normalizeCode(' k7x-4q9 '), 'K7X4Q9');
  assert.equal(normalizeCode('K7X4Q0'), null, 'zero is not in the alphabet');
  assert.equal(normalizeCode('K7X4Q'), null);
  assert.equal(normalizeCode(42), null);
});

test('full campaign flow', async (t) => {
  const port = srv.port;
  const host = await new Client(port, 'Alpha').open();
  const bob = await new Client(port, 'Bravo').open();
  const cara = await new Client(port, 'Charlie').open();

  // create
  const made = await host.req({ t: 'create', settings: { name: 'Test War', maxPlayers: 4, scenario: 'powder', turnTimer: 0, startRank: 49 } });
  assert.ok(made.ok, made.reason);
  assert.match(made.code, /^[2-9A-HJKMNP-TV-Z]{6}$/);
  const code = made.code;

  await t.test('bad codes are rejected', async () => {
    const r1 = await bob.req({ t: 'join', code: 'ZZZZZZ' });
    assert.equal(r1.ok, false);
    const r2 = await bob.req({ t: 'join', code: 'hello!' });
    assert.equal(r2.ok, false);
  });

  await t.test('join by code (case and dashes ignored)', async () => {
    const r = await bob.req({ t: 'join', code: `${code.slice(0, 3).toLowerCase()}-${code.slice(3)}` });
    assert.ok(r.ok, r.reason);
    const r2 = await cara.req({ t: 'join', code });
    assert.ok(r2.ok, r2.reason);
    await host.wait((m) => m.t === 'lobby' && m.lobby.members.length === 3);
    assert.equal(host.lobby.members.length, 3);
    assert.equal(host.lobby.settings.passwordHash, undefined, 'password hash never leaves the server');
  });

  const USA = countryId('USA');
  const FRA = countryId('FRA');
  const RUS = countryId('RUS');

  await t.test('country exclusivity', async () => {
    assert.ok((await host.req({ t: 'pick', country: USA })).ok);
    const dup = await bob.req({ t: 'pick', country: USA });
    assert.equal(dup.ok, false);
    assert.match(dup.reason, /taken/);
    assert.ok((await bob.req({ t: 'pick', country: RUS })).ok);
    assert.ok((await cara.req({ t: 'pick', country: 'nope' })).ok === false);
  });

  await t.test('only the host can start or change settings', async () => {
    assert.equal((await bob.req({ t: 'start' })).ok, false);
    assert.equal((await bob.req({ t: 'settings', settings: { maxPlayers: 16 } })).ok, false);
    const early = await host.req({ t: 'start' });
    assert.equal(early.ok, false, 'cannot start while someone has no nation');
  });

  await t.test('serve another commander (join their empire)', async () => {
    const r = await cara.req({ t: 'pick', serve: host.id });
    assert.ok(r.ok, r.reason);
    await host.wait((m) => m.t === 'lobby' && m.lobby.members.find((x) => x.id === cara.id)?.serve === host.id);
  });

  await t.test('start', async () => {
    const r = await host.req({ t: 'start' });
    assert.ok(r.ok, r.reason);
    const [vh, vb, vc] = await Promise.all([host.wait((m) => m.t === 'view' && m.started), bob.wait((m) => m.t === 'view' && m.started), cara.wait((m) => m.t === 'view' && m.started)]);
    assert.equal(vh.view.me.country, USA);
    assert.equal(vb.view.me.country, RUS);
    assert.equal(vc.view.me.country, USA);
    assert.ok(vh.view.me.rank >= 49, 'host starts as Supreme Commander');
    assert.ok(vc.view.me.rank <= 36, 'servant rank is capped');
    // late joiner is refused a taken nation, but code still works while joinInProgress
    const joinAfter = await new Client(port, 'Delta').open();
    const r2 = await joinAfter.req({ t: 'join', code });
    assert.ok(r2.ok, r2.reason);
    assert.equal((await joinAfter.req({ t: 'pick', country: FRA })).ok, false, 'no picking after start');
    await joinAfter.req({ t: 'leave' });
    await joinAfter.close();
  });

  await t.test('no hidden information leaks', async () => {
    const vb = bob.view;
    // Bravo (Russia) must not see American finances, orders, supply or other commanders' inboxes
    assert.equal(vb.countries[USA].treasury, undefined);
    const enemy = vb.formations.filter((f) => f.owner === USA);
    for (const f of enemy) {
      assert.equal(f.order, undefined, 'enemy orders are hidden');
      assert.equal(f.supply, undefined, 'enemy supply is hidden');
    }
    const usTotal = host.view.formations.filter((f) => f.owner === USA).length;
    assert.ok(enemy.length < usTotal, 'fog of war hides part of the enemy army');
    const hostNotes = host.view.me.inbox.map((n) => n.title);
    const bobNotes = new Set(vb.me.inbox.map((n) => n.title));
    assert.ok(!hostNotes.filter((t) => /takes command/.test(t)).some((t) => bobNotes.has(t) && !/Bravo/.test(t)), 'private notes stay private');
    assert.ok(!JSON.stringify(vb).includes(host.identity.secret), 'secrets never leave the server');
  });

  await t.test('orders are validated server-side', async () => {
    const mine = host.view.formations.find((f) => f.mine && !f.battle);
    const theirs = bob.view.formations.find((f) => f.mine);
    assert.ok(mine && theirs);
    const hijack = await bob.cmd({ type: 'hold', f: mine.id });
    assert.equal(hijack.ok, false, 'cannot order another commander\'s formation');
    const junk = await host.cmd({ type: 'move', f: mine.id, to: 1e9 });
    assert.equal(junk.ok, false);
    const bogus = await host.cmd({ type: 'dev', op: 'resources', amount: 1e9 });
    assert.equal(bogus.ok, false, 'dev commands need dev access');
    const hold = await host.cmd({ type: 'digin', f: mine.id });
    assert.ok(hold.ok, hold.reason);
  });

  await t.test('permissions: delegate armies to an ally, never total control', async () => {
    const mine = host.view.formations.filter((f) => f.mine && !f.battle);
    const give = mine[mine.length - 1];
    const keep = mine[0];
    assert.equal((await cara.cmd({ type: 'hold', f: give.id })).ok, false, 'no control before the grant');
    assert.equal((await host.cmd({ type: 'grant', grantee: bob.id, perm: 'CONTROL_ARMIES', assets: [give.id] })).ok, false, 'not allied with Russia');
    const noAssets = await host.cmd({ type: 'grant', grantee: cara.id, perm: 'CONTROL_ARMIES' });
    assert.equal(noAssets.ok, false, 'control grants must name specific formations');
    const r = await host.cmd({ type: 'grant', grantee: cara.id, perm: 'CONTROL_ARMIES', assets: [give.id] });
    assert.ok(r.ok, r.reason);
    assert.ok((await cara.cmd({ type: 'hold', f: give.id })).ok, 'granted formation obeys');
    assert.equal((await cara.cmd({ type: 'hold', f: keep.id })).ok, false, 'other formations stay with the owner');
    assert.ok((await host.cmd({ type: 'revoke', id: r.grant })).ok);
    assert.equal((await cara.cmd({ type: 'hold', f: give.id })).ok, false, 'revoked');
  });

  await t.test('the servant joins the empire when it is founded', async () => {
    const r = await host.cmd({ type: 'empire', op: 'found', name: 'Atlantic Imperium' });
    assert.ok(r.ok, r.reason);
    const v = await cara.nextView((m) => m.view.empires.some((e) => e.name === 'Atlantic Imperium'));
    const e = v.view.empires.find((x) => x.name === 'Atlantic Imperium');
    assert.ok(e.mine, 'the servant sees the empire as their own');
    assert.ok(e.officers.some((o) => o.player === cara.id), 'enrolled as an Imperial Officer');
    const outsider = bob.view.empires.find((x) => x.name === 'Atlantic Imperium') || (await bob.nextView((m) => m.view.empires.some((x) => x.name === 'Atlantic Imperium'))).view.empires.find((x) => x.name === 'Atlantic Imperium');
    assert.equal(outsider.treasury, undefined, 'imperial treasury is private');
  });

  await t.test('simultaneous turn resolves when all are ready', async () => {
    const turn0 = host.view.turn;
    const waits = [host, bob, cara].map((c) => c.nextView((m) => m.turnDone));
    host.send({ t: 'end' });
    bob.send({ t: 'end' });
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(host.view.turn, turn0, 'waits for the last commander');
    cara.send({ t: 'end' });
    const [a] = await Promise.all(waits);
    assert.equal(a.view.turn, turn0 + 1);
  });

  await t.test('disconnect puts forces on automation; reconnect restores', async () => {
    const identity = bob.identity;
    await bob.close();
    await host.wait((m) => m.t === 'lobby' && m.lobby.members.find((x) => x.id === identity.id)?.online === false);
    // the turn does not wait for a disconnected commander
    const w = host.nextView((m) => m.turnDone);
    host.send({ t: 'end' });
    cara.send({ t: 'end' });
    await w;
    const back = await new Client(port, 'Bravo', identity).open();
    assert.equal(back.id, identity.id, 'same identity after reconnect');
    const campaign = host.lobby.id;
    const r = await back.req({ t: 'rejoin', campaign });
    assert.ok(r.ok, r.reason);
    const v = await back.wait((m) => m.t === 'view');
    assert.equal(v.view.me.country, RUS);
    bob.ws = back.ws;
    Object.assign(bob, back);
  });

  await t.test('wrong secret gets a fresh identity (cannot impersonate)', async () => {
    const fake = await new Client(port, 'Mallory', { id: host.id, secret: 'guess' }).open();
    assert.notEqual(fake.id, host.id);
    const r = await fake.req({ t: 'rejoin', campaign: host.lobby.id });
    assert.equal(r.ok, false);
    await fake.close();
  });

  await t.test('full campaigns and brute force lockout', async () => {
    const other = await new Client(port, 'Echo').open();
    const made2 = await other.req({ t: 'create', settings: { name: 'Tiny', maxPlayers: 2, password: 'pw' } });
    const f1 = await new Client(port, 'F1').open();
    assert.equal((await f1.req({ t: 'join', code: made2.code, password: 'wrong' })).ok, false);
    assert.ok((await f1.req({ t: 'join', code: made2.code, password: 'pw' })).ok);
    const f2 = await new Client(port, 'F2').open();
    const full = await f2.req({ t: 'join', code: made2.code, password: 'pw' });
    assert.equal(full.ok, false);
    assert.match(full.reason, /full/);
    let locked = false;
    for (let i = 0; i < 8; i++) {
      const r = await f2.req({ t: 'join', code: 'QQQQQQ' });
      if (/Too many/.test(r.reason)) locked = true;
    }
    assert.ok(locked, 'repeated failures are locked out');
    await Promise.all([other.close(), f1.close(), f2.close()]);
  });

  await t.test('persistence: campaign survives a server restart', async () => {
    const campaign = host.lobby.id;
    const turn = host.view.turn;
    const hostId = host.identity;
    for (const c of [host, bob, cara]) await c.close();
    await srv.shutdown();
    srv = await startServer({ port: 0, dataDir: dir, quiet: true });
    const again = await new Client(srv.port, 'Alpha', hostId).open();
    const mine = await (async () => {
      again.send({ t: 'mine' });
      return again.wait((m) => m.t === 'mine');
    })();
    assert.ok(mine.list.some((c) => c.id === campaign));
    const r = await again.req({ t: 'rejoin', campaign });
    assert.ok(r.ok, r.reason);
    const v = await again.wait((m) => m.t === 'view');
    assert.equal(v.view.turn, turn);
    assert.equal(v.view.me.country, USA);
    await again.close();
  });
});

test('developer tools are server-gated', async () => {
  const dev = new Client(srv.port, 'Dev');
  dev.devKey = 'test-dev-key';
  await dev.open();
  const pleb = await new Client(srv.port, 'Pleb').open();
  const made = await dev.req({ t: 'create', settings: { name: 'Dev Test', maxPlayers: 16, turnTimer: 0 } });
  assert.ok((await pleb.req({ t: 'join', code: made.code })).ok);
  assert.equal((await pleb.req({ t: 'mpdev', op: 'bot' })).ok, false, 'normal players have no dev tools');
  assert.ok((await dev.req({ t: 'mpdev', op: 'bot' })).ok);
  assert.ok((await dev.req({ t: 'mpdev', op: 'bot' })).ok);
  assert.ok((await dev.req({ t: 'pick', country: countryId('DEU') })).ok);
  assert.ok((await pleb.req({ t: 'pick', country: countryId('POL') })).ok);
  assert.ok((await dev.req({ t: 'start' })).ok);
  const v = await dev.wait((m) => m.t === 'view' && m.started);
  assert.ok(v.view.me.dev);
  assert.equal(v.view.players.length, 4, 'two humans and two test players');
  const load = await dev.req({ t: 'mpdev', op: 'load', reps: 3 });
  assert.ok(load.ok && load.views === 12, JSON.stringify(load));
  assert.ok(load.perView < 500, `view build ${load.perView} ms`);
  const pv = await pleb.wait((m) => m.t === 'view' && m.started);
  assert.ok(!pv.view.me.dev);
  assert.equal((await pleb.cmd({ type: 'dev', action: 'cp', amount: 999 })).ok, false);
  // simulated disconnect of the non-dev player; turn proceeds without them
  assert.ok((await dev.req({ t: 'mpdev', op: 'drop', player: pleb.id })).ok);
  const w = dev.nextView((m) => m.turnDone);
  dev.send({ t: 'end' });
  const done = await w;
  assert.equal(done.view.turn, 1);
  await dev.close();
});
