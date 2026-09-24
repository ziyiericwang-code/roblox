// Developer world viewer (?viewer): renders the world with a free camera and
// no simulation. Used to check terrain, towns and streaming performance.
// Controls: WASD move, Q/E down/up, mouse drag to look, Shift fast.
import { WORLD_SEED } from '../shared/constants.js';
import { generateWorld } from '../shared/world/layout.js';
import { Renderer } from './render/Renderer.js';
import { WorldScene } from './render/WorldScene.js';

export async function startViewer(root, params) {
  const canvas = document.createElement('canvas');
  canvas.className = 'view';
  root.appendChild(canvas);
  const info = document.createElement('div');
  info.style.cssText = 'position:absolute;left:8px;top:8px;color:#fff;font:12px monospace;background:rgba(0,0,0,.5);padding:6px;white-space:pre;z-index:5';
  root.appendChild(info);
  info.textContent = 'generating world...';
  await new Promise((r) => setTimeout(r, 20));
  const t0 = performance.now();
  const world = generateWorld(WORLD_SEED, { nav: false });
  const genMs = performance.now() - t0;
  const renderer = new Renderer(canvas, params.get('q') || 'medium');
  const scene = new WorldScene(world, renderer);
  const cam = renderer.camera;
  const start = world.tById[params.get('t') || 'aldhaven'];
  const pos = { x: start.x + 120, y: world.terrain.heightAt(start.x + 120, start.z + 160) + 40, z: start.z + 160 };
  let yaw = Math.atan2(-(start.x - pos.x), -(start.z - pos.z));
  let pitch = -0.15;
  const keys = new Set();
  addEventListener('keydown', (e) => keys.add(e.code));
  addEventListener('keyup', (e) => keys.delete(e.code));
  let drag = false;
  canvas.addEventListener('mousedown', () => (drag = true));
  addEventListener('mouseup', () => (drag = false));
  addEventListener('mousemove', (e) => {
    if (!drag) return;
    yaw -= e.movementX * 0.003;
    pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.003));
  });
  const env = { clock: Number(params.get('clock') || 10), cloud: 0.25, fog: 0.04, rain: 0, wind: 0.3 };
  let last = performance.now();
  let time = 0;
  const api = {
    world, renderer, scene, genMs,
    set(x, y, z, yw, pt) {
      pos.x = x;
      pos.y = y ?? world.terrain.heightAt(x, z) + 2;
      pos.z = z;
      if (yw !== undefined) yaw = yw;
      if (pt !== undefined) pitch = pt;
    },
    lookAt(x, y, z) {
      yaw = Math.atan2(-(x - pos.x), -(z - pos.z));
      pitch = Math.atan2(y - pos.y, Math.hypot(x - pos.x, z - pos.z));
    },
    stats() {
      const r = renderer.renderer.info.render;
      return { fps: renderer.fps, calls: r.calls, tris: r.triangles, terrainNodes: scene.terrain.visible.size, terrainCache: scene.terrain.cache.size, chunks: scene.structures.built.size, genMs };
    },
    env,
  };
  window.__viewer = api;
  const frame = (t) => {
    requestAnimationFrame(frame);
    const realDt = Math.min(1, (t - last) / 1000);
    last = t;
    const dt = Math.min(0.1, realDt);
    time += dt;
    const sp = (keys.has('ShiftLeft') ? 180 : 40) * dt;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    if (keys.has('KeyW')) { pos.x += fx * sp; pos.z += fz * sp; }
    if (keys.has('KeyS')) { pos.x -= fx * sp; pos.z -= fz * sp; }
    if (keys.has('KeyA')) { pos.x += fz * sp; pos.z -= fx * sp; }
    if (keys.has('KeyD')) { pos.x -= fz * sp; pos.z += fx * sp; }
    if (keys.has('KeyE')) pos.y += sp;
    if (keys.has('KeyQ')) pos.y -= sp;
    pos.y = Math.max(pos.y, world.terrain.heightAt(pos.x, pos.z) + 1.7);
    cam.position.set(pos.x, pos.y, pos.z);
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
    renderer.updateEnvironment(env, dt, time);
    renderer.updateShadow({ x: pos.x, y: world.terrain.heightAt(pos.x, pos.z), z: pos.z });
    scene.update(cam, dt, time, { wind: env.wind });
    renderer.render();
    renderer.trackFps(realDt);
    const s = api.stats();
    info.textContent = `world ${genMs.toFixed(0)} ms  fps ${s.fps.toFixed(0)}  calls ${s.calls}  tris ${(s.tris / 1000).toFixed(0)}k\nterrain nodes ${s.terrainNodes} (cache ${s.terrainCache})  chunks ${s.chunks}\n${JSON.stringify(world.placeAt(pos.x, pos.z))}`;
  };
  requestAnimationFrame(frame);
  return api;
}
