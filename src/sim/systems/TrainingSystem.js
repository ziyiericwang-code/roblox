// Basic training: a short interactive course at the army headquarters (~4 minutes)
// covering movement, shooting, objectives, commands, vehicles and medical.
// Also runs the marksmanship qualification on any base range.
import { LIFE, STANCE, FACTION_INFO } from '../../shared/constants.js';
import { XP } from '../../shared/config/economy.js';
import { MSG } from '../../shared/protocol.js';
import { dist2D } from '../../shared/math.js';

export const TRAINING_STEPS = [
  { id: 'move', text: 'Welcome to headquarters, Recruit. Move to the obstacle course (WASD / left stick).', hint: 'Follow the marker.' },
  { id: 'course', text: 'Run the course: jump the walls (Space) and crawl under the wire (Z to go prone).', hint: 'Sprint with Shift between obstacles.' },
  { id: 'range', text: 'Head to the firing range and hit 5 targets. Hold right mouse to aim down sights.', hint: 'Short controlled bursts.' },
  { id: 'reload', text: 'Reload your weapon (R).', hint: 'Always reload behind cover.' },
  { id: 'grenade', text: 'Throw a grenade downrange (G). Hold to cook it.', hint: 'Grenades clear enemies behind cover.' },
  { id: 'capture', text: 'Capture the training flag on the parade ground. Stand inside the ring.', hint: 'Objectives win wars, not kills.' },
  { id: 'command', text: 'Leaders command squads. Hold Q (or tap ⌖) and pick an order to see the command wheel.', hint: 'You can issue orders from the rank of Corporal.' },
  { id: 'vehicle', text: 'Get into a jeep at the motor pool (F) and drive it 60 metres.', hint: 'Higher ranks unlock armour and helicopters.' },
  { id: 'medic', text: 'A trainee is down by the medical tents. Hold F next to him to revive.', hint: 'Medics revive faster and heal the wounded.' },
];

export class TrainingSystem {
  constructor(game) {
    this.game = game;
    this.timer = 0;
  }

  active(session) {
    return session.training && !session.profile.trainingComplete;
  }

  onJoin(session) {
    if (!session.profile.trainingComplete) {
      session.training = { step: 0, count: 0, prog: 0 };
      this.sendState(session);
    }
  }

  marker(type, f) {
    const base = this.game.world.bases[f] || Object.values(this.game.world.bases)[0];
    return base.markers.find((m) => m.type === type) || base;
  }

  target(session) {
    const t = session.training;
    const step = TRAINING_STEPS[t.step];
    if (!step) return null;
    switch (step.id) {
      case 'move': return this.marker('course_start', session.faction);
      case 'course': return this.marker('course_end', session.faction);
      case 'range':
      case 'reload':
      case 'grenade': return this.marker('range_pos', session.faction);
      case 'capture': return this.marker('drill', session.faction);
      case 'vehicle': {
        const base = this.game.world.bases[session.faction];
        return this.game.world.vehicleSpawns.find((v) => v.base === base.id && v.vtype === 'jeep') || base;
      }
      case 'medic': {
        const d = t.dummy ? this.game.get(t.dummy) : null;
        return d || this.marker('medical', session.faction) || this.marker('spawn_yard', session.faction);
      }
      default: return null;
    }
  }

  sendState(session) {
    const t = session.training;
    if (!t) return;
    const step = TRAINING_STEPS[t.step];
    const tgt = this.target(session);
    session.send({
      t: MSG.TRAININGSTATE,
      active: !session.profile.trainingComplete,
      step: t.step,
      total: TRAINING_STEPS.length,
      text: step ? step.text : '',
      hint: step ? step.hint : '',
      target: tgt ? [Math.round(tgt.x), Math.round(tgt.z)] : null,
      prog: t.prog || 0,
      count: t.count || 0,
    });
  }

  advance(session) {
    const g = this.game;
    const t = session.training;
    g.progression.award(session, { xp: XP.trainingStep, reason: 'Training', cat: 'training', rewardId: `train:${t.step}`, noMult: true });
    t.step++;
    t.count = 0;
    t.prog = 0;
    if (t.step >= TRAINING_STEPS.length) {
      this.complete(session, false);
      return;
    }
    if (TRAINING_STEPS[t.step].id === 'medic') this.spawnDummy(session);
    if (TRAINING_STEPS[t.step].id === 'vehicle' && session.soldier) t.vStart = null;
    g.emit(['sfx', 'step'], { to: session });
    this.sendState(session);
  }

