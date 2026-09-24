// Career progression: XP, credits, stats, promotions, medals, rating, cosmetics.
// All rewards flow through award(), which is idempotent per rewardId (ledger)
// so retries / duplicate completions can never grant twice.
import { RANKS, promotionOptions, promotionStatus, rankOf, isAnyOfficer, isOfficer, isWarrant, RANK } from '../../shared/config/ranks.js';
import { LIFE } from '../../shared/constants.js';
import { MEDALS, MEDAL_REWARDS, MEDAL_TIERS, medalTierFor } from '../../shared/config/medals.js';
import { XP, CREDITS, LEADERSHIP, RATING } from '../../shared/config/economy.js';
import { COSMETIC_TABLES } from '../../shared/config/cosmetics.js';
import { MSG } from '../../shared/protocol.js';
import { profileView } from '../profile.js';
import { clamp } from '../../shared/math.js';

const RATING_CATS = { objective: 1, support: 1, leadership: 1, combat: 0.5, service: 0, training: 0 };

export class ProgressionSystem {
  constructor(game) {
    this.game = game;
    this.serviceTimer = 0;
  }

  title(session) {
    return `${rankOf(session.rankIndex).abbr} ${session.name}`;
  }

  record(session, type, text) {
    const p = session.profile;
    p.record.push({ t: Date.now(), type, text });
    if (p.record.length > 60) p.record.splice(0, p.record.length - 60);
  }

  // Multipliers applied to earned XP.
  xpMultiplier(session, cat, pos) {
    let m = 1;
    const g = this.game;
    const s = session.soldier;
    if (session.squadId && s && (cat === 'objective' || cat === 'support' || cat === 'combat')) {
      const squad = g.squads.get(session.squadId);
      if (squad) {
        for (const pid of squad.members) {
          if (pid === session.id) continue;
          const other = g.byProfile.get(pid);
          const os = other && other.soldier;
          if (os && os.alive && Math.hypot(os.x - s.x, os.z - s.z) < 70) {
            m += XP.squadBonus;
            break;
          }
        }
      }
    }
    const off = g.commands.offensiveFor(session.faction);
    if (off && pos) {
      const t = g.territoryAt(pos.x, pos.z);
      if (t && t.id === off.territory) m += 0.25;
    }
    return m;
  }

  /**
   * opts: {xp, credits, reason, cat, rewardId, stats:{key:n}, pos, silent, noMult}
   * Returns the XP actually granted.
   */
  award(session, opts) {
    if (!session || !session.profile) return 0;
    const p = session.profile;
    if (opts.rewardId) {
      if (p.ledger.includes(opts.rewardId)) return 0;
      p.ledger.push(opts.rewardId);
      if (p.ledger.length > 400) p.ledger.splice(0, p.ledger.length - 400);
    }
    const cat = opts.cat || 'objective';
    let xp = Math.max(0, Math.round((opts.xp || 0) * (opts.noMult ? 1 : this.xpMultiplier(session, cat, opts.pos))));
    const credits = Math.max(0, Math.round(opts.credits || 0));
    p.xp += xp;
    p.credits += credits;
    if (opts.stats) for (const [k, n] of Object.entries(opts.stats)) this.addStat(session, k, n, true);
    // deployment accounting (performance rating)
    if (session.deploy) session.deploy.score += xp * (RATING_CATS[cat] ?? 0.5);
    // leadership: when this soldier earns objective XP while following an order, the issuer earns LP
    if (xp > 0 && (cat === 'objective' || cat === 'support')) this.game.commands.onFollowerXp(session, xp, opts.pos);
    if (xp > 0 && !opts.silent) this.game.emit(['xp', xp, opts.reason || '', cat], { to: session });
    session.dirtyProfile = true;
    session.saveDirty = true;
    this.checkPromotion(session);
    return xp;
  }

