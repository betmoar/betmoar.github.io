import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { detectTier, TIERS } from './core/gfx-tiers';
import { createRenderer } from './render/renderer';
import { createPost } from './render/post';
import { DayNight } from './render/daynight';
import { createWater } from './render/mesh/water';
import { ChunkManager, type ChunkMaterials } from './world-render/chunk';
import { loadAssets } from './assets/loaders';
import { updateTraffic } from './sim/traffic';
import { updatePeds } from './sim/peds';
import { CarInstances, PedInstances, CrateInstances } from './render/instances';
import { PhysicsWorld } from './physics/rapier';
import { CHUNK, buildRoadNetwork, terrainHeight } from './world/world';

// ── M4 (engine half) ────────────────────────────────────────────────────────────
// Day/night sun + sky + IBL cycle, pmndrs post stack (SMAA + tier-gated bloom + AgX), and animated
// water — all asset-free engine systems on top of the M3 authored-kit city.

const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const params = new URLSearchParams(location.search);

const tier = detectTier();
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
const physics = await PhysicsWorld.create();
const buildingRings = Math.max(1, cfg.drawRings - 1); // buildings + physics within an inner ring
const chunks = new ChunkManager(scene, mats, cfg.drawRings, buildingRings, assets.kits, physics);

const post = createPost(renderer, scene, camera, tier);
const carInstances = new CarInstances(scene, assets.vehicle);
const pedInstances = new PedInstances(scene);
const crateInstances = new CrateInstances(scene);

function findStart(): { x: number; z: number } {
  for (let cx = 0; cx < 200; cx++) for (let cz = 0; cz < 200; cz++) {
    if (buildRoadNetwork(cx, cz).segments.length > 0) return { x: cx * CHUNK, z: cz * CHUNK };
  }
  return { x: 0, z: 0 };
}
const start = findStart();
const focus = new THREE.Vector3(start.x, 0, start.z);
const heading = Math.PI * 0.25;

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});

let frames = 0, fps = 0, acc = 0, tNow = 0, crateTimer = 0;
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  tNow += dt;

  const speed = 16;
  focus.x += Math.cos(heading) * speed * dt;
  focus.z += Math.sin(heading) * speed * dt;
  chunks.update(focus.x, focus.z);

  const camDist = 80, camHeight = 70;
  camera.position.set(focus.x - Math.cos(heading) * camDist, camHeight, focus.z - Math.sin(heading) * camDist);
  camera.lookAt(focus.x + Math.cos(heading) * 30, 2, focus.z + Math.sin(heading) * 30);

  dayNight.update(dt, focus.x, focus.z, camera);
  water.tick(tNow);
  updateTraffic(dt, focus.x, focus.z);
  updatePeds(dt, focus.x, focus.z);

  // rain a few physics crates near the focus so the Rapier world is visibly working
  crateTimer += dt;
  if (crateTimer > 0.35) {
    crateTimer = 0;
    physics.spawnCrate(focus.x + (Math.random() - 0.5) * 30, terrainHeight(focus.x, focus.z) + 22, focus.z + (Math.random() - 0.5) * 30);
  }
  physics.step(dt);

  carInstances.sync();
  pedInstances.sync();
  crateInstances.sync(physics.crates);

  frames++; acc += dt;
  if (acc >= 0.5) { fps = Math.round(frames / acc); frames = 0; acc = 0; }
  const tod = dayNight.timeOfDay.toFixed(2);
  hud.textContent = `VOXEL CITY 2 — engine+physics\ntier ${tier} · ${fps} fps · chunks ${chunks.count} (bldg ${chunks.buildingCount}) · cars ${carInstances.count} · peds ${pedInstances.count} · crates ${crateInstances.count} · tod ${tod} ${dayNight.isNight ? '(night)' : ''}`;

  post.composer.render();
});

console.log('[vc2] M4 booted — tier', tier, 'start', start);
