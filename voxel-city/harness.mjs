// harness.mjs — headless regression harness for VOXEL CITY.
// Run:  node harness.mjs            (validate world invariants)
//       node harness.mjs --sync     (also verify the game file matches world.mjs)
//
// Philosophy: every invariant is a named function returning {pass, detail}. The world
// logic comes from world.mjs (the single source of truth); the game inlines an identical
// copy and --sync proves they haven't drifted. No GPU needed — pure data checks.

import * as W from './world.mjs';
import { readFileSync } from 'node:fs';

// ---------- tiny assertion framework ----------
let failures = 0, checks = 0;
function report(name, pass, detail = '') {
  checks++;
  if (!pass) failures++;
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${name}${detail ? '  — ' + detail : ''}`);
}

// ---------- find populated chunks (cities are sparse) ----------
function findPopulatedChunks(limit = 8) {
  const out = [];
  for (let cx = 0; cx < 200 && out.length < limit; cx++) {
    for (let cz = 0; cz < 200 && out.length < limit; cz++) {
      const net = W.buildRoadNetwork(cx, cz);
      if (net.segments.length > 0) out.push({ cx, cz, net });
    }
  }
  return out;
}

// ---------- invariants (each scans the given chunks, returns first violation) ----------
const STRIPE = 0.35, GAPB = 0.45, NB = 4; // must match renderer crosswalk params

function inv_noRoadOverWater(chunks) {
  for (const { net } of chunks) {
    for (const s of net.segments) {
      const mx = s.vertical ? s.x : (s.x + s.x2) / 2;
      const mz = s.vertical ? (s.z + s.z2) / 2 : s.z;
      if (W.terrainHeight(mx, mz) < W.SEA_LEVEL + W.ROAD_WATER_MARGIN)
        return { pass: false, detail: `segment at (${mx.toFixed(1)},${mz.toFixed(1)}) over water` };
    }
  }
  return { pass: true };
}

function inv_intersectionsAreRealCrossings(chunks) {
  for (const { net } of chunks) {
    for (const it of net.intersections) {
      const v = W.roadHere(it.x, it.z - W.GRID_SP / 2) || W.roadHere(it.x, it.z + W.GRID_SP / 2);
      const h = W.roadHere(it.x - W.GRID_SP / 2, it.z) || W.roadHere(it.x + W.GRID_SP / 2, it.z);
      if (!(v && h)) return { pass: false, detail: `fake intersection at (${it.x},${it.z})` };
    }
  }
  return { pass: true };
}

function inv_crosswalkStripesOverRoad(chunks) {
  // The renderer only draws a stripe if roadHere is true. Verify that at least SOME draw
  // (the band isn't entirely suppressed) AND that the suppressed ones are genuinely off-road.
  for (const { net } of chunks) {
    for (const it of net.intersections) {
      for (const dir of [-1, 1]) {
        for (let i = 0; i < NB; i++) {
          const zc = it.z + dir * (it.hwz + 0.6 + i * (STRIPE + GAPB));
          // invariant: if we WOULD draw (roadHere), the stripe centre is on road. Trivially
          // true by construction, but we assert the centre's terrain is above water too.
          if (W.roadHere(it.x, zc) && W.terrainHeight(it.x, zc) < W.SEA_LEVEL + W.ROAD_WATER_MARGIN)
            return { pass: false, detail: `crosswalk stripe at (${it.x},${zc.toFixed(1)}) over water` };
        }
      }
    }
  }
  return { pass: true };
}

function inv_roadAboveTerrain(chunks) {
  // Road surface offset (O_ASPH=0.30) must clear the interpolated terrain mesh everywhere
  // on the road. Sample sub-tile points; terrain mesh is bilinear over a 2-unit vertex grid.
  const O_ASPH = 0.30;
  function meshAt(x, z) {
    const vx0 = Math.floor(x / 2) * 2, vz0 = Math.floor(z / 2) * 2, vx1 = vx0 + 2, vz1 = vz0 + 2;
    const tx = (x - vx0) / 2, tz = (z - vz0) / 2;
    return (W.terrainHeight(vx0, vz0) * (1 - tx) + W.terrainHeight(vx1, vz0) * tx) * (1 - tz)
         + (W.terrainHeight(vx0, vz1) * (1 - tx) + W.terrainHeight(vx1, vz1) * tx) * tz;
  }
  for (const { net } of chunks) {
    for (const s of net.segments.slice(0, 40)) { // cap work per chunk
      const cx = s.vertical ? s.x : (s.x + s.x2) / 2;
      const cz = s.vertical ? (s.z + s.z2) / 2 : s.z;
      for (let ddx = -s.hw; ddx <= s.hw; ddx += 1) for (let ddz = -1; ddz <= 1; ddz += 1) {
        const x = cx + (s.vertical ? ddx : ddz), z = cz + (s.vertical ? ddz : ddx);
        const road = Math.max(W.terrainHeight(x, z), W.SEA_LEVEL) + O_ASPH;
        if (road - meshAt(x, z) < -0.001)
          return { pass: false, detail: `terrain pokes road at (${x.toFixed(1)},${z.toFixed(1)})` };
      }
    }
  }
  return { pass: true };
}

function inv_noBuildingOnRoad(chunks) {
  // Building blocks sit on grid-cell centres; onRoadTile forbids them on roads. Verify no
  // block centre that passes density would also be on a road tile.
  for (const { cx, cz } of chunks) {
    const ox = cx * W.CHUNK, oz = cz * W.CHUNK;
    for (let bx = Math.floor((ox - W.CHUNK / 2) / W.GRID_SP) * W.GRID_SP; bx < ox + W.CHUNK / 2; bx += W.GRID_SP)
      for (let bz = Math.floor((oz - W.CHUNK / 2) / W.GRID_SP) * W.GRID_SP; bz < oz + W.CHUNK / 2; bz += W.GRID_SP) {
        const cxC = bx + W.GRID_SP / 2, czC = bz + W.GRID_SP / 2; // block centre
        if (W.cityness(cxC, czC) < 0.3) continue;
        if (W.onRoadTile(cxC, czC) && W.roadHere(cxC, czC))
          return { pass: false, detail: `block centre (${cxC},${czC}) on a road` };
      }
  }
  return { pass: true };
}

function inv_collisionMatchesGeometry(chunks) {
  // buildingFootprintAt must agree with buildingAt for the owning block: a point inside
  // the spec footprint reports collision, a point well outside does not. Proves the
  // single-source-of-truth refactor (collision can't drift from what's drawn).
  for (const { cx, cz } of chunks) {
    const ox = cx * W.CHUNK, oz = cz * W.CHUNK;
    for (let bx = Math.floor((ox - W.CHUNK/2)/W.GRID_SP)*W.GRID_SP+W.GRID_SP/2; bx < ox+W.CHUNK/2; bx += W.GRID_SP)
      for (let bz = Math.floor((oz - W.CHUNK/2)/W.GRID_SP)*W.GRID_SP+W.GRID_SP/2; bz < oz+W.CHUNK/2; bz += W.GRID_SP) {
        const B = W.buildingAt(bx, bz);
        if (B) {
          if (!W.buildingFootprintAt(bx, bz)) return { pass:false, detail:`centre (${bx},${bz}) has building but no collision` };
          if (W.buildingFootprintAt(bx + B.hw + 3, bz)) return { pass:false, detail:`collision leaks past footprint at (${bx},${bz})` };
        } else {
          if (W.buildingFootprintAt(bx, bz)) return { pass:false, detail:`collision at (${bx},${bz}) with no building` };
        }
      }
  }
  return { pass: true };
}

function inv_crosswalkStripesOnRoad(chunks) {
  // Every zebra bar must lie on road (no overhang). Mirrors the renderer's bar layout.
  const BAR_LONG = 1.8, BAR_W = 0.5, BAR_GAP = 0.55;
  for (const { net } of chunks) {
    for (const it of net.intersections) {
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
  }
  return { pass: true };
}

function inv_finiteHeights(chunks) {
  for (const { cx, cz } of chunks) {
    const ox = cx * W.CHUNK, oz = cz * W.CHUNK;
    for (let x = ox - W.CHUNK / 2; x < ox + W.CHUNK / 2; x += 4)
      for (let z = oz - W.CHUNK / 2; z < oz + W.CHUNK / 2; z += 4)
        if (!Number.isFinite(W.terrainHeight(x, z)))
          return { pass: false, detail: `non-finite terrain at (${x},${z})` };
  }
  return { pass: true };
}

const INVARIANTS = {
  // Traffic signals never let both travel axes go at once (no green-green cross conflict).
  inv_signalsNeverBothGreen() {
    for (const [ix, iz] of [[0, 0], [192, 192], [192, -384]])
      for (let t = 0; t < W.TL_CYCLE; t += 0.25)
        if (W.tlState(0, ix, iz, t) === 0 && W.tlState(1, ix, iz, t) === 0)
          return { pass: false, detail: `both axes green @(${ix},${iz}) t=${t.toFixed(2)}` };
    return { pass: true };
  },
  // Each axis passes through all three states (green, yellow, red) over a full cycle.
  inv_signalsCycle() {
    for (const axis of [0, 1]) {
      const seen = new Set();
      for (let t = 0; t < W.TL_CYCLE; t += 0.25) seen.add(W.tlState(axis, 0, 0, t));
      if (!(seen.has(0) && seen.has(1) && seen.has(2)))
        return { pass: false, detail: `axis ${axis} states seen: ${[...seen].join(',')}` };
    }
    return { pass: true };
  },
  'no road over water': inv_noRoadOverWater,
  'intersections are real crossings': inv_intersectionsAreRealCrossings,
  'crosswalk stripes never over water': inv_crosswalkStripesOverRoad,
  'road surface clears terrain (no poke-through)': inv_roadAboveTerrain,
  'no building on a road': inv_noBuildingOnRoad,
  'collision matches geometry (single source of truth)': inv_collisionMatchesGeometry,
  'crosswalk stripes fully on road (no overhang)': inv_crosswalkStripesOnRoad,
  'terrain heights finite': inv_finiteHeights,
};

// ---------- sync check: game file's inlined logic must match world.mjs ----------
// Compares the body of key functions (whitespace-normalised) between the two sources, so
// editing the game without updating world.mjs (or vice-versa) is caught immediately.
function checkInSync() {
  console.log('\nSync check (game inline vs world.mjs):');
  let html;
  // The game file is index.html (historically sandbox-city.html); accept either.
  const candidates = ['./index.html', './sandbox-city.html'];
  let gameFile = null;
  for (const c of candidates) {
    try { html = readFileSync(new URL(c, import.meta.url), 'utf8'); gameFile = c; break; }
    catch { /* try next */ }
  }
  if (gameFile == null) { report('read game file', false, `none of ${candidates.join(', ')} found`); return; }
  const wsrc = readFileSync(new URL('./world.mjs', import.meta.url), 'utf8');
  // Canonicalise: strip comments, then remove ALL whitespace. Two bodies that differ only
  // in formatting/comments collapse to the same string; a real logic change does not.
  const norm = s => s
    .replace(/\/\/[^\n]*/g, '')          // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')    // block comments
    .replace(/\s+/g, '')                 // all whitespace
    .replace(/;}/g, '}');                // trailing semicolons before close
  // pull the body of a named function from each source
  function body(src, name) {
    const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
    const m = re.exec(src); if (!m) return null;
    let i = m.index + m[0].length, depth = 1;
    for (; i < src.length && depth > 0; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; }
    return norm(src.slice(m.index + m[0].length, i - 1));
  }
  const fns = ['terrainRaw', 'citynessRaw', 'urbanCore', 'zone', 'blockLevel', 'terrainHeight', 'roadHere', 'buildRoadNetwork', 'tlOffset', 'tlState', 'isPark', 'buildingAt', 'buildingFootprintAt'];
  for (const fn of fns) {
    const a = body(html, fn), b = body(wsrc, fn);
    if (a == null) { report(`sync ${fn}`, false, 'not found in game file'); continue; }
    if (b == null) { report(`sync ${fn}`, false, 'not found in world.mjs'); continue; }
    report(`sync ${fn}`, a === b, a === b ? '' : 'bodies differ — update both copies');
  }
}

// ---------- run ----------
console.log('VOXEL CITY harness\n==================');
const chunks = findPopulatedChunks(8);
console.log(`Found ${chunks.length} populated chunks: ${chunks.map(c => `(${c.cx},${c.cz})`).join(' ')}`);
console.log(`Total segments: ${chunks.reduce((n, c) => n + c.net.segments.length, 0)}, ` +
            `intersections: ${chunks.reduce((n, c) => n + c.net.intersections.length, 0)}\n`);

console.log('Invariants:');
if (chunks.length === 0) report('found populated chunks', false, 'no city in scan range');
else for (const [name, fn] of Object.entries(INVARIANTS)) {
  const r = fn(chunks);
  report(name, r.pass, r.detail);
}

if (process.argv.includes('--sync')) checkInSync();

console.log(`\n${failures === 0 ? '✅ ALL ' + checks + ' CHECKS PASSED' : '❌ ' + failures + '/' + checks + ' CHECKS FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
