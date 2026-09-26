// Title screen and campaign setup (country picked directly on the world map).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { store, useStore } from '../state/store.js';
import { MILITARY, estimateMilitary } from '../../../config/military.js';
import { SCENARIOS, BLOCS, RIVALRIES, PERSONALITY_OF, PERSONALITIES } from '../../../config/scenario.js';
import { START_RANKS, RANKS } from '../../../config/ranks.js';
import { fmt, Btn } from './common.jsx';

export function TitleScreen({ app }) {
  const saves = useStore((s) => s.saves);
  const last = saves && saves[0];
  return (
    <div class="title-screen">
      <div class="title-card">
        <div class="title-mark">
          <span>GLOBAL</span> COMMAND
        </div>
        <div class="title-sub">A world at war. Rise from recruit to supreme commander.</div>
        <div class="title-actions">
          {last && (
            <button class="big primary" onClick={() => app.load(last.slot)}>
              Continue <small>{last.country} · {RANKS[last.rank]?.name} · {last.date}</small>
            </button>
          )}
          <button class={`big ${last ? '' : 'primary'}`} onClick={() => store.set({ screen: 'setup' })}>
            New campaign <small>Pick any of 197 countries</small>
          </button>
          <button class="big" onClick={() => store.set({ screen: 'mp' })}>
            Multiplayer <small>Create or join a campaign with a code</small>
          </button>
          {saves && saves.length > 0 && (
            <button class="big" onClick={() => store.set({ modal: { kind: 'saves' } })}>
              Load game <small>{saves.length} save{saves.length > 1 ? 's' : ''}</small>
            </button>
          )}
        </div>
        <div class="title-foot">
          1,222 provinces · 192 sea zones · real-world forces · 52 ranks · empires
          <br />
          Map data: Natural Earth (public domain)
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
