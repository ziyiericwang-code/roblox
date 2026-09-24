// Bundles the browser client (and the solo-mode simulation) into dist/.
import { build, context } from 'esbuild';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
mkdirSync(out, { recursive: true });
copyFileSync(join(root, 'src/client/index.html'), join(out, 'index.html'));
copyFileSync(join(root, 'src/client/style.css'), join(out, 'style.css'));

const opts = {
  entryPoints: [join(root, 'src/client/main.js')],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  outfile: join(out, 'game.js'),
  minify: !process.argv.includes('--dev'),
  sourcemap: process.argv.includes('--dev') ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log('watching client sources...');
} else {
  await build(opts);
  writeStandalone();
}

// dist/frontline-standalone.html: one self-contained file (solo campaign) that can be
// opened from disk or dropped on any static host.
function writeStandalone() {
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  const css = readFileSync(join(out, 'style.css'), 'utf8');
  const js = readFileSync(join(out, 'game.js'), 'utf8');
  if (/<\/script/i.test(js)) throw new Error('bundle contains </script>; cannot inline');
  const page = html
    .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script type="module" src="game.js"></script>', () => `<script type="module">\n${js}\n</script>`);
  writeFileSync(join(out, 'frontline-standalone.html'), page);
  console.log(`  dist/frontline-standalone.html  ${(page.length / 1024).toFixed(0)}kb`);
}
