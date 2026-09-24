// Persistent war: territory ownership, sector capture, front line, battles,
// supply, command points and campaign victory. The war state is saved and
// restored so the front line survives server restarts.
import { FACTION, LIFE, enemyOf, FACTION_INFO } from '../../shared/constants.js';
import { GAME } from '../../shared/config/game.js';
import { COMMAND_POINTS } from '../../shared/config/commands.js';
import { XP, CREDITS, LEADERSHIP } from '../../shared/config/economy.js';
import { ROLES } from '../../shared/config/roles.js';
import { rankOf } from '../../shared/config/ranks.js';
import { dist2D, clamp, Rng } from '../../shared/math.js';

export class WarSystem {
  constructor(game) {
    this.game = game;
    this.map = new Map();
    this.cp = { [FACTION.COALITION]: COMMAND_POINTS.base, [FACTION.DOMINION]: COMMAND_POINTS.base };
    this.priority = { [FACTION.COALITION]: null, [FACTION.DOMINION]: null };
    this.campaign = 1;
    this.campaignStart = Date.now();
    this.battles = new Map();
    this.nextBattleId = 1;
    this.version = 1;
    this.capTimer = 0;
    this.slowTimer = 0;
    this.aiTimer = 0;
    this.resetAt = 0;
    this.rng = new Rng(4242);
    this.history = [];
  }

  init(data) {
    const g = this.game;
    for (const t of g.world.territories) {
      const saved = data && data.territories && data.territories[t.id];
      const w = {
        id: t.id,
        def: t,
        owner: saved ? saved.owner : t.initialOwner,
        state: 'controlled',
        stateUntil: 0,
        supply: saved ? clamp(saved.supply ?? 60, 0, 100) : 60,
        lastChange: 0,
        sectors: t.sectors.map((s) => {
          const ss = saved && saved.sectors && saved.sectors[s.id];
          const owner = ss ? ss.owner : t.initialOwner;
          return {
            id: s.id, def: s, owner,
            progress: ss ? ss.progress : owner === FACTION.COALITION ? 100 : owner === FACTION.DOMINION ? -100 : 0,
            contested: false, moving: 0, presence: { 1: 0, 2: 0 }, lastCapture: 0, tickAcc: 0, defAcc: 0,
          };
        }),
      };
      this.map.set(t.id, w);
    }
    if (data) {
      this.campaign = data.campaign || 1;
      this.campaignStart = data.campaignStart || Date.now();
      if (data.cp) for (const f of [1, 2]) this.cp[f] = clamp(data.cp[f] ?? COMMAND_POINTS.base, 0, 200);
      this.history = Array.isArray(data.history) ? data.history.slice(-30) : [];
    }
  }

  get(id) {
    return this.map.get(id) || null;
  }

  serialize() {
    const territories = {};
    for (const w of this.map.values()) {
      territories[w.id] = {
        owner: w.owner,
        supply: Math.round(w.supply),
        sectors: Object.fromEntries(w.sectors.map((s) => [s.id, { owner: s.owner, progress: Math.round(s.progress) }])),
      };
    }
    return { v: 1, campaign: this.campaign, campaignStart: this.campaignStart, territories, cp: this.cp, history: this.history.slice(-30), saved: Date.now() };
  }

  changed() {
    this.version++;
    this.game.warDirty = true;
  }

  logEvent(text) {
    this.history.push({ t: Date.now(), text });
    if (this.history.length > 30) this.history.shift();
  }

  // ------------------------------------------------------------------ queries
  ownerOf(id) {
    const w = this.map.get(id);
    return w ? w.owner : 0;
  }

  // Territory `id` can be attacked by `faction` (it borders something they hold).
  isFront(id, faction) {
    const w = this.map.get(id);
    if (!w || w.def.isBase || w.owner === faction) return false;
    return w.def.adjacent.some((a) => this.ownerOf(a) === faction);
  }

  canCapture(w, faction) {
    if (w.def.isBase) return false;
    return w.owner === faction || this.isFront(w.id, faction);
  }

  isObjectiveArea(x, z) {
    for (const w of this.map.values()) {
      if (w.def.isBase) continue;
      if (dist2D(x, z, w.def.x, w.def.z) > w.def.radius * 1.6) continue;
      for (const s of w.sectors) if (dist2D(x, z, s.def.x, s.def.z) < s.def.r * 2) return true;
    }
    return false;
  }

