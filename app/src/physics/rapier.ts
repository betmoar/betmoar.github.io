import RAPIER from '@dimforge/rapier3d-compat';
import { CHUNK, GRID_SP, buildingAt } from '../world/world';
import { buildTerrainGeo } from '../render/mesh/terrain';

// Physics via Rapier. Static colliders are derived from world.ts so collision matches what's drawn:
// the terrain collider is a trimesh of the SAME geometry the renderer builds, and buildings are
// cuboids straight from buildingAt's spec (preserving the collision==geometry principle). Colliders
// stream with the inner chunk ring. Dynamic crates demonstrate the world responding to gravity;
// the player/vehicle character controller plugs into this world at the player-camera step.
export interface Character {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
}

export class PhysicsWorld {
  world!: RAPIER.World;
  crates: RAPIER.RigidBody[] = [];
  private chunkBodies = new Map<string, RAPIER.RigidBody[]>();
  private acc = 0;
  private maxCrates = 48;

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    const p = new PhysicsWorld();
    p.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    return p;
  }

  hasChunk(cx: number, cz: number): boolean { return this.chunkBodies.has(`${cx},${cz}`); }

  addChunk(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    if (this.chunkBodies.has(key)) return;
    const bodies: RAPIER.RigidBody[] = [];

    // terrain trimesh (reuse the rendered geometry → exact match), placed at the chunk origin
    const g = buildTerrainGeo(cx, cz);
    const verts = g.attributes.position.array as Float32Array;
    const idx = new Uint32Array((g.index!.array as ArrayLike<number>));
    const tb = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx * CHUNK, 0, cz * CHUNK));
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx), tb);
    bodies.push(tb);
    g.dispose();

    // building cuboids straight from the placement spec
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const sx = Math.floor((ox - CHUNK / 2) / GRID_SP) * GRID_SP + GRID_SP / 2;
    const sz = Math.floor((oz - CHUNK / 2) / GRID_SP) * GRID_SP + GRID_SP / 2;
    for (let lx = sx; lx < ox + CHUNK / 2; lx += GRID_SP) {
      for (let lz = sz; lz < oz + CHUNK / 2; lz += GRID_SP) {
        const B = buildingAt(lx, lz);
        if (!B) continue;
        const bb = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(lx, B.lowG + B.hgt / 2, lz));
        this.world.createCollider(RAPIER.ColliderDesc.cuboid(B.w / 2, B.hgt / 2, B.d / 2), bb);
        bodies.push(bb);
      }
    }
    this.chunkBodies.set(key, bodies);
  }

  removeChunk(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    const bodies = this.chunkBodies.get(key);
    if (!bodies) return;
    for (const b of bodies) this.world.removeRigidBody(b); // also removes attached colliders
    this.chunkBodies.delete(key);
  }

  spawnCrate(x: number, y: number, z: number): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z)
        .setAngvel({ x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5 }),
    );
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.6, 0.6, 0.6).setDensity(0.4).setRestitution(0.25), body);
    this.crates.push(body);
    while (this.crates.length > this.maxCrates) {
      const old = this.crates.shift()!;
      this.world.removeRigidBody(old);
    }
  }

  // First-person capsule with a kinematic character controller (autostep small ledges, snap to
  // ground). ~1.8 m tall. Walk movement is collision-corrected against the streamed colliders.
  createCharacter(x: number, y: number, z: number): Character {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.4), body);
    const controller = this.world.createCharacterController(0.02);
    controller.enableAutostep(0.5, 0.2, true);
    controller.enableSnapToGround(0.4);
    controller.setApplyImpulsesToDynamicBodies(true);
    return { body, collider, controller };
  }

  // Collision-corrected move: returns whether the character is grounded after the move.
  moveCharacter(ch: Character, disp: { x: number; y: number; z: number }): boolean {
    ch.controller.computeColliderMovement(ch.collider, disp);
    const m = ch.controller.computedMovement();
    const t = ch.body.translation();
    ch.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    return ch.controller.computedGrounded();
  }

  // fixed-timestep stepping with a small catch-up cap
  step(dt: number): void {
    this.world.timestep = 1 / 60;
    this.acc += dt;
    let n = 0;
    while (this.acc >= 1 / 60 && n < 4) { this.world.step(); this.acc -= 1 / 60; n++; }
  }
}
