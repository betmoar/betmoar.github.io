// harness.test.ts — the regression invariants ported from voxel-city/harness.mjs, now over
// the TS world module. Pure data checks (no GPU): traffic signals, road/water/terrain/building
// relationships, and the single-source-of-truth collision==geometry guard. Plus an evolved
// anti-drift check: no module outside world/world.ts may re-declare a world function.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as W from '../src/world/world';

type Result = { pass: boolean; detail?: string };
type Chunk = { cx: number; cz: number; net: W.RoadNetwork };

function findPopulatedChunks(limit = 8): Chunk[] {
  const out: Chunk[] = [];
  for (let cx = 0; cx < 200 && out.length < limit; cx++) {
    for (let cz = 0; cz < 200 && out.length < limit; cz++) {
      const net = W.buildRoadNetwork(cx, cz);
      if (net.segments.length > 0) out.push({ cx, cz, net });
    }
  }
  return out;
}
const chunks = findPopulatedChunks(8);

// crosswalk params — must match the renderer's layout
const STRIPE = 0.35, GAPB = 0.45, NB = 4;
const BAR_LONG = 1.8, BAR_W = 0.5, BAR_GAP = 0.55;

function inv_noRoadOverWater(cs: Chunk[]): Result {
  for (const { net } of cs) for (const s of net.segments) {
    const mx = s.vertical ? s.x : (s.x + s.x2!) / 2;
    const mz = s.vertical ? (s.z + s.z2!) / 2 : s.z;
    if (W.terrainHeight(mx, mz) < W.SEA_LEVEL + W.ROAD_WATER_MARGIN)
      return { pass: false, detail: `segment at (${mx.toFixed(1)},${mz.toFixed(1)}) over water` };
  }
  return { pass: true };
}
function inv_intersectionsAreRealCrossings(cs: Chunk[]): Result {
  for (const { net } of cs) for (const it of net.intersections) {
    const v = W.roadHere(it.x, it.z - W.GRID_SP / 2) || W.roadHere(it.x, it.z + W.GRID_SP / 2);
    const h = W.roadHere(it.x - W.GRID_SP / 2, it.z) || W.roadHere(it.x + W.GRID_SP / 2, it.z);
    if (!(v && h)) return { pass: false, detail: `fake intersection at (${it.x},${it.z})` };
  }
  return { pass: true };
}
function inv_crosswalkStripesOverWater(cs: Chunk[]): Result {
  for (const { net } of cs) for (const it of net.intersections)
    for (const dir of [-1, 1]) for (let i = 0; i < NB; i++) {
      const zc = it.z + dir * (it.hwz + 0.6 + i * (STRIPE + GAPB));
      if (W.roadHere(it.x, zc) && W.terrainHeight(it.x, zc) < W.SEA_LEVEL + W.ROAD_WATER_MARGIN)
        return { pass: false, detail: `crosswalk stripe at (${it.x},${zc.toFixed(1)}) over water` };
    }
  return { pass: true };
}
function inv_roadAboveTerrain(cs: Chunk[]): Result {
  const O_ASPH = 0.30;
  const meshAt = (x: number, z: number) => {
    const vx0 = Math.floor(x / 2) * 2, vz0 = Math.floor(z / 2) * 2, vx1 = vx0 + 2, vz1 = vz0 + 2;
    const tx = (x - vx0) / 2, tz = (z - vz0) / 2;
    return (W.terrainHeight(vx0, vz0) * (1 - tx) + W.terrainHeight(vx1, vz0) * tx) * (1 - tz)
      + (W.terrainHeight(vx0, vz1) * (1 - tx) + W.terrainHeight(vx1, vz1) * tx) * tz;
  };
  for (const { net } of cs) for (const s of net.segments.slice(0, 40)) {
    const cx = s.vertical ? s.x : (s.x + s.x2!) / 2;
    const cz = s.vertical ? (s.z + s.z2!) / 2 : s.z;
    for (let ddx = -s.hw; ddx <= s.hw; ddx += 1) for (let ddz = -1; ddz <= 1; ddz += 1) {
      const x = cx + (s.vertical ? ddx : ddz), z = cz + (s.vertical ? ddz : ddx);
      const road = Math.max(W.terrainHeight(x, z), W.SEA_LEVEL) + O_ASPH;
      if (road - meshAt(x, z) < -0.001)
        return { pass: false, detail: `terrain pokes road at (${x.toFixed(1)},${z.toFixed(1)})` };
    }
  }
  return { pass: true };
}
function inv_noBuildingOnRoad(cs: Chunk[]): Result {
  for (const { cx, cz } of cs) {
    const ox = cx * W.CHUNK, oz = cz * W.CHUNK;
    for (let bx = Math.floor((ox - W.CHUNK / 2) / W.GRID_SP) * W.GRID_SP; bx < ox + W.CHUNK / 2; bx += W.GRID_SP)
      for (let bz = Math.floor((oz - W.CHUNK / 2) / W.GRID_SP) * W.GRID_SP; bz < oz + W.CHUNK / 2; bz += W.GRID_SP) {
        const cxC = bx + W.GRID_SP / 2, czC = bz + W.GRID_SP / 2;
        if (W.cityness(cxC, czC) < 0.3) continue;
        if (W.onRoadTile(cxC, czC) && W.roadHere(cxC, czC))
          return { pass: false, detail: `block centre (${cxC},${czC}) on a road` };
      }
  }
  return { pass: true };
}
function inv_collisionMatchesGeometry(cs: Chunk[]): Result {
  for (const { cx, cz } of cs) {
    const ox = cx * W.CHUNK, oz = cz * W.CHUNK;
    for (let bx = Math.floor((ox - W.CHUNK / 2) / W.GRID_SP) * W.GRID_SP + W.GRID_SP / 2; bx < ox + W.CHUNK / 2; bx += W.GRID_SP)
      for (let bz = Math.floor((oz - W.CHUNK / 2) / W.GRID_SP) * W.GRID_SP + W.GRID_SP / 2; bz < oz + W.CHUNK / 2; bz += W.GRID_SP) {
        const B = W.buildingAt(bx, bz);
        if (B) {
          if (!W.buildingFootprintAt(bx, bz)) return { pass: false, detail: `centre (${bx},${bz}) has building but no collision` };
          if (W.buildingFootprintAt(bx + B.hw + 3, bz)) return { pass: false, detail: `collision leaks past footprint at (${bx},${bz})` };
        } else if (W.buildingFootprintAt(bx, bz)) {
          return { pass: false, detail: `collision at (${bx},${bz}) with no building` };
        }
      }
  }
  return { pass: true };
}
function inv_crosswalkStripesOnRoad(cs: Chunk[]): Result {
  for (const { net } of cs) for (const it of net.intersections) {
    const { x, z, hwx, hwz } = it;
    for (const dir of [-1, 1]) {
      const bandZ = z + dir * (hwz + 0.4 + BAR_LONG / 2);
      if (!W.roadHere(x, bandZ)) continue;
      for (let bx = -hwx + 0.8; bx <= hwx - 0.8 + 1e-6; bx += BAR_W + BAR_GAP) {
        const cxb = x + bx;
        let drawn = true; for (let t = -1; t <= 1.0001; t += 0.25) if (!W.roadHere(cxb, bandZ + t * BAR_LONG / 2)) { drawn = false; break; }
        if (!drawn) continue;
        for (let t = -1; t <= 1.0001; t += 0.25)
          if (!W.roadHere(cxb, bandZ + t * BAR_LONG / 2))
            return { pass: false, detail: `N/S zebra bar off-road near (${cxb.toFixed(1)},${bandZ.toFixed(1)})` };
      }
    }
    for (const dir of [-1, 1]) {
      const bandX = x + dir * (hwx + 0.4 + BAR_LONG / 2);
      if (!W.roadHere(bandX, z)) continue;
      for (let bz = -hwz + 0.8; bz <= hwz - 0.8 + 1e-6; bz += BAR_W + BAR_GAP) {
        const czb = z + bz;
        let drawn = true; for (let t = -1; t <= 1.0001; t += 0.25) if (!W.roadHere(bandX + t * BAR_LONG / 2, czb)) { drawn = false; break; }
        if (!drawn) continue;
        for (let t = -1; t <= 1.0001; t += 0.25)
          if (!W.roadHere(bandX + t * BAR_LONG / 2, czb))
            return { pass: false, detail: `E/W zebra bar off-road near (${bandX.toFixed(1)},${czb.toFixed(1)})` };
      }
    }
  }
  return { pass: true };
}
function inv_finiteHeights(cs: Chunk[]): Result {
  for (const { cx, cz } of cs) {
    const ox = cx * W.CHUNK, oz = cz * W.CHUNK;
    for (let x = ox - W.CHUNK / 2; x < ox + W.CHUNK / 2; x += 4)
      for (let z = oz - W.CHUNK / 2; z < oz + W.CHUNK / 2; z += 4)
        if (!Number.isFinite(W.terrainHeight(x, z)))
          return { pass: false, detail: `non-finite terrain at (${x},${z})` };
  }
  return { pass: true };
}
function inv_signalsNeverBothGreen(): Result {
  for (const [ix, iz] of [[0, 0], [192, 192], [192, -384]])
    for (let t = 0; t < W.TL_CYCLE; t += 0.25)
      if (W.tlState(0, ix, iz, t) === 0 && W.tlState(1, ix, iz, t) === 0)
        return { pass: false, detail: `both axes green @(${ix},${iz}) t=${t.toFixed(2)}` };
  return { pass: true };
}
function inv_signalsCycle(): Result {
  for (const axis of [0, 1]) {
    const seen = new Set<number>();
    for (let t = 0; t < W.TL_CYCLE; t += 0.25) seen.add(W.tlState(axis, 0, 0, t));
    if (!(seen.has(0) && seen.has(1) && seen.has(2)))
      return { pass: false, detail: `axis ${axis} states seen: ${[...seen].join(',')}` };
  }
  return { pass: true };
}

