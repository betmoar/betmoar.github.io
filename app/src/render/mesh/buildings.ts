import * as THREE from 'three';
import { CHUNK, GRID_SP, buildingAt, valueNoise } from '../../world/world';

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

// Neighbourhood palette (low-freq noise) — cool glass / warm brick / grey industrial.
function districtPalette(x: number, z: number): V3[] {
  const dn = valueNoise(x * 0.0016 + 50, z * 0.0016 - 30);
  if (dn < 0.33) return [[0.30, 0.40, 0.55], [0.26, 0.38, 0.52], [0.34, 0.44, 0.60], [0.22, 0.34, 0.50]];
  if (dn < 0.66) return [[0.58, 0.46, 0.40], [0.62, 0.50, 0.42], [0.54, 0.42, 0.38], [0.66, 0.54, 0.46]];
  return [[0.42, 0.44, 0.46], [0.38, 0.40, 0.42], [0.46, 0.47, 0.48], [0.34, 0.36, 0.38]];
}

// M2 buildings: one zone-coloured box per placed building (world coords). Window/cornice detail
// is intentionally omitted — authored Blender kit modules replace these boxes at M3/M4. Returns
// null if the chunk has no buildings.
export function buildBuildingsGeo(cx: number, cz: number): THREE.BufferGeometry | null {
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
      let col = pal[(Math.abs(Math.round(lx) + Math.round(lz) * 3) % pal.length)];
      if (B.isLandmark) col = [0.20, 0.24, 0.34];
      addBox(P, N, C, lx, B.lowG + B.hgt / 2, lz, B.w, B.hgt, B.d, col);
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
