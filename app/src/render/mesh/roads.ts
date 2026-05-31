import * as THREE from 'three';
import { SEA_LEVEL, buildRoadNetwork, terrainHeight } from '../../world/world';

type V3 = [number, number, number];
const O_ASPH = 0.30; // asphalt sits this far above ground
const ASPHALT: V3 = [0.16, 0.16, 0.19];

// Road surface height at a point: follow the terrain (clamped to sea level) + a fixed lift, so the
// asphalt hugs slopes instead of floating/sinking. Sampling by absolute world position means
// adjacent quads/segments share identical edge heights → a continuous, connected surface.
function roadY(x: number, z: number): number {
  return Math.max(terrainHeight(x, z), SEA_LEVEL) + O_ASPH;
}

// One terrain-conforming quad: each of the 4 corners gets its own sampled height.
function quad(P: number[], N: number[], C: number[], x0: number, x1: number, z0: number, z1: number, col: V3): void {
  const pts: V3[] = [
    [x0, roadY(x0, z0), z0], [x1, roadY(x1, z0), z0], [x1, roadY(x1, z1), z1], [x0, roadY(x0, z1), z1],
  ];
  for (const idx of [0, 2, 1, 0, 3, 2]) {
    P.push(pts[idx][0], pts[idx][1], pts[idx][2]);
    N.push(0, 1, 0); // up-ish; fine for a near-flat road ribbon
    C.push(col[0], col[1], col[2]);
  }
}

// Road surface: RENDERS the validated network from world.ts. Each 2-unit segment is split ACROSS
// its width into sub-quads whose corners are sampled at terrain height, so the ribbon conforms to
// slopes and tiles seamlessly with its neighbours (fixing the stepped/disconnected look). Returns
// null for chunks with no roads.
export function buildRoadGeo(cx: number, cz: number): THREE.BufferGeometry | null {
  const net = buildRoadNetwork(cx, cz);
  if (net.segments.length === 0) return null;
  const P: number[] = [], N: number[] = [], C: number[] = [];
  const STEP = 2; // cross-width subdivision (keeps quads small enough to follow terrain)
  for (const s of net.segments) {
    if (s.vertical) {
      // segment spans [z, z2] in length, [x-hw, x+hw] across width; subdivide the width
      for (let w = -s.hw; w < s.hw - 1e-6; w += STEP) {
        const wx0 = s.x + w, wx1 = s.x + Math.min(w + STEP, s.hw);
        quad(P, N, C, wx0, wx1, s.z, s.z2!, ASPHALT);
      }
    } else {
      for (let w = -s.hw; w < s.hw - 1e-6; w += STEP) {
        const wz0 = s.z + w, wz1 = s.z + Math.min(w + STEP, s.hw);
        quad(P, N, C, s.x, s.x2!, wz0, wz1, ASPHALT);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  return g;
}
