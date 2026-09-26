// Nation picker shared by the solo setup and the multiplayer lobby: every nation on the map,
// with category filters, regions, blocs, sorting, a difficulty filter and a random pick.
import { useMemo, useState } from 'preact/hooks';
import { BLOCS } from '../../../config/scenario.js';
import { ARSENALS } from '../../sim/strategic.js';
import { countryProfile } from './Title.jsx';

const REGION = (sub = '') =>
  /America|Caribbean/.test(sub) ? 'Americas' : /Europe/.test(sub) ? 'Europe' : /Africa/.test(sub) ? 'Africa' : /Western Asia/.test(sub) ? 'Middle East' : /Asia/.test(sub) ? 'Asia' : /Australia|Melanesia|Micronesia|Polynesia/.test(sub) ? 'Oceania' : 'Other';
const REGIONS = ['Americas', 'Europe', 'Africa', 'Middle East', 'Asia', 'Oceania'];
const SORTS = [
  ['power', 'Military power'],
  ['pop', 'Population'],
  ['gdp', 'Economy'],
  ['area', 'Territory'],
  ['name', 'Name'],
  ['hard', 'Hardest first'],
];
const DIFF = ['Any', 'Easy', 'Normal', 'Hard', 'Brutal'];

export function CountryPicker({ world, value, onPick, taken }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [sort, setSort] = useState('power');
  const [diff, setDiff] = useState(0);
  // profiles for every playable nation, computed once
  const all = useMemo(
    () =>
      world.countries
        .map((c, i) => ({ i, c, prof: world.provincesOf[i].length ? countryProfile(world, i) : null }))
        .filter((x) => x.prof)
        .map((x) => ({ ...x, region: REGION(x.c.subregion), nuclear: !!ARSENALS[x.c.iso3], blocs: BLOCS.filter((b) => b.members.includes(x.c.iso3)).map((b) => b.name) })),
    [world],
  );
  const maxPower = useMemo(() => Math.max(...all.map((x) => x.prof.power)), [all]);
  const cats = [
    ['all', `All (${all.length})`],
    ['super', 'Superpowers'],
    ['great', 'Great powers'],
    ['nuclear', '☢ Nuclear'],
    ['underdog', 'Underdogs'],
    ...BLOCS.map((b) => [`bloc:${b.name}`, b.name]),
    ...REGIONS.map((r) => [`region:${r}`, r]),
  ];
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let out = all.filter((x) => {
      if (ql && !x.c.name.toLowerCase().includes(ql) && !x.c.nameLong.toLowerCase().includes(ql) && x.c.iso3.toLowerCase() !== ql) return false;
      if (cat === 'super' && x.prof.difficulty > 1) return false;
      if (cat === 'great' && x.prof.difficulty !== 2) return false;
      if (cat === 'nuclear' && !x.nuclear) return false;
      if (cat === 'underdog' && x.prof.difficulty < 4) return false;
      if (cat.startsWith('bloc:') && !x.blocs.includes(cat.slice(5))) return false;
      if (cat.startsWith('region:') && x.region !== cat.slice(7)) return false;
      // difficulty: Easy = superpowers/great powers ... Brutal = the weakest
      if (diff === 1 && x.prof.difficulty > 2) return false;
      if (diff === 2 && x.prof.difficulty !== 3) return false;
      if (diff === 3 && x.prof.difficulty !== 4) return false;
      if (diff === 4 && x.prof.difficulty !== 5) return false;
      return true;
    });
    const key = { power: (x) => -x.prof.power, pop: (x) => -x.c.pop, gdp: (x) => -x.c.gdp, area: (x) => -x.c.areaKm2, name: (x) => x.c.name, hard: (x) => -x.prof.difficulty * 1e9 + x.prof.power }[sort];
    out = out.slice().sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return typeof ka === 'string' ? ka.localeCompare(kb) : ka - kb;
    });
    return out;
  }, [all, q, cat, sort, diff]);
  const random = () => {
    const pool = list.filter((x) => !(taken && taken.has(x.i)));
    if (pool.length) onPick(pool[Math.floor(Math.random() * pool.length)].i);
  };
  return (
    <div class="picker">
      <div class="picker-top">
        <input id="nation-search" class="search" placeholder="Search nations… or click the map" value={q} onInput={(e) => setQ(e.target.value)} />
        <button class="dice" onClick={random} title="Random nation from this list">
          🎲 Random
        </button>
      </div>
      <div class="picker-cats" role="tablist">
        {cats.map(([k, l]) => (
          <button class={cat === k ? 'on' : ''} onClick={() => setCat(k)}>
            {l}
          </button>
        ))}
      </div>
      <div class="picker-opts">
        <label>
          Sort
          <select id="nation-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map(([k, l]) => (
              <option value={k}>{l}</option>
            ))}
          </select>
        </label>
        <label>
          Challenge
          <select id="nation-diff" value={diff} onChange={(e) => setDiff(Number(e.target.value))}>
            {DIFF.map((l, k) => (
              <option value={k}>{l}</option>
            ))}
          </select>
        </label>
        <span class="picker-count">{list.length} nations</span>
      </div>
      <div class="picker-list">
        {!list.length && <p class="muted">No nation matches. Clear a filter.</p>}
        {list.map((x) => {
          const who = taken && taken.get(x.i);
          return (
            <button class={`nation${x.i === value ? ' on' : ''}${who ? ' taken' : ''}`} onClick={() => onPick(x.i)} title={who ? `Taken by ${who}` : x.c.nameLong}>
              <i style={{ background: x.c.color }} />
              <span class="n-name">
                {x.c.name}
                {x.nuclear && <em title="Nuclear power"> ☢</em>}
                {who && <small> · {who}</small>}
              </span>
              <span class="n-bar" title={`Military power ${Math.round(x.prof.power)}`}>
                <b style={{ width: `${Math.max(3, Math.round((Math.sqrt(x.prof.power) / Math.sqrt(maxPower)) * 100))}%` }} />
              </span>
              <span class={`n-diff d${x.prof.difficulty}`}>{'★'.repeat(x.prof.difficulty)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
