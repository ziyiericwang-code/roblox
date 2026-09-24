// Tunables for the world war simulation (two layers):
//   abstract layer  forces (battalions) move between territories and fight
//                   battles with strength numbers, everywhere, all the time
//   physical layer  near players, battles and garrisons become real soldiers,
//                   vehicles and objectives (see NPCSystem)
import { FACTION } from '../constants.js';

export const WAR = {
  // --- diplomacy
  initialWars: [[FACTION.ALDMARK, FACTION.KARSA], [FACTION.KARSA, FACTION.SERAVIA]],
  minWarMinutes: 35, // a war lasts at least this long before a ceasefire is possible
  ceasefireChancePerMin: 0.02, // after minWarMinutes, scaled by exhaustion
  peaceMaxMinutes: 7, // a country at peace this long starts a new war
  newWarChancePerMin: 0.004, // a country already at war opens a second front

  // --- forces
  battalionSize: 60,
  maxForceStrength: 140,
  forceSpeed: 4.5, // m/s along the territory graph (abstract marching speed)
  seaSpeedMult: 0.6,
  minGarrison: 25,
  countryCap: 1500, // total soldiers per country (abstract)
  recruitBase: 5, // soldiers per minute per country
  recruitPerValue: 0.9, // + per point of territory value held
  mobilizeBonus: 2.2, // recruit multiplier for a country in danger (few territories left)
  initialGarrison: { capital: 170, city: 110, port: 100, industrial: 100, military: 190, airbase: 120, mountain: 80, forest: 70, farmland: 70, desert: 80, canyon: 80, lakeside: 90, coastal: 80, island: 70, hills: 70 },
  hqReserve: 120,
  // battles already raging when a new world starts: [territory, attacker, strength]
  openingBattles: [['midvale', FACTION.KARSA, 170], ['kesh', FACTION.SERAVIA, 120]],

  // --- abstract battles
  battleTick: 5, // seconds
  lethality: 0.055, // casualties per minute per enemy soldier (effective)
  defenderBonus: 1.35,
  fortBonus: { capital: 1.3, military: 1.25, mountain: 1.2 },
  sectorRate: 2.2, // % per second at a 2:1 advantage (abstract sector capture)
  attackFailRatio: 0.4, // attacker gives up below this effective ratio
  attackFailFraction: 0.18, // ... or when below this fraction of its starting strength
  battleDamagePerMin: 0.8, // buildings damaged per minute in an abstract battle

  // --- physical layer
  liveRadius: 460, // a battle/garrison materialises when a player is within territory radius + this
  unliveDelay: 25, // seconds without players before it dematerialises again
  liveSquadsPerSide: 3,
  liveSquadsDefenderBonus: 0, // extra defender squads in live battles
  garrisonSquads: 2, // squads patrolling a quiet territory near players

  // --- AI commanders
  aiInterval: 20,
  maxOffensivesPerCountry: 2,
  attackRatio: 1.15, // attack when available strength exceeds (fortified) defence by this factor
  offensiveTempo: 180, // seconds without an offensive before the AI accepts worse odds
  frontGarrisonFactor: 0.9, // garrison wanted at a front = hostile strength next door x this

  // --- map commands (generals, colonels)
  mapCommandCooldown: 45,
  colonelRange: 1500, // colonels command targets within this distance of themselves
};

// Unit names: "3rd Aldmark Infantry Battalion".
export const FORCE_KINDS = {
  infantry: { name: 'Infantry Battalion', power: 1 },
  mech: { name: 'Mechanized Battalion', power: 1.2 },
  armor: { name: 'Armoured Regiment', power: 1.4 },
  guard: { name: 'Guards Battalion', power: 1.15 },
};

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
