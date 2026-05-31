import { ecs, cars, type Car } from '../ecs/world-ecs';
import { LANE, ROAD_W, SEA_LEVEL, nearestLine, roadHere, terrainHeight } from '../world/world';

// Traffic system — a pool of cars driving the road grid from world.ts. Lane-snapped, reverses at
// road ends, and only turns where a real crossing exists (the v0.2.3 rule, so cars never cross onto
// grass). Cars that drift beyond MAXD respawn near the focus, keeping a constant local population.
// Ported from the legacy traffic loop; light-gating is deferred. Movement is the game's arcade
// model (not Rapier yet) — physics arrives with the rest of M5.
const TARGET = 120, RANGE = 130, MAXD = 200, PALETTE = 5;

function rot(axis: 0 | 1, dir: 1 | -1): number {
  return axis === 0 ? (dir > 0 ? -Math.PI / 2 : Math.PI / 2) : (dir > 0 ? Math.PI : 0);
}

// Try to place a car on a real road tile near (fx,fz). Returns a Car or null.
function trySpawn(fx: number, fz: number): Car | null {
  for (let i = 0; i < 16; i++) {
    const axis: 0 | 1 = Math.random() < 0.75 ? 1 : 0; // avenues (axis 1) are far more common
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const along = (Math.random() - 0.5) * RANGE * 2;
    let x: number, z: number;
    if (axis === 1) { x = nearestLine(fx + (Math.random() - 0.5) * RANGE * 2) + dir * LANE; z = fz + along; }
    else { z = nearestLine(fz + (Math.random() - 0.5) * RANGE * 2) + dir * LANE; x = fx + along; }
    if (roadHere(x, z) && terrainHeight(x, z) >= SEA_LEVEL + 0.3) {
      return { x, z, y: terrainHeight(x, z) + 0.2, rot: rot(axis, dir), axis, dir, spd: 6 + Math.random() * 6, color: (Math.random() * PALETTE) | 0, turnedAt: null };
    }
  }
  return null;
}

function drive(c: Car, dt: number, fx: number, fz: number): void {
  const oxt = c.x, ozt = c.z;
  if (c.axis === 1) c.z += c.dir * c.spd * dt; else c.x += c.dir * c.spd * dt;
  if (c.axis === 1) c.x = nearestLine(c.x) + c.dir * LANE; else c.z = nearestLine(c.z) + c.dir * LANE;
  // off-road (water / grass / gap) → revert and reverse
  if (terrainHeight(c.x, c.z) < SEA_LEVEL + 0.3 || !roadHere(c.x, c.z)) {
    c.x = oxt; c.z = ozt; c.dir = (-c.dir) as 1 | -1; c.turnedAt = null;
  }
  const moving = c.axis === 1 ? c.z : c.x;
  const line = nearestLine(moving);
  if (Math.abs(moving - line) < c.spd * dt * 0.9 && c.turnedAt !== line) {
    c.turnedAt = line;
    if (Math.random() < 0.35) {
      const na: 0 | 1 = c.axis === 1 ? 0 : 1;
      const nx = c.axis === 1 ? c.x : line, nz = c.axis === 1 ? line : c.z;
      const probe = ROAD_W + 3, dirs: Array<1 | -1> = [];
      for (const nd of [1, -1] as Array<1 | -1>) {
        if (roadHere(na === 0 ? nx + nd * probe : nx, na === 0 ? nz : nz + nd * probe)) dirs.push(nd);
      }
      if (dirs.length) { c.x = nx; c.z = nz; c.axis = na; c.dir = dirs[(Math.random() * dirs.length) | 0]; }
    }
  }
  c.y = terrainHeight(c.x, c.z) + 0.2;
  c.rot = rot(c.axis, c.dir);

  // recycle if it wandered too far from the streaming focus
  if (Math.hypot(c.x - fx, c.z - fz) > MAXD) {
    const fresh = trySpawn(fx, fz);
    if (fresh) Object.assign(c, fresh);
  }
}

export function updateTraffic(dt: number, fx: number, fz: number): void {
  for (let i = cars.entities.length; i < TARGET; i++) {
    const c = trySpawn(fx, fz);
    if (c) ecs.add({ car: c }); else break;
  }
  for (const e of cars) drive(e.car, dt, fx, fz);
}
