// Restricted areas. Buildings and rooms carry an access level (LVL in
// buildings.js); a soldier may only enter where their rank's clearance is high
// enough. Used by the server (authoritative movement check) and by the client
// (prediction, so the doorway feels solid instead of rubber-banding).
import { WORLD_HALF } from '../constants.js';

const CELL = 64;

export class AccessIndex {
  constructor(zones) {
    this.zones = zones.filter((z) => z.level > 0);
    this.n = Math.ceil((WORLD_HALF * 2) / CELL);
    this.grid = new Map();
    this.zones.forEach((z, i) => {
      const i0 = Math.floor((z.x0 + WORLD_HALF) / CELL);
      const i1 = Math.floor((z.x1 + WORLD_HALF) / CELL);
      const j0 = Math.floor((z.z0 + WORLD_HALF) / CELL);
      const j1 = Math.floor((z.z1 + WORLD_HALF) / CELL);
      for (let j = j0; j <= j1; j++) {
        for (let k = i0; k <= i1; k++) {
          const key = j * this.n + k;
          let list = this.grid.get(key);
          if (!list) this.grid.set(key, (list = []));
          list.push(i);
        }
      }
    });
  }

  // Most restrictive zone containing the point (a small margin keeps the
  // soldier's body out of the doorway), or null.
  zoneAt(x, y, z, margin = 0.3) {
    const key = Math.floor((z + WORLD_HALF) / CELL) * this.n + Math.floor((x + WORLD_HALF) / CELL);
    const list = this.grid.get(key);
    if (!list) return null;
    let best = null;
    for (const i of list) {
      const zn = this.zones[i];
      if (x < zn.x0 - margin || x > zn.x1 + margin || z < zn.z0 - margin || z > zn.z1 + margin) continue;
      if (y < zn.y0 - 1 || y > zn.y1 + 1) continue;
      if (!best || zn.level > best.level) best = zn;
    }
    return best;
  }

  // Zone that blocks a soldier with `clearance` at (x,y,z), or null.
  blocking(x, y, z, clearance) {
    const zn = this.zoneAt(x, y, z);
    return zn && zn.level > clearance ? zn : null;
  }
}
