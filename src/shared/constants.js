// Global constants shared by client and simulation.

export const GAME_NAME = 'Frontline Command';
export const PROTOCOL_VERSION = 3;

export const WORLD_SEED = 1947;
export const WORLD_HALF = 800; // world spans [-800, 800] metres on x and z
export const SEA_LEVEL = 0;

export const TICK_RATE = 20; // simulation ticks per second
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 20;
export const INTEREST_RADIUS = 420; // metres; entities beyond this are not replicated

export const FACTION = {
  NONE: 0,
  COALITION: 1, // player army
  DOMINION: 2, // opposing army (AI)
};

export const FACTION_INFO = {
  [FACTION.COALITION]: {
    id: FACTION.COALITION,
    key: 'coalition',
    name: 'Allied Coalition',
    short: 'Coalition',
    color: '#5b8fd6',
    hq: 'hq_coalition',
  },
  [FACTION.DOMINION]: {
    id: FACTION.DOMINION,
    key: 'dominion',
    name: 'Iron Dominion',
    short: 'Dominion',
    color: '#d0493f',
    hq: 'hq_dominion',
  },
  [FACTION.NONE]: { id: 0, key: 'neutral', name: 'Neutral', short: 'Neutral', color: '#a0a0a0' },
};

export function enemyOf(faction) {
  return faction === FACTION.COALITION ? FACTION.DOMINION : faction === FACTION.DOMINION ? FACTION.COALITION : FACTION.NONE;
}

export function areHostile(a, b) {
  return a !== FACTION.NONE && b !== FACTION.NONE && a !== b;
}

export const STANCE = { STAND: 0, CROUCH: 1, PRONE: 2 };

export const LIFE = { ALIVE: 0, DOWNED: 1, DEAD: 2 };

export const ENTITY = {
  SOLDIER: 1,
  VEHICLE: 2,
  PROJECTILE: 3,
  PROP: 4, // supply crates, rally points, destructible targets, ammo bags
};

export const PROP_KIND = {
  SUPPLY_CRATE: 1,
  RALLY_POINT: 2,
  AMMO_BAG: 3,
  TARGET: 4, // destructible mission target
  MEDKIT: 5,
  INTEL: 6, // recon observation point marker (client-only visual)
  CAPTIVE: 7,
};

// Character dimensions (metres).
export const BODY = {
  radius: 0.35,
  standHeight: 1.8,
  crouchHeight: 1.25,
  proneHeight: 0.55,
  eyeStand: 1.62,
  eyeCrouch: 1.1,
  eyeProne: 0.35,
  stepHeight: 0.62,
};

export const MOVE = {
  walk: 4.4,
  sprint: 7.0,
  crouch: 2.4,
  prone: 1.1,
  downed: 0.55,
  carryMult: 0.8,
  adsMult: 0.6,
  swimMult: 0.55,
  jumpVel: 5.2,
  gravity: 19,
  accelGround: 30,
  accelAir: 6,
};

export const STAMINA = {
  max: 100,
  sprintDrain: 16, // per second
  regen: 20,
  regenDelay: 0.9,
  jumpCost: 12,
  minToSprint: 12,
};

export const HEALTH = {
  max: 100,
  regenDelay: 8,
  regenRate: 4, // hp/sec
  regenCap: 70, // natural regen stops here; medics heal to full
  downedTime: 25,
  reviveHealth: 45,
  armorAbsorb: 0.55, // fraction of incoming damage absorbed by armor while it lasts
};

export const RESPAWN = {
  base: 5,
  afterDeathExtra: 3,
  squadCombatBlock: 6, // seconds since squad leader took damage that blocks spawning on them
  rallyLifetime: 600,
};

// Chat / radio channels.
export const RADIO = {
  COMMAND: 'command',
  SQUAD: 'squad',
  ORDER: 'order',
  INTEL: 'intel',
  SYSTEM: 'system',
  BASE: 'base',
};
