// Temporary shell: shows the world map (replaced by the full app).
import { MapView } from './map/MapView.js';

export function startApp(root, world, arcs) {
  root.innerHTML = '';
  const host = document.createElement('div');
  root.append(host);
  const view = new MapView(host, world, arcs);
  window.__gc = { world, view };
}
