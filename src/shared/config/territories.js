// Fictional theatre of war. Coordinates in metres: +x east, +z south (north is -z).
import { FACTION } from '../constants.js';

// Sector offsets are relative to the territory centre. The first sector hosts the
// command post (a spawn point while held and not contested).
export const TERRITORIES = [
  {
    id: 'hq_coalition', name: 'Fort Sentinel', short: 'Sentinel', biome: 'base', isBase: true,
    center: [-490, 600], radius: 125, initialOwner: FACTION.COALITION, value: 0,
    adjacent: ['harbor', 'iron_valley'], sectors: [],
    blurb: 'Coalition headquarters, airfield and training grounds.',
  },
  {
    id: 'harbor', name: 'Harbor District', short: 'Harbor', biome: 'harbor',
    center: [-585, 215], radius: 125, initialOwner: FACTION.COALITION, value: 2,
    adjacent: ['hq_coalition', 'westport', 'iron_valley'],
    sectors: [
      { id: 'A', name: 'Harbor Command', off: [30, 20] },
      { id: 'B', name: 'Container Yard', off: [-55, -45] },
      { id: 'C', name: 'Dry Docks', off: [-70, 70] },
    ],
    blurb: 'Deep water docks feeding the western front.',
  },
  {
    id: 'westport', name: 'Westport', short: 'Westport', biome: 'coastal',
    center: [-555, -215], radius: 125, initialOwner: FACTION.DOMINION, value: 1,
    adjacent: ['harbor', 'black_ridge', 'capital'],
    sectors: [
      { id: 'A', name: 'Town Hall', off: [10, 0] },
      { id: 'B', name: 'Lighthouse Point', off: [-85, -50] },
      { id: 'C', name: 'Fishery Row', off: [-60, 65] },
    ],
    blurb: 'Coastal town guarding the road to Black Ridge.',
  },
  {
    id: 'iron_valley', name: 'Iron Valley', short: 'Iron Valley', biome: 'industrial',
    center: [-120, 175], radius: 135, initialOwner: FACTION.COALITION, value: 2,
    adjacent: ['hq_coalition', 'harbor', 'capital', 'eastreach', 'red_canyon'],
    sectors: [
      { id: 'A', name: 'Foundry', off: [-20, 10] },
      { id: 'B', name: 'Rail Yard', off: [-70, -70] },
      { id: 'C', name: 'River Bridge', off: [85, 55] },
    ],
    blurb: 'Factories and rail yards along the river. The heart of the war economy.',
  },
  {
    id: 'red_canyon', name: 'Red Canyon', short: 'Red Canyon', biome: 'canyon',
    center: [430, 470], radius: 135, initialOwner: FACTION.COALITION, value: 1,
    adjacent: ['iron_valley', 'eastreach'],
    sectors: [
      { id: 'A', name: 'Canyon Outpost', off: [0, 0] },
      { id: 'B', name: 'Mesa Relay', off: [70, -65] },
      { id: 'C', name: 'Dry Riverbed', off: [-75, 55] },
    ],
    blurb: 'Winding canyon passes and a radio relay atop the mesa.',
  },
  {
    id: 'eastreach', name: 'Eastreach', short: 'Eastreach', biome: 'farmland',
    center: [470, 55], radius: 135, initialOwner: FACTION.DOMINION, value: 1,
    adjacent: ['iron_valley', 'red_canyon', 'capital', 'northland'],
    sectors: [
      { id: 'A', name: 'Village Square', off: [0, 0] },
      { id: 'B', name: 'Grain Silos', off: [75, -60] },
      { id: 'C', name: 'Old Mill', off: [-70, 65] },
    ],
    blurb: 'Farm villages and fields on the eastern plains.',
  },
  {
    id: 'capital', name: 'Capital Zone', short: 'Capital', biome: 'city',
    center: [45, -265], radius: 155, initialOwner: FACTION.DOMINION, value: 3,
    adjacent: ['westport', 'iron_valley', 'eastreach', 'black_ridge', 'northland'],
    sectors: [
      { id: 'A', name: 'Parliament Square', off: [20, 0] },
      { id: 'B', name: 'Central Station', off: [-35, 85] },
      { id: 'C', name: 'Market Quarter', off: [95, -60] },
    ],
    blurb: 'The capital city. Whoever holds it holds the war.',
  },
  {
    id: 'black_ridge', name: 'Black Ridge', short: 'Black Ridge', biome: 'mountain',
    center: [-370, -555], radius: 125, initialOwner: FACTION.DOMINION, value: 2,
    adjacent: ['westport', 'capital', 'hq_dominion'],
    sectors: [
      { id: 'A', name: 'Ridge Fortress', off: [0, 0] },
      { id: 'B', name: 'Radar Station', off: [-60, -60] },
      { id: 'C', name: 'Pass Checkpoint', off: [75, 45] },
    ],
    blurb: 'Fortified mountain pass overlooking the capital.',
  },
  {
    id: 'northland', name: 'Northland', short: 'Northland', biome: 'forest',
    center: [430, -470], radius: 135, initialOwner: FACTION.DOMINION, value: 1,
    adjacent: ['capital', 'eastreach', 'hq_dominion'],
    sectors: [
      { id: 'A', name: 'Timber Camp', off: [0, 0] },
      { id: 'B', name: 'Frozen Lake', off: [-75, -55] },
      { id: 'C', name: 'Hunter Lodge', off: [70, 60] },
    ],
    blurb: 'Cold northern forests, sawmills and hunting lodges.',
  },
  {
    id: 'hq_dominion', name: 'Kastor Citadel', short: 'Kastor', biome: 'base', isBase: true,
    center: [140, -655], radius: 120, initialOwner: FACTION.DOMINION, value: 0,
    adjacent: ['black_ridge', 'northland'], sectors: [],
    blurb: 'Dominion stronghold in the northern highlands.',
  },
];

