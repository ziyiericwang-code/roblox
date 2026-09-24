// Structure builder: prefabs are authored in a local frame (origin at ground
// centre, front facing -Z) and emitted as world-space axis aligned boxes plus
// render-only props. Rotations are restricted to multiples of 90 degrees so
// every collider stays an AABB (fast and robust collision/raycasts).
import { MAT } from './materials.js';

export const BF = {
  SOLID: 1,
  RENDER: 2,
  COVER: 4, // generates AI cover points along the sides
  SMALL: 8, // small detail: rendered only at short range
  WALKSURF: 16, // walkable surface the AI may cross (docks, bridges, stairs)
  NOSHADOW: 32,
  RANGE_TARGET: 64,
  BUILDING: 128, // part of an enterable/solid building (for AI & audio occlusion)
};

const DEFAULT = BF.SOLID | BF.RENDER;

export class Builder {
  constructor(terrain, rng) {
    this.terrain = terrain;
    this.rng = rng;
    this.boxes = []; // {x0,y0,z0,x1,y1,z1,m,f}
    this.props = []; // render-only shapes
    this.lights = []; // {x,y,z,r,color}
    this.flags = []; // sector/base flag poles {key,x,y,z}
    this.markers = []; // named interaction/zone points {type,x,y,z,r,data}
    this.rangeTargets = [];
    this.zones = []; // access-controlled areas {name, level, x0,z0,x1,z1,y0,y1, ...}
    this.buildings = []; // building groups {id, kind, x0,z0,x1,z1,y1, destructible}
    this.cur = null; // building currently being emitted
    this.frames = [];
    this.ox = 0;
    this.oy = 0;
    this.oz = 0;
    this.rot = 0;
  }

  // ------------------------------------------------------------ frames
  push(x, y, z, rot = 0) {
    this.frames.push([this.ox, this.oy, this.oz, this.rot]);
    const w = this.toWorld(x, z);
    this.ox = w[0];
    this.oz = w[1];
    this.oy += y;
    this.rot = (this.rot + rot) & 3;
  }

  pop() {
    const f = this.frames.pop();
    this.ox = f[0];
    this.oy = f[1];
    this.oz = f[2];
    this.rot = f[3];
  }

  // Place a prefab at world (x,z) resting on terrain. Returns ground y used.
  at(x, z, rot, fn, opts = {}) {
    const y = opts.y !== undefined ? opts.y : this.groundFor(x, z, opts.footprint || 4);
    this.frames.push([this.ox, this.oy, this.oz, this.rot]);
    this.ox = x;
    this.oz = z;
    this.oy = y;
    this.rot = rot & 3;
    fn(this);
    this.pop();
    return y;
  }

  groundFor(x, z, r) {
    const t = this.terrain;
    const h = [t.heightAt(x, z), t.heightAt(x - r, z - r), t.heightAt(x + r, z - r), t.heightAt(x - r, z + r), t.heightAt(x + r, z + r)];
    // Buildings sit slightly into the slope; foundations fill the gap below.
    let sum = 0;
    for (const v of h) sum += v;
    return Math.max(sum / h.length, Math.min(...h) + 0.05);
  }

  toWorld(lx, lz) {
    let x;
    let z;
    switch (this.rot) {
      case 0: x = lx; z = lz; break;
      case 1: x = lz; z = -lx; break; // 90deg left (yaw +90)
      case 2: x = -lx; z = -lz; break;
      default: x = -lz; z = lx; break;
    }
    return [this.ox + x, this.oz + z];
  }

  yawWorld(localYaw = 0) {
    return localYaw + (this.rot * Math.PI) / 2;
  }

  // ------------------------------------------------------------ primitives
  box(lx0, ly0, lz0, lx1, ly1, lz1, m, f = DEFAULT) {
    const a = this.toWorld(lx0, lz0);
    const b = this.toWorld(lx1, lz1);
    const x0 = Math.min(a[0], b[0]);
    const x1 = Math.max(a[0], b[0]);
    const z0 = Math.min(a[1], b[1]);
    const z1 = Math.max(a[1], b[1]);
    const y0 = this.oy + Math.min(ly0, ly1);
    const y1 = this.oy + Math.max(ly0, ly1);
    if (x1 - x0 < 0.01 || y1 - y0 < 0.01 || z1 - z0 < 0.01) return null;
    const bx = { x0, y0, z0, x1, y1, z1, m, f };
    if (this.cur) {
      bx.bid = this.cur.id;
      const c = this.cur;
      if (x0 < c.x0) c.x0 = x0;
      if (z0 < c.z0) c.z0 = z0;
      if (x1 > c.x1) c.x1 = x1;
      if (z1 > c.z1) c.z1 = z1;
      if (y1 > c.y1) c.y1 = y1;
      if (y0 < c.y0) c.y0 = y0;
      c.boxes++;
    }
    this.boxes.push(bx);
    return bx;
  }

  // Box by centre and size in local frame.
  cbox(cx, cy, cz, sx, sy, sz, m, f = DEFAULT) {
    return this.box(cx - sx / 2, cy, cz - sz / 2, cx + sx / 2, cy + sy, cz + sz / 2, m, f);
  }

  prop(type, lx, ly, lz, params) {
    const [x, z] = this.toWorld(lx, lz);
    const p = { t: type, x, y: this.oy + ly, z, ...params };
    if (p.yaw !== undefined) p.yaw = this.yawWorld(p.yaw);
    else p.yaw = this.yawWorld(0);
    this.props.push(p);
    return p;
  }

