// Cosmetic unlocks. Credits are earned only through play. Nothing here affects combat.
// Items marked `premium` are placeholders for optional real-money cosmetic packs.

export const CAMOS = {
  woodland: { id: 'woodland', name: 'Woodland', price: 0, colors: ['#4b5a36', '#6b6a44', '#2f3526'] },
  desert: { id: 'desert', name: 'Desert', price: 0, colors: ['#b59f74', '#8f7b55', '#d2c39a'] },
  urban: { id: 'urban', name: 'Urban', price: 450, colors: ['#6d7075', '#4a4d52', '#9a9ca0'] },
  arctic: { id: 'arctic', name: 'Arctic', price: 700, colors: ['#d8dcdf', '#9aa3aa', '#bfc6cc'] },
  night: { id: 'night', name: 'Night Ops', price: 1100, minRank: 6, colors: ['#23282f', '#343b44', '#191c21'] },
  tiger: { id: 'tiger', name: 'Tiger Stripe', price: 1400, colors: ['#5c6238', '#2d2b1f', '#8b7a45'] },
  digital: { id: 'digital', name: 'Digital', price: 1700, colors: ['#6f7a64', '#4d5646', '#98a08a'] },
  dress: { id: 'dress', name: 'Officer Dress', price: 0, minRank: 19, colors: ['#3c4a3a', '#34402f', '#46553f'] },
  command: { id: 'command', name: 'High Command', price: 0, minRank: 25, colors: ['#3a3f47', '#2c3036', '#4a515b'] },
  supporter: { id: 'supporter', name: 'Veteran Supporter', price: 0, premium: true, colors: ['#4d4436', '#6a5d44', '#2e2a22'] },
  // national field uniforms (NPCs of each country; not sold)
  karsa: { id: 'karsa', name: 'Karsan Field Grey', price: 0, national: true, colors: ['#5f6157', '#44463f', '#7a7b6f'] },
  seravia: { id: 'seravia', name: 'Seravian Olive', price: 0, national: true, colors: ['#7d7550', '#5f593d', '#978f66'] },
};

export const HEADGEAR = {
  helmet: { id: 'helmet', name: 'Combat Helmet', price: 0 },
  helmet_net: { id: 'helmet_net', name: 'Netted Helmet', price: 300 },
  boonie: { id: 'boonie', name: 'Boonie Hat', price: 400 },
  beanie: { id: 'beanie', name: 'Watch Cap', price: 400 },
  headset: { id: 'headset', name: 'Comms Headset', price: 650 },
  beret: { id: 'beret', name: 'Officer Beret', price: 0, minRank: 19 },
  cap: { id: 'cap', name: 'General\'s Cap', price: 0, minRank: 25 },
};

export const EMOTES = {
  salute: { id: 'salute', name: 'Salute', price: 0 },
  attention: { id: 'attention', name: 'Attention', price: 0 },
  point: { id: 'point', name: 'Point', price: 150 },
  wave: { id: 'wave', name: 'Wave', price: 150 },
  at_ease: { id: 'at_ease', name: 'At Ease', price: 250 },
  cheer: { id: 'cheer', name: 'Cheer', price: 300 },
};

export const VEHICLE_SKINS = {
  standard: { id: 'standard', name: 'Standard Issue', price: 0 },
  sand: { id: 'sand', name: 'Sand', price: 600 },
  winter: { id: 'winter', name: 'Winter', price: 800 },
  urban: { id: 'urban', name: 'Urban Grey', price: 900 },
};

export const COSMETIC_TABLES = { camo: CAMOS, headgear: HEADGEAR, emote: EMOTES, vehicle: VEHICLE_SKINS };

export const DOMINION_CAMO = { colors: ['#555a60', '#3a3d42', '#6e7278'] };