  sectorNear(x, z, r) {
    for (const w of this.map.values()) {
      if (w.def.isBase) continue;
      if (dist2D(x, z, w.def.x, w.def.z) > w.def.radius * 1.6) continue;
      for (const s of w.sectors) if (dist2D(x, z, s.def.x, s.def.z) < r) return { w, s };
    }
    return null;
  }

  isDefendingKill(attacker, victim) {
    const hit = this.sectorNear(victim.x, victim.z, 34);
    return !!(hit && hit.s.owner === attacker.faction);
  }

  spawnBlockedReason(t, f) {
    const w = this.map.get(t.id);
    if (!w) return 'Unavailable';
    if (w.sectors[0] && w.sectors[0].owner !== f) return 'Command post lost';
    for (const s of w.sectors) if (s.contested || (f === FACTION.COALITION ? s.moving < 0 : s.moving > 0)) return 'Under attack';
    if (this.game.deploySys.enemiesNear(t.commandPost.x, t.commandPost.z, 55, f)) return 'Enemies nearby';
    return '';
  }

  cpMax(f) {
    let bonus = 0;
    for (const s of this.game.sessionsOf(f)) bonus = Math.max(bonus, rankOf(s.rankIndex).cpCapBonus || 0);
    return COMMAND_POINTS.cap + bonus;
  }

  regenCommandPoints(dt) {
    for (const f of [FACTION.COALITION, FACTION.DOMINION]) {
      let owned = 0;
      for (const w of this.map.values()) if (!w.def.isBase && w.owner === f) owned += 1 + (w.supply > 60 ? 0.3 : 0);
      this.cp[f] = Math.min(this.cpMax(f), this.cp[f] + (COMMAND_POINTS.perTerritoryPerMin / 60) * dt * Math.max(1, owned));
    }
  }

  spendCommandPoints(f, n) {
    this.cp[f] = Math.max(0, this.cp[f] - n);
  }

  addSupply(id, amount, f) {
    const w = this.map.get(id);
    if (!w || (f && w.owner !== f)) return;
    w.supply = clamp(w.supply + amount, 0, 100);
    this.changed();
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const g = this.game;
    if (this.resetAt && g.time >= this.resetAt) this.resetCampaign();
    this.capTimer += dt;
    if (this.capTimer >= 0.5) {
      this.updateSectors(this.capTimer);
      this.capTimer = 0;
    }
    this.slowTimer += dt;
    if (this.slowTimer >= 5) {
      this.updateSlow(this.slowTimer);
      this.slowTimer = 0;
    }
  }

  presenceWeight(s) {
    if (s.life !== LIFE.ALIVE || s.captive || s.ambient) return 0;
    if (s.vehicle) {
      const v = this.game.get(s.vehicle);
      if (v && v.def.air) return 0;
    }
    let w = s.isPlayer ? 1 : 0.75;
    const role = ROLES[s.role];
    if (role && role.perks.captureMult) w *= role.perks.captureMult;
    return w;
  }

