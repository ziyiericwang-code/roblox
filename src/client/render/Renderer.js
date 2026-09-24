// Renderer: WebGL setup, quality presets, dynamic resolution, lighting,
// shadows following the camera, fog and sky driven by time/weather.
import * as THREE from 'three';
import { SkyDome } from './Sky.js';
import { clamp, lerp, smoothstep } from '../../shared/math.js';

export const QUALITY = {
  low: { pixelRatio: 0.75, shadows: 0, draw: 420, trees: 0.45, particles: 0.5, terrainStep: 2, antialias: false, lights: 2 },
  medium: { pixelRatio: 1.0, shadows: 1024, draw: 650, trees: 0.75, particles: 0.8, terrainStep: 1, antialias: true, lights: 4 },
  high: { pixelRatio: 1.5, shadows: 2048, draw: 950, trees: 1, particles: 1, terrainStep: 1, antialias: true, lights: 6 },
  ultra: { pixelRatio: 2, shadows: 4096, draw: 1300, trees: 1, particles: 1.2, terrainStep: 1, antialias: true, lights: 8 },
};

export function detectQuality() {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
  if (mobile) return 'low';
  const cores = navigator.hardwareConcurrency || 4;
  return cores >= 8 ? 'high' : 'medium';
}

export class Renderer {
  constructor(canvas, qualityName) {
    this.qualityName = QUALITY[qualityName] ? qualityName : detectQuality();
    this.q = QUALITY[this.qualityName];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.q.antialias, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.q.shadows > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, this.q.draw + 300);
    this.scene.add(this.camera);
    this.dynScale = 1;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.lowFpsTime = 0;
    this.fps = 60;

