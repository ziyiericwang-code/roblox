// Global Command multiplayer server: static client hosting, identities, campaign lobby with
// join codes, and authoritative campaigns over WebSocket.
import http from 'node:http';
import { promises as fs, readFileSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { buildWorld } from '../shared/world.js';
import { FileStore } from './store.js';
import { Campaign, cleanSettings, MODES, MAX_PLAYERS } from './Campaign.js';
import { normalizeCode, newId, newSecret, hash, safeEqual, RateLimiter, JoinGuard } from './codes.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.bin': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml' };
const MAX_MSG = 64 * 1024;

export async function startServer({ port = Number(process.env.PORT) || 3000, dataDir = process.env.DATA_DIR || join(root, 'data-runtime'), quiet = false, dist = join(root, 'dist') } = {}) {
  const log = quiet ? { info() {}, warn() {}, error: console.error } : console;
  const world = buildWorld(JSON.parse(readFileSync(join(root, 'data/world/world.json'), 'utf8')));
  const store = new FileStore(dataDir);
  await store.init();
  const devIds = new Set((process.env.DEV_PLAYERS || '').split(',').filter(Boolean));
  const devSecret = process.env.DEV_SECRET || '';

  const server = {
    world,
    store,
    log,
    campaigns: new Map(),
    byCode: new Map(),
    players: (await store.loadPlayers()) || {},
    devSessions: new Set(),
    newCampaignId: () => newId(9),
    codeSet() {
      return new Set(this.byCode.keys());
    },
    registerCode(c) {
      this.byCode.set(c.meta.code, c);
    },
    releaseCode(code) {
      this.byCode.delete(code);
    },
    isDev(id) {
      return devIds.has(id) || this.devSessions.has(id);
    },
  };
  // restore campaign directory (games load lazily)
  for (const meta of await store.listCampaigns()) {
    if (meta.status === 'ended') continue;
    const c = new Campaign(server, meta);
    server.campaigns.set(meta.id, c);
    server.registerCode(c);
  }
  log.info(`[global-command] world ${world.P} provinces; ${server.campaigns.size} campaigns restored`);

  const savePlayers = () => store.savePlayers(server.players).catch((e) => log.error('players save failed', e));

  // ---------------------------------------------------------------- HTTP
  const httpServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/api/info') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ name: 'Global Command', multiplayer: true, campaigns: server.campaigns.size, online: wss.clients.size }));
        return;
      }
      let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (!p || p.endsWith('/')) p += 'index.html';
      const file = join(dist, p);
      if (!file.startsWith(dist)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const body = await fs.readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': p === 'index.html' ? 'no-cache' : 'public, max-age=300' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found. Did you run "npm run build"?');
    }
  });

  // ---------------------------------------------------------------- WebSocket
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: MAX_MSG, perMessageDeflate: { threshold: 2048 } });
  const msgLimit = new RateLimiter(30, 60);
  const createLimit = new RateLimiter(3 / 60, 3);
  const joinGuard = new JoinGuard();

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress || '?';
    const conn = {
      id: newId(6),
      player: null,
      campaign: null,
      drop() {
        ws.terminate();
      },
      send(msg) {
        if (ws.readyState !== 1 || ws.bufferedAmount > 8_000_000) return;
        ws.send(JSON.stringify(msg));
      },
    };
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      if (!msgLimit.take(conn.id)) {
        conn.send({ t: 'error', message: 'Slow down', code: 'rate' });
        return;
      }
      let m;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!m || typeof m.t !== 'string') return;
      handle(conn, m, ip).catch((e) => {
        log.error('handler error', e);
        conn.send({ t: 'error', message: 'Server error', id: m.id });
      });
    });
    ws.on('close', () => {
      if (conn.campaign && conn.player) {
        const c = conn.campaign;
        c.detach(conn.player.id, conn);
        setTimeout(() => c.maybeUnload(), 60_000).unref();
      }
    });
    ws.on('error', () => {});
  });

  async function handle(conn, m, ip) {
    // identity first
    if (m.t === 'hello') {
      const name = String(m.name || 'Commander').replace(/[<>]/g, '').trim().slice(0, 24) || 'Commander';
      let rec = m.id && server.players[m.id];
      let secret = null;
      if (!rec || !m.secret || !safeEqual(hash(m.secret), rec.hash)) {
        const id = newId(9);
        secret = newSecret();
        rec = server.players[id] = { id, hash: hash(secret), name, created: Date.now() };
      }
      rec.name = name;
      rec.seen = Date.now();
      conn.player = { id: rec.id, name };
      if (devSecret && m.devKey && safeEqual(m.devKey, devSecret)) server.devSessions.add(rec.id);
      savePlayers();
      conn.send({ t: 'welcome', id: rec.id, secret, name, dev: server.isDev(rec.id), modes: MODES, maxPlayers: MAX_PLAYERS });
      return;
    }
    if (!conn.player) {
      conn.send({ t: 'error', message: 'Say hello first', code: 'auth' });
      return;
    }
    const me = conn.player;
    const c = conn.campaign;
    const reply = (res) => conn.send({ t: 'ack', id: m.id, res });
    switch (m.t) {
      case 'create': {
        if (!createLimit.take(me.id)) return reply({ ok: false, reason: 'Too many campaigns created; wait a minute' });
        if (c) c.leave(me.id);
        const camp = Campaign.create(server, me, m.settings || {});
        server.campaigns.set(camp.id, camp);
        server.registerCode(camp);
        await camp.join(me, conn);
        return reply({ ok: true, code: camp.meta.code, campaign: camp.id });
      }
      case 'join': {
        const key = `${me.id}|${ip}`;
        if (joinGuard.blocked(key)) return reply({ ok: false, reason: 'Too many failed attempts. Try again later.' });
        const code = normalizeCode(m.code);
        const camp = code && server.byCode.get(code);
        if (!camp) {
          joinGuard.fail(key);
          return reply({ ok: false, reason: code ? 'No campaign with that code' : 'Codes are 6 characters and never use 0, 1, I, L, O or U' });
        }
        const why = camp.canJoin(me, m.password);
        if (why) {
          joinGuard.fail(key);
          return reply({ ok: false, reason: why });
        }
        joinGuard.ok(key);
        if (c && c !== camp) c.leave(me.id);
        await camp.join(me, conn);
        return reply({ ok: true, campaign: camp.id, code: camp.meta.code });
      }
      case 'rejoin': {
        const camp = server.campaigns.get(m.campaign);
        if (!camp || !camp.member(me.id) || camp.meta.kicked.includes(me.id)) return reply({ ok: false, reason: 'Campaign not available' });
        if (c && c !== camp) c.leave(me.id);
        await camp.join(me, conn);
        return reply({ ok: true, campaign: camp.id, code: camp.meta.code });
      }
      case 'mine': {
        const list = [...server.campaigns.values()].filter((x) => x.member(me.id) && !x.meta.kicked.includes(me.id)).map((x) => ({ id: x.id, name: x.meta.name, code: x.meta.code, status: x.meta.status, turn: x.meta.turn, players: x.meta.members.length, country: x.member(me.id).country }));
        return conn.send({ t: 'mine', list });
      }
      default:
        break;
    }
    if (!c) return reply({ ok: false, reason: 'Join a campaign first' });
    const err = (why) => reply(why ? { ok: false, reason: why } : { ok: true });
    switch (m.t) {
      case 'leave':
        c.leave(me.id);
        return reply({ ok: true });
      case 'pick':
        return err(c.pick(me.id, m));
      case 'ready':
        if (c.meta.status === 'lobby') c.setReady(me.id, m.on);
        else c.ready(me.id, m.on !== false);
        return reply({ ok: true });
      case 'settings':
        return err(c.updateSettings(me.id, m.settings || {}));
      case 'start':
        return err(c.start(me.id));
      case 'kick':
        return err(c.kick(me.id, m.player));
      case 'regen':
        return err(c.regenerateCode(me.id));
      case 'chat':
        c.chat(me.id, m.text);
        return undefined;
      case 'cmd':
        c.command(me.id, m.id, m.cmd);
        return undefined;
      case 'end':
        c.ready(me.id, true);
        return undefined;
      case 'unready':
        c.ready(me.id, false);
        return undefined;
      case 'view':
        c.sendView(me.id);
        return undefined;
      case 'mpdev': {
        if (!server.isDev(me.id)) return reply({ ok: false, reason: 'Developer tools are not available' });
        log.warn(`[dev] ${me.name} ${m.op} in ${c.id}`);
        const r = c.devOp(me.id, m);
        return reply(typeof r === 'object' && r ? r : r ? { ok: false, reason: r } : { ok: true });
      }
      case 'team': {
        const mem = c.member(me.id);
        if (mem && c.meta.status === 'lobby') mem.team = m.team === 1 ? 1 : 0;
        c.broadcastLobby();
        return undefined;
      }
      default:
        return reply({ ok: false, reason: `Unknown message ${m.t}` });
    }
  }

  await new Promise((r) => httpServer.listen(port, r));
  const addr = httpServer.address();
  log.info(`[global-command] listening on http://localhost:${addr.port}`);
  const shutdown = async () => {
    for (const c of server.campaigns.values()) {
      c.stopTimers();
      if (c.game) c.persistAll();
    }
    await store.flush();
    wss.close();
    httpServer.close();
  };
  return { server, httpServer, wss, port: addr.port, shutdown };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const s = await startServer();
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      if (stopping) return;
      stopping = true;
      await s.shutdown();
      process.exit(0);
    });
  }
}

export { cleanSettings };
