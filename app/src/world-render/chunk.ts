import * as THREE from 'three';
import { CHUNK, SEA_LEVEL } from '../world/world';
import { buildTerrainGeo } from '../render/mesh/terrain';
import { buildRoadGeo } from '../render/mesh/roads';
import { buildBuildingsGeo } from '../render/mesh/buildings';
import { buildWaterGeo } from '../render/mesh/water';
import type { ZoneKits } from '../assets/loaders';
import type { PhysicsWorld } from '../physics/rapier';

interface LoadedChunk {
  cx: number; cz: number;
  group: THREE.Group;
  baseGeos: THREE.BufferGeometry[];          // terrain + roads + water (kept to full draw distance)
  building: { mesh: THREE.Mesh; geo: THREE.BufferGeometry } | null; // LOD layer (inner ring only)
}

export interface ChunkMaterials {
  terrain: THREE.Material;
  road: THREE.Material;
  building: THREE.Material;
  water: THREE.Material;
}

// Streams per-chunk meshes in a square ring around a focus point (legacy buildChunk/updateChunks
// lifecycle). LOD: terrain/roads/water load out to `rings`, but the heavier authored BUILDINGS only
// within `buildingRings` — distant chunks keep their ground/skyline-into-fog cheaply (HLOD-lite).
// Geometry is built from world.ts only — the world→render binding everything hangs off.
export class ChunkManager {
  private loaded = new Map<string, LoadedChunk>();
  private lastKey = '';
  buildingCount = 0;

  constructor(private scene: THREE.Scene, private mats: ChunkMaterials, private rings: number, private buildingRings: number, private kits: ZoneKits, private physics: PhysicsWorld | null = null) {}

  get count(): number { return this.loaded.size; }

  update(focusX: number, focusZ: number): void {
    const ccx = Math.round(focusX / CHUNK), ccz = Math.round(focusZ / CHUNK);
    const key = `${ccx},${ccz}`;
    if (key === this.lastKey) return; // only re-evaluate when crossing a chunk boundary
    this.lastKey = key;

    const want = new Set<string>();
    for (let dx = -this.rings; dx <= this.rings; dx++) {
      for (let dz = -this.rings; dz <= this.rings; dz++) {
        const cx = ccx + dx, cz = ccz + dz, k = `${cx},${cz}`;
        want.add(k);
        if (!this.loaded.has(k)) this.load(cx, cz, k);
      }
    }
    for (const k of [...this.loaded.keys()]) if (!want.has(k)) this.unload(k);

    // reconcile the building LOD layer + physics colliders against the new focus (both inner-ring)
    let bc = 0;
    for (const c of this.loaded.values()) {
      const inner = Math.max(Math.abs(c.cx - ccx), Math.abs(c.cz - ccz)) <= this.buildingRings;
      if (inner && !c.building) this.addBuildings(c);
      else if (!inner && c.building) this.removeBuildings(c);
      if (this.physics) {
        if (inner && !this.physics.hasChunk(c.cx, c.cz)) this.physics.addChunk(c.cx, c.cz);
        else if (!inner && this.physics.hasChunk(c.cx, c.cz)) this.physics.removeChunk(c.cx, c.cz);
      }
      if (c.building) bc++;
    }
    this.buildingCount = bc;
  }

  private load(cx: number, cz: number, key: string): void {
    const group = new THREE.Group();
    const baseGeos: THREE.BufferGeometry[] = [];

    const tg = buildTerrainGeo(cx, cz);
    baseGeos.push(tg);
    const terrain = new THREE.Mesh(tg, this.mats.terrain);
    terrain.position.set(cx * CHUNK, 0, cz * CHUNK);
    terrain.receiveShadow = true;
    group.add(terrain);

    const rg = buildRoadGeo(cx, cz);
    if (rg) { baseGeos.push(rg); const m = new THREE.Mesh(rg, this.mats.road); m.receiveShadow = true; group.add(m); }

    const wg = buildWaterGeo(cx, cz);
    if (wg) { baseGeos.push(wg); const m = new THREE.Mesh(wg, this.mats.water); m.position.set(cx * CHUNK, SEA_LEVEL + 0.05, cz * CHUNK); group.add(m); }

    this.scene.add(group);
    this.loaded.set(key, { cx, cz, group, baseGeos, building: null });
  }

  private addBuildings(c: LoadedChunk): void {
    const bg = buildBuildingsGeo(c.cx, c.cz, this.kits);
    if (!bg) return;
    const mesh = new THREE.Mesh(bg, this.mats.building);
    mesh.castShadow = true; mesh.receiveShadow = true;
    c.group.add(mesh);
    c.building = { mesh, geo: bg };
  }

  private removeBuildings(c: LoadedChunk): void {
    if (!c.building) return;
    c.group.remove(c.building.mesh);
    c.building.geo.dispose();
    c.building = null;
  }

  private unload(key: string): void {
    const c = this.loaded.get(key);
    if (!c) return;
    this.scene.remove(c.group);
    for (const g of c.baseGeos) g.dispose();
    if (c.building) c.building.geo.dispose();
    if (this.physics) this.physics.removeChunk(c.cx, c.cz);
    this.loaded.delete(key);
  }
}
