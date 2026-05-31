import * as THREE from 'three';
import { CHUNK, GRID_SP, buildingAt, terrainHeight, valueNoise } from '../../world/world';
import { selectKit, type KitHeights } from '../../world-render/place-buildings';
import type { ZoneKits } from '../../assets/loaders';

type V3 = [number, number, number];

// Push an axis-aligned box (6 quads → 12 tris) with a flat colour. Ported from the legacy addBox.
function addBox(P: number[], N: number[], C: number[], cx: number, cy: number, cz: number, w: number, h: number, d: number, col: V3): void {
  const x = w / 2, y = h / 2, z = d / 2;
  const v: V3[] = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]];
  const faces: Array<[number, number, number, number, V3]> = [
    [0, 1, 2, 3, [0, 0, -1]], [5, 4, 7, 6, [0, 0, 1]], [4, 0, 3, 7, [-1, 0, 0]],
    [1, 5, 6, 2, [1, 0, 0]], [3, 2, 6, 7, [0, 1, 0]], [4, 5, 1, 0, [0, -1, 0]],
  ];
  for (const [a, b, cc, dd, nm] of faces) {
    for (const idx of [a, cc, b, a, dd, cc]) {
      P.push(v[idx][0] + cx, v[idx][1] + cy, v[idx][2] + cz);
      N.push(nm[0], nm[1], nm[2]);
      C.push(col[0], col[1], col[2]);
    }
  }
}

// Bake an authored kit module (1×1 footprint) into the chunk soup: scale X/Z to the building
// footprint, translate to (lx, y, lz). Expands indexed GLTF geometry into the non-indexed soup.
function bakeModule(P: number[], N: number[], C: number[], geo: THREE.BufferGeometry, lx: number, y: number, lz: number, w: number, d: number, col: V3): void {
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const idx = geo.index;
  const n = idx ? idx.count : pos.count;
  for (let k = 0; k < n; k++) {
    const i = idx ? idx.getX(k) : k;
    P.push(pos.getX(i) * w + lx, pos.getY(i) + y, pos.getZ(i) * d + lz);
    N.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i)); // axis-aligned modules: normals valid under X/Z scale
    C.push(col[0], col[1], col[2]);
  }
}

function districtPalette(x: number, z: number): V3[] {
  const dn = valueNoise(x * 0.0016 + 50, z * 0.0016 - 30);
  if (dn < 0.33) return [[0.30, 0.40, 0.55], [0.26, 0.38, 0.52], [0.34, 0.44, 0.60], [0.22, 0.34, 0.50]];
  if (dn < 0.66) return [[0.58, 0.46, 0.40], [0.62, 0.50, 0.42], [0.54, 0.42, 0.38], [0.66, 0.54, 0.46]];
  return [[0.42, 0.44, 0.46], [0.38, 0.40, 0.42], [0.46, 0.47, 0.48], [0.34, 0.36, 0.38]];
}

// Buildings: every zone is assembled from its authored kit modules via the deterministic selectKit;
// a building falls back to a zone-coloured box only if its zone's kit failed to load.
export function buildBuildingsGeo(cx: number, cz: number, kits: ZoneKits): THREE.BufferGeometry | null {
  const ox = cx * CHUNK, oz = cz * CHUNK;
  const P: number[] = [], N: number[] = [], C: number[] = [];
  let any = false;
  const startX = Math.floor((ox - CHUNK / 2) / GRID_SP) * GRID_SP + GRID_SP / 2;
  const startZ = Math.floor((oz - CHUNK / 2) / GRID_SP) * GRID_SP + GRID_SP / 2;

  for (let lx = startX; lx < ox + CHUNK / 2; lx += GRID_SP) {
    for (let lz = startZ; lz < oz + CHUNK / 2; lz += GRID_SP) {
      const B = buildingAt(lx, lz);
      if (!B) continue;
      const pal = districtPalette(lx, lz);
      const base = pal[(Math.abs(Math.round(lx) + Math.round(lz) * 3) % pal.length)];
      const kit = kits[B.zn];

      // Seat the building on its HIGHEST footprint corner so no floor is buried, then drop a
      // foundation skirt down past the LOWEST terrain around the footprint (sampled with a margin)
      // so no edge floats over falling ground. baseY is where the building proper starts.
      const baseY = B.highG;
      let tMin = B.lowG;
      const mx = B.hw + 2, mz = B.hd + 2;
      for (let dx = -mx; dx <= mx + 1e-6; dx += mx) {
        for (let dz = -mz; dz <= mz + 1e-6; dz += mz) tMin = Math.min(tMin, terrainHeight(lx + dx, lz + dz));
      }
      const footH = baseY - (tMin - 0.5);
      const fcol: V3 = [base[0] * 0.55, base[1] * 0.55, base[2] * 0.58];
      addBox(P, N, C, lx, baseY - footH / 2, lz, B.w + 0.6, footH, B.d + 0.6, fcol);

      if (kit) {
        const kh: KitHeights = { groundH: kit.ground.height, midHeights: kit.mids.map((m) => m.height), roofH: kit.roof.height };
        for (const f of selectKit(lx, lz, baseY, B.hgt, kh)) {
          const geo = f.role === 'ground' ? kit.ground.geo : f.role === 'roof' ? kit.roof.geo : kit.mids[f.variant].geo;
          const col: V3 = f.role === 'roof' ? [base[0] * 0.7, base[1] * 0.7, base[2] * 0.7] : base;
          bakeModule(P, N, C, geo, lx, f.y, lz, B.w, B.d, col);
        }
      } else {
        const col: V3 = B.isLandmark ? [0.20, 0.24, 0.34] : base;
        addBox(P, N, C, lx, baseY + B.hgt / 2, lz, B.w, B.hgt, B.d, col);
      }
      any = true;
    }
  }
  if (!any) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return g;
}
