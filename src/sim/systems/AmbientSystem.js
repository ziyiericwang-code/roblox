// Ambient base life: guards, drilling squads, mechanics, porters, range
// shooters and chatting soldiers. Only simulated while a player is nearby.
// Activity codes (replicated for client animation):
//   0 walk/idle, 1 guard, 2 talk, 3 repair, 4 carry, 5 range shooting, 6 march
import { FACTION, LIFE, STANCE } from '../../shared/constants.js';
import { GAME } from '../../shared/config/game.js';
import { Rng, dist2D, yawFromDir, approachAngle } from '../../shared/math.js';

const ACT = { IDLE: 0, GUARD: 1, TALK: 2, REPAIR: 3, CARRY: 4, SHOOT: 5, MARCH: 6 };

export class AmbientSystem {
  constructor(game) {
    this.game = game;
    this.rng = new Rng(1234);
    this.bases = new Map(); // faction -> {active, npcs:[], lastPlayerAt}
    this.timer = 0;
  }

  update(dt) {
    const g = this.game;
    this.timer += dt;
    if (this.timer >= 1) {
      this.timer = 0;
      const f = FACTION.COALITION;
      const base = g.world.bases[f];
      let st = this.bases.get(f);
      if (!st) {
        st = { active: false, npcs: [], lastPlayerAt: -1e9 };
        this.bases.set(f, st);
      }
      const near = g.npc.nearPlayer(base.x, base.z, 300);
      if (near) st.lastPlayerAt = g.time;
      if (near && !st.active) this.populate(base, st);
      else if (!near && st.active && g.time - st.lastPlayerAt > 25) this.clear(st);
      if (st.active) this.think(base, st);
    }
    // movement (every tick) for ambient walkers near players
    for (const st of this.bases.values()) {
      if (!st.active) continue;
      for (const id of st.npcs) {
        const s = g.get(id);
        if (!s || !s.npc || s.npc.kind !== 'ambient' || s.life !== LIFE.ALIVE) continue;
        if (s.npc.path) g.npc.move(s, dt, false);
      }
    }
  }

  spawn(base, x, z, activity, opts = {}) {
    const g = this.game;
    const s = g.npc.spawnSoldier(base.faction, x, z, { kit: opts.kit || 'rifleman', ambient: true, rank: opts.rank });
    if (!s) return null;
    s.activity = activity;
    s.npc.kind = 'ambient';
    s.npc.amb = { activity, ...opts };
    if (opts.yaw !== undefined) s.yaw = opts.yaw;
    return s;
  }

