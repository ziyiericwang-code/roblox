// Squad roles. Each role is useful in a different way and brings its own gear.
// Slots: 0 primary, 1 sidearm, 2 equipment, 3 equipment/throwable, 4 throwable

export const ROLES = {
  rifleman: {
    id: 'rifleman', name: 'Rifleman', icon: 'R', minRank: 0, perSquad: 99,
    primaries: ['ar7', 'br4'], sidearms: ['p9', 'r45'],
    gear: ['frag', 'smoke'], armor: 50,
    blurb: 'Backbone of the army. Extra armor and grenades. Captures objectives faster.',
    perks: { captureMult: 1.25, grenades: 3 },
  },
  medic: {
    id: 'medic', name: 'Medic', icon: 'M', minRank: 1, perSquad: 2,
    primaries: ['smg5', 'ar7'], sidearms: ['p9', 'r45'],
    gear: ['medkit', 'smoke'], armor: 30,
    blurb: 'Heals the wounded and revives the downed. Squads live or die by their medic.',
    perks: { reviveMult: 2.2, selfRegenCap: 100 },
  },
  engineer: {
    id: 'engineer', name: 'Engineer', icon: 'E', minRank: 2, perSquad: 2,
    primaries: ['smg5', 'sg12'], sidearms: ['p9', 'r45'],
    gear: ['rl3', 'repair', 'charge'], armor: 35,
    blurb: 'Destroys armor and targets, repairs vehicles and fortifications.',
    perks: {},
  },
  support: {
    id: 'support', name: 'Support', icon: 'S', minRank: 2, perSquad: 2,
    primaries: ['lmg9'], sidearms: ['p9', 'r45'],
    gear: ['ammobag', 'frag'], armor: 50,
    blurb: 'Suppressive fire and ammunition for the squad.',
    perks: {},
  },
  scout: {
    id: 'scout', name: 'Scout', icon: 'Sc', minRank: 3, perSquad: 1,
    primaries: ['dmr24', 'sr50'], sidearms: ['p9', 'r45'],
    gear: ['binoculars', 'smoke'], armor: 20,
    blurb: 'Long range marksman. Spots enemies for everyone and runs recon.',
    perks: { spotMult: 1.5, reconMult: 1.6 },
  },
  leader: {
    id: 'leader', name: 'Squad Leader', icon: 'SL', minRank: 4, perSquad: 1, leaderOnly: true,
    primaries: ['ar7', 'br4'], sidearms: ['p9', 'r45'],
    gear: ['binoculars', 'smoke'], armor: 40,
    blurb: 'Commands the squad, sets objectives, places rally points. Squad can spawn on you.',
    perks: {},
  },
};

export const ROLE_IDS = Object.keys(ROLES);

// Validates and builds a concrete loadout for a role. Returns {weapons:[ids], armor}.
export function buildLoadout(roleId, choice, rankIndex, weaponsTable) {
  const role = ROLES[roleId] || ROLES.rifleman;
  const pickAllowed = (list, wanted) => {
    const allowed = list.filter((id) => weaponsTable[id] && (weaponsTable[id].minRank || 0) <= rankIndex);
    if (wanted && allowed.includes(wanted)) return wanted;
    return allowed[0] || list[0];
  };
  const weapons = [
    pickAllowed(role.primaries, choice && choice.primary),
    pickAllowed(role.sidearms, choice && choice.sidearm),
  ];
  for (const g of role.gear) {
    const w = weaponsTable[g];
    if (!w) continue;
    if ((w.minRank || 0) > rankIndex) continue;
    weapons.push(g);
  }
  return { weapons, armor: role.armor };
}
