// The physical military hierarchy: the people who staff the world.
//
// Every army headquarters, regional garrison, command post and border crossing
// has posts (desks, map tables, radio rooms, gates, drill fields...) filled by
// soldiers and officers of the right rank. The top posts are named characters
// (the Commanding General, the Chief of Staff, regional Colonels...) who are
// always the same people. Posts only materialise when a player is close, so a
// headquarters full of people costs nothing while nobody is there.
//
// Also here: restricted areas (clearance by rank, enforced on movement),
// salutes, conversations with NPCs, promotion ceremonies and base alarms.
import { LIFE, STANCE, FACTION_INFO } from '../../shared/constants.js';
import { RANK, rankOf, addressOf, clearanceRankName, isAnyOfficer, promotionOptions, CLEARANCE_NAMES } from '../../shared/config/ranks.js';
import { fullNameFor, surnameFor } from '../../shared/config/names.js';
import { AccessIndex } from '../../shared/world/access.js';
import { MSG, V } from '../../shared/protocol.js';
import { Rng, dist2D, yawFromDir, approachAngle, hash2 } from '../../shared/math.js';
import { WEAPONS } from '../../shared/config/weapons.js';

// Activity codes (replicated for client animation; 3 bits):
//   0 walk/idle, 1 guard, 2 talk, 3 repair, 4 carry, 5 range shooting, 6 march, 7 staff (at a table)
export const ACT = { IDLE: 0, GUARD: 1, TALK: 2, REPAIR: 3, CARRY: 4, SHOOT: 5, MARCH: 6, STAFF: 7 };

const INDOOR_R = 110; // indoor posts appear when a player is this close
const OUTDOOR_R = 320;
const MAX_ACTIVE = 150; // hard cap on materialised staff (whole world)

// Rank of the officer working at a post of clearance `level`.
const LEVEL_RANK = [
  [RANK.SPECIALIST, RANK.SERGEANT],
  [RANK.STAFF_SERGEANT, RANK.SFC],
  [RANK.SECOND_LT, RANK.FIRST_LT],
  [RANK.CAPTAIN, RANK.MAJOR],
  [RANK.MAJOR, RANK.LT_COLONEL],
  [RANK.BRIG_GENERAL, RANK.MAJOR_GENERAL],
  [RANK.LT_GENERAL, RANK.LT_GENERAL],
];

const TITLES = {
  general: 'Commanding General',
  chief: 'Chief of Staff',
  ops_general: 'Director of Operations',
  sma: 'Sergeant Major of the Army',
  regional: 'Regional Commander',
  assign: 'Assignment Officer',
  quartermaster: 'Quartermaster',
  medic: 'Medical Officer',
  pilot: 'Aviation Officer',
  drill: 'Drill Sergeant',
  radio: 'Signals Operator',
  staff: 'Staff Officer',
  cp: 'Post Commander',
  guard: 'Sentry',
  soldier: 'Soldier',
  mechanic: 'Mechanic',
};

export class HierarchySystem {
  constructor(game) {
    this.game = game;
    this.rng = new Rng(8086);
    this.posts = [];
    this.active = new Set(); // posts with a materialised soldier
    this.timer = 0;
    this.restrictedAt = new Map(); // session id -> time of last notice
    this.greeted = new Map(); // `${npc}:${player}` -> time
    this.alarm = new Map(); // faction -> until
  }