  updateSectors(dt) {
    const g = this.game;
    for (const w of this.map.values()) {
      if (w.def.isBase) continue;
      let anyChange = false;
      for (const sec of w.sectors) {
        const pres = { 1: 0, 2: 0 };
        const present = { 1: [], 2: [] };
        for (const s of g.soldiersNear(sec.def.x, sec.def.z, sec.def.r)) {
          const wt = this.presenceWeight(s);
          if (wt <= 0) continue;
          pres[s.faction] += wt;
          present[s.faction].push(s);
        }
        sec.presence = pres;
        const wasContested = sec.contested;
        sec.contested = pres[1] > 0 && pres[2] > 0;
        let a = this.canCapture(w, FACTION.COALITION) ? pres[1] : 0;
        let b = this.canCapture(w, FACTION.DOMINION) ? pres[2] : 0;
        let net = a - b;
        if (sec.contested) net = pres[1] >= pres[2] * 2 ? (a ? pres[1] - pres[2] : 0) * 0.35 : pres[2] >= pres[1] * 2 ? -(b ? pres[2] - pres[1] : 0) * 0.35 : 0;
        net = clamp(net, -GAME.captureMaxRate, GAME.captureMaxRate);
        const before = sec.progress;
        if (net !== 0) {
          sec.progress = clamp(sec.progress + (net / GAME.captureTime) * 100 * dt, -100, 100);
        } else if (!pres[1] && !pres[2] && sec.owner !== FACTION.NONE) {
          const target = sec.owner === FACTION.COALITION ? 100 : -100;
          sec.progress += clamp(target - sec.progress, -3 * dt, 3 * dt);
        }
        sec.moving = Math.sign(sec.progress - before);
        if (sec.progress !== before) anyChange = true;
        if (wasContested !== sec.contested) anyChange = true;
        // ownership transitions
        const prevOwner = sec.owner;
        if (sec.progress >= 100 && sec.owner !== FACTION.COALITION) this.sectorCaptured(w, sec, FACTION.COALITION, present[1]);
        else if (sec.progress <= -100 && sec.owner !== FACTION.DOMINION) this.sectorCaptured(w, sec, FACTION.DOMINION, present[2]);
        else if (sec.owner === FACTION.COALITION && sec.progress <= 0) this.sectorNeutralized(w, sec, FACTION.DOMINION);
        else if (sec.owner === FACTION.DOMINION && sec.progress >= 0) this.sectorNeutralized(w, sec, FACTION.COALITION);
        if (prevOwner !== sec.owner) anyChange = true;
        // capture ticks & defence ticks for players
        if (sec.moving !== 0) {
          const side = sec.moving > 0 ? FACTION.COALITION : FACTION.DOMINION;
          sec.tickAcc += dt;
          if (sec.tickAcc >= 2) {
            sec.tickAcc = 0;
            for (const s of present[side]) {
              if (!s.player) continue;
              g.progression.award(s.player, { xp: XP.captureTick, reason: 'Capturing', cat: 'objective', pos: s, silent: true });
              g.missions.onPlayerAction(s.player, 'capture', 2, s);
              s.player.lastCaptureAt = g.time;
              s.player.captureSector = `${w.id}:${sec.id}`;
            }
          }
        }
        if (sec.contested && sec.owner !== FACTION.NONE) {
          sec.defAcc += dt;
          if (sec.defAcc >= 4) {
            sec.defAcc = 0;
            const defenders = present[sec.owner];
            const attackers = present[enemyOf(sec.owner)];
            for (const s of defenders) {
              if (!s.player) continue;
              g.progression.award(s.player, { xp: XP.defendTick, reason: 'Defending', cat: 'objective', pos: s, silent: true });
              g.missions.onPlayerAction(s.player, 'defend', 2, s);
              // valor: holding while heavily outnumbered
              if (attackers.length >= Math.max(3, defenders.length * 3)) {
                s.player.valorHold = (s.player.valorHold || 0) + 4;
                if (s.player.valorHold >= 40) {
                  s.player.valorHold = -1e9; // once per life
                  g.progression.addStat(s.player, 'valor', 1);
                  g.notify(s.player, 'Held the line against overwhelming odds. Valor noted.', 'good');
                }
              }
            }
          }
        }
      }
      // territory flip: all sectors held by one side
      const owners = new Set(w.sectors.map((s) => s.owner));
      if (owners.size === 1) {
        const f = w.sectors[0].owner;
        if (f !== FACTION.NONE && f !== w.owner) this.flipTerritory(w, f);
      }
      const st = this.computeState(w);
      if (st !== w.state) {
        w.state = st;
        anyChange = true;
      }
      if (anyChange) this.version++;
    }
  }

  computeState(w) {
    const g = this.game;
    if (w.stateUntil > g.time) return w.state;
    const enemyProgress = w.sectors.some((s) => s.owner !== w.owner || (w.owner === FACTION.COALITION ? s.moving < 0 : s.moving > 0));
    const contested = w.sectors.some((s) => s.contested);
    if (contested) return 'contested';
    if (enemyProgress) return 'under_attack';
    for (const b of this.battles.values()) if (b.territory === w.id && b.attacker !== w.owner) return 'under_attack';
    return 'controlled';
  }

