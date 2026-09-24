// Scripted gameplay session in headless Chromium (solo mode). Drives the real
// client through the main loops: skip training, quartermaster, squad, orders,
// officer ability, driving, flying, combat, death and redeploy. Fails on any
// client error or when a step does not have its expected effect.
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'screenshots');
mkdirSync(shots, { recursive: true });
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => existsSync(p));
const srv = await startServer({ port: 0, dataDir: join(root, 'data-e2e'), quiet: true });
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
// small viewport + low preset: the container renders WebGL on the CPU (SwiftShader)
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_CERT_AUTHORITY_INVALID|fonts\.g/.test(m.text())) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack || ''}`));
let n = 0;
const shot = (name) => page.screenshot({ path: join(shots, `play-${String(++n).padStart(2, '0')}-${name}.png`) });
const results = [];
const step = async (name, fn) => {
  try {
    const r = await fn();
    results.push(`ok   ${name}${r ? ` (${r})` : ''}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message.split('\n')[0]}`);
    await shot(`fail-${name.replace(/\W+/g, '-')}`).catch(() => {});
  }
};
const wait = (ms) => page.waitForTimeout(ms);
const until = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
// server-side helpers inside the page (solo game runs in the browser)
const sim = (fn, arg) => page.evaluate(fn, arg);

try {
  await page.goto(`http://localhost:${srv.port}/`);
  await page.waitForSelector('.tt-name', { timeout: 20000 });
  await page.fill('.tt-name', 'Play Tester');
  await page.selectOption('.tt-q', 'low');
  await page.click('.title .btn.big');
  await page.waitForSelector('.deploy.on', { timeout: 90000 });
  await until(() => !document.querySelector('.dp-go').disabled);
  await page.click('.dp-go');
  await until(() => window.__frontline.player.alive);
  await wait(800);

  // the game grabs the mouse (pointer lock) when you deploy; Esc frees it
  const freeMouse = () => page.evaluate(() => document.exitPointerLock());
  const grabMouse = async () => {
    if (await page.evaluate(() => !!document.pointerLockElement)) return;
    await page.mouse.click(480, 270); // "click to resume"
    await until(() => !!document.pointerLockElement);
  };
  await step('skip basic training', async () => {
    await freeMouse();
    await wait(200);
    await page.click('.tb-skip');
    await page.click('.tb-yes');
    await until(() => window.__frontline.store.get('profile').rank === 1);
    return 'rank Private';
  });

  await step('promotion to General (test cheat) reaches the client', async () => {
    await sim(() => {
      const s = [...window.__frontline.soloGame.sessions][0];
      s.profile.rank = 20;
      s.profile.credits = 5000;
      s.dirtyProfile = true;
    });
    await until(() => window.__frontline.store.get('profile').rank === 20);
  });

  await step('buy and equip a cosmetic in the quartermaster', async () => {
    await sim(() => window.__frontline.menu.open('store'));
    await wait(300);
    const before = await sim(() => window.__frontline.store.get('profile').credits);
    const buy = page.locator('.menu .item button.btn.tiny:not([disabled])', { hasText: / cr$/ }).first();
    await buy.click();
    await until((b) => window.__frontline.store.get('profile').credits < b, before);
    await wait(300);
    await shot('quartermaster');
    await page.locator('.menu .item button.btn.tiny', { hasText: 'Equip' }).first().click();
    const after = await sim(() => window.__frontline.store.get('profile').credits);
    return `${before} -> ${after} credits`;
  });

  await step('form a squad from the squad tab', async () => {
    await sim(() => window.__frontline.menu.open('squad'));
    await wait(300);
    await page.locator('.menu button', { hasText: /create|form/i }).first().click();
    await until(() => (window.__frontline.store.get('squads') || []).some((q) => q.members && q.members.length));
    await shot('squad');
    await sim(() => window.__frontline.menu.close());
  });

  await step('issue an order with the command wheel', async () => {
    await sim(() => {
      const a = window.__frontline;
      a.wheel.show();
      a.wheel.sel = 2; // move
    });
    await wait(200);
    await shot('command-wheel');
    await sim(() => window.__frontline.wheel.hide(true));
    await until(() => {
      const g = window.__frontline.soloGame;
      return [...g.squads.squads.values()].some((q) => q.order && q.order.type === 'move');
    });
  });

  await step('call an ammo drop from the command menu', async () => {
    await sim(() => {
      const g = window.__frontline.soloGame;
      g.war.cp[1] = 100;
      window.__frontline.player.pitch = -0.25;
    });
    await wait(200);
    await sim(() => window.__frontline.menu.open('command'));
    await wait(400);
    await shot('command-menu');
    await page.locator('.menu .ab', { hasText: 'Ammo Drop' }).locator('button').click();
    await until(() => [...window.__frontline.soloGame.props].some((p) => p.data && p.data.resupply));
  });

  const teleport = async (x, z, yaw) => sim(([x, z, yaw]) => {
    const a = window.__frontline;
    const g = a.soloGame;
    const s = [...g.sessions][0].soldier;
    const y = a.world.colliders.groundHeight(x, z, 500);
    s.x = x; s.y = y; s.z = z;
    a.player.s.x = x; a.player.s.y = y; a.player.s.z = z;
    a.player.s.vx = a.player.s.vy = a.player.s.vz = 0;
    if (yaw !== undefined) a.player.yaw = yaw;
    s.invulnerableUntil = g.time + 60;
  }, [x, z, yaw]);

  await step('enter and drive a ground vehicle', async () => {
    const v = await sim(() => {
      const a = window.__frontline;
      const g = a.soloGame;
      const me = a.player.s;
      let best = null;
      for (const v of g.vehicles) {
        if (v.faction !== 1 || v.def.air || v.def.water || v.seats[0]) continue;
        const d = Math.hypot(v.x - me.x, v.z - me.z);
        if (!best || d < best.d) best = { id: v.id, x: v.x, z: v.z, yaw: v.yaw, d, name: v.def.name };
      }
      return best;
    });
    if (!v) throw new Error('no vehicle');
    await teleport(v.x + Math.cos(v.yaw) * 3.2, v.z - Math.sin(v.yaw) * 3.2, v.yaw);
    await wait(600);
    await page.keyboard.press('KeyF');
    await until(() => !!window.__frontline.player.vehicle);
    const p0 = await sim(() => ({ ...window.__frontline.soloGame.get(window.__frontline.player.vehicle) }));
    await page.keyboard.down('KeyW');
    await wait(3500);
    await shot('driving');
    await page.keyboard.up('KeyW');
    const p1 = await sim((id) => { const e = window.__frontline.soloGame.get(id); return { x: e.x, z: e.z }; }, v.id);
    const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    if (moved < 5) throw new Error(`vehicle barely moved (${moved.toFixed(1)} m)`);
    await wait(1200);
    await page.keyboard.press('KeyF');
    await until(() => !window.__frontline.player.vehicle);
    return `${v.name} drove ${moved.toFixed(0)} m`;
  });

  await step('fly a helicopter', async () => {
    const v = await sim(() => {
      const g = window.__frontline.soloGame;
      for (const v of g.vehicles) if (v.faction === 1 && v.def.air && !v.def.gunship && !v.seats[0]) return { id: v.id, x: v.x, z: v.z, yaw: v.yaw, y: v.y };
      return null;
    });
    if (!v) throw new Error('no helicopter');
    await teleport(v.x + Math.cos(v.yaw) * 3.5, v.z - Math.sin(v.yaw) * 3.5, v.yaw);
    await wait(600);
    await page.keyboard.press('KeyF');
    await until(() => !!window.__frontline.player.vehicle);
    await page.keyboard.down('Space');
    await wait(3000);
    await page.keyboard.up('Space');
    await page.keyboard.down('KeyW');
    await wait(2000);
    await page.keyboard.up('KeyW');
    await shot('flying');
    const y1 = await sim((id) => window.__frontline.soloGame.get(id).y, v.id);
    if (y1 - v.y < 6) throw new Error(`helicopter did not climb (${(y1 - v.y).toFixed(1)} m)`);
    // land again: descend then exit
    await page.keyboard.down('KeyC');
    await wait(4000);
    await page.keyboard.up('KeyC');
    await page.keyboard.press('KeyF');
    await wait(500);
    return `climbed ${(y1 - v.y).toFixed(0)} m`;
  });

  await step('firefight: shoot a hostile soldier with the mouse', async () => {
    const info = await sim(() => {
      const a = window.__frontline;
      const g = a.soloGame;
      const s = [...g.sessions][0].soldier;
      const x = -300;
      const z = 700;
      const y = a.world.colliders.groundHeight(x, z, 500);
      s.x = x; s.y = y; s.z = z; s.invulnerableUntil = g.time + 60;
      a.player.s.x = x; a.player.s.y = y; a.player.s.z = z;
      const e = g.npc.spawnSoldier(2, x + 14, z, { kit: 'rifleman' });
      e.npc.nextThink = 1e9;
      e.armor = 0;
      a.player.yaw = -Math.PI / 2; // face +x
      a.player.pitch = 0;
      return { id: e.id };
    });
    await wait(700);
    // aim at the chest of the target through the camera
    await sim((id) => {
      const a = window.__frontline;
      const e = a.soloGame.get(id);
      const eye = a.player.eye();
      a.player.yaw = Math.atan2(-(e.x - eye.x), -(e.z - eye.z));
      a.player.pitch = Math.atan2(e.y + 1.25 - eye.y, Math.hypot(e.x - eye.x, e.z - eye.z));
    }, info.id);
    await wait(300);
    await grabMouse();
    await page.mouse.move(480, 270);
    await page.mouse.down();
    await wait(1500);
    await page.mouse.up();
    await wait(400);
    await shot('firefight');
    const r = await sim((id) => {
      const e = window.__frontline.soloGame.get(id);
      return e ? { hp: e.health, life: e.life } : { hp: 0, life: 2 };
    }, info.id);
    if (r.hp >= 100 && r.life === 0) throw new Error('target unharmed');
    return r.life === 2 ? 'target killed' : `target at ${r.hp} hp`;
  });

  await step('death returns to the deploy screen; redeploy works', async () => {
    await sim(() => {
      const g = window.__frontline.soloGame;
      const s = [...g.sessions][0].soldier;
      s.invulnerableUntil = 0;
      g.combat.applyDamage(s, 500, null, { explosive: true });
    });
    await until(() => !window.__frontline.player.alive);
    await page.waitForSelector('.deploy.on', { timeout: 20000 });
    await shot('killed');
    await until(() => !document.querySelector('.dp-go').disabled, null, 30000);
    await page.click('.dp-go');
    await until(() => window.__frontline.player.alive);
  });

  await step('career screen reflects the session', async () => {
    await sim(() => window.__frontline.menu.open('career'));
    await wait(400);
    await shot('career');
    const txt = await page.innerText('.menu-body');
    if (!/general/i.test(txt)) throw new Error('rank missing from career page');
    await sim(() => window.__frontline.menu.close());
  });

  await step('stays healthy for 20 s at the front', async () => {
    await sim(() => {
      const a = window.__frontline;
      const g = a.soloGame;
      const b = [...g.war.battles.values()][0];
      const t = a.world.tById[b ? b.territory : 'iron_valley'];
      const sec = t.sectors[0];
      const s = [...g.sessions][0].soldier;
      const y = a.world.colliders.groundHeight(sec.x + 20, sec.z + 20, 500);
      s.x = sec.x + 20; s.y = y; s.z = sec.z + 20; s.invulnerableUntil = g.time + 60;
      a.player.s.x = s.x; a.player.s.y = y; a.player.s.z = s.z;
      a.player.yaw = Math.atan2(-(sec.x - s.x), -(sec.z - s.z));
    });
    await wait(20000);
    await shot('front');
    const st = await sim(() => ({ fps: Math.round(window.__frontline.renderer.fps), tick: window.__frontline.soloGame.tickMsAvg.toFixed(2), ents: window.__frontline.cw.ents.size }));
    return `fps ${st.fps} (software GL), sim tick ${st.tick} ms, ${st.ents} entities in view`;
  });
} catch (e) {
  errors.push(`e2e: ${e.message}`);
  await shot('crash').catch(() => {});
} finally {
  for (const r of results) console.log(r);
  console.log(`ERRORS (${errors.length})`);
  for (const e of errors.slice(0, 30)) console.log(' -', e.slice(0, 600));
  await browser.close();
  await srv.shutdown();
  process.exit(errors.length || results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
}
