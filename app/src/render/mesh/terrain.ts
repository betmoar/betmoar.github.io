import * as THREE from 'three';
import { CHUNK, SEG, terrainHeight } from '../../world/world';
import { bandColor } from '../colors';

// Per-chunk terrain mesh from world.ts: a subdivided plane displaced by terrainHeight, vertex
// coloured by altitude band. Positioned at the chunk origin (so geometry coords are local).
export function buildTerrainGeo(cx: number, cz: number): THREE.BufferGeometry {
  const ox = cx * CHUNK, oz = cz * CHUNK;
  const g = new THREE.PlaneGeometry(CHUNK, CHUNK, SEG, SEG);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const wx = ox + pos.getX(i), wz = oz + pos.getZ(i);
    const h = terrainHeight(wx, wz);
    pos.setY(i, h);
    const c = bandColor(h, wx, wz);
    colors.push(c[0], c[1], c[2]);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}
