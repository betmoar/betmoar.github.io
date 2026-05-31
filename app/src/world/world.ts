// world.ts — canonical PURE world logic for VOXEL CITY 2. SINGLE SOURCE OF TRUTH.
// No three.js, no DOM, no rendering. Deterministic from SEED.
// 1:1 behavioral port of the legacy voxel-city/world.mjs — same SEED, same integer math.
// app/test/world.test.ts asserts this matches the captured golden baseline bit-for-bit.

// ---------- types ----------
export type Rng = () => number;
export interface RoadSegment {
  x: number; z: number; x2?: number; z2?: number;
  vertical: boolean; hw: number; type: 'hwy' | 'st';
}
export interface Intersection {
  x: number; z: number; hwx: number; hwz: number; light: boolean;
}
export interface RoadNetwork { segments: RoadSegment[]; intersections: Intersection[]; }
export interface BuildingSpec {
  lx: number; lz: number; w: number; d: number; hw: number; hd: number;
  lowG: number; highG: number; isLandmark: boolean; hgt: number;
  zn: number; core: number; br: Rng;
}

// ---------- constants ----------
export const SEED = 1337;
export const SEA_LEVEL = 0;
export const CHUNK = 48, SEG = 24, RADIUS = 4;
export const GRID_SP = 32, ROAD_W = 5, LANE = 2.2;
export const GRID_SP_T = 32;
export const HWY_EVERY = 6, HWY_W = 9;
// Sparser cross-streets: avenues run along Z on every grid line, but cross-streets
// (running along X) only exist every CROSS_EVERY lines -> long uninterrupted avenues.
export const CROSS_EVERY = 3;
export const ROAD_WATER_MARGIN = 1.5;

