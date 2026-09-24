// Frontline Command multiplayer server: static client hosting + WebSocket
// transport + authoritative simulation + durable persistence.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { generateWorld } from '../shared/world/layout.js';
import { WORLD_SEED, GAME_NAME, PROTOCOL_VERSION } from '../shared/constants.js';
import { Game } from '../sim/Game.js';
import { FileStore } from './FileStore.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(root, 'dist');
const PORT = Number(process.env.PORT) || 3000;
const DATA = process.env.DATA_DIR || join(root, 'data');
const MAX_MSG = 16 * 1024;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

export async function startServer({ port = PORT, dataDir = DATA, quiet = false } = {}) {
  const log = quiet ? { log() {}, info() {}, warn() {}, error: console.error } : console;
  const t0 = Date.now();
  const world = generateWorld(WORLD_SEED, { nav: true });
  log.info(`[${GAME_NAME}] world generated in ${Date.now() - t0} ms (${world.colliders.count} colliders, ${world.trees.length} trees)`);
  const store = new FileStore(dataDir);
  await store.init();
  const game = new Game({ world, store, log, options: {} });
  await game.init();
  game.start();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/api/info') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ name: GAME_NAME, multiplayer: true, protocol: PROTOCOL_VERSION, players: game.playersOnline(), tickMs: Math.round(game.tickMsAvg * 100) / 100, npcs: game.npc.combatCount(), campaign: game.war.campaign }));
        return;
      }
      let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (!p || p.endsWith('/')) p += 'index.html';
      const file = join(DIST, p);
      if (!file.startsWith(DIST)) {
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

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG, perMessageDeflate: false });
  wss.on('connection', (ws) => {
    const handlers = { msg: null, close: null };
    const conn = {
      send(msg) {
        if (ws.readyState !== 1) return;
        if (ws.bufferedAmount > 2_000_000) return; // slow client: drop instead of ballooning memory
        ws.send(msg instanceof ArrayBuffer ? Buffer.from(msg) : JSON.stringify(msg));
      },
      close() {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      },
      onMessage(fn) {
        handlers.msg = fn;
      },
      onClose(fn) {
        handlers.close = fn;
      },
    };
    game.addConnection(conn);
    ws.on('message', (data, isBinary) => {
      if (isBinary || !handlers.msg) return;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      handlers.msg(msg);
    });
    ws.on('close', () => handlers.close && handlers.close());
    ws.on('error', () => {});
  });

  await new Promise((r) => server.listen(port, r));
  const addr = server.address();
  log.info(`[${GAME_NAME}] listening on http://localhost:${addr.port}`);

  const shutdown = async () => {
    log.info('shutting down: saving profiles and war state...');
    await game.shutdown();
    await store.flush();
    wss.close();
    server.close();
  };
  return { server, game, wss, store, port: addr.port, shutdown };
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
