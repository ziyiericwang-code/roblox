// Medals & awards. Each medal tracks one career stat and has bronze/silver/gold tiers.
// Thresholds are chosen so that normal play naturally earns them over time;
// different medals reward different play styles (medic, engineer, leader, recon...).

export const MEDAL_TIERS = ['Bronze', 'Silver', 'Gold'];

export const MEDALS = [
  { id: 'basic_training', name: 'Basic Training Ribbon', stat: 'training', tiers: [1], ribbon: ['#3d6b35', '#e8d9a0', '#3d6b35'],
    desc: 'Completed basic training at Fort Sentinel.' },
  { id: 'combat_service', name: 'Combat Service Medal', stat: 'battles', tiers: [5, 25, 80], ribbon: ['#7a2a24', '#d7b04a', '#7a2a24'],
    desc: 'Fought in sustained battles on the front line.' },
  { id: 'defense', name: 'Defense Medal', stat: 'defends', tiers: [10, 60, 200], ribbon: ['#274a78', '#c9c9c9', '#274a78'],
    desc: 'Held friendly objectives against enemy assaults.' },
  { id: 'liberation', name: 'Liberation Medal', stat: 'territories', tiers: [1, 8, 30], ribbon: ['#2e6b5a', '#f2e6c2', '#b33a3a'],
    desc: 'Took part in capturing enemy territories.' },
  { id: 'leadership', name: 'Leadership Medal', stat: 'leadership', tiers: [40, 400, 1600], ribbon: ['#4b2e6b', '#d7b04a', '#4b2e6b'],
    desc: 'Led soldiers to success.' },
  { id: 'valor', name: 'Valor Medal', stat: 'valor', tiers: [1, 5, 15], ribbon: ['#1f3a6b', '#ffffff', '#b33a3a'],
    desc: 'Held an objective while heavily outnumbered, or revived comrades under fire.' },
  { id: 'medical', name: 'Medical Service Medal', stat: 'revives', tiers: [10, 75, 250], ribbon: ['#b33a3a', '#ffffff', '#b33a3a'],
    desc: 'Brought fallen soldiers back into the fight.' },
  { id: 'engineer', name: 'Engineering Commendation', stat: 'repairs', tiers: [20, 200, 800], ribbon: ['#8a6d2f', '#2b2b2b', '#8a6d2f'],
    desc: 'Repaired vehicles and destroyed enemy targets.' },
  { id: 'logistics', name: 'Logistics Medal', stat: 'supplies', tiers: [10, 60, 200], ribbon: ['#5b4a2e', '#c2a060', '#5b4a2e'],
    desc: 'Kept the front supplied with ammunition and materiel.' },
  { id: 'recon', name: 'Reconnaissance Medal', stat: 'spots', tiers: [25, 200, 800], ribbon: ['#2b4d2b', '#9fb88a', '#2b4d2b'],
    desc: 'Spotted enemy forces and gathered intelligence.' },
  { id: 'marksman', name: 'Marksmanship Badge', stat: 'rangeBest', tiers: [6, 8, 10], ribbon: ['#3a3a3a', '#d7d7d7', '#3a3a3a'],
    desc: 'Scored on the qualification range (hits out of 10).' },
  { id: 'wound', name: 'Wound Ribbon', stat: 'revived', tiers: [5, 40, 150], ribbon: ['#5a1f5a', '#ffffff', '#5a1f5a'],
    desc: 'Wounded in action and returned to duty.' },
  { id: 'campaign', name: 'Campaign Medal', stat: 'campaigns', tiers: [1, 3, 8], ribbon: ['#b8862b', '#1f3a6b', '#b8862b'],
    desc: 'Served in a victorious campaign.' },
  { id: 'operations', name: 'Operations Star', stat: 'operations', tiers: [1, 5, 15], ribbon: ['#20364f', '#d7b04a', '#20364f'],
    desc: 'Took part in successful combined operations.' },
  { id: 'officer_service', name: 'Officer Service Medal', stat: 'officerService', tiers: [60, 600, 2400], ribbon: ['#1c2a3a', '#b8862b', '#1c2a3a'],
    desc: 'Minutes served as a commissioned officer.' },
  { id: 'long_service', name: 'Long Service Medal', stat: 'service', tiers: [300, 1500, 6000], ribbon: ['#3a5a3a', '#e0e0e0', '#3a5a3a'],
    desc: 'Minutes of service to the Coalition.' },
];

export const MEDAL_BY_ID = Object.fromEntries(MEDALS.map((m) => [m.id, m]));

export const MEDAL_REWARDS = [
  { xp: 150, credits: 100 },
  { xp: 450, credits: 300 },
  { xp: 1200, credits: 800 },
];

// Returns the tier index (0..n-1) reached for a value, or -1.
export function medalTierFor(medal, value) {
  let tier = -1;
  for (let i = 0; i < medal.tiers.length; i++) if (value >= medal.tiers[i]) tier = i;
  return tier;
}
