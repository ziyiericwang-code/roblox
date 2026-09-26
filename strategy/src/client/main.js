// Boot: load the world package, then start the app.
import { buildWorld } from '../shared/world.js';
import { decodeArcs } from './map/Geometry.js';
import { startApp } from './App.jsx';

async function loadWorld() {
  if (window.__GC_WORLD__) {
    const bin = Uint8Array.from(atob(window.__GC_GEOM__), (c) => c.charCodeAt(0));
    return { json: window.__GC_WORLD__, bin };
  }
  const [json, bin] = await Promise.all([
    fetch('world/world.json').then((r) => r.json()),
    fetch('world/geometry.bin').then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
  ]);
  return { json, bin };
}

const status = (t) => {
  const el = document.getElementById('boot-status');
  if (el) el.textContent = t;
};

loadWorld()
  .then(({ json, bin }) => {
    status('Building map…');
    const world = buildWorld(json);
    const arcs = decodeArcs(bin, json.grid);
    startApp(document.getElementById('app'), world, arcs);
  })
  .catch((e) => {
    console.error(e);
    status(`Failed to start: ${e.message}`);
  });
