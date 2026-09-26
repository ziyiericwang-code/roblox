// Drawer panels (one open at a time).
import { useState } from 'preact/hooks';
import { store, useStore } from '../state/store.js';
import { RANKS, xpToNext, rankTitle } from '../../../config/ranks.js';
import { EQUIPMENT } from '../../../config/units.js';
import { MOBILIZATION } from '../../../config/economy.js';
import { fmt, Bar, Btn, Chip, Section, Row, Insignia, kindIcon, ConfirmBtn } from './common.jsx';
import { StaffPanel, HotlineSection, NewsSection, CrisisSection } from './AI.jsx';
import { StrategicPanel } from './Strategic.jsx';

const needRank = (caps, cap) => {
  if (caps.includes(cap)) return null;
  const i = RANKS.findIndex((r) => r.unlock.includes(cap));
  return i >= 0 ? `Requires ${RANKS[i].name}` : 'Locked';
};

export function Drawer({ world, ctl, app }) {
  const panel = useStore((s) => s.panel);
  const v = useStore((s) => s.view);
  if (!v || !panel) return null;
  const P = PANELS[panel];
  if (!P) return null;
  return (
    <aside class="drawer">
      <header>
        <h3>{P.title}</h3>
        <button class="x" onClick={() => store.set({ panel: null })}>
          ×
        </button>
      </header>
      <div class="drawer-body">
        <P.C v={v} world={world} ctl={ctl} app={app} />
      </div>
    </aside>
  );
}

const cname = (world, c) => world.countries[c]?.name || '?';

// ------------------------------------------------------------ world
function WorldPanel({ v, world, ctl }) {
  const top = v.countries.map((c, i) => [i, c.power]).filter(([i]) => v.countries[i].alive).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return (
    <>
      <NewsSection v={v} world={world} />
      <CrisisSection v={v} world={world} ctl={ctl} />
      <Section title="World tension">
        <Bar value={v.tension} max={100} color={v.tension > 75 ? 'var(--danger)' : 'var(--accent)'} h={8} />
        <p class="muted">{v.worldWar ? 'WORLD WAR: the great alliances are at war.' : v.tension > 75 ? 'The world is on the brink. Wars spread quickly.' : v.tension > 50 ? 'Tensions are high.' : 'Relative calm.'}</p>
      </Section>
      <Section title={`Wars (${v.wars.length})`}>
        {!v.wars.length && <p class="muted">No wars. For now.</p>}
        {v.wars.map((w) => (
          <div class="war">
            <b>{w.name}</b>
            <div class="war-sides">
              <span>{w.attackers.slice(0, 4).map((c) => cname(world, c)).join(', ')}{w.attackers.length > 4 ? ` +${w.attackers.length - 4}` : ''}</span>
              <em>vs</em>
              <span>{w.defenders.slice(0, 4).map((c) => cname(world, c)).join(', ')}{w.defenders.length > 4 ? ` +${w.defenders.length - 4}` : ''}</span>
            </div>
            <div class="score">
              <Bar value={(w.score + 100) / 2} max={100} color={w.score >= 0 ? '#d07a55' : '#5b86c0'} />
              <small>
                War score {w.score > 0 ? '+' : ''}
                {w.score} · {w.battles} battles · since turn {w.start + 1}
              </small>
            </div>
          </div>
        ))}
      </Section>
      <Section title="Great powers">
        <table class="tbl">
          {top.map(([i, p]) => (
            <tr onClick={() => ctl.focusProv(v.countries[i].capital, 6)}>
              <td>
                <Chip color={world.countries[i].color}>{world.countries[i].name}</Chip>
              </td>
              <td>{fmt(p)}</td>
              <td class="muted">{v.countries[i].personality}</td>
            </tr>
          ))}
        </table>
      </Section>
      <Section title="Recent world events">
        {v.events
          .slice()
          .reverse()
          .slice(0, 12)
          .map((e) => (
            <div class="event" onClick={() => e.prov !== undefined && ctl.focusProv(e.prov)}>
              <b>{e.title}</b>
              <small>
                Turn {e.turn + 1} · {e.text}
              </small>
            </div>
          ))}
      </Section>
    </>
  );
}

