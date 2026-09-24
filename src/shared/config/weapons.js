// Fictional weapon & equipment definitions. Numbers are tuned for game feel,
// not realism. Spread and recoil angles are in degrees.

export const WEAPON_CLASS = {
  RIFLE: 'rifle',
  CARBINE: 'carbine',
  SMG: 'smg',
  LMG: 'lmg',
  DMR: 'dmr',
  SNIPER: 'sniper',
  SHOTGUN: 'shotgun',
  PISTOL: 'pistol',
  LAUNCHER: 'launcher',
  GRENADE: 'grenade',
  GADGET: 'gadget',
  VEHICLE: 'vehicle',
};

const base = {
  pellets: 1,
  headMult: 2.0,
  limbMult: 0.8,
  auto: false,
  burst: 0,
  adsFov: 52,
  moveSpreadAdd: 1.2,
  crouchMult: 0.8,
  proneMult: 0.55,
  bloomPerShot: 0.25,
  bloomMax: 2.5,
  bloomRecover: 6,
  recoilRecover: 7,
  minDamageMult: 0.55,
  suppression: 0.22,
  vehicleMult: 0.25,
  tracerEvery: 3,
  equipTime: 0.45,
};

function gun(def) {
  return { ...base, kind: 'gun', ...def };
}

export const WEAPONS = {
  ar7: gun({
    id: 'ar7', name: 'AR-7 Carbine', cls: WEAPON_CLASS.CARBINE, slot: 0, sound: 'rifle', model: 'rifle',
    damage: 25, rpm: 660, mag: 30, reserve: 150, reload: 2.1, range: 260, falloffStart: 55, falloffEnd: 190,
    spreadHip: 2.6, spreadAds: 0.35, recoilV: 0.85, recoilH: 0.35, auto: true, minRank: 1,
    desc: 'Reliable automatic carbine. Balanced at every range.',
  }),
  br4: gun({
    id: 'br4', name: 'BR-4 Battle Rifle', cls: WEAPON_CLASS.RIFLE, slot: 0, sound: 'battle', model: 'battle',
    damage: 36, rpm: 460, mag: 20, reserve: 100, reload: 2.4, range: 320, falloffStart: 80, falloffEnd: 260,
    spreadHip: 2.9, spreadAds: 0.25, recoilV: 1.5, recoilH: 0.4, burst: 3, minRank: 4, adsFov: 46,
    desc: 'Three-round burst rifle with heavy stopping power.',
  }),
  smg5: gun({
    id: 'smg5', name: 'SMG-5 Viper', cls: WEAPON_CLASS.SMG, slot: 0, sound: 'smg', model: 'smg',
    damage: 19, rpm: 860, mag: 32, reserve: 192, reload: 1.8, range: 150, falloffStart: 25, falloffEnd: 90,
    spreadHip: 2.0, spreadAds: 0.6, recoilV: 0.55, recoilH: 0.45, auto: true, minRank: 1, moveSpreadAdd: 0.6,
    desc: 'Compact and fast. Excellent up close and on the move.',
  }),
  lmg9: gun({
    id: 'lmg9', name: 'LMG-9 Squad Gun', cls: WEAPON_CLASS.LMG, slot: 0, sound: 'lmg', model: 'lmg',
    damage: 24, rpm: 600, mag: 100, reserve: 300, reload: 4.6, range: 280, falloffStart: 60, falloffEnd: 220,
    spreadHip: 3.8, spreadAds: 0.55, recoilV: 0.75, recoilH: 0.5, auto: true, minRank: 2, suppression: 0.4,
    crouchMult: 0.65, proneMult: 0.35, bloomMax: 3.5, equipTime: 0.8,
    desc: 'Sustained suppressive fire. Deadly when set up prone.',
  }),
  dmr24: gun({
    id: 'dmr24', name: 'M-24 Marksman', cls: WEAPON_CLASS.DMR, slot: 0, sound: 'dmr', model: 'dmr',
    damage: 52, headMult: 2.3, rpm: 280, mag: 12, reserve: 72, reload: 2.5, range: 450, falloffStart: 150, falloffEnd: 400,
    spreadHip: 4.5, spreadAds: 0.08, recoilV: 2.4, recoilH: 0.5, minRank: 3, adsFov: 26, scoped: true, minDamageMult: 0.75,
    desc: 'Semi-automatic precision rifle with variable optic.',
  }),
  sr50: gun({
    id: 'sr50', name: 'SR-50 Longbow', cls: WEAPON_CLASS.SNIPER, slot: 0, sound: 'sniper', model: 'sniper',
    damage: 95, headMult: 2.5, rpm: 48, mag: 5, reserve: 30, reload: 3.2, range: 650, falloffStart: 250, falloffEnd: 600,
    spreadHip: 6, spreadAds: 0.03, recoilV: 4.5, recoilH: 0.6, minRank: 5, adsFov: 18, scoped: true, minDamageMult: 0.85,
    suppression: 0.6, equipTime: 0.8,
    desc: 'Bolt-action long range rifle. One shot, one objective.',
  }),
  sg12: gun({
    id: 'sg12', name: 'SG-12 Breacher', cls: WEAPON_CLASS.SHOTGUN, slot: 0, sound: 'shotgun', model: 'shotgun',
    damage: 13, pellets: 9, headMult: 1.4, rpm: 95, mag: 7, reserve: 42, reload: 3.0, range: 60, falloffStart: 10, falloffEnd: 40,
    spreadHip: 5.5, spreadAds: 4.0, recoilV: 3.5, recoilH: 1.0, minRank: 2, minDamageMult: 0.2, moveSpreadAdd: 0.4,
    desc: 'Pump shotgun for clearing buildings and trenches.',
  }),
  p9: gun({
    id: 'p9', name: 'P-9 Sidearm', cls: WEAPON_CLASS.PISTOL, slot: 1, sound: 'pistol', model: 'pistol',
    damage: 22, rpm: 420, mag: 15, reserve: 60, reload: 1.5, range: 120, falloffStart: 20, falloffEnd: 70,
    spreadHip: 1.8, spreadAds: 0.6, recoilV: 1.2, recoilH: 0.5, minRank: 0, equipTime: 0.3, adsFov: 60,
    desc: 'Standard issue sidearm.',
  }),
  r45: gun({
    id: 'r45', name: 'R-45 Revolver', cls: WEAPON_CLASS.PISTOL, slot: 1, sound: 'revolver', model: 'revolver',
    damage: 46, rpm: 160, mag: 6, reserve: 36, reload: 2.6, range: 140, falloffStart: 25, falloffEnd: 90,
    spreadHip: 1.9, spreadAds: 0.35, recoilV: 3.2, recoilH: 0.7, minRank: 6, equipTime: 0.35, adsFov: 58,
    desc: 'Heavy revolver for senior NCOs and officers.',
  }),
  rl3: {
    ...base, kind: 'launcher', id: 'rl3', name: 'RL-3 Launcher', cls: WEAPON_CLASS.LAUNCHER, slot: 2, sound: 'rocket', model: 'launcher',
    mag: 1, reserve: 3, reload: 3.4, rpm: 60, projectile: 'rocket', speed: 75, gravity: 2.2, splash: 5.5, splashDamage: 105,
    vehicleDamage: 360, spreadHip: 3, spreadAds: 0.4, recoilV: 4, recoilH: 1, adsFov: 50, minRank: 2, equipTime: 0.9,
    desc: 'Anti-armor rocket. Devastating against vehicles and fortifications.',
  },
  frag: {
    kind: 'throwable', id: 'frag', name: 'Frag Grenade', cls: WEAPON_CLASS.GRENADE, slot: 3, count: 2, fuse: 3.2,
    splash: 7, splashDamage: 125, vehicleDamage: 80, throwSpeed: 19, minRank: 1, sound: 'explosion',
    desc: 'Cook it, throw it, clear the position.',
  },
  smoke: {
    kind: 'throwable', id: 'smoke', name: 'Smoke Grenade', cls: WEAPON_CLASS.GRENADE, slot: 3, count: 2, fuse: 1.6,
    smokeRadius: 11, smokeTime: 26, throwSpeed: 18, minRank: 1,
    desc: 'Blocks line of sight for friendlies and enemies alike.',
  },
  medkit: {
    kind: 'gadget', id: 'medkit', name: 'Field Medkit', cls: WEAPON_CLASS.GADGET, slot: 2, uses: 12,
    healPerSec: 22, reviveTime: 2.6, range: 3, minRank: 1,
    desc: 'Heal wounded soldiers and revive the downed quickly.',
  },
  ammobag: {
    kind: 'gadget', id: 'ammobag', name: 'Ammo Pack', cls: WEAPON_CLASS.GADGET, slot: 2, uses: 4, cooldown: 12,
    radius: 6, lifetime: 45, minRank: 2,
    desc: 'Drop an ammunition pack that resupplies nearby soldiers and restores armor.',
  },
  repair: {
    kind: 'gadget', id: 'repair', name: 'Repair Tool', cls: WEAPON_CLASS.GADGET, slot: 2, repairPerSec: 60, range: 5, minRank: 2,
    desc: 'Repair vehicles and fortifications.',
  },
  charge: {
    kind: 'gadget', id: 'charge', name: 'Demolition Charge', cls: WEAPON_CLASS.GADGET, slot: 3, count: 2, plantTime: 3,
    fuse: 6, splash: 8, splashDamage: 150, vehicleDamage: 500, targetDamage: 600, minRank: 2,
    desc: 'Plant on enemy targets and vehicles. Detonates after a short fuse.',
  },
  binoculars: {
    kind: 'gadget', id: 'binoculars', name: 'Binoculars', cls: WEAPON_CLASS.GADGET, slot: 2, spotRange: 400, spotTime: 20, cooldown: 4,
    adsFov: 18, minRank: 1,
    desc: 'Spot enemies for your whole army. Required for reconnaissance.',
  },
  // ---------------------------------------------------------------- vehicle weapons
  hmg: gun({
    id: 'hmg', name: 'Heavy Machine Gun', cls: WEAPON_CLASS.VEHICLE, slot: 9, sound: 'hmg', model: 'none',
    damage: 30, rpm: 540, mag: 120, reserve: 99999, reload: 4.2, range: 380, falloffStart: 120, falloffEnd: 340,
    spreadHip: 1.2, spreadAds: 0.8, recoilV: 0.3, recoilH: 0.3, auto: true, vehicleMult: 0.45, suppression: 0.5,
  }),
  autocannon: gun({
    id: 'autocannon', name: '30mm Autocannon', cls: WEAPON_CLASS.VEHICLE, slot: 9, sound: 'autocannon', model: 'none',
    damage: 42, rpm: 200, mag: 40, reserve: 99999, reload: 5, range: 420, falloffStart: 200, falloffEnd: 400,
    spreadHip: 0.8, spreadAds: 0.5, recoilV: 0.5, recoilH: 0.2, auto: true, splash: 2.5, splashDamage: 30, vehicleMult: 1.0,
    vehicleDamageFlat: 45, suppression: 0.7,
  }),
  cannon: {
    ...base, kind: 'launcher', id: 'cannon', name: '105mm Cannon', cls: WEAPON_CLASS.VEHICLE, slot: 9, sound: 'cannon',
    mag: 1, reserve: 99999, reload: 4.2, rpm: 14, projectile: 'shell', speed: 160, gravity: 3, splash: 7, splashDamage: 130,
    vehicleDamage: 430, spreadHip: 0.25, spreadAds: 0.2, recoilV: 1, recoilH: 0.2, suppression: 1,
  },
  gunship: gun({
    id: 'gunship', name: 'Gunship Cannon', cls: WEAPON_CLASS.VEHICLE, slot: 9, sound: 'autocannon', model: 'none',
    damage: 55, rpm: 240, mag: 999, reserve: 99999, reload: 1, range: 600, falloffStart: 400, falloffEnd: 600,
    spreadHip: 1.4, spreadAds: 1.4, recoilV: 0, recoilH: 0, auto: true, splash: 3.5, splashDamage: 45, vehicleMult: 1.0,
    vehicleDamageFlat: 60, suppression: 1,
  }),
};

