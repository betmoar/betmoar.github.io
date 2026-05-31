# VOXEL CITY — Refactor for Render Control & Agentic Debugging

## Goal

Make rendering controllable and make errors/glitches/bugs **self-detecting** — surfaced
by the program (or a headless harness) instead of spotted by eye in a screenshot N
iterations later.

## Where we are now (honest assessment)

- One 1537-line HTML file. Generation predicates (`terrainHeight`, `cityness`,
  `roadHere`, …) are clean and now mostly single-source-of-truth after the road
  network refactor.
- The render loop `tick()` runs **completely blind**: 0 try/catch, 0 `window.onerror`,
  0 runtime asserts, 0 visual-diff capability. A thrown error stops the loop silently;
  a glitch (z-fighting, marking over water, NaN transform) renders happily.
- Verification today = “ship file → user screenshots → Claude guesses.” The loop is
  slow and the signal is lossy.

## The core idea

Three independent layers, each of which can fail loudly:

1. **WORLD MODEL** (data) — pure functions + validated structures. No THREE.js.
1. **RENDER** (geometry) — consumes the model, emits meshes. No world decisions.
1. **HARNESS** (truth) — asserts invariants on 1+2 headlessly, every change.

We already did this for roads (`buildRoadNetwork` → `buildRoadGeo`). The plan
generalizes it to the whole environment and adds runtime + headless instrumentation.

-----

## Phase 1 — Runtime safety net (fast, high value, ~1 session)

Catch the silent failures the loop currently swallows.

1. **Global error trap.** `window.onerror` + `window.addEventListener('error'/'unhandledrejection')`
   → render a red on-screen overlay with message + stack, and `console.error`. No more
   silent dead loop.
1. **Loop guard.** Wrap the body of `tick()` in try/catch. On throw: freeze, show the
   overlay, keep the last good frame instead of blanking. Optionally a “1 error/sec”
   throttle so a per-frame throw doesn’t spam.
1. **NaN/Inf sentinels.** A `assertFinite(label, ...nums)` used at the few points that
   have bitten us (camera pos, car transform, chunk origin). In debug mode it throws
   with the label; in release it’s a no-op.
1. **Debug HUD toggle (`~` key).** Extend the existing stats line into a collapsible
   panel: FPS, draw calls, triangle count, chunk count, ped/car counts, player world
   pos + chunk, time-of-day, last error. All data already exists; just surface it.

Deliverable: nothing can fail invisibly anymore.

## Phase 2 — Make the world model inspectable (~1 session)

Separate “what the world *is*” from “how it’s drawn,” everywhere (not just roads).

1. **`WorldModel` namespace.** Group the pure predicates (`terrainHeight`, `cityness`,
   `urbanCore`, `zone`, `roadHere`, `buildingAt`, `isPark`) under one object. They must
   stay free of THREE.js so the harness can import them in Node unchanged.
1. **Promote `buildingFootprintAt` to the source of truth.** Today the building geometry
   loop and `buildingFootprintAt` are two hand-mirrored copies of the placement RNG
   sequence (the comment literally says “Mirrors the placement test”). Replace with one
   generator `buildingAt(blockX,blockZ) → {x,z,w,d,h,zone,col}|null` that BOTH the geometry
   builder and collision call. Kills an entire bug family (collision ≠ visuals).
1. **`describeAt(wx,wz)` probe.** One function returning every model fact at a point:
   `{height, cityness, zone, road, building, park}`. Powers the debug HUD’s “what’s under
   the player” readout and gives the harness a single entry point.

Deliverable: every gameplay decision and every mesh derive from the same callable facts.

## Phase 3 — The agentic harness (the big leverage, ~1–2 sessions)

A headless Node script that *is* the regression suite. This is what replaces
“screenshot and guess.”

1. **Invariant validator (generalize `validate.mjs`).** Sample populated chunks; assert:
- no road segment / marking / crosswalk where `roadHere` is false (no over-water/grass);
- road surface height ≥ terrain height everywhere (no poke-through);
- no building overlaps a road tile; collision footprint == rendered footprint;
- every intersection is a real crossing; dashes never inside a junction box;
- terrain is continuous (no >Xm step between adjacent verts) outside cliffs;
- all instanced counts ≤ their MAX_* caps.
  Each invariant prints PASS/FAIL with the first offending coordinate.
1. **Geometry sanity pass.** Build each chunk’s geometry in Node (no GPU needed — we only
   inspect buffers): assert finite positions, correct winding (normals mostly +Y for
   ground/roads), vertex/index counts sane, no degenerate triangles.
1. **Offscreen render + pixel diff (optional, higher effort).** Use headless-gl or
   Playwright to render a fixed seed+camera to PNG, then compare to a committed golden
   image; flag pixel-delta over a threshold. This is what catches *visual* glitches
   (z-fighting, color bands) that pure data invariants miss. Heaviest piece — do last,
   only if data invariants prove insufficient.
1. **Seeded scenario fixtures.** A handful of (seed, chunk, camera) tuples that have
   historically broken (waterfront intersection, steep-edge city, highway crossing).
   The harness runs all of them every time.

Deliverable: `node harness.mjs` → a PASS/FAIL report with coordinates. Run after every
edit. Bugs are caught before the file is ever opened.

## Phase 4 — Render control surface (~1 session)

Make rendering tunable and individually toggleable for bisection.

1. **Layer toggles** in the debug HUD: terrain / roads / markings / buildings / props /
   NPCs / particles / bloom / shadows — each on/off at runtime. Isolating “which layer
   has the glitch” becomes one keypress instead of a code edit.
1. **`GFX` presets** (low/med/high/ultra) instead of hand-editing fields; debug HUD shows
   active preset and measured cost.
1. **Wireframe / normals / overdraw debug modes** on a key. Wireframe instantly reveals
   poke-through and z-fighting; normal-coloring reveals winding bugs (the addBox class of
   bug from early on).
1. **Freeze-frame + free camera** (detach camera from car, fly around a frozen world) to
   inspect a glitch from any angle without it moving.

Deliverable: any rendering issue can be isolated to a layer and inspected in seconds.

-----

## Suggested order & why

1 → 2 → 3 → 4. Phase 1 stops the bleeding (silent failures) immediately. Phase 2 removes
the biggest *structural* bug source (duplicated truth). Phase 3 is the compounding
investment — it pays back every future change. Phase 4 is quality-of-life for the cases
the harness flags but you still want to eyeball.

A pragmatic first slice if you want value fast: **Phase 1 (all) + Phase 3.1 (invariant
validator as a permanent `harness.mjs`)**. Those two alone convert ~80% of the
“screenshot and guess” loop into “harness tells me the coordinate.”

## Risks / notes

- This is a single self-contained HTML file by design (drag-and-drop into Safari). The
  harness must keep importing the in-file module by extraction (the existing
  `python3 → /tmp/game.mjs` trick), OR we split pure logic into a `world.js` the HTML and
  the harness both load — cleaner, but changes the single-file property. Decide explicitly.
- Offscreen pixel-diff (3.3) needs headless-gl/Playwright in the sandbox; verify it runs
  before committing to it. Data invariants (3.1–3.2) need no GPU and should come first.
- Keep all debug instrumentation behind a `DEBUG` flag so release perf (the steady 60fps)
  is untouched.