// ------------------------------------------------------------ armies
function ArmiesPanel({ v, world, ctl }) {
  const mine = v.formations.filter((f) => f.mine);
  const national = v.formations.filter((f) => !f.mine && f.owner === v.me.country);
  const [showNat, setShowNat] = useState(false);
  const row = (f) => (
    <div class={`frow${f.battle ? ' battle' : ''}`} onClick={() => {
      ctl.select({ kind: 'formation', id: f.id });
      ctl.focusProv(f.prov, Math.max(ctl.r.camera.zoom, 11));
    }}>
      <div>
        <b>{f.name}</b>
        <small>
          {world.nameOf(f.prov)} · {f.n} el. {f.order ? `· ${f.order.type} → ${world.nameOf(f.order.target)}` : `· ${f.posture}`}
          {f.encircled ? ' · ENCIRCLED' : ''}
        </small>
      </div>
      <div class="mini">
        <Bar value={f.str} color="var(--ok)" h={3} />
        <Bar value={f.org} color="var(--blue)" h={3} />
      </div>
    </div>
  );
  return (
    <>
      <Section title={`Your command (${mine.length})`} right={<small>{v.me.command.elements} elements</small>}>
        {mine.map(row)}
        {!mine.length && <p class="muted">You command no formations. Command will assign you one next turn.</p>}
      </Section>
      <Section title={`National forces (${national.length})`} right={<Btn kind="ghost" onClick={() => setShowNat(!showNat)}>{showNat ? 'Hide' : 'Show'}</Btn>}>
        <p class="muted">Controlled by national command (AI). Request command of formations in your operational area.</p>
        {showNat && national.slice(0, 80).map(row)}
      </Section>
    </>
  );
}

// ------------------------------------------------------------ fronts
function FrontsPanel({ v, world, ctl }) {
  const [assign, setAssign] = useState(null);
  const caps = v.me.caps;
  return (
    <>
      {!v.fronts.length && <p class="muted">No active fronts. Fronts form automatically where hostile territories meet.</p>}
      {v.fronts.map((fr) => {
        const mine = fr.power.filter(([c]) => c === v.me.country || v.alliances.some(([a, b]) => (a === v.me.country && b === c) || (b === v.me.country && a === c))).reduce((a, [, p]) => a + p, 0);
        const theirs = fr.power.reduce((a, [, p]) => a + p, 0) - mine;
        return (
          <div class="front">
            <header onClick={() => ctl.focusProv(fr.provs[0], 8)}>
              <b>{fr.name}</b>
              <span class={`status s-${fr.status.toLowerCase()}`}>{fr.status}</span>
            </header>
            <small>
              {fr.sides.map((c) => cname(world, c)).join(' · ')} · {fr.provs.length} provinces · {fr.battles} battles
            </small>
            <div class="balance">
              <div style={{ flex: Math.max(1, mine), background: '#d9a64a' }} />
              <div style={{ flex: Math.max(1, theirs), background: '#c9433a' }} />
            </div>
            <Btn lock={needRank(caps, 'assignFront')} onClick={() => {
              setAssign(fr.id);
              ctl.command({ type: 'assignFront', front: fr.id });
            }}>
              {assign === fr.id ? 'Assigned ✔' : 'Assign my formations'}
            </Btn>
          </div>
        );
      })}
      <Section title="Defensive line">
        <p class="muted">Pick provinces on the map; your formations spread along them and dig in.</p>
        <Btn lock={needRank(caps, 'lines')} onClick={() => store.set({ tool: 'line', toolProvs: [], panel: null })}>
          Draw defensive line
        </Btn>
      </Section>
    </>
  );
}

// ------------------------------------------------------------ operations
function OperationsPanel({ v, world, ctl }) {
  const caps = v.me.caps;
  return (
    <>
      <Section title="Plan an operation">
        <p class="muted">Pick objectives on the map, choose forces, set preparation turns. Prepared attacks hit harder.</p>
        <Btn kind="primary" lock={needRank(caps, 'operations')} onClick={() => store.set({ tool: 'objectives', toolProvs: [], panel: null })}>
          New operation
        </Btn>
      </Section>
      <Section title="Operations">
        {!v.operations.length && <p class="muted">No operations yet.</p>}
        {v.operations
          .slice()
          .reverse()
          .map((op) => (
            <div class="op">
              <header>
                <b>{op.name}</b>
                <span class={`status s-${op.status}`}>{op.status}</span>
              </header>
              <small>
                Objectives: {op.objectives.map((q) => world.nameOf(q)).join(', ')}
              </small>
              <small>
                {op.forces.length} formation(s) · est. {op.estimate} turns{op.progress !== undefined ? ` · ${Math.round(op.progress * 100)}%` : ''}
              </small>
              {(op.status === 'active' || op.status === 'preparing') && (
                <Btn kind="ghost" onClick={() => ctl.command({ type: 'opCancel', op: op.id })}>
                  Cancel
                </Btn>
              )}
            </div>
          ))}
      </Section>
    </>
  );
}

