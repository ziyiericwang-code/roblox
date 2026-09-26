// Turn resolution: the fixed phase order of the simulation.
import { aiTurn } from './ai.js';
import { moveImpulse, findPath } from './movement.js';
import { battleImpulse } from './combat.js';
import { computeFronts } from './fronts.js';
import { computeSupply, supplyTurn, computeAir, updateWeather, intelLevel } from './logistics.js';
import { economyTurn } from './economy.js';
import { updateWarScores, checkAnnexations } from './diplomacy.js';
import { eventsTurn } from './events.js';
import { empireTurn } from './empire.js';
import { careerTurn, award } from './career.js';
import { clamp } from './util.js';
import { strategicTurn } from './strategic.js';

export function runTurn(g) {
  const s = g.s;
  const t = {};
  const time = (k, fn) => {
    const t0 = Date.now();
    fn();
    t[k] = Date.now() - t0;
  };
  s.turnLog = { captures: [], battles: [], events: [] };
  g.intelCache = null;
  g.intelLevel = (c, p) => intelLevel(g, c, p);
  time('prep', () => {
    automation(g);
    operationsTurn(g, 'pre');
    fallbackTriggers(g);
  });
  time('ai', () => aiTurn(g));
  time('strategic', () => strategicTurn(g));
  time('air', () => {
    computeAir(g);
    updateWeather(g);
  });
  time('impulses', () => {
    for (let i = 0; i < 4; i++) {
      moveImpulse(g);
      battleImpulse(g);
    }
  });
  time('fronts', () => computeFronts(g));
  time('supply', () => {
    computeSupply(g);
    supplyTurn(g);
  });
  time('economy', () => economyTurn(g));
  time('diplomacy', () => {
    updateWarScores(g);
    checkAnnexations(g);
    expireProposals(g);
    empireTurn(g);
  });
  time('events', () => eventsTurn(g));
  time('career', () => {
    for (const p of Object.values(s.players)) careerTurn(g, p);
    operationsTurn(g, 'post');
  });
  s.tension = clamp(s.tension + (s.wars.length ? 0.15 : -0.3), 0, 100);
  s.turn++;
  s.lastTurn = {
    turn: s.turn - 1,
    captures: s.turnLog.captures,
    battles: s.turnLog.battles.map((b) => b.id),
    events: s.turnLog.events.map((e) => e.id),
    timing: t,
  };
  g.intelCache = null;
  g.index();
}

// Players who are away: their forces follow standing orders.
function automation(g) {
  const s = g.s;
  for (const p of Object.values(s.players)) {
    const away = p.away || !p.online;
    for (const id of p.formations) {
      const f = s.formations.get(id);
      if (!f) continue;
      if (!away) {
        if (f.tempAuto) {
          f.auto = false;
          f.tempAuto = false;
        }
        continue;
      }
      if (p.standing === 'ai' && !f.auto) {
        f.auto = true;
        f.tempAuto = true;
      } else if (p.standing === 'defensive' && !f.order) f.posture = 'digin';
      else if (p.standing === 'hold' && f.order && f.order.type === 'attack') f.order = null;
    }
  }
}

function fallbackTriggers(g) {
  const s = g.s;
  for (const f of s.formations.values()) {
    if (f.fallback === undefined || f.battle || f.org > 0.3 || f.order) continue;
    const path = findPath(g, f.owner, f.prov, f.fallback, { maxNodes: 400 });
    if (path && path.length > 1) f.order = { type: 'move', path, idx: 1, target: f.fallback, by: f.ctrl || 'ai', then: 'digin' };
  }
}

function expireProposals(g) {
  const s = g.s;
  s.proposals = (s.proposals || []).filter((pr) => s.turn - pr.turn < 4);
}

// Named operations: preparation bonus, generated orders, completion.
function operationsTurn(g, when) {
  const s = g.s;
  for (const op of s.operations) {
    if (op.status === 'complete' || op.status === 'failed' || op.status === 'cancelled') continue;
    const forces = op.forces.map((id) => s.formations.get(id)).filter((f) => f && f.opId === op.id);
    if (!forces.length) {
      op.status = 'failed';
      continue;
    }
    if (when === 'pre') {
      if (op.status === 'preparing') {
        const done = s.turn - op.created;
        for (const f of forces) if (!f.order) f.prep = Math.min(0.15, 0.05 * done);
        if (s.turn >= op.start) {
          op.status = 'active';
          op.launched = s.turn;
          g.notify(op.owners, { kind: 'operation', title: `${op.name} launched`, text: `${forces.length} formation(s) advancing on ${op.objectives.length} objective(s).`, important: true });
        }
      }
      if (op.status === 'active') {
        for (const f of forces) {
          if (f.battle || f.order) continue;
          const open = op.objectives.filter((q) => !(s.prov.ctrl[q] === op.country || g.allied(op.country, s.prov.ctrl[q])));
          if (!open.length) break;
          let best = open[0];
          let bd = Infinity;
          for (const q of open) {
            const d = g.w.kmBetween(f.prov, q);
            if (d < bd) {
              bd = d;
              best = q;
            }
          }
          const path = findPath(g, f.owner, f.prov, best, { maxNodes: 2500 });
          if (path && path.length > 1) f.order = { type: 'attack', path, idx: 1, target: best, by: f.ctrl || 'op', then: 'hold' };
        }
      }
    } else if (op.status === 'active') {
      const taken = op.objectives.filter((q) => s.prov.ctrl[q] === op.country || g.allied(op.country, s.prov.ctrl[q])).length;
      op.progress = taken / op.objectives.length;
      const overdue = s.turn > op.launched + op.estimate * 2 + 2;
      if (taken === op.objectives.length || overdue) {
        op.status = taken === op.objectives.length ? 'complete' : 'failed';
        for (const f of forces) {
          f.prep = 0;
          f.opId = 0;
        }
        for (const pid of op.owners) {
          const p = s.players[pid];
          if (!p) continue;
          p.stats.operations++;
          if (op.status === 'complete') {
            p.stats.opsWon++;
            award(g, p, 40 + op.objectives.length * 25, `${op.name} succeeded`);
          } else award(g, p, 10, `${op.name} ended`);
        }
        s.reports.push({ id: s.nextId.r++, kind: 'operation', turn: s.turn, name: op.name, result: op.status === 'complete' ? 'Success' : `Ended — ${taken}/${op.objectives.length} objectives`, country: op.country, objectives: op.objectives, players: op.owners });
        g.notify(op.owners, { kind: 'operation', title: `${op.name}: ${op.status === 'complete' ? 'success' : 'ended'}`, text: `${taken} of ${op.objectives.length} objectives taken.`, important: true });
      }
    }
  }
  s.operations = s.operations.filter((op) => !(op.status !== 'active' && op.status !== 'preparing' && s.turn - (op.launched || op.created) > 30));
}
