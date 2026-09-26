// Bundles the client into dist/ and writes a single-file standalone build.
import { build, context } from 'esbuild';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
mkdirSync(join(out, 'world'), { recursive: true });
copyFileSync(join(root, 'src/client/index.html'), join(out, 'index.html'));
copyFileSync(join(root, 'src/client/style.css'), join(out, 'style.css'));
for (const f of ['world.json', 'geometry.bin']) copyFileSync(join(root, 'data/world', f), join(out, 'world', f));

const dev = process.argv.includes('--dev');
const common = {
  bundle: true,
  format: 'esm',
  target: ['es2021'],
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'warning',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define: { __DEV_TOOLS__: JSON.stringify(dev || process.argv.includes('--dev-tools')) },
};
const client = { ...common, entryPoints: [join(root, 'src/client/main.js')], outfile: join(out, 'game.js') };
const worker = { ...common, entryPoints: [join(root, 'src/client/net/sim.worker.js')], outfile: join(out, 'sim.worker.js') };

if (process.argv.includes('--watch')) {
  const a = await context(client);
  const b = await context(worker);
  await Promise.all([a.watch(), b.watch()]);
  console.log('watching…');
} else {
  const t0 = Date.now();
  await Promise.all([build(client), build(worker)]);
  writeStandalone();
  console.log(`built in ${Date.now() - t0} ms`);
}

// dist/global-command.html: one self-contained file (solo play), world data and worker inlined.
function writeStandalone() {
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  const css = readFileSync(join(out, 'style.css'), 'utf8');
  const js = readFileSync(join(out, 'game.js'), 'utf8');
  const workerJs = readFileSync(join(out, 'sim.worker.js'), 'utf8');
  const world = readFileSync(join(out, 'world/world.json'), 'utf8');
  const geom = readFileSync(join(out, 'world/geometry.bin')).toString('base64');
  for (const s of [js, workerJs, world]) if (/<\/script/i.test(s)) throw new Error('payload contains </script>');
  const data = `<script>window.__GC_WORLD__=${world};window.__GC_GEOM__="${geom}";window.__GC_WORKER__=${JSON.stringify(workerJs)};</script>`;
  const page = html
    .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script type="module" src="game.js"></script>', () => `${data}\n<script type="module">\n${js}\n</script>`);
  writeFileSync(join(out, 'global-command.html'), page);
  console.log(`  dist/global-command.html ${(page.length / 1024).toFixed(0)} KB`);
}
