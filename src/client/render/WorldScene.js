// The static world as seen by the renderer: LOD terrain, water, roads and
// rails, streamed structures and vegetation. Shared by the game client and
// the developer world viewer.
import { buildAtlas, buildTerrainDetail } from './Textures.js';
import { buildWater } from './TerrainMesh.js';
import { TerrainLOD } from './TerrainLOD.js';
import { RoadMesh } from './RoadMesh.js';
import { StructureMesh } from './StructureMesh.js';
import { Vegetation } from './Vegetation.js';

export class WorldScene {
  constructor(world, renderer) {
    const q = renderer.q;
    const scene = renderer.scene;
    this.world = world;
    this.renderer = renderer;
    const atlas = buildAtlas();
    const detail = buildTerrainDetail();
    this.terrain = new TerrainLOD(world, detail, q);
    scene.add(this.terrain.group);
    this.water = buildWater();
    scene.add(this.water);
    this.roads = new RoadMesh(world, q);
    scene.add(this.roads.group);
    this.structures = new StructureMesh(world, atlas, q);
    scene.add(this.structures.group);
    this.vegetation = new Vegetation(world, q, null);
    scene.add(this.vegetation.group);
  }

  update(camera, dt, time, opts = {}) {
    const r = this.renderer;
    this.terrain.update(camera);
    this.roads.update(camera);
    this.structures.update(camera, dt, time, r.daylight, opts.effects);
    this.structures.updateFlags(opts.war, time, opts.windDir ?? 0.6, camera);
    this.vegetation.update(time, opts.wind ?? 0.3, camera);
    const wu = this.water.material.uniforms;
    wu.uTime.value = time;
    wu.uSunDir.value.copy(r.sunDir);
    wu.uSunColor.value.copy(r.sun.color).multiplyScalar(r.daylight);
    wu.uSky.value.copy(r.sky.uniforms.uHorizon.value);
    wu.uRain.value = r.env.rain;
  }
}
