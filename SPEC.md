# Voxel City — Game Design & Technical Spec
### Working title: **CITY HUSTLE** — a browser GTA-style open-world side-hustle game

> **Target: a NEW, separate repository** (working name `city-hustle`). This spec lives here
> temporarily only for hand-off; the Babylon.js rebuild will be scaffolded in the new repo in a
> future session. The current three.js build (`/voxel-city2/`) stays live in this repo.
>
> Status: spec for the Babylon.js rebuild. Engine-agnostic game design (§1–6) + Babylon technical
> architecture (§7) + migration plan (§8). The deterministic world module (`app/src/world/world.ts`)
> and test harness carry over to the new repo unchanged.

---

## 0. Why this document
Three builds in, the recurring lesson is clear: **the hard part was never the renderer — it was (a)
world-gen design bugs and (b) the absence of an actual game.** We have a strong engine (streaming
city, physics, day/night, traffic, peds) but **no gameplay loop**: no money, missions, progression,
or objectives. This spec fixes that by defining the *game* first, engine-agnostically, then the
Babylon implementation. The North Star: **a player drops into an infinite procedural city and earns
money through quick "hustles" (deliveries, taxi fares, heists, races), spending it on cars and
upgrades, climbing a reputation ladder — all in a browser, instantly, no install.**

---

## 1. Vision & pillars
- **Instant & frictionless.** Loads in a browser in seconds; click and you're driving. No login wall
  to play (optional cloud save later).
- **The hustle loop is the game.** Short, repeatable, escalating money-making jobs — the "side
  hustle" fantasy. Minutes-long sessions that chain into a progression.
- **A living city, not a backdrop.** Traffic, pedestrians, day/night, police — the world reacts.
- **Procedural & infinite,** deterministic from a seed (so the world is shared/reproducible and
  testable headlessly).
- **Stylized-readable,** desktop-60fps with a mobile-friendly tier. Authored Blender assets over a
  procedural skeleton (the "hybrid" approach).

Non-goals (v1): multiplayer, narrative campaign, character customization, interiors.

---

## 2. Core gameplay loop
```
        ┌─────────────────────────────────────────────┐
        │  EXPLORE city  →  ACCEPT a hustle (marker)    │
        │      ↑                      ↓                 │
        │  SPEND $ on cars/      DO the hustle          │
        │  upgrades/garage       (drive/deliver/evade)  │
        │      ↑                      ↓                 │
        │  EARN $ + REP  ←────────  COMPLETE / FAIL     │
        └─────────────────────────────────────────────┘
```
A loop should take **60–180 seconds**. Each completion pays **$** and **REP**; REP unlocks higher
tiers of hustles and a multiplier on payouts. Heat (wanted level) is the tension knob.

---

## 3. Systems (the game)

### 3.1 Player & vehicles
- On-foot (walk/sprint) and in-car; **E** to enter/steal the nearest car, exit on foot.
- Arcade driving feel (responsive, slightly drifty), not a sim. Handling/accel/top-speed per vehicle.
- **Owned garage:** buy cars with $; selected car spawns at the garage / on call.
- **Upgrades:** engine (speed), tires (grip), armor (survive police), nitro (burst). Per-car, $-gated.

### 3.2 Hustles (the money jobs) — v1 set
| Hustle | Loop | Pays | Heat |
|---|---|---|---|
| **Delivery** | pick up parcel → drive to drop-off before timer | $ | none |
| **Taxi fare** | pick up ped → drive to destination, smooth driving bonus | $ | none |
| **Courier rush** | multi-stop delivery chain, escalating timer | $$ | low |
| **Repo / steal** | steal a specific marked car → deliver to chop shop | $$ | medium (owner calls cops) |
| **Getaway** | drive a client from A→B while evading spawned police | $$$ | high |
| **Street race** | hit checkpoints, finish first / under par time | $$ | low |
Hustles appear as **world markers** near the player; accept by entering the marker. REP gates which
tiers spawn. Pure-function spawn from world seed + time so they're deterministic/testable.

### 3.3 Economy & progression
- **Cash ($):** earned from hustles; spent on cars, upgrades, garage slots, bail.
- **Reputation (REP):** earned per hustle; ranks (Rookie → … → Kingpin) unlock hustle tiers, better
  cars in shops, and a **payout multiplier** (REP makes the same hustle pay more).
- **Risk/reward:** higher-tier hustles pay more but generate **heat**.

### 3.4 Heat / police (the tension)
- **Wanted stars (0–5):** rise from crimes (stealing marked cars, hitting peds/cops, getaway jobs).
- Police spawn and pursue; evade by breaking line-of-sight + distance + time, or get busted (lose
  cash/bail, vehicle impounded). Stars decay when uncontested.

