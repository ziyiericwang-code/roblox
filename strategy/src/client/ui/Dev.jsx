// Developer tools panel. Only rendered when the server/dev build marked this player as a developer.
import { useState } from 'preact/hooks';
import { store, useStore } from '../state/store.js';
import { RANKS } from '../../../config/ranks.js';
import { Btn, Section } from './common.jsx';

export function DevPanel({ world, ctl }) {
  const v = useStore((s) => s.view);
  const sel = useStore((s) => s.sel);
  const [rank, setRank] = useState(v ? v.me.rank : 0);
  const [target, setTarget] = useState('');
  if (!v || !v.me.dev) return null;
  const dev = (action, extra = {}) => ctl.command({ type: 'dev', action, ...extra });
  const selProv = sel && sel.kind === 'province' ? sel.id : v.me.hq;
  return (
    <aside class="drawer dev">
      <header>
        <h3>Developer tools</h3>
        <button class="x" onClick={() => store.set({ panel: null })}>×</button>
      </header>
      <div class="drawer-body">
        <p class="warn">Developer only. Every action is logged and the campaign is flagged.</p>
        <Section title="Career">
          <select value={rank} onChange={(e) => setRank(Number(e.target.value))}>
            {RANKS.map((r, i) => (
              <option value={i}>{i + 1}. {r.name}{r.appt ? ` — ${r.appt}` : ''}</option>
            ))}
          </select>
          <div class="row-btns">
            <Btn onClick={() => dev('rank', { rank })}>Set rank</Btn>
            <Btn onClick={() => dev('rank', { rank: 49 })}>Supreme Commander</Btn>
            <Btn onClick={() => dev('xp', { amount: 500 })}>+500 merit</Btn>
            <Btn onClick={() => dev('cp')}>Max CP</Btn>
          </div>
        </Section>
        <Section title="Nation">
          <div class="row-btns">
            <Btn onClick={() => dev('resources')}>Give resources</Btn>
            <Btn onClick={() => dev('reveal')}>Toggle reveal map</Btn>
            <Btn onClick={() => dev('tension', { value: 100 })}>Max tension</Btn>
          </div>
        </Section>
        <Section title="War">
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Pick a country…</option>
            {world.countries.map((c, i) => (i !== v.me.country ? <option value={i}>{c.name}</option> : null))}
          </select>
          <div class="row-btns">
            <Btn disabled={target === ''} onClick={() => dev('war', { b: Number(target) })}>Force war</Btn>
            <Btn disabled={target === ''} onClick={() => dev('peace', { b: Number(target) })}>Force peace</Btn>
            <Btn disabled={target === ''} onClick={() => dev('country', { country: Number(target) })}>Switch country</Btn>
          </div>
        </Section>
        <Section title="Units">
          <div class="row-btns">
            <Btn onClick={() => dev('spawn', { prov: selProv })}>Spawn strike group ({world.nameOf(selProv)})</Btn>
            <Btn onClick={() => dev('massBattle', { prov: selProv })}>Test mass battle</Btn>
            {sel && sel.kind === 'formation' && <Btn onClick={() => store.set({ tool: 'teleport', toolFor: sel.id, toolProvs: [] })}>Teleport selected</Btn>}
            {sel && sel.kind === 'province' && <Btn onClick={() => dev('owner', { prov: sel.id, country: v.me.country })}>Take province</Btn>}
          </div>
        </Section>
        <Section title="Turns">
          <div class="row-btns">
            {[1, 5, 10].map((n) => (
              <Btn onClick={async () => {
                for (let i = 0; i < n; i++) {
                  ctl.endTurn();
                  await new Promise((r) => {
                    const off = ctl.conn.on((m) => {
                      if (m.t === 'view' && m.turnDone) {
                        off();
                        r();
                      }
                    });
                  });
                }
              }}>
                Run {n}
              </Btn>
            ))}
          </div>
          {store.state.lastTurnMs !== undefined && <p class="muted">Last turn resolved in {store.state.lastTurnMs} ms</p>}
        </Section>
        {ctl.conn.online && <MpDev v={v} world={world} ctl={ctl} />}
      </div>
    </aside>
  );
}

function MpDev({ v, world, ctl }) {
  const [who, setWho] = useState('');
  const [out, setOut] = useState('');
  const others = v.players.filter((p) => p.id !== v.me.id);
  const op = async (m) => {
    const r = await ctl.conn.request({ t: 'mpdev', ...m });
    setOut(r.ok ? (r.views ? `${r.views} views · ${r.perView} ms · ${r.kb} KB each` : 'Done') : r.reason);
  };
  return (
    <Section title="Multiplayer testing">
      <div class="btn-row">
        <Btn onClick={() => op({ op: 'bot' })}>Add test player</Btn>
        <Btn onClick={() => op({ op: 'hostfail' })}>Simulate host failure</Btn>
        <Btn onClick={() => op({ op: 'resolve' })}>Force turn</Btn>
        <Btn onClick={() => op({ op: 'load', reps: 10 })}>Network load test</Btn>
      </div>
      <select value={who} onChange={(e) => setWho(e.target.value)}>
        <option value="">Choose a commander…</option>
        {others.map((p) => (
          <option value={p.id}>
            {p.name} ({world.countries[p.country].name})
          </option>
        ))}
      </select>
      <div class="btn-row">
        <Btn disabled={!who} onClick={() => op({ op: 'drop', player: who })}>Simulate disconnect</Btn>
        <Btn disabled={!who} onClick={() => op({ op: 'kick', player: who })}>Force leave</Btn>
        <Btn disabled={!who || store.state.sel?.kind !== 'province'} onClick={() => op({ op: 'country', player: who, country: world.provinces.country[store.state.sel.id] })}>
          Move to selected nation
        </Btn>
      </div>
      {out && <p class="muted">{out}</p>}
    </Section>
  );
}
