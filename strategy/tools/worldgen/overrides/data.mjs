// Hand-curated inputs for the world pipeline. Coordinates are [lon, lat].

// Total land provinces the pipeline aims for.
export const TARGET_PROVINCES = 1200;
export const TARGET_SEA_ZONES = 190;

// Fixed province counts for large or strategically central countries (by country key = NE SOVEREIGNT).
export const BUDGET_OVERRIDES = {
  Russia: 84,
  China: 74,
  'United States of America': 72,
  India: 48,
  Brazil: 34,
  Canada: 32,
  Australia: 24,
  Indonesia: 24,
  Kazakhstan: 14,
  Mexico: 18,
  Argentina: 16,
  France: 18,
  Germany: 16,
  'United Kingdom': 12,
  Ukraine: 14,
  Turkey: 14,
  Iran: 14,
  Japan: 12,
  Italy: 12,
  Spain: 12,
  Poland: 10,
  'Saudi Arabia': 12,
  Egypt: 10,
  Pakistan: 12,
  'South Africa': 10,
  Nigeria: 10,
  'Democratic Republic of the Congo': 12,
  Algeria: 11,
  Libya: 8,
  Sudan: 9,
  Ethiopia: 9,
  Mongolia: 7,
  Peru: 9,
  Colombia: 9,
  Bolivia: 7,
  Venezuela: 7,
  Chile: 8,
  Denmark: 5,
  'South Korea': 6,
  'North Korea': 5,
  Taiwan: 3,
  Israel: 3,
  Vietnam: 8,
  Thailand: 8,
  Myanmar: 8,
  Philippines: 8,
  Iraq: 7,
  Syria: 5,
  Afghanistan: 7,
  Sweden: 7,
  Norway: 7,
  Finland: 6,
  Romania: 6,
  Belarus: 5,
  'New Zealand': 4,
  Greece: 5,
  Uzbekistan: 6,
  Turkmenistan: 5,
  Yemen: 5,
  Oman: 4,
  Angola: 7,
  Tanzania: 7,
  Kenya: 6,
  Mozambique: 7,
  Namibia: 5,
  Mali: 6,
  Niger: 6,
  Chad: 6,
  Mauritania: 5,
  Morocco: 6,
  Somalia: 5,
  Madagascar: 5,
  Zambia: 5,
  Cuba: 3,
  Bangladesh: 5,
  Malaysia: 5,
  Singapore: 1,
};

// Tiny enclaved states folded into their surrounding country (they cannot hold a province).
export const MERGE_COUNTRIES = { Vatican: 'Italy', 'San Marino': 'Italy', Monaco: 'France' };

// Small islands kept as provinces for their strategic value (matched against admin names).
export const STRATEGIC_ISLANDS = ['British Indian Ocean', 'Diego Garcia', 'Ascension', 'Guam', 'Midway', 'Wake', 'Gibraltar', 'Bermuda', 'Saint Helena', 'Pembroke', 'Clipperton'];

// Water bodies that count as seas even though they are small or cut off at raster resolution.
export const FORCE_SEA_POINTS = [
  [28.0, 40.75], // Sea of Marmara
  [35.5, 46.0], // Sea of Azov
];

