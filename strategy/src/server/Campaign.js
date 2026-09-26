// A multiplayer campaign: lobby, country assignment, the authoritative Game, simultaneous
// turns with a timer, disconnect automation, persistence and per-player replication.
import { Game } from '../sim/Game.js';
import { SCENARIOS } from '../../config/scenario.js';
import { START_RANKS } from '../../config/ranks.js';
import { newCode, hash, safeEqual } from './codes.js';

export const MAX_PLAYERS = [2, 4, 6, 8, 12, 16];
export const MODES = {
  private: { name: 'Private multiplayer', text: 'Free diplomacy between commanders.' },
  coop: { name: 'Allied co-op', text: 'All commanders start allied against the AI world.' },
  teams: { name: 'Team war', text: 'Two teams; alliances only inside your team.' },
  competitive: { name: 'Competitive', text: 'Fixed start rank, no delegation of control.' },
  custom: { name: 'Custom', text: 'Every option is yours to set.' },
};

export function cleanSettings(input = {}, prev = {}) {
  const s = { ...prev };
  const str = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
  if (input.name !== undefined) s.name = str(input.name, 40) || 'Global War';
  if (input.maxPlayers !== undefined) s.maxPlayers = MAX_PLAYERS.includes(Number(input.maxPlayers)) ? Number(input.maxPlayers) : 8;
  if (input.scenario !== undefined) s.scenario = SCENARIOS[input.scenario] ? input.scenario : 'cold';
  if (input.mode !== undefined) s.mode = MODES[input.mode] ? input.mode : 'private';
  if (input.startRank !== undefined) s.startRank = START_RANKS.some((r) => r.rank === Number(input.startRank)) ? Number(input.startRank) : 0;
  if (input.turnTimer !== undefined) s.turnTimer = Math.max(0, Math.min(900, Number(input.turnTimer) || 0));
  if (input.pace !== undefined) s.pace = [0.6, 1, 2, 3].includes(Number(input.pace)) ? Number(input.pace) : 1;
  if (input.allowShared !== undefined) s.allowShared = !!input.allowShared;
  if (input.nukes !== undefined) s.nukes = input.nukes !== false;
  if (input.aggression !== undefined) s.aggression = [0.5, 1, 1.6].includes(Number(input.aggression)) ? Number(input.aggression) : 1;
  if (input.joinInProgress !== undefined) s.joinInProgress = !!input.joinInProgress;
  if (input.pauseWhenEmpty !== undefined) s.pauseWhenEmpty = !!input.pauseWhenEmpty;
  if (input.password !== undefined) s.passwordHash = input.password ? hash(`gc:${input.password}`) : null;
  return {
    name: 'Global War',
    maxPlayers: 8,
    scenario: 'cold',
    mode: 'private',
    startRank: 0,
    turnTimer: 120,
    pace: 1,
    allowShared: false,
    joinInProgress: true,
    pauseWhenEmpty: true,
    passwordHash: null,
    ...s,
  };
}

export class Campaign {
  constructor(server, meta) {
    this.server = server;
    this.meta = meta;
    this.game = null;
    this.conns = new Map(); // playerId -> conn
    this.readySet = new Set();
    this.deadline = 0;
    this.timer = null;
    this.viewTimer = null;
    this.dirtyViews = new Set();
    this.resolving = false;
  }

  static create(server, host, input) {
    const settings = cleanSettings(input);
    const meta = {
      id: server.newCampaignId(),
      code: newCode(server.codeSet()),
      name: settings.name,
      hostId: host.id,
      settings,
      status: 'lobby',
      members: [],
      kicked: [],
      chat: [],
      created: Date.now(),
      turn: 0,
      dev: false,
    };
    const c = new Campaign(server, meta);
    return c;
  }

