// world.mjs — canonical PURE world logic for VOXEL CITY. SINGLE SOURCE OF TRUTH.
// No THREE.js, no DOM, no rendering. Deterministic from SEED.
// Both the game (index.html) and the harness import THIS module directly — there is no
// inlined copy. harness.mjs --sync just asserts index.html still imports it (see checkInSync).

// ---------- constants ----------
export const SEED = 1337;
export const SEA_LEVEL = 0;
export const CHUNK = 48, SEG = 24, RADIUS = 4;
export const GRID_SP = 32, ROAD_W = 5, LANE = 2.2;
export const GRID_SP_T = 32;
export const HWY_EVERY = 6, HWY_W = 9;
// Sparser cross-streets: avenues run along Z on every grid line, but cross-streets
// (running along X) only exist every CROSS_EVERY lines -> long uninterrupted avenues,
// fewer crossroads, bigger connected blocks. Highways always carry a crossing.
export const CROSS_EVERY = 3;
export const ROAD_WATER_MARGIN = 1.5;

// ---------- seeded noise ----------
export function hash(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263 + SEED * 982451653) | 0;
  h = (h ^ (h >>> 13)) * 1274126177; h = h ^ (h >>> 16);
  return ((h >>> 0) / 4294967296);
}
export function smooth(t) { return t * t * (3 - 2 * t); }
export function valueNoise(x, z) {
  const x0 = Math.floor(x), z0 = Math.floor(z), fx = x - x0, fz = z - z0;
  const n00 = hash(x0, z0), n10 = hash(x0 + 1, z0), n01 = hash(x0, z0 + 1), n11 = hash(x0 + 1, z0 + 1);
  const u = smooth(fx), v = smooth(fz);
  const lerp = (a, b, t) => a + (b - a) * t;
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}
// per-block deterministic PRNG (mulberry32-style), seeded by coords + salt
export function rng(cx, cz, salt) {
  let a = (cx * 73856093) ^ (cz * 19349663) ^ (salt * 83492791) ^ SEED;
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// ---------- terrain ----------
export function terrainRaw(wx, wz) {
  let h = 0, amp = 1, freq = 0.006, sum = 0;
  for (let o = 0; o < 4; o++) { h += valueNoise(wx * freq, wz * freq) * amp; sum += amp; amp *= 0.5; freq *= 2.0; }
  h /= sum;
  return (Math.pow(h, 1.3) - 0.18) * 44;
}
export function citynessRaw(wx, wz) {
  const region = valueNoise(wx * 0.0009 + 100, wz * 0.0009 - 100);
  if (region < 0.52) return 0;
  const urban = (region - 0.52) / 0.48;
  const h = terrainRaw(wx, wz);
  const flat = 1 - Math.min(1, Math.abs(terrainRaw(wx + 6, wz) - h) / 6);
  const low = 1 - Math.min(1, Math.max(0, h) / 16);
  return Math.max(0, Math.min(1, (flat * 0.5 + low * 0.5) * urban));
}
export function cityness(wx, wz) { return citynessRaw(wx, wz); }
export function urbanCore(wx, wz) {
  const region = valueNoise(wx * 0.0009 + 100, wz * 0.0009 - 100);
  if (region < 0.52) return 0;
  const t = (region - 0.52) / 0.48;
  return Math.pow(Math.max(0, Math.min(1, t)), 1.6);
}
export function zone(wx, wz) {
  const core = urbanCore(wx, wz);
  const ind = valueNoise(wx * 0.0022 - 300, wz * 0.0022 + 220);
  if (ind > 0.66 && core < 0.55) return 2;
  if (core > 0.5) return 1;
  return 0;
}
export function blockLevel(wx, wz) {
  const gx0 = Math.floor(wx / GRID_SP_T) * GRID_SP_T, gz0 = Math.floor(wz / GRID_SP_T) * GRID_SP_T;
  const gx1 = gx0 + GRID_SP_T, gz1 = gz0 + GRID_SP_T;
  const tx = (wx - gx0) / GRID_SP_T, tz = (wz - gz0) / GRID_SP_T;
  const h00 = terrainRaw(gx0, gz0), h10 = terrainRaw(gx1, gz0), h01 = terrainRaw(gx0, gz1), h11 = terrainRaw(gx1, gz1);
  const a = h00 * (1 - tx) + h10 * tx, b = h01 * (1 - tx) + h11 * tx;
  return a * (1 - tz) + b * tz;
}
export function terrainHeight(wx, wz) {
  const raw = terrainRaw(wx, wz);
  const cn = citynessRaw(wx, wz);
  if (cn <= 0.12) return raw;
  const level = blockLevel(wx, wz);
  const k = Math.min(1, (cn - 0.12) / 0.4);
  return raw * (1 - k) + level * k;
}

// ---------- road grid ----------
export function nearestLine(v) { return Math.round(v / GRID_SP) * GRID_SP; }
export function isHighwayLine(c) { return (((Math.round(c / GRID_SP) % HWY_EVERY) + HWY_EVERY) % HWY_EVERY) === 0; }
export function roadHalfWidth(c) { return isHighwayLine(c) ? HWY_W : ROAD_W; }
// Cross-streets (horizontal roads, constant z) are sparse: only every CROSS_EVERY-th line
// carries one, plus every highway line. Avenues (vertical, constant x) run on every line.
// Result: long uninterrupted avenues, occasional crossroads, big connected blocks.
export function crossStreetLine(c) {
  if (isHighwayLine(c)) return true;
  return (((Math.round(c / GRID_SP) % CROSS_EVERY) + CROSS_EVERY) % CROSS_EVERY) === 0;
}
export function onRoadTile(wx, wz) {
  const lx = nearestLine(wx), lz = nearestLine(wz);
  const onV = Math.abs(wx - lx) <= roadHalfWidth(lx) + 2;
  const onH = crossStreetLine(lz) && Math.abs(wz - lz) <= roadHalfWidth(lz) + 2;
  return onV || onH;
}
export function groundOrBridge(wx, wz) { return Math.max(terrainHeight(wx, wz), SEA_LEVEL); }

// Road SURFACE before dead-end trimming. Bitmask of which road kind(s) cover (wx,wz):
//   1 = on an avenue (vertical line, every grid line) with city support;
//   2 = on a cross-street (horizontal, only every CROSS_EVERY-th line) with city support.
function roadCore(wx, wz) {
  const lx = nearestLine(wx), lz = nearestLine(wz);
  const onV = Math.abs(wx - lx) <= roadHalfWidth(lx);                       // avenue (every line)
  const onH = crossStreetLine(lz) && Math.abs(wz - lz) <= roadHalfWidth(lz); // cross-street (sparse)
  if (!onV && !onH) return 0;
  if (terrainHeight(wx, wz) < SEA_LEVEL + ROAD_WATER_MARGIN) return 0;
  let m = 0;
  if (onV) { const a = cityness(lx - GRID_SP / 2, wz), b = cityness(lx + GRID_SP / 2, wz); if (Math.max(a, b) >= 0.3) m |= 1; }
  if (onH) { const a = cityness(wx, lz - GRID_SP / 2), b = cityness(wx, lz + GRID_SP / 2); if (Math.max(a, b) >= 0.3) m |= 2; }
  return m;
}
// Nearest cross-street grid lines bracketing z (cross-streets are sparse; scan a bounded window).
const CROSS_SP = CROSS_EVERY * GRID_SP;            // cross-streets sit on multiples of this
// Is the avenue at lineX anchored by a REAL cross-street crossing on BOTH sides of wz, within a
// few blocks? Bridges small cityness gaps (a missing cross-street or two); only the dangling end
// PAST the outermost crossing fails the test -> gets trimmed. Keeps the connected interior intact.
function avenueBracketed(lineX, wz) {
  const base = Math.round(wz / CROSS_SP) * CROSS_SP;
  let below = false, above = false;
  for (let s = -3; s <= 3; s++) {
    const L = base + s * CROSS_SP;
    if (!(roadCore(lineX, L) & 2)) continue;       // a real cross-street passes through (lineX,L)
    if (L <= wz) below = true; if (L >= wz) above = true;
  }
  return below && above;
}
// Is the cross-street at lineZ anchored by a REAL avenue crossing on BOTH sides of wx?
function crossBracketed(wx, lineZ) {
  const base = Math.round(wx / GRID_SP) * GRID_SP;
  let left = false, right = false;
  for (let s = -3; s <= 3; s++) {
    const L = base + s * GRID_SP;
    if (!(roadCore(L, lineZ) & 1)) continue;       // a real avenue passes through (L,lineZ)
    if (L <= wx) left = true; if (L >= wx) right = true;
  }
  return left && right;
}

// THE single road predicate: drivable road surface at (wx,wz), with dead-end stubs trimmed.
// A tile counts as road only if its run is anchored by real crossings on both sides — so avenues
// stop cleanly at the outermost cross-street instead of fraying into countryside/water as a comb
// of stubs, and cross-streets stop at the outermost avenue. Brackets use the untrimmed roadCore
// (one level, no recursion) and scan a few blocks, so small cityness gaps bridge and the fully
// connected interior is unaffected.
export function roadHere(wx, wz) {
  const core = roadCore(wx, wz);
  if (!core) return false;
  const lx = nearestLine(wx), lz = nearestLine(wz);
  if ((core & 1) && avenueBracketed(lx, wz)) return true;   // avenue surface anchored along z
  if ((core & 2) && crossBracketed(wx, lz)) return true;    // cross-street surface anchored along x
  return false;
}
// Validated road model for a chunk.
export function buildRoadNetwork(cx, cz) {
  const ox = cx * CHUNK, oz = cz * CHUNK, STEP = 2;
  const segments = [], intersections = [];
  for (let lineX = Math.round((ox - CHUNK / 2) / GRID_SP) * GRID_SP - GRID_SP; lineX <= ox + CHUNK / 2 + GRID_SP; lineX += GRID_SP) {
    if (lineX < ox - CHUNK / 2 - 0.01 || lineX >= ox + CHUNK / 2 - 0.01) continue;
    const HW = roadHalfWidth(lineX), type = HW > ROAD_W ? 'hwy' : 'st';
    for (let z = oz - CHUNK / 2; z < oz + CHUNK / 2; z += STEP) {
      const zc = z + STEP / 2;
      if (!roadHere(lineX, zc)) continue;
      segments.push({ x: lineX, z, z2: z + STEP, vertical: true, hw: HW, type });
    }
  }
  for (let lineZ = Math.round((oz - CHUNK / 2) / GRID_SP) * GRID_SP - GRID_SP; lineZ <= oz + CHUNK / 2 + GRID_SP; lineZ += GRID_SP) {
    if (lineZ < oz - CHUNK / 2 - 0.01 || lineZ >= oz + CHUNK / 2 - 0.01) continue;
    const HW = roadHalfWidth(lineZ), type = HW > ROAD_W ? 'hwy' : 'st';
    for (let x = ox - CHUNK / 2; x < ox + CHUNK / 2; x += STEP) {
      const xc = x + STEP / 2;
      if (!roadHere(xc, lineZ)) continue;
      segments.push({ x, x2: x + STEP, z: lineZ, vertical: false, hw: HW, type });
    }
  }
  const gx0 = Math.floor((ox - CHUNK / 2) / GRID_SP) * GRID_SP, gx1 = Math.ceil((ox + CHUNK / 2) / GRID_SP) * GRID_SP;
  const gz0 = Math.floor((oz - CHUNK / 2) / GRID_SP) * GRID_SP, gz1 = Math.ceil((oz + CHUNK / 2) / GRID_SP) * GRID_SP;
  for (let lineX = gx0; lineX <= gx1; lineX += GRID_SP) {
    for (let lineZ = gz0; lineZ <= gz1; lineZ += GRID_SP) {
      if (!roadHere(lineX, lineZ)) continue;
      const vOK = roadHere(lineX, lineZ - GRID_SP / 2) || roadHere(lineX, lineZ + GRID_SP / 2);
      const hOK = roadHere(lineX - GRID_SP / 2, lineZ) || roadHere(lineX + GRID_SP / 2, lineZ);
      if (!(vOK && hOK)) continue;
      // Traffic light at "busy" crossroads: where a highway meets another road.
      const light = isHighwayLine(lineX) && isHighwayLine(lineZ); // major junctions only
      intersections.push({ x: lineX, z: lineZ, hwx: roadHalfWidth(lineX), hwz: roadHalfWidth(lineZ), light });
    }
  }
  return { segments, intersections };
}

// ---------- traffic signals (pure timing logic) ----------
// Functional signals at highway×highway junctions. Pure + deterministic from (ix,iz,t) so the
// renderer (lamp colour) and the simulation (which cars must stop) always agree, and so the
// harness can verify the state machine without a GPU.
export const TL_GREEN = 7, TL_YELLOW = 2, TL_HALF = TL_GREEN + TL_YELLOW, TL_CYCLE = TL_HALF * 2;
// Per-junction phase offset so the whole city doesn't switch in lockstep.
export function tlOffset(ix, iz) {
  const k = Math.round(ix / GRID_SP) * 7 + Math.round(iz / GRID_SP) * 13;
  return ((k % TL_CYCLE) + TL_CYCLE) % TL_CYCLE;
}
// Signal state for one travel axis at junction (ix,iz) at time t: 0=green, 1=yellow, 2=red.
// axis 0 (cars moving along X) and axis 1 (cars moving along Z) are a half-cycle apart, so the
// two directions are never green at the same time.
export function tlState(axis, ix, iz, t) {
  const phase = (((t + tlOffset(ix, iz)) % TL_CYCLE) + TL_CYCLE) % TL_CYCLE;
  const local = axis === 0 ? phase : (phase + TL_HALF) % TL_CYCLE;
  if (local < TL_GREEN) return 0;
  if (local < TL_HALF) return 1;
  return 2;
}

// ---------- buildings ----------
export function isPark(blockX, blockZ) {
  const pr = rng(Math.round(blockX), Math.round(blockZ), 23);
  return cityness(blockX, blockZ) > 0.2 && pr() < 0.16;
}
// SINGLE SOURCE OF TRUTH for building placement. null = no building, else full spec.
export function buildingAt(lx, lz) {
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
  let hgt;
  if (isLandmark) hgt = 80 + lr() * 60;
  else if (zn === 1) hgt = 12 + core * core * 70 + br() * 14;
  else if (zn === 2) hgt = 7 + br() * 8;
  else hgt = 6 + br() * (6 + core * 10);
  return { lx, lz, w, d, hw, hd, lowG, highG, isLandmark, hgt, zn, core, br };
}
// Collision: true if (x,z) is inside a building footprint. Same spec as geometry.
export function buildingFootprintAt(x, z) {
  const bx = Math.round((x - GRID_SP / 2) / GRID_SP) * GRID_SP + GRID_SP / 2;
  const bz = Math.round((z - GRID_SP / 2) / GRID_SP) * GRID_SP + GRID_SP / 2;
  const B = buildingAt(bx, bz);
  if (!B) return false;
  return Math.abs(x - bx) < B.hw + 1 && Math.abs(z - bz) < B.hd + 1;
}
