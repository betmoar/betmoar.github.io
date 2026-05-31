// Determinism golden test — proves the TS port of world.ts is bit-identical to the legacy
// voxel-city/world.mjs baseline captured in world-golden.json. If this fails, the world math
// drifted (the one thing the rebuild must never do). Regenerate the golden only on an
// INTENTIONAL world-logic change: `node app/test/gen-golden.mjs`.
import { describe, it, expect } from 'vitest';
import * as W from '../src/world/world';
import golden from './world-golden.json';

type AnyFn = (...args: number[]) => number | boolean;
const fns = W as unknown as Record<string, AnyFn>;

// JSON can't represent -0 (serializes as 0), so normalize signed zero before exact compare.
// Both world.ts and the legacy world.mjs produce the same -0 here — it's purely a round-trip
// artifact of the golden file, not math drift.
const norm = (v: number | boolean) => (typeof v === 'number' && v === 0 ? 0 : v);

describe('world.ts determinism vs golden baseline', () => {
  it('constants match', () => {
    expect(W.SEED).toBe(golden.seed);
    for (const [k, v] of Object.entries(golden.constants)) {
      expect((W as unknown as Record<string, number>)[k]).toBe(v);
    }
  });

  it(`scalar functions match (${golden.scalars.length} samples)`, () => {
    for (const s of golden.scalars) {
      const got = fns[s.fn](...s.args);
      expect(norm(got), `${s.fn}(${s.args.join(',')})`).toBe(norm(s.out));
    }
  });

  it(`buildingAt specs match (${golden.buildings.length} blocks)`, () => {
    for (const b of golden.buildings) {
      const B = W.buildingAt(b.args[0], b.args[1]);
      if (b.spec === null) {
        expect(B, `buildingAt(${b.args.join(',')})`).toBeNull();
      } else {
        expect(B, `buildingAt(${b.args.join(',')})`).not.toBeNull();
        const { br, ...rest } = B!; void br; // strip the non-serializable rng closure
        expect(rest).toEqual(b.spec);
      }
    }
  });

  it(`buildRoadNetwork matches (${golden.networks.length} chunks)`, () => {
    for (const n of golden.networks) {
      const net = W.buildRoadNetwork(n.args[0], n.args[1]);
      expect(net, `buildRoadNetwork(${n.args.join(',')})`).toEqual(n.net);
    }
  });

  it(`tlState matches (${golden.signals.length} samples)`, () => {
    for (const s of golden.signals) {
      const got = W.tlState(s.args[0], s.args[1], s.args[2], s.args[3]);
      expect(got, `tlState(${s.args.join(',')})`).toBe(s.out);
    }
  });

  it('rng sequences match', () => {
    for (const r of golden.rngSeqs) {
      const gen = W.rng(r.args[0], r.args[1], r.args[2]);
      const seq = [gen(), gen(), gen(), gen(), gen()];
      expect(seq, `rng(${r.args.join(',')})`).toEqual(r.seq);
    }
  });
});
