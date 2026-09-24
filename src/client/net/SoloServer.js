// Solo mode: the full authoritative simulation runs in the browser with a
// localStorage-backed store, so the game is playable without any server.
import { Game } from '../../sim/Game.js';
import { createLocalPair } from './Transport.js';

export class LocalStorageStore {
  constructor(prefix = 'frontline.') {
    this.prefix = prefix;
  }
  get(key) {
    try {
      const v = localStorage.getItem(this.prefix + key);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  }
  set(key, value) {
    // throws on quota errors so the Game's retry logic can handle it
    localStorage.setItem(this.prefix + key, JSON.stringify(value));
  }
  async loadProfile(id) {
    return this.get(`profile.${id}`);
  }
  async saveProfile(id, data) {
    this.set(`profile.${id}`, data);
  }
  async loadWar() {
    return this.get('war');
  }
  async saveWar(data) {
    this.set('war', data);
  }
  async hashToken(token) {
    if (crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 2166136261 >>> 0;
    for (let i = 0; i < token.length; i++) h = Math.imul(h ^ token.charCodeAt(i), 16777619);
    return `f${(h >>> 0).toString(16)}`;
  }
}

// sandbox: a separate offline world and career where the player is an admin
export async function startSolo(world, { sandbox = false } = {}) {
  const store = new LocalStorageStore(sandbox ? 'frontline.sandbox.' : 'frontline.');
  const game = new Game({ world, store, log: console, options: { solo: true, sandbox } });
  await game.init();
  game.start();
  const { client, server } = createLocalPair();
  game.addConnection(server);
  window.addEventListener('beforeunload', () => {
    // best-effort synchronous-ish save of everything
    for (const s of game.sessions) {
      if (s.profile) {
        try {
          store.set(`profile.${s.id}`, s.profile);
        } catch {
          /* quota */
        }
      }
    }
    try {
      store.set('war', game.war.serialize());
    } catch {
      /* quota */
    }
  });
  return { transport: client, game };
}