  sectorCaptured(w, sec, f, presentList) {
    const g = this.game;
    sec.owner = f;
    sec.progress = f === FACTION.COALITION ? 100 : -100;
    sec.lastCapture = g.time;
    const t = w.def;
    const label = `${sec.def.name} (${t.name})`;
    g.radio(f, 'intel', 'HQ', `${label} secured.`, { priority: 1 });
    g.radio(enemyOf(f), 'intel', 'HQ', `We've lost ${label}!`, { priority: 1 });
    g.emit(['cap', t.id, sec.id, f], {});
    this.cp[f] = Math.min(this.cpMax(f), this.cp[f] + COMMAND_POINTS.perObjectiveCaptured);
    const officers = new Set();
    for (const s of presentList) {
      if (!s.player) continue;
      g.progression.award(s.player, {
        xp: XP.sectorCaptured, credits: CREDITS.sectorCaptured, reason: `Captured ${sec.def.name}`, cat: 'objective', pos: s,
        stats: { captures: 1 }, rewardId: `cap:${t.id}:${sec.id}:${Math.floor(g.time)}`,
      });
      const sq = s.player.squadId ? g.squads.get(s.player.squadId) : null;
      if (sq && sq.order && sq.order.expiresAt > g.time && dist2D(sq.order.x, sq.order.z, sec.def.x, sec.def.z) < 80) officers.add(sq.order.issuer);
    }
    for (const oid of officers) {
      const o = g.byProfile.get(oid);
      if (o) g.progression.grantLeadership(o, LEADERSHIP.officerUnitsCapture, 'Units captured objective');
    }
    g.missions.onSectorChanged(w, sec);
    g.npc.onSectorChanged(w, sec);
    this.logEvent(`${FACTION_INFO[f].short} captured ${label}`);
    this.changed();
  }

  sectorNeutralized(w, sec, byFaction) {
    const g = this.game;
    const lost = sec.owner;
    sec.owner = FACTION.NONE;
    g.radio(lost, 'intel', 'HQ', `${sec.def.name} (${w.def.name}) has been neutralized!`, { priority: 1 });
    g.radio(byFaction, 'intel', 'HQ', `Enemy flag down at ${sec.def.name}. Keep pushing!`);
    g.missions.onSectorChanged(w, sec);
    g.npc.onSectorChanged(w, sec);
    this.changed();
  }

  flipTerritory(w, f) {
    const g = this.game;
    const old = w.owner;
    w.owner = f;
    w.lastChange = g.time;
    w.state = f === FACTION.COALITION ? 'liberated' : 'captured';
    w.stateUntil = g.time + GAME.territoryStateHold;
    w.supply = 40;
    const t = w.def;
    g.radio(f, 'command', 'High Command', `${t.name} is ours! Outstanding work, soldiers.`, { priority: 2 });
    g.radio(old, 'command', 'High Command', `${t.name} has fallen to the enemy. Regroup and counterattack!`, { priority: 2 });
    g.emit(['territory', t.id, f, old], {});
    g.emit(['music', f === FACTION.COALITION ? 'victory' : 'defeat'], { faction: FACTION.COALITION });
    // everyone of the winning side in the area shares the credit
    for (const s of g.soldiersNear(t.x, t.z, t.radius * 1.4, (e) => e.player && e.faction === f && e.life !== LIFE.DEAD)) {
      g.progression.award(s.player, {
        xp: XP.territoryCaptured, credits: CREDITS.territoryCaptured, reason: `${t.name} taken`, cat: 'objective', pos: s,
        stats: { territories: 1 }, rewardId: `terr:${t.id}:${this.campaign}:${Math.floor(g.time)}`,
      });
    }
    for (const [id, b] of this.battles) {
      if (b.territory === t.id) this.endBattle(id, f);
    }
    this.logEvent(`${FACTION_INFO[f].short} took ${t.name}`);
    g.missions.onTerritoryFlipped(w, old);
    g.npc.onTerritoryFlipped(w, old);
    g.vehicleSys.onTerritoryFlipped(w);
    this.changed();
    this.checkCampaign();
  }

