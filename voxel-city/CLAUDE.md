# Voxel City — project guide for Claude Code

A single-file, browser-based GTA-style 3D driving/exploration game built with Three.js.
Live: <https://betmoar.github.io/voxel-city/>  ·  Current version: **v0.2.0** (semver)

## Files

- **index.html** (a.k.a. sandbox-city.html) — the whole game: Three.js scene, generation,
  rendering, input, audio, UI. Three.js is **vendored locally** under `vendor/three/` (see
  below), so the page is fully self-contained — no CDN/internet needed at runtime. This is
  what GitHub Pages serves. Drag into a browser to run locally.
- **vendor/three/** — local copy of Three.js (`three.module.js` + the minimal `addons/`
  closure the game imports) and its LICENSE. The importmap in index.html points at these.
  Re-vendor with `node vendor/update-three.mjs` (pulls from the npm registry, since the
  jsDelivr CDN is blocked in some sandboxes). Add new addons to that script's ENTRY_POINTS.
- **world.mjs** — the canonical PURE world logic (terrain, cityness, zones, road network,
  building placement). No Three.js, no DOM. The harness imports this.
- **harness.mjs** — headless regression checks (`node harness.mjs --sync`).
- **HARNESS_README.md** — how the harness + in-game debug tools work (read this).
- **REFACTOR_PLAN.md** — the phased plan; Phases 1, 2, 4 done, Phase 3.3 optional/remaining.

## The one architectural rule that matters

`world.mjs` is the **single source of truth** for all pure world logic (terrain, cityness,
zones, road network, traffic-signal timing, building placement). `index.html` **imports it
directly** (`import { ... } from './world.mjs'`) and the harness imports the same module — so
there is exactly one copy of the logic and no way for the game and the tests to drift.

> History: the game used to *inline a copy* of world.mjs to stay a single drag-and-drop file,
> with a "sync check" comparing function bodies. Now that this is a real repo served over HTTP
> (GitHub Pages), index.html imports world.mjs as a normal ES module — the inline copy and the
> two-copy dance are gone. `index.html` still keeps its own **rendering/geometry** helpers
> (`bandColor`, `buildTerrainGeo`, `buildRoadGeo`, `buildBuildingsGeo`, `addBox`, etc.) and the
> game-only `nextHighwayLine`/`onRoad` helpers — only the *pure* logic lives in world.mjs.

## Workflow (do this after every change)

```
node harness.mjs --sync
```

- **Invariants** (over real populated chunks): no road over water, real intersections only,
  crosswalk stripes on road (no overhang), road clears terrain (no poke-through), no
  building on a road, collision matches geometry, finite heights, plus traffic-signal timing
  (never both axes green; full green/yellow/red cycle). Each prints the first offending
  coordinate. Exit code is non-zero on failure (can gate a commit).
- **Import check** (`--sync`) proves index.html still imports world.mjs and hasn't re-inlined
  any world function (which would shadow the import and reintroduce drift).

Add a new invariant: write `inv_yourCheck(chunks) -> {pass, detail}` in harness.mjs and add
it to the `INVARIANTS` map. Keep invariants checking the **full footprint** of a thing, not
just its centre — past bugs slipped through because the check shared the code’s blind spot.

## Architecture quick map (index.html)

- **Generation is pure + deterministic** from `SEED`. Key predicates: `terrainHeight`,
  `cityness`/`urbanCore`/`zone`, `roadHere` (THE road predicate), `buildingAt` (THE building
  spec — both geometry and collision call it), `isPark`.
- **Road network as DATA then render**: `buildRoadNetwork(cx,cz)` returns validated
  `{segments, intersections}`; `buildRoadGeo` only *renders* that — it makes no geometric
  decisions, so markings/crosswalks can’t escape onto grass/water.
- **Grid (v46)**: `GRID_SP=32` (block size). Avenues run every line; cross-streets only every
  `CROSS_EVERY=3` lines (+ highways) → long avenues, fewer crossroads, big blocks. Highways
  every `HWY_EVERY=6`. Traffic lights only at highway×highway junctions (`it.light`, ~11%).
- **Chunks** stream around the player (`CHUNK=48`, `SEG=24` → 2-unit terrain grid; keep
  road sampling `STEP=2` aligned to this to avoid poke-through). Buildings/roads merged to
  one geometry per chunk; NPCs/props via InstancedMesh (one draw call per pool).
- **Boardwalks**: raised wooden decks in ~40% of park blocks (in `buildRoadGeo`, height 0.42).

## In-game debug tools (press `~` to toggle DEBUG)

- HUD: FPS, draws, tris, chunk/ped counts, player pos, `describeAt` (height/cityness/zone/
  onRoad under player), last error.
- Layer toggles **1–6** (terrain/roads/buildings/props/NPCs/water), **0** bloom.
- **V** wireframe (reveals poke-through/z-fighting), **N** normals (reveals winding bugs),
  **G** freeze + free camera (WASD/arrows/PgUp-Dn, Shift faster) to inspect a frozen glitch.
- Runtime safety net: global error → red overlay; the render loop is guarded (freezes on the
  last good frame instead of dying silently).

## Verify you have the right build

The version has **one source of truth**: `const BUILD = 'MAJOR.MINOR.PATCH'` (semver) near the
top of the module script — bump **PATCH** for fixes, **MINOR** for new features, **MAJOR** for
big reworks. The page `<title>`, the HUD brand panel (top-left, `#ver`), and the console log on
load are all derived from it at runtime (displayed as `v` + BUILD), so there are no version
literals to keep in sync by hand.

## Known follow-ups / not done

- Phase 3.3 (optional): offscreen render + golden-image pixel diff for *visual* glitches the
  data invariants can’t catch (needs headless-gl/Playwright; verify it runs in your env first).