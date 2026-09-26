// Solo mode: the authoritative simulation runs in this Web Worker so the UI never stutters.
// Saves are kept in IndexedDB (gzip-compressed JSON), one autosave per turn plus manual slots.
import { buildWorld } from '../../shared/world.js';
import { Game } from '../../sim/Game.js';

let world = null;
let game = null;
let playerId = 'solo';
let slot = 'autosave';

const post = (m) => self.postMessage(m);

async function ensureWorld(json) {
  if (world) return world;
  if (!json) json = await (await fetch('world/world.json')).json();
  world = buildWorld(json);
  return world;
}

// ------------------------------------------------------------ IndexedDB
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('global-command', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('saves');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('saves', mode);
    const st = tx.objectStore('saves');
    const req = fn(st);
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
  });
}
async function gzip(text) {
  if (typeof CompressionStream === 'undefined') return new TextEncoder().encode(text);
  const cs = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(cs).arrayBuffer());
}
async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined' || bytes[0] !== 0x1f) return new TextDecoder().decode(bytes);
  const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(ds).text();
}
async function writeSave(name) {
  const data = game.save();
  const me = game.s.players[playerId];
  const meta = { name, turn: game.s.turn, date: game.dateLabel(), country: game.countryName(me.country), rank: me.rank, scenario: game.s.scenario, savedAt: Date.now() };
  const bytes = await gzip(JSON.stringify(data));
  await idb('readwrite', (st) => st.put({ meta, bytes }, name));
  return meta;
}
async function listSaves() {
  const keys = await idb('readonly', (st) => st.getAllKeys());
  const out = [];
  for (const k of keys || []) {
    const v = await idb('readonly', (st) => st.get(k));
    if (v) out.push({ slot: k, ...v.meta });
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

function sendView(extra = {}) {
  post({ t: 'view', view: game.view(playerId), ...extra });
}

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    switch (m.t) {
      case 'init':
        await ensureWorld(m.world);
        post({ t: 'ready', saves: await listSaves().catch(() => []) });
        break;
      case 'new': {
        await ensureWorld();
        game = Game.create(world, m.settings);
        const p = game.addPlayer(playerId, m.player);
        p.dev = !!m.dev;
        slot = 'autosave';
        await writeSave(slot).catch(() => {});
        sendView({ started: true });
        break;
      }
      case 'load': {
        await ensureWorld();
        const v = await idb('readonly', (st) => st.get(m.slot));
        if (!v) throw new Error('Save not found');
        game = Game.load(world, JSON.parse(await gunzip(v.bytes)));
        playerId = Object.keys(game.s.players)[0];
        if (m.dev) game.s.players[playerId].dev = true;
        slot = m.slot;
        sendView({ started: true });
        break;
      }
      case 'import': {
        await ensureWorld();
        game = Game.load(world, m.data);
        playerId = Object.keys(game.s.players)[0];
        sendView({ started: true });
        break;
      }
      case 'export':
        post({ t: 'export', data: game.save() });
        break;
      case 'cmd': {
        const res = game.submit(playerId, m.cmd);
        post({ t: 'ack', id: m.id, res });
        if (res.ok) sendView();
        break;
      }
      case 'end': {
        const ms = game.endTurn();
        sendView({ turnDone: true, ms });
        writeSave('autosave').catch(() => {});
        break;
      }
      case 'save':
        post({ t: 'saved', meta: await writeSave(m.slot || `save-${Date.now()}`) });
        break;
      case 'saves':
        post({ t: 'saves', saves: await listSaves() });
        break;
      case 'delete':
        await idb('readwrite', (st) => st.delete(m.slot));
        post({ t: 'saves', saves: await listSaves() });
        break;
      case 'view':
        if (game) sendView();
        break;
      default:
        break;
    }
  } catch (e) {
    post({ t: 'error', message: e.message, id: m.id });
  }
};
