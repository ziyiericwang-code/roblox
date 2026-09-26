// Effects layer over the map: ballistic arcs between capitals, interceptions, impact
// shockwaves and a radar sweep. It runs its own animation loop only while something is
// on screen, so the idle game costs nothing.

const RED = [255, 92, 60];
const AMBER = [255, 196, 90];
const CYAN = [110, 220, 255];

export class StrikeLayer {
  constructor(host, renderer, world) {
    this.r = renderer;
    this.w = world;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'strike-layer';
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.missiles = [];
    this.fx = [];
    this.barrage = false;
    this.radar = false;
    this.nextLaunch = 0;
    this.sweep = 0;
    this.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.running = false;
    this.pairs = [];
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
  }

  // capital-to-capital pairs used by the title barrage
  setPairs(pairs) {
    this.pairs = pairs.filter(([a, b]) => a >= 0 && b >= 0 && a !== b);
  }

  // title screen: continuous exchanges with a radar sweep
  setBarrage(on) {
    this.barrage = on && !this.reduced;
    this.radar = on;
    if (!on) this.missiles.length = 0;
    this.start();
  }

  launch(from, to, { color = RED, intercept = false, delay = 0 } = {}) {
    const [ax, ay] = this.r.regionCenter(from);
    let [bx, by] = this.r.regionCenter(to);
    if (bx - ax > 180) bx -= 360;
    if (bx - ax < -180) bx += 360;
    const km = Math.hypot(bx - ax, by - ay);
    this.missiles.push({ ax, ay, bx, by, t: -delay, dur: 1.6 + Math.min(2.6, km / 60), color, intercept: intercept ? 0.55 + Math.random() * 0.25 : 0, interceptor: null, to });
    this.start();
  }

  // shockwave at a province (battles after a turn)
  burst(prov, { color = AMBER, big = false, delay = 0 } = {}) {
    const [x, y] = this.r.regionCenter(prov);
    this.fx.push({ x, y, t: -delay, life: big ? 1.8 : 1.2, size: big ? 70 : 34, color });
    this.start();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      const busy = this.frame(dt);
      if (busy) requestAnimationFrame(loop);
      else {
        this.running = false;
        this.clear();
      }
    };
    requestAnimationFrame(loop);
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // world -> screen, keeping a point on the copy of the world nearest to `near`
  proj(x, y) {
    return this.r.worldToScreen(x, y);
  }

