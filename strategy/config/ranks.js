// The 52-level career. Each row is real authority, not decoration.
// elements/formations: direct command capacity (Infinity = everything the node covers)
// orders: active orders per turn; area: operational area (hops from HQ, or a named scope)
// cp: Command Points per turn; cl: intelligence clearance; unlock: capabilities added at this rank
// gate: achievement required to be promoted *from* this rank to the next

const INF = 1e9;
export const RANKS = [
  // I ENLISTED — detachment
  { name: 'Recruit', short: 'RCT', tier: 'Enlisted', elements: 2, formations: 1, orders: 1, area: 1, cp: 0, cl: 0, unlock: ['move', 'hold'], text: 'Move and hold with your detachment.' },
  { name: 'Private', short: 'PVT', tier: 'Enlisted', elements: 2, formations: 1, orders: 2, area: 1, cp: 0, cl: 0, unlock: ['attack', 'forecast'], text: 'Attack orders and battle forecasts.' },
  { name: 'Private First Class', short: 'PFC', tier: 'Enlisted', elements: 3, formations: 1, orders: 2, area: 1, cp: 0, cl: 0, unlock: ['digin', 'fortify1'], text: 'Dig in; build level-1 field fortifications.' },
  { name: 'Specialist', short: 'SPC', tier: 'Enlisted', elements: 3, formations: 1, orders: 2, area: 2, cp: 0, cl: 0, unlock: ['recon'], text: 'Recon probes reveal enemy strength next door.' },
  { name: 'Lance Corporal', short: 'LCPL', tier: 'Enlisted', elements: 4, formations: 1, orders: 3, area: 2, cp: 2, cl: 0, unlock: ['cp', 'resupply'], text: 'Command Points; request resupply.' },
  { name: 'Corporal', short: 'CPL', tier: 'Enlisted', elements: 4, formations: 2, orders: 3, area: 2, cp: 2, cl: 0, unlock: ['split', 'merge'], text: 'Command a second formation; split and merge.' },
  { name: 'Master Corporal', short: 'MCPL', tier: 'Enlisted', elements: 5, formations: 2, orders: 3, area: 2, cp: 3, cl: 0, unlock: ['waypoints'], text: 'Multi-province routes with waypoints.', gate: { battlesWon: 2, alt: 6, text: 'Win 2 battles (or complete 6 directives in peacetime)' } },
  // II NCO — company group
  { name: 'Sergeant', short: 'SGT', tier: 'NCO', elements: 6, formations: 2, orders: 3, area: 3, cp: 3, cl: 0, unlock: ['artillery'], text: 'Call in artillery support.' },
  { name: 'Staff Sergeant', short: 'SSG', tier: 'NCO', elements: 6, formations: 2, orders: 4, area: 3, cp: 3, cl: 0, unlock: ['mech'], text: 'Motorized and mechanized elements.' },
  { name: 'Sergeant First Class', short: 'SFC', tier: 'NCO', elements: 8, formations: 2, orders: 4, area: 3, cp: 4, cl: 0, unlock: ['withdraw'], text: 'Withdraw orders and retreat triggers.' },
  { name: 'Master Sergeant', short: 'MSG', tier: 'NCO', elements: 8, formations: 3, orders: 4, area: 3, cp: 4, cl: 0, unlock: ['reinforcePriority', 'transfer'], text: 'Reinforcement priority; transfer elements.' },
  { name: 'First Sergeant', short: '1SG', tier: 'NCO', elements: 10, formations: 3, orders: 4, area: 4, cp: 4, cl: 0, unlock: ['concentric'], text: 'Coordinated attacks from several provinces.' },
  { name: 'Sergeant Major', short: 'SGM', tier: 'NCO', elements: 10, formations: 3, orders: 5, area: 4, cp: 5, cl: 1, unlock: ['art', 'ad'], text: 'Artillery and air-defense elements; clearance 1.' },
  { name: 'Command Sergeant Major', short: 'CSM', tier: 'NCO', elements: 12, formations: 3, orders: 5, area: 4, cp: 5, cl: 1, unlock: ['lines'], text: 'Draw defensive lines.', gate: { supplyTurns: 5, alt: 10, text: 'Keep your forces supplied for 5 turns' } },
  // III WARRANT — specialist staff
  { name: 'Warrant Officer 1', short: 'WO1', tier: 'Warrant', elements: 12, formations: 3, orders: 5, area: 4, cp: 5, cl: 2, unlock: ['supplyMap'], text: 'Supply map, supply routes and forecasts.' },
  { name: 'Chief Warrant Officer 2', short: 'CW2', tier: 'Warrant', elements: 12, formations: 4, orders: 5, area: 4, cp: 6, cl: 2, unlock: ['depot'], text: 'Build field depots.' },
  { name: 'Chief Warrant Officer 3', short: 'CW3', tier: 'Warrant', elements: 14, formations: 4, orders: 5, area: 5, cp: 6, cl: 2, unlock: ['fortify2', 'repair', 'bridging'], text: 'Forts level 2, repairs and bridging.' },
  { name: 'Chief Warrant Officer 4', short: 'CW4', tier: 'Warrant', elements: 14, formations: 4, orders: 5, area: 5, cp: 6, cl: 2, unlock: ['deepRecon', 'sf'], text: 'Deep reconnaissance; special forces.' },
  { name: 'Chief Warrant Officer 5', short: 'CW5', tier: 'Warrant', elements: 16, formations: 4, orders: 6, area: 5, cp: 7, cl: 2, unlock: ['forecastFull'], text: 'Full forecast breakdown with confidence.', gate: { directives: 12, text: 'Complete 12 directives' } },
  // IV COMPANY-GRADE OFFICERS — task force
  { name: 'Officer Cadet', short: 'OCDT', tier: 'Officer', elements: 16, formations: 4, orders: 6, area: 5, cp: 7, cl: 2, unlock: ['operations'], text: 'Named operations with a preparation bonus.' },
  { name: 'Second Lieutenant', short: '2LT', tier: 'Officer', elements: 18, formations: 4, orders: 6, area: 5, cp: 7, cl: 2, unlock: ['armor'], text: 'Armor elements.' },
  { name: 'First Lieutenant', short: '1LT', tier: 'Officer', elements: 20, formations: 5, orders: 6, area: 6, cp: 8, cl: 2, unlock: ['fallback', 'exploit'], text: 'Fallback positions and exploitation.' },
  { name: 'Captain', appt: 'Company Commander', short: 'CPT', tier: 'Officer', elements: 24, formations: 5, orders: 7, area: 6, cp: 8, cl: 2, unlock: ['cas'], text: 'Request close air support.' },
  { name: 'Captain', appt: 'Battalion Operations Officer', short: 'CPT', tier: 'Officer', elements: 24, formations: 5, orders: 7, area: 6, cp: 9, cl: 2, unlock: ['opsMulti'], text: 'Operations with up to 3 objectives.', gate: { operations: 1, text: 'Complete a named operation' } },
  // V FIELD-GRADE — battalion to brigade
  { name: 'Major', appt: 'Battalion Executive Officer', short: 'MAJ', tier: 'Field', elements: 30, formations: 6, orders: 7, area: 'region', cp: 9, cl: 3, unlock: ['airMap'], text: 'Your area becomes a whole region; clearance 3.' },
  { name: 'Major', appt: 'Brigade Operations Officer', short: 'MAJ', tier: 'Field', elements: 30, formations: 6, orders: 8, area: 'region', cp: 10, cl: 3, unlock: ['assignFront'], text: 'Assign formations to front sectors.' },
  { name: 'Lieutenant Colonel', appt: 'Battalion Commander', short: 'LTC', tier: 'Field', elements: 36, formations: 6, orders: 8, area: 'region+', cp: 10, cl: 3, unlock: ['supplyPriority'], text: 'Supply priority per formation.' },
  { name: 'Lieutenant Colonel', appt: 'Brigade Deputy Commander', short: 'LTC', tier: 'Field', elements: 40, formations: 7, orders: 8, area: 'region+', cp: 11, cl: 3, unlock: ['hub', 'aiSub1'], text: 'Build logistics hubs; first AI subordinate.' },
  { name: 'Colonel', appt: 'Regimental Commander', short: 'COL', tier: 'Field', elements: 48, formations: 7, orders: 9, area: 'regions2', cp: 11, cl: 3, unlock: ['objectives'], text: 'Offensive objectives on fronts.' },
  { name: 'Colonel', appt: 'Brigade Commander', short: 'COL', tier: 'Field', elements: 60, formations: 8, orders: 9, area: 'regions2', cp: 12, cl: 3, unlock: ['radar', 'fireplan'], text: 'Fire plans; build radar sites.' },
  { name: 'Senior Colonel', appt: 'Division Chief of Staff', short: 'SCOL', tier: 'Field', elements: 60, formations: 8, orders: 10, area: 'regions2', cp: 12, cl: 4, unlock: ['phasedOps'], text: 'Phased operations; clearance 4.', gate: { opsWon: 2, text: 'Win 2 operations' } },
  // VI GENERAL OFFICERS — division to army
  { name: 'Brigadier General', appt: 'Asst. Division Commander (Maneuver)', short: 'BG', tier: 'General', elements: 80, formations: 9, orders: 10, area: 'regions3', cp: 13, cl: 4, unlock: ['pincer', 'aiSub3'], text: 'Encirclement template; 3 AI subordinates.' },
  { name: 'Brigadier General', appt: 'Asst. Division Commander (Support)', short: 'BG', tier: 'General', elements: 80, formations: 9, orders: 10, area: 'regions3', cp: 13, cl: 4, unlock: ['armyBase', 'advise'], text: 'Build army bases; advise national command.' },
  { name: 'Major General', appt: 'Division Commander', short: 'MG', tier: 'General', elements: 120, formations: 10, orders: 11, area: 'regions4', cp: 14, cl: 4, unlock: ['airTasking'], text: 'Set air mission priorities over your area.' },
  { name: 'Major General', appt: 'Deputy Corps Commander', short: 'MG', tier: 'General', elements: 150, formations: 10, orders: 11, area: 'regions4', cp: 14, cl: 4, unlock: ['airlift', 'airbase'], text: 'Airlift and paradrop; build airbases.' },
  { name: 'Lieutenant General', appt: 'Corps Commander', short: 'LTG', tier: 'General', elements: 250, formations: 12, orders: 12, area: 'front', cp: 15, cl: 5, unlock: ['frontCommand'], text: 'Command an entire front.' },
  { name: 'Lieutenant General', appt: 'Deputy Army Commander', short: 'LTG', tier: 'General', elements: 350, formations: 12, orders: 12, area: 'front', cp: 15, cl: 5, unlock: ['airWings'], text: 'Direct control of air wings.', gate: { frontTurns: 10, alt: 40, text: 'Hold or advance a front for 10 turns (or 40 directives)' } },
  // VII SENIOR COMMAND — army to theater
  { name: 'General', appt: 'Field Army Commander', short: 'GEN', tier: 'Senior', elements: 500, formations: 14, orders: 13, area: 'front+', cp: 16, cl: 5, unlock: ['railMove'], text: 'Strategic rail redeployment.' },
  { name: 'General', appt: 'Army Group Commander', short: 'GEN', tier: 'Senior', elements: 900, formations: 16, orders: 14, area: 'fronts2', cp: 17, cl: 5, unlock: ['multiFront'], text: 'Command two fronts.' },
  { name: 'General', appt: 'Land Component Commander', short: 'GEN', tier: 'Senior', elements: 1400, formations: 18, orders: 15, area: 'theater', cp: 18, cl: 5, unlock: ['navalSupport', 'satellite'], text: 'Naval gunfire support; satellite tasking.' },
  { name: 'General', appt: 'Theater Commander', short: 'GEN', tier: 'Senior', elements: 2200, formations: 22, orders: 16, area: 'theater', cp: 19, cl: 6, unlock: ['navy'], text: 'Command fleets in theater waters.' },
  { name: 'General', appt: 'Joint Theater Commander', short: 'GEN', tier: 'Senior', elements: 3000, formations: 26, orders: 17, area: 'theater', cp: 20, cl: 6, unlock: ['amphibious'], text: 'Amphibious and airborne operations.' },
  { name: 'General', appt: 'Combatant Commander', short: 'GEN', tier: 'Senior', elements: 4000, formations: 30, orders: 18, area: 'continent', cp: 21, cl: 6, unlock: ['strategicBuild'], text: 'Strategic construction: rail, ports, naval bases.', gate: { theaterWin: 1, alt: 55, text: 'Win a war, capture 12 provinces, or complete 55 directives' } },
  // VIII NATIONAL COMMAND
  { name: 'Vice Chief of the Army Staff', short: 'VCAS', tier: 'National', elements: 6000, formations: 40, orders: 18, area: 'nation', cp: 22, cl: 7, unlock: ['productionAdvice'], text: 'National army view; production priorities.' },
  { name: 'Chief of the Army Staff', short: 'CAS', tier: 'National', elements: 9000, formations: 60, orders: 20, area: 'nation', cp: 24, cl: 7, unlock: ['forceStructure'], text: 'Create and disband formations.' },
  { name: 'Vice Chief of the Defence Staff', short: 'VCDS', tier: 'National', elements: INF, formations: 80, orders: 22, area: 'nation', cp: 26, cl: 7, unlock: ['navalCommand', 'bombing'], text: 'National air force and navy.' },
  { name: 'Chief of the Defence Staff', short: 'CDS', tier: 'National', elements: INF, formations: 120, orders: 24, area: 'nation', cp: 28, cl: 8, unlock: ['production'], text: 'Full production control; clearance 8.' },
  { name: 'General of the Army', short: 'GOA', tier: 'National', elements: INF, formations: 200, orders: 26, area: 'global', cp: 30, cl: 8, unlock: ['militaryDiplomacy', 'mobilization'], text: 'Military access, ceasefires, mobilization.' },
  { name: 'Marshal', short: 'MSHL', tier: 'National', elements: INF, formations: 400, orders: 28, area: 'global', cp: 32, cl: 9, unlock: ['pressure', 'emergency'], text: 'Ultimatums, exercises and national emergencies.', gate: { warWon: 1, alt: 75, text: 'Win a war, capture 30 provinces, or complete 75 directives' } },
  { name: 'Supreme Commander', appt: 'of the Armed Forces', short: 'SUP', tier: 'National', elements: INF, formations: INF, orders: 40, area: 'global', cp: 36, cl: 9, unlock: ['diplomacy', 'economy', 'war'], text: 'Full national authority: war, peace, alliances, economy.' },
  // IX COALITION
  { name: 'Coalition Deputy Commander', short: 'CDC', tier: 'Coalition', elements: INF, formations: INF, orders: 44, area: 'global', cp: 40, cl: 10, unlock: ['coalitionView'], text: 'See allied forces; propose joint operations.' },
  { name: 'Supreme Allied Commander', short: 'SAC', tier: 'Coalition', elements: INF, formations: INF, orders: 50, area: 'global', cp: 45, cl: 10, unlock: ['coalitionCommand'], text: 'Allies commit forces to your operations.' },
];

// XP needed to reach rank i+1 from rank i
export function xpToNext(i) {
  return Math.round(60 * Math.pow(1.095, i));
}

// Capabilities available at rank index i (cumulative)
const cumulative = [];
{
  const acc = new Set();
  RANKS.forEach((r) => {
    for (const u of r.unlock) acc.add(u);
    cumulative.push(new Set(acc));
  });
}
export function capabilities(i) {
  return cumulative[Math.max(0, Math.min(RANKS.length - 1, i))];
}
export function rankTitle(i) {
  const r = RANKS[i];
  return r.appt ? `${r.name} — ${r.appt}` : r.name;
}

// Start-rank choices offered in the campaign setup
export const START_RANKS = [
  { label: 'Recruit (full career)', rank: 0 },
  { label: 'Second Lieutenant', rank: 20 },
  { label: 'Colonel', rank: 29 },
  { label: 'Major General', rank: 34 },
  { label: 'Supreme Commander (control everything)', rank: 49 },
];
