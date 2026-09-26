// Screenshot helper: serves dist/ and captures the page at several camera positions.
// usage: node scripts/shot.mjs [name] [js-to-eval-before-shot ...]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = join(root, 'screenshots');
mkdirSync(outDir, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.bin': 'application/octet-stream' };
const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'index.html';
    const body = await readFile(join(dist, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const [w, h] = (process.env.VIEW || '1440x900').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: w, height: h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:${port}/${process.env.PAGE || ''}`);
await page.waitForFunction(() => window.__gc && window.__gc.view, null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(800);
const name = process.argv[2] || 'shot';
const steps = process.argv.slice(3);
if (!steps.length) steps.push('');
let i = 0;
for (const js of steps) {
  if (js) await page.evaluate(js).catch((e) => logs.push(`[eval] ${e.message}`));
  await page.waitForTimeout(Number(process.env.WAIT || 900));
  const f = join(outDir, `${name}-${i++}.png`);
  await page.screenshot({ path: f });
  console.log('saved', f);
}
if (logs.length) console.log(logs.slice(0, 30).join('\n'));
await browser.close();
server.close();