  addStat(session, key, n = 1, skipChecks = false) {
    const p = session.profile;
    if (!p) return;
    p.stats[key] = (p.stats[key] || 0) + n;
    if (key === 'captures' || key === 'defends') p.stats.objectives = (p.stats.captures | 0) + (p.stats.defends | 0);
    session.dirtyProfile = true;
    session.saveDirty = true;
    if (!skipChecks) this.checkPromotion(session);
    this.checkMedals(session);
  }

  setStatMax(session, key, v) {
    const p = session.profile;
    if ((p.stats[key] || 0) < v) {
      p.stats[key] = v;
      session.dirtyProfile = true;
      session.saveDirty = true;
      this.checkMedals(session);
    }
  }

  grantLeadership(session, lp, reason) {
    if (!session || !session.profile || lp <= 0) return;
    const minute = Math.floor(this.game.time / 60);
    if (session.lastLeadershipMinute !== minute) {
      session.lastLeadershipMinute = minute;
      session.leadershipThisMinute = 0;
    }
    const room = LEADERSHIP.maxPerMinute - session.leadershipThisMinute;
    const give = Math.min(room, lp);
    if (give <= 0) return;
    session.leadershipThisMinute += give;
    session.leadershipFrac = (session.leadershipFrac || 0) + give;
    const whole = Math.floor(session.leadershipFrac);
    if (whole > 0) {
      session.leadershipFrac -= whole;
      this.addStat(session, 'leadership', whole);
      if (session.deploy) session.deploy.score += whole * 10;
      if (reason) this.game.emit(['lp', whole, reason], { to: session });
    }
  }

  // Promotions are not automatic: once the requirements for a rank are met the
  // soldier sees PROMOTION AVAILABLE and reports to a friendly base or a senior
  // officer to receive it. Only Recruit -> Private (end of basic training)
  // happens on the spot.
  checkPromotion(session) {
    const p = session.profile;
    if (!p) return;
    const ready = promotionOptions(p).filter((o) => o.met).map((o) => o.to);
    if (p.rank === RANK.RECRUIT && ready.includes(RANK.PRIVATE)) {
      this.promote(session, RANK.PRIVATE, 'training');
      return;
    }
    const key = ready.join(',');
    if (key !== (session.promotionKey || '')) {
      const fresh = ready.filter((r) => !(session.promotionReady || []).includes(r));
      session.promotionReady = ready;
      session.promotionKey = key;
      for (const to of fresh) this.game.emit(['promoReady', to, promotionStatus(p, to).kind], { to: session });
      session.dirtyProfile = true;
    }
  }

  // Where a promotion can be received: a friendly base, or face to face with
  // a senior officer (player or NPC) who outranks the new rank.
  promotionVenue(session, to) {
    const g = this.game;
    const s = session.soldier;
    if (!s || s.life === LIFE.DEAD) return null;
    if (g.isFriendlyBase(s.x, s.z, session.faction)) return 'base';
    const senior = g.soldiersNear(s.x, s.z, 7, (e) => e !== s && e.faction === s.faction && e.life === LIFE.ALIVE && e.rank > to && !e.captive)[0];
    return senior ? senior : null;
  }

  onPromote(session, msg) {
    const p = session.profile;
    const to = msg.to | 0;
    const st = promotionStatus(p, to);
    if (st.invalid || st.maxed) return;
    if (!st.met) {
      this.game.notify(session, `Requirements for ${RANKS[to].name} are not met yet.`, 'warn');
      return;
    }
    const venue = this.promotionVenue(session, to);
    if (!venue) {
      this.game.notify(session, 'Report to any friendly base, command post or senior officer to receive your promotion.', 'warn');
      return;
    }
    this.promote(session, to, venue === 'base' ? 'base' : 'officer', venue === 'base' ? null : venue);
  }

