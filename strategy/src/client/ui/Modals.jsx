// Modal dialogs and map tool bars.
import { LaunchModal } from './Strategic.jsx';
import { Guide } from './Guide.jsx';
import { useState } from 'preact/hooks';
import { store, useStore } from '../state/store.js';
import { RANKS } from '../../../config/ranks.js';
import { fmt, Btn, Insignia, Row } from './common.jsx';

export function Modals({ world, ctl, app }) {
  const modal = useStore((s) => s.modal);
  const v = useStore((s) => s.view);
  if (!modal) return null;
  const close = () => store.set({ modal: null });
  let body = null;
  if (modal.kind === 'promotion') body = <Promotion modal={modal} close={close} v={v} />;
  else if (modal.kind === 'report') body = <Report id={modal.id} v={v} world={world} close={close} ctl={ctl} />;
  else if (modal.kind === 'menu') body = <Menu close={close} app={app} v={v} />;
  else if (modal.kind === 'saves') body = <Saves close={close} app={app} />;
  else if (modal.kind === 'help') body = <Help close={close} />;
  else if (modal.kind === 'guide') body = <Guide close={close} />;
  else if (modal.kind === 'launch') body = <LaunchModal modal={modal} v={v} world={world} ctl={ctl} close={close} />;
  else if (modal.kind === 'operation') body = <OperationPlan modal={modal} close={close} v={v} world={world} ctl={ctl} />;
  else if (modal.kind === 'recon') {
    store.set({ modal: null, tool: 'recon', toolFor: modal.f, toolProvs: [] });
    return null;
  }
  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class={`modal ${modal.kind}`}>{body}</div>
    </div>
  );
}

function Promotion({ modal, close, v }) {
  const r = RANKS[modal.rank];
  return (
    <div class="promo">
      <div class="promo-glow" />
      <Insignia rank={modal.rank} size={96} />
      <h2>{modal.title}</h2>
      <p class="promo-text">{r.text}</p>
      <div class="promo-grid">
        <Row k="Command" v={r.elements > 1e8 ? 'Unlimited' : `${r.elements} elements · ${r.formations} formations`} />
        <Row k="Orders per turn" v={r.orders} />
        <Row k="Operational area" v={typeof r.area === 'number' ? `${r.area} provinces from HQ` : r.area} />
        <Row k="Command Points" v={`${r.cp} per turn`} />
        <Row k="Intelligence clearance" v={r.cl} />
      </div>
      {v && v.me.next && <p class="muted">Next: {v.me.next.name}</p>}
      <Btn kind="primary big" onClick={close}>
        Continue
      </Btn>
    </div>
  );
}

function Report({ id, v, world, close, ctl }) {
  const r = v && v.reports.find((x) => x.id === id);
  if (!r) return <Btn onClick={close}>Close</Btn>;
  if (r.kind === 'operation') {
    return (
      <div class="report">
        <h2>{r.name}</h2>
        <h3>{r.result}</h3>
        <Row k="Objectives" v={r.objectives.map((q) => world.nameOf(q)).join(', ')} />
        <Btn kind="primary" onClick={close}>Close</Btn>
      </div>
    );
  }
  const won = (r.winner === 'A' && r.atk.country === v.me.country) || (r.winner === 'D' && r.def.country === v.me.country);
  const involved = r.atk.country === v.me.country || r.def.country === v.me.country;
  return (
    <div class="report">
      <div class="rep-head">
        <small>Turn {r.turn + 1} · Battle report</small>
        <h2>{r.name}</h2>
        <h3 class={involved ? (won ? 'good' : 'bad') : ''}>{involved ? (won ? 'VICTORY' : 'DEFEAT') : r.result}</h3>
        <p class="muted">{r.result}</p>
      </div>
      <div class="rep-sides">
        <div>
          <em>Attacker</em>
          <b style={{ color: world.countries[r.atk.country].color }}>{world.countries[r.atk.country].name}</b>
          <small>{r.atk.units.join(', ')}</small>
          <Row k="Elements" v={r.atk.elements} />
          <Row k="Losses" v={fmt(r.lossesA)} />
        </div>
        <div>
          <em>Defender</em>
          <b style={{ color: world.countries[r.def.country].color }}>{world.countries[r.def.country].name}</b>
          <small>{r.def.units.join(', ')}</small>
          <Row k="Elements" v={r.def.elements} />
          <Row k="Losses" v={fmt(r.lossesD)} />
          {r.surrendered > 0 && <Row k="Surrendered" v={fmt(r.surrendered)} />}
        </div>
      </div>
      <h4>Key factors</h4>
      <ul class="keys">
        {r.key.map((k) => (
          <li>{k}</li>
        ))}
      </ul>
      <details>
        <summary>All modifiers</summary>
        <div class="rep-sides">
          <div>
            {r.factorsA.map(([k, val]) => (
              <Row k={k} v={`${val > 0 ? '+' : ''}${val}%`} />
            ))}
          </div>
          <div>
            {r.factorsD.map(([k, val]) => (
              <Row k={k} v={`${val > 0 ? '+' : ''}${val}%`} />
            ))}
          </div>
        </div>
      </details>
      <div class="row-btns">
        <Btn onClick={() => {
          ctl.focusProv(r.prov, 12);
          close();
        }}>Show on map</Btn>
        <Btn kind="primary" onClick={close}>Close</Btn>
      </div>
    </div>
  );
}

