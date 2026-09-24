// Global constants shared by client and simulation.

export const GAME_NAME = 'Frontline Command';
export const PROTOCOL_VERSION = 3;

export const WORLD_SEED = 1947;
export const WORLD_HALF = 3072; // world spans [-3072, 3072] metres on x and z (6.1 km)
export const SEA_LEVEL = 0;

export const TICK_RATE = 20; // simulation ticks per second
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 20;
export const INTEREST_RADIUS = 480; // metres; entities beyond this are not replicated (vehicles: further)

// Countries. Every country fields an army of players and NPCs; wars between
// pairs of countries start and end over time (see WarSystem).
export const FACTION = {
  NONE: 0,
  ALDMARK: 1,
  KARSA: 2,
  SERAVIA: 3,
};
export const COUNTRY_IDS = [FACTION.ALDMARK, FACTION.KARSA, FACTION.SERAVIA];

export const FACTION_INFO = {
  [FACTION.ALDMARK]: {
    id: FACTION.ALDMARK,
    key: 'aldmark',
    name: 'Republic of Aldmark',
    short: 'Aldmark',
    adj: 'Aldmarkian',
    army: 'Aldmark Defence Force',
    color: '#4f86d9',
    dark: '#23406b',
    hq: 'hq_aldmark',
    capital: 'aldhaven',
    motto: 'Steadfast in the north wind.',
    blurb: 'Temperate west and north: forests, the Greymoor highlands and the port of Wexley.',
  },
  [FACTION.KARSA]: {
    id: FACTION.KARSA,
    key: 'karsa',
    name: 'Karsan Federation',
    short: 'Karsa',
    adj: 'Karsan',
    army: 'Karsan Army',
    color: '#d24a3c',
    dark: '#6b231d',
    hq: 'hq_karsa',
    capital: 'kharan',
    motto: 'Iron, sand and will.',
    blurb: 'The industrial and military east: mountains, canyons and the Ashar desert.',
  },
  [FACTION.SERAVIA]: {
    id: FACTION.SERAVIA,
    key: 'seravia',
    name: 'Seravian Union',
    short: 'Seravia',
    adj: 'Seravian',
    army: 'Seravian Guard',
    color: '#e0a33a',
    dark: '#6e4d17',
    hq: 'hq_seravia',
    capital: 'seralis',
    motto: 'The sea remembers.',
    blurb: 'The fertile south: lake Mera, farmland, the coast and the islands.',
  },
  [FACTION.NONE]: { id: 0, key: 'neutral', name: 'Neutral', short: 'Neutral', adj: 'Neutral', army: '', color: '#a0a0a0', dark: '#555555' },
};

// ---------------------------------------------------------------- hostility
// Which countries are currently at war. Owned by the WarSystem on the server
// and mirrored from the war state on clients. Default: no wars.
const WAR_MASK = new Uint8Array(4); // bit f set in WAR_MASK[g] when g and f are at war

export function setWars(pairs) {
  WAR_MASK.fill(0);
  for (const [a, b] of pairs) {
    WAR_MASK[a] |= 1 << b;
    WAR_MASK[b] |= 1 << a;
  }
}

export function areHostile(a, b) {
  return a > 0 && b > 0 && a !== b && (WAR_MASK[a] & (1 << b)) !== 0;
}

// Countries at war with `f`.
export function enemiesOf(f) {
  const out = [];
  for (const g of COUNTRY_IDS) if (areHostile(f, g)) out.push(g);
  return out;
}

// Main enemy (first country at war with f), or NONE.
export function enemyOf(f) {
  return enemiesOf(f)[0] || FACTION.NONE;
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