  // Apply a rank change (also used by the admin sandbox with how = 'admin').
  promote(session, to, how = 'base', officer = null) {
    const p = session.profile;
    const g = this.game;
    const from = p.rank;
    if (to === from) return;
    p.rank = to;
    const rk = RANKS[to];
    const up = to > from;
    session.promotionReady = [];
    session.promotionKey = '';
    if (up && how !== 'admin') {
      const credits = CREDITS.promotionPerRank * Math.min(20, to);
      p.credits += credits;
      this.addStat(session, 'promotions', 1, true);
      const kind = rk.track !== rankOf(from).track ? (isWarrant(to) ? 'warrant' : 'commission') : 'promotion';
      this.record(session, 'promotion', kind === 'commission' ? `Commissioned as ${rk.name}` : kind === 'warrant' ? `Appointed ${rk.name}` : `Promoted to ${rk.name}`);
      if (to === RANK.CORPORAL) this.record(session, 'milestone', 'Became a non-commissioned officer');
      if (to === RANK.SMA) this.record(session, 'milestone', 'Became the Sergeant Major of the Army');
      if (to === RANK.BRIG_GENERAL) this.record(session, 'milestone', 'Promoted to flag rank');
      if (to === RANK.GENERAL_OF_ARMY) this.record(session, 'milestone', 'Promoted to General of the Army');
      const by = officer ? `${rankOf(officer.rank).abbr} ${officer.name}` : '';
      g.emit(['promo', to, credits, kind, by], { to: session });
      g.radio(session.faction, 'command', 'HQ', `${session.name} has been ${kind === 'commission' ? 'commissioned' : 'promoted'} ${kind === 'commission' ? 'as' : 'to'} ${rk.name}.`, { priority: 1 });
      if (officer && officer.npc) g.hierarchy.promotionSpeech(officer, session, to);
    } else if (how === 'admin') {
      this.record(session, 'admin', `Rank set to ${rk.name} (sandbox)`);
      g.emit(['promo', to, 0, 'admin', ''], { to: session });
    }
    // rank-bound cosmetics
    if (isAnyOfficer(to) && !p.unlocks.headgear.includes('beret')) p.unlocks.headgear.push('beret');
    if (isOfficer(to) && !p.unlocks.camo.includes('dress')) p.unlocks.camo.push('dress');
    if (to >= RANK.BRIG_GENERAL && !p.unlocks.headgear.includes('cap')) p.unlocks.headgear.push('cap');
    if (to >= RANK.BRIG_GENERAL && !p.unlocks.camo.includes('command')) p.unlocks.camo.push('command');
    if (session.soldier) {
      session.soldier.rank = to;
      session.soldier.infoVersion++;
    }
    session.dirtyProfile = true;
    session.saveDirty = true;
    g.squads.onRankChanged(session);
    g.commands.sendState(session);
    this.checkMedals(session);
    this.checkPromotion(session);
  }

  checkMedals(session) {
    const p = session.profile;
    for (const m of MEDALS) {
      const v = m.stat === 'training' ? (p.trainingComplete && !p.trainingSkipped ? 1 : 0) : p.stats[m.stat] | 0;
      const tier = medalTierFor(m, v);
      const cur = p.medals[m.id] ?? -1;
      if (tier > cur) {
        for (let t = cur + 1; t <= tier; t++) {
          const rw = MEDAL_REWARDS[t];
          const name = m.tiers.length > 1 ? `${m.name} (${MEDAL_TIERS[t]})` : m.name;
          p.medals[m.id] = t;
          this.record(session, 'medal', `Awarded the ${name}`);
          this.award(session, { xp: rw.xp, credits: rw.credits, reason: name, cat: 'service', rewardId: `medal:${m.id}:${t}`, silent: true, noMult: true });
          this.game.emit(['medal', m.id, t], { to: session });
        }
      }
    }
  }

  // ------------------------------------------------------------ deployments
  startDeployment(session) {
    session.deploy = { start: this.game.time, score: 0 };
  }

