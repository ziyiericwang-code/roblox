// Title screen and campaign setup (country picked directly on the world map).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { store, useStore } from '../state/store.js';
import { MILITARY, estimateMilitary } from '../../../config/military.js';
import { SCENARIOS, BLOCS, RIVALRIES, PERSONALITY_OF, PERSONALITIES, START_DATE } from '../../../config/scenario.js';
import { START_RANKS, RANKS } from '../../../config/ranks.js';
import { fmt, Btn } from './common.jsx';

const SCRAMBLE = 'ABCDEFGHJKLMNPQRSTVWXYZ0123456789#%&/';

// Letters decrypt left to right on load.
function Decrypt({ text, delay = 0 }) {
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [out, setOut] = useState(reduced ? text : text.replace(/\S/g, '·'));
  useEffect(() => {
    if (reduced) return undefined;
    const t0 = performance.now() + delay;
    const id = setInterval(() => {
      const k = (performance.now() - t0) / 650;
      if (k >= 1) {
        setOut(text);
        clearInterval(id);
        return;
      }
      const n = Math.max(0, Math.floor(k * text.length));
      setOut(text.slice(0, n) + [...text.slice(n)].map((c) => (c === ' ' ? ' ' : k < 0 ? '·' : SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0])).join(''));
    }, 32);
    return () => clearInterval(id);
  }, [text]);
  return <span aria-label={text}>{out}</span>;
}

// Intercepted traffic for the ticker, built from the real rivalries and capitals.
function intel(world) {
  const cap = (iso) => {
    const c = world.countryByIso.get(iso);
    return c === undefined ? null : { name: world.countries[c].name, city: world.provinces.name[world.countries[c].capital] };
  };
  let seed = 7;
  const rnd = (n) => {
    seed = (seed * 16807) % 2147483647;
    return seed % n;
  };
  const kinds = [
    (a, b) => `SIGINT · ${a.name} ↔ ${b.name} · military radio traffic up ${12 + rnd(70)}%`,
    (a, b) => `IMINT · armored columns moving toward the ${b.name} border`,
    (a) => `NAVINT · ${a.name} surface group left port, heading unknown`,
    (a) => `HUMINT · ${a.city}: reservists recalled overnight`,
    (a, b) => `ELINT · ${b.name} air-defence radars switched to active`,
    (a) => `OSINT · fuel rationing reported in ${a.city}`,
    (a, b) => `DIPLO · ${a.name} recalls its ambassador from ${b.name}`,
  ];
  const out = [];
  for (const [x, y] of RIVALRIES) {
    const a = cap(x);
    const b = cap(y);
    if (!a || !b) continue;
    out.push(kinds[rnd(kinds.length)](a, b));
    if (out.length >= 16) break;
  }
  return out;
}

