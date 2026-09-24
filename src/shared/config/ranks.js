// The complete rank hierarchy: 14 enlisted, 5 warrant officer and 11 commissioned
// officer ranks, in order of precedence (a higher index outranks a lower one).
//
// Everybody starts as a Recruit on the enlisted track. From Sergeant a soldier
// may stay enlisted (up to Sergeant Major of the Army), become a Warrant Officer
// (technical experts: pilots, crews, specialists) or go to Officer Candidate
// School (the command path up to General of the Army). Warrant officers may
// also commission later.
//
// Ranks are NOT cosmetic. Each rank decides:
//   role        what your gameplay is ("FIGHTER", "SQUAD LEADER", "WAR COMMANDER")
//   scope       how far your orders reach
//   orders      which orders you may give (MOVE ... REINFORCE)
//   map         strategic world-map command (0 none, 1 regional, 2 theater, 3 supreme)
//   clearance   which rooms and buildings you may enter (see LVL in world/buildings.js)
//   squadSize / npcFollowers / abilities (config/commands.js)
//
// Promotion requirements combine several career stats so that no single
// activity (e.g. farming kills) can carry a player up the ladder:
//   xp, missions, objectives (sectors taken/held), leadership (earned when the
//   people you lead achieve things), battles, operations (battles won / large
//   operations), service (minutes deployed), rating (0-100 performance),
//   crew (minutes crewing vehicles/aircraft), support (heals, revives, repairs, resupplies)

export const TRACK = { ENLISTED: 'E', WARRANT: 'W', OFFICER: 'O' };
export const TRACK_NAMES = { E: 'Enlisted', W: 'Warrant Officer', O: 'Commissioned Officer' };

export const TIER = {
  RECRUIT: 'recruit',
  ENLISTED: 'enlisted',
  NCO: 'nco',
  SENIOR_NCO: 'senior_nco',
  WARRANT: 'warrant',
  OFFICER: 'officer', // company grade
  SENIOR: 'senior', // field grade
  GENERAL: 'general',
};

// Command scopes, ordered by reach.
export const SCOPE = {
  NONE: 0,
  SQUAD: 1, // own squad (+ attached NPC followers)
  PLATOON: 2, // up to 3 squads near the target point
  COMPANY: 3, // every squad in the target territory
  BATTALION: 4, // target territory and its neighbours
  REGION: 5, // a whole region of the front
  THEATER: 6, // everything
};

export const SCOPE_NAMES = ['None', 'Squad', 'Platoon', 'Company', 'Battalion', 'Region', 'Theater'];

// Access clearance levels (same numbers as LVL in shared/world/buildings.js).
export const CLEARANCE_NAMES = ['Public', 'NCO', 'Officer', 'Command', 'Regional Command', 'High Command', 'General Staff'];

const BASIC = ['move', 'follow', 'hold', 'regroup'];
const SQUAD = [...BASIC, 'attack', 'defend', 'retreat', 'escort'];
const OFFICER = [...SQUAD, 'reinforce'];

function r(def) {
  return {
    squadSize: 0,
    scope: SCOPE.NONE,
    orders: [],
    map: 0,
    npcFollowers: 0,
    cooldownMult: 1,
    cpCapBonus: 0,
    clearance: 0,
    req: {},
    ...def,
  };
}

const E = TRACK.ENLISTED;
const W = TRACK.WARRANT;
const O = TRACK.OFFICER;