  get id() {
    return this.meta.id;
  }
  member(id) {
    return this.meta.members.find((m) => m.id === id);
  }
  online(id) {
    return this.conns.has(id);
  }
  actingHost() {
    if (this.online(this.meta.hostId)) return this.meta.hostId;
    const m = this.meta.members.find((x) => this.online(x.id));
    return m ? m.id : this.meta.hostId;
  }
  isHost(id) {
    return id === this.meta.hostId || (id === this.actingHost() && !this.online(this.meta.hostId));
  }

  // ---------------------------------------------------------------- membership
  canJoin(player, password) {
    const m = this.meta;
    if (m.kicked.includes(player.id)) return 'You were removed from this campaign';
    if (this.member(player.id)) return null;
    if (m.status === 'ended') return 'This campaign has ended';
    if (m.status !== 'lobby' && !m.settings.joinInProgress) return 'This campaign is closed to new commanders';
    if (m.members.length >= m.settings.maxPlayers) return 'The campaign is full';
    if (m.settings.passwordHash && !safeEqual(hash(`gc:${password || ''}`), m.settings.passwordHash)) return 'Wrong password';
    return null;
  }

  async join(player, conn) {
    let m = this.member(player.id);
    if (!m) {
      m = { id: player.id, name: player.name, country: null, serve: null, ready: false, joined: Date.now(), role: this.meta.members.length ? 'member' : 'host' };
      this.meta.members.push(m);
      this.note('all', { kind: 'lobby', title: `${player.name} joined the campaign`, text: '' });
    }
    m.name = player.name;
    this.attach(player, conn);
    if (this.meta.status === 'running' && !this.game) await this.loadGame();
    if (this.meta.status === 'running' && this.game) {
      const gp = this.game.s.players[player.id];
      if (!gp && m.country !== null) this.addToGame(m);
    }
    this.persistMeta();
    this.broadcastLobby();
    if (this.game && this.game.s.players[player.id]) this.sendView(player.id, { started: true });
  }

  attach(player, conn) {
    const old = this.conns.get(player.id);
    if (old && old !== conn) {
      old.send({ t: 'error', message: 'Signed in from another window', code: 'superseded' });
      old.campaign = null;
    }
    this.conns.set(player.id, conn);
    conn.campaign = this;
    if (this.game && this.game.s.players[player.id]) {
      const gp = this.game.s.players[player.id];
      gp.online = true;
      gp.away = false;
    }
    this.scheduleTurn();
  }

  detach(playerId, conn) {
    if (this.conns.get(playerId) !== conn) return;
    this.conns.delete(playerId);
    if (this.game && this.game.s.players[playerId]) {
      const gp = this.game.s.players[playerId];
      gp.online = false;
      gp.away = true;
      this.note(this.game.s.players[playerId].country, { kind: 'lobby', title: `${gp.name} disconnected`, text: 'Their forces follow standing orders until they return.' });
    }
    this.readySet.delete(playerId);
    this.broadcastLobby();
    this.scheduleTurn();
  }

  leave(playerId) {
    const m = this.member(playerId);
    if (!m) return;
    const conn = this.conns.get(playerId);
    if (conn) conn.campaign = null;
    this.conns.delete(playerId);
    if (this.meta.status === 'lobby') {
      this.meta.members = this.meta.members.filter((x) => x.id !== playerId);
      if (this.meta.hostId === playerId && this.meta.members.length) {
        this.meta.hostId = this.meta.members[0].id;
        this.meta.members[0].role = 'host';
      }
    } else if (this.game && this.game.s.players[playerId]) {
      const gp = this.game.s.players[playerId];
      gp.online = false;
      gp.away = true;
      gp.standing = 'ai';
      m.left = true;
      if (this.meta.hostId === playerId) {
        const next = this.meta.members.find((x) => x.id !== playerId && !x.left);
        if (next) {
          this.meta.hostId = next.id;
          next.role = 'host';
          this.note('all', { kind: 'lobby', title: `${next.name} is now the host`, text: '' });
        }
      }
    }
    this.note('all', { kind: 'lobby', title: `${m.name} left the campaign`, text: this.meta.status === 'running' ? 'Their nation is run by the AI.' : '' });
    this.persistMeta();
    this.broadcastLobby();
    this.scheduleTurn();
  }

