// Fictional military vehicles. Kept deliberately simple: arcade handling,
// clear seat roles, health with destruction states, depot respawn.
//
// Local coordinates: +x right, +y up, -z forward (matches yaw convention).

export const ARMOR_CLASS = {
  light: { bullet: 0.35, explosive: 1.0 },
  armored: { bullet: 0.07, explosive: 0.85 },
  heavy: { bullet: 0.0, explosive: 0.7 },
};

const seat = (role, x, y, z, extra = {}) => ({ role, offset: [x, y, z], ...extra });

export const VEHICLES = {
  truck: {
    id: 'truck', name: 'M9 Mule Transport', cls: 'transport', armor: 'light', hp: 900,
    maxSpeed: 21, reverseSpeed: 7, accel: 7, turnRate: 0.75, halfSize: [1.3, 1.5, 3.8], ground: true,
    rideHeight: 0.6, cargo: 4, respawn: 60, minRank: 1,
    seats: [
      seat('driver', -0.55, 1.6, -2.3),
      seat('passenger', 0.55, 1.6, -2.3),
      seat('passenger', -0.8, 1.7, 0.4), seat('passenger', 0.8, 1.7, 0.4),
      seat('passenger', -0.8, 1.7, 1.5), seat('passenger', 0.8, 1.7, 1.5),
      seat('passenger', -0.8, 1.7, 2.6), seat('passenger', 0.8, 1.7, 2.6),
    ],
    desc: 'Troop and supply transport. Carries up to 4 supply crates.',
  },
  jeep: {
    id: 'jeep', name: 'Rover LT', cls: 'jeep', armor: 'light', hp: 600,
    maxSpeed: 28, reverseSpeed: 9, accel: 10, turnRate: 1.1, halfSize: [1.05, 1.0, 2.3], ground: true,
    rideHeight: 0.45, respawn: 45, minRank: 1,
    seats: [
      seat('driver', -0.45, 1.1, -0.5),
      seat('passenger', 0.45, 1.1, -0.5),
      seat('gunner', 0, 1.8, 0.9, { weapon: 'hmg', turret: true }),
      seat('passenger', 0.5, 1.1, 1.6),
    ],
    desc: 'Fast light utility vehicle with a mounted heavy machine gun.',
  },
  recon: {
    id: 'recon', name: 'Ferret Recon Car', cls: 'recon', armor: 'light', hp: 750,
    maxSpeed: 31, reverseSpeed: 10, accel: 11, turnRate: 1.05, halfSize: [1.15, 1.0, 2.5], ground: true,
    rideHeight: 0.5, respawn: 60, minRank: 3, autoSpot: 70,
    seats: [
      seat('driver', 0, 1.2, -0.8),
      seat('gunner', 0, 2.0, 0.4, { weapon: 'hmg', turret: true }),
    ],
    desc: 'Fast scout car that automatically spots nearby enemies.',
  },
  apc: {
    id: 'apc', name: 'Bulwark APC', cls: 'armored', armor: 'armored', hp: 1700,
    maxSpeed: 18, reverseSpeed: 7, accel: 6, turnRate: 0.7, halfSize: [1.55, 1.35, 3.5], ground: true,
    rideHeight: 0.55, respawn: 120, minRank: 4, mobileSpawn: true,
    seats: [
      seat('driver', -0.6, 1.5, -2.2),
      seat('gunner', 0, 2.6, -0.6, { weapon: 'autocannon', turret: true }),
      seat('passenger', -0.8, 1.4, 0.6), seat('passenger', 0.8, 1.4, 0.6),
      seat('passenger', -0.8, 1.4, 1.6), seat('passenger', 0.8, 1.4, 1.6),
      seat('passenger', -0.8, 1.4, 2.6), seat('passenger', 0.8, 1.4, 2.6),
    ],
    desc: 'Armored personnel carrier with autocannon. Squad can deploy on it.',
  },
  tank: {
    id: 'tank', name: 'Warden MBT', cls: 'tank', armor: 'heavy', hp: 2600,
    maxSpeed: 13, reverseSpeed: 6, accel: 4, turnRate: 0.55, halfSize: [1.8, 1.25, 3.9], ground: true, tracked: true,
    rideHeight: 0.5, respawn: 180, minRank: 5,
    seats: [
      seat('driver', 0, 1.4, -2.4, { driverWeapon: 'cannon' }),
      seat('gunner', 0, 2.6, 0, { weapon: 'cannon', turret: true }),
      seat('gunner', 0.6, 3.1, 0.5, { weapon: 'hmg', turret: true, cupola: true }),
    ],
    desc: 'Main battle tank. Slow, nearly immune to small arms.',
  },
  heli: {
    id: 'heli', name: 'Kestrel Helicopter', cls: 'heli', armor: 'light', hp: 1150,
    maxSpeed: 46, reverseSpeed: 12, accel: 12, turnRate: 1.2, halfSize: [1.4, 1.5, 5.2], air: true,
    climbRate: 11, maxAltitude: 220, respawn: 150, minRank: 6,
    seats: [
      seat('driver', 0, 1.3, -2.6),
      seat('gunner', 1.35, 1.4, -0.4, { weapon: 'hmg', turret: true }),
      seat('passenger', -1.1, 1.3, 0.1), seat('passenger', -1.1, 1.3, 1.1),
      seat('passenger', 0.9, 1.3, 1.1), seat('passenger', 0, 1.3, 1.6),
    ],
    desc: 'Transport helicopter with a door gunner. Rapid insertion anywhere.',
  },
  boat: {
    id: 'boat', name: 'Wavecutter Patrol Boat', cls: 'boat', armor: 'light', hp: 800,
    maxSpeed: 24, reverseSpeed: 7, accel: 8, turnRate: 0.9, halfSize: [1.7, 1.0, 4.6], water: true,
    rideHeight: 0.3, respawn: 60, minRank: 2,
    seats: [
      seat('driver', 0, 1.4, -0.6),
      seat('gunner', 0, 1.9, -3.0, { weapon: 'hmg', turret: true }),
      seat('passenger', -0.9, 1.1, 1.4), seat('passenger', 0.9, 1.1, 1.4),
      seat('passenger', -0.9, 1.1, 2.8), seat('passenger', 0.9, 1.1, 2.8),
    ],
    desc: 'Fast patrol boat for the coast and river.',
  },
  gunship: {
    // AI-only air support vehicle used by officer abilities.
    id: 'gunship', name: 'Harrier Gunship', cls: 'heli', armor: 'light', hp: 1400,
    maxSpeed: 40, reverseSpeed: 10, accel: 10, turnRate: 1, halfSize: [1.6, 1.6, 6], air: true,
    climbRate: 10, maxAltitude: 200, respawn: 0, minRank: 99, aiOnly: true,
    seats: [seat('driver', 0, 1.3, -2.6), seat('gunner', 0, 0.6, -3.5, { weapon: 'gunship', turret: true })],
  },
};

export const VEHICLE_IDS = Object.keys(VEHICLES);
