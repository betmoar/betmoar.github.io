// Captures an authoritative determinism baseline from the LEGACY voxel-city/world.mjs.
// world.test.ts replays these same inputs through the ported src/world/world.ts and asserts
// bit-identical outputs — proving the TS port introduced zero math drift. Re-run only if the
// canonical world logic intentionally changes:  node app/test/gen-golden.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as W from '../../voxel-city/world.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// A fixed, wide spread of coordinates (water, countryside, suburb, downtown all get sampled).
const coords = [];
for (let i = 0; i < 60; i++) {
  const wx = ((i * 137) % 1000) - 500 + (i % 7) * 2.5;
  const wz = ((i * 311) % 1000) - 500 + (i % 5) * 3.5;
  coords.push([Number(wx.toFixed(2)), Number(wz.toFixed(2))]);
}
// Block centres for building placement (snap to GRID centres for buildingAt variety).
const blocks = [];
for (let i = 0; i < 40; i++) {
  const bx = Math.round((((i * 97) % 800) - 400) / W.GRID_SP) * W.GRID_SP + W.GRID_SP / 2;
  const bz = Math.round((((i * 223) % 800) - 400) / W.GRID_SP) * W.GRID_SP + W.GRID_SP / 2;
  blocks.push([bx, bz]);
}

const scalarFns = [
  'hash', 'valueNoise', 'terrainRaw', 'citynessRaw', 'cityness', 'urbanCore', 'zone',
  'blockLevel', 'terrainHeight', 'nearestLine', 'isHighwayLine', 'roadHalfWidth',
  'crossStreetLine', 'onRoadTile', 'groundOrBridge', 'roadHere', 'buildingFootprintAt', 'isPark',
];
const scalars = [];
for (const [wx, wz] of coords) {
  for (const fn of scalarFns) scalars.push({ fn, args: [wx, wz], out: W[fn](wx, wz) });
}

// buildingAt spec (strip the non-serializable `br` rng closure).
const buildings = blocks.map(([lx, lz]) => {
  const B = W.buildingAt(lx, lz);
  if (!B) return { args: [lx, lz], spec: null };
  const { br, ...rest } = B; void br;
  return { args: [lx, lz], spec: rest };
});

// Road networks for a handful of chunks.
const networks = [[0, 0], [1, 0], [-2, 1], [3, -2], [5, 5]].map(([cx, cz]) => ({
  args: [cx, cz], net: W.buildRoadNetwork(cx, cz),
}));

// Traffic-signal state machine over axis × junction × time.
const signals = [];
for (const axis of [0, 1]) {
  for (const [ix, iz] of [[0, 0], [192, 96], [-288, 288]]) {
    for (let t = 0; t <= W.TL_CYCLE; t += 1.5) {
      signals.push({ args: [axis, ix, iz, Number(t.toFixed(1))], out: W.tlState(axis, ix, iz, Number(t.toFixed(1))) });
    }
  }
}

// rng sequences (first 5 draws) for a few coord/salt combos.
const rngSeqs = [[0, 0, 11], [3, -2, 23], [10, 10, 41]].map(([cx, cz, salt]) => {
  const r = W.rng(cx, cz, salt);
  return { args: [cx, cz, salt], seq: [r(), r(), r(), r(), r()] };
});

const golden = {
  note: 'Determinism baseline captured from voxel-city/world.mjs. Do not hand-edit.',
  seed: W.SEED,
  constants: {
    SEA_LEVEL: W.SEA_LEVEL, CHUNK: W.CHUNK, SEG: W.SEG, RADIUS: W.RADIUS,
    GRID_SP: W.GRID_SP, ROAD_W: W.ROAD_W, LANE: W.LANE, GRID_SP_T: W.GRID_SP_T,
    HWY_EVERY: W.HWY_EVERY, HWY_W: W.HWY_W, CROSS_EVERY: W.CROSS_EVERY,
    ROAD_WATER_MARGIN: W.ROAD_WATER_MARGIN,
    TL_GREEN: W.TL_GREEN, TL_YELLOW: W.TL_YELLOW, TL_HALF: W.TL_HALF, TL_CYCLE: W.TL_CYCLE,
  },
  scalars, buildings, networks, signals, rngSeqs,
};

const out = join(here, 'world-golden.json');
writeFileSync(out, JSON.stringify(golden, null, 0));
console.log('wrote', out, '— scalars:', scalars.length, 'buildings:', buildings.length,
  'networks:', networks.length, 'signals:', signals.length);
