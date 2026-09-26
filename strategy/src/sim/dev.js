// Developer-only commands. The caller must have `player.dev === true`, which only the
// server (allowlist + secret) or a dev build can set. Every use is audited.
import { RANKS } from '../../config/ranks.js';
import { declareWar, makePeace, warBetween } from './diplomacy.js';
import { newFormation, moveFormation } from './formations.js';
import { fillCommand, computeArea } from './career.js';
import { joinOrStartBattle } from './combat.js';

export function devCommand(g, p, cmd) {
  const s = g.s;
  s.devLog = s.devLog || [];
  s.devLog.push({ turn: s.turn, player: p.id, cmd: JSON.stringify(cmd).slice(0, 200) });
  s.devTouched = true;
  const ok = (x = {}) => ({ ok: true, ...x });
  const fail = (reason) => ({ ok: false, reason });
  const nat = s.countries[p.country];
  switch (cmd.action) {
    case 'rank':
      p.rank = Math.max(0, Math.min(RANKS.length - 1, cmd.rank | 0));
      p.timeInGrade = 0;
      if (p.rank >= 49) {
        p.ai.economy = false;
        p.ai.diplomacy = false;
      }
      fillCommand(g, p);
      p.area = computeArea(g, p);
      return ok();
    case 'xp':
      p.xp += cmd.amount | 0;
      return ok();
    case 'cp':
      p.cp = 999;
      p.influence = 100;
      return ok();
    case 'resources':
      nat.treasury += 500;
      nat.manpower += 500000;
      for (const k of Object.keys(nat.stock)) nat.stock[k] += 500;
      return ok();
    case 'spawn': {
      const comp = cmd.comp || { armor: 20, mech: 20, art: 8, inf: 20 };
      const f = newFormation(g, { owner: cmd.country ?? p.country, prov: cmd.prov ?? p.hq, comp, name: cmd.name || 'Dev Strike Group', exp: 0.8 });
      if ((cmd.country ?? p.country) === p.country) {
        f.ctrl = p.id;
        p.formations.push(f.id);
      }
      return ok({ id: f.id });
    }
    case 'teleport': {
      const f = s.formations.get(cmd.f);
      if (!f) return fail('No formation');
      moveFormation(g, f, cmd.prov | 0);
      f.order = null;
      f.battle = 0;
      return ok();
    }
    case 'owner': {
      const q = cmd.prov | 0;
      s.prov.owner[q] = cmd.country | 0;
      s.prov.ctrl[q] = cmd.country | 0;
      return ok();
    }
    case 'war':
      declareWar(g, cmd.a ?? p.country, cmd.b | 0, { reason: 'Developer' });
      return ok();
    case 'peace': {
      const w = warBetween(g, cmd.a ?? p.country, cmd.b | 0);
      if (!w) return fail('No such war');
      makePeace(g, w, {});
      return ok();
    }
    case 'country':
      for (const id of p.formations) {
        const f = s.formations.get(id);
        if (f) f.ctrl = null;
      }
      p.formations = [];
      p.country = cmd.country | 0;
      p.hq = s.countries[p.country].capital;
      fillCommand(g, p);
      p.area = computeArea(g, p);
      return ok();
    case 'reveal':
      p.reveal = !p.reveal;
      return ok({ reveal: p.reveal });
    case 'tension':
      s.tension = Math.max(0, Math.min(100, cmd.value | 0));
      return ok();
    case 'massBattle': {
      // two big stacks next to each other at war, for combat and performance testing
      const a = p.country;
      const q = cmd.prov ?? p.hq;
      const nb = g.w.neighbors(q).find((x) => x < g.P);
      const b = cmd.enemy ?? (a + 1) % g.C;
      if (!g.atWar(a, b)) declareWar(g, a, b, { reason: 'Developer' });
      s.prov.ctrl[nb] = b;
      const def = newFormation(g, { owner: b, prov: nb, comp: { inf: 40, art: 10, armor: 10 }, name: 'Test Defenders' });
      const atk = newFormation(g, { owner: a, prov: q, comp: { inf: 40, armor: 30, art: 12 }, name: 'Test Attackers' });
      atk.order = { type: 'attack', path: [q, nb], idx: 1, target: nb, by: p.id };
      joinOrStartBattle(g, atk, nb);
      void def;
      return ok();
    }
    default:
      return fail('Unknown dev action');
  }
}
