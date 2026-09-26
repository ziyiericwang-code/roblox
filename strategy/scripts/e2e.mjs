// End-to-end check in headless Chromium: title → setup → game → orders → turns, with screenshots.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(root, 'screenshots');
mkdirSync(out, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.bin': 'application/octet-stream' };
const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'index.html';
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(await readFile(join(dist, p)));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/${process.env.PAGE || ''}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const [w, h] = (process.env.VIEW || '1440x900').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_CERT|fonts\.g/.test(m.text())) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const shot = async (name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, `e2e-${name}.png`) });
  console.log('shot', name);
};
const country = process.env.COUNTRY || 'Poland';
await page.goto(url);
await page.waitForSelector('.title-card', { timeout: 60000 });
await shot('1-title');
await page.click('text=New campaign');
await page.waitForSelector('.setup');
await page.fill('.setup-right .search', country);
await page.click(`.country-list button:has-text("${country}")`);
if (process.env.SCENARIO) await page.click(`text=${process.env.SCENARIO}`);
if (process.env.RANK) await page.click(`text=${process.env.RANK}`);
await shot('2-setup');
await page.click('text=Enlist in');
await page.waitForSelector('.topbar', { timeout: 60000 });
await page.waitForTimeout(1500);
await shot('3-game');
// select our first formation and preview a move
await page.keyboard.press('Tab');
await page.evaluate(() => {
  const r = window.__gc.ctl.r;
  r.fly = null;
  window.__gc.ctl.focusHQ(true);
});
await page.waitForTimeout(1200);
await shot('4-selected');
// right-click the directive target (or any friendly neighbour) to issue a move order
const target = await page.evaluate(() => {
  const v = window.__gc.ctl.view;
  const d = v.me.directives.find((x) => x.status === 'active' && x.target !== undefined);
  const f = v.formations.find((x) => x.mine);
  const t = d ? d.target : window.__gc.world.neighbors(f.prov).find((q) => q < window.__gc.world.P);
  const r = window.__gc.ctl.r;
  const [x, y] = r.regionCenter(t);
  r.fly = null;
  Object.assign(r.camera, { x, y, zoom: 30 });
  r.dirty = true;
  return t;
});
await page.waitForTimeout(1500);
const pos = await page.evaluate((t) => {
  const w = window.__gc.world;
  const r = window.__gc.ctl.r;
  return r.worldToScreen(w.wx(t), w.wy(t));
}, target);
await page.mouse.move(pos[0], pos[1] + 18);
await page.waitForTimeout(400);
await shot('4b-preview');
await page.mouse.click(pos[0], pos[1] + 18, { button: 'right' });
await page.waitForTimeout(500);
const ordered = await page.evaluate(() => window.__gc.ctl.view.formations.filter((f) => f.mine && f.order).length);
console.log('formations with orders after right-click:', ordered);
await shot('4c-ordered');
const turns = Number(process.env.TURNS || 3);
for (let i = 0; i < turns; i++) {
  await page.evaluate(() => window.__gc.ctl.endTurn());
  await page.waitForFunction(() => !document.querySelector('.endturn.busy'), null, { timeout: 60000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('.modal-back') && document.querySelector('.modal .btn.primary')?.click());
}
await shot('5-after-turns');
for (const p of (process.env.PANELS || 'rank,world').split(',')) {
  await page.evaluate((k) => window.__gcApp && import.meta, p).catch(() => {});
  await page.click(`.tabrail button[title="${{ rank: 'Career', world: 'World', armies: 'Armies', diplomacy: 'Diplomacy', empire: 'Empire', economy: 'Economy', fronts: 'Fronts' }[p]}"]`).catch((e) => errors.push(`panel ${p}: ${e.message}`));
  await shot(`6-panel-${p}`);
}
console.log(errors.length ? `ERRORS:\n${errors.slice(0, 20).join('\n')}` : 'no page errors');
await browser.close();
server.close();
