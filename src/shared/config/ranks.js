// Military rank ladder. Ranks are NOT cosmetic: each rank unlocks concrete
// gameplay authority (squad size, command scope, officer abilities, vehicles, roles).
//
// Promotion requirements combine several career stats so that no single activity
// (e.g. farming kills) can carry a player up the ladder:
//   xp          - total experience
//   missions    - missions completed with meaningful contribution
//   objectives  - sectors captured + objectives defended
//   leadership  - leadership points (earned when people you lead achieve things)
//   battles     - battles participated in (sustained presence in a battle zone)
//   operations  - successful large operations (officer career)
//   service     - minutes deployed
//   rating      - rolling performance rating (0-100), rewards efficient objective play

export const TIER = {
  RECRUIT: 'recruit',
  ENLISTED: 'enlisted',
  NCO: 'nco',
  OFFICER: 'officer',
  SENIOR: 'senior', // field grade officers
  GENERAL: 'general',
};

// Command scopes, ordered by reach.
export const SCOPE = {
  NONE: 0,
  SQUAD: 1, // own squad (+ attached NPC followers)
  PLATOON: 2, // up to 3 squads near the target point
  COMPANY: 3, // every squad in the target territory
  BATTALION: 4, // target territory and its neighbours
  THEATER: 5, // everything
};

export const SCOPE_NAMES = ['None', 'Squad', 'Platoon', 'Company', 'Battalion', 'Theater'];

function r(def) {
  return {
    squadSize: 0,
    scope: SCOPE.NONE,
    npcFollowers: 0,
    cooldownMult: 1,
    cpCapBonus: 0,
    req: {},
    ...def,
  };
}