describe('world invariants (over populated chunks)', () => {
  it('found populated chunks to test', () => { expect(chunks.length).toBeGreaterThan(0); });

  const checks: Array<[string, () => Result]> = [
    ['signals never both green', inv_signalsNeverBothGreen],
    ['signals cycle through green/yellow/red', inv_signalsCycle],
    ['no road over water', () => inv_noRoadOverWater(chunks)],
    ['intersections are real crossings', () => inv_intersectionsAreRealCrossings(chunks)],
    ['crosswalk stripes never over water', () => inv_crosswalkStripesOverWater(chunks)],
    ['road surface clears terrain (no poke-through)', () => inv_roadAboveTerrain(chunks)],
    ['no building on a road', () => inv_noBuildingOnRoad(chunks)],
    ['collision matches geometry (single source of truth)', () => inv_collisionMatchesGeometry(chunks)],
    ['crosswalk stripes fully on road (no overhang)', () => inv_crosswalkStripesOnRoad(chunks)],
    ['terrain heights finite', () => inv_finiteHeights(chunks)],
  ];
  for (const [name, fn] of checks) {
    it(name, () => { const r = fn(); expect(r.pass, r.detail).toBe(true); });
  }
});

// Anti-drift: world predicates live ONLY in world/world.ts. No other src module may re-declare
// one (a shadowing copy is exactly how the game and tests once drifted). Evolved from the old
// "grep index.html" sync check to scan the whole TS source tree.
describe('single-source-of-truth (no re-declared world functions)', () => {
  const WORLD_FNS = ['hash', 'smooth', 'valueNoise', 'rng', 'terrainRaw', 'citynessRaw', 'cityness',
    'urbanCore', 'zone', 'blockLevel', 'terrainHeight', 'nearestLine', 'isHighwayLine', 'roadHalfWidth',
    'crossStreetLine', 'onRoadTile', 'groundOrBridge', 'roadHere', 'buildRoadNetwork', 'tlOffset',
    'tlState', 'isPark', 'buildingAt', 'buildingFootprintAt'];
  const srcDir = fileURLToPath(new URL('../src', import.meta.url));
  const worldPath = fileURLToPath(new URL('../src/world/world.ts', import.meta.url));

  it('no module outside world/world.ts re-declares a world function', () => {
    const files = (readdirSync(srcDir, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.ts'))
      .map((f) => `${srcDir}/${f}`)
      .filter((f) => f !== worldPath);
    const offenders: string[] = [];
    for (const f of files) {
      const code = readFileSync(f, 'utf8');
      for (const fn of WORLD_FNS) {
        if (new RegExp(`function\\s+${fn}\\s*\\(`).test(code)) offenders.push(`${fn} in ${f}`);
      }
    }
    expect(offenders, offenders.join('; ')).toEqual([]);
  });
});
