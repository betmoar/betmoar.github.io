// Quality tiers — the rebuild's expansion of the old single GFX flags object.
// Desktop targets 60fps at High; weaker devices fall back to Medium/Low. Each tier
// scales pixel ratio, draw distance, shadows, and (later milestones) post FX + asset LOD bias.

export type Tier = 'low' | 'medium' | 'high';

export interface TierConfig {
  readonly pixelRatioCap: number;   // hard cap on devicePixelRatio
  readonly drawRings: number;       // chunk ring radius (RADIUS) — view distance
  readonly shadowCascades: number;  // CSM cascades (M4); 0 = no sun shadows
  readonly shadowSize: number;      // shadow map resolution per cascade
  readonly bloom: boolean;
  readonly gtao: boolean;           // ground-truth ambient occlusion (M4)
  readonly antialias: 'smaa' | 'taa';
  readonly ssr: boolean;            // screen-space reflections for wet roads/water (M4)
  readonly lodBias: number;         // >1 pushes LOD swaps farther (crisper), <1 nearer (cheaper)
}

export const TIERS: Record<Tier, TierConfig> = {
  low:    { pixelRatioCap: 1.0, drawRings: 2, shadowCascades: 1, shadowSize: 1024, bloom: false, gtao: false, antialias: 'smaa', ssr: false, lodBias: 0.7 },
  medium: { pixelRatioCap: 1.5, drawRings: 3, shadowCascades: 2, shadowSize: 2048, bloom: true,  gtao: true,  antialias: 'smaa', ssr: false, lodBias: 1.0 },
  high:   { pixelRatioCap: 2.0, drawRings: 4, shadowCascades: 3, shadowSize: 2048, bloom: true,  gtao: true,  antialias: 'taa',  ssr: true,  lodBias: 1.3 },
};

// Cheap, side-effect-free heuristic. A 1s startup micro-benchmark + dynamic-resolution
// fallback come in a later milestone; this is the initial guess.
export function detectTier(): Tier {
  if (typeof navigator === 'undefined') return 'high';
  const cores = navigator.hardwareConcurrency ?? 4;
  // deviceMemory is non-standard / Chromium-only; treat missing as "unknown, assume decent".
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  if (coarse && (cores <= 6 || mem <= 4)) return 'low';
  if (cores <= 4 || mem <= 4) return 'medium';
  if (cores >= 8 && mem >= 8 && !coarse) return 'high';
  return 'medium';
}
