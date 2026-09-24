// Bundles the browser client (and the solo-mode simulation) into dist/.
import { build, context } from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';
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
}