  frame(dt) {
    const ctx = this.ctx;
    const W = this.canvas.width / this.dpr;
    const H = this.canvas.height / this.dpr;
    this.clear();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const z = this.r.camera.zoom;

    if (this.barrage && this.pairs.length) {
      this.nextLaunch -= dt;
      if (this.nextLaunch <= 0 && this.missiles.length < 14) {
        const [a, b] = this.pairs[Math.floor(Math.random() * this.pairs.length)];
        const flip = Math.random() < 0.5;
        this.launch(flip ? a : b, flip ? b : a, { color: Math.random() < 0.75 ? RED : AMBER, intercept: Math.random() < 0.45 });
        this.nextLaunch = 0.18 + Math.random() * 0.45;
      }
    }

    if (this.radar) this.drawRadar(ctx, W, H, dt);

    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.t += dt / m.dur;
      if (m.t < 0) continue;
      const [sx, sy] = this.proj(m.ax, m.ay);
      const ex = sx + (m.bx - m.ax) * z;
      const ey = sy - (m.by - m.ay) * z;
      const d = Math.hypot(ex - sx, ey - sy);
      const cx = (sx + ex) / 2;
      const cy = (sy + ey) / 2 - Math.max(40, d * 0.42);
      const at = (t) => {
        const u = 1 - t;
        return [u * u * sx + 2 * u * t * cx + t * t * ex, u * u * sy + 2 * u * t * cy + t * t * ey];
      };
      // launch the interceptor so it meets the missile at m.intercept
      if (m.intercept && !m.interceptor && m.t >= m.intercept - 0.28) m.interceptor = { t0: m.t };
      const head = Math.min(1, m.t);
      this.trail(ctx, at, Math.max(0, head - 0.38), head, m.color, m.t < 0.08 ? m.t / 0.08 : 1);
      if (m.interceptor) {
        const [px, py] = at(m.intercept);
        const k = Math.min(1, (m.t - m.interceptor.t0) / (m.intercept - m.interceptor.t0));
        const ix = ex + (px - ex) * k;
        const iy = ey + (py - ey) * k - Math.sin(k * Math.PI) * 30;
        this.line(ctx, ex, ey, ix, iy, CYAN, 0.55);
        this.dot(ctx, ix, iy, CYAN, 2.2);
        if (m.t >= m.intercept) {
          this.fx.push({ x: m.ax + ((px - sx) / z), y: m.ay - ((py - sy) / z), t: 0, life: 0.9, size: 26, color: CYAN });
          this.missiles.splice(i, 1);
          continue;
        }
      }
      if (m.t >= 1) {
        this.fx.push({ x: m.bx, y: m.by, t: 0, life: 1.6, size: 46 + Math.random() * 30, color: m.color });
        this.missiles.splice(i, 1);
      }
    }

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      if (f.t < 0) continue;
      const k = f.t / f.life;
      if (k >= 1) {
        this.fx.splice(i, 1);
        continue;
      }
      const [x, y] = this.proj(f.x, f.y);
      if (x < -120 || y < -120 || x > W + 120 || y > H + 120) continue;
      this.shock(ctx, x, y, k, f.size, f.color);
    }
    ctx.globalCompositeOperation = 'source-over';
    return this.radar || this.missiles.length > 0 || this.fx.length > 0;
  }

  trail(ctx, at, t0, t1, c, alpha) {
    const n = 18;
    let [px, py] = at(t0);
    for (let i = 1; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      const [x, y] = at(t);
      const a = (i / n) ** 1.6 * alpha;
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${a * 0.35})`;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      px = x;
      py = y;
    }
    this.dot(ctx, px, py, c, 3.4 * alpha + 0.4);
  }

  line(ctx, x0, y0, x1, y1, c, a) {
    ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  dot(ctx, x, y, c, r) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.25, `rgba(${c[0]},${c[1]},${c[2]},0.8)`);
    g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 5, 0, Math.PI * 2);
    ctx.fill();
  }

  shock(ctx, x, y, k, size, c) {
    // flash
    if (k < 0.35) {
      const a = 1 - k / 0.35;
      const g = ctx.createRadialGradient(x, y, 0, x, y, size * 0.7);
      g.addColorStop(0, `rgba(255,255,240,${a})`);
      g.addColorStop(0.4, `rgba(${c[0]},${c[1]},${c[2]},${a * 0.7})`);
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, size * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    // two rings
    for (const [lag, w] of [[0, 2], [0.18, 1]]) {
      const kk = Math.max(0, (k - lag) / (1 - lag));
      if (kk <= 0) continue;
      const ee = 1 - (1 - kk) ** 3;
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${(1 - kk) * 0.9})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(x, y, 4 + ee * size, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawRadar(ctx, W, H, dt) {
    const cx = W * 0.5;
    const cy = H * 0.5;
    const R = Math.hypot(W, H) * 0.55;
    if (!this.reduced) this.sweep = (this.sweep + dt * 0.9) % (Math.PI * 2);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(120,230,170,0.07)';
    ctx.lineWidth = 1;
    for (let r = 120; r < R; r += 140) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();
    if (ctx.createConicGradient) {
      const g = ctx.createConicGradient(this.sweep - 0.9, cx, cy);
      g.addColorStop(0, 'rgba(120,230,170,0)');
      g.addColorStop(0.14, 'rgba(120,230,170,0.16)');
      g.addColorStop(0.1432, 'rgba(160,255,200,0.35)');
      g.addColorStop(0.145, 'rgba(120,230,170,0)');
      g.addColorStop(1, 'rgba(120,230,170,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }
}