// ---------- seeded noise ----------
export function hash(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263 + SEED * 982451653) | 0;
  h = (h ^ (h >>> 13)) * 1274126177; h = h ^ (h >>> 16);
  return ((h >>> 0) / 4294967296);
}
export function smooth(t: number): number { return t * t * (3 - 2 * t); }
export function valueNoise(x: number, z: number): number {
  const x0 = Math.floor(x), z0 = Math.floor(z), fx = x - x0, fz = z - z0;
  const n00 = hash(x0, z0), n10 = hash(x0 + 1, z0), n01 = hash(x0, z0 + 1), n11 = hash(x0 + 1, z0 + 1);
  const u = smooth(fx), v = smooth(fz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}
// per-block deterministic PRNG (mulberry32-style), seeded by coords + salt
export function rng(cx: number, cz: number, salt: number): Rng {
  let a = (cx * 73856093) ^ (cz * 19349663) ^ (salt * 83492791) ^ SEED;
  return function (): number {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------- terrain ----------
export function terrainRaw(wx: number, wz: number): number {
  let h = 0, amp = 1, freq = 0.006, sum = 0;
  for (let o = 0; o < 4; o++) { h += valueNoise(wx * freq, wz * freq) * amp; sum += amp; amp *= 0.5; freq *= 2.0; }
  h /= sum;
  return (Math.pow(h, 1.3) - 0.18) * 44;
}
export function citynessRaw(wx: number, wz: number): number {
  const region = valueNoise(wx * 0.0009 + 100, wz * 0.0009 - 100);
  if (region < 0.52) return 0;
  const urban = (region - 0.52) / 0.48;
  const h = terrainRaw(wx, wz);
  const flat = 1 - Math.min(1, Math.abs(terrainRaw(wx + 6, wz) - h) / 6);
  const low = 1 - Math.min(1, Math.max(0, h) / 16);
  return Math.max(0, Math.min(1, (flat * 0.5 + low * 0.5) * urban));
}
export function cityness(wx: number, wz: number): number { return citynessRaw(wx, wz); }
export function urbanCore(wx: number, wz: number): number {
  const region = valueNoise(wx * 0.0009 + 100, wz * 0.0009 - 100);
  if (region < 0.52) return 0;
  const t = (region - 0.52) / 0.48;
  return Math.pow(Math.max(0, Math.min(1, t)), 1.6);
}
export function zone(wx: number, wz: number): number {
  const core = urbanCore(wx, wz);
  const ind = valueNoise(wx * 0.0022 - 300, wz * 0.0022 + 220);
  if (ind > 0.66 && core < 0.55) return 2;
  if (core > 0.5) return 1;
  return 0;
}
export function blockLevel(wx: number, wz: number): number {
  const gx0 = Math.floor(wx / GRID_SP_T) * GRID_SP_T, gz0 = Math.floor(wz / GRID_SP_T) * GRID_SP_T;
  const gx1 = gx0 + GRID_SP_T, gz1 = gz0 + GRID_SP_T;
  const tx = (wx - gx0) / GRID_SP_T, tz = (wz - gz0) / GRID_SP_T;
  const h00 = terrainRaw(gx0, gz0), h10 = terrainRaw(gx1, gz0), h01 = terrainRaw(gx0, gz1), h11 = terrainRaw(gx1, gz1);
  const a = h00 * (1 - tx) + h10 * tx, b = h01 * (1 - tx) + h11 * tx;
  return a * (1 - tz) + b * tz;
}
export function terrainHeight(wx: number, wz: number): number {
  const raw = terrainRaw(wx, wz);
  const cn = citynessRaw(wx, wz);
  if (cn <= 0.12) return raw;
  const level = blockLevel(wx, wz);
  const k = Math.min(1, (cn - 0.12) / 0.4);
  return raw * (1 - k) + level * k;
}

// ---------- road grid (variable-size blocks; roads only between blocks) ----------
// Building lots sit on the fine GRID_SP lattice. Roads run on a COARSER, deterministically VARIABLE
// lattice so each city block holds 2–4 lots (multiple buildings) rather than a crossroad at every
// lot. Per axis, grid lines are grouped into bands of BAND lines; each band contributes exactly one
// road line at a hashed offset, giving block widths of 2–4 lots that differ between X and Z (so
// blocks are rectangular and varied, not a uniform square mesh).
const BAND = 3;           // lines per band → one road line each → blocks span 2..4 lots
const SALT_RX = 1001, SALT_RZ = 2002, SALT_HX = 3003, SALT_HZ = 4004;
const ROAD_CITY_MIN = 0.18;

export function nearestLine(v: number): number { return Math.round(v / GRID_SP) * GRID_SP; }

// The single road-line index contributed by band `b` on each axis (offset 0 or 1 within the band).
function roadIdxX(b: number): number { return b * BAND + (hash(b, SALT_RX) < 0.5 ? 0 : 1); }
function roadIdxZ(b: number): number { return b * BAND + (hash(b, SALT_RZ) < 0.5 ? 0 : 1); }
// Is the grid line at world coord `c` a road line on this axis?
export function isRoadLineX(c: number): boolean { const i = Math.round(c / GRID_SP); return i === roadIdxX(Math.floor(i / BAND)); }
export function isRoadLineZ(c: number): boolean { const i = Math.round(c / GRID_SP); return i === roadIdxZ(Math.floor(i / BAND)); }
// Nearest road line (world coord) on each axis — for snapping traffic/peds to actual roads.
export function nearestRoadLineX(x: number): number {
  const bb = Math.floor(x / GRID_SP / BAND); let best = 0, bd = Infinity;
  for (let b = bb - 1; b <= bb + 1; b++) { const line = roadIdxX(b) * GRID_SP, d = Math.abs(line - x); if (d < bd) { bd = d; best = line; } }
  return best;
}
export function nearestRoadLineZ(z: number): number {
  const bb = Math.floor(z / GRID_SP / BAND); let best = 0, bd = Infinity;
  for (let b = bb - 1; b <= bb + 1; b++) { const line = roadIdxZ(b) * GRID_SP, d = Math.abs(line - z); if (d < bd) { bd = d; best = line; } }
  return best;
}
// Highways: a sparser subset of road lines (wider). Signals sit at highway×highway junctions.
export function isHighwayLine(c: number): boolean {
  const i = Math.round(c / GRID_SP); const b = Math.floor(i / BAND);
  // only on a road line, and only ~every 4th band
  return (isRoadLineX(c) || isRoadLineZ(c)) && hash(b, SALT_HX) < 0.22;
}
function isHwyX(c: number): boolean { const b = Math.floor(Math.round(c / GRID_SP) / BAND); return hash(b, SALT_HX) < 0.22; }
function isHwyZ(c: number): boolean { const b = Math.floor(Math.round(c / GRID_SP) / BAND); return hash(b, SALT_HZ) < 0.22; }
export function roadHalfWidth(c: number): number { return (isHwyX(c) || isHwyZ(c)) ? HWY_W : ROAD_W; }
// Kept for API compatibility (used to gate cross-streets); now any road line on the Z axis.
export function crossStreetLine(c: number): boolean { return isRoadLineZ(c); }

function supportV(lineX: number, wz: number): boolean {
  return Math.max(cityness(lineX - GRID_SP / 2, wz), cityness(lineX + GRID_SP / 2, wz)) >= ROAD_CITY_MIN;
}
function supportH(wx: number, lineZ: number): boolean {
  return Math.max(cityness(wx, lineZ - GRID_SP / 2), cityness(wx, lineZ + GRID_SP / 2)) >= ROAD_CITY_MIN;
}

export function onRoadTile(wx: number, wz: number): boolean {
  const lx = nearestLine(wx), lz = nearestLine(wz);
  const onV = isRoadLineX(lx) && Math.abs(wx - lx) <= roadHalfWidth(lx) + 2;
  const onH = isRoadLineZ(lz) && Math.abs(wz - lz) <= roadHalfWidth(lz) + 2;
  return onV || onH;
}
export function groundOrBridge(wx: number, wz: number): number { return Math.max(terrainHeight(wx, wz), SEA_LEVEL); }

// THE single road predicate: drivable surface at (wx,wz). On a road line, supported by city, dry.
export function roadHere(wx: number, wz: number): boolean {
  if (terrainHeight(wx, wz) < SEA_LEVEL + ROAD_WATER_MARGIN) return false;
  const lx = nearestLine(wx), lz = nearestLine(wz);
  if (isRoadLineX(lx) && Math.abs(wx - lx) <= roadHalfWidth(lx) && supportV(lx, wz)) return true; // avenue
  if (isRoadLineZ(lz) && Math.abs(wz - lz) <= roadHalfWidth(lz) && supportH(wx, lz)) return true; // cross-street
  return false;
}
// Validated road model for a chunk — iterate only the ROAD lines, not every grid line.
export function buildRoadNetwork(cx: number, cz: number): RoadNetwork {
  const ox = cx * CHUNK, oz = cz * CHUNK, STEP = 2;
  const segments: RoadSegment[] = [], intersections: Intersection[] = [];
  for (let lineX = Math.round((ox - CHUNK / 2) / GRID_SP) * GRID_SP - GRID_SP; lineX <= ox + CHUNK / 2 + GRID_SP; lineX += GRID_SP) {
    if (lineX < ox - CHUNK / 2 - 0.01 || lineX >= ox + CHUNK / 2 - 0.01) continue;
    if (!isRoadLineX(lineX)) continue;
    const HW = roadHalfWidth(lineX), type: 'hwy' | 'st' = HW > ROAD_W ? 'hwy' : 'st';
    for (let z = oz - CHUNK / 2; z < oz + CHUNK / 2; z += STEP) {
      const zc = z + STEP / 2;
      if (!roadHere(lineX, zc)) continue;
      segments.push({ x: lineX, z, z2: z + STEP, vertical: true, hw: HW, type });
    }
  }
  for (let lineZ = Math.round((oz - CHUNK / 2) / GRID_SP) * GRID_SP - GRID_SP; lineZ <= oz + CHUNK / 2 + GRID_SP; lineZ += GRID_SP) {
    if (lineZ < oz - CHUNK / 2 - 0.01 || lineZ >= oz + CHUNK / 2 - 0.01) continue;
    if (!isRoadLineZ(lineZ)) continue;
    const HW = roadHalfWidth(lineZ), type: 'hwy' | 'st' = HW > ROAD_W ? 'hwy' : 'st';
    for (let x = ox - CHUNK / 2; x < ox + CHUNK / 2; x += STEP) {
      const xc = x + STEP / 2;
      if (!roadHere(xc, lineZ)) continue;
      segments.push({ x, x2: x + STEP, z: lineZ, vertical: false, hw: HW, type });
    }
  }
  const gx0 = Math.floor((ox - CHUNK / 2) / GRID_SP) * GRID_SP, gx1 = Math.ceil((ox + CHUNK / 2) / GRID_SP) * GRID_SP;
  const gz0 = Math.floor((oz - CHUNK / 2) / GRID_SP) * GRID_SP, gz1 = Math.ceil((oz + CHUNK / 2) / GRID_SP) * GRID_SP;
  for (let lineX = gx0; lineX <= gx1; lineX += GRID_SP) {
    if (!isRoadLineX(lineX)) continue;
    for (let lineZ = gz0; lineZ <= gz1; lineZ += GRID_SP) {
      if (!isRoadLineZ(lineZ)) continue;
      if (!roadHere(lineX, lineZ)) continue;
      const vOK = roadHere(lineX, lineZ - GRID_SP / 2) || roadHere(lineX, lineZ + GRID_SP / 2);
      const hOK = roadHere(lineX - GRID_SP / 2, lineZ) || roadHere(lineX + GRID_SP / 2, lineZ);
      if (!(vOK && hOK)) continue;
      const light = isHwyX(lineX) && isHwyZ(lineZ);
      intersections.push({ x: lineX, z: lineZ, hwx: roadHalfWidth(lineX), hwz: roadHalfWidth(lineZ), light });
    }
  }
  return { segments, intersections };
}

// ---------- traffic signals (pure timing logic) ----------
export const TL_GREEN = 7, TL_YELLOW = 2, TL_HALF = TL_GREEN + TL_YELLOW, TL_CYCLE = TL_HALF * 2;
export function tlOffset(ix: number, iz: number): number {
  const k = Math.round(ix / GRID_SP) * 7 + Math.round(iz / GRID_SP) * 13;
  return ((k % TL_CYCLE) + TL_CYCLE) % TL_CYCLE;
}
export function tlState(axis: number, ix: number, iz: number, t: number): number {
  const phase = (((t + tlOffset(ix, iz)) % TL_CYCLE) + TL_CYCLE) % TL_CYCLE;
  const local = axis === 0 ? phase : (phase + TL_HALF) % TL_CYCLE;
  if (local < TL_GREEN) return 0;
  if (local < TL_HALF) return 1;
  return 2;
}

// ---------- buildings ----------
export function isPark(blockX: number, blockZ: number): boolean {
  const pr = rng(Math.round(blockX), Math.round(blockZ), 23);
  return cityness(blockX, blockZ) > 0.2 && pr() < 0.16;
}
// SINGLE SOURCE OF TRUTH for building placement. null = no building, else full spec.
export function buildingAt(lx: number, lz: number): BuildingSpec | null {
  if (onRoadTile(lx, lz)) return null;
  if (isPark(lx, lz)) return null;
  const cn = cityness(lx, lz);
  const core = urbanCore(lx, lz);
  const zn = zone(lx, lz);
  const br = rng(Math.round(lx), Math.round(lz), 11);
  const density = zn === 1 ? Math.min(1, 0.55 + core * 0.5)
    : zn === 2 ? 0.6
    : Math.min(0.75, cn * 0.7 + 0.15);
  if (br() > density) return null;
  const room = GRID_SP - 2 * ROAD_W - 3;
  const fillBase = zn === 0 ? 0.45 : zn === 2 ? 0.7 : 0.6;
  const w = Math.max(4, room * (fillBase + br() * 0.35));
  const d = Math.max(4, room * (fillBase + br() * 0.35));
  const hw = w / 2, hd = d / 2;
  const c1 = terrainHeight(lx - hw, lz - hd), c2 = terrainHeight(lx + hw, lz - hd),
    c3 = terrainHeight(lx - hw, lz + hd), c4 = terrainHeight(lx + hw, lz + hd);
  const lowG = Math.min(c1, c2, c3, c4), highG = Math.max(c1, c2, c3, c4);
  if (lowG < SEA_LEVEL + 0.5) return null;
  if (highG - lowG > 6) return null;
  const lr = rng(Math.round(lx), Math.round(lz), 41);
  const isLandmark = core > 0.78 && lr() < 0.10;
  let hgt: number;
  if (isLandmark) hgt = 80 + lr() * 60;
  else if (zn === 1) hgt = 12 + core * core * 70 + br() * 14;
  else if (zn === 2) hgt = 7 + br() * 8;
  else hgt = 6 + br() * (6 + core * 10);
  return { lx, lz, w, d, hw, hd, lowG, highG, isLandmark, hgt, zn, core, br };
}
// Collision: true if (x,z) is inside a building footprint. Same spec as geometry.
export function buildingFootprintAt(x: number, z: number): boolean {
  const bx = Math.round((x - GRID_SP / 2) / GRID_SP) * GRID_SP + GRID_SP / 2;
  const bz = Math.round((z - GRID_SP / 2) / GRID_SP) * GRID_SP + GRID_SP / 2;
  const B = buildingAt(bx, bz);
  if (!B) return false;
  return Math.abs(x - bx) < B.hw + 1 && Math.abs(z - bz) < B.hd + 1;
}
