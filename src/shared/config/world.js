// The world of Frontline Command: three countries on one 6 km continent.
// Coordinates are metres: +x east, +z south (north is -z). The generator in
// shared/world/ turns this description into terrain, towns, bases and roads;
// everything here is authored so the world has a reason for every region.
import { FACTION } from '../constants.js';

const A = FACTION.ALDMARK;
const K = FACTION.KARSA;
const S = FACTION.SERAVIA;

// ------------------------------------------------------------------ territories
// Every territory is a region of a country (the map is split between them by
// nearest centre). Its main settlement sits at the centre and holds three
// capture objectives (sectors); the first sector hosts the command post.
//   type:   what gets built (capital, city, port, industrial, mountain, forest,
//           farmland, desert, canyon, lakeside, coastal, island, military, airbase, hills)
//   value:  strategic weight (AI targeting, victory score)
//   radius: size of the battle area around the centre
export const TERRITORIES = [
  // ------------------------------------------------ Aldmark (west / north-west)
  {
    id: 'aldhaven', name: 'Aldhaven', country: A, type: 'capital', center: [-1650, -650], radius: 240, value: 5,
    sectors: [['A', 'Parliament Square', [10, -20]], ['B', 'Aldhaven Central Station', [-120, 110]], ['C', 'Old Market', [130, 90]]],
    blurb: 'Capital of Aldmark. Parliament, the central station and the old market district.',
  },
  {
    id: 'northgate', name: 'Northgate', country: A, type: 'city', center: [-900, -1850], radius: 210, value: 3,
    sectors: [['A', 'Northgate Town Hall', [0, 0]], ['B', 'Northgate Rail Yard', [-110, 90]], ['C', 'Pass Road Bridge', [120, -80]]],
    blurb: 'Northern city at the foot of the Greymoor highlands, guarding the mountain pass.',
  },
  {
    id: 'wexley', name: 'Port Wexley', country: A, type: 'port', center: [-2480, 220], radius: 220, value: 3,
    sectors: [['A', 'Harbour Master', [60, 0]], ['B', 'Container Terminal', [-40, -110]], ['C', 'Naval Docks', [-30, 120]]],
    blurb: 'The western deep-water port. Every Aldmark supply ship docks here.',
  },
  {
    id: 'greymoor', name: 'Greymoor Highlands', country: A, type: 'mountain', center: [-2080, -2300], radius: 220, value: 2,
    sectors: [['A', 'Greymoor Fortress', [0, 0]], ['B', 'Highland Radar', [-110, -70]], ['C', 'Greymoor Bunker', [110, 60]]],
    blurb: 'Snow-capped highlands. A mountain fortress and an underground command bunker.',
  },
  {
    id: 'emberfield', name: 'Emberfield', country: A, type: 'industrial', center: [-760, -960], radius: 220, value: 3,
    sectors: [['A', 'Ember Foundry', [0, 0]], ['B', 'Emberfield Rail Depot', [-120, -60]], ['C', 'Varn Crossing', [140, 60]]],
    blurb: 'Foundries and rail depots along the river Varn. The arsenal of Aldmark.',
  },
  {
    id: 'hollin', name: 'Hollin Forest', country: A, type: 'forest', center: [-2150, -1250], radius: 210, value: 1,
    sectors: [['A', 'Hollin Sawmill', [0, 0]], ['B', 'Ranger Station', [-100, -80]], ['C', 'Hollin Lake Camp', [-40, 170]]],
    blurb: 'Dense pine forest, logging camps and narrow tracks. Ambush country.',
  },
  {
    id: 'westmarch', name: 'Westmarch', country: A, type: 'airbase', center: [-1750, 920], radius: 230, value: 3,
    sectors: [['A', 'Westmarch Village', [120, -40]], ['B', 'Westmarch Airport', [-80, 80]], ['C', 'Grain Co-op', [70, 140]]],
    blurb: 'Farm valley with the national airport. Transport flights leave from here.',
  },
  {
    id: 'rook', name: 'Rook Garrison', country: A, type: 'military', center: [-1000, -180], radius: 210, value: 3,
    sectors: [['A', 'Garrison Command', [0, 0]], ['B', 'Rook Artillery Park', [-100, 80]], ['C', 'East Trenches', [130, -40]]],
    blurb: 'Aldmark regional headquarters facing the Karsan border. Colonels plan the eastern front here.',
  },
  // ------------------------------------------------ centre
  {
    id: 'midvale', name: 'Midvale', country: A, type: 'city', center: [160, -150], radius: 230, value: 4,
    sectors: [['A', 'Midvale Square', [0, 0]], ['B', 'Midvale Junction', [-120, 90]], ['C', 'Metro Station', [120, 70]]],
    blurb: 'Crossroads city where the three borders meet. Railway junction of the continent.',
  },
  // ------------------------------------------------ Karsa (east / north-east)
  {
    id: 'kharan', name: 'Kharan', country: K, type: 'capital', center: [1900, -650], radius: 240, value: 5,
    sectors: [['A', 'Federal Palace', [0, -10]], ['B', 'Kharan Grand Station', [120, 110]], ['C', 'Foundry Quarter', [-130, 90]]],
    blurb: 'Capital of the Karsan Federation. Broad avenues, the Federal Palace and the grand station.',
  },
  {
    id: 'tarsk', name: 'Tarsk', country: K, type: 'city', center: [2560, 420], radius: 210, value: 3,
    sectors: [['A', 'Tarsk Citadel', [0, 0]], ['B', 'Tarsk Bazaar', [-110, 80]], ['C', 'East Gate', [110, -80]]],
    blurb: 'Eastern city on the edge of the desert. An old walled citadel above the bazaar.',
  },
  {
    id: 'redstone', name: 'Redstone Garrison', country: K, type: 'military', center: [1080, -330], radius: 210, value: 3,
    sectors: [['A', 'Redstone Command', [0, 0]], ['B', 'Tank Depot', [110, 80]], ['C', 'West Bunkers', [-130, -40]]],
    blurb: 'Karsan regional headquarters. The armoured fist aimed at Midvale.',
  },
  {
    id: 'ashar', name: 'Ashar Desert', country: K, type: 'desert', center: [2050, 1600], radius: 230, value: 2,
    sectors: [['A', 'Ashar Outpost', [0, 0]], ['B', 'Oil Field', [-120, -80]], ['C', 'Dune Radar', [120, 100]]],
    blurb: 'Open desert, oil derricks and a lonely outpost. Long sight lines and nowhere to hide.',
  },
  {
    id: 'volk', name: 'Volk Works', country: K, type: 'industrial', center: [1380, -1700], radius: 220, value: 3,
    sectors: [['A', 'Volk Steelworks', [0, 0]], ['B', 'Mine Head', [-110, -90]], ['C', 'Kesh Dam', [120, 70]]],
    blurb: 'Steelworks and mines under the northern range, powered by the Kesh dam.',
  },
  {
    id: 'torkarsa', name: 'Tor Karsa', country: K, type: 'mountain', center: [2420, -2250], radius: 220, value: 2,
    sectors: [['A', 'Tor Monastery', [0, 0]], ['B', 'Summit Relay', [110, -70]], ['C', 'Tor Mountain Bunker', [-110, 70]]],
    blurb: 'Frozen peaks, a mountain monastery and a bunker cut into the rock.',
  },
  {
    id: 'kesh', name: 'Kesh Canyon', country: K, type: 'canyon', center: [1250, 760], radius: 220, value: 2,
    sectors: [['A', 'Canyon Outpost', [0, 0]], ['B', 'Mesa Relay', [110, -80]], ['C', 'Dry Riverbed', [-110, 80]]],
    blurb: 'Red mesas and winding canyons along the lower Kesh.',
  },
  {
    id: 'khar_air', name: 'Khar Airfield', country: K, type: 'airbase', center: [2560, -1300], radius: 230, value: 3,
    sectors: [['A', 'Khar Terminal', [80, -40]], ['B', 'Hangar Row', [-90, 80]], ['C', 'Fuel Farm', [110, 120]]],
    blurb: 'The main Karsan airbase. Fighters and transports fly from here.',
  },
  // ------------------------------------------------ Seravia (south)
  {
    id: 'seralis', name: 'Seralis', country: S, type: 'capital', center: [-230, 2450], radius: 240, value: 5,
    sectors: [['A', 'Royal Assembly', [0, -10]], ['B', 'Seralis Station', [-130, -110]], ['C', 'Harbour Quarter', [120, 110]]],
    blurb: 'Capital of the Seravian Union at the mouth of the Varn.',
  },
  {
    id: 'calda', name: 'Port Calda', country: S, type: 'port', center: [-1620, 2380], radius: 220, value: 3,
    sectors: [['A', 'Calda Customs House', [60, -30]], ['B', 'Fishing Harbour', [-40, 110]], ['C', 'Shipyard', [-60, -120]]],
    blurb: 'The south coast port and shipyard. Ferries run to Saint Iva.',
  },
  {
    id: 'mera', name: 'Meradin', country: S, type: 'lakeside', center: [640, 1000], radius: 220, value: 3,
    sectors: [['A', 'Meradin Harbour', [0, 40]], ['B', 'Lakeside Villas', [-120, -40]], ['C', 'Meradin Bridge', [130, -40]]],
    blurb: 'Lake town on the north shore of Lake Mera, facing the Karsan canyons.',
  },
  {
    id: 'oriel', name: 'Oriel Plains', country: S, type: 'farmland', center: [-1080, 1350], radius: 230, value: 2,
    sectors: [['A', 'Oriel Village', [0, 0]], ['B', 'Grain Silos', [110, -80]], ['C', 'Old Mill', [-110, 80]]],
    blurb: 'Wheat fields and farm villages. The breadbasket of the south.',
  },
  {
    id: 'vesna', name: 'Vesna Coast', country: S, type: 'coastal', center: [1100, 2600], radius: 220, value: 2,
    sectors: [['A', 'Vesna Town', [0, -20]], ['B', 'Lighthouse Point', [120, 80]], ['C', 'Beach Fortifications', [-110, 90]]],
    blurb: 'Beaches, a lighthouse and old coastal forts facing the Karsan desert.',
  },
  {
    id: 'saint_iva', name: 'Saint Iva', country: S, type: 'island', center: [-2350, 2830], radius: 200, value: 2,
    sectors: [['A', 'Iva Naval Base', [0, 0]], ['B', 'Coastal Battery', [-90, -70]], ['C', 'Fishing Village', [90, 70]]],
    blurb: 'Island naval base off the south-west coast. Reachable only by boat or helicopter.',
  },
  {
    id: 'tallow', name: 'Tallow Hills', country: S, type: 'hills', center: [230, 640], radius: 210, value: 2,
    sectors: [['A', 'Camp Tallow', [0, 0]], ['B', 'Hilltop Observation Post', [-110, -80]], ['C', 'Tallow Crossroads', [110, 80]]],
    blurb: 'Rolling hills and the Seravian regional headquarters covering the northern border.',
  },
];