  // Cylinder (render) with an approximating square collider.
  cylinder(lx, ly, lz, r, h, m, collide = true, seg = 12) {
    this.prop('cyl', lx, ly, lz, { r, h, m, seg });
    if (collide) this.box(lx - r * 0.8, ly, lz - r * 0.8, lx + r * 0.8, ly + h, lz + r * 0.8, m, BF.SOLID | BF.COVER);
  }

  light(lx, ly, lz, r = 14, color = 0xffe2b0) {
    const [x, z] = this.toWorld(lx, lz);
    this.lights.push({ x, y: this.oy + ly, z, r, color });
  }

  // Group everything emitted by fn() into one building (far LOD, destruction).
  building(kind, fn, opts = {}) {
    if (this.cur) return fn(this); // nested prefabs belong to the outer building
    const b = { id: this.buildings.length + 1, kind, x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity, y0: Infinity, y1: -Infinity, boxes: 0, destructible: opts.destructible !== false, m: opts.m ?? -1, name: opts.name || '' };
    this.cur = b;
    try {
      fn(this);
    } finally {
      this.cur = null;
    }
    if (b.boxes) this.buildings.push(b);
    return b;
  }

  // Access-controlled area in local coordinates (level: clearance required).
  zone(name, level, lx0, lz0, lx1, lz1, ly0 = -1, ly1 = 6, data = {}) {
    const a = this.toWorld(lx0, lz0);
    const c = this.toWorld(lx1, lz1);
    const z = {
      name, level, x0: Math.min(a[0], c[0]), z0: Math.min(a[1], c[1]), x1: Math.max(a[0], c[0]), z1: Math.max(a[1], c[1]),
      y0: this.oy + ly0, y1: this.oy + ly1, ...data,
    };
    this.zones.push(z);
    return z;
  }

  marker(type, lx, ly, lz, r = 4, data = {}) {
    const [x, z] = this.toWorld(lx, lz);
    const m = { type, x, y: this.oy + ly, z, r, ...data };
    this.markers.push(m);
    return m;
  }

  // Axis aligned wall in local frame from (ax,az) to (bx,bz) (must share x or z),
  // with rectangular openings: [{c: centre distance from a, w, y0, y1}]
  wall(ax, az, bx, bz, y0, h, t, m, openings = [], extraFlags = 0) {
    const alongX = Math.abs(bz - az) < 1e-6;
    const len = alongX ? Math.abs(bx - ax) : Math.abs(bz - az);
    const dir = alongX ? Math.sign(bx - ax) || 1 : Math.sign(bz - az) || 1;
    const f = DEFAULT | BF.BUILDING | extraFlags;
    const seg = (s0, s1, yy0, yy1) => {
      if (s1 - s0 < 0.02 || yy1 - yy0 < 0.02) return;
      if (alongX) {
        const x0 = ax + dir * s0;
        const x1 = ax + dir * s1;
        this.box(Math.min(x0, x1), yy0, az - t / 2, Math.max(x0, x1), yy1, az + t / 2, m, f);
      } else {
        const z0 = az + dir * s0;
        const z1 = az + dir * s1;
        this.box(ax - t / 2, yy0, Math.min(z0, z1), ax + t / 2, yy1, Math.max(z0, z1), m, f);
      }
    };
    const ops = openings
      .map((o) => ({ s0: Math.max(0, o.c - o.w / 2), s1: Math.min(len, o.c + o.w / 2), y0: o.y0, y1: o.y1 }))
      .sort((p, q) => p.s0 - q.s0);
    let cur = 0;
    for (const o of ops) {
      seg(cur, o.s0, y0, y0 + h);
      if (o.y0 > y0) seg(o.s0, o.s1, y0, o.y0);
      if (o.y1 < y0 + h) seg(o.s0, o.s1, o.y1, y0 + h);
      cur = o.s1;
    }
    seg(cur, len, y0, y0 + h);
  }

  // Foundation from below terrain up to local y=0 so buildings never float.
  foundation(w, d, m = MAT.CONCRETE_DARK) {
    const t = this.terrain;
    let minH = Infinity;
    for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]]) {
      const [x, z] = this.toWorld(lx, lz);
      minH = Math.min(minH, t.heightAt(x, z));
    }
    const depth = this.oy - minH;
    if (depth > 0.05) this.box(-w / 2 - 0.1, -depth - 0.4, -d / 2 - 0.1, w / 2 + 0.1, 0.02, d / 2 + 0.1, m, DEFAULT | BF.BUILDING);
  }

  stairs(x0, z0, x1, z1, yBottom, yTop, width, m, axis = 'z') {
    // straight stair from (x0,z0) at yBottom to (x1,z1) at yTop, local frame
    const rise = yTop - yBottom;
    const steps = Math.max(2, Math.ceil(rise / 0.33));
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps;
      const t1 = (s + 1) / steps;
      const yy = yBottom + rise * t1;
      if (axis === 'z') {
        const za = z0 + (z1 - z0) * t0;
        const zb = z0 + (z1 - z0) * t1;
        this.box(x0 - width / 2, yBottom, Math.min(za, zb), x0 + width / 2, yy, Math.max(za, zb), m, DEFAULT | BF.BUILDING | BF.WALKSURF);
      } else {
        const xa = x0 + (x1 - x0) * t0;
        const xb = x0 + (x1 - x0) * t1;
        this.box(Math.min(xa, xb), yBottom, z0 - width / 2, Math.max(xa, xb), yy, z0 + width / 2, m, DEFAULT | BF.BUILDING | BF.WALKSURF);
      }
    }
  }
}
