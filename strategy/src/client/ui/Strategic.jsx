// Strategic Command: missile strikes, the nuclear arsenal with two-person-rule style
// authentication, fallout, and the Emergency Action Message overlay.
import { useEffect, useState } from 'preact/hooks';
import { store, useStore, toast } from '../state/store.js';
import { Btn, Section, Row, ConfirmBtn } from './common.jsx';

const cn = (world, c) => world.countries[c]?.name || '?';

export function StrategicPanel({ v, world }) {
  const me = v.me;
  const recent = v.strikes.slice().reverse();
  return (
    <>
      <Section title="Theatre missiles">
        {me.missiles ? (
          <>
            <Row k="Allocation this turn" v={`${me.missiles.max - me.missiles.used} of ${me.missiles.max}`} />
            <p class="muted">Precision strikes shatter the organization of enemy formations and wreck forts. 3 Command Points each; they land as the turn resolves. Missile defence may intercept.</p>
            <Btn kind="primary" disabled={me.missiles.used >= me.missiles.max || me.cp < 3} onClick={() => store.set({ tool: 'missile', toolProvs: [], panel: null })}>
              Pick a target
            </Btn>
          </>
        ) : (
          <p class="muted">Theatre missiles unlock at the rank of Colonel-level command (rank 33).</p>
        )}
      </Section>
      <Section title="Strategic deterrent">
        {me.nukes > 0 ? (
          <div class="deterrent">
            <div class="warheads">
              <b>{me.nukes}</b>
              <small>strategic weapons ready</small>
            </div>
            {me.launchCode ? (
              <>
                <p class="warn">Release requires a state of war with the target and today's authentication code. The world will not forgive it, and nuclear states answer in kind.</p>
                <Btn kind="danger" onClick={() => store.set({ tool: 'nuke', toolProvs: [], panel: null })}>
                  Designate nuclear target
                </Btn>
              </>
            ) : (
              <p class="muted">Only the national command authority can release them.</p>
            )}
          </div>
        ) : (
          <p class="muted">{cn(world, me.country)} has no strategic weapons. Nuclear powers: {v.nuclearPowers.map((c) => cn(world, c)).join(', ')}.</p>
        )}
      </Section>
      {v.fallout.length > 0 && (
        <Section title={`Fallout zones (${v.fallout.length})`}>
          <p class="muted">Formations inside lose strength every turn; stability collapses.</p>
          {v.fallout.slice(0, 12).map((p) => (
            <div class="frow">{world.provinces.name[p]} · {cn(world, world.provinces.country[p])}</div>
          ))}
        </Section>
      )}
      <Section title="Strike log">
        {!recent.length && <p class="muted">No strikes this turn.</p>}
        {recent.map((x) => (
          <div class={`frow strike-${x.kind}`}>
            <b>{x.kind === 'nuke' ? '☢ NUCLEAR' : '➹ Missile'}</b> {cn(world, x.from)} → {world.provinces.name[x.target]}
            <small>{x.intercepted ? 'intercepted' : 'impact'}</small>
          </div>
        ))}
      </Section>
    </>
  );
}

export function LaunchModal({ modal, v, world, ctl, close }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const target = modal.prov;
  const holder = v.prov.ctrl[target];
  const go = async () => {
    const res = await ctl.command({ type: 'nuke', prov: target, code }, { quiet: true });
    if (!res.ok) {
      setErr(res.reason);
      return;
    }
    close();
    toast({ kind: 'event', title: 'LAUNCH CONFIRMED', text: `${world.provinces.name[target]} · impact as the turn resolves. ${res.left} weapons remain.`, important: true, huge: true });
    const home = v.countries[v.me.country].capital;
    if (ctl.strike) ctl.strike.launch(home, target, { color: [255, 255, 235], nuke: true });
  };
  return (
    <div class="launch">
      <div class="launch-head">EMERGENCY ACTION · NUCLEAR RELEASE</div>
      <h2>{world.provinces.name[target]}</h2>
      <p class="muted">
        Held by {cn(world, holder)}. Everything in the province is destroyed; neighbours take heavy losses. Fallout lingers for 8 turns.
      </p>
      <div class="auth">
        <small>Authentication for this turn</small>
        <b>{v.me.launchCode}</b>
      </div>
      <label for="launch-code">Enter the code to arm</label>
      <input id="launch-code" class="code-input" value={code} maxLength={7} autoFocus onInput={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.stopPropagation()} />
      {err && <p class="bad">{err}</p>}
      <div class="row-btns">
        <Btn kind="ghost" onClick={close}>Abort</Btn>
        <ConfirmBtn kind="danger" confirmText="CONFIRM RELEASE" onConfirm={go}>
          Release
        </ConfirmBtn>
      </div>
    </div>
  );
}

// Full-screen alert when a nuclear weapon detonates anywhere in the world.
export function EmergencyBroadcast() {
  const ebs = useStore((s) => s.ebs);
  useEffect(() => {
    if (!ebs) return undefined;
    const t = setTimeout(() => store.set({ ebs: null }), 6500);
    return () => clearTimeout(t);
  }, [ebs]);
  if (!ebs) return null;
  return (
    <div class="ebs" onClick={() => store.set({ ebs: null })} role="alert">
      <div class="ebs-flash" />
      <div class="ebs-card">
        <div class="ebs-top">EMERGENCY ACTION MESSAGE</div>
        {ebs.items.map((x) => (
          <div class="ebs-line">
            <b>{x.intercepted ? 'NUCLEAR MISSILE INTERCEPTED' : 'NUCLEAR DETONATION'}</b>
            <span>{x.place}</span>
            <small>Launched by {x.by}</small>
          </div>
        ))}
        <div class="ebs-foot">DEFCON 1 · Click to dismiss</div>
      </div>
    </div>
  );
}