// Country headquarters: large bases that can never be captured. High Command
// sits here, recruits train here and every soldier can always deploy here.
export const HQ_BASES = [
  { id: 'hq_aldmark', name: 'Fort Aldric', country: A, center: [-2130, -560], rot: 3, region: 'aldhaven', blurb: 'Aldmark army headquarters and High Command.' },
  { id: 'hq_karsa', name: 'Kharan Citadel', country: K, center: [2360, -880], rot: 1, region: 'kharan', blurb: 'Karsan army headquarters and High Command.' },
  { id: 'hq_seravia', name: 'Fort Valor', country: S, center: [300, 2440], rot: 0, region: 'seralis', blurb: 'Seravian army headquarters and High Command.' },
];

export const SECTOR_RADIUS = 22;

// ------------------------------------------------------------------ geography
// Rivers (centre lines, west to east / source to mouth). Widths in metres.
export const RIVERS = [
  {
    id: 'varn', name: 'River Varn', width: 34,
    path: [[-780, -2520], [-700, -1800], [-560, -1180], [-420, -560], [-160, -60], [-120, 380], [-380, 980], [-560, 1450], [-640, 1980], [-560, 2500], [-520, 3100]],
  },
  {
    id: 'kesh', name: 'River Kesh', width: 26,
    path: [[1560, -2380], [1400, -1640], [1150, -900], [900, -120], [760, 560], [640, 1150]],
  },
  {
    id: 'mera_channel', name: 'Mera Channel', width: 22,
    path: [[240, 1480], [-60, 1520], [-330, 1480], [-520, 1420]],
  },
];