  // ------------------------------------------------------------------ setup
  init() {
    const g = this.game;
    const world = g.world;
    this.access = new AccessIndex(world.zones);
    const baseFaction = new Map(Object.values(world.bases).map((b) => [b.id, b.faction]));
    const siteOf = (m) => {
      if (m.baseRef) return { site: m.baseRef, fixed: baseFaction.get(m.baseRef) || 0 };
      let best = null;
      let bd = Infinity;
      for (const t of world.territories) {
        const d = dist2D(m.x, m.z, t.x, t.z);
        if (d < t.radius * 1.8 && d < bd) {
          bd = d;
          best = t;
        }
      }
      if (best) return { site: best.id, fixed: 0 };
      const r = world.territoryAt(m.x, m.z);
      return { site: r ? r.id : null, fixed: 0 };
    };
    let n = 0;
    const add = (m, role, opts = {}) => {
      const s = siteOf(m);
      if (!s.site) return null;
      const post = {
        id: n++, role, site: s.site, fixed: s.fixed, x: opts.x ?? m.x, y: m.y, z: opts.z ?? m.z, yaw: opts.yaw ?? 0,
        level: m.level || 0, activity: opts.activity ?? ACT.IDLE, rank: opts.rank ?? null, named: opts.named || null,
        indoor: opts.indoor ?? (m.level !== undefined || m.room !== undefined), kit: opts.kit || null, extra: opts.extra || null,
        entity: 0, faction: 0, lastNear: -1e9, seed: Math.floor(hash2(Math.round(m.x), Math.round(m.z), 77) * 100000),
      };
      post.r = post.indoor ? INDOOR_R : OUTDOOR_R;
      this.posts.push(post);
      return post;
    };
    const tableSpots = (m, count) => {
      // stand along the long sides of the table found under the marker
      const col = world.colliders;
      let box = -1;
      col.forEachInRect(m.x - 0.5, m.z - 0.5, m.x + 0.5, m.z + 0.5, (i) => {
        if (col.y1[i] - m.y > 0.6 && col.y1[i] - m.y < 1.3) box = i;
      });
      if (box < 0) return [{ x: m.x + 2, z: m.z, yaw: yawFromDir(-1, 0) }];
      const x0 = col.x0[box];
      const x1 = col.x1[box];
      const z0 = col.z0[box];
      const z1 = col.z1[box];
      const alongX = x1 - x0 >= z1 - z0;
      const spots = [];
      for (let i = 0; i < count; i++) {
        const side = i % 2 ? 1 : -1;
        const t = (Math.floor(i / 2) + 0.5) / Math.ceil(count / 2) - 0.5;
        if (alongX) spots.push({ x: (x0 + x1) / 2 + t * (x1 - x0) * 0.8, z: side > 0 ? z1 + 0.65 : z0 - 0.65, yaw: yawFromDir(0, -side) });
        else spots.push({ x: side > 0 ? x1 + 0.65 : x0 - 0.65, z: (z0 + z1) / 2 + t * (z1 - z0) * 0.8, yaw: yawFromDir(-side, 0) });
      }
      return spots;
    };
    const facing = (m) => {
      // face the nearest desk-height box
      const col = world.colliders;
      let best = null;
      let bd = Infinity;
      col.forEachInRect(m.x - 1.6, m.z - 1.6, m.x + 1.6, m.z + 1.6, (i) => {
        const h = col.y1[i] - m.y;
        if (h < 0.5 || h > 1.3) return;
        const cx = (col.x0[i] + col.x1[i]) / 2;
        const cz = (col.z0[i] + col.z1[i]) / 2;
        const d = dist2D(cx, cz, m.x, m.z);
        if (d < bd) {
          bd = d;
          best = { x: cx, z: cz };
        }
      });
      return best ? yawFromDir(best.x - m.x, best.z - m.z) : 0;
    };
    const seenRegional = new Set();
    for (const m of world.markers) {
      switch (m.type) {
        case 'general_desk':
          add(m, 'general', { rank: RANK.GENERAL, named: 'general', activity: ACT.STAFF, indoor: true, yaw: facing(m) + Math.PI, kit: 'officer' });
          break;
        case 'map_table': {
          const lvl = m.level || 0;
          const count = lvl >= 3 ? 3 : 2;
          tableSpots(m, count).forEach((sp, i) => {
            let rank = LEVEL_RANK[Math.min(6, lvl)][i % 2];
            let named = null;
            let role = lvl >= 4 ? 'staff' : lvl >= 2 ? 'staff' : 'soldier';
            if (m.room === 'Strategy Room' && i === 0) {
              named = 'chief';
              rank = RANK.LT_GENERAL;
              role = 'chief';
            } else if (m.room === 'War Room' && i === 0) {
              named = 'ops_general';
              rank = RANK.MAJOR_GENERAL;
              role = 'ops_general';
            } else if (lvl === 4 && i === 0) {
              const s = siteOf(m);
              if (!seenRegional.has(s.site)) {
                seenRegional.add(s.site);
                named = `regional:${s.site}`;
                rank = RANK.COLONEL;
                role = 'regional';
              }
            }
            add(m, role, { ...sp, rank, named, activity: ACT.STAFF, indoor: true, kit: rank >= RANK.WO1 ? 'officer' : null });
          });
          break;
        }
        case 'desk': {
          const lvl = m.level || 0;
          add(m, lvl >= 2 ? 'staff' : 'soldier', { rank: LEVEL_RANK[Math.min(6, lvl + 1)][0], activity: ACT.STAFF, indoor: true, yaw: facing(m), kit: lvl >= 1 ? 'officer' : null });
          break;
        }
        case 'radio':
          add(m, 'radio', { rank: RANK.SPECIALIST, activity: ACT.STAFF, indoor: true, yaw: facing(m) });
          break;
        case 'briefing':
          add(m, 'staff', { rank: LEVEL_RANK[Math.min(6, (m.level || 0) + 1)][1], activity: ACT.IDLE, indoor: true, kit: 'officer' });
          break;
        case 'assign':
          add(m, 'assign', { rank: RANK.CAPTAIN, named: 'assign', activity: ACT.STAFF, indoor: false, kit: 'officer' });
          break;
        case 'armory':
          if (!this.posts.some((p) => p.role === 'quartermaster' && p.site === siteOf(m).site)) add(m, 'quartermaster', { rank: RANK.SFC, activity: ACT.IDLE, indoor: false });
          break;
        case 'medical':
          add(m, 'medic', { rank: RANK.CAPTAIN, activity: ACT.IDLE, indoor: false, kit: 'medic' });
          break;
        case 'pilot':
          add(m, 'pilot', { rank: RANK.CW3, named: 'pilot', activity: ACT.TALK, indoor: false });
          break;
        case 'guard':
          add(m, 'guard', {
            rank: m.level >= 3 ? RANK.SERGEANT : this.rng.chance(0.5) ? RANK.PFC : RANK.SPECIALIST, activity: ACT.GUARD, indoor: false,
            extra: { look: m.lookX !== undefined ? { x: m.x + m.lookX, z: m.z + m.lookZ } : null, tower: !!m.tower, door: !!m.door, gate: !!m.gate, level: m.level || 0 },
          });
          break;
        case 'talk':
          add(m, 'soldier', { x: m.x - 0.9, rank: RANK.PFC, activity: ACT.TALK, indoor: false, yaw: -Math.PI / 2 });
          add(m, 'soldier', { x: m.x + 0.9, rank: RANK.CORPORAL, activity: ACT.TALK, indoor: false, yaw: Math.PI / 2 });
          break;
        case 'work':
          add(m, 'mechanic', { rank: RANK.SPECIALIST, activity: ACT.REPAIR, indoor: false, kit: 'engineer' });
          break;
        case 'command':
          add(m, 'cp', { rank: RANK.FIRST_LT, activity: ACT.STAFF, indoor: false, kit: 'officer' });
          add(m, 'radio', { x: m.x + 1.6, rank: RANK.SPECIALIST, activity: ACT.STAFF, indoor: false });
          break;
        case 'border':
          add(m, 'guard', { x: m.x - 3, rank: RANK.CORPORAL, activity: ACT.GUARD, indoor: false, extra: {} });
          add(m, 'guard', { x: m.x + 3, rank: RANK.PFC, activity: ACT.GUARD, indoor: false, extra: {} });
          break;
        case 'drill': {
          const lead = add(m, 'drill', { x: m.x - 10, z: m.z - 8, rank: RANK.STAFF_SERGEANT, named: 'drill', activity: ACT.MARCH, indoor: false });
          if (lead) {
            lead.extra = { loop: [[-12, -8], [12, -8], [12, 8], [-12, 8]].map(([x, z]) => ({ x: m.x + x, z: m.z + z })), idx: 0, leader: true };
            for (let i = 1; i < 6; i++) add(m, 'soldier', { x: m.x - 10 - i * 1.6, z: m.z - 8, rank: RANK.RECRUIT, activity: ACT.MARCH, indoor: false, extra: { follow: lead.id, slot: i } });
          }
          break;
        }
        case 'range_pos':
          for (let i = 0; i < 3; i++) add(m, 'soldier', { z: m.z + (i - 1) * 4, rank: RANK.PV2, activity: ACT.SHOOT, indoor: false, extra: { dir: null } });
          break;
        case 'courtyard':
          add(m, 'sma', { rank: RANK.SMA, named: 'sma', activity: ACT.IDLE, indoor: false });
          break;
        default:
          break;
      }
    }
    // carriers and patrols at the headquarters
    for (const base of Object.values(world.bases)) {
      const M = (t) => world.markers.filter((m) => m.baseRef === base.id && m.type === t);
      const ca = M('carry_a')[0];
      const cb = M('carry_b')[0];
      if (ca && cb) for (let i = 0; i < 2; i++) add(ca, 'soldier', { x: ca.x + i * 2, rank: RANK.PV2, activity: ACT.CARRY, indoor: false, extra: { a: { x: ca.x, z: ca.z }, b: { x: cb.x, z: cb.z }, leg: i % 2 } });
      const pat = M('patrol');
      if (pat.length) for (let i = 0; i < 2; i++) add(pat[(i * 2) % pat.length], 'soldier', { rank: RANK.PFC, activity: ACT.IDLE, indoor: false, extra: { loop: pat.map((p) => ({ x: p.x, z: p.z })), idx: i * 2 } });
      // the Sergeant Major walks the base; staff officers walk between buildings
      const doors = M('door');
      const sma = this.posts.find((p) => p.named === 'sma' && p.site === base.id);
      const walk = [...M('parade'), ...M('courtyard'), ...M('mess'), ...M('barracks').slice(0, 2)].map((p) => ({ x: p.x, z: p.z }));
      if (sma && walk.length) sma.extra = { loop: walk, idx: 0, dwell: 12 };
      if (doors.length >= 2) {
        const p = add(doors[0], 'staff', { rank: RANK.MAJOR, activity: ACT.IDLE, indoor: false, kit: 'officer' });
        if (p) p.extra = { loop: doors.map((d) => ({ x: d.x, z: d.z })), idx: 0, dwell: 8 };
      }
    }
  }