export const TERRITORY_BY_ID = Object.fromEntries(TERRITORIES.map((t) => [t.id, t]));

export const SECTOR_RADIUS = 22;

// River centre line (used by terrain, roads and bridges).
export const RIVER_PATH = [
  [60, -820], [30, -600], [-30, -420], [-28, -250], [-45, -80], [-15, 80], [-30, 240],
  [-110, 380], [-280, 455], [-450, 425], [-620, 445], [-820, 455],
];
export const RIVER_WIDTH = 26;

// West coast: land ends roughly here (x), perturbed by noise.
export const COAST_X = -690;

// Road network. Each entry is a pair of anchor ids; anchors are territory ids or
// explicit junctions. The generator curves and flattens them.
export const ROAD_JUNCTIONS = {
  j_south: [-300, 560],
  j_mid: [180, 120],
  j_north: [150, -470],
  j_west: [-420, -40],
};

export const ROAD_LINKS = [
  ['hq_coalition', 'harbor'],
  ['hq_coalition', 'j_south'],
  ['j_south', 'iron_valley'],
  ['j_south', 'red_canyon'],
  ['harbor', 'iron_valley'],
  ['harbor', 'j_west'],
  ['j_west', 'westport'],
  ['j_west', 'capital'],
  ['westport', 'black_ridge'],
  ['iron_valley', 'j_mid'],
  ['j_mid', 'eastreach'],
  ['j_mid', 'capital'],
  ['red_canyon', 'eastreach'],
  ['eastreach', 'northland'],
  ['capital', 'j_north'],
  ['j_north', 'northland'],
  ['j_north', 'hq_dominion'],
  ['black_ridge', 'hq_dominion'],
  ['black_ridge', 'capital'],
];

export function anchorPos(id) {
  const t = TERRITORY_BY_ID[id];
  if (t) return t.center;
  return ROAD_JUNCTIONS[id];
}
