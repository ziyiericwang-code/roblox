// In-memory persistence (tests, and a fallback when no durable store exists).
export class MemoryStore {
  constructor() {
    this.profiles = new Map();
    this.war = null;
    this.failNext = 0; // tests: number of upcoming saves that should fail
  }
  async loadProfile(id) {
    const p = this.profiles.get(id);
    return p ? JSON.parse(p) : null;
  }
  async saveProfile(id, data) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('simulated save failure');
    }
    this.profiles.set(id, JSON.stringify(data));
  }
  async loadWar() {
    return this.war ? JSON.parse(this.war) : null;
  }
  async saveWar(data) {
    this.war = JSON.stringify(data);
  }
  async hashToken(token) {
    // Non-cryptographic hash is fine for a local store; the Node store uses SHA-256.
    let h = 2166136261 >>> 0;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `m${(h >>> 0).toString(16)}`;
  }
}
