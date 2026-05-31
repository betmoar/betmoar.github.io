import * as THREE from 'three';
import { TIERS, type Tier } from '../core/gfx-tiers';

// Single place that owns renderer color management + tone mapping, so every milestone
// shares one correct setup. AgX gives more natural highlights on realistic (M4) assets
// than ACES; both are fine — AgX is the default going forward.
export function createRenderer(canvas: HTMLCanvasElement, tier: Tier): THREE.WebGLRenderer {
  const cfg = TIERS[tier];
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // anti-aliasing happens in the post stack (SMAA/TAA) from M4
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, cfg.pixelRatioCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = cfg.shadowCascades > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}
