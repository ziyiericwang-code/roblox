// Starting diplomatic situation and AI personalities (fictional 2030 scenario, data-driven).

export const START_DATE = { year: 2030, month: 1, day: 7 };

// AI archetypes: weights used by the strategic and military AI
export const PERSONALITIES = {
  hegemon: { name: 'Hegemon', aggression: 0.55, attackRatio: 1.35, loyalty: 0.8, alliance: 0.9, caution: 0.4, expansion: 0.6 },
  expansionist: { name: 'Expansionist', aggression: 0.8, attackRatio: 1.2, loyalty: 0.5, alliance: 0.4, caution: 0.25, expansion: 0.9 },
  opportunist: { name: 'Opportunist', aggression: 0.55, attackRatio: 1.4, loyalty: 0.4, alliance: 0.5, caution: 0.4, expansion: 0.6 },
  fortress: { name: 'Fortress', aggression: 0.15, attackRatio: 2.2, loyalty: 0.7, alliance: 0.6, caution: 0.8, expansion: 0.1 },
  coalition: { name: 'Coalition-builder', aggression: 0.25, attackRatio: 1.6, loyalty: 0.95, alliance: 1.0, caution: 0.6, expansion: 0.2 },
  revanchist: { name: 'Revanchist', aggression: 0.7, attackRatio: 1.3, loyalty: 0.6, alliance: 0.5, caution: 0.35, expansion: 0.7 },
  mercantile: { name: 'Mercantile', aggression: 0.15, attackRatio: 1.9, loyalty: 0.6, alliance: 0.6, caution: 0.7, expansion: 0.15 },
  maritime: { name: 'Maritime', aggression: 0.3, attackRatio: 1.6, loyalty: 0.7, alliance: 0.7, caution: 0.6, expansion: 0.3 },
  isolationist: { name: 'Isolationist', aggression: 0.1, attackRatio: 2.4, loyalty: 0.3, alliance: 0.15, caution: 0.85, expansion: 0.05 },
  unstable: { name: 'Unstable', aggression: 0.6, attackRatio: 1.3, loyalty: 0.3, alliance: 0.3, caution: 0.2, expansion: 0.5 },
};

export const PERSONALITY_OF = {
  USA: 'hegemon', CHN: 'hegemon', RUS: 'expansionist', IND: 'fortress', GBR: 'coalition', FRA: 'coalition', DEU: 'mercantile', JPN: 'maritime',
  KOR: 'fortress', PRK: 'unstable', TUR: 'opportunist', ISR: 'fortress', IRN: 'revanchist', PAK: 'fortress', EGY: 'fortress', SAU: 'mercantile',
  UKR: 'fortress', POL: 'fortress', ITA: 'coalition', ESP: 'coalition', BRA: 'mercantile', IDN: 'maritime', VNM: 'fortress', THA: 'isolationist',
  AUS: 'maritime', CAN: 'coalition', MEX: 'isolationist', TWN: 'fortress', SWE: 'isolationist', CHE: 'isolationist', NOR: 'coalition', FIN: 'fortress',
  NLD: 'coalition', BLR: 'opportunist', KAZ: 'mercantile', AZE: 'revanchist', ARM: 'fortress', VEN: 'unstable', CUB: 'isolationist', SYR: 'unstable',
  IRQ: 'unstable', LBY: 'unstable', SDN: 'unstable', ETH: 'opportunist', ERI: 'unstable', SOM: 'unstable', MMR: 'unstable', AFG: 'unstable', YEM: 'unstable',
  MAR: 'opportunist', DZA: 'revanchist', GRC: 'fortress', SRB: 'revanchist', ARE: 'mercantile', QAT: 'mercantile', SGP: 'fortress', NGA: 'opportunist',
  ZAF: 'mercantile', ARG: 'revanchist', CHL: 'fortress', COL: 'fortress', PER: 'isolationist',
};

