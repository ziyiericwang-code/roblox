// Durable JSON persistence for the Node server.
// - atomic writes (temp file + rename) so a crash never leaves half a profile
// - per-key write queue so concurrent saves of one profile are serialised
// - retries with exponential backoff on transient I/O errors
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export class FileStore {
  constructor(dir) {
    this.dir = dir;
    this.queues = new Map();
  }

  async init() {
    await fs.mkdir(join(this.dir, 'players'), { recursive: true });
  }

  pathFor(key) {
    const safe = key.replace(/[^A-Za-z0-9_-]/g, '_');
    return join(this.dir, safe === 'war' ? 'war.json' : join('players', `${safe}.json`));
  }

  async read(key) {
    try {
      const txt = await fs.readFile(this.pathFor(key), 'utf8');
      return JSON.parse(txt);
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      // corrupted main file: fall back to the last good backup
      try {
        const txt = await fs.readFile(`${this.pathFor(key)}.bak`, 'utf8');
        return JSON.parse(txt);
      } catch {
        throw e;
      }
    }
  }

  write(key, data) {
    const prev = this.queues.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => this.writeNow(key, data));
    this.queues.set(key, next);
    next.finally(() => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    });
    return next;
  }

  async writeNow(key, data) {
    const file = this.pathFor(key);
    const tmp = `${file}.${process.pid}.tmp`;
    const body = JSON.stringify(data);
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await fs.writeFile(tmp, body, 'utf8');
        try {
          await fs.copyFile(file, `${file}.bak`);
        } catch {
          /* first save has no previous file */
        }
        await fs.rename(tmp, file);
        return;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      }
    }
    throw lastErr;
  }

  loadProfile(id) {
    return this.read(`p_${id}`);
  }
  saveProfile(id, data) {
    return this.write(`p_${id}`, data);
  }
  loadWar() {
    return this.read('war');
  }
  saveWar(data) {
    return this.write('war', data);
  }
  async hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
  }
  async flush() {
    await Promise.allSettled([...this.queues.values()]);
  }
}