// ------------------------------------------------------------ intelligence
function IntelPanel({ v, world, ctl }) {
  const warnings = (v.me.inbox || []).filter((n) => n.kind === 'intel').slice(-8).reverse();
  const counts = [0, 0, 0, 0, 0];
  for (const lv of v.prov.intel) counts[lv]++;
  const enemies = v.formations.filter((f) => f.est || (!f.mine && f.owner !== v.me.country && v.wars.some((w) => (w.attackers.includes(v.me.country) && w.defenders.includes(f.owner)) || (w.defenders.includes(v.me.country) && w.attackers.includes(f.owner)))));
  return (
    <>
      <Section title={`Clearance ${v.me.clearance}`}>
        <p class="muted">Higher ranks see further: low clearance limits detail outside your operational area.</p>
        {['Unknown', 'Detected', 'Identified', 'Assessed', 'Full'].map((l, i) => (
          <Row k={l} v={`${counts[i]} provinces`} />
        ))}
        <Btn onClick={() => ctl.setMode('intel')}>Show intel map</Btn>
      </Section>
      <Section title="Warnings">
        {!warnings.length && <p class="muted">No warnings.</p>}
        {warnings.map((n) => (
          <div class="event">
            <b>{n.title}</b>
            <small>{n.text}</small>
          </div>
        ))}
      </Section>
      <Section title={`Known hostile forces (${enemies.length})`}>
        {enemies.slice(0, 40).map((f) => (
          <div class="frow" onClick={() => {
            ctl.select({ kind: 'formation', id: f.id });
            ctl.focusProv(f.prov, 11);
          }}>
            <div>
              <b>{f.name || `${cname(world, f.owner)} force`}</b>
              <small>
                {world.nameOf(f.prov)} · {f.n ? `${f.est ? '~' : ''}${f.n} el.` : f.size}
              </small>
            </div>
          </div>
        ))}
      </Section>
    </>
  );
}

// ------------------------------------------------------------ economy and production
function EconomyPanel({ v, world, ctl }) {
  const n = v.countries[v.me.country];
  const caps = v.me.caps;
  if (n.treasury === undefined) return <p class="muted">No access.</p>;
  return (
    <>
      <Section title="National economy">
        <Row k="GDP (weekly output)" v={`$${fmt(n.gdp)}bn / yr`} />
        <Row k="Treasury" v={`$${fmt(n.treasury, 1)}bn`} sub={`+${n.income.toFixed(2)}/turn`} />
        <Row k="Industrial capacity" v={n.ic.toFixed(1)} />
        <Row k="Defence budget" v={`${(n.milShare * 100).toFixed(1)}% of GDP`} />
        <Row k="Manpower" v={fmt(n.manpower)} />
        <Row k="Stability" v={`${n.stability}%`} />
        <Row k="War support" v={`${n.warSupport}%`} />
      </Section>
      <Section title="Stockpiles">
        <div class="stock">
          {Object.entries(n.stock).map(([k, val]) => (
            <span>
              <em>{EQUIPMENT[k]?.name || k}</em>
              <b>{fmt(val)}</b>
            </span>
          ))}
        </div>
      </Section>
      <Section title={`Mobilization: ${n.mobName}`}>
        <div class="seg">
          {MOBILIZATION.map((m, i) => (
            <button class={n.mob === i ? 'on' : ''} disabled={!!needRank(caps, 'mobilization')} title={needRank(caps, 'mobilization') || ''} onClick={() => ctl.command({ type: 'mobilize', level: i })}>
              {m.name}
            </button>
          ))}
        </div>
        {caps.includes('economy') && (
          <>
            <label>Defence budget</label>
            <input type="range" min="0.5" max="15" step="0.5" value={n.milShare * 100} onChange={(e) => ctl.command({ type: 'milShare', v: Number(e.target.value) / 100 })} />
          </>
        )}
        {caps.includes('emergency') && <Btn onClick={() => ctl.command({ type: 'emergency' })}>Declare national emergency</Btn>}
        {caps.includes('advise') && !caps.includes('mobilization') && <Btn onClick={() => ctl.command({ type: 'advise', kind: 'mobilize' })}>Advise mobilization (10 influence)</Btn>}
      </Section>
      {v.me.rank >= 49 && (
        <Section title="AI assistance">
          <label class="check">
            <input type="checkbox" checked={v.me.ai.economy} onChange={(e) => ctl.command({ type: 'aiAssist', area: 'economy', on: e.target.checked })} /> Let the AI run the economy
          </label>
          <label class="check">
            <input type="checkbox" checked={v.me.ai.diplomacy} onChange={(e) => ctl.command({ type: 'aiAssist', area: 'diplomacy', on: e.target.checked })} /> Let the AI run diplomacy
          </label>
        </Section>
      )}
    </>
  );
}

