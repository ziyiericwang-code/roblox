// Connections to the authoritative simulation: a local Web Worker (solo) or a WebSocket (multiplayer).
// Both speak the same messages: cmd/ack, end, view.

export class SoloConnection {
  constructor(worldJson) {
    let worker;
    if (window.__GC_WORKER__) {
      const url = URL.createObjectURL(new Blob([window.__GC_WORKER__], { type: 'text/javascript' }));
      worker = new Worker(url, { type: 'module' });
    } else worker = new Worker('sim.worker.js', { type: 'module' });
    this.worker = worker;
    this.pending = new Map();
    this.seq = 1;
    this.handlers = new Set();
    worker.onmessage = (e) => this.receive(e.data);
    worker.onerror = (e) => this.receive({ t: 'error', message: e.message || 'Simulation worker failed' });
    this.ready = new Promise((res) => {
      this.onReady = res;
    });
    worker.postMessage({ t: 'init', world: window.__GC_WORLD__ ? worldJson : null });
  }
  receive(m) {
    if (m.t === 'ready' && this.onReady) this.onReady(m);
    if (m.t === 'ack' && this.pending.has(m.id)) {
      this.pending.get(m.id)(m.res);
      this.pending.delete(m.id);
    }
    if (m.t === 'error' && m.id && this.pending.has(m.id)) {
      this.pending.get(m.id)({ ok: false, reason: m.message });
      this.pending.delete(m.id);
    }
    for (const h of this.handlers) h(m);
  }
  on(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }
  send(m) {
    this.worker.postMessage(m);
  }
  command(cmd) {
    const id = this.seq++;
    return new Promise((res) => {
      this.pending.set(id, res);
      this.send({ t: 'cmd', id, cmd });
    });
  }
  endTurn() {
    this.send({ t: 'end' });
  }
  close() {
    this.worker.terminate();
  }
}
