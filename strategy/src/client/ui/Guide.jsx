// Field manual: a short card-by-card tutorial covering every system. Opens once on the
// first game, and any time from the title screen or the menu.
import { useEffect, useState } from 'preact/hooks';
import { store } from '../state/store.js';
import { Btn } from './common.jsx';

const CARDS = [
  {
    tag: '01 · The map',
    title: 'The whole world is the board',
    body: '1,222 real provinces and 192 sea zones. Scroll to zoom from the globe down to a single province; drag or use the arrow keys to pan. Numbers 1–9 switch map modes: political, terrain, supply, fronts, intel and more.',
    keys: [['Scroll', 'zoom'], ['Drag · arrows', 'pan'], ['1–9', 'map modes'], ['Home', 'your HQ']],
  },
  {
    tag: '02 · Command',
    title: 'Select your forces, give orders',
    body: 'Your formations wear a gold ring. Click one to select it (Tab cycles through them). Right-click a province, or drag the counter onto it, to move there. Moving into enemy land attacks it: hover first to see the route and the battle forecast with odds.',
    keys: [['Click', 'select'], ['Right-click · drag', 'move / attack'], ['H / D / W', 'hold · dig in · withdraw'], ['S / M', 'split · merge']],
  },
  {
    tag: '03 · Turns',
    title: 'Plan, then end the turn',
    body: 'Everyone plans at the same time. Press End Turn (Enter) and the week plays out: four movement impulses, battles round by round, supply, economy, diplomacy and world events. Battle reports explain exactly why a fight was won or lost.',
    keys: [['Enter', 'end turn'], ['Reports tab', 'battle reports']],
  },
  {
    tag: '04 · War',
    title: 'Terrain, supply and fronts decide wars',
    body: 'Defenders dug into mountains, forests and cities are brutal to crack; rivers and straits weaken attackers. Units cut off from supply wither, so watch for encirclements. Fronts form automatically along every hostile border.',
    keys: [['Supply mode', 'see who is cut off'], ['Fronts tab', 'status of each front']],
  },
  {
    tag: '05 · Career',
    title: 'Climb 52 ranks',
    body: 'Start as anything from a Recruit with one detachment to the Supreme Commander of a nation. Complete directives and win battles to earn merit and promotions. Each rank unlocks more formations, orders per turn, a bigger operational area and new tabs.',
    keys: [['Career tab', 'your path'], ['Directives', 'top-left card']],
  },
  {
    tag: '06 · Claude',
    title: 'Real AI on your staff',
    body: 'Staff tab: your Chief of Staff (Claude) reads the battlefield, answers questions and gives orders when you tell it to. Diplomacy: call any leader on the hotline, played in character. World: the Crisis Director invents crises with hard choices, and WNN writes the nightly news.',
    keys: [['✶ Staff', 'Chief of Staff'], ['✉ Diplomacy', 'leader hotline'], ['🌐 World', 'crises · WNN']],
    note: 'Claude runs on your own Claude account and asks permission first.',
  },
  {
    tag: '07 · Strategic weapons',
    title: 'Missiles, and the unthinkable',
    body: 'From rank 33, the ☢ Strategic tab fires theatre missiles that shatter enemy formations (3 Command Points). Heads of state of the nine nuclear powers can release nuclear weapons with the turn’s authentication code. The world will turn on you, fallout lingers, and nuclear states answer in kind.',
    keys: [['☢ Strategic', 'missiles · deterrent'], ['DEFCON', 'world tension']],
  },
  {
    tag: '08 · Together',
    title: 'Join friends with a code',
    body: 'Multiplayer on the title screen: create a campaign and share its 6-character code. Friends pick their own nations, or serve inside your empire. Ally, grant each other control of specific armies, plan joint operations, or betray each other.',
    keys: [['Multiplayer', 'create · join'], ['👥 Players', 'chat · permissions']],
    note: 'In the artifact, friends need access to it (share it with Contributor access); the host keeps the tab open.',
  },
];

const SEEN = 'gc.guideSeen';
export function guideSeen() {
  try {
    return !!localStorage.getItem(SEEN);
  } catch {
    return true;
  }
}
function markSeen() {
  try {
    localStorage.setItem(SEEN, '1');
  } catch {
    /* storage blocked */
  }
}

export function Guide({ close, start = 0 }) {
  const [i, setI] = useState(start);
  const c = CARDS[i];
  const last = i === CARDS.length - 1;
  const done = () => {
    markSeen();
    close();
  };
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'ArrowRight') setI((x) => Math.min(CARDS.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      e.stopPropagation();
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, []);
  return (
    <div class="guide">
      <div class="guide-top">
        <span>FIELD MANUAL</span>
        <button class="guide-skip" onClick={done}>
          Skip
        </button>
      </div>
      <small class="guide-tag">{c.tag}</small>
      <h2>{c.title}</h2>
      <p>{c.body}</p>
      <dl class="guide-keys">
        {c.keys.map(([k, v]) => (
          <div>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {c.note && <p class="guide-note">{c.note}</p>}
      <div class="guide-nav">
        <div class="guide-dots" aria-label={`Card ${i + 1} of ${CARDS.length}`}>
          {CARDS.map((_, j) => (
            <button class={j === i ? 'on' : ''} onClick={() => setI(j)} aria-label={`Card ${j + 1}`} />
          ))}
        </div>
        <Btn kind="ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
          Back
        </Btn>
        <Btn kind="primary" onClick={() => (last ? done() : setI(i + 1))}>
          {last ? 'Take command' : 'Next'}
        </Btn>
      </div>
    </div>
  );
}

export function openGuide() {
  store.set({ modal: { kind: 'guide' } });
}