  // Faction that currently staffs a post (HQ: fixed; elsewhere: territory owner).
  postFaction(post) {
    if (post.fixed) return post.fixed;
    const w = this.game.war.get(post.site);
    return w ? w.owner : 0;
  }

  // ------------------------------------------------------------------ naming
  nameFor(post, f) {
    // named characters are the same person every time: seeded by country and role
    if (post.named) return fullNameFor(f, strHash(`${f}:${post.named}`));
    return surnameFor(f, post.seed + f * 11);
  }

  titleOf(post) {
    if (post.role === 'regional') {
      const t = this.game.world.tById[post.site];
      return `${TITLES.regional}, ${t ? t.name : 'Region'}`;
    }
    return TITLES[post.role] || TITLES.soldier;
  }

  // ------------------------------------------------------------------ materialisation
  update(dt) {
    const g = this.game;
    this.timer += dt;
    if (this.timer >= 1) {
      this.timer = 0;
      this.refresh();
      this.think();
      this.salutes();
    }
    for (const post of this.active) {
      const s = g.get(post.entity);
      if (s && s.npc && s.npc.path && s.life === LIFE.ALIVE && s.npc.kind === 'ambient') g.npc.move(s, dt, false);
    }
  }

  playerPositions() {
    const out = [];
    for (const sess of this.game.sessions) {
      const s = sess.soldier;
      const p = s && s.life !== LIFE.DEAD ? s : sess.viewPos;
      if (p) out.push(p);
    }
    return out;
  }

