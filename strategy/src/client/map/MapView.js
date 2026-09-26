// Map view: owns the WebGL renderer, the label overlay and pointer/keyboard input.
// Emits high-level events; game logic lives elsewhere.
import { MapRenderer } from './MapRenderer.js';
import { LabelLayer } from './LabelLayer.js';

export class MapView {
  constructor(root, world, arcs) {
    this.root = root;
    this.world = world;
    root.classList.add('mapview');
    this.glCanvas = document.createElement('canvas');
    this.glCanvas.className = 'map-gl';
    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.className = 'map-labels';
    root.append(this.glCanvas, this.labelCanvas);
    this.r = new MapRenderer(this.glCanvas, world, arcs);
    this.labels = new LabelLayer(this.labelCanvas, world, this.r);
    this.handlers = {};
    this.labelsDirty = true;
    this.lastCam = '';
    this.running = true;
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
    this.bindInput();
    this.last = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (t - this.last) / 1000);
      this.last = t;
      this.tick(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  on(ev, fn) {
    this.handlers[ev] = fn;
  }
  emit(ev, ...args) {
    const h = this.handlers[ev];
    if (h) h(...args);
  }

  resize() {
    this.r.resize();
    this.labels.resize(this.r.dpr, this.r.cssW, this.r.cssH);
    this.labelsDirty = true;
  }

  tick(dt) {
    // keyboard panning
    const k = this.keys || {};
    const sp = 600 * dt;
    if (k.ArrowLeft || k.a) this.r.panBy(sp, 0);
    if (k.ArrowRight || k.d) this.r.panBy(-sp, 0);
    if (k.ArrowUp || k.w) this.r.panBy(0, sp);
    if (k.ArrowDown || k.s) this.r.panBy(0, -sp);
    if (this.hooks) this.hooks(dt);
    this.r.frame(dt);
    const c = this.r.camera;
    const cam = `${c.x.toFixed(3)},${c.y.toFixed(3)},${c.zoom.toFixed(3)}`;
    if (cam !== this.lastCam) {
      this.lastCam = cam;
      this.labelsDirty = true;
      this.emit('camera', c);
    }
    if (this.labelsDirty || this.labels.dirty) {
      this.labels.draw();
      this.labelsDirty = false;
      this.labels.dirty = false;
    }
  }

  bindInput() {
    const el = this.labelCanvas;
    el.style.touchAction = 'none';
    this.keys = {};
    let down = null;
    const pointers = new Map();
    let pinch = null;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        down = null;
        return;
      }
      down = { x: e.offsetX, y: e.offsetY, button: e.button, moved: false, t: performance.now(), shift: e.shiftKey, id: this.r.pick(e.offsetX, e.offsetY) };
      this.emit('pointerdown', down, e);
    });
    el.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        this.r.zoomAt(mx, my, d / pinch.d);
        this.r.panBy(mx - pinch.mx, my - pinch.my);
        pinch = { d, mx, my };
        return;
      }
      if (down) {
        const dx = e.offsetX - down.x;
        const dy = e.offsetY - down.y;
        if (!down.moved && Math.hypot(dx, dy) > 5) {
          down.moved = true;
          down.dragMode = this.handlers.dragstart ? this.handlers.dragstart(down) : null;
        }
        if (down.moved) {
          if (down.dragMode) this.emit('dragmove', down, e.offsetX, e.offsetY, this.r.pick(e.offsetX, e.offsetY));
          else if (down.button === 0 || e.pointerType === 'touch') {
            this.r.panBy(e.movementX || dx - (down.px || 0), e.movementY || dy - (down.py || 0));
          }
          down.px = dx;
          down.py = dy;
        }
        return;
      }
      const id = this.r.pick(e.offsetX, e.offsetY);
      if (id !== this.r.hover) {
        this.r.hover = id;
        this.r.dirty = true;
        this.emit('hover', id, e.offsetX, e.offsetY);
      }
      this.emit('hovermove', id, e.offsetX, e.offsetY);
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!down) return;
      const d = down;
      down = null;
      const id = this.r.pick(e.offsetX, e.offsetY);
      if (d.moved) {
        if (d.dragMode) this.emit('dragend', d, id, e);
        return;
      }
      const longPress = e.pointerType === 'touch' && performance.now() - d.t > 480;
      if (d.button === 2 || longPress) this.emit('rightclick', id, e);
      else this.emit('click', id, e);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', (e) => {
      pointers.delete(e.pointerId);
      down = null;
      pinch = null;
    });
    el.addEventListener('pointerleave', () => {
      if (this.r.hover !== -1) {
        this.r.hover = -1;
        this.r.dirty = true;
        this.emit('hover', -1);
      }
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
        this.r.zoomAt(e.offsetX, e.offsetY, f);
      },
      { passive: false },
    );
    this.keydown = (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      this.keys[e.key] = true;
      this.emit('key', e);
    };
    this.keyup = (e) => (this.keys[e.key] = false);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
  }

  focus(id, zoom) {
    const [x, y] = this.r.regionCenter(id);
    this.r.flyTo(x, y, zoom);
  }

  destroy() {
    this.running = false;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    this.root.innerHTML = '';
  }
}