// Short crossings that link two land provinces (bridge, tunnel or narrow strait).
// kind: 'bridge' (normal movement), 'strait' (crossing penalty)
export const LAND_CROSSINGS = [
  { name: 'Channel Tunnel', a: [1.1, 51.1], b: [1.85, 50.9], kind: 'bridge' },
  { name: 'Øresund Bridge', a: [12.55, 55.65], b: [13.0, 55.6], kind: 'bridge' },
  { name: 'Great Belt', a: [11.1, 55.35], b: [10.5, 55.3], kind: 'bridge' },
  { name: 'Little Belt', a: [9.75, 55.5], b: [9.9, 55.45], kind: 'bridge' },
  { name: 'Strait of Messina', a: [15.55, 38.2], b: [15.7, 38.15], kind: 'strait' },
  { name: 'Bosporus', a: [28.95, 41.05], b: [29.1, 41.02], kind: 'bridge' },
  { name: 'Dardanelles', a: [26.4, 40.25], b: [26.5, 40.1], kind: 'strait' },
  { name: 'Kerch Strait', a: [36.45, 45.3], b: [36.7, 45.25], kind: 'bridge' },
  { name: 'Strait of Gibraltar', a: [-5.6, 36.05], b: [-5.8, 35.75], kind: 'strait' },
  { name: 'Bab-el-Mandeb', a: [43.4, 12.8], b: [43.2, 12.4], kind: 'strait' },
  { name: 'Strait of Hormuz', a: [56.3, 27.1], b: [56.25, 26.3], kind: 'strait' },
  { name: 'Kanmon Straits', a: [130.95, 33.97], b: [130.9, 33.88], kind: 'bridge' },
  { name: 'Seikan Tunnel', a: [140.6, 41.2], b: [140.4, 41.45], kind: 'bridge' },
  { name: 'Seto Ohashi', a: [133.8, 34.5], b: [133.8, 34.3], kind: 'bridge' },
  { name: 'Johor Causeway', a: [103.77, 1.42], b: [103.76, 1.47], kind: 'bridge' },
  { name: 'King Fahd Causeway', a: [50.5, 26.15], b: [50.15, 26.25], kind: 'bridge' },
  { name: 'Palk Strait', a: [79.9, 9.25], b: [79.4, 9.3], kind: 'strait' },
  { name: 'Bering Strait', a: [-170.3, 66.0], b: [-167.9, 65.6], kind: 'strait' },
  { name: 'Strait of Belle Isle', a: [-56.7, 51.6], b: [-56.9, 51.3], kind: 'strait' },
  { name: 'Strait of Magellan', a: [-70.4, -52.75], b: [-70.0, -53.4], kind: 'strait' },
  { name: 'Mackinac Bridge', a: [-84.73, 45.87], b: [-84.73, 45.77], kind: 'bridge' },
  { name: 'Strait of Bonifacio', a: [9.2, 41.4], b: [9.25, 41.2], kind: 'strait' },
  { name: 'Bali Strait', a: [114.4, -8.15], b: [114.5, -8.25], kind: 'strait' },
  { name: 'Sunda Strait', a: [105.8, -6.1], b: [105.6, -5.7], kind: 'strait' },
  { name: 'Strait of Otranto', a: [18.5, 40.1], b: [19.45, 40.4], kind: 'strait' },
  { name: 'Taiwan Strait', a: [119.6, 25.4], b: [120.2, 24.2], kind: 'strait' },
  { name: 'Korea Strait', a: [129.0, 35.1], b: [130.4, 33.6], kind: 'strait' },
  { name: 'Irish Sea Crossing', a: [-5.1, 55.0], b: [-5.8, 54.7], kind: 'strait' },
  { name: 'Cook Strait', a: [174.8, -41.3], b: [174.2, -41.3], kind: 'strait' },
  { name: 'Bass Strait', a: [146.0, -38.9], b: [146.8, -41.1], kind: 'strait' },
  { name: 'Strait of Florida', a: [-80.8, 25.1], b: [-81.6, 23.1], kind: 'strait' },
  { name: 'Tsugaru Ferry', a: [140.9, 41.1], b: [140.8, 41.8], kind: 'strait' },
];

// Extra sea-zone links through canals and straits the raster cannot resolve.
export const SEA_LINKS = [
  { name: 'Bosporus', a: [29.3, 41.4], b: [28.6, 40.85] },
  { name: 'Dardanelles', a: [27.0, 40.55], b: [25.9, 40.0] },
  { name: 'Suez Canal', a: [32.4, 31.5], b: [32.6, 29.7] },
  { name: 'Panama Canal', a: [-79.9, 9.5], b: [-79.5, 8.7] },
  { name: 'Kerch Strait', a: [36.9, 45.6], b: [36.5, 44.9] },
  { name: 'Øresund', a: [12.8, 55.9], b: [12.9, 55.3] },
  { name: 'Kiel Canal', a: [10.4, 54.5], b: [8.4, 54.0] },
];

