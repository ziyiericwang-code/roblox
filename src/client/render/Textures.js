// Procedural textures generated on canvases at startup (no external assets).
// Structure textures are packed into one atlas so every building chunk can be
// drawn with a single material (see StructureMesh for the atlas shader).
import * as THREE from 'three';
import { mulberry32 } from '../../shared/math.js';

export const ATLAS_GRID = 8; // 8x8 tiles
export const TILE_PX = 128;
export const ATLAS_PAD = 0.04;

// pattern name -> tile index
export const PATTERNS = [
  'flat', 'concrete', 'brick', 'planks', 'corrugated', 'sandbag', 'tiles', 'asphalt',
  'panel', 'windows', 'glass', 'crate', 'container', 'rock', 'canvas', 'net',
  'hazard', 'rust', 'gravel', 'target', 'hesco', 'stone', 'redcross', 'leaves', 'bark',
];
export const PATTERN_INDEX = Object.fromEntries(PATTERNS.map((p, i) => [p, i]));

function noiseCanvas(ctx, w, h, rand, scale, alpha, dark = 0, light = 255) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  // value noise at a coarse grid, bilinear upsampled
  const gw = Math.max(2, Math.floor(w / scale));
  const gh = Math.max(2, Math.floor(h / scale));
  const grid = new Float32Array((gw + 1) * (gh + 1)).map(() => rand());
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * gw;
      const fy = (y / h) * gh;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const g = (a, b) => grid[(b % (gh + 1)) * (gw + 1) + (a % (gw + 1))];
      const v = (g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx) * (1 - ty) + (g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx) * ty;
      const c = dark + (light - dark) * v;
      const i = (y * w + x) * 4;
      d[i] = d[i] * (1 - alpha) + c * alpha;
      d[i + 1] = d[i + 1] * (1 - alpha) + c * alpha;
      d[i + 2] = d[i + 2] * (1 - alpha) + c * alpha;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function speckle(ctx, w, h, rand, n, size, lo, hi) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(lo + rand() * (hi - lo));
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(rand() * w, rand() * h, size * (0.5 + rand()), size * (0.5 + rand()));
  }
}

