import * as THREE from 'three';
import { CHUNK } from '../world/world';
import { buildTerrainGeo } from '../render/mesh/terrain';
import { buildRoadGeo } from '../render/mesh/roads';
import { buildBuildingsGeo } from '../render/mesh/buildings';
import type { Z1Kit } from '../assets/loaders';

interface LoadedChunk { group: THREE.Group; geos: THREE.BufferGeometry[]; }

export interface ChunkMaterials {
  terrain: THREE.Material;
  road: THREE.Material;
  building: THREE.Material;
}

// Streams per-chunk meshes (terrain + roads + buildings) in a square ring around a focus point,
// mirroring the legacy buildChunk/updateChunks lifecycle. Geometry is built from world.ts only —
// this is the world→render binding the hybrid rebuild hangs everything else off.
export class ChunkManager {
  private loaded = new Map<string, LoadedChunk>();
  private lastKey = '';

  constructor(private scene: THREE.Scene, private mats: ChunkMaterials, private rings: number, private kit: Z1Kit | null) {}

  get count(): number { return this.loaded.size; }

  update(focusX: number, focusZ: number): void {
    const ccx = Math.round(focusX / CHUNK), ccz = Math.round(focusZ / CHUNK);
    const key = `${ccx},${ccz}`;
    if (key === this.lastKey) return; // only re-evaluate the ring when we cross a chunk boundary
    this.lastKey = key;

    const want = new Set<string>();
    for (let dx = -this.rings; dx <= this.rings; dx++) {
      for (let dz = -this.rings; dz <= this.rings; dz++) {
        const cx = ccx + dx, cz = ccz + dz, k = `${cx},${cz}`;
        want.add(k);
        if (!this.loaded.has(k)) this.load(cx, cz, k);
      }
    }
    for (const k of [...this.loaded.keys()]) {
      if (!want.has(k)) this.unload(k);
    }
  }

  private load(cx: number, cz: number, key: string): void {
    const group = new THREE.Group();
    const geos: THREE.BufferGeometry[] = [];

    const tg = buildTerrainGeo(cx, cz);
    geos.push(tg);
    const terrain = new THREE.Mesh(tg, this.mats.terrain);
    terrain.position.set(cx * CHUNK, 0, cz * CHUNK); // terrain geo is chunk-local
    terrain.receiveShadow = true;
    group.add(terrain);

    const rg = buildRoadGeo(cx, cz); // world-space geo → mesh at origin
    if (rg) { geos.push(rg); const m = new THREE.Mesh(rg, this.mats.road); m.receiveShadow = true; group.add(m); }

    const bg = buildBuildingsGeo(cx, cz, this.kit);
    if (bg) { geos.push(bg); const m = new THREE.Mesh(bg, this.mats.building); m.castShadow = true; m.receiveShadow = true; group.add(m); }

    this.scene.add(group);
    this.loaded.set(key, { group, geos });
  }

  private unload(key: string): void {
    const c = this.loaded.get(key);
    if (!c) return;
    this.scene.remove(c.group);
    for (const g of c.geos) g.dispose();
    this.loaded.delete(key);
  }
}
