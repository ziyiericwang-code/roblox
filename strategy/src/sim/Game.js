// Authoritative campaign simulation. Platform-agnostic: runs in a Web Worker (solo)
// or in Node (multiplayer). All state lives in `this.s`; systems are plain modules.
import { Rng, dateLabel } from './util.js';
import { START_DATE } from '../../config/scenario.js';
import { ELEMENTS, LAND } from '../../config/units.js';
import { setupCampaign, addPlayer } from './setup.js';
import { runTurn } from './turn.js';
import { applyCommand } from './commands.js';
import { buildView } from './view.js';
import { serialize, deserialize } from './save.js';
import { refreshCareer, issueDirectives, computeArea } from './career.js';

export const PROV_FIELDS = ['owner', 'ctrl', 'lastChange', 'fort', 'infra', 'rail', 'civ', 'mil', 'depot', 'hub', 'armyBase', 'airbase', 'port', 'radar', 'command', 'damage', 'stab', 'unrest'];

export class Game {
  constructor(world) {
    this.w = world;
    this.C = world.countries.length;
    this.P = world.P;
    this.rng = new Rng(1);
    this.s = null;
    this.byProv = null;
    this.listeners = [];
  }

  static create(world, settings = {}) {
    const g = new Game(world);
    setupCampaign(g, settings);
    g.index();
    g.refreshDerived();
    return g;
  }

  static load(world, data) {
    const g = new Game(world);
    deserialize(g, data);
    g.index();
    g.refreshDerived();
    return g;
  }

  save() {
    return serialize(this);
  }

  // ------------------------------------------------------------ relations
  key(a, b) {
    return a * this.C + b;
  }
  atWar(a, b) {
    return a !== b && a >= 0 && b >= 0 && this.warM[a * this.C + b] === 1;
  }
  allied(a, b) {
    return a === b || this.s.alliance[a * this.C + b] === 1;
  }
  // may formations of `mover` enter territory controlled by `ctrl`?
  canEnter(mover, ctrl) {
    if (ctrl === mover || this.allied(mover, ctrl)) return true;
    if (this.s.access[ctrl * this.C + mover]) return true;
    return this.atWar(mover, ctrl);
  }
  hostile(a, b) {
    return this.atWar(a, b);
  }

  // ------------------------------------------------------------ formations
  formation(id) {
    return this.s.formations.get(id);
  }
  elements(f) {
    let n = 0;
    for (const t in f.comp) n += f.comp[t];
    return n;
  }
  men(f) {
    let n = 0;
    for (const t in f.comp) n += f.comp[t] * ELEMENTS[t].men;
    return Math.round(n * f.str);
  }
  speed(f) {
    let s = Infinity;
    for (const t in f.comp) if (f.comp[t] > 0) s = Math.min(s, ELEMENTS[t].speed);
    return s === Infinity ? 180 : s;
  }
  hardness(f) {
    let h = 0;
    let n = 0;
    for (const t in f.comp) {
      h += f.comp[t] * ELEMENTS[t].hardness;
      n += f.comp[t];
    }
    return n ? h / n : 0;
  }
  // quick power estimate (used by AI and view)
  power(f) {
    const tech = 0.75 + 0.1 * this.s.countries[f.owner].tech;
    let p = 0;
    for (const t in f.comp) {
      const e = ELEMENTS[t];
      p += f.comp[t] * (e.soft * 0.6 + e.hard * 0.4 + e.def * 0.5);
    }
    return p * f.str * (0.35 + 0.65 * f.org) * tech * (0.8 + 0.4 * f.exp);
  }
  index() {
    const NN = this.w.NN;
    this.byProv = Array.from({ length: NN }, () => []);
    for (const f of this.s.formations.values()) this.byProv[f.prov].push(f.id);
    const C = this.C;
    this.warM = new Uint8Array(C * C);
    for (const w of this.s.wars) {
      for (const a of w.attackers) for (const d of w.defenders) {
        this.warM[a * C + d] = 1;
        this.warM[d * C + a] = 1;
      }
    }
  }
  reindexFormations() {
    for (const list of this.byProv) list.length = 0;
    for (const f of this.s.formations.values()) this.byProv[f.prov].push(f.id);
  }
  // hostile formations (to country c) in province p
  hostileIn(p, c) {
    const out = [];
    for (const id of this.byProv[p]) {
      const f = this.s.formations.get(id);
      if (f && this.atWar(f.owner, c)) out.push(f);
    }
    return out;
  }
  friendlyIn(p, c) {
    const out = [];
    for (const id of this.byProv[p]) {
      const f = this.s.formations.get(id);
      if (f && this.allied(f.owner, c)) out.push(f);
    }
    return out;
  }

  // ------------------------------------------------------------ misc
  get turn() {
    return this.s.turn;
  }
  dateLabel(turn = this.s.turn) {
    return dateLabel(turn, START_DATE);
  }
  countryName(c) {
    return c >= this.C ? 'Insurgents' : this.w.countries[c].name;
  }
  player(id) {
    return this.s.players[id];
  }
  playersOf(c) {
    return Object.values(this.s.players).filter((p) => p.country === c);
  }
  // country fully controlled by a human (Supreme Commander or higher)
  humanRuns(c) {
    return Object.values(this.s.players).some((p) => p.country === c && p.rank >= 49 && !p.away);
  }

  notify(target, n) {
    // target: playerId | countryId (number) | 'all'
    const note = { turn: this.s.turn, ...n };
    for (const p of Object.values(this.s.players)) {
      if (target === 'all' || target === p.id || target === p.country || (Array.isArray(target) && (target.includes(p.country) || target.includes(p.id)))) {
        p.inbox.push(note);
        if (p.inbox.length > 80) p.inbox.shift();
      }
    }
  }

  addPlayer(id, opts) {
    const p = addPlayer(this, id, opts);
    this.index();
    this.refreshDerived();
    p.area = computeArea(this, p);
    issueDirectives(this, p);
    return p;
  }

  submit(playerId, cmd) {
    const p = this.s.players[playerId];
    if (!p) return { ok: false, reason: 'Unknown player' };
    try {
      const r = applyCommand(this, p, cmd);
      if (r.ok) this.touch();
      return r;
    } catch (e) {
      return { ok: false, reason: `Error: ${e.message}` };
    }
  }

  endTurn() {
    const t0 = Date.now();
    runTurn(this);
    this.refreshDerived();
    this.lastTurnMs = Date.now() - t0;
    this.touch();
    return this.lastTurnMs;
  }

  refreshDerived() {
    for (const p of Object.values(this.s.players)) refreshCareer(this, p);
  }

  view(playerId, opts) {
    return buildView(this, playerId, opts);
  }

  touch() {
    for (const l of this.listeners) l();
  }
}

export { LAND };