  kick(hostId, targetId) {
    if (!this.isHost(hostId) || targetId === hostId) return 'Only the host can remove commanders';
    const conn = this.conns.get(targetId);
    if (conn) conn.send({ t: 'kicked', message: 'The host removed you from the campaign' });
    this.leave(targetId);
    this.meta.kicked.push(targetId);
    this.persistMeta();
    return null;
  }

  // ---------------------------------------------------------------- lobby actions
  pick(playerId, { country, serve }) {
    const m = this.member(playerId);
    if (!m) return 'Not a member';
    if (this.meta.status !== 'lobby') return 'The campaign has already started';
    const w = this.server.world;
    if (serve) {
      const lord = this.member(serve);
      if (!lord || lord.id === playerId || lord.country === null || lord.serve) return 'That commander has not picked a nation';
      m.serve = lord.id;
      m.country = lord.country;
    } else {
      const c = Number(country);
      if (!Number.isInteger(c) || c < 0 || c >= w.countries.length) return 'Unknown country';
      const taken = this.meta.members.find((x) => x.id !== playerId && x.country === c && !x.serve);
      if (taken && !this.meta.settings.allowShared) return `${w.countries[c].name} is already taken by ${taken.name}`;
      m.country = c;
      m.serve = null;
      // anyone serving this member follows them
      for (const x of this.meta.members) if (x.serve === playerId) x.country = c;
    }
    m.ready = false;
    this.persistMeta();
    this.broadcastLobby();
    return null;
  }

  setReady(playerId, on) {
    const m = this.member(playerId);
    if (!m) return;
    m.ready = !!on;
    this.broadcastLobby();
  }

  updateSettings(playerId, input) {
    if (playerId !== this.meta.hostId) return 'Only the host can change settings';
    if (this.meta.status !== 'lobby') return 'Settings are locked once the campaign starts';
    this.meta.settings = cleanSettings(input, this.meta.settings);
    this.meta.name = this.meta.settings.name;
    if (this.meta.members.length > this.meta.settings.maxPlayers) this.meta.settings.maxPlayers = MAX_PLAYERS.find((n) => n >= this.meta.members.length) || 16;
    this.persistMeta();
    this.broadcastLobby();
    return null;
  }

  regenerateCode(playerId) {
    if (!this.isHost(playerId)) return 'Only the host can change the code';
    this.server.releaseCode(this.meta.code);
    this.meta.code = newCode(this.server.codeSet());
    this.server.registerCode(this);
    this.persistMeta();
    this.broadcastLobby();
    return null;
  }

  start(playerId) {
    if (!this.isHost(playerId)) return 'Only the host can start';
    if (this.meta.status !== 'lobby') return 'Already started';
    const unpicked = this.meta.members.filter((m) => m.country === null);
    if (unpicked.length) return `Waiting for ${unpicked.map((m) => m.name).join(', ')} to pick a nation`;
    const s = this.meta.settings;
    this.game = Game.create(this.server.world, { scenario: s.scenario, pace: s.pace, mode: s.mode, nukes: s.nukes !== false, aggression: s.aggression || 1, seed: Math.floor(Math.random() * 2 ** 31) });
    this.applyMode();
    for (const m of this.meta.members) this.addToGame(m);
    this.meta.status = 'running';
    this.meta.startedAt = Date.now();
    this.note('all', { kind: 'lobby', title: 'The campaign has begun', text: SCENARIOS[s.scenario].name });
    this.persistAll();
    this.broadcastLobby();
    for (const id of this.conns.keys()) this.sendView(id, { started: true });
    this.scheduleTurn(true);
    return null;
  }