export const RANKS = [
  // ------------------------------------------------------------ enlisted
  r({ id: 'rct', name: 'Recruit', abbr: 'RCT', grade: 'E-0', track: E, tier: TIER.RECRUIT, role: 'Trainee',
    insignia: { type: 'none' },
    duty: 'Complete basic training at the training grounds of your army headquarters.' }),
  r({ id: 'pv1', name: 'Private', abbr: 'PVT', grade: 'E-1', track: E, tier: TIER.ENLISTED, role: 'Fighter',
    insignia: { type: 'chevron', n: 1, outline: true },
    req: { training: true },
    duty: 'Follow orders, fight, capture objectives and join a squad.' }),
  r({ id: 'pv2', name: 'Private Second Class', abbr: 'PV2', grade: 'E-2', track: E, tier: TIER.ENLISTED, role: 'Fighter',
    insignia: { type: 'chevron', n: 1 },
    req: { xp: 500, service: 8 },
    duty: 'Cleared to drive light vehicles. Keep fighting with your squad.' }),
  r({ id: 'pfc', name: 'Private First Class', abbr: 'PFC', grade: 'E-3', track: E, tier: TIER.ENLISTED, role: 'Fighter',
    insignia: { type: 'chevron', n: 1, rockers: 1 },
    req: { xp: 1500, missions: 1, service: 20 },
    duty: 'Qualified for the Medic, Engineer and Support roles and naval craft.' }),
  r({ id: 'spc', name: 'Specialist', abbr: 'SPC', grade: 'E-4', track: E, tier: TIER.ENLISTED, role: 'Specialist',
    insignia: { type: 'shield' },
    req: { xp: 3200, missions: 2, objectives: 3, service: 35 },
    duty: 'Qualified as a Scout and on recon vehicles.' }),
  r({ id: 'cpl', name: 'Corporal', abbr: 'CPL', grade: 'E-4', track: E, tier: TIER.NCO, role: 'Fireteam Leader',
    squadSize: 4, scope: SCOPE.SQUAD, orders: BASIC, clearance: 1,
    insignia: { type: 'chevron', n: 2 },
    req: { xp: 6000, missions: 4, objectives: 7, battles: 2, service: 60 },
    duty: 'Lead a fireteam of four: MOVE, FOLLOW, HOLD and REGROUP. Enter NCO areas. Cleared for armoured transports.' }),
  r({ id: 'sgt', name: 'Sergeant', abbr: 'SGT', grade: 'E-5', track: E, tier: TIER.NCO, role: 'Squad Leader',
    squadSize: 8, scope: SCOPE.SQUAD, orders: SQUAD, clearance: 1,
    insignia: { type: 'chevron', n: 3 },
    req: { xp: 10000, missions: 7, objectives: 12, leadership: 15, battles: 4, service: 100, rating: 25 },
    duty: 'Lead a full squad with every squad order and place rally points. Cleared for tanks. May apply for Warrant Officer or Officer Candidate School.' }),
  r({ id: 'ssg', name: 'Staff Sergeant', abbr: 'SSG', grade: 'E-6', track: E, tier: TIER.NCO, role: 'Squad Leader',
    squadSize: 8, scope: SCOPE.SQUAD, orders: SQUAD, clearance: 1,
    insignia: { type: 'chevron', n: 3, rockers: 1 },
    req: { xp: 16000, missions: 11, objectives: 20, leadership: 45, battles: 6, service: 160, rating: 27 },
    duty: 'Request ammunition drops for your squad. Cleared to fly helicopters.' }),
  r({ id: 'sfc', name: 'Sergeant First Class', abbr: 'SFC', grade: 'E-7', track: E, tier: TIER.SENIOR_NCO, role: 'Platoon Sergeant',
    squadSize: 8, scope: SCOPE.PLATOON, orders: SQUAD, clearance: 1,
    insignia: { type: 'chevron', n: 3, rockers: 2 },
    req: { xp: 24000, missions: 16, objectives: 30, leadership: 90, battles: 9, service: 230, rating: 29 },
    duty: 'Platoon sergeant: order nearby squads and mark enemy positions for everyone.' }),
  r({ id: 'msg', name: 'Master Sergeant', abbr: 'MSG', grade: 'E-8', track: E, tier: TIER.SENIOR_NCO, role: 'Platoon Sergeant',
    squadSize: 8, scope: SCOPE.PLATOON, orders: SQUAD, npcFollowers: 3, clearance: 1,
    insignia: { type: 'chevron', n: 3, rockers: 3 },
    req: { xp: 34000, missions: 22, objectives: 42, leadership: 150, battles: 13, service: 320, rating: 31 },
    duty: 'Command an attached fireteam of three soldiers.' }),
  r({ id: '1sg', name: 'First Sergeant', abbr: '1SG', grade: 'E-8', track: E, tier: TIER.SENIOR_NCO, role: 'Company First Sergeant',
    squadSize: 8, scope: SCOPE.PLATOON, orders: SQUAD, npcFollowers: 4, clearance: 1,
    insignia: { type: 'chevron', n: 3, rockers: 3, center: 'diamond' },
    req: { xp: 47000, missions: 29, objectives: 56, leadership: 230, battles: 17, service: 420, rating: 33 },
    duty: 'Senior NCO of a company. Larger attached fireteam.' }),
  r({ id: 'sgm', name: 'Sergeant Major', abbr: 'SGM', grade: 'E-9', track: E, tier: TIER.SENIOR_NCO, role: 'Senior Enlisted Leader',
    squadSize: 8, scope: SCOPE.COMPANY, orders: SQUAD, npcFollowers: 4, clearance: 2,
    insignia: { type: 'chevron', n: 3, rockers: 3, center: 'star' },
    req: { xp: 63000, missions: 37, objectives: 72, leadership: 330, battles: 22, service: 540, rating: 35 },
    duty: 'Direct every squad in a territory. Enter officer buildings.' }),
  r({ id: 'csm', name: 'Command Sergeant Major', abbr: 'CSM', grade: 'E-9', track: E, tier: TIER.SENIOR_NCO, role: 'Command Sergeant Major',
    squadSize: 8, scope: SCOPE.BATTALION, orders: SQUAD, npcFollowers: 5, clearance: 3, cpCapBonus: 5,
    insignia: { type: 'chevron', n: 3, rockers: 3, center: 'star', wreath: true },
    req: { xp: 84000, missions: 47, objectives: 92, leadership: 460, battles: 28, service: 690, rating: 37 },
    duty: 'Senior advisor to the commander: rally cry for nearby troops, access to command facilities.' }),
  r({ id: 'sma', name: 'Sergeant Major of the Army', abbr: 'SMA', grade: 'E-9', track: E, tier: TIER.SENIOR_NCO, role: 'Senior Enlisted Advisor',
    squadSize: 8, scope: SCOPE.BATTALION, orders: SQUAD, npcFollowers: 6, clearance: 5, cpCapBonus: 10, cooldownMult: 0.9,
    insignia: { type: 'chevron', n: 3, rockers: 3, center: 'eagle' },
    req: { xp: 112000, missions: 60, objectives: 118, leadership: 640, battles: 36, service: 880, rating: 40 },
    duty: 'The highest enlisted rank. Advisor to High Command with access to its strategy rooms.' }),
  // ------------------------------------------------------------ warrant officers
  r({ id: 'wo1', name: 'Warrant Officer 1', abbr: 'WO1', grade: 'W-1', track: W, tier: TIER.WARRANT, role: 'Technical Specialist',
    squadSize: 6, scope: SCOPE.SQUAD, orders: SQUAD, clearance: 2,
    insignia: { type: 'warrant', n: 1 },
    req: { xp: 14000, missions: 9, crew: 30, support: 25, service: 130, rating: 26 },
    duty: 'Pilot and crew expert: every vehicle, helicopter and aircraft. Drone reconnaissance.' }),
  r({ id: 'cw2', name: 'Chief Warrant Officer 2', abbr: 'CW2', grade: 'W-2', track: W, tier: TIER.WARRANT, role: 'Technical Specialist',
    squadSize: 6, scope: SCOPE.SQUAD, orders: SQUAD, clearance: 2,
    insignia: { type: 'warrant', n: 2 },
    req: { xp: 22000, missions: 13, crew: 60, support: 45, service: 200, rating: 28 },
    duty: 'Mark enemy positions and lead a vehicle crew.' }),
  r({ id: 'cw3', name: 'Chief Warrant Officer 3', abbr: 'CW3', grade: 'W-3', track: W, tier: TIER.WARRANT, role: 'Senior Specialist',
    squadSize: 8, scope: SCOPE.SQUAD, orders: SQUAD, npcFollowers: 2, clearance: 2,
    insignia: { type: 'warrant', n: 3 },
    req: { xp: 32000, missions: 18, crew: 100, support: 70, service: 280, rating: 30 },
    duty: 'Call in supply drops. Attached crew of two.' }),
  r({ id: 'cw4', name: 'Chief Warrant Officer 4', abbr: 'CW4', grade: 'W-4', track: W, tier: TIER.WARRANT, role: 'Master Specialist',
    squadSize: 8, scope: SCOPE.PLATOON, orders: SQUAD, npcFollowers: 3, clearance: 2,
    insignia: { type: 'warrant', n: 4 },
    req: { xp: 45000, missions: 24, crew: 150, support: 100, service: 380, rating: 32 },
    duty: 'Direct fire missions (artillery) and nearby squads.' }),
  r({ id: 'cw5', name: 'Chief Warrant Officer 5', abbr: 'CW5', grade: 'W-5', track: W, tier: TIER.WARRANT, role: 'Master Specialist',
    squadSize: 8, scope: SCOPE.PLATOON, orders: SQUAD, npcFollowers: 4, clearance: 3,
    insignia: { type: 'warrant', line: true },
    req: { xp: 62000, missions: 32, crew: 220, support: 140, service: 500, rating: 34 },
    duty: 'Senior technical advisor: coordinate air support and enter command facilities.' }),
  // ------------------------------------------------------------ commissioned officers
  r({ id: '2lt', name: 'Second Lieutenant', abbr: '2LT', grade: 'O-1', track: O, tier: TIER.OFFICER, role: 'Platoon Leader',
    squadSize: 8, scope: SCOPE.PLATOON, orders: SQUAD, npcFollowers: 4, clearance: 2,
    insignia: { type: 'bar', n: 1, color: 'gold' },
    req: { xp: 18000, missions: 12, objectives: 20, leadership: 60, battles: 6, service: 170, rating: 30 },
    duty: 'Lead several squads. Officer buildings and planning rooms. Smoke screens.' }),
  r({ id: '1lt', name: 'First Lieutenant', abbr: '1LT', grade: 'O-2', track: O, tier: TIER.OFFICER, role: 'Platoon Leader',
    squadSize: 8, scope: SCOPE.PLATOON, orders: SQUAD, npcFollowers: 4, clearance: 2,
    insignia: { type: 'bar', n: 1, color: 'silver' },
    req: { xp: 26000, missions: 17, objectives: 30, leadership: 110, battles: 9, operations: 1, service: 240, rating: 32 },
    duty: 'Platoon command plus supply drops for the front.' }),
  r({ id: 'cpt', name: 'Captain', abbr: 'CPT', grade: 'O-3', track: O, tier: TIER.OFFICER, role: 'Field Commander',
    squadSize: 8, scope: SCOPE.COMPANY, orders: OFFICER, npcFollowers: 4, clearance: 3,
    insignia: { type: 'bar', n: 2, color: 'silver' },
    req: { xp: 37000, missions: 23, objectives: 42, leadership: 180, battles: 13, operations: 2, service: 330, rating: 34 },
    duty: 'Company command: every squad in a territory, REINFORCE orders and command facilities.' }),
  r({ id: 'maj', name: 'Major', abbr: 'MAJ', grade: 'O-4', track: O, tier: TIER.SENIOR, role: 'Operations Officer',
    squadSize: 8, scope: SCOPE.BATTALION, orders: OFFICER, npcFollowers: 4, clearance: 3,
    insignia: { type: 'leaf', color: 'gold' },
    req: { xp: 52000, missions: 30, objectives: 56, leadership: 270, battles: 18, operations: 4, service: 440, rating: 36 },
    duty: 'Coordinate units across neighbouring territories. Artillery and strategic priorities.' }),
  r({ id: 'ltc', name: 'Lieutenant Colonel', abbr: 'LTC', grade: 'O-5', track: O, tier: TIER.SENIOR, role: 'Battalion Commander',
    squadSize: 8, scope: SCOPE.BATTALION, orders: OFFICER, npcFollowers: 4, clearance: 3, cpCapBonus: 5,
    insignia: { type: 'leaf', color: 'silver' },
    req: { xp: 72000, missions: 39, objectives: 74, leadership: 390, battles: 24, operations: 6, service: 580, rating: 38 },
    duty: 'Launch coordinated operations.' }),
  r({ id: 'col', name: 'Colonel', abbr: 'COL', grade: 'O-6', track: O, tier: TIER.SENIOR, role: 'Regional Commander',
    squadSize: 8, scope: SCOPE.REGION, orders: OFFICER, map: 1, npcFollowers: 4, clearance: 4, cpCapBonus: 10,
    insignia: { type: 'eagle' },
    req: { xp: 98000, missions: 50, objectives: 96, leadership: 540, battles: 31, operations: 9, service: 750, rating: 40 },
    duty: 'Command a region from the regional headquarters: move armies between neighbouring territories. Air support.' }),
  r({ id: 'bg', name: 'Brigadier General', abbr: 'BG', grade: 'O-7', track: O, tier: TIER.GENERAL, role: 'War Commander',
    squadSize: 8, scope: SCOPE.THEATER, orders: OFFICER, map: 2, npcFollowers: 4, clearance: 5, cpCapBonus: 20,
    insignia: { type: 'star', n: 1 },
    req: { xp: 132000, missions: 63, objectives: 122, leadership: 730, battles: 39, operations: 12, service: 960, rating: 42 },
    duty: 'Strategic command from the world map: ATTACK, DEFEND, MOVE and REINFORCE anywhere. High Command strategy rooms.' }),
  r({ id: 'mg', name: 'Major General', abbr: 'MG', grade: 'O-8', track: O, tier: TIER.GENERAL, role: 'War Commander',
    squadSize: 8, scope: SCOPE.THEATER, orders: OFFICER, map: 2, npcFollowers: 4, clearance: 5, cpCapBonus: 25, cooldownMult: 0.9,
    insignia: { type: 'star', n: 2 },
    req: { xp: 175000, missions: 78, objectives: 152, leadership: 960, battles: 48, operations: 16, service: 1210, rating: 44 },
    duty: 'Theater command with faster command cycles.' }),
  r({ id: 'ltg', name: 'Lieutenant General', abbr: 'LTG', grade: 'O-9', track: O, tier: TIER.GENERAL, role: 'War Commander',
    squadSize: 8, scope: SCOPE.THEATER, orders: OFFICER, map: 2, npcFollowers: 4, clearance: 5, cpCapBonus: 30, cooldownMult: 0.85,
    insignia: { type: 'star', n: 3 },
    req: { xp: 230000, missions: 96, objectives: 188, leadership: 1240, battles: 58, operations: 21, service: 1500, rating: 46 },
    duty: 'Theater command. Commit reinforcement battalions.' }),
  r({ id: 'gen', name: 'General', abbr: 'GEN', grade: 'O-10', track: O, tier: TIER.GENERAL, role: 'War Commander',
    squadSize: 8, scope: SCOPE.THEATER, orders: OFFICER, map: 2, npcFollowers: 4, clearance: 6, cpCapBonus: 40, cooldownMult: 0.8,
    insignia: { type: 'star', n: 4 },
    req: { xp: 300000, missions: 118, objectives: 230, leadership: 1580, battles: 70, operations: 27, service: 1850, rating: 48 },
    duty: 'Commands the war from the General’s office at High Command. Declares major offensives.' }),
  r({ id: 'ga', name: 'General of the Army', abbr: 'GA', grade: 'O-11', track: O, tier: TIER.GENERAL, role: 'Supreme Commander',
    squadSize: 8, scope: SCOPE.THEATER, orders: OFFICER, map: 3, npcFollowers: 6, clearance: 6, cpCapBonus: 60, cooldownMult: 0.7,
    insignia: { type: 'star', n: 5 },
    req: { xp: 400000, missions: 145, objectives: 280, leadership: 2000, battles: 85, operations: 35, service: 2300, rating: 50 },
    duty: 'Supreme command: general offensives on every front and control of the national reserve.' }),
];

