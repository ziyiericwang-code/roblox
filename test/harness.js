// Headless test harness: builds a world, a game and scripted fake clients.
import { generateWorld } from '../src/shared/world/layout.js';
import { Game } from '../src/sim/Game.js';
import { MemoryStore } from '../src/sim/MemoryStore.js';
import { decodeSnapshot } from '../src/shared/protocol.js';

let cachedWorld = null;
export function getWorld() {
  if (!cachedWorld) cachedWorld = generateWorld(1947, { nav: true });
  return cachedWorld;
}

export function quietLog() {
  const errors = [];
  return {
    errors,
    log: () => {},
    info: () => {},
    warn: () => {},
    error: (...a) => errors.push(a.map(String).join(' ')),
  };
}

export async function makeGame(opts = {}) {
  const world = getWorld();
  const store = opts.store || new MemoryStore();
  const log = opts.log || quietLog();
  const game = new Game({ world, store, log, options: { solo: true, ...(opts.options || {}) } });
  await game.init();
  return { game, store, log, world };
}

// A fake transport connection that records everything the server sends.
export class FakeConn {
  constructor() {
    this.sent = [];
    this.snaps = 0;
    this.lastSnap = null;
    this.closed = false;
    this.handlers = {};
  }
  send(msg) {
    if (msg instanceof ArrayBuffer) {
      this.snaps++;
      this.lastSnap = decodeSnapshot(msg);
      return;
    }
    this.sent.push(msg);
  }
  close() {
    this.closed = true;
    if (this.handlers.close) this.handlers.close();
  }
  onMessage(fn) {
    this.handlers.msg = fn;
  }
  onClose(fn) {
    this.handlers.close = fn;
  }
  deliver(msg) {
    this.handlers.msg(msg);
  }
  of(type) {
    return this.sent.filter((m) => m.t === type);
  }
  last(type) {
    const l = this.of(type);
    return l[l.length - 1];
  }
  events() {
    return this.of('ev').flatMap((m) => m.e);
  }
}

export async function connect(game, id, name = 'Tester', token = 'token-token-token-1234') {
  if (id.length < 8) id = `${id}_player`; // profile ids must be 8-48 chars
  const conn = new FakeConn();
  const session = game.addConnection(conn);
  conn.deliver({ t: 'hello', id, token, name });
  // wait for async hello
  for (let i = 0; i < 50 && !session.profile; i++) await new Promise((r) => setTimeout(r, 2));
  if (!session.profile) throw new Error(`hello failed for ${id}: ${JSON.stringify(conn.last('reject'))}`);
  return { conn, session };
}

export function run(game, seconds, dt = 0.05, each) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    game.step(dt);
    if (each) each(i);
  }
}
