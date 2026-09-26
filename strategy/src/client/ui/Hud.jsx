// In-game HUD: top bar, command card, tab rail, order bar, map modes, end turn,
// hover tooltip, toasts and the contextual inspector.
import { store, useStore } from '../state/store.js';
import { RANKS } from '../../../config/ranks.js';
import { ELEMENTS } from '../../../config/units.js';
import { BUILDINGS } from '../../../config/economy.js';
import { TERRAIN_RULES, WEATHER } from '../../../config/terrain.js';
import { fmt, Bar, Btn, Insignia, Chip, kindIcon, Row } from './common.jsx';

const need = (caps, cap) => {
  if (caps.includes(cap)) return null;
  const i = RANKS.findIndex((r) => r.unlock.includes(cap));
  return i >= 0 ? `Requires ${RANKS[i].name}${RANKS[i].appt ? ` (${RANKS[i].appt})` : ''}` : 'Locked';
};

export function TopBar({ world, ctl }) {
  const v = useStore((s) => s.view);
  if (!v) return null;
  const me = v.me;
  const c = world.countries[me.country];
  const nat = v.countries[me.country];
  const pct = me.xpNext ? Math.min(100, (me.xp / me.xpNext) * 100) : 100;
  const atWar = v.wars.filter((w) => w.attackers.includes(me.country) || w.defenders.includes(me.country));
  return (
    <div class="topbar">
      <div class="tb-country" onClick={() => ctl.focusHQ()} title="Center on your command (Home)">
        <i style={{ background: c.color }} />
        <div>
          <b>{c.name}</b>
          <small>{atWar.length ? `At war (${atWar.length})` : 'At peace'}</small>
        </div>
      </div>
      <div class="tb-date">
        <b>{v.date}</b>
        <small>Turn {v.turn + 1}</small>
      </div>
      <div class="tb-stats">
        <span title="Command Points: spend on support requests">
          ◆ <b>{me.cp}</b>/{me.cpMax}
        </span>
        <span title="Influence: advise national command">
          ✦ <b>{me.influence}</b>
        </span>
        {nat.treasury !== undefined && me.rank >= 44 && (
          <span title="Treasury ($bn)">
            $ <b>{fmt(nat.treasury, 1)}</b>
          </span>
        )}
        {nat.manpower !== undefined && me.rank >= 44 && (
          <span title="Manpower">
            ⛹ <b>{fmt(nat.manpower)}</b>
          </span>
        )}
        <span title="World tension" class={v.tension > 75 ? 'hot' : ''}>
          ☢ <b>{v.tension}</b>
        </span>
      </div>
      <div class="tb-rank" onClick={() => store.set({ panel: 'rank' })} title="Career">
        <Insignia rank={me.rank} size={30} />
        <div>
          <b>{me.rankName}</b>
          <small>{me.xpNext ? `${me.xp} / ${me.xpNext} merit` : 'Highest rank'}</small>
          <div class="xp">
            <div style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <button class="tb-bell" onClick={() => store.set((s) => ({ panel: s.panel === 'notes' ? null : 'notes' }))} title="Notifications">
        🔔
      </button>
      <button class="tb-menu" onClick={() => store.set({ modal: { kind: 'menu' } })} title="Menu">
        ☰
      </button>
    </div>
  );
}

export function CommandCard({ world, ctl }) {
  const v = useStore((s) => s.view);
  if (!v) return null;
  const me = v.me;
  const cmd = me.command;
  return (
    <div class="command-card">
      <div class="cc-title">{me.rankTitle}</div>
      <div class="cc-row">
        <span>Command</span>
        <b>
          {cmd.elements}
          {cmd.maxElements ? `/${cmd.maxElements}` : ''} elements · {cmd.formations}
          {cmd.maxFormations ? `/${cmd.maxFormations}` : ''} formations
        </b>
      </div>
      <div class="cc-row">
        <span>Orders</span>
        <b>
          {me.orders.used}/{me.orders.max}
        </b>
      </div>
      {me.directives
        .filter((d) => d.status === 'active')
        .map((d) => (
          <div class="directive" onClick={() => d.target !== undefined && ctl.focusProv(d.target)}>
            <span class="dot" />
            <div>
              <b>{d.title}</b>
              <small>
                {d.text} · due turn {d.due + 1} · +{d.reward}
              </small>
            </div>
          </div>
        ))}
      {me.directives
        .filter((d) => d.status !== 'active')
        .slice(-2)
        .map((d) => (
          <div class={`directive ${d.status}`}>
            <span class="dot" />
            <div>
              <b>
                {d.status === 'done' ? '✔' : '✖'} {d.title}
              </b>
            </div>
          </div>
        ))}
      <Tutorial v={v} />
    </div>
  );
}

