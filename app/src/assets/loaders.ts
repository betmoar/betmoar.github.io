import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// One shared GLTF loader wired with the meshopt decoder (our pipeline compresses geometry with
// EXT_meshopt_compression). Assets live under <base>/kits/, described by a generated manifest.

interface ManifestEntry { id: string; url: string; height: number }
interface Manifest { kits: { z1: { ground: ManifestEntry; mid: ManifestEntry[]; roof: ManifestEntry } } }

export interface KitModule { geo: THREE.BufferGeometry; height: number }
export interface Z1Kit { ground: KitModule; mids: KitModule[]; roof: KitModule }

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

function firstGeometry(gltf: { scene: THREE.Object3D }): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry | null = null;
  gltf.scene.traverse((o) => { if (!geo && (o as THREE.Mesh).isMesh) geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry; });
  if (!geo) throw new Error('kit module has no mesh');
  return geo;
}

async function loadModule(base: string, e: ManifestEntry): Promise<KitModule> {
  const gltf = await loader.loadAsync(base + e.url);
  return { geo: firstGeometry(gltf), height: e.height };
}

// Loads the zone-1 building kit. Returns null (caller falls back to boxes) if the manifest or any
// module is missing — same "default-safe, never throw the app" principle as the rest of the engine.
export async function loadZ1Kit(base: string): Promise<Z1Kit | null> {
  try {
    const manifest: Manifest = await fetch(base + 'kits/manifest.json').then((r) => {
      if (!r.ok) throw new Error('no manifest');
      return r.json();
    });
    const z1 = manifest.kits.z1;
    const [ground, roof, ...mids] = await Promise.all([
      loadModule(base, z1.ground),
      loadModule(base, z1.roof),
      ...z1.mid.map((m) => loadModule(base, m)),
    ]);
    return { ground, mids, roof };
  } catch (err) {
    console.warn('[kit] zone-1 kit unavailable — using box fallback:', (err as Error).message);
    return null;
  }
}
