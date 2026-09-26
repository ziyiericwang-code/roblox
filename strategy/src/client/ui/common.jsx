// Shared UI pieces.
import { RANKS } from '../../../config/ranks.js';

export const fmt = (n, d = 0) => {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(0)}k`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toFixed(d);
};

export function Bar({ value, max = 1, color = 'var(--ok)', h = 5, title }) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <div class="bar" style={{ height: `${h}px` }} title={title}>
      <div style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function Chip({ color, children, title, onClick }) {
  return (
    <span class={`chip${onClick ? ' click' : ''}`} title={title} onClick={onClick}>
      <i style={{ background: color }} />
      {children}
    </span>
  );
}

export function Btn({ children, onClick, disabled, lock, kind = '', title, hot }) {
  return (
    <button class={`btn ${kind}${lock ? ' locked' : ''}`} onClick={disabled || lock ? undefined : onClick} disabled={disabled} title={lock ? `🔒 ${lock}` : title}>
      {children}
      {hot && <kbd>{hot}</kbd>}
    </button>
  );
}

export function Section({ title, children, right }) {
  return (
    <section class="sec">
      <header>
        <h4>{title}</h4>
        {right}
      </header>
      {children}
    </section>
  );
}

export function Row({ k, v, sub }) {
  return (
    <div class="kv">
      <span>{k}</span>
      <b>{v}</b>
      {sub && <em>{sub}</em>}
    </div>
  );
}

// Unit insignia drawn procedurally by career tier and step.
export function Insignia({ rank, size = 28 }) {
  const r = RANKS[rank];
  const tier = r.tier;
  const gold = '#e3b453';
  const silver = '#cfd6de';
  const s = size;
  const parts = [];
  if (tier === 'Enlisted' || tier === 'NCO') {
    const chevrons = tier === 'Enlisted' ? Math.min(3, Math.max(0, rank - 0)) : 3;
    const rockers = tier === 'NCO' ? Math.min(3, rank - 7) : 0;
    if (rank === 0) parts.push(<circle cx="16" cy="16" r="5" fill="none" stroke={silver} stroke-width="2" />);
    for (let i = 0; i < chevrons; i++) parts.push(<path d={`M6 ${10 + i * 5} L16 ${4 + i * 5} L26 ${10 + i * 5}`} fill="none" stroke={gold} stroke-width="2.6" />);
    for (let i = 0; i < rockers; i++) parts.push(<path d={`M6 ${22 + i * 3.5} Q16 ${28 + i * 3.5} 26 ${22 + i * 3.5}`} fill="none" stroke={gold} stroke-width="2.2" />);
    if (tier === 'Enlisted' && rank >= 4) parts.push(<rect x="12" y="23" width="8" height="3" fill={silver} />);
  } else if (tier === 'Warrant') {
    const n = rank - 13;
    parts.push(<rect x="8" y="8" width="16" height="16" rx="2" fill="none" stroke={silver} stroke-width="2" />);
    for (let i = 0; i < n; i++) parts.push(<rect x={9.5 + i * 3.2} y="10" width="1.8" height="12" fill={gold} />);
  } else if (tier === 'Officer') {
    const n = rank - 18;
    for (let i = 0; i < Math.min(3, n); i++) parts.push(<rect x={6 + i * 7.5} y="8" width="5" height="16" rx="1" fill={i === 0 && n === 1 ? gold : silver} />);
  } else if (tier === 'Field') {
    const eagle = rank >= 29;
    if (eagle) parts.push(<path d="M4 14 L16 8 L28 14 L22 16 L16 26 L10 16 Z" fill={rank >= 31 ? gold : silver} />);
    else parts.push(<path d="M16 4 C8 10 8 20 16 28 C24 20 24 10 16 4 Z" fill={rank >= 27 ? silver : gold} />);
  } else {
    const stars = tier === 'General' ? (rank <= 32 ? 1 : rank <= 34 ? 2 : 3) : tier === 'Senior' ? 4 : 5;
    const R = stars > 3 ? 3.4 : 4.4;
    for (let i = 0; i < stars; i++) {
      const cx = stars === 1 ? 16 : 5 + (22 * i) / (stars - 1);
      const pts = [];
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const rr = k % 2 ? R * 0.45 : R;
        pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(16 + Math.sin(a) * rr).toFixed(1)}`);
      }
      parts.push(<polygon points={pts.join(' ')} fill={tier === 'Coalition' ? '#9fd3ff' : gold} />);
    }
    if (tier === 'National' || tier === 'Coalition') parts.push(<path d="M4 24 Q16 31 28 24" fill="none" stroke={gold} stroke-width="1.6" />);
  }
  return (
    <svg class="insignia" width={s} height={s} viewBox="0 0 32 32">
      {parts}
    </svg>
  );
}

export const kindIcon = {
  war: '⚔',
  peace: '☮',
  battle: '✦',
  capture: '⚑',
  promotion: '★',
  career: '◆',
  directive: '◎',
  'directive-done': '✔',
  'directive-failed': '✖',
  event: '◉',
  intel: '👁',
  diplomacy: '✉',
  proposal: '✉',
  build: '▣',
  operation: '➤',
  empire: '♛',
  loss: '✖',
  permission: '🔑',
  error: '!',
};