function Menu({ close, app, v }) {
  return (
    <div class="menu">
      <h2>Menu</h2>
      <Btn onClick={() => {
        app.save();
        close();
      }}>Save game</Btn>
      <Btn onClick={() => store.set({ modal: { kind: 'saves' } })}>Load game</Btn>
      <Btn onClick={() => app.exportSave()}>Export save file</Btn>
      <Btn onClick={() => store.set({ modal: { kind: 'guide' } })}>Field manual</Btn>
      <Btn onClick={() => store.set({ modal: { kind: 'help' } })}>Controls</Btn>
      {v && v.me.dev && <Btn onClick={() => store.set({ panel: 'dev', modal: null })}>Developer tools</Btn>}
      <Btn kind="ghost" onClick={() => app.quit()}>Quit to title</Btn>
      <Btn kind="primary" onClick={close}>Resume</Btn>
    </div>
  );
}

function Saves({ close, app }) {
  const saves = useStore((s) => s.saves) || [];
  return (
    <div class="saves">
      <h2>Saved campaigns</h2>
      {!saves.length && <p class="muted">No saves yet.</p>}
      {saves.map((s) => (
        <div class="save-row">
          <div>
            <b>{s.country}</b>
            <small>
              {RANKS[s.rank]?.name} · {s.date} · turn {s.turn + 1} · {s.slot}
            </small>
          </div>
          <Btn kind="primary" onClick={() => {
            close();
            app.load(s.slot);
          }}>Load</Btn>
          <Btn kind="ghost" onClick={() => app.deleteSave(s.slot)}>Delete</Btn>
        </div>
      ))}
      <label class="btn">
        Import save file
        <input type="file" accept=".json,.gcsave" style={{ display: 'none' }} onChange={(e) => app.importSave(e.target.files[0])} />
      </label>
      <Btn onClick={close}>Close</Btn>
    </div>
  );
}

function Help({ close }) {
  return (
    <div class="help">
      <h2>How to play</h2>
      <ul>
        <li><b>Select</b> a formation by clicking its counter. Your forces have a gold ring; enemies a red one.</li>
        <li><b>Move</b>: right-click a province, or drag the counter. Moving into enemy land attacks it. Hover first to see the route and the battle forecast.</li>
        <li><b>End turn</b> (Enter): every nation moves at once, battles are fought, then you get reports.</li>
        <li><b>Rank up</b> by completing directives, winning battles and taking ground. Each promotion unlocks new authority: more troops, orders, tools, and eventually the whole nation.</li>
        <li><b>Hotkeys</b>: H hold · D dig in · W withdraw · S split · M merge · Tab next formation · Home your HQ · 1–9 map modes · Esc deselect.</li>
        <li><b>Supply</b> flows from cities, hubs and ports through your territory. Encircled forces starve.</li>
        <li><b>Empires</b>: as a head of state, proclaim an empire, invite nations, grant titles and build megaprojects. In multiplayer, other commanders can join your empire or serve as your officers.</li>
      </ul>
      <Btn kind="primary" onClick={close}>Got it</Btn>
    </div>
  );
}