  refresh() {
    const g = this.game;
    const players = this.playerPositions();
    for (const post of this.posts) {
      let near = false;
      for (const p of players) {
        const d = dist2D(p.x, p.z, post.x, post.z);
        if (d < post.r + (post.entity ? 40 : 0)) {
          near = true;
          break;
        }
      }
      if (near) post.lastNear = g.time;
      const f = this.postFaction(post);
      if (post.entity) {
        const s = g.get(post.entity);
        if (!s || s.life === LIFE.DEAD || s.npc?.kind !== 'ambient') {
          // killed or drafted: the post stays empty for a while
          post.entity = 0;
          post.vacantUntil = g.time + 120;
          this.active.delete(post);
        } else if (f !== post.faction || (!near && g.time - post.lastNear > 20)) this.clearPost(post);
      } else if (near && f && (post.vacantUntil || 0) < g.time && this.active.size < MAX_ACTIVE && !(this.alarm.get(f) > g.time)) {
        this.fillPost(post, f);
      }
    }
  }

  fillPost(post, f) {
    const g = this.game;
    const rank = post.rank ?? RANK.PFC;
    const officer = rank >= RANK.WO1;
    const s = g.npc.spawnSoldier(f, post.x, post.z, {
      kit: post.kit || (post.role === 'guard' ? 'rifleman' : 'rifleman'),
      ambient: true, rank, name: this.nameFor(post, f), exact: true, y: post.y,
      headgear: rank >= RANK.BRIG_GENERAL ? 'cap' : officer && post.indoor ? 'beret' : officer ? 'beret' : 'helmet',
      camo: rank >= RANK.BRIG_GENERAL ? 'command' : officer && post.indoor ? 'dress' : undefined,
    });
    if (!s) return;
    s.yaw = post.yaw;
    s.activity = post.activity;
    s.staff = post.id;
    s.title = this.titleOf(post);
    s.npc.kind = 'ambient';
    s.npc.post = post;
    s.npc.amb = { ...(post.extra || {}) };
    if (post.extra && post.extra.tower) s.y = post.y;
    post.entity = s.id;
    post.faction = f;
    this.active.add(post);
  }