export const RANK_INDEX = Object.fromEntries(RANKS.map((rk, i) => [rk.id, i]));
export const MAX_RANK = RANKS.length - 1;

export const RANK = {
  RECRUIT: 0,
  PRIVATE: 1,
  PV2: 2,
  PFC: 3,
  SPECIALIST: 4,
  CORPORAL: 5,
  SERGEANT: 6,
  STAFF_SERGEANT: 7,
  SFC: 8,
  MASTER_SERGEANT: 9,
  FIRST_SERGEANT: 10,
  SERGEANT_MAJOR: 11,
  CSM: 12,
  SMA: 13,
  WO1: 14,
  CW2: 15,
  CW3: 16,
  CW4: 17,
  CW5: 18,
  SECOND_LT: 19,
  FIRST_LT: 20,
  CAPTAIN: 21,
  MAJOR: 22,
  LT_COLONEL: 23,
  COLONEL: 24,
  BRIG_GENERAL: 25,
  MAJOR_GENERAL: 26,
  LT_GENERAL: 27,
  GENERAL: 28,
  GENERAL_OF_ARMY: 29,
};

// First and last rank of each track.
export const TRACK_RANGE = {
  E: [RANK.RECRUIT, RANK.SMA],
  W: [RANK.WO1, RANK.CW5],
  O: [RANK.SECOND_LT, RANK.GENERAL_OF_ARMY],
};

