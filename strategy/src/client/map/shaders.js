// GLSL for the map layers.
import { NOISE_GLSL } from './gl.js';

const VIEW = `
uniform vec2 u_center; uniform float u_zoom; uniform vec2 u_view; uniform float u_offset;
vec4 toClip(vec2 w){ return vec4((w - u_center) * u_zoom / (u_view * 0.5), 0.0, 1.0); }
`;

export const FILL_VS = `#version 300 es
in vec2 a_pos; in float a_id;
${VIEW}
out vec2 v_world; flat out int v_id;
void main(){ vec2 w = a_pos + vec2(u_offset, 0.0); v_world = w; v_id = int(a_id + 0.5); gl_Position = toClip(w); }
`;

export const FILL_FS = `#version 300 es
precision highp float;
flat in int v_id; in vec2 v_world;
uniform sampler2D u_state; uniform sampler2D u_palette;
uniform int u_P; uniform int u_lake; uniform float u_time; uniform float u_zoom;
uniform int u_hover; uniform int u_sel; uniform float u_terrain;
out vec4 o;
${NOISE_GLSL}
vec3 terrainTint(int t, vec2 w, vec3 base){
  float n1 = fbm(w * 1.1);
  float n2 = vnoise(w * 5.0) * 0.6 + vnoise(w * 13.0) * 0.4;
  vec3 c = base; float shade = 0.0;
  if (t == 4) { float r = 1.0 - abs(fbm(w * 1.8) * 2.0 - 1.0); shade = (r - 0.55) * 0.42; c = mix(c, vec3(0.6, 0.57, 0.52), 0.22); }
  else if (t == 3) { shade = (fbm(w * 2.4) - 0.5) * 0.22; c = mix(c, vec3(0.6, 0.6, 0.5), 0.06); }
  else if (t == 1) { shade = (n2 - 0.5) * 0.09 - 0.05; c = mix(c, vec3(0.22, 0.38, 0.24), 0.16); }
  else if (t == 2) { shade = (n2 - 0.5) * 0.1 - 0.07; c = mix(c, vec3(0.12, 0.33, 0.18), 0.24); }
  else if (t == 5) { shade = (n1 - 0.5) * 0.12 + 0.04; c = mix(c, vec3(0.86, 0.76, 0.56), 0.28); }
  else if (t == 6) { shade = (n2 - 0.5) * 0.08; c = mix(c, vec3(0.32, 0.48, 0.44), 0.2); }
  else if (t == 7) { c = mix(c, vec3(0.76, 0.79, 0.77), 0.32); shade = (n1 - 0.5) * 0.08; }
  else if (t == 8) { c = mix(c, vec3(0.93, 0.95, 0.97), 0.6); shade = (n1 - 0.5) * 0.05; }
  else { shade = (n1 - 0.5) * 0.07; }
  return mix(base, c * (1.0 + shade), u_terrain);
}
void main(){
  vec4 s1 = texelFetch(u_state, ivec2(v_id, 1), 0);
  vec4 s2 = texelFetch(u_state, ivec2(v_id, 2), 0);
  if (v_id >= u_P) {
    float n = fbm(v_world * 0.3 + vec2(u_time * 0.01, 0.0));
    vec3 deep = vec3(0.075, 0.115, 0.17);
    vec3 shallow = vec3(0.12, 0.19, 0.27);
    vec3 c = mix(deep, shallow, n * 0.8);
    float sh = vnoise(v_world * 2.5 + vec2(u_time * 0.08, u_time * 0.05));
    c += (sh - 0.5) * 0.018;
    if (v_id == u_lake) c = vec3(0.17, 0.26, 0.35);
    c = mix(c, s2.rgb, s2.a);
    if (v_id == u_hover) c += vec3(0.035, 0.05, 0.07);
    if (v_id == u_sel) c += vec3(0.06, 0.08, 0.1);
    o = vec4(c, 1.0);
    return;
  }
  vec4 s0 = texelFetch(u_state, ivec2(v_id, 0), 0);
  int owner = int(s0.r * 255.0 + 0.5);
  int ctrl = int(s0.g * 255.0 + 0.5);
  vec3 base = texelFetch(u_palette, ivec2(owner, 0), 0).rgb;
  vec3 cc = texelFetch(u_palette, ivec2(ctrl, 0), 0).rgb;
  int t = int(s1.r * 255.0 + 0.5);
  vec3 col = terrainTint(t, v_world, base);
  if (ctrl != owner) {
    float st = step(0.5, fract((v_world.x + v_world.y) * u_zoom / 10.0));
    col = mix(col, terrainTint(t, v_world, cc), st * 0.9);
  }
  col = mix(col, s2.rgb, s2.a);
  float fog = s1.g;
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(col, vec3(lum) * 0.62 + vec3(0.02, 0.03, 0.05), fog * 0.75);
  int flags = int(s1.b * 255.0 + 0.5);
  if ((flags & 2) != 0) col = mix(col, vec3(0.95, 0.45, 0.2), 0.10 + 0.07 * sin(u_time * 3.0));
  if ((flags & 4) != 0) col = mix(col, vec3(0.7, 0.2, 0.2), 0.18);
  if ((flags & 8) != 0) col = mix(col, vec3(1.0, 0.85, 0.45), 0.16);
  if (v_id == u_hover) col = mix(col, vec3(1.0), 0.13);
  if (v_id == u_sel) col = mix(col, vec3(1.0, 0.92, 0.7), 0.26);
  o = vec4(col, 1.0);
}
`;