### 3.5 The living world (mostly built already)
- Infinite streaming procedural city (deterministic `world.ts`): terrain, **variable-block road
  grid**, zoned buildings (residential/downtown/industrial), water.
- **Traffic** (lane-following, light-gated, off-screen spawning) and **pedestrians** (sidewalks).
- **Day/night** cycle affecting lighting, headlights, and some hustle availability (e.g. getaways at
  night).
- Authored **Blender kit** assets (buildings per zone, vehicles, props) via the asset pipeline.

### 3.6 UI / UX
- HUD: cash, REP/rank, mini-map (streets + hustle markers + objective), wanted stars, speedo, active
  hustle objective + timer.
- Menus: garage (buy/select/upgrade cars), hustle board, settings (quality tier, controls, audio).
- Onboarding: a 60-second guided first delivery that teaches drive → deliver → get paid.
- Controls: **KB/M** (WASD + mouse) and **touch** (on-screen stick + buttons) for mobile.

### 3.7 Audio
- Procedural/loop music (radio stations), engine SFX (speed-mapped), UI/pickup/siren SFX, light
  positional audio. (Legacy build had a procedural chiptune radio — port the idea.)

### 3.8 Persistence
- v1: **localStorage** save (cash, REP, owned cars/upgrades, settings, seed). Cloud save = later.

---

## 4. Content
- **Vehicles:** 6–8 authored `.glb` (sedan, van, sports, truck, taxi, police, …) with handling stats.
- **Buildings:** authored kit modules per zone (ground/mid×N/roof) — already pipelined.
- **Characters:** rigged ped `.glb` (idle/walk/run) — replaces box humanoids.
- **Props:** lamps, signals, benches, trees, hustle markers, pickups.
- All authored in Blender → glTF → optimized via the existing `kits-src/` ingest pipeline.

---

## 5. Quality / performance targets
- **Desktop:** 60 fps at "high" (PBR, shadows, post: bloom/GTAO/AA, SSR water).
- **Mobile/low:** 30–60 fps at "low" (reduced draw distance, no GTAO/SSR, simpler shadows).
- Named quality **tiers** with auto-detect + manual override (carry the tier system over).
- Budgets: < ~250 draw calls/frame, instanced traffic/peds/props, LOD + fog for far chunks.

---

## 6. Milestones (game-first, each playable/verifiable)
- **G0 — Engine parity (Babylon):** streaming city + camera + day/night + traffic/peds rendering on
  Babylon, world.ts + harness green. (≈ where the three.js build is, on the new engine.)
- **G1 — Drive & walk:** player car with arcade handling (Havok), enter/exit, on-foot, follow camera.
- **G2 — First hustle + economy:** delivery hustle end-to-end, cash HUD, payout, localStorage save.
- **G3 — Hustle variety + REP:** taxi/courier/race + reputation ranks + payout multiplier + hustle
  board UI.
- **G4 — Heat:** police spawn/pursue/evade/bust, wanted stars, repo/getaway hustles.
- **G5 — Garage & upgrades:** buy/select cars, per-car upgrades, garage UI.
- **G6 — Content & polish:** authored vehicle/character/building kits, audio, onboarding, mobile
  touch controls, perf passes.
- **G7 — Ship:** balance, save migration, deploy.

---