  clearPost(post) {
    const g = this.game;
    const s = g.get(post.entity);
    if (s && s.npc && s.npc.kind === 'ambient') g.removeEntity(s);
    post.entity = 0;
    this.active.delete(post);
  }

  // ------------------------------------------------------------------ behaviour
  think() {
    const g = this.game;
    for (const post of this.active) {
      const s = g.get(post.entity);
      if (!s || s.life !== LIFE.ALIVE || !s.npc || s.npc.kind !== 'ambient') continue;
      const a = s.npc.amb || {};
      if (s.emote && g.time > (s.emoteUntil || 0)) s.emote = 0;
      switch (post.activity) {
        case ACT.GUARD:
          s.stance = STANCE.STAND;
          if (a.look && this.rng.chance(0.2)) s.yaw = yawFromDir(a.look.x - s.x, a.look.z - s.z) + this.rng.float(-0.6, 0.6);
          else if (this.rng.chance(0.1)) s.yaw = post.yaw + this.rng.float(-1, 1);
          break;
        case ACT.STAFF:
          s.stance = STANCE.STAND;
          s.yaw = approachAngle(s.yaw, post.yaw + (this.rng.chance(0.2) ? this.rng.float(-0.5, 0.5) : 0), 0.6);
          break;
        case ACT.TALK:
          s.emote = this.rng.chance(0.08) ? 4 : 0;
          if (s.emote) s.emoteUntil = g.time + 2;
          break;
        case ACT.REPAIR:
          s.stance = STANCE.CROUCH;
          if (this.rng.chance(0.3)) g.emit(['sparks', r1(s.x), r1(s.y + 0.6), r1(s.z)], { pos: s, range: 90 });
          break;
        case ACT.CARRY: {
          const dest = a.leg ? a.b : a.a;
          if (dist2D(s.x, s.z, dest.x, dest.z) < 2) a.leg = a.leg ? 0 : 1;
          else g.npc.setMove(s, dest.x, dest.z, false);
          s.activity = a.leg ? ACT.CARRY : ACT.IDLE;
          break;
        }
        case ACT.SHOOT: {
          s.stance = this.rng.chance(0.5) ? STANCE.STAND : STANCE.CROUCH;
          if (a.dir === null || a.dir === undefined) a.dir = this.rangeDirection(post);
          s.yaw = approachAngle(s.yaw, a.dir, 1);
          if (this.rng.chance(0.55)) {
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
            if (this.rng.chance(0.06)) g.npc.say(s, this.rng.pick(['Left! Left! Left, right, left!', 'Pick up the pace, recruits!', 'Eyes front!', 'Sound off!']));
          } else {
            const leadPost = this.posts[a.follow];
            const lead = leadPost && g.get(leadPost.entity);
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
            if (dist2D(s.x, s.z, p.x, p.z) < 3) {
              a.waitUntil = a.waitUntil || g.time + (a.dwell || 0);
              if (g.time >= a.waitUntil) {
                a.idx = (a.idx + 1) % a.loop.length;
                a.waitUntil = 0;
              }
            } else g.npc.setMove(s, p.x, p.z, false);
          } else if (dist2D(s.x, s.z, post.x, post.z) > 2) g.npc.setMove(s, post.x, post.z, false);
        }
      }
    }
  }

  rangeDirection(post) {
    // range lanes run from the firing positions towards the range marker
    const g = this.game;
    const r = g.world.markers.find((m) => m.type === 'range' && dist2D(m.x, m.z, post.x, post.z) < 150);
    return r ? yawFromDir(r.x - post.x, r.z - post.z) : 0;
  }

