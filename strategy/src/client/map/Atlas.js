// Procedural sprite atlas for map markers. Channels: R = tintable fill, G = white detail,
// B = dark detail, A = coverage (see MARKER_FS).
export const CELL = 64;
const COLS = 8;
export const ICONS = ['inf', 'armor', 'mech', 'art', 'ad', 'sf', 'mot', 'unknown', 'est', 'battle', 'ring', 'badge', 'airbase', 'port', 'fort', 'hub', 'factory', 'star', 'flag', 'pocket', 'radar', 'depot', 'command', 'ship', 'plane'];
export const ICON = Object.fromEntries(ICONS.map((n, i) => [n, i]));

export function uvOf(i) {
  const x = (i % COLS) * CELL;
  const y = Math.floor(i / COLS) * CELL;
  const S = COLS * CELL;
  return [(x + 0.5) / S, (y + 0.5) / S, (x + CELL - 0.5) / S, (y + CELL - 0.5) / S];
}

export function buildAtlas() {
  const S = COLS * CELL;
  const layers = ['fill', 'white', 'dark'].map(() => {
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return { c, ctx };
  });
  const [F, Wt, D] = layers.map((l) => l.ctx);
  ICONS.forEach((name, i) => {
    const ox = (i % COLS) * CELL;
    const oy = Math.floor(i / COLS) * CELL;
    for (const ctx of [F, Wt, D]) {
      ctx.save();
      ctx.translate(ox, oy);
    }
    draw(name, F, Wt, D);
    for (const ctx of [F, Wt, D]) ctx.restore();
  });
  // merge channels
  const out = document.createElement('canvas');
  out.width = S;
  out.height = S;
  const octx = out.getContext('2d');
  const img = octx.createImageData(S, S);
  const [fd, wd, dd] = layers.map((l) => l.ctx.getImageData(0, 0, S, S).data);
  for (let k = 0; k < S * S * 4; k += 4) {
    const b = dd[k + 3] / 255;
    const g = (wd[k + 3] / 255) * (1 - b);
    const r = (fd[k + 3] / 255) * (1 - b) * (1 - wd[k + 3] / 255);
    img.data[k] = r * 255;
    img.data[k + 1] = g * 255;
    img.data[k + 2] = b * 255;
    img.data[k + 3] = Math.max(fd[k + 3], wd[k + 3], dd[k + 3]);
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function counter(F, D, dashed) {
  rr(F, 5, 13, 54, 38, 6);
  if (dashed) {
    F.globalAlpha = 0.35;
    F.fill();
    F.globalAlpha = 1;
    D.lineWidth = 3;
    D.setLineDash([6, 4]);
    rr(D, 5, 13, 54, 38, 6);
    D.stroke();
    D.setLineDash([]);
  } else {
    F.fill();
    D.lineWidth = 3;
    rr(D, 5, 13, 54, 38, 6);
    D.stroke();
  }
}

function draw(name, F, W, D) {
  const box = () => {
    D.lineWidth = 2.6;
    D.strokeRect(14, 20, 36, 24);
  };
  const x = () => {
    D.beginPath();
    D.moveTo(14, 20);
    D.lineTo(50, 44);
    D.moveTo(50, 20);
    D.lineTo(14, 44);
    D.stroke();
  };
  const ellipse = () => {
    D.beginPath();
    D.ellipse(32, 32, 12, 7, 0, 0, Math.PI * 2);
    D.stroke();
  };
  switch (name) {
    case 'inf':
      counter(F, D);
      box();
      x();
      break;
    case 'armor':
      counter(F, D);
      box();
      ellipse();
      break;
    case 'mech':
      counter(F, D);
      box();
      x();
      ellipse();
      break;
    case 'art':
      counter(F, D);
      box();
      D.beginPath();
      D.arc(32, 32, 5, 0, Math.PI * 2);
      D.fill();
      break;
    case 'ad':
      counter(F, D);
      box();
      D.beginPath();
      D.arc(32, 44, 13, Math.PI, 0);
      D.stroke();
      break;
    case 'sf':
      counter(F, D);
      box();
      D.font = '700 15px Inter, sans-serif';
      D.textAlign = 'center';
      D.textBaseline = 'middle';
      D.fillText('SF', 32, 33);
      break;
    case 'mot':
      counter(F, D);
      box();
      x();
      D.beginPath();
      D.moveTo(32, 20);
      D.lineTo(32, 44);
      D.stroke();
      break;
    case 'unknown':
      counter(F, D, true);
      D.font = '800 22px Inter, sans-serif';
      D.textAlign = 'center';
      D.textBaseline = 'middle';
      D.fillText('?', 32, 33);
      break;
    case 'est':
      counter(F, D, true);
      box();
      break;
    case 'battle': {
      F.beginPath();
      F.arc(32, 32, 22, 0, Math.PI * 2);
      F.fill();
      D.lineWidth = 3;
      D.beginPath();
      D.arc(32, 32, 22, 0, Math.PI * 2);
      D.stroke();
      W.lineWidth = 5;
      W.beginPath();
      W.moveTo(19, 19);
      W.lineTo(45, 45);
      W.moveTo(45, 19);
      W.lineTo(19, 45);
      W.stroke();
      W.lineWidth = 3;
      W.beginPath();
      W.moveTo(15, 27);
      W.lineTo(27, 15);
      W.moveTo(37, 15);
      W.lineTo(49, 27);
      W.stroke();
      break;
    }
    case 'ring':
      F.lineWidth = 5;
      rr(F, 2, 10, 60, 44, 9);
      F.stroke();
      break;
    case 'badge':
      F.beginPath();
      F.arc(32, 32, 26, 0, Math.PI * 2);
      F.fill();
      D.lineWidth = 3;
      D.stroke();
      break;
    case 'pocket':
      F.lineWidth = 5;
      F.setLineDash([7, 6]);
      F.beginPath();
      F.arc(32, 32, 28, 0, Math.PI * 2);
      F.stroke();
      F.setLineDash([]);
      break;
    case 'airbase':
      iconBg(F, D);
      W.beginPath();
      W.moveTo(32, 14);
      W.lineTo(36, 30);
      W.lineTo(52, 36);
      W.lineTo(36, 38);
      W.lineTo(34, 48);
      W.lineTo(40, 52);
      W.lineTo(24, 52);
      W.lineTo(30, 48);
      W.lineTo(28, 38);
      W.lineTo(12, 36);
      W.lineTo(28, 30);
      W.closePath();
      W.fill();
      break;
    case 'port':
      iconBg(F, D);
      W.lineWidth = 4;
      W.beginPath();
      W.arc(32, 20, 5, 0, Math.PI * 2);
      W.moveTo(32, 25);
      W.lineTo(32, 50);
      W.moveTo(20, 32);
      W.lineTo(44, 32);
      W.moveTo(16, 40);
      W.quadraticCurveTo(20, 52, 32, 50);
      W.quadraticCurveTo(44, 52, 48, 40);
      W.stroke();
      break;
    case 'fort':
      iconBg(F, D);
      W.beginPath();
      W.moveTo(16, 48);
      W.lineTo(16, 24);
      W.lineTo(22, 24);
      W.lineTo(22, 30);
      W.lineTo(29, 30);
      W.lineTo(29, 24);
      W.lineTo(35, 24);
      W.lineTo(35, 30);
      W.lineTo(42, 30);
      W.lineTo(42, 24);
      W.lineTo(48, 24);
      W.lineTo(48, 48);
      W.closePath();
      W.fill();
      break;
    case 'hub':
    case 'depot':
      iconBg(F, D);
      W.fillRect(18, 22, 28, 22);
      D.lineWidth = 2;
      D.beginPath();
      D.moveTo(18, 30);
      D.lineTo(46, 30);
      D.moveTo(32, 22);
      D.lineTo(32, 44);
      D.stroke();
      break;
    case 'factory':
      iconBg(F, D);
      W.beginPath();
      W.moveTo(14, 48);
      W.lineTo(14, 30);
      W.lineTo(24, 36);
      W.lineTo(24, 30);
      W.lineTo(34, 36);
      W.lineTo(34, 18);
      W.lineTo(42, 18);
      W.lineTo(42, 30);
      W.lineTo(50, 30);
      W.lineTo(50, 48);
      W.closePath();
      W.fill();
      break;
    case 'star':
      F.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const r = k % 2 ? 11 : 26;
        F.lineTo(32 + Math.cos(a) * r, 34 + Math.sin(a) * r);
      }
      F.closePath();
      F.fill();
      D.lineWidth = 3;
      D.stroke();
      break;
    case 'flag':
      D.lineWidth = 4;
      D.beginPath();
      D.moveTo(18, 56);
      D.lineTo(18, 8);
      D.stroke();
      F.beginPath();
      F.moveTo(20, 10);
      F.lineTo(52, 18);
      F.lineTo(20, 28);
      F.closePath();
      F.fill();
      break;
    case 'radar':
      iconBg(F, D);
      W.lineWidth = 3.5;
      W.beginPath();
      W.arc(32, 40, 16, Math.PI * 1.15, Math.PI * 1.85);
      W.moveTo(32, 40);
      W.lineTo(42, 24);
      W.stroke();
      break;
    case 'command':
      iconBg(F, D);
      W.font = '800 22px Inter, sans-serif';
      W.textAlign = 'center';
      W.textBaseline = 'middle';
      W.fillText('HQ', 32, 33);
      break;
    case 'ship':
      F.beginPath();
      F.moveTo(8, 34);
      F.lineTo(56, 34);
      F.lineTo(48, 46);
      F.lineTo(16, 46);
      F.closePath();
      F.fill();
      F.fillRect(24, 24, 16, 10);
      D.lineWidth = 2.5;
      D.strokeRect(24, 24, 16, 10);
      break;
    case 'plane':
      F.beginPath();
      F.moveTo(32, 8);
      F.lineTo(36, 26);
      F.lineTo(56, 34);
      F.lineTo(36, 36);
      F.lineTo(34, 50);
      F.lineTo(42, 56);
      F.lineTo(22, 56);
      F.lineTo(30, 50);
      F.lineTo(28, 36);
      F.lineTo(8, 34);
      F.lineTo(28, 26);
      F.closePath();
      F.fill();
      break;
    default:
      break;
  }
}

function iconBg(F, D) {
  F.beginPath();
  F.arc(32, 32, 26, 0, Math.PI * 2);
  F.fill();
  D.lineWidth = 3;
  D.beginPath();
  D.arc(32, 32, 26, 0, Math.PI * 2);
  D.stroke();
}