    // lights
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x4a4030, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = this.q.shadows > 0;
    if (this.q.shadows) {
      this.sun.shadow.mapSize.set(this.q.shadows, this.q.shadows);
      const ext = this.q.shadows >= 4096 ? 90 : 65;
      const cam = this.sun.shadow.camera;
      cam.left = -ext;
      cam.right = ext;
      cam.top = ext;
      cam.bottom = -ext;
      cam.near = 1;
      cam.far = 600;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.04;
      this.shadowExt = ext;
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.sky = new SkyDome();
    this.scene.add(this.sky.mesh);
    this.scene.fog = new THREE.FogExp2(0xaabbcc, 0.0012);
    this.env = { clock: 10, cloud: 0.2, fog: 0.05, rain: 0, flash: 0 };
    this.sunDir = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
    this.daylight = 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(name) {
    if (!QUALITY[name]) return;
    this.qualityName = name;
    this.q = QUALITY[name];
    this.camera.far = this.q.draw + 300;
    this.camera.updateProjectionMatrix();
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(Math.min(dpr, this.q.pixelRatio) * this.dynScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Dynamic resolution keeps the frame rate playable on weaker devices; if that is
  // not enough, shadows are switched off. `realDt` is the unclamped frame time.
  trackFps(realDt) {
    this.fpsAcc += realDt;
    this.fpsFrames++;
    if (this.fpsAcc >= 1) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      if (this.fps < 38) this.lowFpsTime++;
      else this.lowFpsTime = Math.max(0, this.lowFpsTime - 1);
      if (this.lowFpsTime >= 3 && this.dynScale > 0.55) {
        this.dynScale = Math.max(0.55, this.dynScale - 0.1);
        this.lowFpsTime = 0;
        this.resize();
      } else if (this.lowFpsTime >= 4 && this.fps < 28 && this.sun.castShadow) {
        this.sun.castShadow = false;
        this.renderer.shadowMap.enabled = false;
        this.lowFpsTime = 0;
      } else if (this.fps > 57 && this.dynScale < 1) {
        this.dynScale = Math.min(1, this.dynScale + 0.05);
        this.resize();
      }
    }
  }

  // Update lighting from world state {clock, cloud, fog, rain}.
  updateEnvironment(ws, dt, time) {
    const e = this.env;
    if (ws) {
      e.clock = ws.clock;
      e.cloud = lerp(e.cloud, ws.cloud, Math.min(1, dt * 0.5));
      e.fog = lerp(e.fog, ws.fog, Math.min(1, dt * 0.5));
      e.rain = lerp(e.rain, ws.rain, Math.min(1, dt * 0.5));
    }
    e.flash = Math.max(0, e.flash - dt * 3);
    const c = e.clock;
    // sun path: rises east (+x) ~6h, sets west ~18h, slightly south (+z)
    const ang = ((c - 6) / 12) * Math.PI;
    const elev = Math.sin(ang);
    this.sunDir.set(Math.cos(ang), Math.max(-0.35, elev) * 0.9, 0.38).normalize();
    const day = smoothstep(-0.08, 0.25, elev);
    const golden = smoothstep(0.35, 0.02, Math.abs(elev)) * day;
    this.daylight = day;
    const overcast = e.cloud;
    const sky = this.sky.uniforms;
    const zenithDay = new THREE.Color().setRGB(0.18, 0.36, 0.72);
    const horizonDay = new THREE.Color().setRGB(0.62, 0.72, 0.85);
    const zenithNight = new THREE.Color().setRGB(0.005, 0.01, 0.03);
    const horizonNight = new THREE.Color().setRGB(0.03, 0.05, 0.09);
    const horizonGold = new THREE.Color().setRGB(0.95, 0.52, 0.28);
    const grey = new THREE.Color().setRGB(0.5, 0.53, 0.57);
    const zen = zenithNight.clone().lerp(zenithDay, day).lerp(grey.clone().multiplyScalar(0.8 * Math.max(0.12, day)), overcast * 0.85);
    const hor = horizonNight.clone().lerp(horizonDay, day).lerp(horizonGold, golden * (1 - overcast * 0.7)).lerp(grey.clone().multiplyScalar(Math.max(0.1, day)), overcast * 0.8);
    sky.uZenith.value.copy(zen);
    sky.uHorizon.value.copy(hor);
    sky.uGround.value.copy(hor).multiplyScalar(0.45);
    const sunCol = new THREE.Color().setRGB(1, 0.93, 0.82).lerp(new THREE.Color().setRGB(1, 0.55, 0.3), golden);
    sky.uSunColor.value.copy(sunCol).multiplyScalar(day);
    sky.uCloud.value = overcast;
    sky.uNight.value = 1 - day;
    sky.uTime.value = time;
    sky.uCloudColor.value.setRGB(0.85, 0.86, 0.9).multiplyScalar(0.15 + 0.85 * day).lerp(new THREE.Color(0.5, 0.52, 0.56).multiplyScalar(0.2 + 0.8 * day), overcast * 0.6);
    if (elev > -0.1) sky.uSunDir.value.copy(this.sunDir);
    else sky.uSunDir.value.set(-this.sunDir.x, Math.abs(this.sunDir.y), -this.sunDir.z);
    // lights
    const sunI = day * 2.8 * (1 - overcast * 0.65) + (1 - day) * 0.22;
    this.sun.intensity = sunI;
    if (day > 0.05) this.sun.color.copy(sunCol);
    else this.sun.color.setRGB(0.55, 0.65, 0.9);
    this.hemi.intensity = 0.25 + day * (0.75 + overcast * 0.45) + e.flash * 2;
    this.hemi.color.copy(zen).lerp(new THREE.Color(1, 1, 1), 0.35 + 0.2 * day);
    this.hemi.groundColor.setRGB(0.24, 0.2, 0.15).multiplyScalar(0.3 + 0.7 * day);
    // fog
    const fogCol = hor.clone().lerp(grey.clone().multiplyScalar(0.25 + 0.6 * day), Math.max(e.fog, overcast * 0.5));
    this.scene.fog.color.copy(fogCol);
    const baseDensity = 1.9 / this.q.draw;
    this.scene.fog.density = baseDensity + e.fog * 0.0055 + e.rain * 0.0012 + (1 - day) * 0.0004;
    this.renderer.toneMappingExposure = 0.95 + (1 - day) * 0.35;
  }

  // Shadow camera follows the focus point, snapped to texels to avoid shimmer.
  updateShadow(focus) {
    if (!this.sun.castShadow) return;
    const d = this.sunDir;
    const ext = this.shadowExt;
    const texel = (ext * 2) / this.q.shadows;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    const L = d.y > 0.05 ? d : new THREE.Vector3(-d.x, 0.3, -d.z).normalize();
    this.sun.position.set(fx + L.x * 300, focus.y + L.y * 300, fz + L.z * 300);
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  render() {
    this.sky.mesh.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}

export { clamp };
