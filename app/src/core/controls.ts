import * as THREE from 'three';
import type { PhysicsWorld, Character } from '../physics/rapier';

// Camera controller with three modes:
//  • auto  — ambient flythrough gliding over the city (default; idle + headless smoke test).
//  • fly   — click to pointer-lock, WASD + mouse-look free flight (Shift sprint, Space/Ctrl up/down).
//  • walk  — first-person Rapier capsule: gravity + collision against terrain/buildings, WASD
//            relative to look, Space to jump. Press G (while locked) to toggle fly⇄walk; Esc → auto.
// `focus` (ground-projected camera position) drives chunk streaming, crate spawning and the sun.
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const EYE = 0.7; // eye offset above the capsule centre

export class CameraController {
  mode: 'auto' | 'fly' | 'walk' | 'static' = 'auto';
  focus = new THREE.Vector3();
  private yaw: number;
  private pitch = -0.15;
  private heading = Math.PI * 0.25;
  private keys = new Set<string>();
  private fwd = new THREE.Vector3();
  private strafe = new THREE.Vector3();
  private physics: PhysicsWorld | null = null;
  private walker: Character | null = null;
  private vy = 0;
  private grounded = false;

  constructor(private camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, start: { x: number; z: number }) {
    this.focus.set(start.x, 0, start.z);
    this.yaw = this.heading;
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyG' && document.pointerLockElement === canvas) this.toggleWalkFly();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    canvas.addEventListener('click', () => { if (this.mode === 'auto' || this.mode === 'static') canvas.requestPointerLock(); });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === canvas) { if (this.mode === 'auto' || this.mode === 'static') { this.mode = 'fly'; } }
      else this.mode = 'auto';
    });
    document.addEventListener('mousemove', (e) => {
      if (this.mode !== 'fly') return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = clamp(this.pitch - e.movementY * 0.0022, -1.4, 1.4);
    });
    // seed the camera at the auto trailing position so fly mode (or frame 1) starts in the city
    camera.position.set(start.x - Math.cos(this.heading) * 80, 70, start.z - Math.sin(this.heading) * 80);
    camera.lookAt(start.x, 2, start.z);
  }

  attachWalker(physics: PhysicsWorld, walker: Character): void { this.physics = physics; this.walker = walker; }

  // Debug fly-to: park the camera at a fixed pose looking at a target (drives chunk streaming via
  // focus). Used by the ?cam=x,y,z,tx,ty,tz URL param to inspect specific coordinates. Clicking the
  // canvas still hands off to pointer-lock fly from this pose.
  setStatic(x: number, y: number, z: number, tx: number, ty: number, tz: number): void {
    this.mode = 'static';
    this.camera.position.set(x, y, z);
    this.camera.lookAt(tx, ty, tz);
    this.focus.set(x, 0, z);
    this.yaw = Math.atan2(x - tx, z - tz); // so fly mode continues from this heading
  }

  setMode(mode: 'auto' | 'fly' | 'walk'): void { if (mode !== 'walk' || this.walker) this.mode = mode; }

  private toggleWalkFly(): void {
    if (!this.walker || !this.physics) return;
    if (this.mode === 'fly') {
      // drop the capsule in beneath the current camera so walking starts where you were looking
      const p = this.camera.position;
      this.walker.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
      this.vy = 0; this.mode = 'walk';
    } else if (this.mode === 'walk') {
      this.mode = 'fly';
    }
  }

  update(dt: number): void {
    if (this.mode === 'walk' && this.physics && this.walker) {
      this.fwd.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      const flatF = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.strafe.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const sp = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 11 : 5.5;
      const move = new THREE.Vector3();
      if (this.keys.has('KeyW')) move.addScaledVector(flatF, sp * dt);
      if (this.keys.has('KeyS')) move.addScaledVector(flatF, -sp * dt);
      if (this.keys.has('KeyA')) move.addScaledVector(this.strafe, -sp * dt);
      if (this.keys.has('KeyD')) move.addScaledVector(this.strafe, sp * dt);
      this.vy += -22 * dt;                                   // gravity
      if (this.grounded && this.vy < 0) this.vy = -1;        // stick to ground
      if (this.grounded && this.keys.has('Space')) this.vy = 9;
      move.y = this.vy * dt;
      this.grounded = this.physics.moveCharacter(this.walker, move);
      const t = this.walker.body.translation();
      this.camera.position.set(t.x, t.y + EYE, t.z);
      this.camera.lookAt(t.x + this.fwd.x, t.y + EYE + this.fwd.y, t.z + this.fwd.z);
      this.focus.set(t.x, 0, t.z);
      return;
    }
    if (this.mode === 'static') return; // camera fixed; click to take over (fly)
    if (this.mode === 'auto') {
      const speed = 16;
      this.focus.x += Math.cos(this.heading) * speed * dt;
      this.focus.z += Math.sin(this.heading) * speed * dt;
      const camDist = 80, camHeight = 70;
      this.camera.position.set(this.focus.x - Math.cos(this.heading) * camDist, camHeight, this.focus.z - Math.sin(this.heading) * camDist);
      this.camera.lookAt(this.focus.x + Math.cos(this.heading) * 30, 2, this.focus.z + Math.sin(this.heading) * 30);
      return;
    }
    // fly
    const sp = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 70 : 28;
    this.fwd.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.strafe.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const p = this.camera.position;
    if (this.keys.has('KeyW')) p.addScaledVector(this.fwd, sp * dt);
    if (this.keys.has('KeyS')) p.addScaledVector(this.fwd, -sp * dt);
    if (this.keys.has('KeyA')) p.addScaledVector(this.strafe, -sp * dt);
    if (this.keys.has('KeyD')) p.addScaledVector(this.strafe, sp * dt);
    if (this.keys.has('Space')) p.y += sp * dt;
    if (this.keys.has('ControlLeft')) p.y -= sp * dt;
    p.y = Math.max(1.5, p.y);
    this.camera.lookAt(p.x + this.fwd.x, p.y + this.fwd.y, p.z + this.fwd.z);
    this.focus.set(p.x, 0, p.z);
  }
}