function ProductionPanel({ v, world, ctl }) {
  const n = v.countries[v.me.country];
  const caps = v.me.caps;
  const [lines, setLines] = useState(() => Object.fromEntries(Object.keys(EQUIPMENT).map((k) => [k, (n.lines || []).find((l) => l.item === k)?.share || 0])));
  const canSet = caps.includes('production') || caps.includes('productionAdvice');
  return (
    <>
      <Section title="Production lines" right={<small>{n.ic.toFixed(1)} IC</small>}>
        <p class="muted">{n.autoProduction ? 'National command fills equipment gaps automatically.' : 'Manual priorities.'}</p>
        {(n.lines || []).map((l) => (
          <Row k={EQUIPMENT[l.item]?.name || l.item} v={`${l.made.toFixed(1)}/turn`} sub={`share ${l.share}`} />
        ))}
        {canSet && (
          <div class="lines-edit">
            {Object.keys(EQUIPMENT).map((k) => (
              <label>
                {EQUIPMENT[k].name}
                <input type="range" min="0" max="20" value={lines[k]} onInput={(e) => setLines({ ...lines, [k]: Number(e.target.value) })} />
              </label>
            ))}
            <div class="row-btns">
              <Btn onClick={() => ctl.command({ type: 'production', lines: Object.entries(lines).filter(([, s]) => s > 0).map(([item, share]) => ({ item, share })) })}>Apply</Btn>
              <Btn kind="ghost" onClick={() => ctl.command({ type: 'production', auto: true })}>Automatic</Btn>
            </div>
          </div>
        )}
        {!canSet && <p class="muted">{needRank(caps, 'productionAdvice')}</p>}
      </Section>
      <Section title="Construction queue">
        {!n.queue.length && <p class="muted">Nothing under construction. Select one of your provinces to build.</p>}
        {n.queue.map((j) => (
          <Row k={`${j.b} · ${world.nameOf(j.prov)}`} v={`${j.left} turn${j.left > 1 ? 's' : ''}`} />
        ))}
      </Section>
    </>
  );
}

function AirPanel({ v }) {
  const n = v.countries[v.me.country];
  return (
    <>
      <Section title="Air force">
        {n.air && Object.entries(n.air).map(([k, val]) => <Row k={k} v={fmt(val)} />)}
        <p class="muted">Air power projects superiority over the areas where your nation fights. It boosts battles, cuts enemy supply and grounds in storms.</p>
      </Section>
      <Section title="Navy">
        {n.navy && Object.entries(n.navy).map(([k, val]) => <Row k={k} v={fmt(val)} />)}
        <p class="muted">Naval power enables sea transport and amphibious landings, and lets your nation invade overseas.</p>
      </Section>
    </>
  );
}