  populate(base, st) {
    const g = this.game;
    st.active = true;
    st.npcs = [];
    const add = (s) => s && st.npcs.push(s.id);
    const M = (type) => base.markers.filter((m) => m.type === type);
    for (const m of M('guard')) {
      if (st.npcs.length >= GAME.ambientNpcCap) break;
      const s = this.spawn(base, m.x, m.z, ACT.GUARD, { home: { x: m.x, z: m.z }, look: m.lookX !== undefined ? { x: m.lookX, z: m.lookZ } : null });
      if (s && m.tower) s.y = m.y;
      add(s);
    }
    for (const m of M('talk')) {
      const a = this.spawn(base, m.x - 0.9, m.z, ACT.TALK, { home: { x: m.x - 0.9, z: m.z }, yaw: -Math.PI / 2 });
      const b = this.spawn(base, m.x + 0.9, m.z, ACT.TALK, { home: { x: m.x + 0.9, z: m.z }, yaw: Math.PI / 2, rank: 12 });
      add(a);
      add(b);
    }
    for (const m of M('work')) add(this.spawn(base, m.x, m.z, ACT.REPAIR, { home: { x: m.x, z: m.z }, kit: 'engineer' }));
    const ca = M('carry_a')[0];
    const cb = M('carry_b')[0];
    if (ca && cb) {
      for (let i = 0; i < 2; i++) add(this.spawn(base, ca.x + i * 2, ca.z, ACT.CARRY, { a: { x: ca.x, z: ca.z }, b: { x: cb.x, z: cb.z }, leg: i % 2 }));
    }
    const range = M('range_pos')[0];
    if (range) {
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * 4;
        // range lanes run towards local west of the base (see layout)
        add(this.spawn(base, range.x, range.z + off, ACT.SHOOT, { home: { x: range.x, z: range.z + off }, yaw: base.rot === 2 ? -Math.PI / 2 : Math.PI / 2 }));
      }
    }
    const drill = M('drill')[0];
    if (drill) {
      const lead = this.spawn(base, drill.x - 10, drill.z - 8, ACT.MARCH, { loop: [[-12, -8], [12, -8], [12, 8], [-12, 8]].map(([x, z]) => ({ x: drill.x + x, z: drill.z + z })), idx: 0, leader: true, rank: 6 });
      add(lead);
      for (let i = 1; i < 6 && lead; i++) {
        add(this.spawn(base, drill.x - 10 - i * 1.6, drill.z - 8, ACT.MARCH, { follow: lead.id, slot: i }));
      }
    }
    const patrol = M('patrol');
    if (patrol.length) {
      for (let i = 0; i < 2; i++) add(this.spawn(base, patrol[i * 2 % patrol.length].x, patrol[i * 2 % patrol.length].z, ACT.IDLE, { loop: patrol.map((p) => ({ x: p.x, z: p.z })), idx: i * 2 }));
    }
    void g;
  }

  clear(st) {
    const g = this.game;
    for (const id of st.npcs) {
      const s = g.get(id);
      if (s && s.npc && s.npc.kind === 'ambient') g.removeEntity(s);
    }
    st.npcs = [];
    st.active = false;
  }

  think(base, st) {
    const g = this.game;
    for (const id of st.npcs) {
      const s = g.get(id);
      if (!s || !s.npc || s.npc.kind !== 'ambient') continue;
      const a = s.npc.amb;
      switch (a.activity) {
        case ACT.GUARD:
          s.stance = STANCE.STAND;
          if (a.look && this.rng.chance(0.2)) s.yaw = yawFromDir(a.look.x - s.x, a.look.z - s.z) + this.rng.float(-0.6, 0.6);
          else if (this.rng.chance(0.1)) s.yaw += this.rng.float(-1, 1);
          break;
        case ACT.TALK:
          s.emote = this.rng.chance(0.08) ? 6 : 0;
          break;
        case ACT.REPAIR:
          s.stance = STANCE.CROUCH;
          if (this.rng.chance(0.3)) g.emit(['sparks', Math.round(s.x * 10) / 10, Math.round((s.y + 0.6) * 10) / 10, Math.round(s.z * 10) / 10], { pos: s, range: 90 });
          break;
        case ACT.CARRY: {
          const dest = a.leg ? a.b : a.a;
          s.carrying = a.leg ? 0 : 0; // visual only via activity code
          if (dist2D(s.x, s.z, dest.x, dest.z) < 2) a.leg = a.leg ? 0 : 1;
          else g.npc.setMove(s, dest.x, dest.z, false);
          s.activity = a.leg ? ACT.CARRY : ACT.IDLE;
          break;
        }
        case ACT.SHOOT: {
          s.stance = this.rng.chance(0.5) ? STANCE.STAND : STANCE.CROUCH;
          s.yaw = approachAngle(s.yaw, a.yaw, 1);
          if (this.rng.chance(0.55)) {
            // visual-only range fire aimed downrange
            const fx = -Math.sin(s.yaw);
            const fz = -Math.cos(s.yaw);
            const ey = s.y + 1.4;
            g.emit(['shot', s.id, 1, r1(s.x + fx), r1(ey), r1(s.z + fz), r1(s.x + fx * 30), r1(ey - 0.4), r1(s.z + fz * 30), 2, 27], { pos: s, range: 260 });
            s.firingUntil = g.time + 0.3;
          }
          break;
        }
        case ACT.MARCH: {
          if (a.leader) {
            const p = a.loop[a.idx];
            if (dist2D(s.x, s.z, p.x, p.z) < 1.5) a.idx = (a.idx + 1) % a.loop.length;
            g.npc.setMove(s, p.x, p.z, false);
          } else {
            const lead = g.get(a.follow);
            if (lead) {
              const fx = -Math.sin(lead.yaw);
              const fz = -Math.cos(lead.yaw);
              const tx = lead.x - fx * a.slot * 1.7;
              const tz = lead.z - fz * a.slot * 1.7;
              if (dist2D(s.x, s.z, tx, tz) > 0.8) g.npc.setMove(s, tx, tz, false);
            }
          }
          break;
        }
        default: {
          if (a.loop) {
            const p = a.loop[a.idx % a.loop.length];
            if (dist2D(s.x, s.z, p.x, p.z) < 3) a.idx = (a.idx + 1) % a.loop.length;
            g.npc.setMove(s, p.x, p.z, false);
          }
        }
      }
    }
  }

  // Base invasion: every ambient soldier grabs a rifle and defends.
  onBaseAlarm(faction, on) {
    const g = this.game;
    const st = this.bases.get(faction);
    if (!st || !on) return;
    const base = g.world.bases[faction];
    const members = [];
    for (const id of st.npcs) {
      const s = g.get(id);
      if (!s || !s.npc) continue;
      s.ambient = false;
      s.combatReady = true;
      s.activity = 0;
      s.npc.kind = 'combat';
      s.npc.amb = null;
      members.push(s);
    }
    st.npcs = [];
    st.active = false;
    if (!members.length) return;
    const sq = {
      id: g.npc.nextSquadId++, faction, members: members.map((m) => m.id), leaderId: members[0].id,
      task: { type: 'defend', x: base.x, z: base.z - 60, r: 40 }, battleId: 0, mission: 0, special: true,
      spawned: g.time, original: members.length, orderedUntil: 0, lastTaskAt: g.time, noPlayerSince: g.time,
    };
    for (const m of members) m.npc.squad = sq.id;
    g.npc.squads.set(sq.id, sq);
    g.npc.assignSquadTask(sq, sq.task);
  }
}

function r1(v) {
  return Math.round(v * 10) / 10;
}
