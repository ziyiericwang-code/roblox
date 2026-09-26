// Claude-powered command staff: Chief of Staff chat (with order tools), the leader hotline,
// and the WNN nightly bulletin. Shown only where the artifact viewer lets the page ask Claude.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, toast } from '../state/store.js';
import { Btn, Section } from './common.jsx';
import { getSample, aiLimits, aiError, staffTools, staffBrief, hotlineBrief, newsBrief } from '../ai/claude.js';

const SUGGEST = ['Situation report', 'Where should I attack next?', 'Which of my formations is in danger?', 'Dig in everything on the front line'];

export function StaffPanel({ v, world, ctl }) {
  const [log, setLog] = useState([]); // {role, content, tools?}
  const [text, setText] = useState('');
  const [live, setLive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [acts, setActs] = useState([]);
  const abort = useRef(null);
  const end = useRef(null);
  useEffect(() => end.current && end.current.scrollIntoView({ block: 'end' }), [log, live, acts]);
  const ask = async (q) => {
    const sample = await getSample();
    if (!sample || busy || !q.trim()) return;
    const limits = await aiLimits();
    const turns = [...log, { role: 'user', content: q.trim() }].slice(-12);
    setLog(turns);
    setText('');
    setErr('');
    setActs([]);
    setBusy(true);
    setLive('');
    const ctlr = new AbortController();
    abort.current = ctlr;
    const tools = limits && limits.tools
      ? staffTools(world, ctl).map((t) => ({
          ...t,
          execute: async (input, cx) => {
            setActs((a) => [...a, t.name.startsWith('order') ? `⚑ ${t.name.replace('_', ' ')} #${input.formation_id}` : `… ${t.name.replace('_', ' ')}`]);
            return t.execute(input, cx);
          },
        }))
      : undefined;
    try {
      const { text: answer } = await sample([{ role: 'user', content: staffBrief(world, ctl.view) }, ...turns], tools ? { signal: ctlr.signal, onText: ({ text: t }) => setLive(t), tools, cache: false } : { signal: ctlr.signal, onText: ({ text: t }) => setLive(t), cache: false });
      setLog([...turns, { role: 'assistant', content: answer }]);
    } catch (e) {
      if (e.text) setLog([...turns, { role: 'assistant', content: `${e.text} [interrupted]` }]);
      const m = aiError(e);
      if (m) setErr(m);
    } finally {
      setLive(null);
      setBusy(false);
    }
  };
  return (
    <div class="staff">
      <p class="muted">Your Chief of Staff reads the battlefield and can issue orders for you when you ask. Answers use your own Claude account.</p>
      <div class="staff-log" aria-live="polite">
        {!log.length && live === null && (
          <div class="staff-empty">
            {SUGGEST.map((s) => (
              <button class="chip-btn" onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {log.map((m) => (
          <div class={`msg ${m.role}`}>{m.content}</div>
        ))}
        {acts.length > 0 && <div class="acts">{acts.map((a) => <span>{a}</span>)}</div>}
        {live !== null && <div class="msg assistant live">{live || 'Thinking…'}</div>}
        <div ref={end} />
      </div>
      {err && <p class="bad">{err}</p>}
      <div class="staff-input">
        <textarea id="staff-input" rows={2} placeholder="Orders or questions for your staff…" value={text} onInput={(e) => setText(e.target.value)} onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            ask(text);
          }
        }} />
        {busy ? <Btn onClick={() => abort.current && abort.current.abort()}>Stop</Btn> : <Btn kind="primary" disabled={!text.trim()} onClick={() => ask(text)}>Send</Btn>}
      </div>
      {log.length > 0 && !busy && (
        <Btn kind="ghost" onClick={() => setLog([])}>
          New conversation
        </Btn>
      )}
    </div>
  );
}

export function HotlineSection({ v, world, ctl, target }) {
  const ai = useStore((s) => s.ai);
  const [log, setLog] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    setLog([]);
    setErr('');
  }, [target]);
  if (!ai) return null;
  const official = v.me.caps.includes('diplomacy');
  const send = async () => {
    const sample = await getSample();
    if (!sample || busy || !text.trim()) return;
    const turns = [...log.map((m) => ({ role: m.role, content: m.role === 'assistant' ? m.reply : m.content })), { role: 'user', content: text.trim() }].slice(-10);
    setLog([...log, { role: 'user', content: text.trim() }]);
    setText('');
    setErr('');
    setBusy(true);
    try {
      const r = await sample.json([{ role: 'user', content: hotlineBrief(world, ctl.view, target) }, ...turns], { cache: false, modelTier: 'quick' });
      const reply = String(r && r.reply ? r.reply : '…').slice(0, 600);
      const mood = Math.max(-2, Math.min(2, Math.round(Number(r && r.mood) || 0)));
      let effect = '';
      if (official) {
        const res = await ctl.command({ type: 'hotline', target, mood }, { quiet: true });
        effect = res.ok ? (mood > 0 ? `Their opinion of you rose to ${res.opinion}.` : mood < 0 ? `Their opinion of you fell to ${res.opinion}.` : 'No change in their opinion.') : res.reason;
      }
      setLog((l) => [...l, { role: 'assistant', reply, mood, effect }]);
    } catch (e) {
      const m = aiError(e);
      if (m) setErr(m);
    } finally {
      setBusy(false);
    }
  };
  const leader = world.countries[target].name;
  return (
    <Section title="Leader hotline">
      <p class="muted">{official ? `Speak directly to the government of ${leader}. How the call goes shifts their opinion of you (once per turn).` : `Talk to ${leader}'s leadership. Your words carry no official weight until you hold national authority.`}</p>
      <div class="hotline-log">
        {log.map((m) =>
          m.role === 'user' ? (
            <div class="msg user">{m.content}</div>
          ) : (
            <div class={`msg assistant mood${m.mood}`}>
              <b>{leader}:</b> {m.reply}
              {m.effect && <small>{m.effect}</small>}
            </div>
          ),
        )}
        {busy && <div class="msg assistant live">The line is ringing…</div>}
      </div>
      {err && <p class="bad">{err}</p>}
      <div class="staff-input">
        <input id="hotline-input" placeholder={`Message to ${leader}…`} value={text} maxLength={400} onInput={(e) => setText(e.target.value)} onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') send();
        }} />
        <Btn kind="primary" disabled={busy || !text.trim()} onClick={send}>
          Call
        </Btn>
      </div>
    </Section>
  );
}

export function NewsSection({ v, world }) {
  const ai = useStore((s) => s.ai);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!ai) return null;
  const go = async () => {
    const sample = await getSample();
    if (!sample) return;
    setBusy(true);
    setText('');
    try {
      await sample(newsBrief(world, v), { modelTier: 'quick', onText: ({ text: t }) => setText(t) });
    } catch (e) {
      const m = aiError(e);
      if (m) toast({ kind: 'error', title: 'WNN is off the air', text: m });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="WNN · World News Network">
      {text ? <div class="wnn">{text}</div> : <p class="muted">Tonight's bulletin, written live from this turn's wars, battles and events.</p>}
      <Btn onClick={go} disabled={busy}>
        {busy ? 'On air…' : text ? 'Refresh bulletin' : 'Run tonight’s bulletin'}
      </Btn>
    </Section>
  );
}

// Probe once at startup; the Staff tab and AI sections appear only when Claude is reachable.
export async function probeAI(store) {
  const s = await getSample();
  if (s) store.set({ ai: true });
}