export function TitleScreen({ app }) {
  const saves = useStore((s) => s.saves);
  const ai = useStore((s) => s.ai);
  const world = app.world;
  const feed = useMemo(() => intel(world), [world]);
  const last = saves && saves[0];
  const nations = world.countries.filter((c, i) => world.provincesOf[i].length).length;
  return (
    <div class="title-screen war">
      <div class="war-vignette" aria-hidden="true" />
      <header class="war-head">
        <div class="classif">
          <span class="blink">●</span> TOP SECRET // STRATEGIC COMMAND // {String(START_DATE.day).padStart(2, '0')} JAN {START_DATE.year}
        </div>
        <h1 class="war-title">
          <span class="l1">
            <Decrypt text="GLOBAL" />
          </span>
          <span class="l2">
            <Decrypt text="COMMAND" delay={180} />
          </span>
        </h1>
        <p class="war-sub">The world is one mistake from war. Take command of any nation on Earth, from a single rifle detachment up to the whole war machine.</p>
      </header>
      <nav class="war-actions">
        {last && (
          <button class="big primary" onClick={() => app.load(last.slot)}>
            Continue <small>{last.country} · {RANKS[last.rank]?.name} · {last.date}</small>
          </button>
        )}
        <button class={`big ${last ? '' : 'primary'}`} onClick={() => store.set({ screen: 'setup' })}>
          New campaign <small>Pick any of {nations} nations, from recruit to supreme commander</small>
        </button>
        <button class="big" onClick={() => store.set({ screen: 'mp' })}>
          Multiplayer <small>Join friends in one world with a 6-character code</small>
        </button>
        {saves && saves.length > 0 && (
          <button class="big" onClick={() => store.set({ modal: { kind: 'saves' } })}>
            Load game <small>{saves.length} save{saves.length > 1 ? 's' : ''}</small>
          </button>
        )}
      </nav>
      <aside class="war-board" aria-label="Theatre summary">
        <div class="defcon-big">
          <small>Readiness</small>
          <b>DEFCON 3</b>
          <div class="pips">
            {[5, 4, 3, 2, 1].map((n) => (
              <i class={n >= 3 ? 'on' : ''} />
            ))}
          </div>
        </div>
        <dl>
          <div>
            <dt>Provinces</dt>
            <dd>{world.P.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Sea zones</dt>
            <dd>{world.S}</dd>
          </div>
          <div>
            <dt>Nations</dt>
            <dd>{nations}</dd>
          </div>
          <div>
            <dt>Ranks</dt>
            <dd>{RANKS.length}</dd>
          </div>
        </dl>
        <p>Real-world armies, navies and air forces. Every nation is run by an AI that can do everything you can.</p>
        {ai && (
          <div class="ai-live">
            <b>● CLAUDE ONLINE</b>
            <span>Your Chief of Staff reads the battlefield and gives orders on request. Foreign leaders answer the hotline in character.</span>
          </div>
        )}
      </aside>
      <div class="ticker" aria-label="Intercepted traffic">
        <span class="ticker-label">INTERCEPTS</span>
        <div class="ticker-window">
          <div class="ticker-track">
            {[...feed, ...feed].map((t) => (
              <span>{t}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function countryProfile(world, c) {
  const wc = world.countries[c];
  const mil = MILITARY[wc.iso3] || estimateMilitary(wc.pop, wc.gdp, wc.income);
  const blocs = BLOCS.filter((b) => b.members.includes(wc.iso3)).map((b) => b.name);
  const rivals = RIVALRIES.filter(([a, b]) => a === wc.iso3 || b === wc.iso3).map(([a, b, v]) => [world.countryByIso.get(a === wc.iso3 ? b : a), v]).filter(([x]) => x !== undefined);
  const power = mil.active * (0.6 + mil.tech * 0.2) + mil.tanks * 0.05 + (mil.fighters + mil.cas) * 0.4 + mil.carriers * 40;
  const persona = PERSONALITIES[PERSONALITY_OF[wc.iso3]]?.name;
  const difficulty = power > 1500 ? 1 : power > 500 ? 2 : power > 150 ? 3 : power > 40 ? 4 : 5;
  return { wc, mil, blocs, rivals, power, difficulty, persona };
}

export function SetupScreen({ app, world }) {
  const [country, setCountry] = useState(world.countryByIso.get('USA'));
  const [scenario, setScenario] = useState('cold');
  const [rank, setRank] = useState(0);
  const [name, setName] = useState('Commander');
  const [pace, setPace] = useState(1);
  const [q, setQ] = useState('');
  useEffect(() => {
    app.pickMode((c) => setCountry(c));
    return () => app.pickMode(null);
  }, []);
  useEffect(() => app.highlightCountry(country), [country]);
  const prof = useMemo(() => countryProfile(world, country), [country]);
  const list = useMemo(() => world.countries.map((c, i) => [c.name, i, c.pop]).filter(([n]) => !q || n.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b[2] - a[2]).slice(0, q ? 30 : 16), [q]);
  const m = prof.mil;
  return (
    <div class="setup">
      <div class="setup-left panel-glass">
        <h2>New campaign</h2>
        <label>Scenario</label>
        <div class="seg col">
          {Object.entries(SCENARIOS).map(([k, sc]) => (
            <button class={scenario === k ? 'on' : ''} onClick={() => setScenario(k)}>
              <b>{sc.name}</b>
              <small>{sc.text}</small>
            </button>
          ))}
        </div>
        <label>Starting rank</label>
        <div class="seg col">
          {START_RANKS.map((r) => (
            <button class={rank === r.rank ? 'on' : ''} onClick={() => setRank(r.rank)}>
              <b>{r.label}</b>
            </button>
          ))}
        </div>
        <label>Commander name</label>
        <input value={name} maxLength={24} onInput={(e) => setName(e.target.value)} />
        <label>Promotion pace</label>
        <div class="seg">
          {[
            [0.6, 'Slow'],
            [1, 'Normal'],
            [2, 'Fast'],
          ].map(([v, l]) => (
            <button class={pace === v ? 'on' : ''} onClick={() => setPace(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div class="setup-right panel-glass">
        <input class="search" placeholder="Search countries… or click the map" value={q} onInput={(e) => setQ(e.target.value)} />
        <div class="country-list">
          {list.map(([n, i]) => (
            <button class={i === country ? 'on' : ''} onClick={() => setCountry(i)}>
              <i style={{ background: world.countries[i].color }} />
              {n}
            </button>
          ))}
        </div>
        <div class="country-card">
          <div class="cc-head">
            <i style={{ background: prof.wc.color }} />
            <div>
              <h3>{prof.wc.nameLong}</h3>
              <small>
                {prof.wc.subregion} · {prof.wc.provinces} provinces {prof.persona ? `· AI: ${prof.persona}` : ''}
              </small>
            </div>
            <span class={`diff d${prof.difficulty}`} title="Difficulty">
              {'★'.repeat(prof.difficulty)}
              {'☆'.repeat(5 - prof.difficulty)}
            </span>
          </div>
          <div class="cc-grid">
            <div>
              <em>Population</em>
              <b>{fmt(prof.wc.pop)}</b>
            </div>
            <div>
              <em>GDP</em>
              <b>${fmt(prof.wc.gdp * 1e6)}</b>
            </div>
            <div>
              <em>Active forces</em>
              <b>{fmt(m.active * 1000)}</b>
            </div>
            <div>
              <em>Tanks</em>
              <b>{fmt(m.tanks)}</b>
            </div>
            <div>
              <em>Combat aircraft</em>
              <b>{fmt(m.fighters + m.cas + m.bombers)}</b>
            </div>
            <div>
              <em>Major warships</em>
              <b>{fmt(m.carriers + m.destroyers + m.frigates + m.subs)}</b>
            </div>
            <div>
              <em>Defence budget</em>
              <b>${fmt(m.budget * 1e9)}</b>
            </div>
            <div>
              <em>Technology</em>
              <b>{'▮'.repeat(m.tech)}{'▯'.repeat(5 - m.tech)}</b>
            </div>
          </div>
          {prof.blocs.length > 0 && <div class="cc-line">Alliances: {prof.blocs.join(', ')}</div>}
          {prof.rivals.length > 0 && (
            <div class="cc-line warn">
              Rivals:{' '}
              {prof.rivals.map(([x, v]) => (
                <span>
                  {world.countries[x].name} ({v})
                </span>
              ))}
            </div>
          )}
        </div>
        <div class="setup-go">
          <Btn kind="ghost" onClick={() => store.set({ screen: 'title' })}>
            Back
          </Btn>
          <Btn kind="primary big" onClick={() => app.start({ scenario, pace, seed: Math.floor(Math.random() * 1e9) }, { name: name.trim() || 'Commander', country, rank })}>
            Enlist in {prof.wc.name}
          </Btn>
        </div>
      </div>
    </div>
  );
}
