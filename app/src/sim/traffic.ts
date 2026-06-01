import { ecs, cars, type Car } from '../ecs/world-ecs';
import { LANE, ROAD_W, SEA_LEVEL, nearestRoadLineX, nearestRoadLineZ, roadHere, terrainHeight } from '../world/world';

// Traffic system — cars driving the road grid from world.ts. Lane-snapped to actual ROAD lines
// (not every grid line, now that blocks span several lots), reverse at road ends, turn only where a
// real crossing exists. Constant local population that respawns near the streaming focus. Density
// tuned down (roads are sparser now) so the grid doesn't feel jammed.
const TARGET = 60, PALETTE = 5;
// Cars spawn only in the far band [SPAWN_MIN, SPAWN_MAX] around the focus (SPAWN_MIN ≈ fog-start)
// so they appear in haze / behind the camera and drive INTO view — never popping in on-screen.
// SPAWN_MAX is kept a fixed margin beyond SPAWN_MIN so the band is always valid across tiers; MAXD
// (recycle distance) sits just beyond it.
let SPAWN_MIN = 95, SPAWN_MAX = 165, MAXD = 200;
export function setSpawnMin(d: number): void { SPAWN_MIN = d; SPAWN_MAX = d + 70; MAXD = d + 110; }

function rot(axis: 0 | 1, dir: 1 | -1): number {
  return axis === 0 ? (dir > 0 ? -Math.PI / 2 : Math.PI / 2) : (dir > 0 ? Math.PI : 0);
}
// lane centre offset from a road line: drive on the right, but never outside the asphalt half-width
const lane = (): number => Math.min(LANE, ROAD_W - 0.8);

// Try to place a car on a real road tile in the far band [SPAWN_MIN, SPAWN_MAX] around (fx,fz) —
// off screen / in fog. Returns a Car or null.
function trySpawn(fx: number, fz: number): Car | null {
  for (let i = 0; i < 24; i++) {
    const axis: 0 | 1 = Math.random() < 0.55 ? 1 : 0;
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const along = (Math.random() - 0.5) * SPAWN_MAX * 2;
    let x: number, z: number;
    if (axis === 1) { const lx = nearestRoadLineX(fx + (Math.random() - 0.5) * SPAWN_MAX * 2); x = lx + dir * lane(); z = fz + along; }
    else { const lz = nearestRoadLineZ(fz + (Math.random() - 0.5) * SPAWN_MAX * 2); z = lz + dir * lane(); x = fx + along; }
    const d = Math.hypot(x - fx, z - fz);
    if (d < SPAWN_MIN || d > SPAWN_MAX) continue; // keep spawns in the far off-screen band
    if (roadHere(x, z) && terrainHeight(x, z) >= SEA_LEVEL + 0.3) {
      return { x, z, y: terrainHeight(x, z) + 0.2, rot: rot(axis, dir), axis, dir, spd: 6 + Math.random() * 6, color: (Math.random() * PALETTE) | 0, turnedAt: null };
    }
  }
  return null;
}

function drive(c: Car, dt: number, fx: number, fz: number): void {
  const oxt = c.x, ozt = c.z;
  if (c.axis === 1) c.z += c.dir * c.spd * dt; else c.x += c.dir * c.spd * dt;
  // keep pinned to the nearest ROAD line of the cross axis
  if (c.axis === 1) { const lx = nearestRoadLineX(c.x); c.x = lx + c.dir * lane(); }
  else { const lz = nearestRoadLineZ(c.z); c.z = lz + c.dir * lane(); }
  // off-road (water / grass / gap) → revert and reverse
  if (terrainHeight(c.x, c.z) < SEA_LEVEL + 0.3 || !roadHere(c.x, c.z)) {
    c.x = oxt; c.z = ozt; c.dir = (-c.dir) as 1 | -1; c.turnedAt = null;
  }
  // turn at crossings: when the moving coord passes a road line of the OTHER axis
  const moving = c.axis === 1 ? c.z : c.x;
  const crossLine = c.axis === 1 ? nearestRoadLineZ(moving) : nearestRoadLineX(moving);
  if (Math.abs(moving - crossLine) < c.spd * dt * 1.2 && c.turnedAt !== crossLine) {
    c.turnedAt = crossLine;
    if (Math.random() < 0.4) {
      const na: 0 | 1 = c.axis === 1 ? 0 : 1;
      const nx = c.axis === 1 ? c.x : crossLine, nz = c.axis === 1 ? crossLine : c.z;
      const probe = ROAD_W + 4, dirs: Array<1 | -1> = [];
      for (const nd of [1, -1] as Array<1 | -1>) {
        if (roadHere(na === 0 ? nx + nd * probe : nx, na === 0 ? nz : nz + nd * probe)) dirs.push(nd);
      }
      if (dirs.length) { c.x = nx; c.z = nz; c.axis = na; c.dir = dirs[(Math.random() * dirs.length) | 0]; }
    }
  }
  c.y = terrainHeight(c.x, c.z) + 0.2;
  c.rot = rot(c.axis, c.dir);

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
