// Kinematic movement shared by the client (own soldier / driven vehicle
// prediction) and the simulation (AI soldiers, AI vehicles, validation).
import { BODY, MOVE, STANCE, SEA_LEVEL, WORLD_HALF } from './constants.js';
import { clamp, wrapAngle, approach } from './math.js';

export function stanceHeight(stance) {
  return stance === STANCE.PRONE ? BODY.proneHeight : stance === STANCE.CROUCH ? BODY.crouchHeight : BODY.standHeight;
}

export function eyeHeight(stance) {
  return stance === STANCE.PRONE ? BODY.eyeProne : stance === STANCE.CROUCH ? BODY.eyeCrouch : BODY.eyeStand;
}

export function moveSpeed(st) {
  if (st.downed) return MOVE.downed;
  let v;
  if (st.stance === STANCE.PRONE) v = MOVE.prone;
  else if (st.stance === STANCE.CROUCH) v = MOVE.crouch;
  else v = st.sprint ? MOVE.sprint : MOVE.walk;
  if (st.ads && !st.sprint) v *= MOVE.adsMult;
  if (st.carrying) v *= MOVE.carryMult;
  if (st.swimming) v *= MOVE.swimMult;
  return v;
}

// Maximum plausible horizontal speed for validation.
export function maxHorizontalSpeed(stance, downed) {
  if (downed) return MOVE.downed;
  if (stance === STANCE.PRONE) return MOVE.prone;
  if (stance === STANCE.CROUCH) return MOVE.crouch;
  return MOVE.sprint;
}

/**
 * Advance a character one step.
 * s: {x,y,z,vx,vy,vz,yaw,stance,grounded}
 * inp: {fwd,right,sprint,jump,ads,downed,carrying}
 */
export function stepCharacter(s, inp, dt, colliders) {
  const terrain = colliders.terrain;
  const depth = SEA_LEVEL - terrain.heightAt(s.x, s.z);
  const surfaceY = colliders.groundHeight(s.x, s.z, s.y);
  s.swimming = depth > 1.25 && surfaceY < SEA_LEVEL - 1.0 && s.y < SEA_LEVEL - 0.6;
  const speed = moveSpeed({ ...inp, stance: s.stance, swimming: s.swimming });
  let fx = inp.fwd || 0;
  let rx = inp.right || 0;
  const l = Math.hypot(fx, rx);
  if (l > 1) {
    fx /= l;
    rx /= l;
  }
  const sy = Math.sin(s.yaw);
  const cy = Math.cos(s.yaw);
  // forward (-sin, -cos), right (cos, -sin)
  const wx = -sy * fx + cy * rx;
  const wz = -cy * fx - sy * rx;
  const accel = s.grounded || s.swimming ? MOVE.accelGround : MOVE.accelAir;
  const k = Math.min(1, accel * dt);
  s.vx += (wx * speed - s.vx) * k;
  s.vz += (wz * speed - s.vz) * k;
  if (inp.jump && s.grounded && s.stance === STANCE.STAND && !inp.downed) {
    s.vy = MOVE.jumpVel;
    s.grounded = false;
  }
  if (s.swimming) {
    s.vy = approach(s.vy, (SEA_LEVEL - 1.15 - s.y) * 3, 20 * dt);
  } else if (!s.grounded) {
    s.vy -= MOVE.gravity * dt;
  }
  const h = stanceHeight(s.stance);
  // horizontal move + collision
  const pos = { x: s.x + s.vx * dt, y: s.y, z: s.z + s.vz * dt };
  colliders.resolveCylinder(pos, BODY.radius, h);
  // actual velocity after collisions (so we don't keep pushing into walls)
  if (dt > 0) {
    s.vx = (pos.x - s.x) / dt;
    s.vz = (pos.z - s.z) / dt;
  }
  s.x = clamp(pos.x, -WORLD_HALF + 2, WORLD_HALF - 2);
  s.z = clamp(pos.z, -WORLD_HALF + 2, WORLD_HALF - 2);
  // vertical
  let ny = s.y + s.vy * dt;
  if (s.vy > 0) {
    const ceil = colliders.ceilingAbove(s.x, s.z, s.y + 0.2);
    if (ny + h > ceil) {
      ny = Math.max(s.y, ceil - h);
      s.vy = 0;
    }
  }
  const ground = colliders.groundHeight(s.x, s.z, Math.max(s.y, ny));
  if (ny <= ground) {
    ny = ground;
    if (s.vy < 0) s.landVel = s.vy;
    s.vy = 0;
    s.grounded = true;
  } else if (s.grounded && s.vy <= 0 && ny - ground < BODY.stepHeight + 0.05) {
    ny = ground; // stick to slopes and stairs going down
    s.vy = 0;
  } else if (!s.swimming) {
    s.grounded = false;
  }
  if (s.swimming) s.grounded = false;
  s.y = ny;
  return s;
}

