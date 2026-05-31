# VOXEL CITY — Debugging & Harness Workflow

Three files now work together:

- **sandbox-city.html** — the game (single file, drag into Safari). Contains an inlined
  copy of the pure world logic plus all rendering.
- **world.mjs** — the canonical pure world logic (no THREE, no DOM). Single source of truth.
- **harness.mjs** — headless regression checks. Imports `world.mjs` directly.

## Everyday loop

After any change to generation or rendering logic, run:

```
node harness.mjs --sync
```

- **Invariants** check the world model over real (populated) chunks: no road over water,
  real intersections only, crosswalk stripes never over water, road clears terrain,
  no building on a road, finite heights. Each prints the first offending coordinate.
- **Sync check** (`--sync`) proves the game’s inlined logic still matches `world.mjs`
  (ignoring formatting/comments). If you edit one copy’s logic, this fails until you
  update the other.

Exit code is non-zero on any failure, so it can gate a commit.

## When you change world logic

Edit BOTH `world.mjs` and the inlined copy in `sandbox-city.html` (same function bodies).
Run `node harness.mjs --sync` — the sync check confirms they match. This is deliberate:
the single-file game stays drag-and-drop, and the harness still tests the real logic.

## Adding a new invariant

In `harness.mjs`, write a function `inv_yourCheck(chunks) → {pass, detail}` and add it to
the `INVARIANTS` map with a human name. It automatically runs and reports.

## In-game debug HUD

Press **`~`** (backquote) in the game to toggle debug mode + HUD: FPS, draw calls, triangle
count, chunk/ped counts, player world position + chunk, terrain height / cityness / zone /
onRoad under the player, active render toggles, and the last runtime error.

### Render control keys (only while debug is on)

- **1** terrain · **2** roads · **3** buildings · **4** props · **5** NPCs · **6** water — toggle each layer
- **0** bloom on/off
- **V** wireframe (reveals poke-through / z-fighting instantly)
- **N** normals mode (colours faces by normal — reveals winding/orientation bugs)
- **G** freeze world + free camera. While frozen: **WASD** move, **arrows** look,
  **PgUp/PgDn** up/down, **Shift** faster. World sim pauses so you can inspect a glitch
  from any angle. Press G again to resume; `~` exits debug and resets everything.

## Runtime safety net

- Any thrown error (anywhere) shows a red overlay at the top with message + stack, and logs
  to console — no more silent failures.
- The render loop is guarded: a throw freezes on the last good frame and shows the overlay
  instead of going black.
- `assertFinite(label, ...nums)` throws on NaN/Inf **only when DEBUG is on** (free in release).
  Add calls at any spot you suspect bad math.

## Not yet done (from REFACTOR_PLAN.md)

- ~Phase 2: unify buildingFootprintAt with building geometry into one buildingAt().~ ✅ DONE.
  Both now call `buildingAt()`; the “collision matches geometry” invariant guards it.
- ~Phase 4: per-layer render toggles, wireframe/normals debug modes, freeze-frame camera.~ ✅ DONE.
- Phase 3.3 (optional, remaining): offscreen render + golden-image pixel diff for visual
  glitches that data invariants can’t see. Needs headless-gl/Playwright; verify it runs first.