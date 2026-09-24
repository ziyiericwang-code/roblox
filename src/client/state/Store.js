// Client state store with change notifications.
export class Store {
  constructor() {
    this.state = {
      id: null,
      faction: 1,
      profile: null,
      war: null,
      battles: [],
      missions: [],
      operations: [],
      events: [],
      tracked: 0,
      squads: [],
      mySquad: 0,
      invites: [],
      world: { clock: 10, cloud: 0.2, fog: 0.05, rain: 0, wind: 0.3, type: 'clear' },
      deploy: null,
      training: null,
      cmd: { ready: {}, cp: 0, cpMax: 100 },
      loadout: null,
      squadPos: [],
      order: null,
      solo: false,
    };
    this.listeners = new Map();
  }
  get(k) {
    return this.state[k];
  }
  set(k, v) {
    this.state[k] = v;
    this.emit(k, v);
  }
  patch(obj) {
    for (const [k, v] of Object.entries(obj)) this.set(k, v);
  }
  on(k, fn) {
    if (!this.listeners.has(k)) this.listeners.set(k, new Set());
    this.listeners.get(k).add(fn);
    return () => this.listeners.get(k).delete(fn);
  }
  emit(k, v) {
    const l = this.listeners.get(k);
    if (l) for (const fn of l) fn(v);
  }
}
