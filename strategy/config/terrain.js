// Terrain effects. Index order matches the world package: plains, forest, jungle, hills,
// mountains, desert, marsh, tundra, arctic.
export const TERRAIN_RULES = [
  { name: 'Plains', move: 1.0, attack: 1.0, defense: 1.0, frontage: 40, armor: 1.0, attrition: 0, supply: 1.0 },
  { name: 'Forest', move: 0.7, attack: 0.85, defense: 1.15, frontage: 28, armor: 0.75, attrition: 0, supply: 0.9 },
  { name: 'Jungle', move: 0.45, attack: 0.7, defense: 1.25, frontage: 20, armor: 0.55, attrition: 0.02, supply: 0.7 },
  { name: 'Hills', move: 0.7, attack: 0.8, defense: 1.2, frontage: 28, armor: 0.8, attrition: 0, supply: 0.85 },
  { name: 'Mountains', move: 0.45, attack: 0.6, defense: 1.45, frontage: 16, armor: 0.5, attrition: 0.01, supply: 0.6 },
  { name: 'Desert', move: 0.85, attack: 0.95, defense: 0.95, frontage: 40, armor: 1.0, attrition: 0.02, supply: 0.6 },
  { name: 'Marsh', move: 0.5, attack: 0.7, defense: 1.2, frontage: 16, armor: 0.55, attrition: 0.01, supply: 0.7 },
  { name: 'Tundra', move: 0.65, attack: 0.9, defense: 1.05, frontage: 24, armor: 0.85, attrition: 0.02, supply: 0.55 },
  { name: 'Arctic', move: 0.4, attack: 0.8, defense: 1.1, frontage: 16, armor: 0.7, attrition: 0.04, supply: 0.35 },
];

// Weather states per strategic area.
export const WEATHER = [
  { name: 'Clear', move: 1.0, attack: 1.0, air: 1.0, attrition: 0 },
  { name: 'Rain', move: 0.85, attack: 0.92, air: 0.75, attrition: 0 },
  { name: 'Mud', move: 0.6, attack: 0.8, air: 0.8, attrition: 0.005 },
  { name: 'Snow', move: 0.7, attack: 0.85, air: 0.7, attrition: 0.01 },
  { name: 'Blizzard', move: 0.4, attack: 0.65, air: 0.2, attrition: 0.03 },
  { name: 'Storm', move: 0.8, attack: 0.9, air: 0.4, attrition: 0.005 },
  { name: 'Heat', move: 0.85, attack: 0.9, air: 0.9, attrition: 0.01 },
];

export const RIVER_ATTACK = 0.72;
export const STRAIT_ATTACK = 0.55;
export const AMPHIBIOUS_ATTACK = 0.5;
export const URBAN_DEFENSE = [1, 1.12, 1.22, 1.32];
export const FORT_DEFENSE = 0.1; // per level