  // Soldiers salute officers who pass by and greet senior NCOs.
  salutes() {
    const g = this.game;
    for (const sess of g.sessions) {
      const ps = sess.soldier;
      if (!ps || ps.life !== LIFE.ALIVE || ps.vehicle) continue;
      const pr = sess.rankIndex;
      if (pr < RANK.SERGEANT) continue;
      for (const npc of g.soldiersNear(ps.x, ps.z, 7, (e) => e.npc && e.npc.kind === 'ambient' && e.faction === ps.faction && e.life === LIFE.ALIVE && e.rank < pr)) {
        const key = `${npc.id}:${sess.id}`;
        if ((this.greeted.get(key) || -1e9) + 90 > g.time) continue;
        this.greeted.set(key, g.time);
        const officer = isAnyOfficer(pr);
        const hour = g.weather.clock ?? 12;
        const tod = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
        if (officer && !isAnyOfficer(npc.rank)) {
          npc.emote = 1;
          npc.emoteUntil = g.time + 2.4;
          npc.yaw = yawFromDir(ps.x - npc.x, ps.z - npc.z);
          g.npc.say(npc, `Good ${tod}, ${addressOf(pr)}.`);
        } else if (officer) {
          g.npc.say(npc, `${addressOf(pr)}.`);
        } else if (pr >= RANK.FIRST_SERGEANT) {
          g.npc.say(npc, `${addressOf(pr)}!`);
        }
      }
    }
    if (this.greeted.size > 2000) this.greeted.clear();
  }

  // A player saluted: officers and NCOs nearby return it.
  onPlayerEmote(session, code) {
    const g = this.game;
    const ps = session.soldier;
    if (!ps || code !== 1) return;
    const npc = g.soldiersNear(ps.x, ps.z, 8, (e) => e.npc && e.faction === ps.faction && e.life === LIFE.ALIVE && e.rank > session.rankIndex)[0];
    if (!npc) return;
    npc.emote = 1;
    npc.emoteUntil = g.time + 2;
    npc.yaw = yawFromDir(ps.x - npc.x, ps.z - npc.z);
    g.npc.say(npc, `Carry on, ${addressOf(session.rankIndex)}.`);
  }

  // ------------------------------------------------------------------ restricted areas
  blockedFor(session, x, y, z) {
    if (session.admin && session.adminBypass) return null;
    return this.access.blocking(x, y, z, rankOf(session.rankIndex).clearance);
  }

  onRestricted(session, x, y, z) {
    const g = this.game;
    const zn = this.access.zoneAt(x, y, z);
    if (!zn) return;
    const last = this.restrictedAt.get(session.id) || -1e9;
    if (g.time - last < 4) return;
    this.restrictedAt.set(session.id, g.time);
    g.emit(['restricted', zn.name, zn.level], { to: session });
    const ps = session.soldier;
    const guard = ps && g.soldiersNear(ps.x, ps.z, 25, (e) => e.npc && e.npc.kind === 'ambient' && e.faction === ps.faction && e.life === LIFE.ALIVE)[0];
    if (guard) {
      guard.yaw = yawFromDir(ps.x - guard.x, ps.z - guard.z);
      g.npc.say(guard, `Restricted area, ${addressOf(session.rankIndex)}. ${zn.name} is for ${clearanceRankName(zn.level)}.`);
    }
  }