function drawPattern(name, ctx, S, rand) {
  const fill = (v) => {
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, 0, S, S);
  };
  switch (name) {
    case 'flat':
      fill(235);
      noiseCanvas(ctx, S, S, rand, 16, 0.08);
      break;
    case 'concrete':
      fill(215);
      noiseCanvas(ctx, S, S, rand, 32, 0.25, 150, 255);
      noiseCanvas(ctx, S, S, rand, 4, 0.12, 120, 255);
      speckle(ctx, S, S, rand, 200, 1.2, 140, 200);
      ctx.strokeStyle = 'rgba(90,90,90,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, S * 0.5);
      ctx.lineTo(S, S * 0.5);
      ctx.moveTo(S * 0.5, 0);
      ctx.lineTo(S * 0.5, S);
      ctx.stroke();
      break;
    case 'brick': {
      fill(200);
      const rows = 8;
      const bh = S / rows;
      for (let r = 0; r < rows; r++) {
        const off = r % 2 ? S / 8 : 0;
        for (let c = -1; c < 4; c++) {
          const v = 170 + rand() * 70;
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(c * (S / 4) + off + 2, r * bh + 2, S / 4 - 4, bh - 4);
        }
      }
      noiseCanvas(ctx, S, S, rand, 6, 0.15);
      break;
    }
    case 'planks': {
      fill(200);
      const n = 6;
      for (let i = 0; i < n; i++) {
        const v = 160 + rand() * 80;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(0, (i * S) / n + 1, S, S / n - 2);
        ctx.strokeStyle = 'rgba(80,80,80,0.25)';
        for (let k = 0; k < 5; k++) {
          ctx.beginPath();
          const y = (i * S) / n + rand() * (S / n);
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(S * 0.3, y + rand() * 3, S * 0.6, y - rand() * 3, S, y);
          ctx.stroke();
        }
      }
      break;
    }
    case 'corrugated':
    case 'container': {
      const ribs = name === 'container' ? 10 : 16;
      for (let x = 0; x < S; x++) {
        const v = 170 + 60 * Math.sin((x / S) * ribs * Math.PI * 2);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, 0, 1, S);
      }
      noiseCanvas(ctx, S, S, rand, 24, 0.2, 120, 255);
      if (name === 'container') {
        ctx.fillStyle = 'rgba(40,40,40,0.5)';
        ctx.fillRect(0, 0, S, 4);
        ctx.fillRect(0, S - 4, S, 4);
      }
      break;
    }
    case 'sandbag': {
      fill(170);
      const rows = 4;
      for (let r = 0; r < rows; r++) {
        const off = r % 2 ? S / 6 : 0;
        for (let c = -1; c < 4; c++) {
          const x = c * (S / 3) + off;
          const y = r * (S / rows);
          const grd = ctx.createRadialGradient(x + S / 6, y + S / 8, 2, x + S / 6, y + S / 8, S / 5);
          grd.addColorStop(0, 'rgb(240,240,240)');
          grd.addColorStop(1, 'rgb(150,150,150)');
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.ellipse(x + S / 6, y + S / 8, S / 6 - 2, S / 8 - 2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      noiseCanvas(ctx, S, S, rand, 3, 0.15);
      break;
    }
    case 'tiles': {
      fill(190);
      const rows = 8;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < 8; c++) {
          const v = 160 + rand() * 80;
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          const off = r % 2 ? S / 16 : 0;
          ctx.fillRect(c * (S / 8) + off, r * (S / rows), S / 8 - 2, S / rows - 3);
        }
      }
      break;
    }
    case 'asphalt':
      fill(200);
      noiseCanvas(ctx, S, S, rand, 2, 0.35, 120, 255);
      noiseCanvas(ctx, S, S, rand, 32, 0.2, 150, 255);
      break;
    case 'panel':
      fill(210);
      noiseCanvas(ctx, S, S, rand, 32, 0.2, 150, 255);
      ctx.strokeStyle = 'rgba(60,60,60,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, S / 2 - 2, S - 2);
      ctx.strokeRect(S / 2 + 1, 1, S / 2 - 2, S - 2);
      ctx.fillStyle = 'rgba(60,60,60,0.6)';
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(6, (i * S) / 6 + 6, 3, 3);
        ctx.fillRect(S - 9, (i * S) / 6 + 6, 3, 3);
      }
      break;
    case 'windows': {
      // one cell = 3.4 m wide x 3.2 m tall storey with a window
      fill(225);
      noiseCanvas(ctx, S, S, rand, 16, 0.18, 170, 255);
      const g = ctx.createLinearGradient(0, S * 0.25, 0, S * 0.7);
      g.addColorStop(0, 'rgb(40,48,58)');
      g.addColorStop(1, 'rgb(70,82,92)');
      ctx.fillStyle = 'rgb(120,120,120)';
      ctx.fillRect(S * 0.24, S * 0.22, S * 0.52, S * 0.5);
      ctx.fillStyle = g;
      ctx.fillRect(S * 0.27, S * 0.25, S * 0.46, S * 0.44);
      ctx.fillStyle = 'rgba(200,210,220,0.35)';
      ctx.fillRect(S * 0.49, S * 0.25, 3, S * 0.44);
      ctx.fillStyle = 'rgb(150,150,150)';
      ctx.fillRect(S * 0.22, S * 0.72, S * 0.56, 5);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(0, S - 6, S, 6);
      break;
    }
    case 'glass': {
      const g = ctx.createLinearGradient(0, 0, S, S);
      g.addColorStop(0, 'rgb(90,100,110)');
      g.addColorStop(0.5, 'rgb(150,165,175)');
      g.addColorStop(1, 'rgb(80,90,100)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = 'rgb(60,60,60)';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, S, S);
      break;
    }
    case 'crate':
      drawPattern('planks', ctx, S, rand);
      ctx.strokeStyle = 'rgb(110,110,110)';
      ctx.lineWidth = S / 12;
      ctx.strokeRect(S / 24, S / 24, S - S / 12, S - S / 12);
      ctx.beginPath();
      ctx.moveTo(S / 12, S / 12);
      ctx.lineTo(S - S / 12, S - S / 12);
      ctx.stroke();
      break;
    case 'rock':
      fill(190);
      noiseCanvas(ctx, S, S, rand, 20, 0.5, 110, 255);
      noiseCanvas(ctx, S, S, rand, 5, 0.25, 110, 255);
      break;
    case 'canvas':
      fill(210);
      for (let i = 0; i < S; i += 2) {
        ctx.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.05})`;
        ctx.fillRect(0, i, S, 1);
        ctx.fillRect(i, 0, 1, S);
      }
      noiseCanvas(ctx, S, S, rand, 24, 0.15, 150, 255);
      break;
    case 'net':
      fill(160);
      for (let i = 0; i < 300; i++) {
        const v = 120 + rand() * 135;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.beginPath();
        ctx.arc(rand() * S, rand() * S, 3 + rand() * 7, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'hazard':
      fill(240);
      ctx.fillStyle = 'rgb(35,35,35)';
      for (let i = -S; i < S * 2; i += S / 4) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + S / 8, 0);
        ctx.lineTo(i + S / 8 - S, S);
        ctx.lineTo(i - S, S);
        ctx.fill();
      }
      break;
    case 'rust':
      fill(190);
      noiseCanvas(ctx, S, S, rand, 12, 0.5, 100, 255);
      speckle(ctx, S, S, rand, 400, 2, 90, 170);
      break;
    case 'gravel':
      fill(190);
      speckle(ctx, S, S, rand, 1600, 2.5, 110, 255);
      break;
    case 'target': {
      fill(230);
      const c = S / 2;
      for (let r = 5; r > 0; r--) {
        ctx.fillStyle = r % 2 ? 'rgb(40,40,40)' : 'rgb(235,235,235)';
        ctx.beginPath();
        ctx.ellipse(c, S * 0.42, (r * S) / 12, (r * S) / 9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'hesco':
      fill(185);
      noiseCanvas(ctx, S, S, rand, 8, 0.3, 120, 255);
      ctx.strokeStyle = 'rgba(70,70,70,0.6)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= S; i += S / 8) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, S);
        ctx.moveTo(0, i);
        ctx.lineTo(S, i);
        ctx.stroke();
      }
      break;
    case 'stone': {
      fill(170);
      let y = 0;
      while (y < S) {
        const h = S / 6 + rand() * S / 10;
        let x = -rand() * 20;
        while (x < S) {
          const w = S / 4 + rand() * S / 5;
          const v = 170 + rand() * 70;
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
          x += w;
        }
        y += h;
      }
      noiseCanvas(ctx, S, S, rand, 6, 0.15);
      break;
    }
    case 'redcross':
      fill(245);
      ctx.fillStyle = 'rgb(200,30,30)';
      ctx.fillRect(S * 0.4, S * 0.15, S * 0.2, S * 0.7);
      ctx.fillRect(S * 0.15, S * 0.4, S * 0.7, S * 0.2);
      break;
    case 'leaves':
      fill(150);
      for (let i = 0; i < 500; i++) {
        const v = 110 + rand() * 145;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.beginPath();
        ctx.ellipse(rand() * S, rand() * S, 2 + rand() * 5, 1 + rand() * 3, rand() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'bark':
      fill(170);
      for (let x = 0; x < S; x += 2) {
        const v = 130 + rand() * 110;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, 0, 2, S);
      }
      noiseCanvas(ctx, S, S, rand, 8, 0.2);
      break;
    default:
      fill(220);
  }
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function buildAtlas() {
  const S = TILE_PX;
  const N = ATLAS_GRID;
  const canvas = makeCanvas(S * N, S * N);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tile = makeCanvas(S, S);
  const tctx = tile.getContext('2d', { willReadFrequently: true });
  PATTERNS.forEach((p, i) => {
    const rand = mulberry32(1000 + i * 17);
    tctx.clearRect(0, 0, S, S);
    drawPattern(p, tctx, S, rand);
    const x = (i % N) * S;
    const y = Math.floor(i / N) * S;
    ctx.drawImage(tile, x, y);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

export function tileOffset(pattern) {
  const i = PATTERN_INDEX[pattern] ?? 0;
  return [(i % ATLAS_GRID) / ATLAS_GRID, Math.floor(i / ATLAS_GRID) / ATLAS_GRID];
}

// Terrain detail texture (tiling grayscale).
export function buildTerrainDetail() {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const rand = mulberry32(77);
  ctx.fillStyle = 'rgb(200,200,200)';
  ctx.fillRect(0, 0, S, S);
  noiseCanvas(ctx, S, S, rand, 32, 0.35, 130, 255);
  noiseCanvas(ctx, S, S, rand, 8, 0.25, 130, 255);
  noiseCanvas(ctx, S, S, rand, 2, 0.2, 130, 255);
  // grass tufts
  for (let i = 0; i < 1400; i++) {
    const v = 150 + rand() * 105;
    ctx.strokeStyle = `rgba(${v},${v},${v},0.5)`;
    const x = rand() * S;
    const y = rand() * S;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 3, y - 2 - rand() * 4);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// Grayscale camo mask: three levels read by the camo shader.
export function buildCamoMask() {
  const S = 128;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const rand = mulberry32(4242);
  ctx.fillStyle = 'rgb(255,255,255)';
  ctx.fillRect(0, 0, S, S);
  for (const [v, n, r] of [[128, 26, 14], [20, 22, 9]]) {
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    for (let i = 0; i < n; i++) {
      const x = rand() * S;
      const y = rand() * S;
      ctx.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const rr = r * (0.5 + rand() * 0.8);
        ctx.lineTo(x + Math.cos(a) * rr * 1.4, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      // wrap for seamless tiling
      ctx.save();
      ctx.translate(x > S / 2 ? -S : S, 0);
      ctx.fill();
      ctx.restore();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Soft round sprite for particles.
export function buildSoftSprite(hard = 0) {
  const S = 64;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(hard ? 0.4 : 0.25, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// Puffy smoke sprite with noisy edges.
export function buildSmokeSprite() {
  const S = 128;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const rand = mulberry32(99);
  for (let i = 0; i < 24; i++) {
    const x = S / 2 + (rand() - 0.5) * S * 0.45;
    const y = S / 2 + (rand() - 0.5) * S * 0.45;
    const r = S * (0.12 + rand() * 0.2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
