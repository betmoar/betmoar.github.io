import * as THREE from 'three';
import { cars } from '../ecs/world-ecs';

const PALETTE = [0x3366ff, 0x33cc66, 0xffaa22, 0xcc3344, 0x9955dd].map((c) => new THREE.Color(c));

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
