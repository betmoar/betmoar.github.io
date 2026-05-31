# Voxel City 2 — hybrid rebuild (Vite + TypeScript + three.js)

From-scratch rebuild of the Voxel City game: the deterministic procedural world is preserved,
but rendered with authored Blender assets, PBR materials and HDRI/IBL lighting. Raw three.js
(WebGL2) + focused pmndrs/ecosystem libraries. See the full plan in the repo's planning notes.

## Status: **M0 — scaffold**
Proves the build→deploy pipeline without touching the live game:
- Vite + TypeScript app under `app/`, building to repo-root `voxel-city2/`.
- `src/core/gfx-tiers.ts` — quality tiers (low/medium/high) + device detection.
- `src/render/renderer.ts` — shared renderer setup (sRGB, AgX tone mapping, tier-scaled).
- `src/main.ts` — a PBR cube lit by a PMREM environment (the IBL path M4 reuses).

## Commands
```
cd app
npm install
npm run dev        # local dev server
npm run build      # typecheck + build → ../voxel-city2/
npm run preview    # preview the production build
npm run typecheck  # tsc --noEmit
```

## Deploy model (important)
The repo is a GitHub-**Pages-from-branch** static site. To avoid an irreversible Pages-source
change, the build currently outputs to the repo-root `voxel-city2/` folder, which the existing
deploy serves at <https://betmoar.github.io/voxel-city2/>. The committed `voxel-city2/` build
artifacts are how it goes live on merge. Switching to a GitHub **Actions** Pages deploy (the
planned `deploy.yml`) is a deliberate later milestone — it changes the Pages source and must
republish the whole site (root + `/voxel-city/` + `/voxel-city2/`), so it needs explicit sign-off.

The live `/voxel-city/` game is **untouched** by this rebuild until cutover (M7).

## Roadmap
M0 scaffold ✓ · M1 world port + harness · M2 procedural-look parity · M3 asset pipeline + first
kit · M4 full hybrid render · M5 ECS + physics + animation · M6 polish + perf + smoke gate · M7 cutover.
