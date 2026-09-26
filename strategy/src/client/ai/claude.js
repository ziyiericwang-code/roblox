// Real AI: the page asks Claude (the artifact `sample` capability) on the viewer's own account.
// Everything here degrades to "unavailable" outside a Claude artifact viewer.
import { TERRAIN } from '../../shared/world.js';

let samplePromise = null;
export function getSample() {
  if (!samplePromise) samplePromise = typeof window !== 'undefined' && window.claude && window.claude.use ? window.claude.use('sample').catch(() => null) : Promise.resolve(null);
  return samplePromise;
}

export async function aiLimits() {
  const s = await getSample();
  if (!s) return null;
  return s.limits().catch(() => ({}));
}

// Viewer-facing copy for sample errors.
export function aiError(e) {
  switch (e && e.code) {
    case 'cancelled':
      return '';
    case 'not_granted':
    case 'sampling_disabled':
    case 'not_declared':
    case 'capability_disabled':
    case 'capability_removed':
      return 'Claude is not available for this page. Allow it in the prompt, or check your plan.';
    case 'rate_limited':
      return 'Too many requests right now. Wait a moment and try again.';
    case 'session_expired':
      return 'Sign in to Claude again to continue.';
    case 'refused':
      return 'That request was declined. Try wording it differently.';
    case 'prompt_too_large':
      return 'Too much context. Start a new conversation.';
    case 'invalid_json':
      return 'The reply came back garbled. Try again.';
    default:
      return 'The line dropped. Try again.';
  }
}

const cn = (w, c) => (c >= 0 && w.countries[c] ? w.countries[c].name : 'unknown');
const pn = (w, p) => (p >= 0 && p < w.P ? w.provinces.name[p] : p >= w.P ? w.nameOf(p) : '?');

export function warsOf(v, c) {
  const enemies = new Set();
  for (const war of v.wars) {
    if (war.attackers.includes(c)) war.defenders.forEach((x) => enemies.add(x));
    if (war.defenders.includes(c)) war.attackers.forEach((x) => enemies.add(x));
  }
  return enemies;
}
export function alliesOf(v, c) {
  return new Set(v.alliances.filter(([a, b]) => a === c || b === c).map(([a, b]) => (a === c ? b : a)));
}

// Compact battlefield summary for prompts (kept well under the 64 KiB input limit).
export function situation(world, v) {
  const me = v.me;
  const c = me.country;
  const enemies = [...warsOf(v, c)];
  const allies = [...alliesOf(v, c)];
  const mine = v.formations.filter((f) => f.mine);
  const lines = [
    `Date: ${v.date} (turn ${v.turn + 1}). World tension ${v.tension}/100${v.worldWar ? ', WORLD WAR' : ''}.`,
    `Commander: ${me.rankTitle} ${me.name}, ${cn(world, c)}. Command points ${me.cp}/${me.cpMax}. Orders in use ${me.orders.used}/${me.orders.max}.`,
    `At war with: ${enemies.length ? enemies.map((x) => cn(world, x)).join(', ') : 'nobody'}.`,
    `Allies: ${allies.length ? allies.slice(0, 20).map((x) => cn(world, x)).join(', ') : 'none'}.`,
    `National strength ${Math.round(v.countries[c].power)}; strongest enemy ${enemies.length ? Math.max(...enemies.map((x) => Math.round(v.countries[x].power))) : 0}.`,
    `My formations (${mine.length}): ${mine.slice(0, 40).map((f) => `#${f.id} ${f.name} @${pn(world, f.prov)} ${f.n}el str${Math.round(f.str * 100)}% org${Math.round(f.org * 100)}%${f.battle ? ' IN BATTLE' : ''}${f.order ? ` ->${pn(world, f.order.target)}` : ''}`).join('; ')}.`,
  ];
  const battles = v.battles.filter((b) => b.mine).slice(0, 8);
  if (battles.length) lines.push(`My battles: ${battles.map((b) => `${b.name} (odds ${b.ratio})`).join('; ')}.`);
  const dirs = me.directives.filter((d) => d.status === 'active').slice(0, 5);
  if (dirs.length) lines.push(`Directives from high command: ${dirs.map((d) => d.title).join('; ')}.`);
  const ev = v.events.slice(-6).map((e) => e.title).filter(Boolean);
  if (ev.length) lines.push(`Recent world events: ${ev.join('; ')}.`);
  return lines.join('\n');
}

function neighborInfo(world, v, p) {
  const out = [];
  for (const q of world.neighbors(p)) {
    if (q >= world.P) continue;
    const here = v.formations.filter((f) => f.prov === q);
    const hostile = here.filter((f) => warsOf(v, v.me.country).has(f.owner));
    out.push({
      id: q,
      name: world.provinces.name[q],
      controller: cn(world, v.prov.ctrl[q]),
      terrain: TERRAIN[world.provinces.terrain[q]] || 'plains',
      hostile_units: hostile.length ? hostile.map((f) => (f.n ? `${f.n} elements` : f.size || 'unknown size')).join(', ') : 'none seen',
    });
  }
  return out;
}

