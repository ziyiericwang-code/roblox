// Sky dome with time-of-day gradient, sun/moon disc, procedural clouds and stars.
import * as THREE from 'three';

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}`;

const frag = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uCloud;
uniform float uTime;
uniform float uNight;
uniform vec3 uCloudColor;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uGround, smoothstep(0.0, -0.25, h));
  // sun glow and disc
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 8.0) * 0.25 + pow(sd, 256.0) * 1.5) * (1.0 - uCloud * 0.8);
  col += uSunColor * smoothstep(0.9995, 0.9998, sd) * 3.0 * (1.0 - uCloud);
  // stars
  if (uNight > 0.01 && h > 0.0) {
    vec2 sp = d.xz / (d.y + 0.3) * 180.0;
    float st = step(0.9965, hash(floor(sp)));
    col += vec3(st) * uNight * (1.0 - uCloud) * (0.5 + 0.5 * sin(uTime * 3.0 + hash(floor(sp)) * 40.0));
  }
  // clouds on a virtual plane
  if (h > 0.0) {
    vec2 cp = d.xz / (h + 0.08) * 1.6 + vec2(uTime * 0.004, uTime * 0.002);
    float n = fbm(cp);
    float cov = mix(0.72, 0.3, uCloud);
    float c = smoothstep(cov, cov + 0.25, n) * smoothstep(0.0, 0.18, h);
    vec3 cc = uCloudColor * (0.75 + 0.35 * fbm(cp * 2.0 + 3.0));
    cc += uSunColor * pow(sd, 6.0) * 0.35;
    col = mix(col, cc, c * (0.55 + 0.45 * uCloud));
    // overcast veil
    col = mix(col, uCloudColor * 0.9, uCloud * uCloud * 0.55 * smoothstep(0.0, 0.3, h));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class SkyDome {
  constructor() {
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uCloud: { value: 0.2 },
      uTime: { value: 0 },
      uNight: { value: 0 },
      uCloudColor: { value: new THREE.Color(0.9, 0.9, 0.92) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.scale.setScalar(1000);
  }
}