// Resource zones: kind oil | minerals | rare | food. r in km, w relative weight.
export const RESOURCE_ZONES = [
  // oil and gas
  ['oil', 49.5, 25.5, 520, 10], ['oil', 47.6, 30.3, 300, 7], ['oil', 49.0, 31.0, 320, 7], ['oil', 72, 61, 750, 9],
  ['oil', 52, 54, 420, 5], ['oil', -102, 32, 420, 6], ['oil', -94, 29.5, 420, 5], ['oil', -150, 70, 300, 3],
  ['oil', -112, 56, 420, 5], ['oil', -66, 8.5, 480, 5], ['oil', -71.5, 10.2, 200, 3], ['oil', 6.5, 5.0, 260, 4],
  ['oil', 19, 29, 420, 4], ['oil', 6, 31.5, 420, 4], ['oil', 5.5, 59, 260, 3], ['oil', -2.5, 57.2, 220, 2],
  ['oil', 53.5, 46.5, 320, 4], ['oil', 49.8, 40.4, 160, 2], ['oil', -45, -23.5, 260, 4], ['oil', 13, -8, 260, 3],
  ['oil', 125, 46.5, 260, 2], ['oil', 84, 41, 420, 2], ['oil', -92, 19, 260, 3], ['oil', 54, 24, 260, 5],
  ['oil', 51.2, 25.3, 130, 4], ['oil', 57, 21, 300, 2], ['oil', 101.5, 1, 260, 2], ['oil', 28, 30, 260, 2],
  ['oil', 60, 38, 320, 3], ['oil', 143, 52, 220, 2], ['oil', 44.4, 35.5, 200, 3], ['oil', 40, 35.5, 160, 1],
  ['oil', -103, 48, 250, 2], ['oil', 115, -21, 260, 2], ['oil', 81.5, 67, 400, 4],
  // minerals (iron, coal, copper, bauxite...)
  ['minerals', 118, -22, 420, 7], ['minerals', -50, -6, 320, 5], ['minerals', -44, -19.5, 320, 5],
  ['minerals', 112, 38, 420, 6], ['minerals', 85, 22, 320, 5], ['minerals', 60, 57, 420, 5],
  ['minerals', 37.8, 48, 260, 4], ['minerals', 27, -26, 420, 5], ['minerals', -69.5, -23, 420, 5],
  ['minerals', -71, -15, 320, 3], ['minerals', 27, -11, 360, 5], ['minerals', 28, -13, 260, 3],
  ['minerals', -81, 46.5, 320, 3], ['minerals', -67, 53, 420, 3], ['minerals', -81, 38, 320, 3],
  ['minerals', -92.5, 47.5, 220, 2], ['minerals', 7.2, 51.5, 160, 3], ['minerals', 19, 50.3, 160, 3],
  ['minerals', 70, 49, 420, 4], ['minerals', 20.2, 67.9, 220, 2], ['minerals', -12, 11, 260, 3],
  ['minerals', 137, -4, 220, 2], ['minerals', 106, 44, 420, 3], ['minerals', 88, 55, 320, 3],
  ['minerals', 131, 43, 260, 2], ['minerals', 150, -24, 420, 4], ['minerals', -111, 40, 320, 2],
  ['minerals', 30, -20, 260, 2], ['minerals', 3, 36, 200, 1], ['minerals', -7, 32, 260, 3],
  // rare earths and critical minerals
  ['rare', 110, 41.8, 260, 9], ['rare', 115, 25, 260, 6], ['rare', 97.5, 25.5, 220, 4], ['rare', 122.5, -28.9, 260, 4],
  ['rare', -115.5, 35.5, 160, 3], ['rare', 33.5, 67.7, 220, 3], ['rare', -47, -19.6, 160, 3], ['rare', 76.5, 9, 160, 2],
  ['rare', 104, 22.3, 160, 2], ['rare', -46, 61, 160, 2], ['rare', 18.5, -31.3, 160, 2], ['rare', 101, 4.5, 160, 1],
  ['rare', 27, -11, 300, 4], ['rare', -67, -23, 300, 3], ['rare', 71, 42, 200, 1],
  // prime farmland
  ['food', -93, 41, 820, 9], ['food', 35, 48, 720, 8], ['food', -61, -35, 520, 6], ['food', -55, -14, 620, 5],
  ['food', 80, 27, 720, 8], ['food', 116, 35, 520, 7], ['food', -105, 51, 620, 5], ['food', 2, 47.5, 420, 5],
  ['food', 31, 30.5, 160, 3], ['food', 105, 12, 420, 5], ['food', 110, -7.2, 320, 4], ['food', 145, -34, 420, 3],
  ['food', 73, 31, 320, 4], ['food', 90, 24, 220, 4], ['food', 100.5, 15, 320, 4], ['food', 8, 11, 420, 3],
  ['food', 38.5, 9, 260, 2], ['food', 68, 53, 520, 3], ['food', 11, 52, 360, 3], ['food', 19, 47, 300, 3],
  ['food', 113, 30, 420, 5], ['food', 121, 31, 260, 3], ['food', -120, 37, 300, 3], ['food', 139, 36, 220, 2],
  ['food', 127.5, 36, 180, 2], ['food', 44, 33, 260, 2], ['food', 30, 50, 360, 4],
];

// Climate zones used for terrain classification when Natural Earth has no named region.
// [kind, lonMin, latMin, lonMax, latMax]
export const CLIMATE_BOXES = [
  ['jungle', -80, -15, -44, 8], // Amazon
  ['jungle', -92, 7, -76, 18], // Central America
  ['jungle', 8, -6, 31, 5], // Congo basin
  ['jungle', -13, 4, 10, 9], // Guinea coast forest
  ['jungle', 94, -9, 142, 12], // SE Asia and Indonesia
  ['jungle', 142, -11, 156, -2], // New Guinea east
  ['jungle', 73, 6, 81, 12], // Kerala/Sri Lanka
  ['jungle', 47, -25, 51, -12], // eastern Madagascar
  ['forest', -140, 50, -55, 64], // Canadian boreal
  ['forest', -125, 40, -115, 50], // Pacific northwest
  ['forest', -92, 30, -70, 47], // eastern US forests
  ['forest', 5, 57, 32, 66], // Scandinavian/Finnish forest
  ['forest', 30, 55, 180, 66], // Siberian taiga
  ['forest', 125, 40, 140, 55], // Manchuria/Far East
  ['forest', 5, 45, 25, 51], // central European forests (hills mix)
  ['forest', 145, -44, 150, -37], // SE Australia/Tasmania
  ['forest', -76, -46, -71, -38], // Valdivian forest
  ['forest', 20, 45, 30, 50], // Carpathians
  ['forest', 136, 34, 141, 40], // Japan highlands
];