  // ------------------------------------------------------------------ battles
  startBattle(tid, attacker, reason = 'ai') {
    const g = this.game;
    for (const b of this.battles.values()) if (b.territory === tid) return b;
    const w = this.map.get(tid);
    if (!w) return null;
    const b = { id: this.nextBattleId++, territory: tid, attacker, defender: w.owner, started: g.time, reason, lastProgress: g.time };
    this.battles.set(b.id, b);
    const name = w.def.name;
    if (attacker === FACTION.COALITION) g.radio(FACTION.COALITION, 'command', 'High Command', `Assault on ${name} is underway. Move to the front!`, { priority: 1 });
    else g.radio(FACTION.COALITION, 'command', 'High Command', `Enemy forces are attacking ${name}! Reinforce the defence!`, { priority: 2 });
    g.npc.onBattleStarted(b);
    g.missions.onBattleStarted(b);
    this.changed();
    return b;
  }

  forceBattle(tid, attacker) {
    return this.startBattle(tid, attacker, 'order');
  }

  endBattle(id, winner) {
    const g = this.game;
    const b = this.battles.get(id);
    if (!b) return;
    this.battles.delete(id);
    g.npc.onBattleEnded(b, winner);
    this.changed();
  }

  updateSlow(dt) {
    const g = this.game;
    // supply drifts slowly toward 50 (logistics keep it up, fighting drains it)
    for (const w of this.map.values()) {
      if (w.def.isBase) continue;
      const drain = w.state === 'contested' || w.state === 'under_attack' ? GAME.supplyDecayPerMin * 2 : GAME.supplyDecayPerMin;
      w.supply = clamp(w.supply - (drain / 60) * dt, 5, 100);
      if (w.state !== this.computeState(w)) {
        w.state = this.computeState(w);
        this.version++;
      }
    }
    // battle bookkeeping
    for (const [id, b] of this.battles) {
      const w = this.map.get(b.territory);
      if (!w || w.owner === b.attacker) {
        this.endBattle(id, b.attacker);
        continue;
      }
      if (w.sectors.some((s) => s.moving !== 0)) b.lastProgress = g.time;
      if (g.time - b.lastProgress > 600 && g.time - b.started > 900) {
        g.radio(b.attacker, 'command', 'High Command', `The assault on ${w.def.name} has stalled. Pulling back to regroup.`);
        this.endBattle(id, b.defender);
      }
    }
    // player-driven battles: players pushing into a front territory
    for (const w of this.map.values()) {
      if (w.def.isBase) continue;
      for (const f of [FACTION.COALITION, FACTION.DOMINION]) {
        if (!this.isFront(w.id, f)) continue;
        const pushing = g.soldiersNear(w.def.x, w.def.z, w.def.radius * 1.1, (s) => s.isPlayer && s.faction === f && s.life === LIFE.ALIVE);
        if (pushing.length && ![...this.battles.values()].some((b) => b.territory === w.id)) this.startBattle(w.id, f, 'players');
      }
    }
    // AI commanders choose offensives
    this.aiTimer += dt;
    if (this.aiTimer >= 20) {
      this.aiTimer = 0;
      this.aiCommand();
    }
    // battle participation for players
    for (const s of g.sessions) {
      const sol = s.soldier;
      if (!sol || sol.life === LIFE.DEAD) continue;
      for (const b of this.battles.values()) {
        const t = g.world.tById[b.territory];
        if (dist2D(sol.x, sol.z, t.x, t.z) > t.radius * 1.3) continue;
        const cur = (s.battleTime.get(b.id) || 0) + dt;
        s.battleTime.set(b.id, cur);
        if (cur >= 120 && cur - dt < 120) {
          g.progression.addStat(s, 'battles', 1);
          g.notify(s, `Battle of ${t.name} recorded in your service record.`, 'good');
        }
      }
    }
  }