export const RANKS = [
  r({ id: 'rct', name: 'Recruit', abbr: 'RCT', tier: TIER.RECRUIT, insignia: { type: 'none' },
    duty: 'Complete basic training to earn your place in the Coalition.' }),
  r({ id: 'pvt', name: 'Private', abbr: 'PVT', tier: TIER.ENLISTED, insignia: { type: 'chevron', n: 1 },
    req: { training: true },
    duty: 'Fight as part of a squad, follow orders and capture objectives.' }),
  r({ id: 'pfc', name: 'Private First Class', abbr: 'PFC', tier: TIER.ENLISTED, insignia: { type: 'chevron', n: 1, rockers: 1 },
    req: { xp: 1200, missions: 1, service: 20 },
    duty: 'Qualified for Support and Engineer roles and naval craft.' }),
  r({ id: 'spc', name: 'Specialist', abbr: 'SPC', tier: TIER.ENLISTED, insignia: { type: 'shield' },
    req: { xp: 3500, missions: 3, objectives: 4, service: 45 },
    duty: 'Qualified as a Scout and on recon vehicles.' }),
  r({ id: 'cpl', name: 'Corporal', abbr: 'CPL', tier: TIER.NCO, squadSize: 4, scope: SCOPE.SQUAD, insignia: { type: 'chevron', n: 2 },
    req: { xp: 7000, missions: 6, objectives: 10, battles: 3, service: 90 },
    duty: 'Lead a fireteam of up to 4 and issue squad orders. Cleared for armored transports.' }),
  r({ id: 'sgt', name: 'Sergeant', abbr: 'SGT', tier: TIER.NCO, squadSize: 8, scope: SCOPE.SQUAD, insignia: { type: 'chevron', n: 3 },
    req: { xp: 12000, missions: 10, objectives: 18, leadership: 25, battles: 5, service: 150, rating: 25 },
    duty: 'Lead a full squad, set squad objectives and place rally points. Cleared for tanks.' }),
  r({ id: 'ssg', name: 'Staff Sergeant', abbr: 'SSG', tier: TIER.NCO, squadSize: 8, scope: SCOPE.SQUAD, insignia: { type: 'chevron', n: 3, rockers: 1 },
    req: { xp: 19000, missions: 15, objectives: 28, leadership: 60, battles: 8, service: 220, rating: 28 },
    duty: 'Request ammunition drops for your squad. Cleared to fly helicopters.' }),
  r({ id: 'sfc', name: 'Sergeant First Class', abbr: 'SFC', tier: TIER.NCO, squadSize: 8, scope: SCOPE.SQUAD, insignia: { type: 'chevron', n: 3, rockers: 2 },
    req: { xp: 28000, missions: 21, objectives: 40, leadership: 110, battles: 12, service: 300, rating: 30 },
    duty: 'Mark enemy positions for every friendly in the area.' }),
  r({ id: 'msg', name: 'Master Sergeant', abbr: 'MSG', tier: TIER.NCO, squadSize: 8, scope: SCOPE.SQUAD, npcFollowers: 3, insignia: { type: 'chevron', n: 3, rockers: 3 },
    req: { xp: 40000, missions: 28, objectives: 55, leadership: 170, battles: 16, service: 400, rating: 32 },
    duty: 'Command an attached fireteam of friendly soldiers.' }),
  r({ id: '1sg', name: 'First Sergeant', abbr: '1SG', tier: TIER.NCO, squadSize: 8, scope: SCOPE.SQUAD, npcFollowers: 4, insignia: { type: 'chevron', n: 3, rockers: 3, center: 'diamond' },
    req: { xp: 54000, missions: 36, objectives: 70, leadership: 250, battles: 20, service: 520, rating: 34 },
    duty: 'Senior NCO. Larger attached fireteam.' }),
  r({ id: 'sgm', name: 'Sergeant Major', abbr: 'SGM', tier: TIER.NCO, squadSize: 8, scope: SCOPE.PLATOON, npcFollowers: 5, insignia: { type: 'chevron', n: 3, rockers: 3, center: 'star' },
    req: { xp: 72000, missions: 45, objectives: 90, leadership: 340, battles: 25, service: 660, rating: 36 },
    duty: 'Most senior NCO. May direct nearby squads like a platoon leader.' }),
  r({ id: '2lt', name: 'Second Lieutenant', abbr: '2LT', tier: TIER.OFFICER, squadSize: 8, scope: SCOPE.PLATOON, npcFollowers: 4, insignia: { type: 'bar', n: 1, color: 'gold' },
    req: { xp: 95000, missions: 56, objectives: 110, leadership: 450, battles: 30, service: 800, rating: 38 },
    duty: 'Platoon command: order up to three squads. Call smoke screens.' }),
  r({ id: '1lt', name: 'First Lieutenant', abbr: '1LT', tier: TIER.OFFICER, squadSize: 8, scope: SCOPE.PLATOON, npcFollowers: 4, insignia: { type: 'bar', n: 1, color: 'silver' },
    req: { xp: 122000, missions: 68, objectives: 135, leadership: 580, battles: 36, operations: 1, service: 960, rating: 40 },
    duty: 'Platoon command plus supply drops for the front.' }),
  r({ id: 'cpt', name: 'Captain', abbr: 'CPT', tier: TIER.OFFICER, squadSize: 8, scope: SCOPE.COMPANY, npcFollowers: 4, insignia: { type: 'bar', n: 2, color: 'silver' },
    req: { xp: 155000, missions: 82, objectives: 160, leadership: 740, battles: 44, operations: 2, service: 1150, rating: 42 },
    duty: 'Company command: every squad in a territory. Deploy reinforcement squads.' }),
  r({ id: 'maj', name: 'Major', abbr: 'MAJ', tier: TIER.SENIOR, squadSize: 8, scope: SCOPE.BATTALION, npcFollowers: 4, insignia: { type: 'leaf', color: 'gold' },
    req: { xp: 195000, missions: 98, objectives: 190, leadership: 930, battles: 52, operations: 4, service: 1380, rating: 44 },
    duty: 'Coordinate units across territories. Artillery and strategic priorities.' }),
  r({ id: 'ltc', name: 'Lieutenant Colonel', abbr: 'LTC', tier: TIER.SENIOR, squadSize: 8, scope: SCOPE.BATTALION, npcFollowers: 4, insignia: { type: 'leaf', color: 'silver' },
    req: { xp: 242000, missions: 116, objectives: 225, leadership: 1150, battles: 62, operations: 6, service: 1650, rating: 45 },
    duty: 'Launch coordinated operations.' }),
  r({ id: 'col', name: 'Colonel', abbr: 'COL', tier: TIER.SENIOR, squadSize: 8, scope: SCOPE.BATTALION, npcFollowers: 4, cpCapBonus: 10, insignia: { type: 'eagle' },
    req: { xp: 298000, missions: 136, objectives: 260, leadership: 1400, battles: 72, operations: 9, service: 1950, rating: 46 },
    duty: 'Call in air support.' }),
  r({ id: 'bg', name: 'Brigadier General', abbr: 'BG', tier: TIER.GENERAL, squadSize: 8, scope: SCOPE.THEATER, npcFollowers: 4, cpCapBonus: 20, insignia: { type: 'star', n: 1 },
    req: { xp: 365000, missions: 160, objectives: 300, leadership: 1700, battles: 84, operations: 12, service: 2300, rating: 47 },
    duty: 'Theater command. Commit reinforcement battalions.' }),
  r({ id: 'mg', name: 'Major General', abbr: 'MG', tier: TIER.GENERAL, squadSize: 8, scope: SCOPE.THEATER, npcFollowers: 4, cooldownMult: 0.9, cpCapBonus: 25, insignia: { type: 'star', n: 2 },
    req: { xp: 445000, missions: 186, objectives: 345, leadership: 2050, battles: 96, operations: 16, service: 2700, rating: 48 },
    duty: 'Theater command with faster command cycles.' }),
  r({ id: 'ltg', name: 'Lieutenant General', abbr: 'LTG', tier: TIER.GENERAL, squadSize: 8, scope: SCOPE.THEATER, npcFollowers: 4, cooldownMult: 0.85, cpCapBonus: 30, insignia: { type: 'star', n: 3 },
    req: { xp: 540000, missions: 215, objectives: 395, leadership: 2450, battles: 110, operations: 21, service: 3150, rating: 49 },
    duty: 'Theater command with faster command cycles.' }),
  r({ id: 'gen', name: 'General', abbr: 'GEN', tier: TIER.GENERAL, squadSize: 8, scope: SCOPE.THEATER, npcFollowers: 4, cooldownMult: 0.8, cpCapBonus: 40, insignia: { type: 'star', n: 4 },
    req: { xp: 650000, missions: 250, objectives: 450, leadership: 2900, battles: 125, operations: 27, service: 3600, rating: 50 },
    duty: 'Supreme battlefield command. Declare major offensives.' }),
];