export const BORDER_VS = `#version 300 es
in vec2 a_pos; in vec2 a_nrm; in float a_side; in vec2 a_ids; in float a_dist;
${VIEW}
uniform sampler2D u_state; uniform sampler2D u_war; uniform int u_P; uniform int u_lake;
out float v_side; out float v_dist; out float v_w; flat out int v_kind;
void main(){
  int a = int(a_ids.x + 0.5); int b = int(a_ids.y + 0.5);
  int kind = 1;
  if (a >= u_P && b >= u_P) kind = (a == u_lake || b == u_lake) ? 6 : 4;
  else if (a >= u_P || b >= u_P) kind = (a == u_lake || b == u_lake) ? 6 : 3;
  else {
    vec4 sa = texelFetch(u_state, ivec2(a, 0), 0);
    vec4 sb = texelFetch(u_state, ivec2(b, 0), 0);
    int oa = int(sa.r * 255.0 + 0.5); int ob = int(sb.r * 255.0 + 0.5);
    int ca = int(sa.g * 255.0 + 0.5); int cb = int(sb.g * 255.0 + 0.5);
    float war = texelFetch(u_war, ivec2(ca, cb), 0).r;
    if (war > 0.5 && ca != cb) kind = 5;
    else if (ca != cb || oa != ob) kind = 2;
    else kind = 1;
  }
  float w = 0.7;
  if (kind == 2) w = 1.7; else if (kind == 3) w = 1.15; else if (kind == 4) w = 0.9; else if (kind == 5) w = 3.4; else if (kind == 6) w = 0.9;
  w *= clamp(0.75 + u_zoom / 40.0, 0.75, 1.6);
  v_kind = kind; v_w = w; v_side = a_side; v_dist = a_dist;
  vec2 p = a_pos + vec2(u_offset, 0.0) + a_nrm * a_side * (w * 0.5 + 1.0) / u_zoom;
  gl_Position = toClip(p);
}
`;

