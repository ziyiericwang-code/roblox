// Procedural SVG rank insignia and medal ribbons.
import { rankOf } from '../../shared/config/ranks.js';
import { MEDAL_BY_ID } from '../../shared/config/medals.js';

const GOLD = '#d6b25e';
const SILVER = '#d7dde2';

function chevrons(n, rockers, center) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const y = 8 + i * 9;
    out += `<path d="M6 ${y + 10} L32 ${y} L58 ${y + 10} L58 ${y + 16} L32 ${y + 6} L6 ${y + 16} Z" fill="${GOLD}"/>`;
  }
  for (let i = 0; i < rockers; i++) {
    const y = 36 + i * 8;
    out += `<path d="M6 ${y} Q32 ${y + 14} 58 ${y} L58 ${y + 5} Q32 ${y + 19} 6 ${y + 5} Z" fill="${GOLD}"/>`;
  }
  if (center === 'diamond') out += `<path d="M32 30 L37 36 L32 42 L27 36 Z" fill="${GOLD}"/>`;
  if (center === 'star') out += star(32, 36, 6, GOLD);
  return out;
}

function star(cx, cy, r, color) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)} `;
  }
  return `<path d="${d}Z" fill="${color}"/>`;
}

export function insigniaSVG(rankIndex, size = 40) {
  const ins = rankOf(rankIndex).insignia;
  let body = '';
  switch (ins.type) {
    case 'chevron':
      body = chevrons(ins.n, ins.rockers || 0, ins.center);
      break;
    case 'shield':
      body = `<path d="M14 14 Q32 6 50 14 L50 34 Q32 54 14 34 Z" fill="${GOLD}"/><path d="M26 22 L32 20 L38 22 L38 30 Q32 38 26 30 Z" fill="#2a2a2a"/>`;
      break;
    case 'bar': {
      const c = ins.color === 'gold' ? GOLD : SILVER;
      if (ins.n === 1) body = `<rect x="24" y="10" width="16" height="44" rx="2" fill="${c}"/>`;
      else body = `<rect x="14" y="10" width="14" height="44" rx="2" fill="${c}"/><rect x="36" y="10" width="14" height="44" rx="2" fill="${c}"/>`;
      break;
    }
    case 'leaf': {
      const c = ins.color === 'gold' ? GOLD : SILVER;
      body = `<path d="M32 6 Q52 20 46 40 Q40 52 32 58 Q24 52 18 40 Q12 20 32 6 Z" fill="${c}"/><path d="M32 12 L32 56" stroke="#555" stroke-width="1.5"/>`;
      break;
    }
    case 'eagle':
      body = `<path d="M32 12 L36 22 L56 16 L44 30 L50 32 L38 36 L36 50 L32 44 L28 50 L26 36 L14 32 L20 30 L8 16 L28 22 Z" fill="${SILVER}"/>`;
      break;
    case 'star': {
      const n = ins.n;
      const pos = n === 1 ? [[32, 32]] : n === 2 ? [[20, 32], [44, 32]] : n === 3 ? [[14, 32], [32, 32], [50, 32]] : [[20, 20], [44, 20], [20, 44], [44, 44]];
      body = pos.map(([x, y]) => star(x, y, n >= 3 ? 10 : 13, SILVER)).join('');
      break;
    }
    default:
      body = `<circle cx="32" cy="32" r="6" fill="#777"/>`;
  }
  return `<svg class="insignia" width="${size}" height="${size}" viewBox="0 0 64 64" aria-label="${rankOf(rankIndex).name}">${body}</svg>`;
}

export function ribbonSVG(medalId, tier = 0, w = 56, hgt = 18) {
  const m = MEDAL_BY_ID[medalId];
  if (!m) return '';
  const [a, b, c] = m.ribbon;
  const tierMark = tier <= 0 ? '' : tier === 1 ? star(w / 2, hgt / 2, 5, '#dfe5ea') : star(w / 2, hgt / 2, 5, '#e2c26a') + star(w / 2 - 12, hgt / 2, 4, '#e2c26a') + star(w / 2 + 12, hgt / 2, 4, '#e2c26a');
  return `<svg class="ribbon" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}"><rect width="${w}" height="${hgt}" fill="${a}"/><rect x="${w * 0.22}" width="${w * 0.56}" height="${hgt}" fill="${b}"/><rect x="${w * 0.42}" width="${w * 0.16}" height="${hgt}" fill="${c}"/>${tierMark}<rect width="${w}" height="${hgt}" fill="none" stroke="rgba(0,0,0,.4)"/></svg>`;
}
