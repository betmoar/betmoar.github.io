import { ecs, peds, type Ped } from '../ecs/world-ecs';
import { SEA_LEVEL, nearestLine, roadHalfWidth, roadHere, terrainHeight, buildingFootprintAt } from '../world/world';

// Pedestrian system — peds walk the sidewalk strip just off the avenue edge (never on the asphalt,
// never in water or inside a building footprint), reversing at obstacles, with a walk-bob phase.
// Constant local population that respawns near the streaming focus. Authored character meshes
// (skinned glTF + AnimationMixer) replace the box humanoids at M4-content time.
const TARGET = 150, RANGE = 110, MAXD = 170, PALETTE = 5;

function placeable(x: number, z: number): boolean {
  return terrainHeight(x, z) >= SEA_LEVEL + 0.3 && !roadHere(x, z) && !buildingFootprintAt(x, z);
}

function trySpawn(fx: number, fz: number): Ped | null {
  for (let i = 0; i < 16; i++) {
    const lineX = nearestLine(fx + (Math.random() - 0.5) * RANGE * 2);
    const side = Math.random() < 0.5 ? 1 : -1;
    const x = lineX + side * (roadHalfWidth(lineX) + 1.4); // sidewalk, just off the road edge
    const z = fz + (Math.random() - 0.5) * RANGE * 2;
    if (placeable(x, z)) {
      const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      return { x, z, y: terrainHeight(x, z) + 0.0, rot: dir > 0 ? Math.PI : 0, dir, spd: 1.1 + Math.random() * 0.8, phase: Math.random() * 6.28, color: (Math.random() * PALETTE) | 0 };
    }
  }
  return null;
}

function walk(p: Ped, dt: number, fx: number, fz: number): void {
  const oz = p.z;
  p.z += p.dir * p.spd * dt;
  if (!placeable(p.x, p.z)) { p.z = oz; p.dir = (-p.dir) as 1 | -1; p.rot = p.dir > 0 ? Math.PI : 0; }
  p.phase += dt * 6;
  p.y = terrainHeight(p.x, p.z);
  if (Math.hypot(p.x - fx, p.z - fz) > MAXD) {
    const fresh = trySpawn(fx, fz);
    if (fresh) Object.assign(p, fresh);
  }
}

export function updatePeds(dt: number, fx: number, fz: number): void {
  for (let i = peds.entities.length; i < TARGET; i++) {
    const p = trySpawn(fx, fz);
    if (p) ecs.add({ ped: p }); else break;
  }
  for (const e of peds) walk(e.ped, dt, fx, fz);
}
