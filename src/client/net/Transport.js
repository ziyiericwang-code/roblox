// Client transports. The game protocol is identical over both:
//  - WSTransport: multiplayer against the Node server
//  - LocalPair: solo play, the authoritative Game runs in this browser tab
export class WSTransport {
  constructor(url) {
    this.url = url;
    this.handlers = { msg: null, close: null, open: null };
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (ev) => {
      const d = ev.data;
      if (d instanceof ArrayBuffer) this.handlers.msg && this.handlers.msg(d);
      else {
        try {
          this.handlers.msg && this.handlers.msg(JSON.parse(d));
        } catch {
          /* ignore malformed */
        }
      }
    };
    this.ws.onclose = () => this.handlers.close && this.handlers.close();
    this.ws.onopen = () => this.handlers.open && this.handlers.open();
  }
  ready() {
    return new Promise((res, rej) => {
      if (this.ws.readyState === 1) return res();
      this.ws.addEventListener('open', () => res(), { once: true });
      this.ws.addEventListener('error', () => rej(new Error('Connection failed')), { once: true });
    });
  }
  send(msg) {
    if (this.ws.readyState !== 1) return;
    this.ws.send(msg instanceof ArrayBuffer ? msg : JSON.stringify(msg));
  }
  onMessage(fn) {
    this.handlers.msg = fn;
  }
  onClose(fn) {
    this.handlers.close = fn;
  }
  close() {
    this.ws.close();
  }
}

// In-memory pair of connected endpoints (server side conforms to the Game's conn API).
export function createLocalPair() {
  const client = { handlers: {}, closed: false };
  const server = { handlers: {}, closed: false };
  const deliver = (target, msg) => {
    if (target.closed) return;
    // async delivery mimics a network and avoids re-entrancy
    queueMicrotask(() => target.handlers.msg && target.handlers.msg(msg));
  };
  Object.assign(client, {
    send: (m) => deliver(server, m),
    onMessage: (fn) => (client.handlers.msg = fn),
    onClose: (fn) => (client.handlers.close = fn),
    close: () => {
      client.closed = true;
      server.closed = true;
      server.handlers.close && server.handlers.close();
    },
    ready: () => Promise.resolve(),
  });
  Object.assign(server, {
    send: (m) => deliver(client, m),
    onMessage: (fn) => (server.handlers.msg = fn),
    onClose: (fn) => (server.handlers.close = fn),
    close: () => {
      server.closed = true;
      client.handlers.close && client.handlers.close();
    },
  });
  return { client, server };
}
