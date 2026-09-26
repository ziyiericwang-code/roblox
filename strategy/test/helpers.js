// Shared test helpers: load the real world package once.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorld } from '../src/shared/world.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let cached = null;
export function loadWorld() {
  if (!cached) cached = buildWorld(JSON.parse(readFileSync(join(root, 'data/world/world.json'), 'utf8')));
  return cached;
}
export const countryId = (w, iso) => w.countryByIso.get(iso);
