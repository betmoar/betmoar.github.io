import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { detectTier, TIERS } from './core/gfx-tiers';
import { createRenderer } from './render/renderer';

// ── M0 scaffold ────────────────────────────────────────────────────────────────
// Proves the full pipeline end-to-end: Vite+TS build → renderer + tier system +
// PBR material lit by a PMREM environment (the IBL path M4 reuses) → deploys to
// /voxel-city2/ without touching the live game. A lit, rotating cube is the payload.

const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;

const tier = detectTier();
const cfg = TIERS[tier];
const renderer = createRenderer(canvas, tier);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e1a);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(3, 2.2, 4);
camera.lookAt(0, 0.4, 0);

// Image-based lighting from a procedural room env (no asset needed yet) → real PBR shading.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// A sun for shadows + directionality.
const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
sun.position.set(4, 6, 3);
sun.castShadow = cfg.shadowCascades > 0;
sun.shadow.mapSize.set(cfg.shadowSize, cfg.shadowSize);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x202a3a, 0.4));

// Ground + a PBR "hello cube".
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(8, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x141b2e, roughness: 0.95, metalness: 0.0 }),
);
ground.receiveShadow = true;
scene.add(ground);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 1.2, 1.2),
  new THREE.MeshStandardMaterial({ color: 0x3a7bd5, roughness: 0.35, metalness: 0.1 }),
);
cube.position.y = 0.6;
cube.castShadow = true;
scene.add(cube);

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let frames = 0;
let fps = 0;
let acc = 0;
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  cube.rotation.y += dt * 0.8;
  cube.rotation.x += dt * 0.25;

  frames++;
  acc += dt;
  if (acc >= 0.5) { fps = Math.round(frames / acc); frames = 0; acc = 0; }
  hud.textContent = `VOXEL CITY 2 — M0 scaffold\ntier: ${tier}  ·  ${fps} fps  ·  dpr cap ${cfg.pixelRatioCap}`;

  renderer.render(scene, camera);
});

// Surface boot success for the headless smoke test / console.
console.log('[vc2] M0 booted — tier', tier);
