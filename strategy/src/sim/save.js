// Campaign snapshots: plain JSON (typed arrays become arrays, Maps become arrays).
// Versioned with a migration chain so old saves keep loading.
import { Rng } from './util.js';
import { PROV_FIELDS } from './Game.js';

export const SAVE_FORMAT = 1;
const TYPED = ['rel', 'alliance', 'access', 'claims', 'nap', 'trade', 'intelShare', 'weather'];

export function serialize(g) {
  const s = g.s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'turnLog' || k === 'supplyOf') continue;
    if (k === 'prov') {
      out.prov = {};
      for (const [pk, arr] of Object.entries(v)) out.prov[pk] = Array.from(arr);
    } else if (k === 'formations' || k === 'battles') out[k] = [...v.values()];
    else if (TYPED.includes(k) && v) out[k] = Array.from(v);
    else out[k] = v;
  }
  out.format = SAVE_FORMAT;
  out.worldHash = worldHash(g.w);
  out.rngState = g.rng.state;
  out.savedAt = Date.now();
  return JSON.parse(JSON.stringify(out));
}

export function deserialize(g, data) {
  const d = migrate(data);
  if (d.worldHash && d.worldHash !== worldHash(g.w)) throw new Error('This save was made for a different world map');
  const s = {};
  for (const [k, v] of Object.entries(d)) {
    if (k === 'prov') {
      s.prov = {};
      for (const f of PROV_FIELDS) {
        const src = v[f] || [];
        const T = f === 'owner' || f === 'ctrl' || f === 'lastChange' ? Uint16Array : Uint8Array;
        s.prov[f] = T.from({ length: g.P }, (_, i) => src[i] || 0);
      }
    } else if (k === 'formations' || k === 'battles') s[k] = new Map(v.map((x) => [x.id, x]));
    else if (TYPED.includes(k) && v) s[k] = k === 'rel' ? Int8Array.from(v) : Uint8Array.from(v);
    else s[k] = v;
  }
  g.s = s;
  g.rng = new Rng(1);
  if (d.rngState) g.rng.state = d.rngState;
  for (const p of Object.values(s.players)) p.inbox = p.inbox || [];
}

function migrate(d) {
  if (!d || typeof d !== 'object') throw new Error('Not a save file');
  if (!d.format || d.format > SAVE_FORMAT) throw new Error(`Unsupported save format ${d.format}`);
  // future: if (d.format === 1) { ...upgrade...; d.format = 2; }
  return d;
}

export function worldHash(w) {
  let h = 2166136261 >>> 0;
  const mix = (v) => {
    h = Math.imul(h ^ (v & 0xffff), 16777619) >>> 0;
  };
  mix(w.P);
  mix(w.S);
  for (let i = 0; i < w.adjTo.length; i += 7) mix(w.adjTo[i]);
  for (let i = 0; i < w.P; i += 3) mix(w.provinces.country[i]);
  return h.toString(16);
}
