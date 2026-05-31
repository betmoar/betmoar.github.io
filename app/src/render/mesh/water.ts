import * as THREE from 'three';
import { CHUNK, SEA_LEVEL, SEG, terrainHeight } from '../../world/world';

// Animated water surface. A clean-room sum-of-sines heightfield is injected into a Standard
// material via onBeforeCompile (vertex displacement + analytic normals), so PBR + IBL reflection
// apply for free and wave normals make the sky reflection shimmer. Waves are a function of WORLD
// position (via modelMatrix) so adjacent water chunks stay seamless. uTime is advanced each frame.
export interface Water { material: THREE.MeshStandardMaterial; tick: (t: number) => void; }

export function createWater(): Water {
  const material = new THREE.MeshStandardMaterial({
    color: 0x2f72d6, transparent: true, opacity: 0.78, roughness: 0.15, metalness: 0.0, envMapIntensity: 1.2,
  });
  let shaderRef: { uniforms: { uTime: { value: number } } } | null = null;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uAmp = { value: 0.35 };
    shaderRef = shader as unknown as { uniforms: { uTime: { value: number } } };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uAmp;
        vec3 waterWaves(vec2 p){
          vec4 dx=vec4(1.0,0.7,-0.6,0.25); vec4 dz=vec4(0.0,0.7,0.8,-0.97);
          vec4 k=vec4(0.08,0.14,0.22,0.35); vec4 a=vec4(0.55,0.28,0.12,0.06)*uAmp; vec4 s=vec4(0.9,1.3,1.7,2.4);
          float h=0.0,hx=0.0,hz=0.0;
          for(int i=0;i<4;i++){ float ph=k[i]*(dx[i]*p.x+dz[i]*p.y)+s[i]*uTime; float c=cos(ph);
            h+=a[i]*sin(ph); hx+=a[i]*k[i]*dx[i]*c; hz+=a[i]*k[i]*dz[i]*c; }
          return vec3(h,hx,hz);
        }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        { vec3 wd=waterWaves((modelMatrix*vec4(position,1.0)).xz); objectNormal=normalize(vec3(-wd.y,wd.z,1.0)); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.z += waterWaves((modelMatrix*vec4(position,1.0)).xz).x;`);
  };
  return { material, tick: (t) => { if (shaderRef) shaderRef.uniforms.uTime.value = t; } };
}

// Subdivided water plane for a chunk, or null if the chunk never dips below sea level.
export function buildWaterGeo(cx: number, cz: number): THREE.BufferGeometry | null {
  const ox = cx * CHUNK, oz = cz * CHUNK;
  let has = false;
  for (let sx = -1; sx <= 1 && !has; sx++) for (let sz = -1; sz <= 1 && !has; sz++) {
    if (terrainHeight(ox + sx * CHUNK * 0.4, oz + sz * CHUNK * 0.4) < SEA_LEVEL) has = true;
  }
  if (!has) return null;
  const g = new THREE.PlaneGeometry(CHUNK, CHUNK, SEG, SEG);
  g.rotateX(-Math.PI / 2); // local +Z → world up (waves displace along local Z)
  return g;
}
