// Multiplayer: connect, create or join a campaign with a code, and the campaign lobby.
import { useEffect, useState } from 'preact/hooks';
import { store, useStore, toast } from '../state/store.js';
import { SCENARIOS } from '../../../config/scenario.js';
import { START_RANKS } from '../../../config/ranks.js';
import { Btn } from './common.jsx';
import { loadIdentity } from '../net/Online.js';
import { countryProfile } from './Title.jsx';

const ARTIFACT = typeof window !== 'undefined' && !!window.__GC_ARTIFACT__;

const MODES = {
  private: 'Private multiplayer',
  coop: 'Allied co-op',
  teams: 'Team war',
  competitive: 'Competitive',
  custom: 'Custom',
};

export function MultiplayerScreen({ app }) {
  const [name, setName] = useState(loadIdentity().name || 'Commander');
  const [code, setCode] = useState(new URLSearchParams(location.search).get('join') || '');
  const [password, setPassword] = useState('');
  const [tab, setTab] = useState(code ? 'join' : 'create');
  const [cfg, setCfg] = useState({ name: 'Global War', maxPlayers: 8, scenario: 'cold', mode: 'private', startRank: 0, turnTimer: 120, pace: 1, allowShared: false, joinInProgress: true, password: '' });
  const online = useStore((s) => s.online);
  const mine = useStore((s) => s.myCampaigns) || [];
  const [err, setErr] = useState(null);
  useEffect(() => {
    app.goOnline(name).catch((e) => setErr(e.message));
  }, []);
  const set = (k, v) => setCfg({ ...cfg, [k]: v });
  const act = async (fn) => {
    setErr(null);
    const r = await fn();
    if (!r.ok) setErr(r.reason);
  };
  return (
    <div class="title-screen">
      <div class="title-card mp-card">
        <h2>Multiplayer</h2>
        <p class="muted">{online ? `Connected as ${online.name}` : err ? '' : 'Connecting to the campaign server…'}</p>
        <label>Your commander name</label>
        <input value={name} maxLength={24} onInput={(e) => {
          setName(e.target.value);
          app.rename(e.target.value);
        }} />
        <div class="seg tabs">
          <button class={tab === 'create' ? 'on' : ''} onClick={() => setTab('create')}>Create campaign</button>
          <button class={tab === 'join' ? 'on' : ''} onClick={() => setTab('join')}>Join with code</button>
          <button class={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>My campaigns ({mine.length})</button>
        </div>
        {tab === 'create' && (
          <div class="mp-form">
            <label>Campaign name</label>
            <input value={cfg.name} maxLength={40} onInput={(e) => set('name', e.target.value)} />
            <div class="grid2">
              <div>
                <label>Players</label>
                <select value={cfg.maxPlayers} onChange={(e) => set('maxPlayers', Number(e.target.value))}>
                  {[2, 4, 6, 8, 12, 16].map((n) => (
                    <option value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Mode</label>
                <select value={cfg.mode} onChange={(e) => set('mode', e.target.value)}>
                  {Object.entries(MODES).map(([k, l]) => (
                    <option value={k}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Scenario</label>
                <select value={cfg.scenario} onChange={(e) => set('scenario', e.target.value)}>
                  {Object.entries(SCENARIOS).map(([k, s]) => (
                    <option value={k}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Starting rank</label>
                <select value={cfg.startRank} onChange={(e) => set('startRank', Number(e.target.value))}>
                  {START_RANKS.map((r) => (
                    <option value={r.rank}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Turn timer</label>
                <select value={cfg.turnTimer} onChange={(e) => set('turnTimer', Number(e.target.value))}>
                  {[[0, 'Until everyone is ready'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes']].map(([v, l]) => (
                    <option value={v}>{l}</option>
                  ))}
                </select>
              </div>
              {!ARTIFACT && (
                <div>
                  <label>Password (optional)</label>
                  <input type="password" value={cfg.password} onInput={(e) => set('password', e.target.value)} />
                </div>
              )}
            </div>
            <label class="check">
              <input type="checkbox" checked={cfg.allowShared} onChange={(e) => set('allowShared', e.target.checked)} /> Allow several commanders in one nation
            </label>
            <label class="check">
              <input type="checkbox" checked={cfg.joinInProgress} onChange={(e) => set('joinInProgress', e.target.checked)} /> Allow joining after the start
            </label>
            <Btn kind="primary big" disabled={!online} onClick={() => act(() => app.createCampaign(cfg))}>
              Create campaign
            </Btn>
          </div>
        )}
        {tab === 'join' && (
          <div class="mp-form">
            <label>Campaign code</label>
            <input class="code-input" value={code} maxLength={7} placeholder="K7X4Q9" onInput={(e) => setCode(e.target.value.toUpperCase())} />
            {!ARTIFACT && <label>Password (if any)</label>}
            {!ARTIFACT && <input type="password" value={password} onInput={(e) => setPassword(e.target.value)} />}
            <Btn kind="primary big" disabled={!online || code.replace(/[\s-]/g, '').length !== 6} onClick={() => act(() => app.joinCampaign(code, password))}>
              Join campaign
            </Btn>
          </div>
        )}
        {tab === 'mine' && (
          <div class="mp-form">
            {!mine.length && <p class="muted">You have not joined any campaigns yet.</p>}
            {mine.map((c) => (
              <div class="save-row">
                <div>
                  <b>{c.name}</b>
                  <small>
                    {c.code} · {c.status} · turn {c.turn + 1} · {c.players} commanders
                  </small>
                </div>
                <Btn kind="primary" onClick={() => act(() => app.rejoinCampaign(c.id))}>Rejoin</Btn>
              </div>
            ))}
          </div>
        )}
        {err && <p class="bad">{err}</p>}
        {ARTIFACT && (
          <p class="mp-note">
            Friends play from this same artifact: share it with them in claude.ai with Contributor access, then they open it, choose Multiplayer and type your code. The host's browser runs the world, so the host keeps this tab open while you play.
          </p>
        )}
        <Btn kind="ghost" onClick={() => app.leaveOnline()}>Back</Btn>
      </div>
    </div>
  );
}

export function LobbyScreen({ app, world }) {
  const lobby = useStore((s) => s.lobby);
  const online = useStore((s) => s.online);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [chat, setChat] = useState('');
  const [pick, setPick] = useState(null);
  useEffect(() => {
    app.pickMode((c) => setPick(c));
    return () => app.pickMode(null);
  }, []);
  useEffect(() => {
    if (pick !== null) app.highlightCountry(pick);
  }, [pick]);
  if (!lobby) return null;
  const me = lobby.members.find((m) => m.id === online?.id);
  const isHost = lobby.hostId === online?.id || lobby.actingHost === online?.id;
  const taken = new Map(lobby.members.filter((m) => m.country !== null && !m.serve).map((m) => [m.country, m.name]));
  const act = async (msg) => {
    setErr(null);
    const r = await app.conn.request(msg);
    if (!r.ok) setErr(r.reason);
    return r;
  };
  const list = world.countries.map((c, i) => [c.name, i, c.pop]).filter(([n]) => !q || n.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b[2] - a[2]).slice(0, q ? 30 : 20);
  const prof = pick !== null ? countryProfile(world, pick) : null;
  const inviteLink = `${location.origin}${location.pathname}?join=${lobby.code}`;
  const copy = (t) => {
    if (navigator.clipboard) navigator.clipboard.writeText(t);
    toast({ kind: 'build', title: 'Copied', text: t });
  };
  const lords = lobby.members.filter((m) => m.id !== online?.id && m.country !== null && !m.serve);
  return (
    <div class="setup lobby">
      <div class="setup-left panel-glass">
        <small class="muted">Campaign</small>
        <h2>{lobby.name}</h2>
        <div class="code-box">
          <span class="code">{lobby.code}</span>
          <Btn onClick={() => copy(lobby.code)}>Copy code</Btn>
          {!ARTIFACT && <Btn onClick={() => copy(inviteLink)}>Invite link</Btn>}
        </div>
        <div class="lobby-meta">
          <span>{SCENARIOS[lobby.settings.scenario]?.name}</span>
          <span>{MODES[lobby.settings.mode]}</span>
          <span>
            {lobby.members.length}/{lobby.settings.maxPlayers} commanders
          </span>
          <span>{lobby.settings.turnTimer ? `${lobby.settings.turnTimer}s turns` : 'ready-up turns'}</span>
          <span>{lobby.status}</span>
        </div>
        <h4>Commanders</h4>
        <div class="members">
          {lobby.members.map((m) => (
            <div class={`member${m.id === online?.id ? ' me' : ''}`}>
              <span class={`dot ${m.online ? 'on' : ''}`} />
              <div>
                <b>
                  {m.name}
                  {m.role === 'host' ? ' ★' : ''}
                </b>
                <small>{m.country === null ? 'choosing…' : m.serve ? `serves ${lobby.members.find((x) => x.id === m.serve)?.name} (${world.countries[m.country].name})` : world.countries[m.country].name}</small>
              </div>
              {lobby.status === 'lobby' && <span class={`ready ${m.ready ? 'on' : ''}`}>{m.ready ? 'READY' : '—'}</span>}
              {isHost && m.id !== online?.id && lobby.status === 'lobby' && (
                <button class="x" title="Remove" onClick={() => act({ t: 'kick', player: m.id })}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <div class="chat">
          <div class="chat-log">
            {lobby.chat.map((c) => (
              <div>
                <b>{c.from}:</b> {c.text}
              </div>
            ))}
          </div>
          <input placeholder="Message your allies…" value={chat} onInput={(e) => setChat(e.target.value)} onKeyDown={(e) => {
            if (e.key === 'Enter' && chat.trim()) {
              app.conn.raw({ t: 'chat', text: chat });
              setChat('');
            }
          }} />
        </div>
        {err && <p class="bad">{err}</p>}
        <div class="setup-go">
          <Btn kind="ghost" onClick={() => app.leaveCampaign()}>Leave</Btn>
          {lobby.status === 'lobby' && <Btn onClick={() => act({ t: 'ready', on: !me?.ready })}>{me?.ready ? 'Not ready' : 'Ready'}</Btn>}
          {isHost && lobby.status === 'lobby' && (
            <Btn kind="primary" onClick={() => act({ t: 'start' })}>
              START
            </Btn>
          )}
          {isHost && !ARTIFACT && <Btn kind="ghost" onClick={() => act({ t: 'regen' })} title="Invalidate the old code">New code</Btn>}
        </div>
      </div>
      <div class="setup-right panel-glass">
        <input class="search" placeholder="Search nations… or click the map" value={q} onInput={(e) => setQ(e.target.value)} />
        <div class="country-list">
          {list.map(([n, i]) => (
            <button class={`${i === pick ? 'on' : ''}${taken.has(i) ? ' taken' : ''}`} onClick={() => setPick(i)} title={taken.has(i) ? `Taken by ${taken.get(i)}` : ''}>
              <i style={{ background: world.countries[i].color }} />
              {n}
            </button>
          ))}
        </div>
        {prof && (
          <div class="country-card">
            <div class="cc-head">
              <i style={{ background: prof.wc.color }} />
              <div>
                <h3>{prof.wc.nameLong}</h3>
                <small>
                  {prof.wc.subregion} · {prof.wc.provinces} provinces
                </small>
              </div>
            </div>
            <div class="cc-grid">
              <div>
                <em>Active forces</em>
                <b>{Math.round(prof.mil.active)}k</b>
              </div>
              <div>
                <em>Tanks</em>
                <b>{prof.mil.tanks}</b>
              </div>
            </div>
            {taken.has(pick) && <p class="warn">Taken by {taken.get(pick)}{lobby.settings.allowShared ? ' (shared command allowed)' : ''}</p>}
            <Btn kind="primary" disabled={lobby.status !== 'lobby' && me?.country !== null} onClick={() => act({ t: 'pick', country: pick })}>
              Command {prof.wc.name}
            </Btn>
          </div>
        )}
        {lords.length > 0 && lobby.status === 'lobby' && (
          <div class="serve">
            <h4>Join another commander's empire</h4>
            <p class="muted">Serve as an Imperial Officer inside their nation. They can grant you titles and armies.</p>
            {lords.map((m) => (
              <Btn onClick={() => act({ t: 'pick', serve: m.id })}>
                Serve {m.name} ({world.countries[m.country].name})
              </Btn>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
