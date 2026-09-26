// Buildings, costs and economic constants. Money is in $bn; costs are paid up front.

export const BUILDINGS = {
  fort: { name: 'Fortification', max: 5, cost: 0.4, materials: 2, turns: 2, rank: 2, cap: 'fortify1', text: '+10% defense per level; artillery wears it down.' },
  infra: { name: 'Infrastructure', max: 5, cost: 1.2, materials: 4, turns: 3, rank: 16, cap: 'repair', text: 'Faster movement, more supply capacity and output.' },
  rail: { name: 'Rail', max: 3, cost: 2.5, materials: 8, turns: 4, rank: 42, cap: 'strategicBuild', text: 'Moves supply far and fast; enables rail redeployment.' },
  depot: { name: 'Field Depot', max: 1, cost: 0.3, materials: 1, turns: 1, rank: 15, cap: 'depot', text: 'A forward supply source (weaker than a hub).' },
  hub: { name: 'Logistics Hub', max: 2, cost: 1.5, materials: 5, turns: 3, rank: 27, cap: 'hub', text: 'A strong supply source for nearby forces.' },
  armyBase: { name: 'Army Base', max: 3, cost: 1.5, materials: 5, turns: 3, rank: 32, cap: 'armyBase', text: 'Recruitment site; faster reinforcement and recovery.' },
  airbase: { name: 'Airbase', max: 3, cost: 2.0, materials: 6, turns: 3, rank: 34, cap: 'airbase', text: 'Projects air power over the surrounding area.' },
  port: { name: 'Naval Base', max: 3, cost: 3.0, materials: 10, turns: 4, rank: 42, cap: 'strategicBuild', text: 'Sea supply, fleet basing and amphibious staging.' },
  radar: { name: 'Radar / Intel Site', max: 2, cost: 0.8, materials: 2, turns: 2, rank: 29, cap: 'radar', text: 'Reveals enemy movement within 3 provinces.' },
  command: { name: 'Command Center', max: 1, cost: 2.0, materials: 4, turns: 3, rank: 28, cap: 'hub', text: 'Extends your operational area; faster recovery.' },
  civ: { name: 'Civilian Industry', max: 10, cost: 3.0, materials: 10, turns: 5, rank: 46, cap: 'production', text: 'Economic output and construction capacity.' },
  mil: { name: 'Military Industry', max: 10, cost: 3.5, materials: 12, turns: 5, rank: 46, cap: 'production', text: 'Industrial capacity for equipment production.' },
};
export const BUILDING_KEYS = Object.keys(BUILDINGS);

export const MOBILIZATION = [
  { name: 'Volunteer', manpower: 0.004, industry: 1.0, stability: 0 },
  { name: 'Limited', manpower: 0.012, industry: 0.97, stability: -2 },
  { name: 'Extensive', manpower: 0.03, industry: 0.9, stability: -6 },
  { name: 'Total War', manpower: 0.06, industry: 0.8, stability: -12 },
];

// Weekly revenue share of GDP (GDP is annual $M) by government income group
export const REVENUE_RATE = 0.28 / 52;
export const UPKEEP_PER_ELEMENT = 0.00035; // $bn per element per week
export const IC_PER_GDP = 1 / 25000; // industrial capacity points per $M GDP (military share applies)
export const REFUND = 0.75;
