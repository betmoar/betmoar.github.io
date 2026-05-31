// selectKit must be deterministic (same coords → same module stack) and well-formed: ground at the
// bottom, a roof on top, mid variants in range, and the stack roughly fills the building height.
// This is the Hybrid-join invariant — authored placement stays reproducible and harness-checkable.
import { describe, it, expect } from 'vitest';
import { selectKit, type KitHeights } from '../src/world-render/place-buildings';
import { buildingAt, buildRoadNetwork, CHUNK, GRID_SP } from '../src/world/world';

const KH: KitHeights = { groundH: 4, midHeights: [3.5, 3.5], roofH: 3 };

// real downtown (zone-1) buildings from a populated chunk
function zone1Buildings(limit = 30): Array<{ lx: number; lz: number; lowG: number; hgt: number }> {
  const out: Array<{ lx: number; lz: number; lowG: number; hgt: number }> = [];
  for (let cx = 0; cx < 200 && out.length < limit; cx++) {
    for (let cz = 0; cz < 200 && out.length < limit; cz++) {
      if (buildRoadNetwork(cx, cz).segments.length === 0) continue;
      const ox = cx * CHUNK, oz = cz * CHUNK;
      for (let lx = Math.floor((ox - CHUNK / 2) / GRID_SP) * GRID_SP + GRID_SP / 2; lx < ox + CHUNK / 2; lx += GRID_SP)
        for (let lz = Math.floor((oz - CHUNK / 2) / GRID_SP) * GRID_SP + GRID_SP / 2; lz < oz + CHUNK / 2; lz += GRID_SP) {
          const B = buildingAt(lx, lz);
          if (B && B.zn === 1 && out.length < limit) out.push({ lx, lz, lowG: B.lowG, hgt: B.hgt });
        }
    }
  }
  return out;
}
const buildings = zone1Buildings();

describe('selectKit (deterministic authored-module assembly)', () => {
  it('found zone-1 buildings to test', () => { expect(buildings.length).toBeGreaterThan(0); });

  it('is deterministic — same coords give the identical stack', () => {
    for (const b of buildings) {
      const a = selectKit(b.lx, b.lz, b.lowG, b.hgt, KH);
      const c = selectKit(b.lx, b.lz, b.lowG, b.hgt, KH);
      expect(c).toEqual(a);
    }
  });

  it('is well-formed: ground first, roof last, mid variants in range, fills height', () => {
    for (const b of buildings) {
      const plan = selectKit(b.lx, b.lz, b.lowG, b.hgt, KH);
      expect(plan[0].role).toBe('ground');
      expect(plan[plan.length - 1].role).toBe('roof');
      const top = plan[plan.length - 1].y + KH.roofH;
      const wanted = b.lowG + Math.max(b.hgt, KH.groundH + KH.roofH);
      expect(top).toBeLessThanOrEqual(wanted + 0.001);
      expect(top).toBeGreaterThanOrEqual(wanted - (Math.max(...KH.midHeights) + 0.001));
      for (const f of plan) {
        if (f.role === 'mid') { expect(f.variant).toBeGreaterThanOrEqual(0); expect(f.variant).toBeLessThan(KH.midHeights.length); }
      }
    }
  });
});
