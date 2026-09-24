// Procedural audio engine: every sound is synthesised with WebAudio at runtime
// (no audio files). Layered gunshots per weapon class, explosions, impacts,
// footsteps, engines & rotors, wind/rain/wildlife ambience, distant battle,
// radio, UI and adaptive music. 3D positioned with distance filtering and
// speed-of-sound delay for distant events.

const SOUND_SPEED = 343;

const GUNS = {
  rifle: { crack: 3200, body: 900, thump: 110, len: 0.09, tail: 0.5, gain: 0.8 },
  battle: { crack: 2600, body: 750, thump: 95, len: 0.12, tail: 0.65, gain: 0.95 },
  smg: { crack: 3800, body: 1200, thump: 140, len: 0.06, tail: 0.35, gain: 0.6 },
  lmg: { crack: 2800, body: 800, thump: 100, len: 0.1, tail: 0.6, gain: 0.9 },
  dmr: { crack: 2400, body: 700, thump: 85, len: 0.14, tail: 0.8, gain: 1.0 },
  sniper: { crack: 2000, body: 600, thump: 70, len: 0.18, tail: 1.2, gain: 1.15 },
  shotgun: { crack: 1800, body: 500, thump: 70, len: 0.16, tail: 0.7, gain: 1.05 },
  pistol: { crack: 4200, body: 1400, thump: 160, len: 0.05, tail: 0.3, gain: 0.55 },
  revolver: { crack: 3000, body: 900, thump: 110, len: 0.09, tail: 0.5, gain: 0.8 },
  hmg: { crack: 2000, body: 500, thump: 70, len: 0.14, tail: 0.8, gain: 1.1 },
  autocannon: { crack: 1500, body: 400, thump: 55, len: 0.18, tail: 0.9, gain: 1.2 },
  cannon: { crack: 900, body: 250, thump: 40, len: 0.35, tail: 2.0, gain: 1.5 },
  rocket: { crack: 1200, body: 500, thump: 60, len: 0.25, tail: 1.0, gain: 1.0 },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volumes = { master: 0.8, sfx: 0.9, ambient: 0.6, music: 0.45, ui: 0.7 };
    this.listener = { x: 0, y: 0, z: 0 };
    this.voices = 0;
    this.engines = new Map();
    this.footAcc = new Map();
    this.musicState = null;
    this.mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  }

  // Must be called from a user gesture.
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.enabled = true;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    this.music = ctx.createGain();
    this.ui = ctx.createGain();
    for (const g of [this.sfx, this.amb, this.music, this.ui]) g.connect(this.master);
    this.applyVolumes();
    // shared buffers
    this.white = this.noiseBuffer('white', 2);
    this.brown = this.noiseBuffer('brown', 4);
    this.pink = this.noiseBuffer('pink', 3);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.2, 2.5);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.sfx);
    this.startAmbience();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const v = this.volumes;
    this.master.gain.value = v.master;
    this.sfx.gain.value = v.sfx;
    this.amb.gain.value = v.ambient;
    this.music.gain.value = v.music;
    this.ui.gain.value = v.ui;
  }

  setVolumes(v) {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  noiseBuffer(kind, secs) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * secs);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      }
    }
    return buf;
  }

  impulse(secs, decay) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * secs);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // early slap-back from terrain + diffuse tail
        const slap = i > ctx.sampleRate * 0.09 && i < ctx.sampleRate * 0.11 ? 0.6 : 0;
        d[i] = (Math.random() * 2 - 1) * (Math.pow(1 - t, decay) * 0.5 + slap * Math.random());
      }
    }
    return buf;
  }

  setListener(pos, fwd) {
    this.listener.x = pos.x;
    this.listener.y = pos.y;
    this.listener.z = pos.z;
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.02);
      L.positionY.setTargetAtTime(pos.y, t, 0.02);
      L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      L.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else if (L.setPosition) {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  dist(p) {
    return Math.hypot(p.x - this.listener.x, p.y - this.listener.y, p.z - this.listener.z);
  }

  // Output node for a positioned sound; returns {input, when} or null if inaudible.
  spatial(p, maxDist, opts = {}) {
    const ctx = this.ctx;
    const d = p ? this.dist(p) : 0;
    if (d > maxDist) return null;
    if (this.voices > 48 && d > 60) return null;
    const input = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    // air absorbs high frequencies with distance
    lp.frequency.value = Math.max(500, 18000 / (1 + d / 60));
    input.connect(lp);
    let out = lp;
    if (p) {
      const pan = ctx.createPanner();
      pan.panningModel = this.mobile ? 'equalpower' : 'HRTF';
      pan.distanceModel = 'inverse';
      pan.refDistance = opts.ref || 6;
      pan.maxDistance = 10000;
      pan.rolloffFactor = opts.rolloff || 1;
      if (pan.positionX) {
        pan.positionX.value = p.x;
        pan.positionY.value = p.y;
        pan.positionZ.value = p.z;
      } else pan.setPosition(p.x, p.y, p.z);
      out.connect(pan);
      out = pan;
    }
    out.connect(opts.bus || this.sfx);
    if (opts.reverb !== false) {
      const send = ctx.createGain();
      send.gain.value = Math.min(0.9, 0.15 + d / 400);
      lp.connect(send);
      send.connect(this.reverb);
    }
    const delay = p && d > 50 ? d / SOUND_SPEED : 0;
    this.voices++;
    setTimeout(() => {
      this.voices--;
    }, 2500 + delay * 1000);
    return { input, when: ctx.currentTime + delay + 0.005, d };
  }

  noise(out, when, dur, type, freq, q, gain, buf = this.white, attack = 0.001) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(when, Math.random() * 1.5);
    src.stop(when + dur + 0.05);
    return f;
  }

  tone(out, when, dur, type, f0, f1, gain, attack = 0.002) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, when);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g);
    g.connect(out);
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  // ------------------------------------------------------------------ one-shots
  gunshot(kind, p, isSelf = false) {
    if (!this.enabled) return;
    const s = GUNS[kind] || GUNS.rifle;
    const sp = this.spatial(isSelf ? null : p, 1400, { ref: 8 });
    if (!sp) return;
    const { input, when, d } = sp;
    const far = d > 200;
    const gain = s.gain * (isSelf ? 0.9 : 1);
    if (!far) this.noise(input, when, s.len * 0.6, 'highpass', s.crack, 0.7, gain * 0.9);
    this.noise(input, when, s.len * 2, 'bandpass', s.body, 0.8, gain * 1.4);
    this.tone(input, when, s.len * 1.5, 'sine', s.thump * 1.6, s.thump * 0.6, gain * 1.2);
    this.noise(input, when + 0.02, s.tail, 'lowpass', far ? 500 : 1400, 0.5, gain * 0.35, this.pink, 0.01);
    if (kind === 'rocket') this.noise(input, when, 1.2, 'bandpass', 900, 1.5, 0.5, this.white, 0.05);
  }

  explosion(p, size = 1) {
    if (!this.enabled) return;
    const sp = this.spatial(p, 2600, { ref: 20 });
    if (!sp) return;
    const { input, when, d } = sp;
    const g = 1.1 + size * 0.4;
    this.tone(input, when, 1.2 * size, 'sine', 90, 28, g * 1.5, 0.004);
    this.noise(input, when, 1.6 * size, 'lowpass', d > 300 ? 250 : 700, 0.7, g * 1.6, this.brown, 0.004);
    if (d < 250) this.noise(input, when, 0.35, 'highpass', 1500, 0.5, g * 0.6);
    // debris crackle
    if (d < 150) for (let i = 0; i < 6; i++) this.noise(input, when + 0.2 + Math.random() * 0.8, 0.05, 'bandpass', 2000 + Math.random() * 2000, 2, 0.15);
  }

  thunder(p) {
    if (!this.enabled) return;
    const sp = this.spatial(p, 5000, { ref: 200, reverb: true });
    if (!sp) return;
    const { input, when } = sp;
    this.noise(input, when, 4.5, 'lowpass', 300, 0.5, 1.4, this.brown, 0.3);
    this.noise(input, when + 0.1, 1.2, 'lowpass', 900, 0.5, 0.6, this.pink, 0.05);
  }

  whiz(p) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.connect(this.sfx);
    const t = ctx.currentTime;
    this.noise(g, t, 0.12, 'bandpass', 3000 + Math.random() * 2000, 4, 0.6);
    this.tone(g, t, 0.08, 'triangle', 1800, 900, 0.08);
    void p;
  }

  impact(p, kind) {
    if (!this.enabled) return;
    const sp = this.spatial(p, 120, { ref: 3, reverb: false });
    if (!sp) return;
    const { input, when } = sp;
    if (kind === 4 || kind === 2) {
      this.tone(input, when, 0.15, 'sine', 2400 + Math.random() * 1500, 1800, 0.18);
      this.noise(input, when, 0.05, 'highpass', 3000, 0.5, 0.3);
    } else if (kind === 3) {
      this.noise(input, when, 0.08, 'lowpass', 400, 0.8, 0.5);
    } else if (kind === 5) {
      this.noise(input, when, 0.25, 'bandpass', 1200, 0.8, 0.35);
    } else {
      this.noise(input, when, 0.1, 'lowpass', 900, 0.7, 0.35);
    }
  }

  footstep(p, surface = 'dirt', loud = 1, isSelf = false) {
    if (!this.enabled) return;
    const sp = this.spatial(isSelf ? null : p, 40, { ref: 2, reverb: false });
    if (!sp) return;
    const { input, when } = sp;
    const g = 0.12 * loud;
    if (surface === 'metal') {
      this.noise(input, when, 0.07, 'bandpass', 2600, 2, g * 1.2);
      this.tone(input, when, 0.06, 'triangle', 700, 500, g * 0.3);
    } else if (surface === 'wood') this.noise(input, when, 0.08, 'bandpass', 700, 1.5, g * 1.4);
    else if (surface === 'concrete') this.noise(input, when, 0.05, 'highpass', 1800, 0.7, g * 1.1);
    else if (surface === 'water') this.noise(input, when, 0.18, 'bandpass', 1400, 0.8, g * 1.6);
    else if (surface === 'snow') this.noise(input, when, 0.12, 'lowpass', 1300, 0.6, g * 1.3, this.pink);
    else {
      this.noise(input, when, 0.07, 'lowpass', 1100, 0.7, g * 1.4, this.pink);
      this.noise(input, when + 0.02, 0.05, 'highpass', 3500, 0.5, g * 0.4);
    }
  }

  reload(stage = 0) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.connect(this.sfx);
    if (stage === 0) {
      this.noise(g, t, 0.04, 'bandpass', 2200, 3, 0.25);
      this.noise(g, t + 0.18, 0.05, 'bandpass', 1500, 3, 0.2);
    } else {
      this.noise(g, t, 0.03, 'bandpass', 3000, 4, 0.3);
      this.noise(g, t + 0.1, 0.05, 'bandpass', 1800, 3, 0.35);
    }
  }

  dryFire() {
    if (!this.enabled) return;
    const g = this.ctx.createGain();
    g.connect(this.sfx);
    this.noise(g, this.ctx.currentTime, 0.02, 'bandpass', 3500, 5, 0.25);
  }

  // ------------------------------------------------------------------ UI
  uiClick(kind = 'click') {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.connect(this.ui);
    if (kind === 'hover') this.tone(g, t, 0.04, 'sine', 1400, 1400, 0.03);
    else if (kind === 'deny') {
      this.tone(g, t, 0.12, 'square', 220, 180, 0.05);
    } else if (kind === 'ding') {
      this.tone(g, t, 0.35, 'sine', 1320, 1320, 0.12);
      this.tone(g, t, 0.35, 'sine', 1980, 1980, 0.05);
    } else if (kind === 'hit') {
      this.tone(g, t, 0.05, 'triangle', 2600, 2200, 0.12);
    } else if (kind === 'kill') {
      this.tone(g, t, 0.08, 'triangle', 1900, 1900, 0.13);
      this.tone(g, t + 0.07, 0.12, 'triangle', 2500, 2500, 0.11);
    } else if (kind === 'xp') this.tone(g, t, 0.07, 'sine', 900, 1300, 0.04);
    else this.tone(g, t, 0.05, 'triangle', 900, 700, 0.07);
  }

  radio(priority = 0) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.connect(this.ui);
    this.noise(g, t, 0.12, 'bandpass', 1800, 1.2, 0.12);
    this.tone(g, t + 0.1, 0.07, 'square', priority > 1 ? 1100 : 880, priority > 1 ? 1100 : 880, 0.03);
    if (priority > 1) this.tone(g, t + 0.2, 0.07, 'square', 1100, 1100, 0.03);
  }

  fanfare(kind = 'promotion') {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    out.connect(lp);
    lp.connect(this.music);
    const notes = kind === 'medal' ? [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36]] : [[392, 0], [523, 0.18], [659, 0.36], [784, 0.54], [1047, 0.78]];
    for (const [f, dt] of notes) {
      for (const det of [-4, 0, 4]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + dt);
        g.gain.exponentialRampToValueAtTime(0.05, t + dt + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dt + (dt > 0.7 ? 1.6 : 0.5));
        o.connect(g);
        g.connect(out);
        o.start(t + dt);
        o.stop(t + dt + 1.8);
      }
    }
  }

  siren(p, secs) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const sp = this.spatial(p, 1500, { ref: 60 });
    if (!sp) return;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.25;
    const lg = ctx.createGain();
    lg.gain.value = 220;
    lfo.connect(lg);
    lg.connect(o.frequency);
    o.frequency.value = 640;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, sp.when);
    g.gain.exponentialRampToValueAtTime(0.25, sp.when + 1);
    g.gain.setValueAtTime(0.25, sp.when + secs - 2);
    g.gain.exponentialRampToValueAtTime(0.0001, sp.when + secs);
    o.connect(f);
    f.connect(g);
    g.connect(sp.input);
    o.start(sp.when);
    lfo.start(sp.when);
    o.stop(sp.when + secs + 0.1);
    lfo.stop(sp.when + secs + 0.1);
  }

  incoming(p) {
    if (!this.enabled) return;
    const sp = this.spatial(p, 600, { ref: 30 });
    if (!sp) return;
    this.tone(sp.input, sp.when + 4, 1.2, 'sine', 2400, 600, 0.15, 0.3);
  }

  // ------------------------------------------------------------------ loops
  startAmbience() {
    const ctx = this.ctx;
    const loop = (buf, type, freq, q, gain) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(f);
      f.connect(g);
      g.connect(this.amb);
      src.start();
      return { src, f, g };
    };
    this.windLoop = loop(this.brown, 'lowpass', 500, 0.6, 0.15);
    this.rainLoop = loop(this.white, 'bandpass', 3500, 0.4, 0);
    this.rainLow = loop(this.pink, 'lowpass', 800, 0.5, 0);
    this.baseHum = loop(this.brown, 'bandpass', 120, 6, 0);
    this.nextBird = 0;
    this.nextCricket = 0;
    this.nextDistant = 0;
    this.nextPA = 0;
  }

  // env: {rain, wind, daylight, nearBase, battles:[{x,z,intensity}], inForest, underwater}
  updateAmbience(env, dt) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.windLoop.g.gain.setTargetAtTime(0.06 + env.wind * 0.22 + (env.altitude > 40 ? 0.1 : 0), t, 0.8);
    this.windLoop.f.frequency.setTargetAtTime(350 + env.wind * 500, t, 1);
    this.rainLoop.g.gain.setTargetAtTime(env.rain * 0.12 * (env.indoor ? 0.4 : 1), t, 1);
    this.rainLow.g.gain.setTargetAtTime(env.rain * 0.18, t, 1);
    this.baseHum.g.gain.setTargetAtTime(env.nearBase ? 0.06 : 0, t, 2);
    const now = performance.now() / 1000;
    if (env.daylight > 0.4 && env.rain < 0.3 && now > this.nextBird && env.nature) {
      this.nextBird = now + 2 + Math.random() * 6;
      this.bird();
    }
    if (env.daylight < 0.3 && env.rain < 0.3 && now > this.nextCricket && env.nature) {
      this.nextCricket = now + 0.3 + Math.random() * 1.2;
      this.cricket();
    }
    if (env.battles && env.battles.length && now > this.nextDistant) {
      this.nextDistant = now + 0.4 + Math.random() * 2.5;
      const b = env.battles[Math.floor(Math.random() * env.battles.length)];
      const d = Math.hypot(b.x - this.listener.x, b.z - this.listener.z);
      if (d > 250 && d < 2500) this.distantFire(b);
    }
    if (env.nearBase && now > this.nextPA) {
      this.nextPA = now + 70 + Math.random() * 80;
      this.pa();
    }
    void dt;
  }

  bird() {
    const ctx = this.ctx;
    const a = Math.random() * Math.PI * 2;
    const p = { x: this.listener.x + Math.cos(a) * 30, y: this.listener.y + 8, z: this.listener.z + Math.sin(a) * 30 };
    const sp = this.spatial(p, 200, { ref: 10, reverb: false, bus: this.amb });
    if (!sp) return;
    const base = 2200 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.tone(sp.input, sp.when + i * 0.12, 0.09, 'sine', base * (1 + Math.random() * 0.3), base * (0.7 + Math.random() * 0.5), 0.05);
    void ctx;
  }

  cricket() {
    const a = Math.random() * Math.PI * 2;
    const p = { x: this.listener.x + Math.cos(a) * 12, y: this.listener.y, z: this.listener.z + Math.sin(a) * 12 };
    const sp = this.spatial(p, 80, { ref: 4, reverb: false, bus: this.amb });
    if (!sp) return;
    for (let i = 0; i < 3; i++) this.tone(sp.input, sp.when + i * 0.05, 0.03, 'sine', 4200, 4200, 0.02);
  }

  distantFire(b) {
    const p = { x: b.x + (Math.random() - 0.5) * 120, y: 5, z: b.z + (Math.random() - 0.5) * 120 };
    if (Math.random() < 0.18) this.explosion(p, 0.8);
    else {
      const kinds = ['rifle', 'lmg', 'rifle', 'battle', 'hmg'];
      const k = kinds[Math.floor(Math.random() * kinds.length)];
      const n = 1 + Math.floor(Math.random() * 6);
      for (let i = 0; i < n; i++) setTimeout(() => this.gunshot(k, p), i * (70 + Math.random() * 60));
    }
  }

  pa() {
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.value = 0.5;
    g.connect(this.amb);
    for (const [f, dt] of [[659, 0], [523, 0.35], [392, 0.7]]) this.tone(g, t + dt, 0.6, 'sine', f, f, 0.05, 0.02);
  }

  // Continuous engine voices for up to 6 nearest vehicles.
  updateEngines(list) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const keep = new Set();
    const near = list
      .map((v) => ({ v, d: Math.hypot(v.x - this.listener.x, v.z - this.listener.z) }))
      .filter((x) => x.d < 220 && x.v.engine)
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
    for (const { v } of near) {
      keep.add(v.id);
      let e = this.engines.get(v.id);
      if (!e) {
        e = this.makeEngine(v.kind);
        this.engines.set(v.id, e);
      }
      const p = e.pan;
      if (p.positionX) {
        p.positionX.setTargetAtTime(v.x, t, 0.05);
        p.positionY.setTargetAtTime(v.y, t, 0.05);
        p.positionZ.setTargetAtTime(v.z, t, 0.05);
      } else p.setPosition(v.x, v.y, v.z);
      const load = Math.min(1, Math.abs(v.speed) / (v.maxSpeed || 20));
      if (v.kind === 'air') {
        e.o1.frequency.setTargetAtTime(60 + load * 20, t, 0.2);
        e.lfo.frequency.setTargetAtTime(16 + load * 4, t, 0.3);
        e.g.gain.setTargetAtTime(0.5, t, 0.3);
      } else {
        const base = v.kind === 'tank' ? 38 : v.kind === 'boat' ? 70 : 55;
        e.o1.frequency.setTargetAtTime(base + load * base * 1.6, t, 0.15);
        e.o2.frequency.setTargetAtTime((base + load * base * 1.6) * 2.01, t, 0.15);
        e.f.frequency.setTargetAtTime(300 + load * 1200, t, 0.2);
        e.g.gain.setTargetAtTime(0.18 + load * 0.25, t, 0.2);
      }
    }
    for (const [id, e] of this.engines) {
      if (!keep.has(id)) {
        e.g.gain.setTargetAtTime(0, t, 0.3);
        setTimeout(() => e.stop(), 1500);
        this.engines.delete(id);
      }
    }
  }

  makeEngine(kind) {
    const ctx = this.ctx;
    const pan = ctx.createPanner();
    pan.panningModel = this.mobile ? 'equalpower' : 'HRTF';
    pan.refDistance = kind === 'air' ? 25 : 8;
    pan.rolloffFactor = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(pan);
    pan.connect(this.sfx);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    f.connect(g);
    const nodes = [];
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    let lfo = null;
    if (kind === 'air') {
      // rotor chop: noise amplitude-modulated at blade frequency
      const src = ctx.createBufferSource();
      src.buffer = this.brown;
      src.loop = true;
      const am = ctx.createGain();
      am.gain.value = 0.6;
      lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 17;
      const lg = ctx.createGain();
      lg.gain.value = 0.5;
      lfo.connect(lg);
      lg.connect(am.gain);
      src.connect(am);
      am.connect(f);
      o1.type = 'sine';
      o1.frequency.value = 60;
      const og = ctx.createGain();
      og.gain.value = 0.3;
      o1.connect(og);
      og.connect(f);
      f.frequency.value = 900;
      src.start();
      lfo.start();
      nodes.push(src, lfo);
    } else {
      o1.type = 'sawtooth';
      o2.type = 'square';
      const og2 = ctx.createGain();
      og2.gain.value = 0.3;
      o1.connect(f);
      o2.connect(og2);
      og2.connect(f);
      o2.start();
      nodes.push(o2);
      if (kind === 'tank') {
        const src = ctx.createBufferSource();
        src.buffer = this.white;
        src.loop = true;
        const bf = ctx.createBiquadFilter();
        bf.type = 'bandpass';
        bf.frequency.value = 2800;
        bf.Q.value = 3;
        const sg = ctx.createGain();
        sg.gain.value = 0.08;
        src.connect(bf);
        bf.connect(sg);
        sg.connect(g);
        src.start();
        nodes.push(src);
      }
    }
    o1.start();
    nodes.push(o1);
    return {
      pan, g, f, o1, o2, lfo,
      stop() {
        for (const n of nodes) {
          try {
            n.stop();
          } catch {
            /* already stopped */
          }
        }
        pan.disconnect();
      },
    };
  }

  // ------------------------------------------------------------------ music
  playMusic(kind) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (this.musicState && now - this.musicState.started < 20 && kind === this.musicState.kind) return;
    if (this.musicState) {
      this.musicState.g.gain.setTargetAtTime(0.0001, now, 1.5);
      const old = this.musicState;
      setTimeout(() => old.stop(), 5000);
    }
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = kind === 'battle' || kind === 'offensive' ? 1400 : 900;
    g.connect(lp);
    lp.connect(this.music);
    const chords = {
      battle: [[110, 130.8, 164.8], [98, 123.5, 146.8], [87.3, 110, 130.8], [98, 116.5, 146.8]],
      offensive: [[110, 138.6, 164.8], [123.5, 155.6, 185], [98, 123.5, 146.8], [110, 138.6, 164.8]],
      operation: [[98, 123.5, 146.8], [110, 130.8, 164.8], [130.8, 164.8, 196], [123.5, 146.8, 185]],
      victory: [[130.8, 164.8, 196], [174.6, 220, 261.6], [196, 246.9, 293.7], [261.6, 329.6, 392]],
      defeat: [[110, 130.8, 164.8], [103.8, 123.5, 155.6], [98, 116.5, 146.8], [92.5, 110, 138.6]],
    };
    const seq = chords[kind] || chords.battle;
    const oscs = [];
    const dur = kind === 'victory' || kind === 'defeat' ? 3 : 4.5;
    for (let c = 0; c < seq.length; c++) {
      for (const f of seq[c]) {
        for (const det of [-6, 6]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = det;
          const og = ctx.createGain();
          const t0 = now + c * dur;
          og.gain.setValueAtTime(0.0001, t0);
          og.gain.exponentialRampToValueAtTime(0.03, t0 + dur * 0.35);
          og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 1.05);
          o.connect(og);
          og.connect(g);
          o.start(t0);
          o.stop(t0 + dur * 1.1);
          oscs.push(o);
        }
      }
      if (kind === 'battle' || kind === 'offensive' || kind === 'operation') {
        for (let b = 0; b < 8; b++) this.tone(g, now + c * dur + b * (dur / 8), 0.25, 'sine', 70, 40, 0.25, 0.005);
      }
    }
    g.gain.exponentialRampToValueAtTime(1, now + 1.5);
    g.gain.setValueAtTime(1, now + seq.length * dur - 3);
    g.gain.exponentialRampToValueAtTime(0.0001, now + seq.length * dur);
    this.musicState = {
      kind, g, started: now,
      stop() {
        for (const o of oscs) {
          try {
            o.stop();
          } catch {
            /* ok */
          }
        }
      },
    };
  }
}

export { GUNS };