// Starting blocs. Members by ISO3.
export const BLOCS = [
  { name: 'Atlantic Alliance', color: '#5b83b8', members: ['USA', 'CAN', 'GBR', 'FRA', 'DEU', 'ITA', 'ESP', 'PRT', 'NLD', 'BEL', 'LUX', 'DNK', 'NOR', 'ISL', 'POL', 'CZE', 'SVK', 'HUN', 'ROU', 'BGR', 'GRC', 'TUR', 'EST', 'LVA', 'LTU', 'SVN', 'HRV', 'ALB', 'MNE', 'MKD', 'FIN', 'SWE'] },
  { name: 'Eurasian Security Pact', color: '#7f9f6f', members: ['RUS', 'BLR', 'KAZ', 'KGZ', 'TJK', 'ARM'] },
  { name: 'Gulf Council', color: '#86a36a', members: ['SAU', 'ARE', 'KWT', 'QAT', 'BHR', 'OMN'] },
];

// Bilateral defense pacts
export const PACTS = [
  ['USA', 'JPN'], ['USA', 'KOR'], ['USA', 'AUS'], ['USA', 'PHL'], ['USA', 'NZL'], ['CHN', 'PRK'], ['AUS', 'NZL'], ['FRA', 'ARE'], ['RUS', 'SYR'],
];

// Starting rivalries (opinion, and a claim that allows war)
export const RIVALRIES = [
  ['IND', 'PAK', -70, true], ['KOR', 'PRK', -85, true], ['CHN', 'TWN', -80, true], ['ISR', 'IRN', -90, false], ['RUS', 'UKR', -90, true],
  ['ARM', 'AZE', -75, true], ['GRC', 'TUR', -35, false], ['SAU', 'IRN', -60, false], ['USA', 'IRN', -70, false], ['USA', 'PRK', -80, false],
  ['CHN', 'USA', -35, false], ['CHN', 'IND', -45, true], ['CHN', 'JPN', -40, false], ['VEN', 'GUY', -50, true], ['MAR', 'DZA', -45, false],
  ['ETH', 'ERI', -60, true], ['EGY', 'ETH', -40, false], ['SRB', 'KOS', -70, true], ['CHN', 'PHL', -40, false], ['CHN', 'VNM', -40, false],
  ['RUS', 'POL', -55, false], ['RUS', 'GBR', -45, false], ['RUS', 'USA', -50, false], ['SDN', 'SSD', -45, true], ['COD', 'RWA', -50, true],
  ['ARG', 'GBR', -30, true], ['IRN', 'ARE', -35, false], ['PRK', 'JPN', -60, false], ['BLR', 'POL', -40, false], ['AFG', 'PAK', -40, false],
];

// Scenario presets
export const SCENARIOS = {
  cold: { name: 'Cold Peace 2030', text: 'Tense but peaceful. Wars start only when nations decide to fight.', tension: 35, aggression: 1, wars: [] },
  powder: { name: 'Powder Keg', text: 'Flashpoints everywhere. AI nations are far more willing to fight.', tension: 65, aggression: 1.6, wars: [['PRK', 'KOR'], ['AZE', 'ARM']] },
  worldwar: {
    name: 'World War III',
    text: 'The blocs are at war from day one. Pick a side and fight for the planet.',
    tension: 95,
    aggression: 2.2,
    wars: [['RUS', 'POL'], ['CHN', 'TWN'], ['PRK', 'KOR'], ['IRN', 'ISR'], ['PAK', 'IND']],
  },
};

export const OPERATION_WORDS = {
  a: ['IRON', 'STEEL', 'NORTHERN', 'SILENT', 'BLACK', 'RED', 'THUNDER', 'IRON', 'GRANITE', 'WINTER', 'OCEAN', 'DESERT', 'CRIMSON', 'GOLDEN', 'SHADOW', 'STORM', 'FALCON', 'ARCTIC', 'EASTERN', 'SOUTHERN', 'WESTERN', 'BRONZE', 'TITAN', 'PHANTOM', 'VALIANT'],
  b: ['SHIELD', 'SPEAR', 'HAMMER', 'ANVIL', 'LANCE', 'TIDE', 'FURY', 'WALL', 'DAWN', 'STRIKE', 'SENTINEL', 'CROWN', 'TALON', 'HORIZON', 'BASTION', 'ARROW', 'FORGE', 'WOLF', 'EAGLE', 'CITADEL', 'VANGUARD', 'RAMPART', 'SABRE', 'TEMPEST', 'COMPASS'],
};
