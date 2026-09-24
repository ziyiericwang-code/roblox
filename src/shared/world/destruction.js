// Predefined destruction states instead of physics debris:
//   0 intact → 1 damaged → 2 heavily damaged → 3 destroyed
// Each state removes or cuts down specific pieces of a building, chosen
// deterministically from the box index, so the server (collision) and every
// client (rendering) agree without sending any geometry.
import { MAT } from './materials.js';
import { hash2 } from '../math.js';

export const DSTATE = { INTACT: 0, DAMAGED: 1, HEAVY: 2, DESTROYED: 3 };
export const DSTATE_NAMES = ['Intact', 'Damaged', 'Heavily damaged', 'Destroyed'];

export class Destruction {
  constructor(world) {
    this.world = world;
    this.boxesOf = new Map(); // building id -> box indices
    world.boxes.forEach((b, i) => {
      if (!b.bid) return;
      let list = this.boxesOf.get(b.bid);
      if (!list) this.boxesOf.set(b.bid, (list = []));
      list.push(i);
    });
    this.building = new Map(world.buildings.map((b) => [b.id, b]));
    this.state = new Map();
    this.orig = new Map(); // collider index -> [y0, y1]
  }

  // What happens to box i of building bd in a state: null = untouched,
  // {keep:false} = gone, {keep:true, top, dark} = cut down / scorched.
  fate(bd, i, state) {
    if (!state) return null;
    const b = this.world.boxes[i];
    const h = Math.max(1, bd.y1 - bd.y0);
    const rel0 = (b.y0 - bd.y0) / h;
    const rel1 = (b.y1 - bd.y0) / h;
    const r = hash2(i, bd.id, 911);
    if (state === DSTATE.DAMAGED) {
      if (b.m === MAT.WINDOW && r < 0.55) return { keep: false };
      return { keep: true, top: null, dark: r < 0.35 ? 0.62 : 0.85 };
    }
    if (state === DSTATE.HEAVY) {
      if (b.m === MAT.WINDOW) return { keep: false };
      if (rel0 > 0.72 && r < 0.7) return { keep: false };
      if (rel1 > 0.55 && r < 0.45) return { keep: true, top: bd.y0 + h * (0.4 + r * 0.25), dark: 0.55 };
      return { keep: true, top: null, dark: 0.6 };
    }
    // destroyed: only low broken walls remain
    const rubble = bd.y0 + 0.7 + r * 1.5;
    if (b.y0 >= rubble || b.m === MAT.WINDOW) return { keep: false };
    return { keep: true, top: Math.min(b.y1, rubble), dark: 0.42 };
  }

  get(bid) {
    return this.state.get(bid) || 0;
  }

  // Apply a building's state to the collision world. Returns false if unknown.
  apply(bid, state) {
    const bd = this.building.get(bid);
    const list = this.boxesOf.get(bid);
    if (!bd || !list) return false;
    state = Math.max(0, Math.min(3, state | 0));
    if (state) this.state.set(bid, state);
    else this.state.delete(bid);
    const col = this.world.colliders;
    for (const i of list) {
      const b = this.world.boxes[i];
      const ci = b.ci;
      if (ci === undefined) continue;
      let o = this.orig.get(ci);
      if (!o) {
        o = [col.y0[ci], col.y1[ci]];
        this.orig.set(ci, o);
      }
      const f = this.fate(bd, i, state);
      if (!f || (f.keep && f.top === null)) {
        col.y0[ci] = o[0];
        col.y1[ci] = o[1];
      } else if (!f.keep) {
        col.y0[ci] = -9999;
        col.y1[ci] = -9998;
      } else {
        col.y0[ci] = o[0];
        col.y1[ci] = Math.max(o[0] + 0.05, f.top);
      }
    }
    return true;
  }

  // Center of a building (for chunk refreshes and effects).
  center(bid) {
    const bd = this.building.get(bid);
    return bd ? { x: (bd.x0 + bd.x1) / 2, y: bd.y0, z: (bd.z0 + bd.z1) / 2 } : null;
  }
}