export function rankOf(index) {
  return RANKS[Math.max(0, Math.min(MAX_RANK, index | 0))];
}

export function trackOf(index) {
  return rankOf(index).track;
}

// Commissioned officer (2LT and above).
export function isOfficer(index) {
  return index >= RANK.SECOND_LT;
}

export function isWarrant(index) {
  return index >= RANK.WO1 && index <= RANK.CW5;
}

// Any kind of officer (warrant or commissioned): saluted, uses officer areas.
export function isAnyOfficer(index) {
  return index >= RANK.WO1;
}

export function isNCO(index) {
  return index >= RANK.CORPORAL && index <= RANK.SMA;
}

export function isGeneral(index) {
  return index >= RANK.BRIG_GENERAL;
}

export function rankTitle(index, name) {
  return `${rankOf(index).abbr} ${name}`;
}

export function clearanceOf(index) {
  return rankOf(index).clearance;
}

// Lowest rank that holds a clearance level (for "requires ..." messages).
export function clearanceRankName(level) {
  if (level <= 0) return 'anyone';
  if (level === 1) return 'NCOs (Corporal and above)';
  if (level === 2) return 'officers (Warrant Officer / Lieutenant and above)';
  if (level === 3) return 'command staff (Captain and above)';
  if (level === 4) return 'regional commanders (Colonel and above)';
  if (level === 5) return 'High Command (Brigadier General and above)';
  return 'Generals';
}