export const RANK_INDEX = Object.fromEntries(RANKS.map((rk, i) => [rk.id, i]));
export const MAX_RANK = RANKS.length - 1;

export const RANK = {
  RECRUIT: 0,
  PRIVATE: 1,
  PFC: 2,
  SPECIALIST: 3,
  CORPORAL: 4,
  SERGEANT: 5,
  STAFF_SERGEANT: 6,
  SFC: 7,
  MASTER_SERGEANT: 8,
  FIRST_SERGEANT: 9,
  SERGEANT_MAJOR: 10,
  SECOND_LT: 11,
  FIRST_LT: 12,
  CAPTAIN: 13,
  MAJOR: 14,
  LT_COLONEL: 15,
  COLONEL: 16,
  BRIG_GENERAL: 17,
  MAJOR_GENERAL: 18,
  LT_GENERAL: 19,
  GENERAL: 20,
};

export function rankOf(index) {
  return RANKS[Math.max(0, Math.min(MAX_RANK, index | 0))];
}

export function isOfficer(index) {
  return index >= RANK.SECOND_LT;
}

export function isNCO(index) {
  return index >= RANK.CORPORAL && index < RANK.SECOND_LT;
}

export function rankTitle(index, name) {
  return `${rankOf(index).abbr} ${name}`;
}

// Labels for requirement keys (UI).
export const REQ_LABELS = {
  training: 'Basic training',
  xp: 'Experience',
  missions: 'Missions completed',
  objectives: 'Objectives taken/held',
  leadership: 'Leadership points',
  battles: 'Battles fought',
  operations: 'Successful operations',
  service: 'Minutes of service',
  rating: 'Performance rating',
};

// Given a career record, returns {met: bool, items:[{key,have,need,met}]} for the NEXT rank.
export function promotionStatus(career) {
  const next = career.rank + 1;
  if (next > MAX_RANK) return { met: false, maxed: true, items: [] };
  const req = RANKS[next].req;
  const s = career.stats || {};
  const items = [];
  for (const key of Object.keys(req)) {
    let have;
    switch (key) {
      case 'training': have = career.trainingComplete ? 1 : 0; break;
      case 'xp': have = career.xp | 0; break;
      case 'rating': have = Math.round(career.rating || 0); break;
      default: have = s[key] | 0;
    }
    const need = key === 'training' ? 1 : req[key];
    items.push({ key, have, need, met: have >= need });
  }
  return { met: items.every((i) => i.met), maxed: false, items, next };
}