  endDeployment(session, reason) {
    const d = session.deploy;
    session.deploy = null;
    if (!d || !session.profile) return;
    const secs = this.game.time - d.start;
    if (secs < RATING.minDeploySeconds) return;
    const perMin = d.score / (secs / 60);
    const score = clamp((perMin / RATING.objectiveXpPerMinFor100) * 100, 0, 100);
    const p = session.profile;
    p.rating = p.rating ? p.rating + (score - p.rating) * RATING.alpha : score * 0.6;
    session.dirtyProfile = true;
    session.saveDirty = true;
    void reason;
  }

  // ------------------------------------------------------------ periodic
  update(dt) {
    const g = this.game;
    this.serviceTimer += dt;
    if (this.serviceTimer >= 60) {
      this.serviceTimer -= 60;
      for (const s of g.sessions) {
        if (!s.profile || !s.soldier || s.soldier.dead) continue;
        if (g.time - s.lastActiveAt > 120) continue; // idle soldiers do not earn service time
        if (!s.profile.trainingComplete) continue;
        this.addStat(s, 'service', 1, true);
        if (isAnyOfficer(s.profile.rank)) this.addStat(s, 'officerService', 1, true);
        if (s.soldier.vehicle) this.addStat(s, 'crew', 1, true);
        this.award(s, { xp: XP.servicePayPerMin, credits: CREDITS.perServiceMinute, reason: 'Service', cat: 'service', silent: true, noMult: true });
        this.checkPromotion(s);
      }
    }
    // push profile updates at most twice a second
    for (const s of g.sessions) {
      if (s.dirtyProfile && s.profile && g.time - s.profileSentAt > 0.5) {
        s.dirtyProfile = false;
        s.profileSentAt = g.time;
        s.send({ t: MSG.PROFILE, profile: profileView(s.profile) });
      }
    }
  }

  // ------------------------------------------------------------ cosmetics & settings
  onCosmetic(session, msg) {
    const p = session.profile;
    const table = COSMETIC_TABLES[msg.cat];
    if (!table || typeof msg.id !== 'string') return;
    const item = table[msg.id];
    if (!item) return;
    const owned = p.unlocks[msg.cat] || (p.unlocks[msg.cat] = []);
    if (msg.a === 'buy') {
      if (owned.includes(item.id)) return;
      if (item.premium) {
        this.game.notify(session, 'This item is part of a supporter pack.', 'warn');
        return;
      }
      if ((item.minRank || 0) > p.rank) {
        this.game.notify(session, `Requires rank ${RANKS[item.minRank].name}.`, 'warn');
        return;
      }
      if (p.credits < item.price) {
        this.game.notify(session, 'Not enough credits.', 'warn');
        return;
      }
      p.credits -= item.price;
      owned.push(item.id);
      this.record(session, 'unlock', `Unlocked ${item.name}`);
      this.game.notify(session, `Unlocked ${item.name}.`, 'good');
    } else if (msg.a === 'equip') {
      if (!owned.includes(item.id)) return;
      if (msg.cat === 'emote') return;
      p.cosmetics[msg.cat] = item.id;
      const s = session.soldier;
      if (s) {
        if (msg.cat === 'camo') s.camo = item.id;
        if (msg.cat === 'headgear') s.headgear = item.id;
        s.infoVersion++;
      }
    }
    session.dirtyProfile = true;
    session.saveDirty = true;
  }

  onSettings(session, msg) {
    if (!msg.settings || typeof msg.settings !== 'object') return;
    const clean = {};
    let n = 0;
    for (const [k, v] of Object.entries(msg.settings)) {
      if (n++ > 40) break;
      if (typeof k !== 'string' || k.length > 24) continue;
      if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
      else if (typeof v === 'boolean') clean[k] = v;
      else if (typeof v === 'string' && v.length <= 24) clean[k] = v;
    }
    session.profile.settings = clean;
    session.saveDirty = true;
  }
}
