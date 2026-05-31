import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset,
  ToneMappingEffect, ToneMappingMode, KernelSize,
} from 'postprocessing';
import { TIERS, type Tier } from '../core/gfx-tiers';

// pmndrs postprocessing stack. AgX tone mapping moves into the post chain (renderer set to
// NoToneMapping by the caller) so it's applied AFTER bloom — the correct order. Bloom is gated by
// tier; SMAA always runs (cheap AA; TAA/SSR are later additions for the High tier).
export function createPost(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, tier: Tier,
): { composer: EffectComposer; setSize: (w: number, h: number) => void } {
  const cfg = TIERS[tier];
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const effects = [];
  effects.push(new SMAAEffect({ preset: tier === 'low' ? SMAAPreset.LOW : SMAAPreset.HIGH }));
  if (cfg.bloom) {
    effects.push(new BloomEffect({
      intensity: 0.7, luminanceThreshold: 0.72, luminanceSmoothing: 0.2, kernelSize: KernelSize.MEDIUM, mipmapBlur: true,
    }));
  }
  // tone mapping LAST
  effects.push(new ToneMappingEffect({ mode: ToneMappingMode.AGX }));
  composer.addPass(new EffectPass(camera, ...effects));

  return {
    composer,
    setSize: (w, h) => composer.setSize(w, h),
  };
}
