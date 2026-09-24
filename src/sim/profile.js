// Persistent career profile: schema, defaults, migration and sanitising.
import { LEGACY_RANK_MAP, MAX_RANK } from '../shared/config/ranks.js';
import { COUNTRY_IDS } from '../shared/constants.js';

export const PROFILE_VERSION = 3;

export const STAT_KEYS = [
  'kills', 'deaths', 'downs', 'headshots', 'assists', 'revives', 'revived', 'heals', 'resupplies', 'repairs',
  'captures', 'territories', 'defends', 'objectives', 'missions', 'missionsFailed', 'battles', 'operations',
  'leadership', 'service', 'officerService', 'spots', 'supplies', 'valor', 'campaigns', 'vehicleKills',
  'targets', 'rescues', 'recons', 'shots', 'hits', 'rangeBest', 'training', 'ordersIssued', 'ordersFollowed',
  'crew', 'distance', 'promotions',
];

export function defaultProfile(id, name) {
  const stats = {};
  for (const k of STAT_KEYS) stats[k] = 0;
  return {
    v: PROFILE_VERSION,
    id,
    name,
    tokenHash: '',
    created: Date.now(),
    lastSeen: Date.now(),
    rank: 0,
    country: 0, // chosen at enlistment (FACTION id)
    xp: 0,
    credits: 0,
    rating: 0,
    trainingComplete: false,
    trainingSkipped: false,
    stats,
    medals: {},
    unlocks: { camo: ['woodland', 'desert'], headgear: ['helmet'], emote: ['salute', 'attention'], vehicle: ['standard'] },
    cosmetics: { camo: 'woodland', headgear: 'helmet', vehicle: 'standard' },
    loadouts: {},
    lastRole: 'rifleman',
    settings: {},
    record: [],
    ledger: [],
    purchases: [],
  };
}

// Upgrade older profiles and fill missing fields (never throws).
export function migrateProfile(p, id, name) {
  if (!p || typeof p !== 'object') return defaultProfile(id, name);
  const d = defaultProfile(id, name);
  const out = { ...d, ...p };
  out.stats = { ...d.stats, ...(p.stats || {}) };
  out.unlocks = { ...d.unlocks, ...(p.unlocks || {}) };
  for (const k of Object.keys(d.unlocks)) {
    const set = new Set([...(d.unlocks[k] || []), ...((p.unlocks && p.unlocks[k]) || [])]);
    out.unlocks[k] = [...set];
  }
  out.cosmetics = { ...d.cosmetics, ...(p.cosmetics || {}) };
  out.medals = { ...(p.medals || {}) };
  out.loadouts = { ...(p.loadouts || {}) };
  out.record = Array.isArray(p.record) ? p.record.slice(-60) : [];
  out.ledger = Array.isArray(p.ledger) ? p.ledger.slice(-400) : [];
  out.purchases = Array.isArray(p.purchases) ? p.purchases : [];
  if ((p.v || 1) < 2) {
    // v1 -> v2: 'objectives' stat introduced
    out.stats.objectives = (out.stats.captures | 0) + (out.stats.defends | 0);
  }
  if ((p.v || 1) < 3) {
    // v2 -> v3: 21-rank ladder became the full 30-rank hierarchy, three countries
    out.rank = LEGACY_RANK_MAP[Math.max(0, Math.min(20, p.rank | 0))];
    out.country = 0;
  }
  out.rank = Math.max(0, Math.min(MAX_RANK, out.rank | 0));
  if (!COUNTRY_IDS.includes(out.country)) out.country = 0;
  out.v = PROFILE_VERSION;
  if (name && !p.name) out.name = name;
  return out;
}

// Public career summary sent to the owning client.
export function profileView(p) {
  return {
    id: p.id,
    name: p.name,
    rank: p.rank,
    country: p.country,
    xp: p.xp,
    credits: p.credits,
    rating: Math.round(p.rating || 0),
    trainingComplete: p.trainingComplete,
    trainingSkipped: p.trainingSkipped,
    stats: p.stats,
    medals: p.medals,
    unlocks: p.unlocks,
    cosmetics: p.cosmetics,
    loadouts: p.loadouts,
    lastRole: p.lastRole,
    settings: p.settings,
    record: p.record.slice(-30),
    created: p.created,
  };
}

export function sanitizeName(name) {
  if (typeof name !== 'string') return 'Soldier';
  const clean = name.replace(/[^A-Za-z0-9 _\-.]/g, '').trim().slice(0, 18);
  return clean.length >= 2 ? clean : 'Soldier';
}