// Role loadouts reference these ids. Slot layout for a soldier:
//   0 primary, 1 sidearm, 2 gadget/launcher, 3 throwable
export const SLOT_NAMES = ['Primary', 'Sidearm', 'Equipment', 'Grenade'];

export function weaponById(id) {
  return WEAPONS[id] || null;
}

// Effective spread in degrees for a shot given shooter state.
export function computeSpread(w, st) {
  if (!w || w.kind === 'throwable' || w.kind === 'gadget') return 0;
  let s = st.ads ? w.spreadAds : w.spreadHip;
  const speed = st.speed || 0;
  if (speed > 0.5) s += (w.moveSpreadAdd || 1) * Math.min(1, speed / 5) * (st.ads ? 0.5 : 1);
  if (!st.grounded) s += 3;
  if (st.stance === 1) s *= w.crouchMult || 0.8;
  else if (st.stance === 2) s *= w.proneMult || 0.55;
  s += st.bloom || 0;
  s *= 1 + (st.suppression || 0) * 0.8;
  return s;
}

// Damage falloff multiplier for distance d.
export function falloff(w, d) {
  if (!w.falloffStart) return 1;
  if (d <= w.falloffStart) return 1;
  if (d >= w.falloffEnd) return w.minDamageMult;
  const t = (d - w.falloffStart) / (w.falloffEnd - w.falloffStart);
  return 1 + (w.minDamageMult - 1) * t;
}
