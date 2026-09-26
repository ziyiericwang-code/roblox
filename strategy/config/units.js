// Military building blocks. An element is roughly a company, battery or flight.
// Stats are relative; they are multiplied by strength, equipment fill, experience and tech.

export const LAND = ['inf', 'mot', 'mech', 'armor', 'art', 'ad', 'sf'];

export const ELEMENTS = {
  inf: { name: 'Infantry', short: 'INF', men: 150, equip: { small: 1 }, soft: 3.0, hard: 0.6, def: 4.2, brk: 1.0, hardness: 0.0, ap: 1, aa: 0.2, speed: 180, supply: 1.0, fuel: 0.0, recon: 0.5, unlock: 1 },
  mot: { name: 'Motorized Infantry', short: 'MOT', men: 150, equip: { small: 1, vehicles: 0.5 }, soft: 3.0, hard: 0.7, def: 3.6, brk: 1.6, hardness: 0.1, ap: 1, aa: 0.2, speed: 380, supply: 1.2, fuel: 0.6, recon: 0.6, unlock: 9 },
  mech: { name: 'Mechanized Infantry', short: 'MECH', men: 150, equip: { small: 1, vehicles: 1 }, soft: 4.0, hard: 2.0, def: 4.2, brk: 3.0, hardness: 0.55, ap: 3, aa: 0.4, speed: 340, supply: 1.5, fuel: 1.2, recon: 0.6, unlock: 9 },
  armor: { name: 'Armor', short: 'ARM', men: 100, equip: { tanks: 1 }, soft: 4.2, hard: 5.2, def: 2.4, brk: 5.5, hardness: 0.9, ap: 6, aa: 0.2, speed: 310, supply: 2.0, fuel: 2.2, recon: 0.5, unlock: 21 },
  art: { name: 'Artillery', short: 'ART', men: 120, equip: { guns: 1 }, soft: 5.5, hard: 1.2, def: 1.2, brk: 0.3, hardness: 0.1, ap: 2, aa: 0.1, speed: 160, supply: 2.0, fuel: 0.6, recon: 0.2, unlock: 13 },
  ad: { name: 'Air Defense', short: 'AD', men: 100, equip: { ad: 1 }, soft: 0.6, hard: 0.4, def: 1.2, brk: 0.2, hardness: 0.3, ap: 1, aa: 5.0, speed: 250, supply: 1.2, fuel: 0.6, recon: 0.3, unlock: 13 },
  sf: { name: 'Special Forces', short: 'SF', men: 90, equip: { small: 1.5 }, soft: 3.4, hard: 1.2, def: 2.6, brk: 3.2, hardness: 0.0, ap: 2, aa: 0.3, speed: 220, supply: 1.0, fuel: 0.2, recon: 2.5, unlock: 18 },
};

export const EQUIPMENT = {
  small: { name: 'Infantry equipment', ic: 0.5, materials: 0.2, components: 0 },
  vehicles: { name: 'Vehicles', ic: 1.5, materials: 0.8, components: 0.1 },
  tanks: { name: 'Tanks', ic: 4.0, materials: 2.0, components: 0.5 },
  guns: { name: 'Artillery', ic: 2.0, materials: 1.0, components: 0.2 },
  ad: { name: 'Air-defense systems', ic: 3.0, materials: 0.8, components: 1.0 },
  aircraft: { name: 'Aircraft', ic: 8.0, materials: 2.0, components: 2.5 },
  ships: { name: 'Warships', ic: 30.0, materials: 12.0, components: 6.0 },
  ammo: { name: 'Ammunition', ic: 0.4, materials: 0.3, components: 0 },
};

// Air wings (squadron scale) and naval task force ships.
export const AIR = {
  fighter: { name: 'Fighters', air: 6, ground: 0.5, naval: 0.5, range: 1500 },
  cas: { name: 'Close Air Support', air: 1.5, ground: 5, naval: 1, range: 900 },
  bomber: { name: 'Bombers', air: 0.5, ground: 3, naval: 2, range: 3500, strategic: 5 },
  recon: { name: 'Reconnaissance', air: 0.3, ground: 0, naval: 0, range: 2500, recon: 3 },
  transport: { name: 'Transport', air: 0, ground: 0, naval: 0, range: 3000, lift: 4 },
};

export const SHIPS = {
  carrier: { name: 'Aircraft Carrier', surface: 4, asw: 1, aa: 5, air: 12, hp: 60 },
  destroyer: { name: 'Destroyer', surface: 4, asw: 3, aa: 4, air: 0, hp: 12 },
  frigate: { name: 'Frigate', surface: 2.5, asw: 3.5, aa: 2.5, air: 0, hp: 8 },
  submarine: { name: 'Submarine', surface: 5, asw: 1.5, aa: 0, air: 0, hp: 6, stealth: 0.6 },
  transport: { name: 'Transport', surface: 0, asw: 0, aa: 0, air: 0, hp: 6, lift: 20 },
};

// Formation templates: maximum elements.
export const TEMPLATES = {
  detachment: { name: 'Detachment', max: 6, echelon: 'I' },
  taskforce: { name: 'Task Force', max: 16, echelon: 'II' },
  brigade: { name: 'Brigade', max: 40, echelon: 'X' },
  division: { name: 'Division', max: 80, echelon: 'XX' },
};

export function templateFor(elements) {
  if (elements <= 6) return 'detachment';
  if (elements <= 16) return 'taskforce';
  if (elements <= 40) return 'brigade';
  return 'division';
}
