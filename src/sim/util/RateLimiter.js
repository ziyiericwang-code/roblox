// Token-bucket rate limiting per message type. Protects the simulation from
// floods (accidental or malicious). Limits are generous for legitimate play.
const LIMITS = {
  // type: [ratePerSecond, burst]
  in: [40, 60],
  fire: [22, 30],
  vs: [40, 60],
  vaim: [30, 40],
  vfire: [15, 20],
  ping: [2, 5],
  act: [8, 12],
  gadget: [4, 6],
  throw: [2, 3],
  reload: [3, 5],
  switch: [6, 10],
  deploy: [1, 3],
  squad: [3, 8],
  order: [2, 4],
  ability: [1, 3],
  mission: [3, 6],
  veh: [4, 6],
  emote: [1, 3],
  cosmetic: [3, 6],
  settings: [2, 4],
  training: [4, 8],
  req: [2, 6],
  return: [1, 3],
  default: [5, 10],
};

export class RateLimiter {
  constructor() {
    this.buckets = new Map();
  }
  allow(type, now) {
    const [rate, burst] = LIMITS[type] || LIMITS.default;
    let b = this.buckets.get(type);
    if (!b) {
      b = { tokens: burst, t: now };
      this.buckets.set(type, b);
    }
    b.tokens = Math.min(burst, b.tokens + (now - b.t) * rate);
    b.t = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}