  aiCommand() {
    const g = this.game;
    const maxB = GAME.maxBattles;
    for (const f of [FACTION.DOMINION, FACTION.COALITION]) {
      const mine = [...this.battles.values()].filter((b) => b.attacker === f).length;
      if (mine >= 1 || this.battles.size >= maxB + 1) continue;
      const fronts = [...this.map.values()].filter((w) => this.isFront(w.id, f));
      if (!fronts.length) continue;
      const prio = this.priority[f] && this.priority[f].until > g.time ? this.priority[f].territory : null;
      const off = g.commands.offensiveFor(f);
      const pick = this.rng.weighted(fronts.map((w) => ({
        v: w,
        w: 1 + w.def.value + (100 - w.supply) / 40 + (prio === w.id ? 6 : 0) + (off && off.territory === w.id ? 10 : 0) + (g.time - w.lastChange < 300 ? 3 : 0),
      })));
      if (pick) this.startBattle(pick.id, f, 'ai');
    }
    // Dominion artillery on sectors that players are capturing
    for (const w of this.map.values()) {
      for (const sec of w.sectors) {
        if (sec.owner !== FACTION.DOMINION || sec.moving <= 0) continue;
        if (this.rng.chance(0.35)) g.commands.aiUse(FACTION.DOMINION, 'artillery', sec.def.x + this.rng.float(-12, 12), sec.def.z + this.rng.float(-12, 12));
      }
    }
  }

  // ------------------------------------------------------------------ campaign
  checkCampaign() {
    const g = this.game;
    const owners = new Set([...this.map.values()].filter((w) => !w.def.isBase).map((w) => w.owner));
    if (owners.size !== 1 || this.resetAt) return;
    const winner = [...owners][0];
    this.resetAt = g.time + GAME.campaignResetDelay;
    if (winner === FACTION.COALITION) {
      g.radio(FACTION.COALITION, 'command', 'High Command', `VICTORY! Campaign ${this.campaign} is won. Every soldier who served has earned the Campaign Medal.`, { priority: 2 });
      for (const s of g.sessionsOf(FACTION.COALITION)) {
        if ((s.profile.stats.service | 0) < 10) continue;
        g.progression.award(s, { xp: XP.campaignVictory, credits: CREDITS.campaignVictory, reason: 'Campaign victory', cat: 'service', stats: { campaigns: 1 }, rewardId: `campaign:${this.campaign}`, noMult: true });
        g.progression.record(s, 'campaign', `Served in the victorious Campaign ${this.campaign}`);
      }
    } else {
      g.radio(FACTION.COALITION, 'command', 'High Command', `The front has collapsed. Campaign ${this.campaign} is lost. We regroup for the next campaign.`, { priority: 2 });
    }
    g.emit(['campaign', winner, this.campaign, GAME.campaignResetDelay], {});
    this.logEvent(`Campaign ${this.campaign} ended: ${FACTION_INFO[winner].short} victory`);
  }

  resetCampaign() {
    const g = this.game;
    this.resetAt = 0;
    this.campaign++;
    this.campaignStart = Date.now();
    for (const w of this.map.values()) {
      w.owner = w.def.initialOwner;
      w.supply = 60;
      w.state = 'controlled';
      w.stateUntil = 0;
      for (const s of w.sectors) {
        s.owner = w.owner;
        s.progress = w.owner === FACTION.COALITION ? 100 : -100;
        s.contested = false;
        s.moving = 0;
      }
    }
    for (const id of [...this.battles.keys()]) this.endBattle(id, 0);
    g.radio(FACTION.COALITION, 'command', 'High Command', `Campaign ${this.campaign} begins. The front lines have been redrawn.`, { priority: 2 });
    g.npc.onCampaignReset();
    g.missions.onCampaignReset();
    g.vehicleSys.onCampaignReset();
    this.changed();
  }

  // ------------------------------------------------------------------ view
  view() {
    const g = this.game;
    return {
      campaign: this.campaign,
      territories: [...this.map.values()].map((w) => ({
        id: w.id,
        owner: w.owner,
        state: w.state,
        supply: Math.round(w.supply),
        front: { 1: this.isFront(w.id, 1), 2: this.isFront(w.id, 2) },
        battle: [...this.battles.values()].find((b) => b.territory === w.id)?.attacker || 0,
        sectors: w.sectors.map((s) => ({ id: s.id, owner: s.owner, p: Math.round(s.progress), c: s.contested ? 1 : 0, m: s.moving })),
      })),
      cp: { 1: Math.floor(this.cp[1]), 2: Math.floor(this.cp[2]) },
      resetIn: this.resetAt ? Math.max(0, Math.round(this.resetAt - g.time)) : 0,
      history: this.history.slice(-10),
    };
  }
}