// Lakes sit at sea level (the water plane is shared).
export const LAKES = [
  { id: 'mera', name: 'Lake Mera', center: [640, 1470], radius: [520, 330], depth: 7, islands: [{ center: [800, 1480], r: 85 }] },
  { id: 'hollin_lake', name: 'Hollin Lake', center: [-2330, -1080], radius: [120, 85], depth: 5, islands: [] },
];

// Coastlines: the west sea and the south sea (x/z where land ends, before noise).
export const COAST = {
  west: [[-3100, -2400], [-2780, -1900], [-2700, -1000], [-2760, -300], [-2600, 80], [-2560, 420], [-2720, 800], [-2780, 1600], [-2700, 2200]],
  south: [[-2700, 2200], [-2000, 2620], [-1300, 2700], [-600, 2760], [200, 2800], [800, 2780], [1400, 2860], [1900, 3000], [2200, 3120]],
};

// Islands in the sea.
export const ISLANDS = [
  { id: 'saint_iva', center: [-2350, 2830], radius: [290, 205], height: 26 },
  { id: 'gull_rock', center: [-2880, 2480], radius: [90, 70], height: 14 },
  { id: 'wexley_holm', center: [-2980, 380], radius: [110, 80], height: 18 },
];

// Mountain ranges as ridge lines: each point [x, z, peakHeight].
export const RANGES = [
  { id: 'greymoor', width: 620, pts: [[-3100, -2180, 170], [-2500, -2420, 230], [-2000, -2640, 260], [-1450, -2760, 240], [-980, -2900, 200]] },
  { id: 'karsa_north', width: 640, pts: [[520, -3000, 190], [1150, -2700, 250], [1800, -2560, 280], [2400, -2480, 300], [3100, -2280, 260]] },
  { id: 'east_wall', width: 420, pts: [[3100, -2000, 220], [3150, -800, 150], [3200, 400, 120]] },
  { id: 'divide', width: 380, pts: [[520, -2300, 110], [560, -1500, 95], [470, -900, 70], [640, -520, 55]] },
];