export function canGiveOrder(index, orderId) {
  return rankOf(index).orders.includes(orderId);
}

// Labels for requirement keys (UI).
export const REQ_LABELS = {
  training: 'Basic training',
  rank: 'Current rank',
  xp: 'Experience',
  missions: 'Missions completed',
  objectives: 'Objectives taken/held',
  leadership: 'Leadership points',
  battles: 'Battles fought',
  operations: 'Battles won / operations',
  service: 'Minutes of service',
  rating: 'Performance rating',
  crew: 'Minutes crewing vehicles',
  support: 'Heals, revives, repairs, resupplies',
};

function reqItems(career, to) {
  const req = RANKS[to].req;
  const s = career.stats || {};
  const items = [];
  for (const key of Object.keys(req)) {
    let have;
    switch (key) {
      case 'training': have = career.trainingComplete ? 1 : 0; break;
      case 'xp': have = career.xp | 0; break;
      case 'rating': have = Math.round(career.rating || 0); break;
      case 'support': have = (s.heals | 0) + (s.revives | 0) + (s.repairs | 0) + (s.resupplies | 0) + (s.supplies | 0); break;
      default: have = s[key] | 0;
    }
    const need = key === 'training' ? 1 : req[key];
    items.push({ key, have, need, met: have >= need });
  }
  return items;
}