## 7. Babylon.js technical architecture
**Engine:** Babylon.js 7.x (TypeScript, WebGL2; WebGPU-capable later). **Build:** Vite + TS (keep).
**Physics:** **Havok** (`@babylonjs/havok`, WASM) via Babylon's physics v2 plugin — replaces hand-wired
Rapier; better integrated for vehicle + character controllers. **Why Babylon (owner decision):**
first-class TS, integrated Inspector/scene-explorer (directly addresses the "can't see bugs
headlessly" gap), Havok, NodeMaterial, built-in GUI, asset/animation tooling.

**Project layout (new `babylon/` app, parallel to `app/` until cutover):**
```
babylon/
  package.json  vite.config.ts(base:'/city-hustle/')  tsconfig.json  index.html
  src/
    world/world.ts            # PORTED VERBATIM from app/src/world/world.ts (pure, engine-agnostic)
    engine/        scene.ts (Engine+Scene+render loop), tiers.ts, post.ts, ibl.ts
    streaming/     chunk-manager.ts (ring streaming), mesh/{terrain,roads,buildings,water}.ts
    assets/        loaders.ts (glTF + Draco/meshopt + KTX2), manifest.ts, registry.ts
    physics/       havok.ts (world), vehicle.ts (raycast car), character.ts (capsule controller)
    ecs/           world-ecs.ts (miniplex) + systems/{traffic,peds,police,hustles,economy,heat}.ts
    game/          player.ts, hustles/*.ts, economy.ts, reputation.ts, save.ts
    ui/            hud.ts, garage.ts, hustle-board.ts (Babylon GUI or DOM overlay)
    audio/         radio.ts, sfx.ts
    input/         keyboard-mouse.ts, touch.ts
    main.ts
  test/   world.test.ts, harness.test.ts (PORTED), world-golden.json (PORTED), smoke.spec.ts
  public/ kits/ (assets), draco/ ktx2/ havok wasm
```

**Babylon mapping of existing concepts:**
| Concept | three.js (now) | Babylon (rebuild) |
|---|---|---|
| Scene/loop | `WebGLRenderer` + `setAnimationLoop` | `Engine` + `scene.render()` in `runRenderLoop` |
| Instanced traffic/peds | `InstancedMesh` | **thin instances** (`mesh.thinInstanceAdd`) |
| Merged chunk geo | `BufferGeometry` merge | `Mesh` + `vertexData`, or transform-node groups |
| PBR + IBL | `MeshStandardMaterial` + PMREM | `PBRMaterial` + `.environmentTexture` (.env/HDR) |
| Post (bloom/GTAO/AA) | pmndrs `postprocessing` | `DefaultRenderingPipeline` + `SSAO2` + FXAA/MSAA |
| Physics | Rapier (hand-wired) | **Havok** physics v2 (`HavokPlugin`) |
| Shadows | CSM (manual) | `CascadedShadowGenerator` (built-in) |
| Day/night | manual sun/sky/fog | directional light + `SkyMaterial` / gradient + fog |
| Debug inspection | custom `?cam=` | **Babylon Inspector** (`scene.debugLayer`) + keep `?cam=` |
| Determinism | `world.ts` + golden | **same `world.ts` + golden, ported verbatim** |
| ECS | miniplex | miniplex (engine-agnostic, keep) |

**What ports unchanged:** `world.ts` (pure), the vitest harness + golden, the miniplex ECS pattern,
the `kits-src/` asset pipeline (glTF is engine-neutral), the tier concept, the `?cam=` debug param.
**What's rewritten:** everything touching the renderer/physics API (scene, meshing, materials, post,
streaming glue, physics, instancing) — i.e. most of `render/`, `physics/`, `world-render/`, `main.ts`.

---

## 8. Migration plan (three.js → Babylon)
Build the Babylon app **in parallel** at `babylon/` → `/city-hustle/`; leave `/voxel-city2/` live
until the rebuild reaches parity + first hustle, then cut over. No big-bang deletion.
- **B0 Scaffold:** Babylon + Vite + TS; Engine/Scene/loop; a lit PBR box; deploy `/city-hustle/`.
  Verify build + headless boot (Playwright/swiftshader, as today).
- **B1 World port:** copy `world.ts` + harness + golden verbatim; vitest green. *Crown jewel secured.*
- **B2 Streaming city:** chunk manager + terrain/road/building/water meshes (thin instances), CSM,
  day/night, fog. → engine parity (G0).
- **B3 Physics & control:** Havok world, raycast vehicle + capsule character, follow camera (G1).
- **B4 Traffic/peds:** port the sim systems (engine-agnostic logic) onto thin instances + off-screen
  spawn.
- **B5+ Game:** hustles, economy, REP, heat, garage, UI, audio, mobile, content (G2→G7).

**Verification (every milestone):** `npm run typecheck` + `npm test` (harness/determinism) +
`npm run build` + headless smoke (no console errors, canvas renders) + `?cam=`/Inspector spot-checks
+ owner desktop drive. Same gates that have kept quality up.

---

## 9. Risks / honest notes
- **Cost:** the rebuild re-earns streaming/physics/post/LOD/CI that already work in three.js, before
  any *new* gameplay. Mitigation: keep the three.js build live during the rebuild; reuse `world.ts`,
  harness, ECS, asset pipeline verbatim so we're not redoing the irreplaceable parts.
- **Headless limits persist:** swiftshader timeouts affected three.js; Babylon's heavier default
  pipeline may be worse headless — but the **Inspector** is a real upgrade for *interactive* debug.
- **Havok WASM size/init:** lazy-load it off the critical path (we already learned this with Rapier).
- **Engine swap fixes none of the prior bugs** (they were world-gen/placement logic). The spec's real
  value is §1–6: defining the game we never built. That work is portable to any engine.
