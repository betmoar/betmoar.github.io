import { SEA_LEVEL, valueNoise } from '../world/world';

// Terrain band colour by altitude + subtle procedural variation. Ported 1:1 from the legacy
// bandColor so the procedural look matches before authored assets land. Returns linear-ish RGB.
export function bandColor(h: number, wx?: number, wz?: number): [number, number, number] {
  let c: [number, number, number];
  if (h < SEA_LEVEL) c = [0.20, 0.45, 0.85];      // underwater
  else if (h < 0.6) c = [0.86, 0.78, 0.45];       // beach
  else if (h < 16) c = [0.30, 0.62, 0.28];        // grass
  else if (h < 28) c = [0.42, 0.36, 0.28];        // rock
  else c = [0.92, 0.94, 0.98];                    // snow
  if (h >= SEA_LEVEL && wx != null && wz != null) {
    const n = (valueNoise(wx * 0.08, wz * 0.08) - 0.5) * 0.12;
    const n2 = (valueNoise(wx * 0.02 + 9, wz * 0.02 - 9) - 0.5) * 0.10;
    const v = n + n2;
    c = [
      Math.max(0, Math.min(1, c[0] + v)),
      Math.max(0, Math.min(1, c[1] + v)),
      Math.max(0, Math.min(1, c[2] + v)),
    ];
    if (h >= 1.5 && h < 16 && valueNoise(wx * 0.05 - 20, wz * 0.05 + 20) > 0.72) {
      c = [c[0] * 1.1 + 0.08, c[1] * 0.85, c[2] * 0.7];
    }
  }
  return c;
}