  complete(session, skipped) {
    const g = this.game;
    const p = session.profile;
    if (p.trainingComplete) return;
    p.trainingComplete = true;
    p.trainingSkipped = !!skipped;
    if (!skipped) {
      g.progression.award(session, { xp: XP.trainingComplete, credits: 150, reason: 'Basic training complete', cat: 'training', rewardId: 'train:complete', noMult: true });
      g.progression.record(session, 'milestone', `Completed basic training at ${g.world.bases[session.faction].name}`);
      g.progression.addStat(session, 'training', 1);
    } else {
      g.progression.record(session, 'milestone', 'Waived basic training');
      g.progression.checkPromotion(session);
    }
    const t = session.training;
    if (t && t.dummy) {
      const d = g.get(t.dummy);
      if (d) g.npc.despawn(d);
    }
    session.training = null;
    session.send({ t: MSG.TRAININGSTATE, active: false, done: true, skipped: !!skipped });
    g.notify(session, skipped ? 'Training waived. Report to the front, Private.' : `Training complete. Welcome to the ${FACTION_INFO[session.faction].army}, Private!`, 'good');
    session.dirtyProfile = true;
    session.saveDirty = true;
    g.deploySys.sendOptions(session);
  }

  spawnDummy(session) {
    const g = this.game;
    const m = this.marker('medical', session.faction);
    const s = g.npc.spawnSoldier(session.faction, m.x + 3, m.z + 2, { kit: 'rifleman', name: 'Trainee Novak' });
    if (!s) return;
    s.life = LIFE.DOWNED;
    s.stance = STANCE.PRONE;
    s.bleedoutAt = Infinity;
    s.npc.state = 'captive';
    s.npc.training = session.id;
    session.training.dummy = s.id;
  }

  onMessage(session, msg) {
    if (msg.a === 'skip' && !session.profile.trainingComplete) this.complete(session, true);
    if (msg.a === 'state') this.sendState(session);
  }

  onDeployed(session) {
    if (this.active(session)) this.sendState(session);
  }

  // ------------------------------------------------------------------ hooks
  onShot(session) {
    const s = session.soldier;
    if (!s) return;
    const r = this.marker('range_pos', session.faction);
    if (!r || dist2D(s.x, s.z, r.x, r.z) > (r.r || 12) + 4) {
      session.range = null;
      return;
    }
    if (!session.range) session.range = { shots: 0, hits: 0 };
    session.range.shots++;
    if (session.range.shots >= 10) {
      const score = session.range.hits;
      this.game.progression.setStatMax(session, 'rangeBest', score);
      this.game.notify(session, `Range qualification: ${score}/10 hits.`, score >= 8 ? 'good' : 'info');
      session.range = null;
    }
  }

  onRangeHit(session) {
    if (session.range) session.range.hits++;
    const t = session.training;
    if (this.active(session) && TRAINING_STEPS[t.step].id === 'range') {
      t.count++;
      t.prog = t.count / 5;
      this.game.emit(['sfx', 'ding'], { to: session });
      if (t.count >= 5) this.advance(session);
      else this.sendState(session);
    }
  }

  onReload(session) {
    const t = session.training;
    if (this.active(session) && TRAINING_STEPS[t.step].id === 'reload') this.advance(session);
  }

  onThrow(session) {
    const t = session.training;
    if (this.active(session) && TRAINING_STEPS[t.step].id === 'grenade') this.advance(session);
  }

  onOrderAttempt(session) {
    const t = session.training;
    if (this.active(session) && TRAINING_STEPS[t.step].id === 'command') {
      this.advance(session);
      return true;
    }
    return false;
  }

  onVehicle(session, v) {
    const t = session.training;
    if (this.active(session) && TRAINING_STEPS[t.step].id === 'vehicle') t.vStart = { x: v.x, z: v.z };
  }

  update(dt) {
    const g = this.game;
    this.timer += dt;
    if (this.timer < 0.25) return;
    const step = this.timer;
    this.timer = 0;
    for (const session of g.sessions) {
      if (!this.active(session)) continue;
      const s = session.soldier;
      const t = session.training;
      if (!s || s.life === LIFE.DEAD) continue;
      const cur = TRAINING_STEPS[t.step];
      if (!cur) continue;
      const tgt = this.target(session);
      switch (cur.id) {
        case 'move':
          if (tgt && dist2D(s.x, s.z, tgt.x, tgt.z) < 5) this.advance(session);
          break;
        case 'course':
          if (tgt && dist2D(s.x, s.z, tgt.x, tgt.z) < 5) this.advance(session);
          break;
        case 'capture':
          if (tgt && dist2D(s.x, s.z, tgt.x, tgt.z) < 9 && s.life === LIFE.ALIVE) {
            t.prog = Math.min(1, (t.prog || 0) + step / 8);
            this.sendState(session);
            if (t.prog >= 1) this.advance(session);
          }
          break;
        case 'vehicle':
          if (s.vehicle && s.seat === 0) {
            const v = g.get(s.vehicle);
            if (!t.vStart) t.vStart = { x: v.x, z: v.z };
            const d = dist2D(v.x, v.z, t.vStart.x, t.vStart.z);
            t.prog = Math.min(1, d / 60);
            if (d >= 60) this.advance(session);
          }
          break;
        case 'medic': {
          const d = t.dummy ? g.get(t.dummy) : null;
          if (!d) this.spawnDummy(session);
          else if (d.life === LIFE.ALIVE) {
            g.npc.despawn(d);
            t.dummy = 0;
            this.advance(session);
          }
          break;
        }
        default:
          break;
      }
    }
  }
}
