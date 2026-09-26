// Multiplayer end-to-end: two browsers create and join a campaign by code, pick nations,
// start, and resolve a simultaneous turn through the real server.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { startServer } from '../src/server/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'screenshots');
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'gc-e2e-'));
const srv = await startServer({ port: 0, dataDir, quiet: true });
const url = `http://localhost:${srv.port}/`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
async function open(name) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 820 } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_CERT|fonts\.g/.test(m.text())) errors.push(`${name}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  return page;
}
const shot = async (page, name) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `mp-${name}.png`) });
  console.log('shot', name);
};
const pickCountry = async (page, name) => {
  await page.fill('.setup-right .search', name);
  await page.click(`.country-list button:has-text("${name}")`);
  await page.click(`.country-card .btn:has-text("Command")`);
};

try {
  // host creates
  const a = await open('host');
  await a.goto(url);
  await a.waitForSelector('.title-card', { timeout: 60000 });
  await a.click('text=Multiplayer');
  await a.waitForSelector('.mp-card');
  await a.waitForSelector('text=Connected as', { timeout: 15000 });
  await a.fill('.mp-card input >> nth=0', 'Alpha');
  await a.fill('.mp-form input >> nth=0', 'E2E War');
  await shot(a, '1-create');
  await a.click('.mp-form .btn:has-text("Create campaign")');
  await a.waitForSelector('.lobby .code-box', { timeout: 15000 });
  const code = (await a.textContent('.code-box .code')).trim();
  console.log('campaign code', code);
  if (!/^[2-9A-HJKMNP-TV-Z]{6}$/.test(code)) throw new Error(`bad code ${code}`);

  // guest joins with the invite link
  const b = await open('guest');
  await b.goto(`${url}?join=${code}`);
  await b.waitForSelector('.mp-card', { timeout: 60000 });
  await b.waitForSelector('text=Connected as', { timeout: 15000 });
  await b.fill('.mp-card input >> nth=0', 'Bravo');
  await b.waitForTimeout(800);
  await b.click('.mp-form .btn:has-text("Join campaign")');
  await b.waitForSelector('.lobby', { timeout: 15000 });
  await a.waitForSelector('.member:has-text("Bravo")', { timeout: 10000 });

  // pick nations; a taken nation is refused
  await pickCountry(a, 'France');
  await a.waitForSelector('.member.me:has-text("France")');
  await pickCountry(b, 'France');
  await b.waitForSelector('.lobby .bad', { timeout: 5000 });
  console.log('duplicate refused:', await b.textContent('.lobby .bad'));
  await pickCountry(b, 'Germany');
  await a.waitForSelector('.member:has-text("Germany")');
  await b.click('.lobby .chat input');
  await b.keyboard.type('Ready when you are');
  await b.keyboard.press('Enter');
  await a.waitForSelector('.chat-log:has-text("Ready when you are")');
  await shot(a, '2-lobby');

  // start
  await a.click('.setup-go .btn:has-text("START")');
  await Promise.all([a.waitForSelector('.topbar', { timeout: 60000 }), b.waitForSelector('.topbar', { timeout: 60000 })]);
  await a.waitForTimeout(1200);
  console.log('host camera', JSON.stringify(await a.evaluate(() => ({ ...window.__gc.ctl.r.camera, fly: !!window.__gc.ctl.r.fly, rank: window.__gc.ctl.view.me.rank, hq: window.__gc.ctl.view.me.hq }))));
  await shot(a, '3-game-host');
  await shot(b, '3-game-guest');
  const turn = async (p) => p.evaluate(() => window.__gcApp && window.__gc.ctl.view.turn);
  const t0 = await turn(a);

  // host readies; the button waits for the guest
  await a.click('.endturn');
  await a.waitForSelector('.endturn.ready', { timeout: 5000 });
  console.log('host button:', (await a.textContent('.endturn')).replace(/\s+/g, ' '));
  await shot(a, '4-waiting');
  if ((await turn(a)) !== t0) throw new Error('turn resolved without the guest');
  await b.click('.endturn');
  await a.waitForFunction((t) => window.__gc.ctl.view.turn === t + 1, t0, { timeout: 30000 });
  await b.waitForFunction((t) => window.__gc.ctl.view.turn === t + 1, t0, { timeout: 30000 });
  console.log('turn resolved for both:', t0, '->', await turn(a));

  // guest drops and comes back: automatic reconnect
  await b.evaluate(() => window.__gcApp.online.ws.close());
  await a.waitForSelector('.toast:has-text("disconnected")', { timeout: 10000 }).catch(() => console.log('(no disconnect toast)'));
  await b.waitForFunction(() => window.__gcApp.online.ws.readyState === 1 && !document.querySelector('.tb-offline'), null, { timeout: 15000 });
  console.log('guest reconnected');
  await b.waitForTimeout(800);
  await shot(b, '5-reconnected');
  await a.click('.endturn');
  await b.click('.endturn');
  await a.waitForFunction((t) => window.__gc.ctl.view.turn === t + 2, t0, { timeout: 30000 });
  console.log('second turn resolved after reconnect');
} finally {
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
  await browser.close();
  await srv.shutdown();
  rmSync(dataDir, { recursive: true, force: true });
}
