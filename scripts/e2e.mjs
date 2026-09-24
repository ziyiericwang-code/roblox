// End-to-end smoke test in headless Chromium (software WebGL).
// Starts the server, plays through title -> deploy -> spawn in solo and
// multiplayer modes, checks for errors and saves screenshots.
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'screenshots');
mkdirSync(shots, { recursive: true });
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => existsSync(p));

const args = process.argv.slice(2);
const mode = args.includes('--mp') ? 'mp' : 'solo';
const mobile = args.includes('--mobile');
const seconds = Number((args.find((a) => a.startsWith('--time=')) || '--time=20').split('=')[1]);

const srv = await startServer({ port: 0, dataDir: join(root, 'data-e2e'), quiet: true });
const url = `http://localhost:${srv.port}/`;
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext(mobile ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148' } : { viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack || ''}`));
const tag = `${mode}${mobile ? '-mobile' : ''}`;
try {
  await page.goto(url);
  await page.waitForSelector('.tt-name', { timeout: 20000 });
  await page.screenshot({ path: join(shots, `${tag}-01-title.png`) });
  await page.fill('.tt-name', mode === 'mp' ? 'E2E Sergeant' : 'E2E Tester');
  if (mode === 'mp') await page.click('.title .btn.sec');
  else await page.click('.title .btn.big');
  await page.waitForSelector('.deploy.on', { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(shots, `${tag}-02-deploy.png`) });
  // wait for respawn timer then deploy
  await page.waitForFunction(() => !document.querySelector('.dp-go').disabled, null, { timeout: 20000 });
  await page.click('.dp-go');
  await page.waitForSelector('.hud', { state: 'visible', timeout: 20000 });
  await page.waitForFunction(() => window.__frontline && window.__frontline.player.alive, null, { timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(shots, `${tag}-03-spawned.png`) });
  // drive the player a little: walk forward, look around, fire, crouch
  const hasKb = !mobile;
  if (hasKb) {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyW');
    await page.evaluate(() => {
      const a = window.__frontline;
      a.player.yaw += 1.2;
      a.player.pitch = 0.05;
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, `${tag}-04-look.png`) });
    await page.keyboard.press('KeyM');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(shots, `${tag}-05-map.png`) });
    await page.keyboard.press('KeyM');
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, `${tag}-06-missions.png`) });
    await page.evaluate(() => window.__frontline.menu.open('career'));
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(shots, `${tag}-07-career.png`) });
    await page.evaluate(() => window.__frontline.menu.close());
  }
  // teleport the camera near a battle to exercise AI/combat rendering (solo: move the soldier via server)
  await page.evaluate(() => {
    const a = window.__frontline;
    if (a.soloGame) {
      const g = a.soloGame;
      const s = [...g.sessions][0];
      const war = g.war;
      const b = [...war.battles.values()][0];
      const t = b ? a.world.tById[b.territory] : a.world.tById.iron_valley;
      const sec = t.sectors[0];
      const x = sec.x + 25;
      const z = sec.z + 25;
      const y = a.world.colliders.groundHeight(x, z, 500);
      s.soldier.x = x;
      s.soldier.y = y;
      s.soldier.z = z;
      s.soldier.invulnerableUntil = g.time + 30;
      a.player.s.x = x;
      a.player.s.y = y;
      a.player.s.z = z;
      a.player.yaw = Math.atan2(-(sec.x - x), -(sec.z - z));
    }
  });
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < seconds * 1000) {
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(shots, `${tag}-10-battle-${i++}.png`) });
  }
  const stats = await page.evaluate(() => {
    const a = window.__frontline;
    return {
      fps: a.renderer.fps,
      ents: a.cw.ents.size,
      snaps: a.cw.snapCount,
      alive: a.player.alive,
      health: a.player.health,
      drawCalls: a.renderer.renderer.info.render.calls,
      tris: a.renderer.renderer.info.render.triangles,
      missions: (a.store.get('missions') || []).length,
      war: !!a.store.get('war'),
      squads: (a.store.get('squads') || []).length,
    };
  });
  console.log('STATS', JSON.stringify(stats));
} catch (e) {
  console.error('E2E FAILURE', e);
  await page.screenshot({ path: join(shots, `${tag}-99-failure.png`) }).catch(() => {});
  errors.push(`e2e: ${e.message}`);
} finally {
  console.log(`ERRORS (${errors.length})`);
  for (const e of errors.slice(0, 30)) console.log(' -', e.slice(0, 600));
  await browser.close();
  await srv.shutdown();
  process.exit(errors.length ? 1 : 0);
}