// ------------------------------------------------------------------ vehicles

/**
 * Arcade vehicle step. v: {type-def in v.def, x,y,z,yaw,pitch,roll,speed,vy,vs(strafe), alt}
 * inp: {throttle (-1..1), steer (-1..1), up (-1..1)}
 */
export function stepVehicle(v, inp, dt, colliders) {
  const d = v.def;
  const terrain = colliders.terrain;
  const throttle = clamp(inp.throttle || 0, -1, 1);
  const steer = clamp(inp.steer || 0, -1, 1);
  if (d.air) return stepAir(v, inp, dt, colliders);
  const target = throttle >= 0 ? throttle * d.maxSpeed : throttle * d.reverseSpeed;
  const drag = throttle === 0 ? d.accel * 0.6 : d.accel;
  v.speed = approach(v.speed, target, drag * dt * (Math.sign(target - v.speed) !== Math.sign(v.speed) && v.speed !== 0 ? 1.8 : 1));
  const turnFactor = d.tracked ? 1 : clamp(Math.abs(v.speed) / 6, 0, 1);
  const dir = v.speed < -0.1 ? -1 : 1;
  v.yaw = wrapAngle(v.yaw - steer * d.turnRate * turnFactor * dir * dt);
  const fx = -Math.sin(v.yaw);
  const fz = -Math.cos(v.yaw);
  let nx = v.x + fx * v.speed * dt;
  let nz = v.z + fz * v.speed * dt;
  // collision: two circles along the hull
  const hw = d.halfSize[0];
  const hl = d.halfSize[2];
  let bumped = false;
  for (const off of [-hl + hw, hl - hw]) {
    const cx = nx + fx * off;
    const cz = nz + fz * off;
    const p = { x: cx, y: v.y - 0.4, z: cz };
    if (colliders.resolveCylinder(p, hw, d.halfSize[1] * 1.6, 1.0)) {
      nx += p.x - cx;
      nz += p.z - cz;
      bumped = true;
    }
  }
  if (bumped) {
    v.impact = Math.max(v.impact || 0, Math.abs(v.speed));
    v.speed *= 0.55;
  }
  nx = clamp(nx, -WORLD_HALF + 4, WORLD_HALF - 4);
  nz = clamp(nz, -WORLD_HALF + 4, WORLD_HALF - 4);
  v.x = nx;
  v.z = nz;
  if (d.water) {
    const depth = SEA_LEVEL - terrain.heightAt(v.x + fx * hl, v.z + fz * hl);
    if (depth < 0.5) {
      // beached: push back and stop
      v.x -= fx * v.speed * dt;
      v.z -= fz * v.speed * dt;
      v.speed = 0;
    }
    v.y = SEA_LEVEL + d.rideHeight;
    v.pitch = approach(v.pitch || 0, -v.speed * 0.006, dt);
    v.roll = approach(v.roll || 0, steer * v.speed * 0.01, dt);
    return v;
  }
  // wheels / tracks: sample ground at four corners
  const rx = Math.cos(v.yaw);
  const rz = -Math.sin(v.yaw);
  const probe = (a, b) => {
    const px = v.x + fx * a + rx * b;
    const pz = v.z + fz * a + rz * b;
    return colliders.groundHeight(px, pz, v.y - d.rideHeight + 0.2, 0.3, 0.9);
  };
  const fl = probe(hl * 0.8, -hw * 0.8);
  const fr = probe(hl * 0.8, hw * 0.8);
  const bl = probe(-hl * 0.8, -hw * 0.8);
  const br = probe(-hl * 0.8, hw * 0.8);
  const ground = (fl + fr + bl + br) / 4;
  const targetY = ground + d.rideHeight;
  if (v.y > targetY + 0.3) {
    v.vy = (v.vy || 0) - 20 * dt;
    v.y = Math.max(targetY, v.y + v.vy * dt);
    if (v.y <= targetY) {
      v.landVel = v.vy;
      v.vy = 0;
    }
  } else {
    v.y = targetY;
    v.vy = 0;
  }
  const tp = Math.atan2((fl + fr) / 2 - (bl + br) / 2, hl * 1.6);
  const tr = Math.atan2((fl + bl) / 2 - (fr + br) / 2, hw * 1.6);
  v.pitch = approach(v.pitch || 0, clamp(tp, -0.6, 0.6), dt * 3);
  v.roll = approach(v.roll || 0, clamp(tr, -0.6, 0.6), dt * 3);
  // slopes slow vehicles down
  v.speed -= Math.sin(v.pitch) * 4.5 * dt;
  // water: ground vehicles flood
  const depth = SEA_LEVEL - terrain.heightAt(v.x, v.z);
  v.flooded = depth > 1.3 && ground < SEA_LEVEL;
  if (v.flooded) v.speed = clamp(v.speed, -2, 2);
  return v;
}