// Page functions the Chief of Staff may call. Orders go through the same validated
// command path as a click, so rank limits and the rules still apply.
export function staffTools(world, ctl) {
  const view = () => ctl.view;
  return [
    {
      name: 'list_formations',
      description: 'Returns the formations under my command: id, name, province (id and name), elements, strength, organization, current order.',
      execute() {
        return view()
          .formations.filter((f) => f.mine)
          .slice(0, 60)
          .map((f) => ({ id: f.id, name: f.name, province_id: f.prov, province: pn(world, f.prov), elements: f.n, strength: Math.round(f.str * 100), organization: Math.round(f.org * 100), in_battle: !!f.battle, order: f.order ? `${f.order.type} to ${pn(world, f.order.target)}` : 'none' }));
      },
    },
    {
      name: 'find_province',
      description: 'Finds provinces by (part of) name. Returns up to 6 matches with id, country and controller. Use it to turn a place name into a province id.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      execute({ name }) {
        const q = String(name || '').toLowerCase().trim();
        if (!q) throw new Error('Give a name');
        const hits = [];
        for (let p = 0; p < world.P && hits.length < 6; p++) if (world.provinces.name[p].toLowerCase().includes(q)) hits.push({ id: p, name: world.provinces.name[p], country: cn(world, world.provinces.country[p]), controller: cn(world, view().prov.ctrl[p]) });
        if (!hits.length) {
          const c = world.countries.findIndex((x) => x.name.toLowerCase() === q);
          if (c >= 0) {
            const cap = world.countries[c].capital;
            hits.push({ id: cap, name: world.provinces.name[cap], country: cn(world, c), note: 'capital' });
          }
        }
        return hits.length ? hits : 'No province with that name';
      },
    },
    {
      name: 'province_neighbors',
      description: 'Returns the land provinces bordering a province: id, name, controller, terrain and any hostile units my intelligence can see there.',
      inputSchema: { type: 'object', properties: { province_id: { type: 'integer' } }, required: ['province_id'] },
      execute({ province_id }) {
        const p = Number(province_id);
        if (!(p >= 0 && p < world.P)) throw new Error('Unknown province id');
        return neighborInfo(world, view(), p);
      },
    },
    {
      name: 'order_move',
      description: 'Orders one of my formations to move to (or attack) a province. Returns whether the order was accepted and why not. Only use when the commander asked you to act.',
      inputSchema: { type: 'object', properties: { formation_id: { type: 'integer' }, province_id: { type: 'integer' } }, required: ['formation_id', 'province_id'] },
      async execute({ formation_id, province_id }) {
        const res = await ctl.command({ type: 'move', f: Number(formation_id), to: Number(province_id) }, { quiet: true });
        return res.ok ? `Order accepted: route of ${res.path ? res.path.length - 1 : '?'} steps to ${pn(world, Number(province_id))}.` : `Refused: ${res.reason}`;
      },
    },
    {
      name: 'order_missile_strike',
      description: 'Launches a conventional theatre missile strike (3 Command Points, limited per turn) at an enemy-held province, shattering the organization of enemy units there. Lands when the turn ends. Only when the commander asks for strikes.',
      inputSchema: { type: 'object', properties: { province_id: { type: 'integer' } }, required: ['province_id'] },
      async execute({ province_id }) {
        const res = await ctl.command({ type: 'missile', prov: Number(province_id) }, { quiet: true });
        return res.ok ? `Missile strike queued on ${pn(world, Number(province_id))}; ${res.left} left this turn.` : `Refused: ${res.reason}`;
      },
    },
    {
      name: 'order_posture',
      description: 'Sets a formation posture: "hold" (stop and hold), "digin" (entrench), or "withdraw" (pull out of battle). Returns the result.',
      inputSchema: { type: 'object', properties: { formation_id: { type: 'integer' }, posture: { type: 'string', enum: ['hold', 'digin', 'withdraw'] } }, required: ['formation_id', 'posture'] },
      async execute({ formation_id, posture }) {
        const type = ['hold', 'digin', 'withdraw'].includes(posture) ? posture : 'hold';
        const res = await ctl.command({ type, f: Number(formation_id) }, { quiet: true });
        return res.ok ? `${type} accepted` : `Refused: ${res.reason}`;
      },
    },
  ];
}

