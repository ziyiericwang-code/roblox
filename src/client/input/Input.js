// Unified input: keyboard + mouse (pointer lock), gamepad, and touch controls
// (virtual stick, look drag, contextual buttons). Game code reads actions,
// never raw devices.

export const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], crouch: ['KeyC', 'ControlLeft'], prone: ['KeyZ'],
  leanL: ['KeyQ'], leanR: ['KeyE'], reload: ['KeyR'], interact: ['KeyF'], grenade: ['KeyG'], spot: ['KeyT'],
  command: ['KeyV'], emote: ['KeyY'], map: ['KeyM'], menu: ['Tab'], squad: ['KeyP'], missions: ['KeyJ'],
  redeploy: ['KeyX'], camera: ['KeyK'], slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'], slot5: ['Digit5'],
  descend: ['KeyC', 'ControlLeft'], fire: ['Mouse0'], aim: ['Mouse2'], escape: ['Escape'], firemode: ['KeyB'],
  promote: ['KeyU'], sandbox: ['Backquote', 'F2'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressedSet = new Set();
    this.releasedSet = new Set();
    this.lookDX = 0;
    this.lookDY = 0;
    this.wheel = 0;
    this.locked = false;
    this.enabled = true; // false while menus are open
    this.touch = null;
    this.sensitivity = 1;
    this.invertY = false;
    this.touchMode = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.gamepad = null;
    this.bind();
  }

  bind() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedSet.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releasedSet.add(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
    this.canvas.addEventListener('mousedown', (e) => {
      const code = `Mouse${e.button}`;
      if (!this.locked && this.enabled && !this.touchMode) this.requestLock();
      if (!this.down.has(code)) this.pressedSet.add(code);
      this.down.add(code);
    });
    window.addEventListener('mouseup', (e) => {
      const code = `Mouse${e.button}`;
      this.down.delete(code);
      this.releasedSet.add(code);
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookDX += e.movementX || 0;
      this.lookDY += e.movementY || 0;
    });
    window.addEventListener('wheel', (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.down.delete('Mouse0');
        this.down.delete('Mouse2');
      }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepad = e.gamepad.index;
    });
  }

  requestLock() {
    if (this.touchMode) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: false });
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* not supported */
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(action) {
    if (!this.enabled && action !== 'escape' && action !== 'menu' && action !== 'map') return false;
    const keys = BINDINGS[action];
    if (keys && keys.some((k) => this.down.has(k))) return true;
    if (this.touch && this.touch.isDown(action)) return true;
    if (this.padDown && this.padDown.has(action)) return true;
    return false;
  }

  pressed(action) {
    const keys = BINDINGS[action];
    if (keys && keys.some((k) => this.pressedSet.has(k))) return this.enabled || action === 'escape' || action === 'menu' || action === 'map';
    if (this.touch && this.touch.pressed(action)) return true;
    if (this.padPressed && this.padPressed.has(action)) return true;
    return false;
  }

  released(action) {
    const keys = BINDINGS[action];
    if (keys && keys.some((k) => this.releasedSet.has(k))) return true;
    if (this.touch && this.touch.released(action)) return true;
    return false;
  }

  move() {
    let fwd = 0;
    let right = 0;
    if (this.enabled) {
      if (this.isDown('forward')) fwd += 1;
      if (this.isDown('back')) fwd -= 1;
      if (this.isDown('right')) right += 1;
      if (this.isDown('left')) right -= 1;
    }
    if (this.touch && this.enabled) {
      fwd += this.touch.stick.y;
      right += this.touch.stick.x;
    }
    if (this.padMove) {
      fwd += this.padMove.y;
      right += this.padMove.x;
    }
    return { fwd: Math.max(-1, Math.min(1, fwd)), right: Math.max(-1, Math.min(1, right)) };
  }

  // Returns look delta in radians.
  look(adsFactor = 1) {
    let dx = this.lookDX * 0.0022;
    let dy = this.lookDY * 0.0022;
    this.lookDX = 0;
    this.lookDY = 0;
    if (this.touch) {
      dx += this.touch.lookDX * 0.0055;
      dy += this.touch.lookDY * 0.0055;
      this.touch.lookDX = 0;
      this.touch.lookDY = 0;
    }
    if (this.padLook) {
      dx += this.padLook.x * 0.05;
      dy += this.padLook.y * 0.05;
    }
    const s = this.sensitivity * adsFactor;
    return { dx: dx * s, dy: dy * s * (this.invertY ? -1 : 1) };
  }

  pollGamepad() {
    this.padMove = null;
    this.padLook = null;
    const prev = this.padDown || new Set();
    this.padDown = new Set();
    this.padPressed = new Set();
    if (this.gamepad === null || !navigator.getGamepads) return;
    const gp = navigator.getGamepads()[this.gamepad];
    if (!gp) return;
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    this.padMove = { x: dz(gp.axes[0]), y: -dz(gp.axes[1]) };
    this.padLook = { x: dz(gp.axes[2]), y: dz(gp.axes[3]) };
    const map = { 0: 'jump', 1: 'crouch', 2: 'reload', 3: 'slot2', 4: 'grenade', 5: 'interact', 6: 'aim', 7: 'fire', 10: 'sprint', 11: 'prone', 12: 'command', 13: 'spot', 9: 'menu', 8: 'map' };
    gp.buttons.forEach((b, i) => {
      const a = map[i];
      if (a && b.pressed) {
        this.padDown.add(a);
        if (!prev.has(a)) this.padPressed.add(a);
      }
    });
  }

  endFrame() {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.wheel = 0;
    if (this.touch) this.touch.endFrame();
  }
}