// ------------------------------------------------------------ diplomacy
function DiplomacyPanel({ v, world, ctl }) {
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const [result, setResult] = useState(null);
  const caps = v.me.caps;
  const me = v.me.country;
  const allies = new Set(v.alliances.filter(([a, b]) => a === me || b === me).map(([a, b]) => (a === me ? b : a)));
  const atWar = new Set();
  for (const w of v.wars) {
    if (w.attackers.includes(me)) w.defenders.forEach((c) => atWar.add(c));
    if (w.defenders.includes(me)) w.attackers.forEach((c) => atWar.add(c));
  }
  const list = world.countries.map((c, i) => i).filter((i) => i !== me && v.countries[i].alive && (!q || world.countries[i].name.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => (atWar.has(b) - atWar.has(a)) || (allies.has(b) - allies.has(a)) || v.rel[a] - v.rel[b]);
  const act = async (cmd) => {
    const r = await ctl.command(cmd);
    setResult(r);
  };
  const incoming = v.proposals.filter((p) => p.to === me);
  return (
    <>
      {incoming.length > 0 && (
        <Section title="Proposals to you">
          {incoming.map((p) => (
            <div class="proposal">
              <b>
                {cname(world, p.from)}: {p.type}
              </b>
              {p.terms && p.terms.transfers && p.terms.transfers.length > 0 && <small>{p.terms.transfers.length} province(s) change hands</small>}
              <div class="row-btns">
                <Btn kind="primary" onClick={() => ctl.command({ type: 'respond', id: p.id, accept: true })}>Accept</Btn>
                <Btn kind="ghost" onClick={() => ctl.command({ type: 'respond', id: p.id, accept: false })}>Decline</Btn>
              </div>
            </div>
          ))}
        </Section>
      )}
      <input class="search" placeholder="Search countries" value={q} onInput={(e) => setQ(e.target.value)} />
      <div class="dip-list">
        {list.slice(0, 60).map((i) => (
          <div class={`dip${sel === i ? ' on' : ''}`} onClick={() => {
            setSel(i);
            setResult(null);
          }}>
            <Chip color={world.countries[i].color}>{world.countries[i].name}</Chip>
            <span class={atWar.has(i) ? 'bad' : allies.has(i) ? 'good' : ''}>{atWar.has(i) ? 'WAR' : allies.has(i) ? 'Ally' : v.rel[i]}</span>
          </div>
        ))}
      </div>
      {sel !== null && (
        <Section title={world.countries[sel].name}>
          <Row k="Our opinion of them" v={v.rel[sel]} />
          <Row k="Their opinion of us" v={v.opinionOfMe[sel]} />
          <Row k="AI personality" v={v.countries[sel].personality || '—'} />
          <Row k="Military strength" v={fmt(v.countries[sel].power)} sub={`ours ${fmt(v.countries[me].power)}`} />
          {v.claims[sel] ? <p class="warn">We hold a claim: war would be justified.</p> : null}
          <div class="actions">
            {atWar.has(sel) ? (
              <>
                <Btn lock={needRank(caps, 'militaryDiplomacy')} onClick={() => act({ type: 'propose', kind: 'peace', target: sel })}>White peace</Btn>
                <Btn lock={needRank(caps, 'militaryDiplomacy')} onClick={() => act({ type: 'propose', kind: 'peace', target: sel, demand: true })}>Demand territory</Btn>
                <Btn lock={needRank(caps, 'militaryDiplomacy')} onClick={() => act({ type: 'propose', kind: 'peace', target: sel, concede: true })}>Offer concessions</Btn>
              </>
            ) : (
              <>
                {!allies.has(sel) && <Btn lock={needRank(caps, 'diplomacy')} onClick={() => act({ type: 'propose', kind: 'alliance', target: sel })}>Propose alliance</Btn>}
                <Btn lock={needRank(caps, 'militaryDiplomacy')} onClick={() => act({ type: 'propose', kind: 'access', target: sel })}>Ask military access</Btn>
                <Btn lock={needRank(caps, 'militaryDiplomacy')} onClick={() => act({ type: 'propose', kind: 'intel', target: sel })}>Intelligence sharing</Btn>
                <Btn lock={needRank(caps, 'diplomacy')} onClick={() => act({ type: 'propose', kind: 'trade', target: sel })}>Trade agreement</Btn>
                <Btn lock={needRank(caps, 'diplomacy')} onClick={() => act({ type: 'propose', kind: 'nap', target: sel })}>Non-aggression pact</Btn>
                {allies.has(sel) && <Btn lock={needRank(caps, 'militaryDiplomacy')} onClick={() => act({ type: 'propose', kind: 'joinwar', target: sel })}>Call to arms</Btn>}
                {allies.has(sel) && <Btn kind="ghost" lock={needRank(caps, 'diplomacy')} onClick={() => act({ type: 'breakAlliance', target: sel })}>Leave alliance</Btn>}
                {!allies.has(sel) && (
                  <ConfirmBtn kind="danger" lock={needRank(caps, 'war')} confirmText={`Confirm: war on ${world.countries[sel].name}`} onConfirm={() => act({ type: 'declareWar', target: sel })}>
                    Declare war
                  </ConfirmBtn>
                )}
                {caps.includes('advise') && !caps.includes('war') && <Btn onClick={() => act({ type: 'advise', kind: 'war', target: sel })}>Advise war (10 influence)</Btn>}
              </>
            )}
          </div>
          {result && (
            <div class={`result ${result.ok && result.accepted !== false ? 'good' : 'bad'}`}>
              {!result.ok ? result.reason : result.pending ? 'Proposal sent; awaiting their answer.' : result.accepted === false ? 'They refused.' : result.accepted ? 'They accepted!' : 'Done.'}
              {result.reasons && (
                <ul>
                  {result.reasons.map(([t, val]) => (
                    <li class={val >= 0 ? 'good' : 'bad'}>
                      {t} {val > 0 ? '+' : ''}
                      {val}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Section>
      )}
      {sel !== null && <HotlineSection v={v} world={world} ctl={ctl} target={sel} />}
    </>
  );
}

// ------------------------------------------------------------ empire
function EmpirePanel({ v, world, ctl }) {
  const caps = v.me.caps;
  const mine = v.empires.find((e) => e.mine);
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  if (!mine) {
    return (
      <>
        <Section title="Empires">
          <p class="muted">Empires unite nations under one banner: shared wars, supply, intelligence, tribute and megaprojects. Found your own, ask to join one, or serve in another commander's empire as an Imperial Officer.</p>
          {!v.empires.length && <p class="muted">No empires yet.</p>}
          {v.empires.map((e) => (
            <div class="op">
              <header>
                <b>{e.name}</b>
                <small>{e.members.length} members</small>
              </header>
              <small>
                Sovereign: {cname(world, e.sovereign)}
                {e.emperor ? ` · Emperor ${e.emperor}` : ''} · {Math.round(e.popShare * 100)}% of humanity
              </small>
              <div class="row-btns">
                <Btn lock={needRank(caps, 'diplomacy')} onClick={() => ctl.command({ type: 'empire', op: 'request', empire: e.id })}>Ask to join</Btn>
                <ConfirmBtn confirmText={`Confirm: command ${cname(world, e.sovereign)} forces`} onConfirm={() => ctl.command({ type: 'empire', op: 'serve', empire: e.id })}>Serve as officer</ConfirmBtn>
              </div>
            </div>
          ))}
        </Section>
        <Section title="Found an empire">
          <input placeholder={`${world.countries[v.me.country].name} Empire`} value={name} onInput={(e) => setName(e.target.value)} />
          <Btn kind="primary" lock={needRank(caps, 'diplomacy')} onClick={() => ctl.command({ type: 'empire', op: 'found', name })}>Proclaim empire</Btn>
        </Section>
      </>
    );
  }
  const isEmperor = mine.emperorId === v.me.id;
  return (
    <>
      <Section title={mine.name} right={<span class="chip"><i style={{ background: mine.color }} />{Math.round(mine.popShare * 100)}%</span>}>
        <Row k="Sovereign" v={cname(world, mine.sovereign)} />
        <Row k="Emperor" v={mine.emperor || 'AI'} />
        <Row k="Treasury" v={`$${fmt(mine.treasury || 0, 1)}bn`} />
        <Row k="Tribute" v={`${Math.round(mine.charter.tribute * 100)}%`} sub={`war policy: ${mine.charter.war}`} />
        {mine.dominance > 0 && <Row k="Dominance" v={`${mine.dominance}/20 turns`} />}
        <Btn onClick={() => ctl.command({ type: 'empire', op: 'contribute', amount: 5 })}>Contribute $5bn</Btn>
      </Section>
      <Section title={`Members (${mine.members.length})`}>
        {mine.members.map((m) => (
          <Row k={cname(world, m.country)} v={m.tier} sub={m.paid ? `paid ${fmt(m.paid, 1)}` : ''} />
        ))}
        {isEmperor && (
          <div class="row-btns">
            <select value={invite} onChange={(e) => setInvite(e.target.value)}>
              <option value="">Invite a nation…</option>
              {world.countries.map((c, i) => (v.countries[i].alive && !mine.members.some((m) => m.country === i) ? <option value={i}>{c.name}</option> : null))}
            </select>
            <Btn disabled={invite === ''} onClick={() => ctl.command({ type: 'empire', op: 'invite', target: Number(invite) })}>Invite</Btn>
          </div>
        )}
      </Section>
      <Section title="Imperial officers">
        {!mine.officers.length && <p class="muted">No officers yet. Other players can serve your empire from the Empire tab.</p>}
        {mine.officers.map((o) => (
          <Row k={o.name || o.player} v={v.empireTitles[o.title]?.name || o.title} />
        ))}
        {isEmperor && (
          <div class="row-btns">
            {v.players.filter((p) => p.id !== v.me.id).map((p) => (
              <select onChange={(e) => e.target.value && ctl.command({ type: 'empire', op: 'title', player: p.id, title: e.target.value })}>
                <option value="">Title for {p.name}…</option>
                {Object.entries(v.empireTitles).map(([k, t]) => (
                  <option value={k}>{t.name}</option>
                ))}
              </select>
            ))}
          </div>
        )}
      </Section>
      <Section title="Megaprojects">
        {Object.entries(v.empireProjects).map(([k, p]) => {
          const cur = (mine.projects || []).find((x) => x.type === k);
          const done = (mine.done || []).includes(k);
          return (
            <div class="op">
              <header>
                <b>{p.name}</b>
                <small>{done ? 'Complete' : cur ? `${Math.round(cur.progress * 100)}%` : `$${p.cost}bn · ${p.turns} turns`}</small>
              </header>
              <small>{p.text}</small>
              {cur && <Bar value={cur.progress} color="var(--accent)" />}
              {!cur && !done && isEmperor && <Btn onClick={() => ctl.command({ type: 'empire', op: 'project', project: k })}>Start</Btn>}
              {done && k === 'strike' && isEmperor && <Btn kind="danger" onClick={() => store.set({ tool: 'strike', toolProvs: [], panel: null })}>Launch strike</Btn>}
            </div>
          );
        })}
      </Section>
      {!isEmperor && <Btn kind="ghost" onClick={() => ctl.command({ type: 'empire', op: 'leave' })}>Leave empire</Btn>}
    </>
  );
}

// ------------------------------------------------------------ career
function RankPanel({ v }) {
  const me = v.me;
  return (
    <>
      <Section title={me.rankTitle}>
        <div class="career-head">
          <Insignia rank={me.rank} size={54} />
          <div>
            <Row k="Merit" v={me.xpNext ? `${me.xp} / ${me.xpNext}` : 'max'} />
            <Row k="Time in grade" v={`${me.timeInGrade} turns`} />
            <Row k="Performance" v={['F', 'D', 'C', 'B', 'A', 'A+'][Math.min(5, Math.floor(me.rating * 6))]} />
            {me.gate && <Row k="Promotion gate" v={me.gate.met ? '✔ met' : '✖ not yet'} sub={me.gate.text} />}
          </div>
        </div>
        {me.next && (
          <p class="next">
            Next: <b>{me.next.name}</b> — {me.next.text}
          </p>
        )}
      </Section>
      <Section title="This turn's merit">
        {(me.turnXp || []).map(([t, x]) => (
          <Row k={t} v={`+${x}`} />
        ))}
      </Section>
      <Section title="Service record">
        {Object.entries(me.stats).map(([k, val]) => (
          <Row k={k.replace(/([A-Z])/g, ' $1').toLowerCase()} v={val} />
        ))}
      </Section>
      <Section title="The ladder">
        <div class="ladder">
          {RANKS.map((r, i) => (
            <div class={`rung${i === me.rank ? ' cur' : i < me.rank ? ' done' : ''}`}>
              <Insignia rank={i} size={22} />
              <div>
                <b>
                  {i + 1}. {r.name}
                </b>
                {r.appt && <em>{r.appt}</em>}
                <small>{r.text}</small>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

// ------------------------------------------------------------ reports and notifications
function ReportsPanel({ v, world, ctl }) {
  const reps = v.reports.slice().reverse();
  return (
    <>
      {!reps.length && <p class="muted">No reports yet.</p>}
      {reps.map((r) => (
        <div class={`report-row ${r.kind}`} onClick={() => store.set({ modal: { kind: 'report', id: r.id } })}>
          <b>{r.name}</b>
          <small>
            Turn {r.turn + 1} · {r.result}
            {r.kind === 'battle' ? ` · ${cname(world, r.atk.country)} vs ${cname(world, r.def.country)}` : ''}
          </small>
        </div>
      ))}
    </>
  );
}

function NotesPanel({ ctl }) {
  const notes = useStore((s) => s.notes) || [];
  return (
    <>
      {!notes.length && <p class="muted">Nothing yet.</p>}
      {notes.map((n) => (
        <div class={`event ${n.kind}`} onClick={() => n.prov !== undefined && ctl.focusProv(n.prov)}>
          <b>
            {kindIcon[n.kind] || '•'} {n.title}
          </b>
          <small>
            Turn {n.turn + 1}
            {n.text ? ` · ${n.text}` : ''}
          </small>
        </div>
      ))}
    </>
  );
}

function PlayersPanel({ v, world, app }) {
  const mp = useStore((s) => s.lobby);
  const [msg, setMsg] = useState('');
  return (
    <>
      {mp && (
        <Section title="Campaign">
          <Row k="Name" v={mp.name} />
          <Row k="Join code" v={<span class="code">{mp.code}</span>} />
          <Row k="Mode" v={mp.settings.mode} />
          <Btn onClick={() => navigator.clipboard && navigator.clipboard.writeText(mp.code)}>Copy code</Btn>
          <Btn onClick={() => navigator.clipboard && navigator.clipboard.writeText(`${location.origin}${location.pathname}?join=${mp.code}`)}>Copy invite link</Btn>
        </Section>
      )}
      {mp && (
        <Section title="Chat">
          <div class="chat-log">
            {mp.chat.slice(-15).map((c) => (
              <div>
                <b>{c.from}:</b> {c.text}
              </div>
            ))}
          </div>
          <input placeholder="Message all commanders…" value={msg} onInput={(e) => setMsg(e.target.value)} onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && msg.trim()) {
              app.conn.raw({ t: 'chat', text: msg });
              setMsg('');
            }
          }} />
        </Section>
      )}
      <Section title="Commanders">
        {v.players.map((p) => (
          <div class="frow">
            <div>
              <b>
                {p.online ? '●' : '○'} {p.name}
              </b>
              <small>
                {cname(world, p.country)} · {p.rankTitle}
              </small>
            </div>
          </div>
        ))}
      </Section>
      {v.players.length > 1 && <GrantsSection v={v} world={world} app={app} />}
    </>
  );
}

function GrantsSection({ v, world, app }) {
  const [perm, setPerm] = useState('VIEW_ARMIES');
  const [to, setTo] = useState('');
  const ctl = app.ctl;
  const mine = v.formations.filter((f) => f.mine);
  const [assets, setAssets] = useState([]);
  return (
    <Section title="Permissions for allies">
      <p class="muted">Grant allies scoped access. Delegated formations show a badge and you can revoke at any time.</p>
      <select value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">Choose a commander…</option>
        {v.players.filter((p) => p.id !== v.me.id).map((p) => (
          <option value={p.id}>
            {p.name} ({cname(world, p.country)})
          </option>
        ))}
      </select>
      <select value={perm} onChange={(e) => setPerm(e.target.value)}>
        {['VIEW_ARMIES', 'VIEW_ECONOMY', 'VIEW_INTELLIGENCE', 'REQUEST_MOVEMENT', 'CONTROL_ARMIES', 'MANAGE_OPERATIONS'].map((p) => (
          <option value={p}>{p.replace(/_/g, ' ').toLowerCase()}</option>
        ))}
      </select>
      {perm === 'CONTROL_ARMIES' && (
        <div class="asset-pick">
          {mine.map((f) => (
            <label class="check">
              <input type="checkbox" checked={assets.includes(f.id)} onChange={(e) => setAssets(e.target.checked ? [...assets, f.id] : assets.filter((x) => x !== f.id))} /> {f.name}
            </label>
          ))}
        </div>
      )}
      <Btn disabled={!to} onClick={() => ctl.command({ type: 'grant', grantee: to, perm, assets })}>Grant</Btn>
      {v.me.grantsFromMe.map((g) => (
        <div class="frow">
          <div>
            <b>{g.perm.replace(/_/g, ' ').toLowerCase()}</b>
            <small>
              to {g.to} {g.assets.length ? `· ${g.assets.length} formation(s)` : ''}
            </small>
          </div>
          <Btn kind="ghost" onClick={() => ctl.command({ type: 'revoke', id: g.id })}>Revoke</Btn>
        </div>
      ))}
      {v.me.grantsToMe.length > 0 && (
        <>
          <h5>Granted to you</h5>
          {v.me.grantsToMe.map((g) => (
            <Row k={g.perm.replace(/_/g, ' ').toLowerCase()} v={g.from} />
          ))}
        </>
      )}
    </Section>
  );
}

const PANELS = {
  staff: { title: 'Chief of Staff', C: StaffPanel },
  strategic: { title: 'Strategic Command', C: StrategicPanel },
  world: { title: 'World', C: WorldPanel },
  armies: { title: 'Armies', C: ArmiesPanel },
  fronts: { title: 'Fronts', C: FrontsPanel },
  operations: { title: 'Operations', C: OperationsPanel },
  intel: { title: 'Intelligence', C: IntelPanel },
  economy: { title: 'Economy', C: EconomyPanel },
  production: { title: 'Production', C: ProductionPanel },
  air: { title: 'Air force & Navy', C: AirPanel },
  diplomacy: { title: 'Diplomacy', C: DiplomacyPanel },
  empire: { title: 'Empire', C: EmpirePanel },
  rank: { title: 'Career', C: RankPanel },
  reports: { title: 'Reports', C: ReportsPanel },
  notes: { title: 'Notifications', C: NotesPanel },
  multiplayer: { title: 'Commanders', C: PlayersPanel },
};

export { xpToNext, rankTitle };
