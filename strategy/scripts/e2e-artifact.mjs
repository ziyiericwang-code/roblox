// Two-tab test of the artifact edition's join-by-code multiplayer. The claude.ai runtime
// (db, room, user) is replaced by a stand-in that syncs tabs through localStorage and
// BroadcastChannel, so the page's own host/guest logic runs for real.
import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'screenshots');
mkdirSync(out, { recursive: true });
const body = readFileSync(join(root, 'dist/artifact.html'), 'utf8');
const page0 = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}</style></head><body>${body}</body></html>`;
const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html' });
  r.end(page0);
});
await new Promise((r) => srv.listen(0, r));
const url = `http://localhost:${srv.address().port}/`;

function mockRuntime(me) {
  const listeners = new Set();
  const notify = (path) => listeners.forEach((l) => l(path));
  window.addEventListener('storage', (e) => e.key && e.key.startsWith('db:') && notify(e.key.slice(3)));
  const read = (p) => {
    const v = localStorage.getItem(`db:${p}`);
    return v ? JSON.parse(v) : undefined;
  };
  const snap = (p) => {
    const d = read(p);
    return { id: p.split('/').pop(), exists: d !== undefined, data: () => d, metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const docRef = (p) => ({
    path: p,
    get: async () => snap(p),
    set: async (d) => {
      localStorage.setItem(`db:${p}`, JSON.stringify(d));
      setTimeout(() => notify(p), 0);
    },
    update: async (d) => {
      localStorage.setItem(`db:${p}`, JSON.stringify({ ...read(p), ...d }));
      setTimeout(() => notify(p), 0);
    },
    delete: async () => {
      localStorage.removeItem(`db:${p}`);
      setTimeout(() => notify(p), 0);
    },
    onSnapshot(next) {
      const l = (changed) => changed === p && next(snap(p));
      listeners.add(l);
      setTimeout(() => next(snap(p)), 0);
      return () => listeners.delete(l);
    },
  });
  const query = (col, filters = []) => ({
    where: (f, op, v) => query(col, [...filters, [f, op, v]]),
    limit: () => query(col, filters),
    orderBy: () => query(col, filters),
    get: async () => {
      const docs = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k.startsWith(`db:${col}/`) || k.slice(col.length + 4).includes('/')) continue;
        const d = JSON.parse(localStorage.getItem(k));
        if (filters.every(([f, op, v]) => op === 'array-contains' && Array.isArray(d[f]) && d[f].includes(v))) docs.push(snap(k.slice(3)));
      }
      return { docs, size: docs.length, empty: !docs.length };
    },
  });
  const db = { doc: docRef, collection: (c) => ({ ...query(c), path: c, doc: (id) => docRef(`${c}/${id}`) }) };
  const tab = Math.random().toString(36).slice(2);
  function makeRoom(name) {
    const ch = new BroadcastChannel(`room:${name}`);
    const peers = new Map([[tab, { peer: tab, by: me, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: {}, updatedAt: Date.now() }]]);
    const topicL = new Map();
    const peerL = new Set();
    const firePeers = () => {
      const list = Object.freeze([...peers.values()]);
      peerL.forEach((f) => f({ peers: list, joined: [], left: [], updated: [] }));
    };
    const hb = setInterval(() => {
      ch.postMessage({ k: 'hb', tab, by: me });
      const now = Date.now();
      let changed = false;
      for (const [t, p] of peers) if (t !== tab && now - p.updatedAt > 1600) {
        peers.delete(t);
        changed = true;
      }
      if (changed) firePeers();
    }, 400);
    ch.onmessage = (e) => {
      const m = e.data;
      if (m.k === 'hb' || m.k === 'bye') {
        const had = peers.has(m.tab);
        if (m.k === 'bye') peers.delete(m.tab);
        else peers.set(m.tab, { peer: m.tab, by: m.by, isMe: m.by === me, sameTab: false, kind: 'viewer', guest: false, presence: {}, updatedAt: Date.now() });
        if (had !== peers.has(m.tab)) firePeers();
      } else if (m.k === 'ev') (topicL.get(m.topic) || []).forEach((f) => f({ topic: m.topic, data: m.data, peer: m.tab, by: m.by, isMe: m.by === me, sameTab: false, kind: 'viewer', guest: false }));
    };
    ch.postMessage({ k: 'hb', tab, by: me });
    return {
      name,
      emit: async (topic, data) => {
        ch.postMessage({ k: 'ev', topic, data, tab, by: me });
        (topicL.get(topic) || []).forEach((f) => f({ topic, data, peer: tab, by: me, isMe: true, sameTab: true, kind: 'viewer', guest: false }));
      },
      on(topic, fn) {
        if (!topicL.has(topic)) topicL.set(topic, []);
        topicL.get(topic).push(fn);
        return () => topicL.set(topic, topicL.get(topic).filter((x) => x !== fn));
      },
      presence: async () => {},
      peers: () => Object.freeze([...peers.values()]),
      onPeers(fn) {
        peerL.add(fn);
        setTimeout(firePeers, 0);
        return () => peerL.delete(fn);
      },
      connected: () => true,
      onConnection: () => () => {},
      leave: async () => {
        clearInterval(hb);
        ch.postMessage({ k: 'bye', tab, by: me });
        ch.close();
      },
    };
  }
  const lobby = makeRoom('lobby');
  lobby.join = async (n) => makeRoom(n);
  const user = { id: async () => me, me: async () => ({ id: me, name: me === 'u_alpha' ? 'Alpha' : 'Bravo', isOwner: me === 'u_alpha', canEdit: true }), profiles: async (ids) => Object.fromEntries([].concat(ids).map((i) => [i, { id: i, name: i === 'u_alpha' ? 'Alpha' : i === 'u_bravo' ? 'Bravo' : '' }])), can: async () => true, canEdit: async () => true, isOwner: async () => me === 'u_alpha' };
  window.claude = { use: async (n) => ({ db, room: lobby, user })[n] || null };
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const errors = [];
async function open(id) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${id}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !/fonts\.g|ERR_/.test(m.text()) && errors.push(`${id}: ${m.text()}`));
  await p.addInitScript(mockRuntime, id);
  await p.goto(url);
  await p.waitForSelector('.war-title', { timeout: 60000 });
  return p;
}
const pick = async (p, name) => {
  await p.fill('.setup-right .search', name);
  await p.click(`.country-list button:has-text("${name}")`);
  await p.click('.country-card .btn:has-text("Command")');
};
try {
  const a = await open('u_alpha');
  await a.click('text=Multiplayer');
  await a.waitForSelector('text=Connected as', { timeout: 15000 });
  await a.click('.mp-form .btn:has-text("Create campaign")');
  await a.waitForSelector('.lobby .code-box', { timeout: 15000 });
  const code = (await a.textContent('.code-box .code')).trim();
  console.log('code', code);

  const b = await open('u_bravo');
  await b.click('text=Multiplayer');
  await b.waitForSelector('text=Connected as', { timeout: 15000 });
  await b.click('text=Join with code');
  await b.fill('.code-input', code.toLowerCase());
  await b.click('.mp-form .btn:has-text("Join campaign")');
  await b.waitForSelector('.lobby', { timeout: 20000 });
  await a.waitForSelector('.member:has-text("Bravo")', { timeout: 10000 });
  console.log('guest joined the lobby');

  await pick(a, 'Germany');
  await a.waitForSelector('.member.me:has-text("Germany")');
  await pick(b, 'Germany');
  await b.waitForSelector('.lobby .bad', { timeout: 8000 });
  console.log('duplicate refused:', await b.textContent('.lobby .bad'));
  await pick(b, 'Poland');
  await a.waitForSelector('.member:has-text("Poland")', { timeout: 10000 });
  await b.click('.lobby .chat input');
  await b.keyboard.type('ready for war');
  await b.keyboard.press('Enter');
  await a.waitForSelector('.chat-log:has-text("ready for war")', { timeout: 10000 });
  await a.screenshot({ path: join(out, 'art-lobby.png') });

  await a.click('.setup-go .btn:has-text("START")');
  await Promise.all([a.waitForSelector('.topbar', { timeout: 60000 }), b.waitForSelector('.topbar', { timeout: 60000 })]);
  console.log('both in game');
  const turn = (p) => p.evaluate(() => window.__gc.ctl.view.turn);
  const t0 = await turn(a);
  // guest issues a validated order through the host
  const r = await b.evaluate(async () => {
    const v = window.__gc.ctl.view;
    const f = v.formations.find((x) => x.mine && !x.battle);
    return window.__gc.ctl.command({ type: 'hold', f: f.id });
  });
  console.log('guest order:', JSON.stringify(r));
  const bad = await b.evaluate(async () => {
    const v = window.__gc.ctl.view;
    const f = v.formations.find((x) => !x.mine && x.owner !== v.me.country);
    return window.__gc.ctl.command({ type: 'hold', f: f ? f.id : 1 });
  });
  console.log('guest hijack attempt:', JSON.stringify(bad));
  await a.click('.endturn');
  await a.waitForSelector('.endturn.ready', { timeout: 8000 });
  await b.click('.endturn');
  await a.waitForFunction((t) => window.__gc.ctl.view.turn === t + 1, t0, { timeout: 30000 });
  await b.waitForFunction((t) => window.__gc.ctl.view.turn === t + 1, t0, { timeout: 30000 });
  console.log('turn resolved for both:', t0, '->', await turn(b));
  await b.waitForTimeout(800);
  await b.screenshot({ path: join(out, 'art-guest-game.png') });
} finally {
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
  await browser.close();
  srv.close();
}
