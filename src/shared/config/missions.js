// Mission templates. The mission director instantiates these from the live war state.

export const MISSION_TYPES = {
  capture: {
    id: 'capture', name: 'Capture', icon: '⚑', baseDifficulty: 2, time: 720, recRank: 1,
    titles: ['Capture {sector}', 'Seize {sector}', 'Take {sector}'],
    brief: 'Push into {territory} and take {sector} from the Dominion.',
  },
  defend: {
    id: 'defend', name: 'Defend', icon: '⛨', baseDifficulty: 2, time: 240, recRank: 1,
    titles: ['Defend {sector}', 'Hold the line at {sector}', 'Protect {sector}'],
    brief: 'Enemy forces are moving on {sector}. Hold it until the assault breaks.',
  },
  convoy: {
    id: 'convoy', name: 'Escort', icon: '⇄', baseDifficulty: 3, time: 540, recRank: 1,
    titles: ['Escort Supply Convoy to {territory}', 'Convoy Run: {territory}'],
    brief: 'A supply convoy is heading to {territory}. Keep at least one truck alive.',
  },
  destroy: {
    id: 'destroy', name: 'Sabotage', icon: '✸', baseDifficulty: 3, time: 720, recRank: 2,
    titles: ['Destroy the {target}', 'Sabotage {target} at {territory}'],
    targets: ['Artillery Battery', 'Radar Array', 'Fuel Depot', 'Comms Tower', 'Ammo Dump'],
    brief: 'Intel has located a {target} in {territory}. Destroy it with explosives.',
  },
  rescue: {
    id: 'rescue', name: 'Rescue', icon: '✚', baseDifficulty: 3, time: 540, recRank: 1,
    titles: ['Rescue Recon Team {callsign}', 'Recover Downed Crew near {sector}'],
    brief: 'Recon team {callsign} is pinned down near {sector}. Reach them and bring them home.',
  },
  secure: {
    id: 'secure', name: 'Secure', icon: '◉', baseDifficulty: 2, time: 480, recRank: 1,
    titles: ['Secure {place}', 'Clear {place}', 'Push Enemy Forces Back from {place}'],
    brief: 'Enemy infantry has dug in at {place}. Clear the area.',
  },
  hold: {
    id: 'hold', name: 'Hold', icon: '■', baseDifficulty: 3, time: 300, recRank: 2,
    titles: ['Hold the Bridge', 'Hold {place}', 'Dig in at {place}'],
    brief: 'Take up positions at {place} and hold for {minutes} minutes.',
  },
  recon: {
    id: 'recon', name: 'Recon', icon: '◈', baseDifficulty: 2, time: 600, recRank: 1,
    titles: ['Recon {territory}', 'Scout Enemy Positions at {territory}'],
    brief: 'Reach the observation points in {territory} and report enemy positions.',
  },
  supply: {
    id: 'supply', name: 'Logistics', icon: '▣', baseDifficulty: 1, time: 720, recRank: 1,
    titles: ['Deliver Supplies to {territory}', 'Resupply the {territory} Garrison'],
    brief: 'Collect supply crates at the depot and deliver them to the forward base in {territory}.',
  },
  vip: {
    id: 'vip', name: 'Protect', icon: '★', baseDifficulty: 3, time: 540, recRank: 2,
    titles: ['Protect Colonel {vip}', 'Escort Envoy {vip} to {territory}'],
    brief: '{vip} must reach the command post in {territory} alive.',
  },
};

export const CALLSIGNS = ['Viper', 'Ghost', 'Hammer', 'Raven', 'Saber', 'Nomad', 'Anvil', 'Falcon', 'Lancer', 'Warden'];
export const VIP_NAMES = ['Hale', 'Moreau', 'Kessler', 'Adeyemi', 'Lindqvist', 'Okafor', 'Varga', 'Castell'];
export const OPERATION_NAMES = ['Iron Tide', 'Northern Dawn', 'Steel Rain', 'Silent Anvil', 'Broken Arrow', 'Crimson Gate',
  'Thunder Road', 'Glass Harbor', 'Long Winter', 'Red Horizon'];

export const DIFFICULTY_NAMES = ['', 'Routine', 'Standard', 'Hard', 'Severe', 'Critical'];
