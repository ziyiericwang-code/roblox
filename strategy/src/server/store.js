// Durable file persistence for campaigns and player identities.
// Atomic writes (temp + rename) with a .bak of the previous version; gzip for snapshots.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

export class FileStore {
  constructor(dir) {
    this.dir = dir;
    this.queues = new Map();
  }
  async init() {
    await fs.mkdir(join(this.dir, 'campaigns'), { recursive: true });
  }
  file(...parts) {
    return join(this.dir, ...parts.map((p) => String(p).replace(/[^A-Za-z0-9_.-]/g, '_')));
  }
  async readJson(path) {
    try {
      return JSON.parse(await fs.readFile(path, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      try {
        return JSON.parse(await fs.readFile(`${path}.bak`, 'utf8'));
      } catch {
        throw e;
      }
    }
  }
  write(path, data, { gzip = false } = {}) {
    const prev = this.queues.get(path) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => this.writeNow(path, data, gzip));
    this.queues.set(path, next);
    next.finally(() => {
      if (this.queues.get(path) === next) this.queues.delete(path);
    });
    return next;
  }
  async writeNow(path, data, gzip) {
    const body = gzip ? gzipSync(JSON.stringify(data)) : JSON.stringify(data);
    const tmp = `${path}.${process.pid}.tmp`;
    let err;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await fs.mkdir(join(path, '..'), { recursive: true });
        await fs.writeFile(tmp, body);
        await fs.copyFile(path, `${path}.bak`).catch(() => {});
        await fs.rename(tmp, path);
        return;
      } catch (e) {
        err = e;
        await new Promise((r) => setTimeout(r, 80 * 2 ** attempt));
      }
    }
    throw err;
  }
  // ---------------------------------------------------------------- campaigns
  campaignDir(id) {
    return this.file('campaigns', id);
  }
  saveCampaignMeta(id, meta) {
    return this.write(join(this.campaignDir(id), 'campaign.json'), meta);
  }
  saveSnapshot(id, data) {
    return this.write(join(this.campaignDir(id), 'snapshot.json.gz'), data, { gzip: true });
  }
  async loadSnapshot(id) {
    const path = join(this.campaignDir(id), 'snapshot.json.gz');
    for (const p of [path, `${path}.bak`]) {
      try {
        return JSON.parse(gunzipSync(await fs.readFile(p)).toString('utf8'));
      } catch (e) {
        if (e.code === 'ENOENT' && p === path) continue;
      }
    }
    return null;
  }
  async appendJournal(id, entry) {
    await fs.appendFile(join(this.campaignDir(id), 'journal.jsonl'), `${JSON.stringify(entry)}\n`).catch(() => {});
  }
  async readJournal(id) {
    try {
      const txt = await fs.readFile(join(this.campaignDir(id), 'journal.jsonl'), 'utf8');
      return txt.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }
  async clearJournal(id) {
    await fs.writeFile(join(this.campaignDir(id), 'journal.jsonl'), '').catch(() => {});
  }
  async listCampaigns() {
    const out = [];
    let dirs = [];
    try {
      dirs = await fs.readdir(join(this.dir, 'campaigns'));
    } catch {
      return out;
    }
    for (const d of dirs) {
      const meta = await this.readJson(join(this.dir, 'campaigns', d, 'campaign.json')).catch(() => null);
      if (meta) out.push(meta);
    }
    return out;
  }
  async deleteCampaign(id) {
    await fs.rm(this.campaignDir(id), { recursive: true, force: true });
  }
  // ---------------------------------------------------------------- identities
  loadPlayers() {
    return this.readJson(this.file('players.json'));
  }
  savePlayers(data) {
    return this.write(this.file('players.json'), data);
  }
  async flush() {
    await Promise.allSettled([...this.queues.values()]);
  }
}
