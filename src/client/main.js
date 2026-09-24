import { App } from './App.js';
import { startViewer } from './viewer.js';

const params = new URLSearchParams(location.search);

function bootGame() {
  const app = new App();
  window.__frontline = app; // handy for debugging & automated tests
  app.boot().catch((e) => {
    console.error(e);
    document.body.innerHTML = `<pre style="color:#fff;padding:20px">Failed to start: ${String(e && e.message ? e.message : e)}</pre>`;
  });
}

if (params.has('viewer')) {
  // developer world viewer: free camera, no simulation
  startViewer(document.getElementById('app'), params).catch((e) => {
    console.error(e);
    document.body.innerHTML = `<pre style="color:#fff;padding:20px">Viewer failed: ${String(e && e.stack ? e.stack : e)}</pre>`;
  });
} else bootGame();
