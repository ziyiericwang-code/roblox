// Tiny observable store with a Preact hook. One batched emit per microtask.
import { useEffect, useState } from 'preact/hooks';

export const store = {
  state: {
    screen: 'title',
    view: null,
    sel: null, // { kind: 'formation'|'province'|'battle', id }
    multi: [], // extra selected formation ids
    hover: -1,
    mode: 'political',
    panel: null,
    toasts: [],
    modal: null,
    preview: null, // { path, target, forecast }
    tool: null, // 'line' | 'objective' | null
    toolProvs: [],
    busy: false,
    playback: 0,
    saves: [],
    settings: { reducedMotion: false, uiScale: 1, colorblind: false },
  },
  listeners: new Set(),
  queued: false,
  set(patch) {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    if (!p) return;
    this.state = { ...this.state, ...p };
    if (!this.queued) {
      this.queued = true;
      queueMicrotask(() => {
        this.queued = false;
        for (const l of this.listeners) l(this.state);
      });
    }
  },
  get() {
    return this.state;
  },
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
};

export function useStore(selector = (s) => s) {
  const [v, setV] = useState(() => selector(store.state));
  useEffect(() => store.subscribe((s) => setV(() => selector(s))), []);
  return v;
}

let toastSeq = 1;
export function toast(t) {
  const id = toastSeq++;
  const item = { id, ...t, at: Date.now() };
  store.set((s) => ({ toasts: [...s.toasts.filter((x) => Date.now() - x.at < 9000)].slice(-3).concat(item) }));
  setTimeout(() => store.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.ms || (t.important ? 7000 : 4500));
}