// Rolling hill regions [x, z, radius, height].
export const HILLS = [
  [230, 560, 520, 38], [-1200, -1500, 600, 34], [-2300, -900, 500, 28], [1600, 200, 600, 26], [-1300, 1900, 500, 18],
  [2700, 1000, 500, 30], [1000, 2100, 420, 16], [-400, -2100, 500, 45],
];

// Desert: signed field centred here (the south-east).
export const DESERT = { center: [2050, 1450], radius: 1450 };
// Snow line (metres). Anything above is snow; mountains start whitening lower in the north.
export const SNOW_LINE = 150;

// Forest masses [x, z, radius, density 0..1]
export const FORESTS = [
  [-2150, -1300, 700, 0.75], [-1300, -2100, 600, 0.6], [-2500, -1900, 500, 0.55], [2200, -1900, 500, 0.4],
  [-1900, 1700, 500, 0.45], [-600, 1900, 350, 0.3], [700, -1300, 450, 0.45], [-400, -1500, 400, 0.4],
];

// ------------------------------------------------------------------ transport
// Highways join capitals and cities (wide, fast). Regional roads are added
// automatically between neighbouring territories.
export const HIGHWAYS = [
  ['hq_aldmark', 'aldhaven'], ['aldhaven', 'rook'], ['rook', 'midvale'], ['midvale', 'redstone'], ['redstone', 'kharan'], ['kharan', 'hq_karsa'],
  ['aldhaven', 'northgate'], ['aldhaven', 'westmarch'], ['aldhaven', 'wexley'], ['midvale', 'tallow'], ['tallow', 'seralis'],
  ['seralis', 'hq_seravia'], ['seralis', 'calda'], ['kharan', 'tarsk'], ['kharan', 'khar_air'], ['tarsk', 'ashar'], ['kharan', 'volk'],
  ['westmarch', 'oriel'], ['oriel', 'seralis'], ['emberfield', 'northgate'], ['emberfield', 'rook'],
];

// Railway lines through stations in these territories (in order).
export const RAILWAYS = [
  { id: 'main', name: 'Continental Line', stops: ['wexley', 'aldhaven', 'rook', 'midvale', 'redstone', 'kharan', 'tarsk'] },
  { id: 'south', name: 'Southern Line', stops: ['northgate', 'emberfield', 'midvale', 'tallow', 'seralis', 'calda'] },
];

// Airports (a runway + terminal inside these territories).
export const AIRPORTS = [
  { territory: 'westmarch', name: 'Westmarch Airport', off: [-80, 80], len: 760, rot: 0 },
  { territory: 'khar_air', name: 'Khar Airfield', off: [-40, 40], len: 700, rot: 0 },
  { territory: 'oriel', name: 'Oriel Airstrip', off: [-160, -220], len: 560, rot: 1 },
];

// ------------------------------------------------------------------ names
// Village names per country (used for procedural settlements).
export const PLACE_NAMES = {
  [A]: ['Brackenford', 'Colderby', 'Ashwick', 'Pellham', 'Thornby', 'Harrowgate', 'Elmsworth', 'Dunmere', 'Kettlestone', 'Fernhill', 'Ravensby', 'Oakhurst', 'Wendle', 'Stoneleigh', 'Marlow Cross', 'Hadley', 'Greyford', 'Linwick'],
  [K]: ['Yarosk', 'Dvorin', 'Kalesh', 'Veska', 'Morad', 'Tuzhny', 'Irbek', 'Sarn', 'Zelena', 'Korvash', 'Ostrin', 'Belyak', 'Dashkar', 'Rudno', 'Vesh', 'Khorvat', 'Ulmek', 'Stavra'],
  [S]: ['Casoria', 'Belmonte', 'Valdoro', 'San Remi', 'Lunara', 'Portello', 'Aurino', 'Merida', 'Calvera', 'Solano', 'Ventia', 'Rosella', 'Tavira', 'Olmedo', 'Serrano', 'Castell', 'Arbela', 'Miraval'],
};

export const TERRITORY_BY_ID = Object.fromEntries(TERRITORIES.map((t) => [t.id, t]));
export const HQ_BY_ID = Object.fromEntries(HQ_BASES.map((b) => [b.id, b]));

export function anchorPos(id) {
  const t = TERRITORY_BY_ID[id] || HQ_BY_ID[id];
  return t ? t.center : null;
}
