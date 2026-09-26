// Multiplayer connection to the campaign server. Same surface as SoloConnection
// (on/command/endTurn) plus lobby requests. Reconnects automatically.

const ID_KEY = 'gc.identity';

export function loadIdentity() {
  try {
    return JSON.parse(localStorage.getItem(ID_KEY)) || {};
  } catch {
    return {};
  }
}
function saveIdentity(v) {
  try {
    localStorage.setItem(ID_KEY, JSON.stringify(v));
  } catch {
    /* private mode: identity lasts for this session only */
  }
}

export class OnlineConnection {
  constructor(url, name) {
    this.url = url;
    this.name = name;
    this.handlers = new Set();
    this.pending = new Map();
    this.seq = 1;
    this.closed = false;
    this.online = true;
    this.campaign = null;
    this.reconnecting = false;
    this.ready = new Promise((res, rej) => {
      this.onReady = res;
      this.onFail = rej;
    });
    this.connect();
  }

  connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      const id = loadIdentity();
      const devKey = new URLSearchParams(location.search).get('devkey') || undefined;
      this.raw({ t: 'hello', id: id.id, secret: id.secret, name: this.name, devKey });
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      this.receive(m);
    };
    ws.onclose = () => {
      this.emit({ t: 'disconnected' });
      if (this.closed) return;
      this.reconnecting = true;
      setTimeout(() => this.connect(), 1500);
    };
    ws.onerror = () => {
      if (this.onFail) this.onFail(new Error('Cannot reach the campaign server'));
    };
  }

  receive(m) {
    if (m.t === 'welcome') {
      const cur = loadIdentity();
      saveIdentity({ id: m.id, secret: m.secret || cur.secret, name: m.name });
      this.me = m;
      if (this.onReady) {
        this.onReady(m);
        this.onReady = null;
        this.onFail = null;
      } else if (this.reconnecting && this.campaign) {
        // reconnected: rejoin the campaign we were in
        this.request({ t: 'rejoin', campaign: this.campaign });
      }
      this.reconnecting = false;
    }
    if ((m.t === 'ack' || m.t === 'error') && m.id && this.pending.has(m.id)) {
      this.pending.get(m.id)(m.t === 'ack' ? m.res : { ok: false, reason: m.message });
      this.pending.delete(m.id);
    }
    if (m.t === 'lobby') this.campaign = m.lobby.id;
    this.emit(m);
  }

  emit(m) {
    for (const h of this.handlers) h(m);
  }
  on(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }
  raw(m) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  request(m) {
    const id = this.seq++;
    return new Promise((res) => {
      this.pending.set(id, res);
      this.raw({ ...m, id });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          res({ ok: false, reason: 'No answer from the server' });
        }
      }, 15000);
    });
  }
  // game surface
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
    // solo-only messages (save/load) are ignored online: the server persists campaigns
    if (m.t === 'view') this.raw({ t: 'view' });
  }
  close() {
    this.closed = true;
    this.ws.close();
  }
}

export function serverUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  if (location.protocol === 'http:' || location.protocol === 'https:') return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  return 'ws://localhost:3000/ws';
}