// ------------------------------------------------------------------ touch UI
export class TouchControls {
  constructor(root) {
    this.root = root;
    this.stick = { x: 0, y: 0 };
    this.lookDX = 0;
    this.lookDY = 0;
    this.down = new Set();
    this.pressedSet = new Set();
    this.releasedSet = new Set();
    this.stickId = null;
    this.lookId = null;
    this.el = document.createElement('div');
    this.el.className = 'touch';
    this.el.innerHTML = `
      <div class="t-stick"><div class="t-knob"></div></div>
      <div class="t-look"></div>
      <div class="t-btns">
        <button data-a="fire" class="tb t-fire">FIRE</button>
        <button data-a="aim" class="tb t-aim">AIM</button>
        <button data-a="reload" class="tb t-reload">R</button>
        <button data-a="jump" class="tb t-jump">⤒</button>
        <button data-a="crouch" data-long="prone" class="tb t-crouch">⤓</button>
        <button data-a="grenade" class="tb t-gren">G</button>
        <button data-a="slot2" data-cycle="1" class="tb t-swap">⇄</button>
        <button data-a="interact" class="tb t-inter hidden">USE</button>
        <button data-a="spot" class="tb t-spot">◎</button>
        <button data-a="command" class="tb t-cmd">⌖</button>
        <button data-a="descend" class="tb t-down hidden">▼</button>
      </div>
      <button data-a="menu" class="tb t-menu">☰</button>
      <button data-a="map" class="tb t-map">MAP</button>`;
    root.appendChild(this.el);
    this.knob = this.el.querySelector('.t-knob');
    this.stickEl = this.el.querySelector('.t-stick');
    this.bind();
  }

  bind() {
    const stick = this.stickEl;
    const look = this.el.querySelector('.t-look');
    const rect = () => stick.getBoundingClientRect();
    stick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this.stickId = t.identifier;
      this.updateStick(t, rect());
    }, { passive: false });
    stick.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === this.stickId) this.updateStick(t, rect());
    }, { passive: false });
    const endStick = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stickId) {
          this.stickId = null;
          this.stick.x = 0;
          this.stick.y = 0;
          this.knob.style.transform = 'translate(-50%,-50%)';
          this.setDown('sprint', false);
        }
      }
    };
    stick.addEventListener('touchend', endStick);
    stick.addEventListener('touchcancel', endStick);
    let last = null;
    look.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this.lookId = t.identifier;
      last = { x: t.clientX, y: t.clientY };
    }, { passive: false });
    look.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === this.lookId && last) {
          this.lookDX += t.clientX - last.x;
          this.lookDY += t.clientY - last.y;
          last = { x: t.clientX, y: t.clientY };
        }
      }
    }, { passive: false });
    look.addEventListener('touchend', () => {
      this.lookId = null;
      last = null;
    });
    for (const b of this.el.querySelectorAll('button[data-a]')) {
      const a = b.dataset.a;
      const longA = b.dataset.long;
      let timer = null;
      let bLast = null;
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        bLast = { x: t.clientX, y: t.clientY, id: t.identifier };
        if (b.dataset.toggle) {
          this.setDown(a, !this.down.has(a));
          return;
        }
        this.setDown(a, true);
        if (longA) {
          timer = setTimeout(() => {
            this.setDown(a, false);
            this.pressedSet.add(longA);
            timer = null;
          }, 450);
        }
      }, { passive: false });
      // dragging on fire/aim also steers the camera
      b.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          if (bLast && t.identifier === bLast.id && (a === 'fire' || a === 'aim')) {
            this.lookDX += t.clientX - bLast.x;
            this.lookDY += t.clientY - bLast.y;
            bLast.x = t.clientX;
            bLast.y = t.clientY;
          }
        }
      }, { passive: false });
      const end = (e) => {
        e.preventDefault();
        if (b.dataset.toggle) return;
        if (timer) clearTimeout(timer);
        this.setDown(a, false);
      };
      b.addEventListener('touchend', end);
      b.addEventListener('touchcancel', end);
    }
  }

  updateStick(t, r) {
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = (t.clientX - cx) / (r.width / 2);
    let dy = (t.clientY - cy) / (r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > 1) {
      dx /= l;
      dy /= l;
    }
    this.stick.x = dx;
    this.stick.y = -dy;
    this.knob.style.transform = `translate(calc(-50% + ${dx * 40}px), calc(-50% + ${dy * 40}px))`;
    // push the stick all the way forward to sprint
    this.setDown('sprint', dy < -0.92);
  }

  setDown(a, v) {
    if (v && !this.down.has(a)) this.pressedSet.add(a);
    if (!v && this.down.has(a)) this.releasedSet.add(a);
    if (v) this.down.add(a);
    else this.down.delete(a);
  }

  isDown(a) {
    return this.down.has(a);
  }
  pressed(a) {
    return this.pressedSet.has(a);
  }
  released(a) {
    return this.releasedSet.has(a);
  }
  endFrame() {
    this.pressedSet.clear();
    this.releasedSet.clear();
  }

  setContext(ctx) {
    const inter = this.el.querySelector('.t-inter');
    inter.classList.toggle('hidden', !ctx.interact);
    if (ctx.interact) inter.textContent = ctx.interact;
    this.el.querySelector('.t-down').classList.toggle('hidden', !ctx.air);
    this.el.classList.toggle('in-vehicle', !!ctx.vehicle);
  }

  show(v) {
    if (this.shown === v) return;
    this.shown = v;
    this.el.style.display = v ? '' : 'none';
  }
}
