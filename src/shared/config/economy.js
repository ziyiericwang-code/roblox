// Experience & credit economy. Objective play is rewarded far more than kills.

export const XP = {
  kill: 12,
  killInObjective: 26, // kill while attacking/defending an active objective
  assist: 6,
  headshotBonus: 4,
  downEnemy: 0, // downing counts as a kill for NPCs; players get the kill when confirmed
  vehicleDestroyed: 90,
  captureTick: 4, // per 2s while actively capturing
  sectorCaptured: 120,
  territoryCaptured: 260,
  defendTick: 3, // per 4s inside a contested friendly sector
  defendKill: 22,
  defendSuccess: 140,
  revive: 55,
  healPer10: 2,
  resupply: 12,
  repairPer50: 3,
  spotAssist: 5,
  spotted: 1,
  targetDestroyed: 160,
  supplyDelivered: 110,
  reconPoint: 70,
  rescue: 90,
  escortTick: 3,
  orderComplianceTick: 3, // per 10s while carrying out an order
  servicePayPerMin: 6,
  trainingStep: 60,
  trainingComplete: 400,
  squadBonus: 0.1, // +10% while playing near squadmates
  missionBase: [0, 320, 460, 620, 820, 1050], // by difficulty 1..5
  missionFailParticipation: 70,
  operationSuccess: 900,
  campaignVictory: 2000,
};

export const CREDITS = {
  missionBase: [0, 60, 85, 115, 150, 200],
  sectorCaptured: 15,
  territoryCaptured: 45,
  perServiceMinute: 1,
  promotionPerRank: 120,
  revive: 3,
  operationSuccess: 250,
  campaignVictory: 800,
};

// Leadership: leaders earn LP from what the people they lead achieve.
export const LEADERSHIP = {
  perMemberObjectiveXp: 1 / 40, // LP per objective XP earned by squad members following orders
  squadMissionComplete: 6,
  orderCompliance: 0.25, // per member per compliance tick
  officerUnitsCapture: 4, // per sector captured by units under your active order
  maxPerMinute: 30,
};

// Anti kill-farming: kills outside objectives decay after a burst.
export const KILL_FARM = {
  window: 300,
  freeKills: 8,
  decayedMult: 0.25,
};

// Performance rating: rolling average of per-deployment score (0-100).
export const RATING = {
  alpha: 0.15, // EMA weight of the latest deployment
  minDeploySeconds: 45,
  objectiveXpPerMinFor100: 180,
};
