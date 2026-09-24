import { App } from './App.js';

const app = new App();
window.__frontline = app; // handy for debugging & automated tests
app.boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="color:#fff;padding:20px">Failed to start: ${String(e && e.message ? e.message : e)}</pre>`;
});
