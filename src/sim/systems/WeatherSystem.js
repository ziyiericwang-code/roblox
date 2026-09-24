// Day/night cycle and weather. Server authoritative so every player sees the
// same conditions; weather also affects AI detection range (visibility).
import { GAME } from '../../shared/config/game.js';
import { MSG } from '../../shared/protocol.js';
import { Rng, clamp, approach } from '../../shared/math.js';

const PRESETS = {
  clear: { cloud: 0.15, fog: 0.05, rain: 0, wind: 0.2 },
  cloudy: { cloud: 0.5, fog: 0.1, rain: 0, wind: 0.35 },
  overcast: { cloud: 0.85, fog: 0.2, rain: 0, wind: 0.45 },
  rain: { cloud: 0.95, fog: 0.3, rain: 0.7, wind: 0.6 },
  storm: { cloud: 1, fog: 0.35, rain: 1, wind: 0.95 },
  fog: { cloud: 0.6, fog: 0.8, rain: 0, wind: 0.1 },
};

const NEXT = {
  clear: [['clear', 3], ['cloudy', 3], ['fog', 0.7]],
  cloudy: [['clear', 2], ['overcast', 2.5], ['cloudy', 1]],
  overcast: [['rain', 2.5], ['cloudy', 2], ['fog', 0.8]],
  rain: [['overcast', 2], ['storm', 1], ['rain', 1]],
  storm: [['rain', 3], ['overcast', 1]],
  fog: [['clear', 2], ['cloudy', 2]],
};

export class WeatherSystem {
  constructor(game) {
    this.game = game;
    this.rng = new Rng(2024);
    this.clock = GAME.startClock;
    this.type = 'clear';
    this.cur = { ...PRESETS.clear };
    this.nextChangeAt = 300;
    this.sendTimer = 0;
    this.version = 1;
    this.nextThunder = 0;
  }

  init() {
    // Start each server at a pleasant time of day with mild weather.
    this.clock = GAME.startClock + this.rng.float(-1, 2);
    this.type = this.rng.pick(['clear', 'cloudy', 'clear']);
    this.cur = { ...PRESETS[this.type] };
  }

  update(dt) {
    const g = this.game;
    this.clock = (this.clock + (24 / GAME.dayLengthSec) * dt) % 24;
    const target = PRESETS[this.type];
    for (const k of Object.keys(target)) this.cur[k] = approach(this.cur[k], target[k], dt / 70);
    if (g.time >= this.nextChangeAt) {
      this.nextChangeAt = g.time + this.rng.float(240, 480);
      const opts = NEXT[this.type].map(([v, w]) => ({ v, w }));
      // fog is most likely around dawn
      if (this.clock > 4.5 && this.clock < 8) opts.push({ v: 'fog', w: 1.5 });
      const nt = this.rng.weighted(opts);
      if (nt !== this.type) {
        this.type = nt;
        this.version++;
        if (nt === 'storm') g.radio(1, 'system', 'Met Office', 'Storm front moving in. Expect heavy rain and poor visibility.');
        if (nt === 'fog') g.radio(1, 'system', 'Met Office', 'Dense fog rolling across the valleys.');
      }
    }
    if (this.cur.rain > 0.85 && g.time > this.nextThunder) {
      this.nextThunder = g.time + this.rng.float(15, 45);
      g.emit(['thunder', Math.round(this.rng.float(-600, 600)), Math.round(this.rng.float(-600, 600))], {});
    }
    this.sendTimer += dt;
    if (this.sendTimer >= 5) {
      this.sendTimer = 0;
      const msg = { t: MSG.WORLDSTATE, ...this.view() };
      for (const s of g.sessions) if (s.profile) s.send(msg);
    }
  }

  daylight() {
    const c = this.clock;
    if (c < 5 || c > 20.5) return 0;
    if (c < 7) return (c - 5) / 2;
    if (c > 18.5) return (20.5 - c) / 2;
    return 1;
  }

  // 0..1 multiplier on how far soldiers can see (AI detection).
  visibility() {
    const light = 0.5 + 0.5 * this.daylight();
    return clamp(light * (1 - this.cur.fog * 0.5) * (1 - this.cur.rain * 0.22), 0.3, 1);
  }

  view() {
    return {
      clock: Math.round(this.clock * 100) / 100,
      type: this.type,
      cloud: round2(this.cur.cloud),
      fog: round2(this.cur.fog),
      rain: round2(this.cur.rain),
      wind: round2(this.cur.wind),
      daySec: GAME.dayLengthSec,
    };
  }
}

function round2(v) {
  return Math.round(v * 100) / 100;
}