export const BORDER_FS = `#version 300 es
precision highp float;
in float v_side; in float v_dist; in float v_w; flat in int v_kind;
uniform float u_zoom; uniform float u_time;
out vec4 o;
void main(){
  float px = abs(v_side) * (v_w * 0.5 + 1.0);
  float a = 1.0 - smoothstep(v_w * 0.5 - 0.5, v_w * 0.5 + 0.5, px);
  vec3 c; float alpha;
  if (v_kind == 1) { c = vec3(0.1, 0.1, 0.12); alpha = 0.34 * smoothstep(2.0, 7.0, u_zoom); }
  else if (v_kind == 2) { c = vec3(0.07, 0.07, 0.09); alpha = 0.85; }
  else if (v_kind == 3) { c = vec3(0.06, 0.09, 0.13); alpha = 0.8; }
  else if (v_kind == 4) { c = vec3(0.35, 0.47, 0.6); alpha = 0.16 * smoothstep(1.5, 4.0, u_zoom) * step(0.5, fract(v_dist * u_zoom / 10.0)); }
  else if (v_kind == 6) { c = vec3(0.1, 0.15, 0.2); alpha = 0.6; }
  else {
    float dash = fract(v_dist * u_zoom / 16.0 - u_time * 0.9);
    c = mix(vec3(0.62, 0.1, 0.08), vec3(1.0, 0.55, 0.22), smoothstep(0.35, 0.65, dash) * (1.0 - smoothstep(0.75, 0.95, dash)));
    float core = 1.0 - smoothstep(0.0, v_w * 0.5, px);
    c = mix(c, vec3(1.0, 0.85, 0.6), core * 0.25);
    alpha = 0.95;
  }
  o = vec4(c, alpha * a);
  if (o.a < 0.01) discard;
}
`;

export const MARKER_VS = `#version 300 es
in vec2 a_quad;
in vec2 a_center; in vec2 a_off; in vec2 a_size; in vec4 a_uv; in vec4 a_color; in float a_flags;
${VIEW}
uniform float u_time;
out vec2 v_uv; out vec4 v_color; flat out float v_flags; out vec2 v_q;
void main(){
  float pulse = (mod(a_flags, 4.0) >= 2.0) ? 1.0 + 0.12 * sin(u_time * 5.0) : 1.0;
  vec2 w = a_center + vec2(u_offset, 0.0);
  vec4 c = toClip(w);
  vec2 px = (a_off + (a_quad - 0.5) * a_size * pulse);
  c.xy += px / (u_view * 0.5) * vec2(1.0, -1.0);
  gl_Position = c;
  v_uv = mix(a_uv.xy, a_uv.zw, a_quad);
  v_color = a_color; v_flags = a_flags; v_q = a_quad;
}
`;

export const MARKER_FS = `#version 300 es
precision highp float;
in vec2 v_uv; in vec4 v_color; flat in float v_flags; in vec2 v_q;
uniform sampler2D u_atlas;
out vec4 o;
void main(){
  vec4 t = texture(u_atlas, v_uv);
  // atlas convention: red channel = tintable fill mask, green = white detail, blue = dark detail, alpha = coverage
  vec3 col = v_color.rgb * t.r + vec3(1.0) * t.g + vec3(0.06) * t.b;
  float a = t.a * v_color.a;
  if (mod(v_flags, 2.0) >= 1.0) { col = v_color.rgb; a = v_color.a * step(0.0, v_q.x); }
  o = vec4(col, a);
  if (o.a < 0.01) discard;
}
`;

export const ARROW_VS = `#version 300 es
in vec2 a_pos; in vec2 a_nrm; in float a_w; in float a_dist; in vec4 a_color;
${VIEW}
out float v_dist; out vec4 v_color; out float v_edge;
void main(){
  vec2 p = a_pos + vec2(u_offset, 0.0) + a_nrm * a_w / u_zoom;
  gl_Position = toClip(p);
  v_dist = a_dist; v_color = a_color; v_edge = sign(a_w);
}
`;

export const ARROW_FS = `#version 300 es
precision highp float;
in float v_dist; in vec4 v_color; in float v_edge;
uniform float u_time; uniform float u_zoom;
out vec4 o;
void main(){
  float flow = fract(v_dist * u_zoom / 22.0 - u_time * 0.8);
  float glow = 0.82 + 0.18 * smoothstep(0.2, 0.5, flow) * (1.0 - smoothstep(0.5, 0.8, flow));
  o = vec4(v_color.rgb * glow, v_color.a);
}
`;
