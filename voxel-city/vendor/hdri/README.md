# vendor/hdri — optional equirectangular skybox panoramas

Drop **LDR equirectangular** city panoramas here (2:1 aspect, skyline on the horizon line) to use
a real photo as the background + reflection environment instead of the procedural gradient sky.

## How it's wired
- Loaded by `installSkybox()` in `index.html` with the **core `THREE.TextureLoader`** (no extra
  addon), as both `scene.background` and `scene.environment` (so water reflects it).
- Controlled by the `GFX` flags in `index.html`:
  - `GFX.skybox` — `false` by default. Set `true` to enable.
  - `GFX.skyboxFile` — filename to load from this folder (default `city_downtown.jpg`).
  - `GFX.skyboxExposure` — ACES tone-mapping exposure applied only while a skybox is active.
- **Fully optional / self-contained**: if `GFX.skybox` is off, or the file is missing/404s, the
  game keeps the procedural sky and nothing throws (just a console warning).

## Expected files (referenced by `GFX.skyboxFile`)
- `city_downtown.jpg`     — dense downtown skyline, dramatic clouds
- `city_residential.jpg`  — residential towers + greenspace, clear sky

Use `.jpg` or `.webp` (LDR). For true `.hdr` HDRIs you'd need to vendor `RGBELoader` (and optionally
`GroundedSkybox`) via `vendor/update-three.mjs` — deliberately not done yet to stay lightweight.

## Tuning notes
- The photo's baked sun/exposure won't match the day-night cycle; when a skybox is active consider
  biasing `timeOfDay` toward the panorama's lighting.
- Skybox + bloom can wash out — lower `GFX.skyboxExposure` (and/or `GFX.bloomStrength`) on desktop.
