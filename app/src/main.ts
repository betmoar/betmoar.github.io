import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { detectTier, TIERS, type Tier } from './core/gfx-tiers';
import { createRenderer } from './render/renderer';
import { createPost } from './render/post';
import { DayNight } from './render/daynight';
import { createWater } from './render/mesh/water';
import { ChunkManager, type ChunkMaterials } from './world-render/chunk';
import { loadAssets } from './assets/loaders';
import { updateTraffic } from './sim/traffic';
import { updatePeds } from './sim/peds';
import { CarInstances, PedInstances } from './render/instances';
import type { PhysicsWorld } from './physics/rapier';
import { CameraController } from './core/controls';
import { CHUNK, buildRoadNetwork, terrainHeight } from './world/world';

// ── M4 (engine half) ────────────────────────────────────────────────────────────
// Day/night sun + sky + IBL cycle, pmndrs post stack (SMAA + tier-gated bloom + AgX), and animated
// water — all asset-free engine systems on top of the M3 authored-kit city.

const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const params = new URLSearchParams(location.search);

const tierParam = params.get('tier');
const tier: Tier = tierParam === 'low' || tierParam === 'medium' || tierParam === 'high' ? tierParam : detectTier();
const cfg = TIERS[tier];
const renderer = createRenderer(canvas, tier);
renderer.toneMapping = THREE.NoToneMapping; // AgX moves into the post chain (after bloom)

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd3ff);
scene.fog = new THREE.Fog(0x9fd3ff, CHUNK * cfg.drawRings * 0.95, CHUNK * cfg.drawRings * 1.7);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, CHUNK * (cfg.drawRings + 2));

// IBL base (a neutral room env); the day/night cycle modulates its intensity. A prebaked HDRI set
// can replace this at M4-content time without touching the cycle.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const sun = new THREE.DirectionalLight(0xfff2d6, 2.4);
sun.castShadow = cfg.shadowCascades > 0;
sun.shadow.mapSize.set(cfg.shadowSize, cfg.shadowSize);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 700;
const ss = 130;
sun.shadow.camera.left = -ss; sun.shadow.camera.right = ss; sun.shadow.camera.top = ss; sun.shadow.camera.bottom = -ss;
sun.shadow.bias = -0.0005;
const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x33405a, 0.6);
scene.add(sun, sun.target, hemi);

const dayNight = new DayNight(sun, hemi, scene, {
  timeOfDay: params.has('tod') ? parseFloat(params.get('tod')!) : 0.32,
  dayLength: params.has('day') ? parseFloat(params.get('day')!) : 140,
});

const water = createWater();
const mats: ChunkMaterials = {
  terrain: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1.0, metalness: 0 }),
  road: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }),
  building: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.05 }),
  water: water.material,
};

const assets = await loadAssets(import.meta.env.BASE_URL);
const buildingRings = Math.max(1, cfg.drawRings - 1); // buildings + physics within an inner ring
const chunks = new ChunkManager(scene, mats, cfg.drawRings, buildingRings, assets.kits);
// Physics (Rapier) loads lazily — its WASM is large, so the city renders immediately and physics
// attaches when ready (enabling crates + walk mode a moment later).
let physics: PhysicsWorld | null = null;
let pendingWalk = false;

const post = createPost(renderer, scene, camera, tier);
const carInstances = new CarInstances(scene, assets.vehicle);
const pedInstances = new PedInstances(scene);

function findStart(): { x: number; z: number } {
  for (let cx = 0; cx < 200; cx++) for (let cz = 0; cz < 200; cz++) {
    if (buildRoadNetwork(cx, cz).segments.length > 0) return { x: cx * CHUNK, z: cz * CHUNK };
  }
  return { x: 0, z: 0 };
}
const start = findStart();
const controls = new CameraController(camera, canvas, start);
if (params.get('mode') === 'fly') controls.setMode('fly');
if (params.get('mode') === 'walk') pendingWalk = true; // applied once physics + character exist

// kick off physics load in the background via dynamic import — keeps Rapier's large WASM chunk OFF
// the critical path so the city paints immediately; physics + walk mode light up a moment later.
import('./physics/rapier').then(({ PhysicsWorld }) => PhysicsWorld.create()).then((p) => {
  physics = p;
  chunks.setPhysics(p);
  const character = p.createCharacter(start.x, terrainHeight(start.x, start.z) + 3, start.z);
  controls.attachWalker(p, character);
  if (pendingWalk) controls.setMode('walk');
});

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});

let frames = 0, fps = 0, acc = 0, tNow = 0;
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  tNow += dt;

  controls.update(dt);
  const focus = controls.focus;
  chunks.update(focus.x, focus.z);

  dayNight.update(dt, focus.x, focus.z, camera);
  water.tick(tNow);
  updateTraffic(dt, focus.x, focus.z);
  updatePeds(dt, focus.x, focus.z);

  // physics runs once Rapier has finished loading in the background (drives walk-mode collision)
  if (physics) physics.step(dt);

  carInstances.sync();
  pedInstances.sync();

  frames++; acc += dt;
  if (acc >= 0.5) { fps = Math.round(frames / acc); frames = 0; acc = 0; }
  const tod = dayNight.timeOfDay.toFixed(2);
  const modeHint = controls.mode === 'auto' ? 'click to explore'
    : controls.mode === 'fly' ? 'FLY: WASD+mouse · G=walk · Esc'
    : 'WALK: WASD+mouse · Space=jump · G=fly · Esc';
  hud.textContent = `VOXEL CITY 2 — engine+physics  [${modeHint}]\ntier ${tier} · ${fps} fps · chunks ${chunks.count} (bldg ${chunks.buildingCount}) · cars ${carInstances.count} · peds ${pedInstances.count} · tod ${tod} ${dayNight.isNight ? '(night)' : ''}`;

  post.composer.render();
});

console.log('[vc2] M4 booted — tier', tier, 'start', start);
