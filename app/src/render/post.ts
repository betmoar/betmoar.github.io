import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset,
  ToneMappingEffect, ToneMappingMode, KernelSize,
} from 'postprocessing';
// @ts-expect-error — n8ao ships no type declarations
import { N8AOPostPass } from 'n8ao';
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

  // GTAO (contact ambient occlusion) grounds the city — medium+ tiers. Runs after the scene
  // render, before tone mapping. n8ao's pass auto-resizes with composer.setSize.
  if (cfg.gtao) {
    const ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
    ao.configuration.aoRadius = 6;
    ao.configuration.distanceFalloff = 1.5;
    ao.configuration.intensity = tier === 'high' ? 3.0 : 2.2;
    ao.configuration.aoSamples = tier === 'high' ? 16 : 8;
    ao.configuration.denoiseSamples = 4;
    composer.addPass(ao);
  }

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