// Requirements for promotion from the career's rank to rank `to`.
export function promotionStatus(career, to = null) {
  const cur = career.rank | 0;
  const opts = promotionPaths(cur);
  const target = to ?? opts[0]?.to;
  if (target === undefined || target === null) return { met: false, maxed: true, items: [], next: null };
  const path = opts.find((o) => o.to === target);
  if (!path) return { met: false, maxed: false, items: [], next: target, invalid: true };
  const items = reqItems(career, target);
  return { met: items.every((i) => i.met), maxed: false, items, next: target, kind: path.kind };
}

// Ranks reachable from `cur` by one promotion.
//   kind 'promotion'  next rank on the same track
//   kind 'warrant'    enlisted Sergeant+ -> Warrant Officer 1
//   kind 'commission' enlisted Sergeant+ or any warrant -> Second Lieutenant (OCS)
export function promotionPaths(cur) {
  const out = [];
  const track = trackOf(cur);
  const [, last] = TRACK_RANGE[track];
  if (cur < last) out.push({ to: cur + 1, kind: 'promotion' });
  if (track === TRACK.ENLISTED && cur >= RANK.SERGEANT) {
    out.push({ to: RANK.WO1, kind: 'warrant' });
    out.push({ to: RANK.SECOND_LT, kind: 'commission' });
  }
  if (track === TRACK.WARRANT) out.push({ to: RANK.SECOND_LT, kind: 'commission' });
  return out;
}

