import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { detectTier, TIERS } from './core/gfx-tiers';
import { createRenderer } from './render/renderer';
import { ChunkManager, type ChunkMaterials } from './world-render/chunk';
import { loadZ1Kit } from './assets/loaders';
import { CHUNK, buildRoadNetwork } from './world/world';

// ── M2 — procedural-look parity ─────────────────────────────────────────────────
// Old look, new engine: terrain + road surfaces + zone-coloured building boxes streamed from
// world.ts as the camera flies over the city. Validates the world→render binding before any
// Blender assets. Detail (windows, sidewalks, props) and authored kits arrive at M3/M4.

const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;

const tier = detectTier();
const cfg = TIERS[tier];
const renderer = createRenderer(canvas, tier);

const scene = new THREE.Scene();
const SKY = new THREE.Color(0x9fd3ff);
scene.background = SKY.clone();
scene.fog = new THREE.Fog(SKY.clone(), CHUNK * cfg.drawRings * 0.7, CHUNK * cfg.drawRings * 1.4);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, CHUNK * (cfg.drawRings + 2));

// IBL for PBR ambient + a key sun for shadows/direction.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
const sun = new THREE.DirectionalLight(0xfff2d6, 2.4);
sun.position.set(120, 180, 80);
sun.castShadow = cfg.shadowCascades > 0;
sun.shadow.mapSize.set(cfg.shadowSize, cfg.shadowSize);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 600;
const ss = 120;
sun.shadow.camera.left = -ss; sun.shadow.camera.right = ss; sun.shadow.camera.top = ss; sun.shadow.camera.bottom = -ss;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbfe0ff, 0x33405a, 0.6));

const mats: ChunkMaterials = {
  terrain: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1.0, metalness: 0 }),
  road: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }),
  building: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.05 }),
};
// Load the authored downtown kit before streaming (it's tiny). Falls back to boxes if missing.
const kit = await loadZ1Kit(import.meta.env.BASE_URL);
const chunks = new ChunkManager(scene, mats, cfg.drawRings, kit);

// Spawn over the nearest populated chunk (origin is often countryside/sea).
function findStart(): { x: number; z: number } {
  for (let cx = 0; cx < 200; cx++) for (let cz = 0; cz < 200; cz++) {
    if (buildRoadNetwork(cx, cz).segments.length > 0) return { x: cx * CHUNK, z: cz * CHUNK };
  }
  return { x: 0, z: 0 };
}
const start = findStart();
const focus = new THREE.Vector3(start.x, 0, start.z);
const heading = Math.PI * 0.25; // fly diagonally so streaming is visible in all directions

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let frames = 0, fps = 0, acc = 0;
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);

  // glide the focus forward over the city; camera trails above-behind looking down.
  const speed = 18;
  focus.x += Math.cos(heading) * speed * dt;
  focus.z += Math.sin(heading) * speed * dt;
  chunks.update(focus.x, focus.z);

  const camDist = 80, camHeight = 70;
  camera.position.set(focus.x - Math.cos(heading) * camDist, camHeight, focus.z - Math.sin(heading) * camDist);
  camera.lookAt(focus.x + Math.cos(heading) * 30, 2, focus.z + Math.sin(heading) * 30);
  sun.target.position.copy(focus); sun.target.updateMatrixWorld();
  sun.position.set(focus.x + 120, 180, focus.z + 80);

  frames++; acc += dt;
  if (acc >= 0.5) { fps = Math.round(frames / acc); frames = 0; acc = 0; }
  hud.textContent = `VOXEL CITY 2 — M3 authored kit\ntier ${tier} · ${fps} fps · chunks ${chunks.count} · kit ${kit ? 'on' : 'box-fallback'}`;

  renderer.render(scene, camera);
});

console.log('[vc2] M2 booted — tier', tier, 'start', start);