function OperationPlan({ modal, close, v, world, ctl }) {
  const mine = v.formations.filter((f) => f.mine);
  const [forces, setForces] = useState(mine.filter((f) => !f.battle).slice(0, 6).map((f) => f.id));
  const [prep, setPrep] = useState(1);
  const [name, setName] = useState('');
  return (
    <div class="opplan">
      <h2>Plan operation</h2>
      <Row k="Objectives" v={modal.objectives.map((q) => world.nameOf(q)).join(', ')} />
      <label>Name (optional)</label>
      <input placeholder="OPERATION …" value={name} onInput={(e) => setName(e.target.value)} />
      <label>Preparation turns (each adds attack bonus)</label>
      <div class="seg">
        {[0, 1, 2, 3].map((n) => (
          <button class={prep === n ? 'on' : ''} onClick={() => setPrep(n)}>
            {n}
          </button>
        ))}
      </div>
      <label>Forces</label>
      <div class="asset-pick">
        {mine.map((f) => (
          <label class="check">
            <input type="checkbox" checked={forces.includes(f.id)} onChange={(e) => setForces(e.target.checked ? [...forces, f.id] : forces.filter((x) => x !== f.id))} /> {f.name} <small>({f.n} el., {world.nameOf(f.prov)})</small>
          </label>
        ))}
      </div>
      <div class="row-btns">
        <Btn kind="ghost" onClick={close}>Cancel</Btn>
        <Btn kind="primary" disabled={!forces.length} onClick={async () => {
          const r = await ctl.command({ type: 'operation', name, objectives: modal.objectives, forces, prep });
          if (r.ok) close();
        }}>Launch planning</Btn>
      </div>
    </div>
  );
}

// Bar shown while a map tool is active (defensive line, objectives, sea transport, recon, strike).
export function ToolBar({ ctl, world }) {
  const tool = useStore((s) => s.tool);
  const provs = useStore((s) => s.toolProvs);
  const toolFor = useStore((s) => s.toolFor);
  if (!tool) return null;
  const text = {
    line: 'Click provinces to form a defensive line.',
    objectives: 'Click enemy provinces to mark operation objectives.',
    sea: 'Click a coastal province to sail there.',
    recon: 'Click a province to reconnoitre (1 CP).',
    strike: 'Click any province to strike it.',
    missile: 'Click an enemy province for the missile strike (3 CP).',
    nuke: 'Designate the nuclear target. Right-click to cancel.',
    teleport: 'Click a province to teleport the formation (dev).',
  }[tool];
  const single = tool === 'sea' || tool === 'recon' || tool === 'strike' || tool === 'teleport' || tool === 'missile' || tool === 'nuke';
  if (single && provs.length) {
    const target = provs[provs.length - 1];
    store.set({ tool: null, toolProvs: [] });
    if (tool === 'sea') ctl.command({ type: 'sea', f: toolFor, to: target });
    if (tool === 'recon') ctl.command({ type: 'recon', f: toolFor, prov: target });
    if (tool === 'strike') ctl.command({ type: 'empire', op: 'strike', prov: target });
    if (tool === 'missile') ctl.command({ type: 'missile', prov: target }).then((r) => r.ok && ctl.strike && ctl.strike.launch(ctl.view.countries[ctl.view.me.country].capital, target, { color: [255, 150, 60] }));
    if (tool === 'nuke') store.set({ modal: { kind: 'launch', prov: target } });
    if (tool === 'teleport') ctl.command({ type: 'dev', action: 'teleport', f: toolFor, prov: target });
    return null;
  }
  return (
    <div class="toolbar">
      <b>{text}</b>
      {!single && <span>{provs.map((q) => world.nameOf(q)).join(' · ') || 'none yet'}</span>}
      {!single && (
        <Btn kind="primary" disabled={!provs.length} onClick={() => {
          store.set({ tool: null, toolProvs: [] });
          if (tool === 'line') ctl.command({ type: 'line', provs });
          if (tool === 'objectives') store.set({ modal: { kind: 'operation', objectives: provs } });
        }}>Confirm</Btn>
      )}
      <Btn kind="ghost" onClick={() => store.set({ tool: null, toolProvs: [] })}>Cancel</Btn>
    </div>
  );
}
