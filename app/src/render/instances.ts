import * as THREE from 'three';
import { cars, peds } from '../ecs/world-ecs';

const PALETTE = [0x3366ff, 0x33cc66, 0xffaa22, 0xcc3344, 0x9955dd].map((c) => new THREE.Color(c));
const PED_PALETTE = [0x5dff9d, 0xffcf4d, 0xff7d4d, 0x4dd2ff, 0xc77dff].map((c) => new THREE.Color(c));

// Instanced car rendering: body + cab, one draw call each, fed from the traffic ECS each frame.
// Authored vehicle .glb meshes replace these box primitives at M4-content time (same per-frame
// matrix write). Body takes a per-instance colour; the cab is a fixed dark glass tone.
export class CarInstances {
  private body: THREE.InstancedMesh;
  private cab: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private e = new THREE.Euler();
  private s = new THREE.Vector3(1, 1, 1);
  count = 0;

  constructor(scene: THREE.Scene, private max = 256) {
    this.body = new THREE.InstancedMesh(new THREE.BoxGeometry(2.1, 0.62, 4.2), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.1 }), max);
    this.cab = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 0.6, 2.0), new THREE.MeshStandardMaterial({ color: 0x1a2330, roughness: 0.3, metalness: 0.2 }), max);
    for (const im of [this.body, this.cab]) { im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.castShadow = true; im.frustumCulled = false; scene.add(im); }
    this.body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  }

  sync(): void {
    let i = 0;
    for (const e of cars) {
      if (i >= this.max) break;
      const c = e.car;
      this.e.set(0, c.rot, 0); this.q.setFromEuler(this.e);
      this.p.set(c.x, c.y + 0.45, c.z); this.m.compose(this.p, this.q, this.s);
      this.body.setMatrixAt(i, this.m); this.body.setColorAt(i, PALETTE[c.color] ?? PALETTE[0]);
      this.p.set(c.x, c.y + 0.95, c.z); this.m.compose(this.p, this.q, this.s);
      this.cab.setMatrixAt(i, this.m);
      i++;
    }
    this.count = i;
    this.body.count = i; this.cab.count = i;
    this.body.instanceMatrix.needsUpdate = true; this.cab.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
}

// Instanced pedestrians: torso (per-instance colour) + head, fed from the ped ECS each frame with
// a subtle walk bob. Box humanoids stand in for authored skinned characters (M4-content).
export class PedInstances {
  private torso: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private e = new THREE.Euler();
  private s = new THREE.Vector3(1, 1, 1);
  count = 0;

  constructor(scene: THREE.Scene, private max = 256) {
    this.torso = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.95, 0.3), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }), max);
    this.head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0xd8b48a, roughness: 0.9, metalness: 0 }), max);
    for (const im of [this.torso, this.head]) { im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.castShadow = true; im.frustumCulled = false; scene.add(im); }
    this.torso.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  }

  sync(): void {
    let i = 0;
    for (const e of peds) {
      if (i >= this.max) break;
      const p = e.ped;
      const bob = Math.abs(Math.sin(p.phase)) * 0.06;
      this.e.set(0, p.rot, 0); this.q.setFromEuler(this.e);
      this.p.set(p.x, p.y + 0.6 + bob, p.z); this.m.compose(this.p, this.q, this.s);
      this.torso.setMatrixAt(i, this.m); this.torso.setColorAt(i, PED_PALETTE[p.color] ?? PED_PALETTE[0]);
      this.p.set(p.x, p.y + 1.22 + bob, p.z); this.m.compose(this.p, this.q, this.s);
      this.head.setMatrixAt(i, this.m);
      i++;
    }
    this.count = i;
    this.torso.count = i; this.head.count = i;
    this.torso.instanceMatrix.needsUpdate = true; this.head.instanceMatrix.needsUpdate = true;
    if (this.torso.instanceColor) this.torso.instanceColor.needsUpdate = true;
  }
}
