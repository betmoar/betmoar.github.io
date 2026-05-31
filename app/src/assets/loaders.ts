import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// One shared GLTF loader wired with the meshopt decoder (our pipeline compresses geometry with
// EXT_meshopt_compression). Assets live under <base>/kits/, described by a generated manifest.

interface ManifestEntry { id: string; url: string; height: number }
interface Manifest {
  kits: Record<string, { ground: ManifestEntry; mid: ManifestEntry[]; roof: ManifestEntry }>;
  vehicle: { id: string; url: string };
}

export interface KitModule { geo: THREE.BufferGeometry; height: number }
export interface ZoneKit { ground: KitModule; mids: KitModule[]; roof: KitModule }
export type ZoneKits = Record<number, ZoneKit>; // keyed by zone id (0,1,2)
export interface Assets { kits: ZoneKits; vehicle: THREE.BufferGeometry | null }

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

function firstGeometry(gltf: { scene: THREE.Object3D }): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry | null = null;
  gltf.scene.traverse((o) => { if (!geo && (o as THREE.Mesh).isMesh) geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry; });
  if (!geo) throw new Error('module has no mesh');
  return geo;
}
async function loadGeo(base: string, url: string): Promise<THREE.BufferGeometry> {
  return firstGeometry(await loader.loadAsync(base + url));
}
async function loadModule(base: string, e: ManifestEntry): Promise<KitModule> {
  return { geo: await loadGeo(base, e.url), height: e.height };
}

// Loads every zone kit + the vehicle. Default-safe: returns empty kits / null vehicle (callers fall
// back to box primitives) if the manifest or any asset is missing — the app never throws on assets.
export async function loadAssets(base: string): Promise<Assets> {
  try {
    const manifest: Manifest = await fetch(base + 'kits/manifest.json').then((r) => {
      if (!r.ok) throw new Error('no manifest'); return r.json();
    });
    const kits: ZoneKits = {};
    for (const [zoneKey, k] of Object.entries(manifest.kits)) {
      const zone = Number(zoneKey.replace('z', ''));
      const [ground, roof, ...mids] = await Promise.all([
        loadModule(base, k.ground), loadModule(base, k.roof), ...k.mid.map((m) => loadModule(base, m)),
      ]);
      kits[zone] = { ground, mids, roof };
    }
    const vehicle = manifest.vehicle?.url ? await loadGeo(base, manifest.vehicle.url) : null;
    return { kits, vehicle };
  } catch (err) {
    console.warn('[assets] unavailable — using primitives:', (err as Error).message);
    return { kits: {}, vehicle: null };
  }
}