function Tutorial({ v }) {
  const t = v.me.tutorial;
  const sel = useStore((s) => s.sel);
  if (t < 0 || t > 3 || v.turn > 12) return null;
  let tip;
  if (!sel || sel.kind !== 'formation') tip = 'Click your detachment (gold ring) to select it. Tab cycles your formations.';
  else if (v.me.directives.some((d) => d.type === 'move' && d.status === 'active')) tip = 'Right-click (or drag your counter to) the flagged province to move. Then press End Turn.';
  else if (v.me.directives.some((d) => d.type === 'digin' && d.status === 'active')) tip = 'Press D to dig in, then End Turn. Dug-in troops defend much better.';
  else tip = 'Hover an enemy province with your formation selected to see the battle forecast.';
  return <div class="tutorial">💡 {tip}</div>;
}

const TABS = [
  ['world', '🌐', 'World', 0],
  ['armies', '⚔', 'Armies', 0],
  ['fronts', '▦', 'Fronts', 8],
  ['operations', '➤', 'Operations', 19],
  ['intel', '👁', 'Intelligence', 12],
  ['economy', '$', 'Economy', 14],
  ['production', '⚙', 'Production', 43],
  ['air', '✈', 'Air & Navy', 33],
  ['diplomacy', '✉', 'Diplomacy', 0],
  ['empire', '♛', 'Empire', 0],
  ['rank', '★', 'Career', 0],
  ['reports', '☰', 'Reports', 0],
  ['multiplayer', '👥', 'Players', 0],
];

export function TabRail() {
  const panel = useStore((s) => s.panel);
  const v = useStore((s) => s.view);
  if (!v) return null;
  return (
    <nav class="tabrail">
      {TABS.filter(([, , , r]) => v.me.rank >= r).map(([k, icon, label]) => (
        <button class={panel === k ? 'on' : ''} onClick={() => store.set({ panel: panel === k ? null : k })} title={label}>
          <span>{icon}</span>
          <small>{label}</small>
        </button>
      ))}
    </nav>
  );
}

const MODES = [
  ['political', 'Political'],
  ['terrain', 'Terrain'],
  ['supply', 'Supply'],
  ['diplomacy', 'Diplomacy'],
  ['intel', 'Intel'],
  ['fronts', 'Fronts'],
  ['economy', 'Economy'],
  ['infrastructure', 'Infrastructure'],
  ['resources', 'Resources'],
  ['empire', 'Empires'],
  ['weather', 'Weather'],
];

