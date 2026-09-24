// Screenshots of the world through the developer viewer (no simulation).
// Usage: node scripts/viewer-shots.mjs [quality]
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'screenshots');
mkdirSync(shots, { recursive: true });
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => existsSync(p));
const q = process.argv[2] || 'medium';
const only = process.argv[3];
const srv = await startServer({ port: 0, dataDir: join(root, 'data-e2e'), quiet: true, noGame: true });
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (/context lost|CONTEXT_LOST/i.test(m.text())) errors.push(m.text()); if (m.type() === 'error' && !/fonts|CERT/.test(m.text())) errors.push(m.text()); });
await page.goto(`http://localhost:${srv.port}/?viewer&q=${q}`);
await page.waitForFunction(() => window.__viewer, null, { timeout: 120000 });
const views = [
  ['aldhaven-aerial', 'aldhaven', 260, 180, 240, 0, 0],
  ['aldhaven-street', 'aldhaven', 30, 2, 60, 10, 5],
  ['hq-aldmark', 'hq_aldmark', 150, 60, 200, 0, 0],
  ['greymoor-mountain', 'greymoor', 200, 70, 260, 0, 10],
  ['kharan', 'kharan', -280, 120, 260, 0, 0],
  ['midvale-front', 'midvale', 300, 40, -300, 0, 0],
  ['ashar-desert', 'ashar', 250, 30, 180, 0, 0],
  ['meradin-lake', 'mera', -200, 40, 300, 0, 60],
  ['overview-high', 'midvale', 0, 1100, 1400, 0, -300],
];
for (const [name, id, dx, dy, dz, lx, lz] of views) {
  if (only && !name.includes(only)) continue;
  await page.evaluate(([id, dx, dy, dz, lx, lz]) => {
    const v = window.__viewer;
    const t = v.world.tById[id] || v.world.hqs.find((h) => h.id === id);
    const x = t.x + dx;
    const z = t.z + dz;
    const y = v.world.terrain.heightAt(x, z) + dy;
    v.set(x, y, z);
    v.lookAt(t.x + lx, v.world.terrain.heightAt(t.x + lx, t.z + lz) + 5, t.z + lz);
  }, [id, dx, dy, dz, lx, lz]);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: join(shots, `view-${q}-${name}.png`) });
  const st = await page.evaluate(() => ({ ...window.__viewer.stats(), lost: window.__viewer.renderer.renderer.getContext().isContextLost() }));
  console.log(name.padEnd(20), JSON.stringify(st));
}
console.log('ERRORS', errors.length, errors.slice(0, 5).join('\n'));
await browser.close();
await srv.shutdown();
process.exit(0);
