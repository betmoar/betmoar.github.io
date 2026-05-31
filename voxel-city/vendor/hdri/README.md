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

## Lining the lighting up with the photo
When a skybox is active the day/night cycle is locked so the procedural sun matches the baked photo:
- `GFX.skyboxLockTime` (default `true`) — freeze the cycle (no drifting to night under a day photo).
- `GFX.skyboxTimeOfDay` (default `0.5` = noon) — the frozen time; pick to match the panorama's
  brightness (sunrise `.25`, sunset `.75`).
- `GFX.skyboxSunAz` (default `0`, degrees) — rotate the sun horizontally so cast shadows + the
  scatter-fog warm glow point the same way as the sun visible in the photo. Tune per panorama.

## Tuning notes
- Skybox + bloom can wash out — lower `GFX.skyboxExposure` (and/or `GFX.bloomStrength`) on desktop.
