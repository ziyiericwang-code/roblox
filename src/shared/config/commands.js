// Command hierarchy: simple contextual orders plus rank-gated officer abilities.
import { RANK, SCOPE } from './ranks.js';

// Orders are issued at a world position (where the issuer is looking) or at an entity.
export const ORDERS = {
  attack: { id: 'attack', name: 'Attack', key: '1', icon: '⚔', radius: 30, verb: 'attack', color: '#e0563f' },
  defend: { id: 'defend', name: 'Defend', key: '2', icon: '⛨', radius: 30, verb: 'defend', color: '#4f8fe0' },
  move: { id: 'move', name: 'Move To', key: '3', icon: '➤', radius: 18, verb: 'move to', color: '#e0c44f' },
  hold: { id: 'hold', name: 'Hold Position', key: '4', icon: '■', radius: 20, verb: 'hold at', color: '#9aa4b0', usesIssuerPos: false },
  follow: { id: 'follow', name: 'Follow Me', key: '5', icon: '⇶', radius: 15, verb: 'follow', color: '#6fd07a', targetsIssuer: true },
  regroup: { id: 'regroup', name: 'Regroup', key: '6', icon: '◎', radius: 15, verb: 'regroup on', color: '#6fd07a', targetsIssuer: true },
  escort: { id: 'escort', name: 'Escort', key: '7', icon: '⇄', radius: 25, verb: 'escort', color: '#c07fe0', needsEntity: true },
  retreat: { id: 'retreat', name: 'Fall Back', key: '8', icon: '↩', radius: 30, verb: 'fall back to', color: '#e09a4f' },
};

export const ORDER_IDS = Object.keys(ORDERS);
export const ORDER_COOLDOWN = 3; // seconds between orders from the same issuer
export const ORDER_LIFETIME = 240; // seconds

// Officer abilities. cp = faction Command Points consumed. Cooldowns are per player
// and scaled by the rank's cooldownMult (general officers cycle slightly faster).
export const ABILITIES = {
  rally_point: {
    id: 'rally_point', name: 'Rally Point', minRank: RANK.SERGEANT, cooldown: 75, cp: 0, needsPos: false,
    desc: 'Place a squad spawn point at your position.',
  },
  ammo_drop: {
    id: 'ammo_drop', name: 'Ammo Drop', minRank: RANK.STAFF_SERGEANT, cooldown: 150, cp: 4, needsPos: true, range: 250,
    desc: 'Parachute an ammunition crate to a location.',
  },
  mark_target: {
    id: 'mark_target', name: 'Mark Enemy Position', minRank: RANK.SFC, cooldown: 45, cp: 0, needsPos: true, range: 400, radius: 30,
    desc: 'Reveal enemies around a point to every friendly soldier for 30 seconds.',
  },
  fireteam: {
    id: 'fireteam', name: 'Attach Fireteam', minRank: RANK.MASTER_SERGEANT, cooldown: 200, cp: 8, needsPos: false,
    desc: 'Friendly soldiers join you as followers (count depends on rank).',
  },
  smoke_screen: {
    id: 'smoke_screen', name: 'Smoke Screen', minRank: RANK.SECOND_LT, cooldown: 120, cp: 6, needsPos: true, range: 350,
    desc: 'Mortar smoke barrage to cover an advance.',
  },
  supply_drop: {
    id: 'supply_drop', name: 'Supply Drop', minRank: RANK.FIRST_LT, cooldown: 210, cp: 10, needsPos: true, range: 400,
    desc: 'Drop supplies that resupply troops and raise territory supply.',
  },
  reinforce: {
    id: 'reinforce', name: 'Reinforcement Squad', minRank: RANK.CAPTAIN, cooldown: 240, cp: 18, needsPos: true, range: 800,
    desc: 'Deploy a friendly squad of six to attack or defend a location.',
  },
  artillery: {
    id: 'artillery', name: 'Artillery Strike', minRank: RANK.MAJOR, cooldown: 300, cp: 28, needsPos: true, range: 900, radius: 26,
    needsObserver: 220, safety: 45,
    desc: 'Fire mission on a target. Needs a friendly soldier within 220 m of the target to observe.',
  },
  priority: {
    id: 'priority', name: 'Set Strategic Priority', minRank: RANK.MAJOR, cooldown: 90, cp: 0, needsTerritory: true,
    desc: 'Direct the army\'s attention (AI squads and new missions) to a territory.',
  },
  operation: {
    id: 'operation', name: 'Launch Operation', minRank: RANK.LT_COLONEL, cooldown: 720, cp: 35, needsTerritory: true, minPlayers: 2,
    desc: 'Coordinated multi-objective offensive. Success counts toward everyone\'s career.',
  },
  air_support: {
    id: 'air_support', name: 'Air Support', minRank: RANK.COLONEL, cooldown: 480, cp: 40, needsPos: true, range: 1600,
    desc: 'A gunship circles the target for 60 seconds.',
  },
  battalion: {
    id: 'battalion', name: 'Commit Battalion', minRank: RANK.BRIG_GENERAL, cooldown: 720, cp: 55, needsTerritory: true,
    desc: 'Commit three reinforcement squads to a territory.',
  },
  offensive: {
    id: 'offensive', name: 'Major Offensive', minRank: RANK.GENERAL, cooldown: 1500, cp: 85, needsTerritory: true,
    desc: 'All-out army offensive on a territory with bonus rewards for 10 minutes.',
  },
};

export const ABILITY_IDS = Object.keys(ABILITIES);

export const COMMAND_POINTS = {
  base: 40,
  cap: 100,
  perTerritoryPerMin: 1.6,
  perSupplyDelivered: 3,
  perObjectiveCaptured: 4,
  aiUseFraction: 0.5, // AI commander may use this much of its pool
};

export function scopeReachDesc(scope) {
  switch (scope) {
    case SCOPE.SQUAD: return 'your squad';
    case SCOPE.PLATOON: return 'up to 3 nearby squads';
    case SCOPE.COMPANY: return 'all squads in a territory';
    case SCOPE.BATTALION: return 'squads across neighbouring territories';
    case SCOPE.THEATER: return 'every unit in the theater';
    default: return 'nobody';
  }
}