// Every path from the current rank with its requirement status.
export function promotionOptions(career) {
  return promotionPaths(career.rank | 0).map((p) => ({ ...p, ...promotionStatus(career, p.to) }));
}

// Converts a rank index from the 21-rank ladder of profile version <= 2.
export const LEGACY_RANK_MAP = [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28];

// How soldiers address someone of this rank ("Yes, Sergeant Major.").
export function addressOf(index) {
  const id = rankOf(index).id;
  switch (id) {
    case 'rct': return 'Recruit';
    case 'pv1': case 'pv2': case 'pfc': return 'Private';
    case 'spc': return 'Specialist';
    case 'cpl': return 'Corporal';
    case 'sgt': case 'ssg': case 'sfc': case 'msg': return 'Sergeant';
    case '1sg': return 'First Sergeant';
    case 'sgm': return 'Sergeant Major';
    case 'csm': return 'Command Sergeant Major';
    case 'sma': return 'Sergeant Major of the Army';
    case 'wo1': return 'Warrant Officer';
    case 'cw2': case 'cw3': case 'cw4': case 'cw5': return 'Chief';
    case '2lt': case '1lt': return 'Lieutenant';
    case 'cpt': return 'Captain';
    case 'maj': return 'Major';
    case 'ltc': case 'col': return 'Colonel';
    default: return 'General';
  }
}
