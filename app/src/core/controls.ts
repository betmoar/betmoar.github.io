import * as THREE from 'three';

// Camera controller with two modes:
//  • auto  — an ambient flythrough gliding over the city (default; also what the headless smoke
//            test sees, and what plays when idle).
//  • fly   — click to pointer-lock, then WASD + mouse-look free flight (Shift = sprint, Space/Ctrl
//            up/down). Esc releases the lock and resumes the flythrough.
// `focus` (ground-projected camera position) drives chunk streaming, crate spawning and the sun.
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class CameraController {
  mode: 'auto' | 'fly' = 'auto';
  focus = new THREE.Vector3();
  private yaw: number;
  private pitch = -0.15;
  private heading = Math.PI * 0.25;
  private keys = new Set<string>();
  private fwd = new THREE.Vector3();
  private strafe = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, start: { x: number; z: number }) {
    this.focus.set(start.x, 0, start.z);
    this.yaw = this.heading;
    addEventListener('keydown', (e) => this.keys.add(e.code));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    canvas.addEventListener('click', () => { if (this.mode === 'auto') canvas.requestPointerLock(); });
    document.addEventListener('pointerlockchange', () => {
      this.mode = document.pointerLockElement === canvas ? 'fly' : 'auto';
      if (this.mode === 'fly') { // adopt the current view so there's no jump
        this.yaw = this.heading;
      }
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

  update(dt: number): void {
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
