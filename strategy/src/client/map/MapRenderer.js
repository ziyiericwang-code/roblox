// WebGL2 world map: province fills, borders and fronts, markers and arrows.
// Rendering happens only when something changed or an animation is running.
import { compile, buffer, vao, dataTexture } from './gl.js';
import { FILL_VS, FILL_FS, BORDER_VS, BORDER_FS, MARKER_VS, MARKER_FS, ARROW_VS, ARROW_FS } from './shaders.js';
import { buildFill, buildBorders, BORDER_STRIDE, PickGrid } from './Geometry.js';

export const STATE_W = 2048;
const Y_MIN = -66;
const Y_MAX = 116;

export class MapRenderer {
  constructor(canvas, world, arcs) {
    this.canvas = canvas;
    this.world = world;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.P = world.P;
    this.lakeId = world.P + world.S;
    this.camera = { x: 10, y: 38, zoom: 4 };
    this.hover = -1;
    this.selected = -1;
    this.terrainMix = 1;
    this.time = 0;
    this.dirty = true;
    this.animating = true;

    const t0 = performance.now();
    this.fill = [buildFill(world, arcs.lod0), buildFill(world, arcs.lod1)];
    this.borders = [buildBorders(world, arcs.lod0), buildBorders(world, arcs.lod1)];
    this.picker = new PickGrid(this.fill[1]);
    this.bounds = this.fill[1].bounds;
    this.buildMs = performance.now() - t0;

    this.progFill = compile(gl, FILL_VS, FILL_FS);
    this.progBorder = compile(gl, BORDER_VS, BORDER_FS);
    this.progMarker = compile(gl, MARKER_VS, MARKER_FS);
    this.progArrow = compile(gl, ARROW_VS, ARROW_FS);

    this.fillVao = this.fill.map((f) => {
      const inter = new Float32Array(f.pos.length / 2 * 3);
      for (let i = 0; i < f.ids.length; i++) {
        inter[i * 3] = f.pos[i * 2];
        inter[i * 3 + 1] = f.pos[i * 2 + 1];
        inter[i * 3 + 2] = f.ids[i];
      }
      const p = this.progFill.program;
      return {
        vao: vao(gl, buffer(gl, inter), [
          { loc: gl.getAttribLocation(p, 'a_pos'), size: 2, offset: 0 },
          { loc: gl.getAttribLocation(p, 'a_id'), size: 1, offset: 2 },
        ], 3, buffer(gl, f.idx, gl.ELEMENT_ARRAY_BUFFER)),
        count: f.idx.length,
      };
    });
    this.borderVao = this.borders.map((b) => {
      const p = this.progBorder.program;
      const L = (n) => gl.getAttribLocation(p, n);
      return {
        vao: vao(gl, buffer(gl, b.verts), [
          { loc: L('a_pos'), size: 2, offset: 0 },
          { loc: L('a_nrm'), size: 2, offset: 2 },
          { loc: L('a_side'), size: 1, offset: 4 },
          { loc: L('a_ids'), size: 2, offset: 5 },
          { loc: L('a_dist'), size: 1, offset: 7 },
        ], BORDER_STRIDE, buffer(gl, b.idx, gl.ELEMENT_ARRAY_BUFFER)),
        count: b.idx.length,
      };
    });

    // province state texture: rows 0..2 (see shaders)
    this.state = new Uint8Array(STATE_W * 4 * 4);
    this.stateTex = dataTexture(gl, STATE_W, 4, this.state);
    this.palette = new Uint8Array(256 * 4);
    this.paletteTex = dataTexture(gl, 256, 1, this.palette);
    this.war = new Uint8Array(256 * 256 * 4);
    this.warTex = dataTexture(gl, 256, 256, this.war);
    for (let p = 0; p < world.P; p++) {
      const c = world.provinces.country[p];
      this.setOwner(p, c, c);
      this.state[(STATE_W + p) * 4] = world.provinces.terrain[p];
    }
    world.countries.forEach((c, i) => this.setColor(i, c.color));
    this.setColor(255, '#3a3f46');
    this.stateDirty = true;
    this.paletteDirty = true;
    this.warDirty = true;

    // markers (instanced)
    this.quadBuf = buffer(gl, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]));
    this.markerData = new Float32Array(0);
    this.markerCount = 0;
    this.markerBuf = gl.createBuffer();
    this.markerVao = this.makeMarkerVao();
    this.atlasTex = null;

    // arrows
    this.arrowBuf = gl.createBuffer();
    this.arrowCount = 0;
    const pa = this.progArrow.program;
    const LA = (n) => gl.getAttribLocation(pa, n);
    this.arrowVao = vao(gl, this.arrowBuf, [
      { loc: LA('a_pos'), size: 2, offset: 0 },
      { loc: LA('a_nrm'), size: 2, offset: 2 },
      { loc: LA('a_w'), size: 1, offset: 4 },
      { loc: LA('a_dist'), size: 1, offset: 5 },
      { loc: LA('a_color'), size: 4, offset: 6 },
    ], 10);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.resize();
  }

  makeMarkerVao() {
    const gl = this.gl;
    const p = this.progMarker.program;
    const L = (n) => gl.getAttribLocation(p, n);
    const v = gl.createVertexArray();
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(L('a_quad'));
    gl.vertexAttribPointer(L('a_quad'), 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.markerBuf);
    const stride = 17 * 4;
    const attrs = [['a_center', 2, 0], ['a_off', 2, 2], ['a_size', 2, 4], ['a_uv', 4, 6], ['a_color', 4, 10], ['a_flags', 1, 14]];
    for (const [n, size, off] of attrs) {
      const loc = L(n);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    return v;
  }

  // ------------------------------------------------------------ state API
  setOwner(p, owner, controller) {
    const o = p * 4;
    this.state[o] = owner;
    this.state[o + 1] = controller;
    this.stateDirty = true;
    this.dirty = true;
  }
  setFog(id, v) {
    this.state[(STATE_W + id) * 4 + 1] = v;
    this.stateDirty = true;
    this.dirty = true;
  }
  setFlags(id, flags) {
    this.state[(STATE_W + id) * 4 + 2] = flags;
    this.stateDirty = true;
    this.dirty = true;
  }
  setModeColor(id, r, g, b, a) {
    const o = (STATE_W * 2 + id) * 4;
    this.state[o] = r;
    this.state[o + 1] = g;
    this.state[o + 2] = b;
    this.state[o + 3] = a;
    this.stateDirty = true;
    this.dirty = true;
  }
  clearModeColors() {
    this.state.fill(0, STATE_W * 2 * 4, STATE_W * 3 * 4);
    this.stateDirty = true;
    this.dirty = true;
  }
  setColor(i, hex) {
    const v = parseInt(hex.slice(1), 16);
    this.palette.set([(v >> 16) & 255, (v >> 8) & 255, v & 255, 255], i * 4);
    this.paletteDirty = true;
    this.dirty = true;
  }
  setWarMatrix(pairs) {
    this.war.fill(0);
    for (const [a, b] of pairs) {
      this.war[(a * 256 + b) * 4] = 255;
      this.war[(b * 256 + a) * 4] = 255;
    }
    this.warDirty = true;
    this.dirty = true;
  }
  setAtlas(canvas) {
    const gl = this.gl;
    this.atlasTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.dirty = true;
  }
  // instances: Float32Array with 17 floats each (center2, off2, size2, uv4, color4, flags1, pad2)
  setMarkers(data, count) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.markerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    this.markerCount = count;
    this.dirty = true;
  }
  setArrows(data, vertexCount) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.arrowBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    this.arrowCount = vertexCount;
    this.dirty = true;
  }

  // ------------------------------------------------------------ camera
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.dpr = dpr;
    this.cssW = w;
    this.cssH = h;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.clampCamera();
    this.dirty = true;
  }
  minZoom() {
    return Math.max(this.cssH / (Y_MAX - Y_MIN), this.cssW / 360) * 0.98;
  }
  clampCamera() {
    const c = this.camera;
    c.zoom = Math.min(260, Math.max(this.minZoom(), c.zoom));
    const halfH = this.cssH / 2 / c.zoom;
    const lo = Y_MIN + halfH;
    const hi = Y_MAX - halfH;
    c.y = lo > hi ? (Y_MIN + Y_MAX) / 2 : Math.min(hi, Math.max(lo, c.y));
    if (c.x > 180) c.x -= 360;
    if (c.x < -180) c.x += 360;
  }
  screenToWorld(sx, sy) {
    const c = this.camera;
    return [c.x + (sx - this.cssW / 2) / c.zoom, c.y - (sy - this.cssH / 2) / c.zoom];
  }
  worldToScreen(wx, wy) {
    const c = this.camera;
    let dx = wx - c.x;
    if (dx > 180) dx -= 360;
    if (dx < -180) dx += 360;
    return [this.cssW / 2 + dx * c.zoom, this.cssH / 2 - (wy - c.y) * c.zoom];
  }
  pick(sx, sy) {
    const [x, y] = this.screenToWorld(sx, sy);
    return this.picker.pick(x, y);
  }
  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.camera.zoom *= factor;
    this.clampCamera();
    const [nx, ny] = this.screenToWorld(sx, sy);
    this.camera.x += wx - nx;
    this.camera.y += wy - ny;
    this.clampCamera();
    this.dirty = true;
  }
  panBy(dxPx, dyPx) {
    this.camera.x -= dxPx / this.camera.zoom;
    this.camera.y += dyPx / this.camera.zoom;
    this.clampCamera();
    this.dirty = true;
  }
  flyTo(x, y, zoom) {
    this.fly = { fx: this.camera.x, fy: this.camera.y, fz: this.camera.zoom, tx: x, ty: y, tz: zoom ?? this.camera.zoom, t: 0 };
    let dx = x - this.camera.x;
    if (dx > 180) this.fly.tx -= 360;
    if (dx < -180) this.fly.tx += 360;
    this.dirty = true;
  }
  regionCenter(id) {
    if (id < this.world.P) return [this.world.wx(id), this.world.wy(id)];
    const b = this.bounds;
    return [(b[id * 4] + b[id * 4 + 2]) / 2, (b[id * 4 + 1] + b[id * 4 + 3]) / 2];
  }

  // ------------------------------------------------------------ frame
  frame(dt) {
    this.time += dt;
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / 0.9);
      const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - (-2 * f.t + 2) ** 2 / 2;
      this.camera.x = f.fx + (f.tx - f.fx) * e;
      this.camera.y = f.fy + (f.ty - f.fy) * e;
      this.camera.zoom = Math.exp(Math.log(f.fz) + (Math.log(f.tz) - Math.log(f.fz)) * e);
      this.clampCamera();
      if (f.t >= 1) this.fly = null;
      this.dirty = true;
    }
    if (!this.dirty && !this.animating) return false;
    this.draw();
    this.dirty = false;
    return true;
  }

  draw() {
    const gl = this.gl;
    if (this.stateDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, STATE_W, 4, gl.RGBA, gl.UNSIGNED_BYTE, this.state);
      this.stateDirty = false;
    }
    if (this.paletteDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.palette);
      this.paletteDirty = false;
    }
    if (this.warDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.warTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, this.war);
      this.warDirty = false;
    }
    const c = this.camera;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.06, 0.09, 0.13, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const lod = c.zoom < 9 ? 0 : 1;
    const halfW = this.cssW / 2 / c.zoom;
    const offsets = [];
    for (const k of [-360, 0, 360]) {
      const minX = -180 + k - 20;
      const maxX = 200 + k;
      if (c.x + halfW >= minX && c.x - halfW <= maxX) offsets.push(k);
    }
    const common = (prog) => {
      gl.useProgram(prog.program);
      gl.uniform2f(prog.u.u_center, c.x, c.y);
      gl.uniform1f(prog.u.u_zoom, c.zoom);
      gl.uniform2f(prog.u.u_view, this.cssW, this.cssH);
      if (prog.u.u_time) gl.uniform1f(prog.u.u_time, this.time);
    };
    // fills
    const pf = this.progFill;
    common(pf);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
    gl.uniform1i(pf.u.u_state, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.uniform1i(pf.u.u_palette, 1);
    gl.uniform1i(pf.u.u_P, this.P);
    gl.uniform1i(pf.u.u_lake, this.lakeId);
    gl.uniform1i(pf.u.u_hover, this.hover);
    gl.uniform1i(pf.u.u_sel, this.selected);
    gl.uniform1f(pf.u.u_terrain, this.terrainMix);
    gl.bindVertexArray(this.fillVao[lod].vao);
    for (const k of offsets) {
      gl.uniform1f(pf.u.u_offset, k);
      gl.drawElements(gl.TRIANGLES, this.fillVao[lod].count, gl.UNSIGNED_INT, 0);
    }
    // borders
    const pb = this.progBorder;
    common(pb);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
    gl.uniform1i(pb.u.u_state, 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.warTex);
    gl.uniform1i(pb.u.u_war, 2);
    gl.uniform1i(pb.u.u_P, this.P);
    gl.uniform1i(pb.u.u_lake, this.lakeId);
    gl.bindVertexArray(this.borderVao[lod].vao);
    for (const k of offsets) {
      gl.uniform1f(pb.u.u_offset, k);
      gl.drawElements(gl.TRIANGLES, this.borderVao[lod].count, gl.UNSIGNED_INT, 0);
    }
    // arrows
    if (this.arrowCount) {
      const pa = this.progArrow;
      common(pa);
      gl.bindVertexArray(this.arrowVao);
      for (const k of offsets) {
        gl.uniform1f(pa.u.u_offset, k);
        gl.drawArrays(gl.TRIANGLES, 0, this.arrowCount);
      }
    }
    // markers
    if (this.markerCount && this.atlasTex) {
      const pm = this.progMarker;
      common(pm);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
      gl.uniform1i(pm.u.u_atlas, 3);
      gl.bindVertexArray(this.markerVao);
      for (const k of offsets) {
        gl.uniform1f(pm.u.u_offset, k);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.markerCount);
      }
    }
    gl.bindVertexArray(null);
  }
}
