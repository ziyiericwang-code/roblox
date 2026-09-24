// Global tunables for the simulation. Adjust here to rebalance pacing and performance.

export const GAME = {
  // --- AI / battles
  npcCap: 90, // hard cap on combat NPCs (adaptive: reduced automatically when ticks run long)
  npcCapMin: 24,
  ambientNpcCap: 26,
  squadSize: 5,
  maxBattles: 2, // simultaneously simulated front-line battles
  battleSquadsPerSide: 3,
  reinforceInterval: 38, // seconds between AI reinforcement checks per battle
  aiThinkInterval: 0.25,
  aiFarThinkInterval: 1.2,
  aiLightThinkInterval: 3,
  aiNearPlayerRadius: 170, // full simulation level
  aiMidRadius: 420, // reduced level; beyond: light
  aiPathBudgetPerTick: 3,
  aiDetectRange: 115,
  aiAccuracy: 0.55,

  // --- war
  captureTime: 26, // seconds for one soldier to flip a neutral sector
  captureMaxRate: 4, // attacker advantage cap
  territoryStateHold: 90, // seconds 'captured'/'liberated' label persists
  warSaveInterval: 45,
  campaignResetDelay: 90,
  supplyDecayPerMin: 0.6,

  // --- missions & events
  missionTarget: 5,
  missionMax: 7,
  eventMinInterval: 150,
  eventMaxInterval: 330,
  maxConcurrentEvents: 2,

  // --- world
  dayLengthSec: 1440, // 24 minutes per in-game day
  startClock: 9.0,

  // --- players
  maxPlayers: 32,
  saveInterval: 60,
  combatTimeout: 10,
  bleedoutTime: 25,
};
