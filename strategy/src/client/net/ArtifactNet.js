// Multiplayer inside the Claude artifact: no server. The commander who creates a campaign
// hosts it: their browser runs the authoritative simulation. Campaign state and each
// commander's filtered view live in the artifact's shared `db`; requests and replies travel
// over a `room` channel named after the join code. Same surface as OnlineConnection, so the
// lobby and HUD work unchanged.
import { Game } from '../../sim/Game.js';
import { SCENARIOS } from '../../../config/scenario.js';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const MAX_PLAYERS = [2, 4, 6, 8, 12, 16];
const MODES = ['private', 'coop', 'teams', 'competitive', 'custom'];

export function normalizeCode(input) {
  if (typeof input !== 'string') return null;
  const c = input.toUpperCase().replace(/[\s-]/g, '');
  if (c.length !== 6 || [...c].some((ch) => !ALPHABET.includes(ch))) return null;
  return c;
}
function newCode() {
  const b = new Uint32Array(6);
  crypto.getRandomValues(b);
  return [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
}
const rid = () => Math.random().toString(36).slice(2, 10);

function cleanSettings(input = {}, prev = {}) {
  const s = { name: 'Global War', maxPlayers: 8, scenario: 'cold', mode: 'private', startRank: 0, turnTimer: 120, pace: 1, allowShared: false, joinInProgress: true, ...prev };
  const str = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
  if (input.name !== undefined) s.name = str(input.name, 40) || 'Global War';
  if (input.maxPlayers !== undefined) s.maxPlayers = MAX_PLAYERS.includes(Number(input.maxPlayers)) ? Number(input.maxPlayers) : 8;
  if (input.scenario !== undefined) s.scenario = SCENARIOS[input.scenario] ? input.scenario : 'cold';
  if (input.mode !== undefined) s.mode = MODES.includes(input.mode) ? input.mode : 'private';
  if (input.startRank !== undefined) s.startRank = Math.max(0, Math.min(51, Number(input.startRank) | 0));
  if (input.turnTimer !== undefined) s.turnTimer = Math.max(0, Math.min(900, Number(input.turnTimer) || 0));
  if (input.pace !== undefined) s.pace = [0.6, 1, 2, 3].includes(Number(input.pace)) ? Number(input.pace) : 1;
  if (input.allowShared !== undefined) s.allowShared = !!input.allowShared;
  if (input.joinInProgress !== undefined) s.joinInProgress = !!input.joinInProgress;
  return s;
}

// ------------------------------------------------------------ compression for view documents
async function pack(obj) {
  const json = JSON.stringify(obj);
  if (typeof CompressionStream === 'undefined') return { j: json };
  const buf = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { z: btoa(bin) };
}
async function unpack(d) {
  if (d.j) return JSON.parse(d.j);
  const bin = atob(d.z);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}

// ------------------------------------------------------------ host-local saves (IndexedDB)
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('global-command-mp', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('hosted');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function hostSave(code, data) {
  try {
    const d = await idb();
    const packed = await pack(data);
    await new Promise((res, rej) => {
      const tx = d.transaction('hosted', 'readwrite');
      tx.objectStore('hosted').put(packed, code);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    /* storage blocked: the campaign lives as long as this tab */
  }
}
async function hostLoad(code) {
  try {
    const d = await idb();
    const v = await new Promise((res, rej) => {
      const r = d.transaction('hosted', 'readonly').objectStore('hosted').get(code);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return v ? unpack(v) : null;
  } catch {
    return null;
  }
}

// One writer per document, only when changed: coalesce bursts into the latest body.
class DocWriter {
  constructor(ref) {
    this.ref = ref;
    this.busy = false;
    this.next = null;
  }
  write(body) {
    this.next = body;
    if (!this.busy) this.flush();
  }
  async flush() {
    this.busy = true;
    while (this.next) {
      const b = this.next;
      this.next = null;
      try {
        await this.ref.set(typeof b === 'function' ? await b() : b);
      } catch (e) {
        if (e && e.code === 'unavailable') await new Promise((r) => setTimeout(r, 500 + Math.random() * 800));
      }
    }
    this.busy = false;
  }
}

export class ArtifactOnline {
  constructor(world, nick) {
    this.world = world;
    this.nick = String(nick || 'Commander').slice(0, 24);
    this.online = true;
    this.handlers = new Set();
    this.pending = new Map();
    this.campaign = null;
    this.host = null; // HostCampaign when we host
    this.subs = [];
    this.ready = this.init();
  }

  async init() {
    const c = window.claude;
    const [db, room, user] = c && c.use ? await Promise.all([c.use('db'), c.use('room'), c.use('user')]) : [null, null, null];
    if (!db || !room || !user) throw new Error('Multiplayer needs this artifact open in claude.ai while signed in.');
    const id = await user.id();
    if (!id) throw new Error('Sign in to claude.ai to play multiplayer.');
    this.db = db;
    this.lobbyRoom = room;
    this.user = user;
    this.id = id;
    const me = await user.me();
    if (me.name && (!this.nick || this.nick === 'Commander')) this.nick = me.name.slice(0, 24);
    const w = { t: 'welcome', id, name: this.nick, dev: false };
    queueMicrotask(() => this.emit(w));
    return w;
  }

  // ---------------------------------------------------------------- connection surface
  emit(m) {
    for (const h of this.handlers) h(m);
  }
  on(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }
  raw(m) {
    this.request(m).then((r) => {
      if (r && r.ok === false && m.t !== 'chat') this.emit({ t: 'note', note: { kind: 'error', title: 'Refused', text: r.reason } });
    });
  }
  command(cmd) {
    return this.request({ t: 'cmd', cmd });
  }
  endTurn() {
    this.raw({ t: 'end' });
  }
  unready() {
    this.raw({ t: 'unready' });
  }
  send(m) {
    if (m.t === 'view') this.raw({ t: 'view' });
  }
  close() {
    this.detach();
    if (this.host) this.host.stop();
    this.host = null;
  }

  async request(m) {
    await this.ready;
    try {
      switch (m.t) {
        case 'hello':
          this.nick = String(m.name || this.nick).replace(/[<>]/g, '').slice(0, 24) || this.nick;
          return { ok: true };
        case 'mine':
          return this.listMine();
        case 'create':
          return this.create(m.settings || {});
        case 'join':
          return this.join(m.code);
        case 'rejoin':
          return this.join(m.campaign, true);
        default:
          break;
      }
      if (!this.campaign) return { ok: false, reason: 'Join a campaign first' };
      if (m.t === 'leave') {
        const r = this.host ? this.host.handle(this.id, m, this.nick) : await this.ask(m);
        this.detach();
        if (this.host) this.host.stop();
        this.host = null;
        return r || { ok: true };
      }
      if (this.host) return await this.host.handle(this.id, m, this.nick);
      return await this.ask(m);
    } catch (e) {
      return { ok: false, reason: e && e.message ? e.message : 'Something went wrong' };
    }
  }

  // guest -> host over the campaign room
  ask(m) {
    const id = rid();
    return new Promise((res) => {
      this.pending.set(id, res);
      this.gameRoom.emit('req', { id, m, nick: this.nick }).catch(() => {});
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          res({ ok: false, reason: 'The host did not answer. They may be offline.' });
        }
      }, 12000);
    });
  }

  async listMine() {
    const snap = await this.db.collection('camps').where('memberIds', 'array-contains', this.id).limit(50).get();
    const list = snap.docs.map((d) => d.data()).filter((c) => c && c.status !== 'ended').map((c) => ({ id: c.code, name: c.name, code: c.code, status: c.status, turn: c.turn, players: c.members.length, country: (c.members.find((x) => x.id === this.id) || {}).country }));
    this.emit({ t: 'mine', list });
    return { ok: true };
  }

  async create(settings) {
    let code = newCode();
    for (let i = 0; i < 5 && (await this.db.doc(`camps/${code}`).get()).exists; i++) code = newCode();
    const meta = { code, name: '', hostId: this.id, settings: cleanSettings(settings), status: 'lobby', members: [], memberIds: [], kicked: [], chat: [], turn: 0, created: Date.now(), turnState: null };
    meta.name = meta.settings.name;
    await this.attach(code);
    this.host = new HostCampaign(this, meta, null);
    this.host.handle(this.id, { t: 'join' }, this.nick);
    await this.host.writeMetaNow();
    return { ok: true, code, campaign: code };
  }

  async join(input, rejoin = false) {
    const code = normalizeCode(String(input || ''));
    if (!code) return { ok: false, reason: 'Codes are 6 characters and never use 0, 1, I, L, O or U' };
    const snap = await this.db.doc(`camps/${code}`).get();
    if (!snap.exists) return { ok: false, reason: 'No campaign with that code' };
    const meta = JSON.parse(JSON.stringify(snap.data()));
    if (meta.kicked && meta.kicked.includes(this.id)) return { ok: false, reason: 'You were removed from this campaign' };
    if (this.campaign && this.campaign !== code) await this.request({ t: 'leave' });
    // our own campaign: resume hosting from this device's save
    if (meta.hostId === this.id) {
      let game = null;
      if (meta.status === 'running') {
        const data = await hostLoad(code);
        if (!data) return { ok: false, reason: 'You host this campaign, but its save is on another device or browser. Open it there to resume.' };
        game = Game.load(this.world, data);
      }
      await this.attach(code);
      this.host = new HostCampaign(this, meta, game);
      this.host.handle(this.id, { t: 'join' }, this.nick);
      return { ok: true, campaign: code, code };
    }
    const member = meta.members.find((x) => x.id === this.id);
    if (!member) {
      if (meta.status !== 'lobby' && !meta.settings.joinInProgress) return { ok: false, reason: 'This campaign is closed to new commanders' };
      if (meta.members.length >= meta.settings.maxPlayers) return { ok: false, reason: 'The campaign is full' };
    }
    await this.attach(code);
    const hostHere = await this.waitFor(meta.hostId, 4000);
    if (!hostHere) {
      if (!member) {
        this.detach();
        return { ok: false, reason: 'The host is offline right now. Try again when they are back.' };
      }
      this.emit({ t: 'disconnected' });
      return { ok: true, campaign: code, code, note: 'host offline' };
    }
    const r = await this.ask({ t: 'join' });
    if (!r.ok) this.detach();
    return r.ok ? { ok: true, campaign: code, code, rejoin } : r;
  }

  waitFor(id, ms) {
    return new Promise((res) => {
      const has = () => this.gameRoom.peers().some((p) => p.by === id);
      if (has()) return res(true);
      const off = this.gameRoom.onPeers(() => {
        if (has()) {
          off();
          clearTimeout(t);
          res(true);
        }
      });
      const t = setTimeout(() => {
        off();
        res(has());
      }, ms);
    });
  }

  // join the campaign room and subscribe to its documents
  async attach(code) {
    this.detach();
    this.campaign = code;
    this.gameRoom = await this.lobbyRoom.join(`gc-${code.toLowerCase()}`);
    this.gameRoom.presence({ code }).catch(() => {});
    this.subs.push(
      this.gameRoom.on('res', (msg) => {
        const d = msg.data || {};
        if (d.to !== this.id) return;
        if (d.kicked) {
          this.emit({ t: 'kicked', message: 'The host removed you from the campaign' });
          this.detach();
          return;
        }
        const res = this.pending.get(d.id);
        if (res) {
          this.pending.delete(d.id);
          res(d.res);
        }
      }),
    );
    this.subs.push(
      this.gameRoom.on('req', (msg) => {
        if (!this.host || !msg.by || msg.isMe) return;
        const d = msg.data || {};
        Promise.resolve(this.host.handle(msg.by, d.m || {}, String(d.nick || 'Commander').slice(0, 24)))
          .then((res) => {
            let out = res || { ok: true };
            if (JSON.stringify(out).length > 3500) out = { ok: out.ok, reason: out.reason };
            return this.gameRoom.emit('res', { to: msg.by, id: d.id, res: out });
          })
          .catch(() => {});
      }),
    );
    let hostSeen = true;
    this.subs.push(
      this.gameRoom.onPeers(() => {
        const ids = new Set(this.gameRoom.peers().map((p) => p.by).filter(Boolean));
        this.onlineIds = ids;
        if (this.host) this.host.peersChanged(ids);
        else if (this.meta) {
          const here = ids.has(this.meta.hostId);
          if (here !== hostSeen) {
            hostSeen = here;
            this.emit(here ? { t: 'welcome', id: this.id, name: this.nick, dev: false } : { t: 'disconnected' });
            if (!here) this.emit({ t: 'note', note: { kind: 'lobby', title: 'The host went offline', text: 'The world is paused until they return.' } });
          }
          this.emitLobby();
        }
      }),
    );
    // campaign document: lobby, chat, turn state
    let firstView = true;
    let lastChat = null;
    this.subs.push(
      this.db.doc(`camps/${code}`).onSnapshot((snap) => {
        if (!snap.exists || this.host) return;
        const meta = snap.data();
        if (this.meta && !meta.memberIds.includes(this.id) && this.meta.memberIds.includes(this.id)) {
          this.emit({ t: 'kicked', message: 'You are no longer in this campaign' });
          this.detach();
          return;
        }
        this.meta = meta;
        this.emitLobby();
        if (meta.turnState) this.emitTurn(meta.turnState);
        const last = meta.chat[meta.chat.length - 1];
        if (last && lastChat && last.at !== lastChat.at) this.emitChat(last);
        lastChat = last || lastChat || { at: 0 };
      }),
    );
    // my view
    let lastSeq = -1;
    this.subs.push(
      this.db.doc(`views/${code}/p/${this.id}`).onSnapshot(async (snap) => {
        if (!snap.exists || this.host) return;
        const d = snap.data();
        if (d.seq === lastSeq) return;
        lastSeq = d.seq;
        try {
          const view = await unpack(d);
          this.emit({ t: 'view', view, started: firstView, turnDone: d.turnDone, ms: d.ms });
          firstView = false;
        } catch {
          /* a partial write; the next snapshot replaces it */
        }
      }),
    );
  }

  detach() {
    for (const off of this.subs) {
      try {
        off();
      } catch {
        /* already closed */
      }
    }
    this.subs = [];
    if (this.gameRoom) this.gameRoom.leave().catch(() => {});
    this.gameRoom = null;
    this.campaign = null;
    this.meta = null;
  }

  async names(ids) {
    const ps = await this.user.profiles(ids).catch(() => ({}));
    return (id, nick) => (ps[id] && ps[id].name) || nick || 'Commander';
  }

  async emitLobby(metaIn) {
    const meta = metaIn || this.meta;
    if (!meta) return;
    const online = this.onlineIds || new Set([this.id]);
    const name = await this.names(meta.members.map((m) => m.id));
    this.emit({
      t: 'lobby',
      lobby: {
        id: meta.code,
        code: meta.code,
        name: meta.name,
        hostId: meta.hostId,
        actingHost: meta.hostId,
        status: meta.status,
        turn: meta.turn,
        settings: { ...meta.settings, hasPassword: false },
        members: meta.members.map((x) => ({ id: x.id, name: name(x.id, x.nick), country: x.country, serve: x.serve, ready: x.ready, online: online.has(x.id) || x.id === this.id, role: x.id === meta.hostId ? 'host' : 'member', left: !!x.left })),
        chat: meta.chat.slice(-40).map((c) => ({ ...c, from: name(c.id, c.nick) })),
      },
    });
  }
  emitTurn(ts) {
    this.emit({ t: 'turn', phase: ts.phase, turn: ts.turn, left: ts.deadline ? Math.max(0, ts.deadline - Date.now()) : 0, ready: ts.ready || [], online: ts.online || [] });
  }
  async emitChat(c) {
    const name = await this.names([c.id]);
    this.emit({ t: 'chat', msg: { ...c, from: name(c.id, c.nick) } });
  }
}

// ---------------------------------------------------------------- the host's campaign
class HostCampaign {
  constructor(net, meta, game) {
    this.net = net;
    this.meta = meta;
    this.game = game;
    this.readySet = new Set();
    this.deadline = 0;
    this.timer = null;
    this.dirty = new Set();
    this.dirtyTimer = null;
    this.seq = {};
    this.metaDoc = new DocWriter(net.db.doc(`camps/${meta.code}`));
    this.viewDocs = new Map();
    this.online = new Set([net.id]);
    this.resolving = false;
    this.stopped = false;
    net.meta = meta;
    if (game) {
      for (const p of Object.values(game.s.players)) {
        p.online = p.id === net.id;
        p.away = !p.online;
      }
      queueMicrotask(() => {
        this.sendOwnView({ started: true });
        this.publishAllViews();
        this.scheduleTurn(true);
      });
    }
    this.publishMeta();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.dirtyTimer);
  }

  member(id) {
    return this.meta.members.find((m) => m.id === id);
  }

  // every request from any commander (the host included) lands here
  handle(pid, m, nick) {
    const meta = this.meta;
    const g = this.game;
    const fail = (reason) => ({ ok: false, reason });
    if (m.t === 'join') {
      if (meta.kicked.includes(pid)) return fail('You were removed from this campaign');
      let mem = this.member(pid);
      if (!mem) {
        if (meta.status !== 'lobby' && !meta.settings.joinInProgress) return fail('This campaign is closed to new commanders');
        if (meta.members.length >= meta.settings.maxPlayers) return fail('The campaign is full');
        mem = { id: pid, nick, country: null, serve: null, ready: false, team: meta.members.length % 2, joined: Date.now() };
        meta.members.push(mem);
        meta.memberIds = meta.members.map((x) => x.id);
        this.note(`${nick} joined the campaign`);
      }
      mem.nick = nick || mem.nick;
      mem.left = false;
      if (g && g.s.players[pid]) {
        const gp = g.s.players[pid];
        if (gp.standing === 'ai' && mem.leftAt) gp.standing = 'defensive';
      }
      this.publishMeta();
      if (g && g.s.players[pid]) this.publishView(pid, { started: true });
      return { ok: true, campaign: meta.code, code: meta.code };
    }
    const mem = this.member(pid);
    if (!mem) return fail('Not a member of this campaign');
    switch (m.t) {
      case 'leave':
        if (pid === meta.hostId) {
          // the host leaving a lobby closes it; a running world pauses until they return
          if (meta.status === 'lobby') meta.status = 'ended';
          this.publishMeta();
          return { ok: true };
        }
        if (meta.status === 'lobby') {
          meta.members = meta.members.filter((x) => x.id !== pid);
          meta.memberIds = meta.members.map((x) => x.id);
        } else if (g && g.s.players[pid]) {
          g.s.players[pid].standing = 'ai';
          mem.left = true;
          mem.leftAt = Date.now();
        }
        this.readySet.delete(pid);
        this.note(`${mem.nick} left the campaign`);
        this.publishMeta();
        return { ok: true };
      case 'pick': {
        const late = meta.status === 'running' && g && !g.s.players[pid];
        if (meta.status !== 'lobby' && !late) return fail('The campaign has already started');
        const w = this.net.world;
        if (m.serve) {
          const lord = this.member(m.serve);
          if (!lord || lord.id === pid || lord.country === null || lord.serve) return fail('That commander has not picked a nation');
          mem.serve = lord.id;
          mem.country = lord.country;
        } else {
          const c = Number(m.country);
          if (!Number.isInteger(c) || c < 0 || c >= w.countries.length || !w.provincesOf[c].length) return fail('Unknown country');
          const taken = meta.members.find((x) => x.id !== pid && x.country === c && !x.serve);
          if (taken && !meta.settings.allowShared) return fail(`${w.countries[c].name} is already taken by ${taken.nick}`);
          mem.country = c;
          mem.serve = null;
          for (const x of meta.members) if (x.serve === pid) x.country = c;
        }
        mem.ready = false;
        if (late) {
          this.addToGame(mem);
          this.note(`${mem.nick} takes command`, w.countries[mem.country].name);
          this.publishView(pid, { started: true });
          this.markAllDirty();
        }
        this.publishMeta();
        return { ok: true };
      }
      case 'ready':
        if (meta.status === 'lobby') {
          mem.ready = !!m.on;
          this.publishMeta();
        } else this.setReady(pid, m.on !== false);
        return { ok: true };
      case 'end':
        this.setReady(pid, true);
        return { ok: true };
      case 'unready':
        this.setReady(pid, false);
        return { ok: true };
      case 'settings':
        if (pid !== meta.hostId) return fail('Only the host can change settings');
        if (meta.status !== 'lobby') return fail('Settings are locked once the campaign starts');
        meta.settings = cleanSettings(m.settings || {}, meta.settings);
        meta.name = meta.settings.name;
        this.publishMeta();
        return { ok: true };
      case 'team':
        if (meta.status === 'lobby') mem.team = m.team === 1 ? 1 : 0;
        this.publishMeta();
        return { ok: true };
      case 'kick': {
        if (pid !== meta.hostId || m.player === pid) return fail('Only the host can remove commanders');
        const target = this.member(m.player);
        if (!target) return fail('Unknown commander');
        this.handle(m.player, { t: 'leave' }, target.nick);
        meta.kicked.push(m.player);
        meta.memberIds = meta.members.filter((x) => !meta.kicked.includes(x.id)).map((x) => x.id);
        this.publishMeta();
        this.net.gameRoom && this.net.gameRoom.emit('res', { to: m.player, kicked: true }).catch(() => {});
        return { ok: true };
      }
      case 'regen':
        return fail('Codes are permanent in this edition. Start a new campaign for a fresh code.');
      case 'chat': {
        const text = String(m.text || '').replace(/[<>]/g, '').trim().slice(0, 300);
        if (!text) return { ok: true };
        meta.chat.push({ id: pid, nick: mem.nick, text, at: Date.now() });
        if (meta.chat.length > 60) meta.chat.splice(0, meta.chat.length - 60);
        this.publishMeta();
        if (pid !== this.net.id) this.net.emitChat(meta.chat[meta.chat.length - 1]);
        return { ok: true };
      }
      case 'start':
        return this.start(pid);
      case 'view':
        if (g && g.s.players[pid]) this.publishView(pid);
        return { ok: true };
      case 'cmd':
        return this.command(pid, m.cmd);
      default:
        return fail(`Unknown request ${m.t}`);
    }
  }

  start(pid) {
    const meta = this.meta;
    if (pid !== meta.hostId) return { ok: false, reason: 'Only the host can start' };
    if (meta.status !== 'lobby') return { ok: false, reason: 'Already started' };
    const unpicked = meta.members.filter((m) => m.country === null);
    if (unpicked.length) return { ok: false, reason: `Waiting for ${unpicked.map((m) => m.nick).join(', ')} to pick a nation` };
    const s = meta.settings;
    this.game = Game.create(this.net.world, { scenario: s.scenario, pace: s.pace, mode: s.mode, seed: Math.floor(Math.random() * 2 ** 31) });
    this.applyMode();
    for (const m of meta.members) this.addToGame(m);
    meta.status = 'running';
    meta.startedAt = Date.now();
    this.note('The campaign has begun');
    this.publishMeta();
    this.sendOwnView({ started: true });
    this.publishAllViews({ started: true });
    this.save();
    this.scheduleTurn(true);
    return { ok: true };
  }

  applyMode() {
    const g = this.game;
    const s = this.meta.settings;
    const countries = [...new Set(this.meta.members.map((m) => m.country))];
    if (s.mode === 'coop') for (const a of countries) for (const b of countries) if (a !== b) {
      g.s.alliance[a * g.C + b] = 1;
      g.s.rel[a * g.C + b] = 80;
    }
    if (s.mode === 'teams') {
      const teams = [[], []];
      this.meta.members.forEach((m, i) => teams[m.team ?? i % 2].push(m.country));
      for (const team of teams) for (const a of team) for (const b of team) if (a !== b) g.s.alliance[a * g.C + b] = 1;
      g.s.teams = teams;
    }
  }

  addToGame(m) {
    const g = this.game;
    let rank = this.meta.settings.startRank;
    const others = Object.values(g.s.players).filter((p) => p.country === m.country);
    if (others.some((p) => p.rank >= 49)) rank = Math.min(rank, 43);
    if (m.serve) rank = Math.min(rank, 36);
    const p = g.addPlayer(m.id, { name: m.nick, country: m.country, rank });
    p.online = this.online.has(m.id);
    p.away = !p.online;
    if (m.serve) p.serves = m.serve;
  }

  command(pid, cmd) {
    const g = this.game;
    if (!g || this.meta.status !== 'running') return { ok: false, reason: 'The campaign is not running' };
    if (this.resolving) return { ok: false, reason: 'The turn is resolving' };
    if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') return { ok: false, reason: 'Malformed command' };
    if (cmd.type === 'dev') return { ok: false, reason: 'Developer tools are not available' };
    const mode = this.meta.settings.mode;
    if (mode === 'competitive' && (cmd.type === 'grant' || (cmd.type === 'empire' && cmd.op === 'contribute'))) return { ok: false, reason: 'Not allowed in competitive mode' };
    if (mode === 'teams' && cmd.type === 'propose' && cmd.kind === 'alliance') {
      const team = (g.s.teams || []).find((t) => t.includes(g.s.players[pid]?.country));
      if (team && !team.includes(Number(cmd.target))) return { ok: false, reason: 'Team war: alliances only inside your team' };
    }
    if (!g.s.players[pid]) {
      const mem = this.member(pid);
      if (mem && mem.country !== null) this.addToGame(mem);
      else return { ok: false, reason: 'Pick a nation first' };
    }
    const res = g.submit(pid, cmd);
    if (res.ok) {
      if (cmd.type === 'empire' && cmd.op === 'found') {
        const e = (g.s.empires || []).find((x) => x.emperor === pid);
        if (e) for (const p of Object.values(g.s.players)) if (p.serves === pid && !e.officers.some((o) => o.player === p.id)) e.officers.push({ player: p.id, title: 'officer', since: g.s.turn });
      }
      this.publishView(pid);
      this.markAllDirty();
    }
    return res;
  }

  // ---------------------------------------------------------------- turns
  setReady(pid, on) {
    if (!this.game || this.meta.status !== 'running') return;
    if (on) this.readySet.add(pid);
    else this.readySet.delete(pid);
    this.publishTurnState();
    this.scheduleTurn();
  }
  onlinePlayers() {
    return [...this.online].filter((id) => this.game && this.game.s.players[id]);
  }
  scheduleTurn(fresh = false) {
    if (!this.game || this.meta.status !== 'running' || this.resolving || this.stopped) return;
    const online = this.onlinePlayers();
    if (online.length && online.every((id) => this.readySet.has(id))) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.resolveTurn(), 200);
      return;
    }
    const T = this.meta.settings.turnTimer;
    if (T > 0 && (fresh || !this.deadline)) {
      clearTimeout(this.timer);
      this.deadline = Date.now() + T * 1000;
      this.timer = setTimeout(() => this.resolveTurn(), T * 1000);
    }
    this.publishTurnState();
  }
  resolveTurn() {
    if (!this.game || this.resolving || this.stopped) return;
    this.resolving = true;
    clearTimeout(this.timer);
    this.publishTurnState();
    let ms = 0;
    try {
      ms = this.game.endTurn();
    } catch (e) {
      console.error('turn failed', e);
    }
    this.meta.turn = this.game.s.turn;
    this.readySet.clear();
    this.deadline = 0;
    this.resolving = false;
    this.sendOwnView({ turnDone: true, ms });
    this.publishAllViews({ turnDone: true, ms });
    this.save();
    this.scheduleTurn(true);
    this.publishTurnState();
  }
  turnState() {
    return { phase: this.resolving ? 'resolving' : 'planning', turn: this.game ? this.game.s.turn : 0, deadline: this.deadline || 0, ready: [...this.readySet], online: this.onlinePlayers() };
  }
  publishTurnState() {
    const ts = this.turnState();
    this.meta.turnState = ts;
    this.net.emitTurn(ts);
    this.publishMeta();
  }

  peersChanged(ids) {
    ids.add(this.net.id);
    const before = this.online;
    this.online = ids;
    const g = this.game;
    if (g) {
      for (const p of Object.values(g.s.players)) {
        const on = ids.has(p.id);
        if (on !== before.has(p.id) && p.id !== this.net.id) {
          const mem = this.member(p.id);
          if (mem) this.note(on ? `${mem.nick} is back` : `${mem.nick} disconnected`, on ? '' : 'Their forces follow standing orders.');
          if (on) this.publishView(p.id);
        }
        p.online = on;
        p.away = !on;
      }
      for (const id of [...this.readySet]) if (!ids.has(id)) this.readySet.delete(id);
      this.scheduleTurn();
    }
    this.net.emitLobby(this.meta);
  }

  // ---------------------------------------------------------------- replication
  sendOwnView(extra = {}) {
    const g = this.game;
    if (!g || !g.s.players[this.net.id]) return;
    this.net.emit({ t: 'view', view: g.view(this.net.id), ...extra });
  }
  publishView(pid, extra = {}) {
    const g = this.game;
    if (!g || !g.s.players[pid]) return;
    if (pid === this.net.id) return this.sendOwnView(extra);
    this.dirty.delete(pid);
    let w = this.viewDocs.get(pid);
    if (!w) {
      w = new DocWriter(this.net.db.doc(`views/${this.meta.code}/p/${pid}`));
      this.viewDocs.set(pid, w);
    }
    this.seq[pid] = (this.seq[pid] || 0) + 1;
    const seq = this.seq[pid];
    // compute lazily so a burst of changes writes only the latest view
    w.write(async () => ({ ...(await pack(g.view(pid))), seq, turn: g.s.turn, turnDone: !!extra.turnDone, ms: extra.ms || 0, at: Date.now() }));
    return undefined;
  }
  publishAllViews(extra = {}) {
    if (!this.game) return;
    for (const pid of Object.keys(this.game.s.players)) if (pid !== this.net.id) this.publishView(pid, extra);
  }
  markAllDirty() {
    if (!this.game) return;
    for (const pid of Object.keys(this.game.s.players)) if (pid !== this.net.id && this.online.has(pid)) this.dirty.add(pid);
    this.dirty.add(this.net.id);
    if (this.dirtyTimer) return;
    this.dirtyTimer = setTimeout(() => {
      this.dirtyTimer = null;
      for (const pid of [...this.dirty]) this.publishView(pid);
      this.dirty.clear();
    }, 2500);
  }
  publishMeta() {
    if (this.stopped) return;
    this.metaDoc.write(() => JSON.parse(JSON.stringify(this.meta)));
    this.net.emitLobby(this.meta);
  }
  writeMetaNow() {
    return this.net.db.doc(`camps/${this.meta.code}`).set(JSON.parse(JSON.stringify(this.meta)));
  }
  note(title, text = '') {
    if (this.game) this.game.notify('all', { kind: 'lobby', title, text });
    this.net.emit({ t: 'note', note: { kind: 'lobby', title, text } });
  }
  save() {
    if (this.game) hostSave(this.meta.code, this.game.save());
  }
}