function stepAir(v, inp, dt, colliders) {
  const d = v.def;
  const terrain = colliders.terrain;
  const throttle = clamp(inp.throttle || 0, -1, 1);
  const steer = clamp(inp.steer || 0, -1, 1);
  const up = clamp(inp.up || 0, -1, 1);
  const ground = Math.max(colliders.groundHeight(v.x, v.z, v.y + 0.5, 1.2, 1.0), SEA_LEVEL);
  const landed = v.y <= ground + d.halfSize[1] * 0.2 + 0.3;
  if (!v.engine) {
    // unpowered: fall
    v.vy = (v.vy || 0) - 14 * dt;
    v.speed = approach(v.speed, 0, 4 * dt);
  } else {
    v.vy = approach(v.vy || 0, up * d.climbRate, 10 * dt);
    const target = throttle >= 0 ? throttle * d.maxSpeed : throttle * d.reverseSpeed;
    if (!landed || up > 0) v.speed = approach(v.speed, target, d.accel * dt);
    else v.speed = approach(v.speed, 0, d.accel * 2 * dt);
    v.yaw = wrapAngle(v.yaw - steer * d.turnRate * dt);
  }
  const fx = -Math.sin(v.yaw);
  const fz = -Math.cos(v.yaw);
  v.x = clamp(v.x + fx * v.speed * dt, -WORLD_HALF + 4, WORLD_HALF - 4);
  v.z = clamp(v.z + fz * v.speed * dt, -WORLD_HALF + 4, WORLD_HALF - 4);
  let ny = v.y + v.vy * dt;
  const g2 = Math.max(colliders.groundHeight(v.x, v.z, ny + 0.5, 1.2, 1.0), SEA_LEVEL);
  const minY = g2 + 0.1;
  if (ny < minY) {
    v.landVel = v.vy;
    ny = minY;
    v.vy = Math.max(0, v.vy);
  }
  ny = Math.min(ny, terrain.heightAt(v.x, v.z) + d.maxAltitude);
  v.y = ny;
  v.pitch = approach(v.pitch || 0, clamp(-v.speed / d.maxSpeed * 0.28 - throttle * 0.08, -0.4, 0.3), dt * 1.5);
  v.roll = approach(v.roll || 0, steer * 0.3 * clamp(Math.abs(v.speed) / 10, 0.2, 1), dt * 2);
  // obstacle collision (buildings)
  const p = { x: v.x, y: v.y - 1, z: v.z };
  if (colliders.resolveCylinder(p, d.halfSize[0] * 1.4, 2.5, 0.2)) {
    v.impact = Math.max(v.impact || 0, Math.abs(v.speed));
    v.x = p.x;
    v.z = p.z;
    v.speed *= 0.3;
  }
  return v;
}

// World-space position of a seat offset.
export function seatWorld(v, off) {
  const sy = Math.sin(v.yaw);
  const cy = Math.cos(v.yaw);
  // local +x right = (cos, -sin), local -z forward = (-sin, -cos)
  const x = v.x + off[0] * cy + off[2] * sy;
  const z = v.z - off[0] * sy + off[2] * cy;
  return { x, y: v.y + off[1] - (v.def.ground ? v.def.rideHeight : 0), z };
}