  // ------------------------------------------------------------------ conversations
  onTalk(session, msg) {
    const g = this.game;
    const ps = session.soldier;
    if (!ps || ps.life !== LIFE.ALIVE || !V.int(msg.id, 1, 65535)) return;
    const npc = g.get(msg.id);
    if (!npc || npc.k !== 1 || !npc.npc || npc.life !== LIFE.ALIVE) return;
    if (dist2D(npc.x, npc.z, ps.x, ps.z) > 6) return;
    if (npc.faction !== ps.faction) {
      if (npc.faction && !g.war.atWar(npc.faction, ps.faction)) this.say(session, npc, `You're a long way from home, ${FACTION_INFO[ps.faction].adj} soldier. Move along.`, []);
      return;
    }
    npc.yaw = yawFromDir(ps.x - npc.x, ps.z - npc.z);
    const post = npc.npc.post || null;
    const role = post ? post.role : npc.npc.squad ? 'squad' : 'soldier';
    const opt = V.str(msg.opt, 24) ? msg.opt : null;
    const pr = session.rankIndex;
    const addr = addressOf(pr);
    const promos = promotionOptions(session.profile).filter((o) => o.met && npc.rank > o.to);
    // shared options
    const base = [];
    if (promos.length) base.push({ id: `promote:${promos[0].to}`, label: `Request promotion to ${rankOf(promos[0].to).name}` });
    if (opt && opt.startsWith('promote:')) {
      g.progression.onPromote(session, { to: Number(opt.slice(8)) });
      return;
    }
    if (opt === 'bye') return this.close(session, npc, 'Dismissed.');
    switch (role) {
      case 'general':
      case 'chief':
      case 'ops_general':
      case 'regional': {
        if (opt === 'brief' || !opt) {
          const text = this.briefing(session, role === 'regional' ? post.site : null);
          const opts = [...base, { id: 'orders', label: 'Request orders' }, { id: 'bye', label: 'Dismissed' }];
          return this.say(session, npc, `${pr >= npc.rank ? `${addr}.` : `At ease, ${addr}.`} ${text}`, opts);
        }
        if (opt === 'orders') {
          const rk = rankOf(pr);
          if (rk.map) return this.say(session, npc, `You have the authority, ${addr}. Open the war map (M) and give your orders: ATTACK, DEFEND, MOVE or REINFORCE.`, [{ id: 'bye', label: 'Understood' }]);
          const rec = g.missions.recommend ? g.missions.recommend(session) : null;
          return this.say(session, npc, rec ? `Your orders, ${addr}: ${rec}` : `Report to your unit and hold the line, ${addr}.`, [{ id: 'bye', label: `Yes, ${addressOf(npc.rank)}` }]);
        }
        break;
      }
      case 'assign': {
        if (opt === 'accept' && session.offer) {
          g.missions.acceptOffer?.(session);
          return this.close(session, npc, 'Good luck out there.');
        }
        const rec = g.missions.offerFor ? g.missions.offerFor(session) : null;
        if (!rec) return this.say(session, npc, `Nothing for you right now, ${addr}. Check back after the next briefing.`, [...base, { id: 'bye', label: 'Dismissed' }]);
        return this.say(session, npc, `${addr}, I have an assignment for you: ${rec}`, [{ id: 'accept', label: 'Accept assignment' }, { id: 'other', label: 'Something else' }, ...base, { id: 'bye', label: 'Not now' }]);
      }
      case 'quartermaster': {
        this.resupply(ps);
        return this.say(session, npc, `Topped up, ${addr}. Ammunition, grenades and a fresh vest. Sign here.`, [...base, { id: 'bye', label: 'Thanks' }]);
      }
      case 'medic': {
        ps.health = 100;
        ps.infoVersion++;
        return this.say(session, npc, `You're patched up, ${addr}. Try not to come back too soon.`, [...base, { id: 'bye', label: 'Thanks' }]);
      }
      case 'pilot': {
        const can = pr >= RANK.STAFF_SERGEANT || (pr >= RANK.WO1 && pr <= RANK.CW5);
        return this.say(session, npc, can
          ? `Birds are fuelled on the pad, ${addr}. You're qualified — take one up.`
          : `Only Staff Sergeants and warrant officers fly our helicopters, ${addr}. Hitch a ride in the back.`, [...base, { id: 'bye', label: 'Thanks' }]);
      }
      case 'drill': {
        if (!session.profile.trainingComplete) return this.say(session, npc, 'You call that running, recruit? Get to the course start and do it properly! Finish basic training and you become a Private.', [{ id: 'bye', label: 'Yes, Drill Sergeant!' }]);
        return this.say(session, npc, `Good to see a graduate, ${addr}. Now go win the war.`, [...base, { id: 'bye', label: 'Hooah' }]);
      }
      case 'guard': {
        const lvl = post && post.extra ? post.extra.level || 0 : 0;
        const ok = rankOf(pr).clearance >= lvl;
        return this.say(session, npc, lvl > 0
          ? ok ? `You're cleared for ${CLEARANCE_NAMES[lvl]} areas, ${addr}. Go ahead.` : `This entrance is ${CLEARANCE_NAMES[lvl]} only, ${addr}. Come back with more rank on your collar.`
          : `All quiet at the gate, ${addr}.`, [...base, { id: 'bye', label: 'Carry on' }]);
      }
      case 'radio': {
        const last = g.war.history.slice(-3).map((h) => h.text).join(' · ') || 'Nothing on the net.';
        return this.say(session, npc, `Latest traffic, ${addr}: ${last}`, [...base, { id: 'bye', label: 'Thanks' }]);
      }
      default: {
        // rank-and-file: flavour, and recruiting for NCOs with a squad
        const w = g.war;
        const b = [...w.battles.values()].find((x) => x.attacker === ps.faction || x.defender === ps.faction);
        const talk = b ? `They say the fighting at ${g.world.tById[b.territory].name} is fierce.` : 'Quiet for once. Won’t last.';
        const opts = [...base];
        if (pr >= RANK.CORPORAL && npc.rank < pr && post) opts.push({ id: 'recruit', label: 'Join my squad' });
        opts.push({ id: 'bye', label: 'Carry on' });
        if (opt === 'recruit' && pr >= RANK.CORPORAL && npc.rank < pr) {
          if (g.npc.recruitFollower && g.npc.recruitFollower(session, npc)) {
            if (post) {
              post.entity = 0;
              post.vacantUntil = g.time + 300;
              this.active.delete(post);
            }
            return this.close(session, npc, `Yes, ${addr}! Right behind you.`);
          }
          return this.close(session, npc, `Your squad is full, ${addr}.`);
        }
        const greet = npc.rank < pr ? `${addr}!` : npc.rank > pr ? `What is it, ${addr}?` : 'Hey.';
        return this.say(session, npc, `${greet} ${talk}`, opts);
      }
    }
    return this.close(session, npc, 'Carry on.');
  }

