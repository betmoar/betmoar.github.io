import { rng } from '../world/world';

// Deterministic kit assembly — the heart of the Hybrid join. A building's authored-module stack
// (ground + N mids + roof) is a PURE function of its world coords via the seeded rng, so the city
// is byte-identical across clients and the harness can verify it without a GPU or any geometry.
// Footprint is unchanged (modules are scaled to the building's w×d), so collision still comes from
// world.buildingAt — visuals can never overhang the spec.

const KIT_SALT = 71;

export interface KitHeights { groundH: number; midHeights: number[]; roofH: number; }
export interface FloorPlacement { role: 'ground' | 'mid' | 'roof'; variant: number; y: number; }

// Stack modules from lowG up toward lowG+hgt: ground, then mids (variant chosen per floor by the
// seeded rng), then a roof cap. Mids stop leaving room for the roof.
export function selectKit(lx: number, lz: number, lowG: number, hgt: number, kh: KitHeights): FloorPlacement[] {
  const pick = rng(Math.round(lx), Math.round(lz), KIT_SALT);
  const out: FloorPlacement[] = [];
  const top = lowG + Math.max(hgt, kh.groundH + kh.roofH);
  let y = lowG;
  out.push({ role: 'ground', variant: 0, y });
  y += kh.groundH;
  const nVariants = Math.max(1, kh.midHeights.length);
  // leave headroom for the roof; cap floors so a pathological height can't loop unbounded
  for (let guard = 0; guard < 400; guard++) {
    const variant = Math.min(nVariants - 1, (pick() * nVariants) | 0);
    const mh = kh.midHeights[variant] ?? kh.midHeights[0] ?? 3.5;
    if (y + mh + kh.roofH > top) break;
    out.push({ role: 'mid', variant, y });
    y += mh;
  }
  out.push({ role: 'roof', variant: 0, y });
  return out;
}
