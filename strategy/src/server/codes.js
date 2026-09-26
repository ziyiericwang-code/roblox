// Human-readable join codes and rate limiting.
import { randomInt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

// No 0/O, 1/I/L or U: easy to read aloud and type.
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 6;
const BLOCK = ['ASS', 'SEX', 'FAG', 'NAZ', 'KKK', 'DMN', 'XXX', 'CNT', 'FCK', 'SHT', 'TWT', 'PNS', 'VAG', 'NGR', 'ANL', 'CUM', 'DCK', 'PSS', 'TTS', 'WTF'];

export function newCode(taken) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let c = '';
    for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (BLOCK.some((b) => c.includes(b))) continue;
    if (taken && taken.has(c)) continue;
    return c;
  }
  throw new Error('Could not allocate a join code');
}

// Normalize user input: uppercase, strip spaces/dashes. Returns null if impossible.
export function normalizeCode(input) {
  if (typeof input !== 'string') return null;
  const c = input.toUpperCase().replace(/[\s-]/g, '');
  if (c.length !== CODE_LENGTH) return null;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
  return c;
}

export const newId = (n = 12) => randomBytes(n).toString('base64url');
export const newSecret = () => randomBytes(24).toString('base64url');
export const hash = (s) => createHash('sha256').update(String(s)).digest('hex');
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Token bucket per key.
export class RateLimiter {
  constructor(rate, burst) {
    this.rate = rate;
    this.burst = burst;
    this.b = new Map();
  }
  take(key, n = 1) {
    const now = Date.now();
    let e = this.b.get(key);
    if (!e) {
      e = { t: this.burst, at: now };
      this.b.set(key, e);
    }
    e.t = Math.min(this.burst, e.t + ((now - e.at) / 1000) * this.rate);
    e.at = now;
    if (e.t < n) return false;
    e.t -= n;
    return true;
  }
}

// Failed join attempts: 5 per window, then an exponentially growing lockout.
export class JoinGuard {
  constructor() {
    this.m = new Map();
  }
  blocked(key) {
    const e = this.m.get(key);
    return !!(e && e.until > Date.now());
  }
  fail(key) {
    const now = Date.now();
    const e = this.m.get(key) || { n: 0, until: 0, level: 0, first: now };
    if (now - e.first > 60000) {
      e.n = 0;
      e.first = now;
    }
    e.n++;
    if (e.n >= 5) {
      e.level++;
      e.until = now + 60000 * 2 ** (e.level - 1);
      e.n = 0;
    }
    this.m.set(key, e);
  }
  ok(key) {
    this.m.delete(key);
  }
}