  say(session, npc, text, options) {
    this.game.npc.say(npc, text.length > 90 ? `${text.slice(0, 87)}...` : text);
    session.send({ t: MSG.DIALOG, npc: npc.id, name: `${rankOf(npc.rank).abbr} ${npc.name}`, rank: npc.rank, title: npc.title || '', text, options });
  }

  close(session, npc, text) {
    this.game.npc.say(npc, text);
    session.send({ t: MSG.DIALOG, npc: npc.id, close: true, text });
  }

  briefing(session, siteId) {
    const g = this.game;
    const f = session.faction;
    const w = g.war;
    const foes = w.enemies(f).map((e) => FACTION_INFO[e].short);
    const held = w.territoriesOf(f).length;
    const battles = [...w.battles.values()].filter((b) => b.attacker === f || b.defender === f);
    const parts = [];
    parts.push(foes.length ? `We are at war with ${foes.join(' and ')}.` : 'We are at peace — for now.');
    parts.push(`We hold ${held} territories.`);
    if (battles.length) parts.push(`Battles: ${battles.slice(0, 3).map((b) => `${g.world.tById[b.territory].name} (${b.attacker === f ? 'attacking' : 'defending'})`).join(', ')}.`);
    if (siteId) {
      const t = g.world.tById[siteId];
      const near = w.neighbours(siteId).filter((e) => w.atWar(w.ownerOf(e.id), f)).map((e) => g.world.tById[e.id]?.name).filter(Boolean);
      if (t) parts.push(near.length ? `From ${t.name} the enemy is at ${near.join(', ')}.` : `${t.name} is behind the lines.`);
    }
    return parts.join(' ');
  }

  resupply(s) {
    for (const ws of s.weapons) {
      const w = WEAPONS[ws.id];
      if (!w) continue;
      if (w.kind === 'gun' || w.kind === 'launcher') {
        ws.mag = w.mag;
        ws.reserve = w.reserveMax ?? w.mag * 4;
      }
      if (w.kind === 'throwable' && ws.count !== undefined) ws.count = Math.max(ws.count, w.count ?? 2);
    }
    s.armor = Math.max(s.armor || 0, 50);
    s.infoVersion++;
  }

  promotionSpeech(officer, session, to) {
    const g = this.game;
    officer.emote = 1;
    officer.emoteUntil = g.time + 2.5;
    g.npc.say(officer, `Congratulations, ${addressOf(to)} ${session.name}. You've earned it.`);
  }

  // ------------------------------------------------------------------ base alarm
  // Base invasion: every staff soldier of that country grabs a rifle and defends.
  onBaseAlarm(faction, on) {
    const g = this.game;
    if (!on) {
      this.alarm.delete(faction);
      return;
    }
    this.alarm.set(faction, g.time + 600);
    const base = g.world.bases[faction];
    const members = [];
    for (const post of [...this.active]) {
      if (post.faction !== faction || post.site !== base.id) continue;
      const s = g.get(post.entity);
      if (!s || !s.npc || post.indoor) continue;
      s.ambient = false;
      s.combatReady = true;
      s.activity = 0;
      s.npc.kind = 'combat';
      s.npc.amb = null;
      s.npc.post = null;
      members.push(s);
      post.entity = 0;
      this.active.delete(post);
    }
    if (!members.length) return;
    const sq = {
      id: g.npc.nextSquadId++, faction, members: members.map((m) => m.id), leaderId: members[0].id,
      task: { type: 'defend', x: base.x, z: base.z, r: 40 }, battleId: 0, mission: 0, special: true,
      spawned: g.time, original: members.length, orderedUntil: 0, lastTaskAt: g.time, noPlayerSince: g.time,
    };
    for (const m of members) m.npc.squad = sq.id;
    g.npc.squads.set(sq.id, sq);
    g.npc.assignSquadTask(sq, sq.task);
  }

  // Admin/perf: counts.
  stats() {
    return { posts: this.posts.length, active: this.active.size };
  }
}

function r1(v) {
  return Math.round(v * 10) / 10;
}

function strHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}