export function staffBrief(world, v) {
  return `You are the Chief of Staff in GLOBAL COMMAND, a turn-based 2D grand-strategy war game set in a fictional 2030 on a real world map of 1,222 provinces. You serve the player, the commander named below. Speak like a sharp, loyal staff officer: short sentences, concrete province names, numbers, and a clear recommendation. No roleplay filler, no markdown headings; use at most 6 short bullet lines when listing.

Rules you know: formations move and attack along land borders; attacks across rivers and straits are weaker; entrenched defenders in mountains, forests and cities are strong; encircled units lose supply; each rank limits how many orders the commander can give per turn. Orders take effect when the turn ends.

Use the tools to look things up rather than guessing ids. Nuclear weapons are the head of state's decision alone: never offer to launch them. Only call order_move, order_posture or order_missile_strike when the commander explicitly asks you to act or approves a plan; otherwise recommend. After issuing orders, report exactly what was accepted or refused.

CURRENT SITUATION
${situation(world, v)}`;
}

// Diplomatic hotline: Claude plays a foreign head of government.
export function hotlineBrief(world, v, t) {
  const me = v.me.country;
  const nat = v.countries[t];
  const atWar = warsOf(v, me).has(t);
  const allied = alliesOf(v, me).has(t);
  const their = [...warsOf(v, t)].map((x) => cn(world, x));
  return `Roleplay the head of government of ${cn(world, t)} in GLOBAL COMMAND, a fictional 2030 war-strategy game. The player speaks for ${cn(world, me)} (${v.me.rankTitle} ${v.me.name}).
Your personality: ${nat.personality || 'pragmatic'}. Your opinion of ${cn(world, me)}: ${v.opinionOfMe[t]} (-100 hostile .. 100 friendly). Relationship: ${atWar ? 'AT WAR with them' : allied ? 'allies' : 'no alliance'}. Your wars: ${their.length ? their.join(', ') : 'none'}. Your military strength ${Math.round(nat.power)} vs theirs ${Math.round(v.countries[me].power)}. World tension ${v.tension}/100.
Stay in character: proud, national-interest first, remembers grievances, can be persuaded by respect, concrete offers, or fear, and is insulted by threats from weaker powers. Never break character or mention being an AI. Keep replies under 70 words.
Reply with ONLY a JSON object: {"reply": "<what you say>", "mood": <integer -2..2, how this exchange changed your attitude toward them>}.`;
}

export function newsBrief(world, v) {
  const lt = v.events.slice(-12).map((e) => `${e.title}${e.text ? `: ${e.text}` : ''}`);
  const wars = v.wars.slice(0, 8).map((w) => `${w.name} (score ${w.score})`);
  const hot = v.battles.slice(0, 10).map((b) => `${b.name}: ${cn(world, b.atk)} attacking ${cn(world, b.def)}`);
  return `You are the anchor of WNN, the World News Network, in the fictional 2030 world of the war game GLOBAL COMMAND. Write tonight's bulletin for ${v.date}: exactly 3 headlines, each an ALL-CAPS headline line followed by one vivid sentence. Dramatic but factual to the data below; do not invent battles or wars that are not listed. The viewer commands ${cn(world, v.me.country)}; lead with what matters to them if anything does.
World tension: ${v.tension}/100${v.worldWar ? ' (WORLD WAR)' : ''}.
Wars: ${wars.join('; ') || 'none'}.
Battles this turn: ${hot.join('; ') || 'none'}.
Events: ${lt.join('; ') || 'quiet'}.`;
}

// Crisis Director: Claude invents a crisis with 2-3 trade-off choices; the sim clamps effects.
export function crisisBrief(world, v) {
  const me = v.me.country;
  const related = new Set([...warsOf(v, me), ...alliesOf(v, me)]);
  v.rel.map((r, i) => [r, i]).filter(([, i]) => i !== me && v.countries[i].alive).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).slice(0, 14).forEach(([, i]) => related.add(i));
  const codes = [...related].slice(0, 26).map((i) => `${world.countries[i].iso3}=${world.countries[i].name} (our opinion ${v.rel[i]})`);
  return `You are the Crisis Director of GLOBAL COMMAND, a fictional 2030 war-strategy game. Invent ONE sudden, specific, dramatic crisis for the player's nation that fits the situation below (espionage scandal, border incident, defector, cyberattack, refugee wave, coup rumour, hostage standoff, leaked plans, rogue general, etc.). Name real places. Give 2 or 3 choices with genuine trade-offs, no obviously best option.
${situation(world, v)}
Nations you may involve (ISO3 code = name): ${codes.join('; ')}.
Reply with ONLY JSON:
{"title": "<headline, max 8 words>", "text": "<the situation, max 60 words>", "options": [{"label": "<max 6 words>", "outcome": "<what happens, max 25 words>", "effects": {"tension": <int -6..6>, "stability": <int -8..8>, "treasury": <int -15..15>, "target": "<ISO3 from the list or empty>", "opinion": <int -10..10, how target's opinion of us changes>}}]}`;
}
