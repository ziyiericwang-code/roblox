// Client-side entity replica: snapshot buffers with interpolation, entity
// info (names/cosmetics) and a synced server clock.
import { decodeSnapshot } from '../../shared/protocol.js';
import { ENTITY } from '../../shared/constants.js';
import { wrapAngle } from '../../shared/math.js';

const INTERP_DELAY = 0.11;
const BUF = 12;

export class ClientWorld {
  constructor() {
    this.ents = new Map(); // id -> {k, buf:[states], info}
    this.infos = new Map();
    this.offset = null; // serverTime - localTime
    this.lastSnapLocal = 0;
    this.ack = 0;
    this.snapCount = 0;
  }

  now() {
    return performance.now() / 1000;
  }

  serverNow() {
    return this.offset === null ? 0 : this.now() + this.offset;
  }

  renderTime() {
    return this.serverNow() - INTERP_DELAY;
  }

  applySnapshot(buf) {
    const snap = decodeSnapshot(buf);
    if (!snap) return;
    this.snapCount++;
    const t = snap.time / 1000;
    const local = this.now();
    const off = t - local;
    // track the offset, favouring the freshest (least delayed) samples
    if (this.offset === null || off > this.offset || Math.abs(off - this.offset) > 1) this.offset = off;
    else this.offset += (off - this.offset) * 0.02;
    this.lastSnapLocal = local;
    this.ack = snap.ack;
    for (const it of snap.items) {
      let e = this.ents.get(it.id);
      if (!e || e.k !== it.k) {
        e = { id: it.id, k: it.k, buf: [] };
        this.ents.set(it.id, e);
      }
      it.t = t;
      e.buf.push(it);
      if (e.buf.length > BUF) e.buf.shift();
      e.latest = it;
    }
  }

  onInfo(list) {
    for (const i of list) this.infos.set(i.id, i);
  }

  onGone(ids) {
    for (const id of ids) {
      this.ents.delete(id);
      this.infos.delete(id);
    }
  }

  // Interpolated state for an entity at render time.
  sample(e, rt = this.renderTime()) {
    const b = e.buf;
    if (!b.length) return null;
    if (b.length === 1 || rt >= b[b.length - 1].t) return b[b.length - 1];
    if (rt <= b[0].t) return b[0];
    for (let i = b.length - 2; i >= 0; i--) {
      const a = b[i];
      if (a.t <= rt) {
        const c = b[i + 1];
        const f = (rt - a.t) / (c.t - a.t || 1);
        const out = { ...c };
        out.x = a.x + (c.x - a.x) * f;
        out.y = a.y + (c.y - a.y) * f;
        out.z = a.z + (c.z - a.z) * f;
        if (a.yaw !== undefined) out.yaw = a.yaw + wrapAngle(c.yaw - a.yaw) * f;
        if (a.pitch !== undefined) out.pitch = a.pitch + (c.pitch - a.pitch) * f;
        if (a.roll !== undefined) out.roll = a.roll + (c.roll - a.roll) * f;
        if (a.turretYaw !== undefined) out.turretYaw = a.turretYaw + wrapAngle(c.turretYaw - a.turretYaw) * f;
        return out;
      }
    }
    return b[b.length - 1];
  }

  soldiers() {
    const out = [];
    for (const e of this.ents.values()) if (e.k === ENTITY.SOLDIER) out.push(e);
    return out;
  }
  vehicles() {
    const out = [];
    for (const e of this.ents.values()) if (e.k === ENTITY.VEHICLE) out.push(e);
    return out;
  }
  others() {
    const out = [];
    for (const e of this.ents.values()) if (e.k === ENTITY.PROJECTILE || e.k === ENTITY.PROP) out.push(e);
    return out;
  }
}
