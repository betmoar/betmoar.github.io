import * as THREE from 'three';
import { SEA_LEVEL, buildRoadNetwork, terrainHeight } from '../../world/world';

type V3 = [number, number, number];
const O_ASPH = 0.30; // asphalt surface offset above ground (matches the harness invariant)
const ASPHALT: V3 = [0.16, 0.16, 0.19];

function quad(P: number[], N: number[], C: number[], x0: number, x1: number, z0: number, z1: number, y: number, col: V3): void {
  // two tris, upward normal
  const pts: V3[] = [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
  for (const idx of [0, 2, 1, 0, 3, 2]) {
    P.push(pts[idx][0], pts[idx][1], pts[idx][2]);
    N.push(0, 1, 0);
    C.push(col[0], col[1], col[2]);
  }
}

// M2 road surface: RENDERS the validated network model from world.ts — one asphalt quad per
// segment, no geometric decisions here (markings/sidewalks come later / are replaced by authored
// decals at M4). Returns null for chunks with no roads.
export function buildRoadGeo(cx: number, cz: number): THREE.BufferGeometry | null {
  const net = buildRoadNetwork(cx, cz);
  if (net.segments.length === 0) return null;
  const P: number[] = [], N: number[] = [], C: number[] = [];
  for (const s of net.segments) {
    if (s.vertical) {
      const cxm = s.x, czm = (s.z + s.z2!) / 2;
      const y = Math.max(terrainHeight(cxm, czm), SEA_LEVEL) + O_ASPH;
      quad(P, N, C, s.x - s.hw, s.x + s.hw, s.z, s.z2!, y, ASPHALT);
    } else {
      const cxm = (s.x + s.x2!) / 2, czm = s.z;
      const y = Math.max(terrainHeight(cxm, czm), SEA_LEVEL) + O_ASPH;
      quad(P, N, C, s.x, s.x2!, s.z - s.hw, s.z + s.hw, y, ASPHALT);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return g;
}