  // mode rules on top of the shared simulation
  applyMode() {
    const g = this.game;
    const s = this.meta.settings;
    const countries = [...new Set(this.meta.members.map((m) => m.country))];
    if (s.mode === 'coop') {
      for (const a of countries) for (const b of countries) if (a !== b) {
        g.s.alliance[a * g.C + b] = 1;
        g.s.rel[a * g.C + b] = 80;
      }
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
    const s = this.meta.settings;
    let rank = s.startRank;
    // a second commander in the same nation (shared control or imperial service) cannot also be head of state
    const others = Object.values(g.s.players).filter((p) => p.country === m.country);
    if (others.some((p) => p.rank >= 49)) rank = Math.min(rank, 43);
    if (m.serve) rank = Math.min(rank, 36);
    const p = g.addPlayer(m.id, { name: m.name, country: m.country, rank });
    p.online = this.online(m.id);
    p.away = !p.online;
    p.dev = !!this.server.isDev(m.id);
    if (m.serve) p.serves = m.serve;
    if (p.dev) this.meta.dev = true;
    this.note(m.country, { kind: 'lobby', title: `${m.name} takes command`, text: m.serve ? `Serving ${this.member(m.serve)?.name}` : '' });
  }

  async loadGame() {
    const data = await this.server.store.loadSnapshot(this.id);
    if (!data) throw new Error('Campaign data missing');
    this.game = Game.load(this.server.world, data);
    // replay commands accepted after the last snapshot
    const journal = await this.server.store.readJournal(this.id);
    for (const e of journal) if (e.turn === this.game.s.turn) this.game.submit(e.player, e.cmd);
    for (const p of Object.values(this.game.s.players)) {
      p.online = this.online(p.id);
      p.away = !p.online;
    }
  }

  // ---------------------------------------------------------------- turns
  command(playerId, id, cmd) {
    const conn = this.conns.get(playerId);
    if (!this.game || this.meta.status !== 'running') return conn && conn.send({ t: 'ack', id, res: { ok: false, reason: 'The campaign is not running' } });
    if (this.resolving) return conn && conn.send({ t: 'ack', id, res: { ok: false, reason: 'The turn is resolving' } });
    if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') return conn && conn.send({ t: 'ack', id, res: { ok: false, reason: 'Malformed command' } });
    if (this.meta.settings.mode === 'competitive' && (cmd.type === 'grant' || (cmd.type === 'empire' && cmd.op === 'contribute'))) return conn && conn.send({ t: 'ack', id, res: { ok: false, reason: 'Not allowed in competitive mode' } });
    if (this.meta.settings.mode === 'teams' && cmd.type === 'propose' && cmd.kind === 'alliance') {
      const team = (this.game.s.teams || []).find((t) => t.includes(this.game.s.players[playerId]?.country));
      if (team && !team.includes(Number(cmd.target))) return conn && conn.send({ t: 'ack', id, res: { ok: false, reason: 'Team war: alliances only inside your team' } });
    }
    const res = this.game.submit(playerId, cmd);
    if (conn) conn.send({ t: 'ack', id, res });
    if (res.ok) {
      this.server.store.appendJournal(this.id, { turn: this.game.s.turn, player: playerId, cmd });
      if (cmd.type === 'empire' && cmd.op === 'found') this.enrollServants(playerId);
      this.sendView(playerId);
      this.markAllDirty();
    }
  }

  enrollServants(emperorId) {
    const e = (this.game.s.empires || []).find((x) => x.emperor === emperorId);
    if (!e) return;
    for (const p of Object.values(this.game.s.players)) if (p.serves === emperorId && !e.officers.some((o) => o.player === p.id)) e.officers.push({ player: p.id, title: 'officer', since: this.game.s.turn });
  }

  ready(playerId, on = true) {
    if (!this.game || this.meta.status !== 'running') return;
    if (on) this.readySet.add(playerId);
    else this.readySet.delete(playerId);
    this.broadcastTurnState();
    this.scheduleTurn();
  }

  scheduleTurn(fresh = false) {
    if (!this.game || this.meta.status !== 'running' || this.resolving) return;
    const online = [...this.conns.keys()].filter((id) => this.game.s.players[id]);
    if (!online.length && this.meta.settings.pauseWhenEmpty) {
      clearTimeout(this.timer);
      this.timer = null;
      this.deadline = 0;
      return;
    }
    if (online.length && online.every((id) => this.readySet.has(id))) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.resolveTurn(), 150);
      return;
    }
    const T = this.meta.settings.turnTimer;
    if (T > 0 && (fresh || !this.deadline)) {
      clearTimeout(this.timer);
      this.deadline = Date.now() + T * 1000;
      this.timer = setTimeout(() => this.resolveTurn(), T * 1000);
      this.broadcastTurnState();
    }
  }

  async resolveTurn() {
    if (!this.game || this.resolving) return;
    this.resolving = true;
    clearTimeout(this.timer);
    this.timer = null;
    this.broadcastTurnState();
    let ms = 0;
    try {
      ms = this.game.endTurn();
    } catch (e) {
      this.server.log.error('turn failed', this.id, e);
    }
    this.meta.turn = this.game.s.turn;
    this.readySet.clear();
    this.deadline = 0;
    this.resolving = false;
    this.persistAll();
    for (const id of this.conns.keys()) this.sendView(id, { turnDone: true, ms });
    this.scheduleTurn(true);
    this.broadcastTurnState();
  }

  // ---------------------------------------------------------------- replication
  sendView(playerId, extra = {}) {
    const conn = this.conns.get(playerId);
    if (!conn || !this.game || !this.game.s.players[playerId]) return;
    this.dirtyViews.delete(playerId);
    conn.send({ t: 'view', view: this.game.view(playerId), ...extra });
  }
  // other commanders see allied orders and diplomatic changes: batched refresh
  markAllDirty() {
    for (const id of this.conns.keys()) this.dirtyViews.add(id);
    if (this.viewTimer) return;
    this.viewTimer = setTimeout(() => {
      this.viewTimer = null;
      for (const id of [...this.dirtyViews]) this.sendView(id);
    }, 1200);
  }
  broadcast(msg) {
    for (const conn of this.conns.values()) conn.send(msg);
  }
  broadcastTurnState() {
    const players = this.game ? Object.keys(this.game.s.players) : [];
    this.broadcast({ t: 'turn', phase: this.resolving ? 'resolving' : 'planning', turn: this.game ? this.game.s.turn : 0, left: this.deadline ? Math.max(0, this.deadline - Date.now()) : 0, ready: [...this.readySet], online: [...this.conns.keys()].filter((id) => players.includes(id)) });
  }
  lobbyState() {
    const m = this.meta;
    return {
      id: m.id,
      code: m.code,
      name: m.name,
      hostId: m.hostId,
      actingHost: this.actingHost(),
      status: m.status,
      turn: m.turn,
      settings: { ...m.settings, passwordHash: undefined, hasPassword: !!m.settings.passwordHash },
      members: m.members.map((x) => ({ id: x.id, name: x.name, country: x.country, serve: x.serve, ready: x.ready, online: this.online(x.id), role: x.id === m.hostId ? 'host' : 'member', left: !!x.left })),
      chat: m.chat.slice(-40),
    };
  }
  broadcastLobby() {
    this.broadcast({ t: 'lobby', lobby: this.lobbyState() });
  }
  note(target, n) {
    if (this.game) this.game.notify(target, n);
    this.broadcast({ t: 'note', note: n });
  }
  chat(playerId, text) {
    const m = this.member(playerId);
    if (!m) return;
    const clean = String(text || '').replace(/[<>]/g, '').trim().slice(0, 300);
    if (!clean) return;
    const msg = { from: m.name, id: playerId, text: clean, at: Date.now() };
    this.meta.chat.push(msg);
    if (this.meta.chat.length > 100) this.meta.chat.shift();
    this.broadcast({ t: 'chat', msg });
  }

  // ---------------------------------------------------------------- persistence
  persistMeta() {
    return this.server.store.saveCampaignMeta(this.id, this.meta).catch((e) => this.server.log.error('meta save failed', e));
  }
  persistAll() {
    this.persistMeta();
    if (this.game) {
      const snap = this.game.save();
      this.server.store.saveSnapshot(this.id, snap).then(() => this.server.store.clearJournal(this.id)).catch((e) => this.server.log.error('snapshot failed', e));
    }
  }
  // ---------------------------------------------------------------- developer tools (dev identities only)
  devOp(devId, m) {
    this.meta.dev = true;
    const w = this.server.world;
    const log = (text) => this.note('all', { kind: 'lobby', title: `[DEV] ${text}`, text: '' });
    switch (m.op) {
      case 'bot': {
        if (this.meta.members.length >= 16) return 'Campaign is at the hard limit';
        const used = new Set(this.meta.members.map((x) => x.country));
        let c = Number.isInteger(m.country) ? m.country : -1;
        if (c < 0) {
          const free = w.countries.map((x, i) => i).filter((i) => !used.has(i) && w.provincesOf[i].length >= 4);
          c = free[Math.floor(Math.random() * free.length)];
        }
        const n = this.meta.members.filter((x) => x.bot).length + 1;
        const bot = { id: `bot-${n}-${Date.now().toString(36)}`, name: `Test Commander ${n}`, country: c, serve: null, ready: true, joined: Date.now(), role: 'member', bot: true };
        this.meta.members.push(bot);
        if (this.game) {
          this.addToGame(bot);
          this.game.s.players[bot.id].standing = 'ai';
        }
        log(`Added test player ${bot.name} (${w.countries[c].name})`);
        break;
      }
      case 'kick':
        if (!this.member(m.player)) return 'Unknown player';
        this.leave(m.player);
        log('Forced a commander out');
        break;
      case 'drop':
      case 'hostfail': {
        const id = m.op === 'hostfail' ? this.meta.hostId : m.player;
        const conn = this.conns.get(id);
        if (!conn) return 'That commander is not connected';
        log(m.op === 'hostfail' ? 'Simulated host failure' : 'Simulated a disconnect');
        if (conn.drop) conn.drop();
        else this.detach(id, conn);
        break;
      }
      case 'country': {
        const mem = this.member(m.player);
        const c = Number(m.country);
        if (!mem || !Number.isInteger(c) || !w.countries[c]) return 'Unknown player or country';
        mem.country = c;
        if (this.game && this.game.s.players[m.player]) {
          const gp = this.game.s.players[m.player];
          gp.country = c;
          this.game.index();
        }
        log(`Moved ${mem.name} to ${w.countries[c].name}`);
        break;
      }
      case 'resolve':
        if (!this.game) return 'Not running';
        this.resolveTurn();
        break;
      case 'load': {
        if (!this.game) return 'Not running';
        const reps = Math.max(1, Math.min(20, m.reps | 0 || 5));
        const t0 = performance.now();
        let bytes = 0;
        const ids = Object.keys(this.game.s.players);
        for (let i = 0; i < reps; i++) for (const id of ids) bytes += JSON.stringify(this.game.view(id)).length;
        const ms = performance.now() - t0;
        const res = { views: reps * ids.length, ms: +ms.toFixed(1), perView: +(ms / (reps * ids.length)).toFixed(2), kb: Math.round(bytes / 1024 / (reps * ids.length)) };
        log(`Network load test: ${res.views} views, ${res.perView} ms and ${res.kb} KB each`);
        return { ok: true, ...res };
      }
      default:
        return 'Unknown dev operation';
    }
    this.persistMeta();
    this.broadcastLobby();
    this.markAllDirty();
    return null;
  }

  stopTimers() {
    clearTimeout(this.timer);
    clearTimeout(this.viewTimer);
    this.timer = null;
    this.viewTimer = null;
  }
  // free memory when nobody is connected (the campaign reloads on demand)
  maybeUnload() {
    if (this.conns.size || !this.game) return;
    this.persistAll();
    this.game = null;
  }
}