export function MapModes({ ctl }) {
  const mode = useStore((s) => s.mode);
  return (
    <div class="mapmodes">
      {MODES.map(([k, l], i) => (
        <button class={mode === k ? 'on' : ''} onClick={() => ctl.setMode(k)} title={`${l} map mode (${i + 1})`}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function EndTurn({ ctl }) {
  const busy = useStore((s) => s.busy);
  const v = useStore((s) => s.view);
  if (!v) return null;
  const idle = v.formations.filter((f) => f.mine && !f.order && !f.battle).length;
  return (
    <button class={`endturn${busy ? ' busy' : ''}`} onClick={() => ctl.endTurn()} title="End turn (Enter)">
      {busy ? 'Resolving…' : 'End turn'}
      <small>{busy ? 'battles, supply, diplomacy' : idle ? `${idle} idle formation${idle > 1 ? 's' : ''}` : 'all forces have orders'}</small>
    </button>
  );
}

export function Toasts({ ctl }) {
  const toasts = useStore((s) => s.toasts);
  return (
    <div class="toasts">
      {toasts.map((t) => (
        <div class={`toast ${t.kind || ''}${t.important ? ' important' : ''}${t.huge ? ' huge' : ''}`} onClick={() => t.prov !== undefined && ctl.focusProv(t.prov)}>
          <span class="ti">{kindIcon[t.kind] || '•'}</span>
          <div>
            <b>{t.title}</b>
            {t.text && <small>{t.text}</small>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function HoverTip({ world }) {
  const hover = useStore((s) => s.hover);
  const pos = useStore((s) => s.hoverPos);
  const v = useStore((s) => s.view);
  const preview = useStore((s) => s.preview);
  if (!v || hover < 0 || !pos) return null;
  const P = world.P;
  const isSea = hover >= P;
  const name = world.nameOf(hover);
  const fc = preview && preview.target === hover ? preview.forecast : null;
  let body;
  if (isSea) body = <small>Sea zone</small>;
  else {
    const owner = v.prov.owner[hover];
    const ctrl = v.prov.ctrl[hover];
    const t = TERRAIN_RULES[world.provinces.terrain[hover]];
    const units = v.formations.filter((f) => f.prov === hover);
    const weather = WEATHER[v.weather[world.provinces.area[hover]] || 0];
    body = (
      <>
        <small>
          {world.countries[owner].name}
          {ctrl !== owner ? ` · occupied by ${world.countries[ctrl].name}` : ''}
        </small>
        <small>
          {t.name}
          {world.provinces.urban[hover] ? ' · urban' : ''} · {weather.name}
          {v.prov.fort[hover] ? ` · fort ${v.prov.fort[hover]}` : ''}
        </small>
        {units.length > 0 && <small>{units.length} formation{units.length > 1 ? 's' : ''} here</small>}
      </>
    );
  }
  return (
    <div class="hovertip" style={{ left: `${pos[0] + 16}px`, top: `${pos[1] + 14}px` }}>
      <b>{name}</b>
      {body}
      {preview && preview.target === hover && preview.path && (
        <div class="tip-order">
          <span class={preview.attack ? 'atk' : 'mv'}>{preview.attack ? 'Attack' : 'Move'}</span> · ~{preview.turns} turn{preview.turns > 1 ? 's' : ''}
          {!preview.inArea && <em class="warn"> · outside your area</em>}
        </div>
      )}
      {preview && preview.target === hover && preview.blocked && <div class="tip-order warn">No route (neutral territory needs access)</div>}
      {fc && <Forecast fc={fc} caps={v.me.caps} />}
    </div>
  );
}

function Forecast({ fc, caps }) {
  const full = caps.includes('forecastFull');
  const pct = Math.round(fc.odds * 100);
  const col = fc.odds > 0.6 ? 'var(--ok)' : fc.odds > 0.4 ? 'var(--accent)' : 'var(--danger)';
  if (fc.empty) return <div class="forecast">Undefended — you will capture it</div>;
  if (!caps.includes('forecast')) return <div class="forecast">Forecasts unlock at Private</div>;
  return (
    <div class="forecast">
      <div class="fc-head">
        <b style={{ color: col }}>{fc.label}</b>
        {full && <span>{pct}%</span>}
        {fc.uncertain && <em title="Limited intelligence on the defenders"> (estimate)</em>}
      </div>
      <Bar value={fc.odds} color={col} h={4} />
      <small>
        Force ratio {fc.ratio >= 1 ? `${fc.ratio.toFixed(1)} : 1` : `1 : ${(1 / fc.ratio).toFixed(1)}`}
        {full ? ` · losses ~${fmt(fc.lossesA)} vs ${fmt(fc.lossesD)}` : ''}
      </small>
      <ul>
        {fc.factors.slice(0, full ? 6 : 3).map(([n, v, side]) => (
          <li class={(side === 'A') === v > 0 ? 'good' : 'bad'}>
            {side === 'D' ? 'Enemy: ' : ''}
            {n} {v > 0 ? '+' : ''}
            {v}%
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------ inspector and order bar
export function Inspector({ world, ctl }) {
  const sel = useStore((s) => s.sel);
  const v = useStore((s) => s.view);
  if (!v || !sel) return null;
  if (sel.kind === 'formation') {
    const f = v.formations.find((x) => x.id === sel.id);
    if (!f) return null;
    return <FormationCard f={f} world={world} v={v} ctl={ctl} />;
  }
  if (sel.kind === 'province') return <ProvinceCard p={sel.id} world={world} v={v} ctl={ctl} />;
  return null;
}

function FormationCard({ f, world, v, ctl }) {
  const c = world.countries[f.owner];
  const hostile = v.wars.some((w) => (w.attackers.includes(v.me.country) && w.defenders.includes(f.owner)) || (w.defenders.includes(v.me.country) && w.attackers.includes(f.owner)));
  const where = world.nameOf(f.prov);
  return (
    <div class="inspector">
      <header>
        <i style={{ background: c.color }} />
        <div>
          <b>{f.name || (f.est ? 'Enemy force' : 'Formation')}</b>
          <small>
            {c.name} · {where}
            {f.mine ? ' · under your command' : f.ctrl && f.ctrl !== 'ai' ? ` · ${f.ctrl}` : f.owner === v.me.country ? ' · national command' : ''}
          </small>
        </div>
        <button class="x" onClick={() => ctl.select(null)}>
          ×
        </button>
      </header>
      {f.est ? (
        <div class="insp-body">
          <Row k="Estimated size" v={f.size || `~${f.n} elements`} />
          {f.kind && <Row k="Type" v={f.kind} />}
          {f.power && <Row k="Estimated strength" v={`~${f.power}`} />}
          <p class="muted">Recon or better intelligence reveals the exact composition.</p>
        </div>
      ) : (
        <div class="insp-body">
          <div class="comp">
            {Object.entries(f.comp || {}).map(([t, n]) => (
              <span title={ELEMENTS[t].name}>
                <b>{n}</b> {ELEMENTS[t].short}
              </span>
            ))}
          </div>
          <div class="bars">
            <label>Strength</label>
            <Bar value={f.str} color="var(--ok)" />
            <label>Organization</label>
            <Bar value={f.org} color="var(--blue)" />
            {f.supply !== undefined && (
              <>
                <label>Supply</label>
                <Bar value={Math.min(1, f.supply)} color={f.supply > 0.6 ? 'var(--ok)' : f.supply > 0.3 ? 'var(--accent)' : 'var(--danger)'} />
              </>
            )}
            {f.morale !== undefined && (
              <>
                <label>Morale</label>
                <Bar value={f.morale} color="#b48ce0" />
              </>
            )}
          </div>
          <div class="tags">
            {f.encircled && <span class="tag bad">Encircled</span>}
            {f.battle ? <span class="tag bad">In battle</span> : null}
            {f.entrench > 0.1 && <span class="tag">Dug in {Math.round(f.entrench * 100)}%</span>}
            {f.exp > 0.5 && <span class="tag good">Veteran</span>}
            {f.auto && <span class="tag">AI subordinate</span>}
            {hostile && <span class="tag bad">Hostile</span>}
            {f.order && (
              <span class="tag">
                {f.order.type} → {world.nameOf(f.order.target)}
              </span>
            )}
          </div>
          {f.mine && <FormationActions f={f} v={v} ctl={ctl} world={world} />}
          {!f.mine && f.owner === v.me.country && f.ctrl === 'ai' && (
            <Btn onClick={() => ctl.command({ type: 'request', f: f.id })} title="Take this formation under your command (capacity permitting)">
              Request command
            </Btn>
          )}
        </div>
      )}
    </div>
  );
}

function FormationActions({ f, v, ctl, world }) {
  const caps = v.me.caps;
  const n = (cap) => need(caps, cap);
  const coastal = world.provinces.coastal[f.prov] && v.prov.bld.port[f.prov];
  return (
    <div class="actions">
      <Btn onClick={() => ctl.command({ type: 'hold', f: f.id })} hot="H">
        Hold
      </Btn>
      <Btn lock={n('digin')} onClick={() => ctl.command({ type: 'digin', f: f.id })} hot="D">
        Dig in
      </Btn>
      <Btn lock={n('withdraw')} onClick={() => ctl.command({ type: 'withdraw', f: f.id })} hot="W">
        Withdraw
      </Btn>
      <Btn lock={n('split')} onClick={() => ctl.command({ type: 'split', f: f.id })} hot="S">
        Split
      </Btn>
      <Btn lock={n('recon')} onClick={() => store.set({ modal: { kind: 'recon', f: f.id } })}>
        Recon
      </Btn>
      <Btn lock={n('resupply')} onClick={() => ctl.command({ type: 'support', kind: 'resupply', f: f.id })} title="1 CP">
        Resupply
      </Btn>
      {f.battle ? (
        <>
          <Btn lock={n('artillery')} onClick={() => ctl.command({ type: 'support', kind: 'artillery' })} title="2 CP">
            Artillery
          </Btn>
          <Btn lock={n('cas')} onClick={() => ctl.command({ type: 'support', kind: 'cas' })} title="3 CP">
            Air support
          </Btn>
        </>
      ) : null}
      <Btn lock={n('reinforcePriority')} onClick={() => ctl.command({ type: 'reinf', f: f.id, level: (f.reinf + 1) % 3 })}>
        Reinforce: {['off', 'normal', 'high'][f.reinf ?? 1]}
      </Btn>
      <Btn lock={n('aiSub1')} onClick={() => ctl.command({ type: 'auto', f: f.id, on: !f.auto })}>
        {f.auto ? 'Take control' : 'Hand to AI'}
      </Btn>
      {coastal ? (
        <Btn onClick={() => store.set({ tool: 'sea', toolProvs: [], toolFor: f.id })} title="Pick a coastal destination">
          Sea transport
        </Btn>
      ) : null}
      <Btn onClick={() => {
        const name = prompt('Rename formation', f.name);
        if (name) ctl.command({ type: 'rename', f: f.id, name });
      }}>
        Rename
      </Btn>
      <Btn kind="ghost" onClick={() => ctl.command({ type: 'release', f: f.id })} title="Return to national command">
        Release
      </Btn>
      <p class="hint">Right-click a province (or drag the counter) to move · Shift+right-click adds waypoints</p>
    </div>
  );
}

function ProvinceCard({ p, world, v, ctl }) {
  if (p >= world.P) {
    return (
      <div class="inspector">
        <header>
          <div>
            <b>{world.nameOf(p)}</b>
            <small>Sea zone</small>
          </div>
          <button class="x" onClick={() => ctl.select(null)}>
            ×
          </button>
        </header>
      </div>
    );
  }
  const pv = world.provinces;
  const owner = v.prov.owner[p];
  const ctrl = v.prov.ctrl[p];
  const units = v.formations.filter((f) => f.prov === p);
  const cities = (pv.cities[p] || []).map((i) => world.cities.name[i]).slice(0, 3);
  const b = v.prov.bld;
  const mineCtrl = ctrl === v.me.country;
  const inArea = v.me.area === 'all' || v.me.area.includes(p);
  const weather = WEATHER[v.weather[pv.area[p]] || 0];
  return (
    <div class="inspector">
      <header>
        <i style={{ background: world.countries[owner].color }} />
        <div>
          <b>{pv.name[p]}</b>
          <small>
            {world.regions[pv.region[p]]?.name} · {world.countries[owner].name}
            {ctrl !== owner ? ` (occupied by ${world.countries[ctrl].name})` : ''}
          </small>
        </div>
        <button class="x" onClick={() => ctl.select(null)}>
          ×
        </button>
      </header>
      <div class="insp-body">
        <Row k="Terrain" v={`${TERRAIN_RULES[pv.terrain[p]].name}${pv.urban[p] ? ' · urban' : ''}`} sub={weather.name} />
        <Row k="Population" v={fmt(pv.pop[p])} />
        {cities.length > 0 && <Row k="Cities" v={cities.join(', ')} />}
        <Row k="Resources" v={[pv.oil[p] && `oil ${pv.oil[p]}`, pv.minerals[p] && `minerals ${pv.minerals[p]}`, pv.rare[p] && `rare earths ${pv.rare[p]}`, pv.food[p] && `food ${pv.food[p]}`].filter(Boolean).join(' · ') || '—'} />
        <Row k="Intel" v={['Unknown', 'Detected', 'Identified', 'Assessed', 'Full'][v.prov.intel[p]]} />
        {v.prov.supply && mineCtrl && <Row k="Supply" v={`${v.prov.supply[p]}%`} />}
        <div class="bld">
          {[
            ['fort', 'Fort', v.prov.fort[p]],
            ['infra', 'Roads', b.infra[p]],
            ['rail', 'Rail', b.rail[p]],
            ['port', 'Naval base', b.port[p]],
            ['airbase', 'Airbase', b.airbase[p]],
            ['hub', 'Hub', b.hub[p]],
            ['depot', 'Depot', b.depot[p]],
            ['radar', 'Radar', b.radar[p]],
            ['command', 'Command', b.command[p]],
            ['civ', 'Industry', b.civ[p]],
            ['mil', 'Mil. industry', b.mil[p]],
          ]
            .filter(([, , lv]) => lv)
            .map(([, l, lv]) => (
              <span>
                {l} <b>{lv}</b>
              </span>
            ))}
        </div>
        {units.length > 0 && (
          <div class="unit-list">
            {units.map((f) => (
              <button onClick={() => ctl.select({ kind: 'formation', id: f.id })}>
                <Chip color={world.countries[f.owner].color}>{f.name || f.size || 'Unknown force'}</Chip>
                <small>{f.n ? `${f.n} el.` : ''}</small>
              </button>
            ))}
          </div>
        )}
        {mineCtrl && inArea && <BuildMenu p={p} v={v} ctl={ctl} />}
      </div>
    </div>
  );
}

function BuildMenu({ p, v, ctl }) {
  const caps = v.me.caps;
  const items = Object.entries(BUILDINGS).filter(([, b]) => caps.includes(b.cap) || b.rank <= v.me.rank + 12);
  if (!items.length) return null;
  return (
    <div class="build">
      <label>Build</label>
      <div class="actions">
        {items.map(([k, b]) => (
          <Btn lock={need(caps, b.cap)} onClick={() => ctl.command({ type: 'build', prov: p, b: k })} title={`${b.text} (${b.turns} turns)`}>
            {b.name}
          </Btn>
        ))}
      </div>
    </div>
  );
}
