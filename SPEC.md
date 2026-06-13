# CITY HUSTLE — Implementation Spec
### Browser GTA-style open-world side-hustle game · Babylon.js rebuild · **new separate repo**

> Hand-off doc. Lives in `betmoar.github.io` temporarily only; the rebuild is scaffolded in a new
> repo (`city-hustle`). The current three.js build (`/voxel-city2/`) stays live here. This spec is
> precise enough to reproduce the world from scratch on any engine.

---

## 1. Tech stack
- **Engine:** Babylon.js 7.x (TypeScript, WebGL2; WebGPU later). **Build:** Vite + TS.
- **Physics:** Havok (`@babylonjs/havok`, WASM, lazy-loaded) via Babylon physics v2. Raycast vehicle +
  capsule character controller.
- **ECS:** miniplex (engine-agnostic, ported).
- **Assets:** glTF 2.0 `.glb` (Blender-authored), optimized via gltf-transform (weld/dedup/prune/
  meshopt + KTX2). Loaded with Babylon `SceneLoader` + Draco/meshopt + KTX2 decoders.
- **Tests:** vitest — determinism golden + world invariants harness (ported verbatim).
- **Deploy:** static build → GitHub Pages (Actions). Headless smoke via Playwright.
- **Debug:** Babylon Inspector (`scene.debugLayer`) + `?cam=x,y,z,tx,ty,tz` URL param.

**Ports verbatim from the three.js build (engine-agnostic, do NOT rewrite):** `world.ts` (all logic
below), the vitest harness + `world-golden.json`, the miniplex ECS, the asset pipeline.
**Rewritten for Babylon:** scene/render loop, chunk meshing, materials, post, physics, instancing.

---

## 2. World constants (exact)
```
SEED = 1337            SEA_LEVEL = 0
CHUNK = 48             (world units per chunk side)
SEG = 24               (terrain mesh subdivisions per chunk → 2-unit vertex grid)
RADIUS = 4             (chunk streaming ring radius; = tier drawRings)
GRID_SP = 32           (fine lattice: building lot spacing)
ROAD_W = 5             (street half-width)        HWY_W = 9   (highway half-width)
LANE = 2.2             (lane-centre offset from road centreline)
BAND = 3               (grid lines per road band → variable block sizes)
ROAD_CITY_MIN = 0.18   (min cityness for a road to exist)
ROAD_WATER_MARGIN = 1.5
salts: rng building=11, park=23, landmark=41 · road lines RX=1001 RZ=2002 · hwy HX=3003 HZ=4004
```

## 3. Determinism primitives (exact — the basis of everything)
```ts
// integer hash → [0,1)
hash(ix, iz):
  h = (ix*374761393 + iz*668265263 + SEED*982451653) | 0
  h = (h ^ (h>>>13)) * 1274126177;  h = h ^ (h>>>16)
  return (h>>>0) / 4294967296

smooth(t) = t*t*(3-2t)

valueNoise(x,z):                       // bilinear value noise on integer lattice
  x0=floor(x), z0=floor(z), fx=x-x0, fz=z-z0
  bilerp(hash(x0,z0),hash(x0+1,z0),hash(x0,z0+1),hash(x0+1,z0+1)) with u=smooth(fx), v=smooth(fz)

rng(cx,cz,salt) → mulberry32 stream:   // per-lot deterministic PRNG; call () for next [0,1)
  a = (cx*73856093) ^ (cz*19349663) ^ (salt*83492791) ^ SEED
  next(): a|=0; a=a+0x6D2B79F5|0; t=imul(a^a>>>15,1|a); t=t+imul(t^t>>>7,61|t)^t; return (t^t>>>14)>>>0 /2^32
```
All world functions are PURE: same (x,z)+SEED → identical output. No `Math.random()` anywhere in
world-gen (only in transient sim like traffic spawn jitter).

## 4. Terrain (exact)
```ts
terrainRaw(wx,wz):                     // 4-octave value-noise FBM, shaped
  h=0, amp=1, freq=0.006, sum=0
  for o in 0..3: h += valueNoise(wx*freq, wz*freq)*amp; sum+=amp; amp*=0.5; freq*=2
  h /= sum
  return (pow(h,1.3) - 0.18) * 44       // → roughly [-8 .. +36] units; <0 is underwater

blockLevel(wx,wz):                     // terrain bilerp'd at the GRID_SP cell corners (flattening base)
  bilerp of terrainRaw at the 4 corners of the GRID_SP cell containing (wx,wz)

terrainHeight(wx,wz):                  // THE surface height — flattens urban land toward block level
  raw = terrainRaw(wx,wz);  cn = cityness(wx,wz)
  if cn <= 0.12: return raw
  k = min(1, (cn-0.12)/0.4)            // blend strength
  return lerp(raw, blockLevel(wx,wz), k)
```
**Render:** per chunk, a `SEG×SEG` (24×24 → 2-unit) grid plane, each vertex displaced to
`terrainHeight`, vertex-coloured by altitude band (underwater/beach/grass/rock/snow + noise tint),
flat-shaded. Water = a separate plane at `SEA_LEVEL` where the chunk dips below it.

## 5. Cityness & zoning (exact — drives roads + buildings)
```ts
region(wx,wz) = valueNoise(wx*0.0009+100, wz*0.0009-100)   // low-freq urban mask

cityness(wx,wz):                       // [0,1] how urban; 0 outside urban regions
  if region < 0.52: return 0
  urban = (region-0.52)/0.48
  h = terrainRaw(wx,wz)
  flat = 1 - min(1, |terrainRaw(wx+6,wz)-h| / 6)          // flatter ground = more urban
  low  = 1 - min(1, max(0,h)/16)                           // lower ground = more urban
  return clamp01((flat*0.5 + low*0.5) * urban)

urbanCore(wx,wz):                      // [0,1] downtown intensity
  if region < 0.52: return 0;  return pow(clamp01((region-0.52)/0.48), 1.6)

zone(wx,wz) → 0|1|2:                   // 0 residential, 1 downtown, 2 industrial
  core = urbanCore; ind = valueNoise(wx*0.0022-300, wz*0.0022+220)
  if ind>0.66 and core<0.55: return 2
  if core>0.5: return 1
  return 0
```

## 6. ROADS (exact algorithm)
**Concept:** building lots sit on the fine `GRID_SP` lattice. Roads run on a COARSER **variable**
lattice: grid lines are grouped into **bands of `BAND`(=3) lines**; each band contributes **exactly one
road line** at a hashed offset (0 or 1 within the band). Independent per axis → blocks span **2–4 lots**
and differ between X and Z (rectangular, varied — not a uniform square mesh). Roads exist only where
the neighbourhood is urban and dry.
```ts
roadIdxX(b) = b*BAND + (hash(b, SALT_RX) < 0.5 ? 0 : 1)    // the one road line in band b (X axis)
roadIdxZ(b) = b*BAND + (hash(b, SALT_RZ) < 0.5 ? 0 : 1)
isRoadLineX(c): i=round(c/GRID_SP); return i === roadIdxX(floor(i/BAND))
isRoadLineZ(c): i=round(c/GRID_SP); return i === roadIdxZ(floor(i/BAND))

// highways: a band is a highway band ~22% of the time (per axis), giving wider roads
isHwyX(c)= hash(floor(round(c/GRID_SP)/BAND), SALT_HX) < 0.22   ; isHwyZ similar with SALT_HZ
roadHalfWidth(c) = (isHwyX(c)||isHwyZ(c)) ? HWY_W : ROAD_W

// urban support: road exists only if adjacent cells are urban enough
supportV(lineX,wz) = max(cityness(lineX-16,wz), cityness(lineX+16,wz)) >= ROAD_CITY_MIN
supportH(wx,lineZ) = max(cityness(wx,lineZ-16), cityness(wx,lineZ+16)) >= ROAD_CITY_MIN

// THE road predicate
roadHere(wx,wz):
  if terrainHeight(wx,wz) < SEA_LEVEL + ROAD_WATER_MARGIN: return false   // no roads in/near water
  lx=nearestLine(wx); lz=nearestLine(wz)                                  // nearestLine = round to GRID_SP
  if isRoadLineX(lx) and |wx-lx|<=roadHalfWidth(lx) and supportV(lx,wz): return true   // avenue (along Z)
  if isRoadLineZ(lz) and |wz-lz|<=roadHalfWidth(lz) and supportH(wx,lz): return true   // cross-street (along X)
  return false

nearestRoadLineX(x)/Z(z): scan bands floor(x/GRID_SP/BAND)-1..+1, return nearest roadIdx*GRID_SP
  (used to snap traffic/peds onto actual road centrelines)
```
**`buildRoadNetwork(cx,cz)` → `{segments[], intersections[]}`** (validated model; renderer only draws
this, makes no geometric decisions):
- For each **road line** crossing the chunk (X then Z), walk it in `STEP=2` increments; where
  `roadHere` is true, emit a segment `{x,z,(x2|z2),vertical,hw,type:'hwy'|'st'}`.
- For each road-line **intersection** in the chunk, if `roadHere` at centre AND a road continues on
  both axes, emit `{x,z,hwx,hwz,light}`. **`light = isHwyX(x) && isHwyZ(z)`** (signals only at
  highway×highway junctions).

**RENDER (Babylon):** for each segment, build a quad strip **subdivided across width in 2-unit steps**,
each corner sampled at road height = `max(terrainHeight, SEA_LEVEL) + 0.30`. → the asphalt conforms to
terrain slopes and tiles seamlessly with neighbours (no stepped/floating ribbon, no gaps). Merge a
chunk's road quads into one mesh. Lane markings/crosswalks: decals or vertex-coloured strips driven
off the same segment data (never independently placed).

**TRAFFIC consumes roads:** cars pin to `nearestRoadLineX/Z`, offset by `LANE` for right-hand
driving, turn only at real crossings, reverse at road ends, and **spawn only in a far band
`[fogNear, fogNear+70]`** around the camera focus (so they appear in haze / off-screen and drive in,
never pop in). Density: ~60 cars / 80 peds local.

## 7. BUILDINGS (exact algorithm)
**Placement** — `buildingAt(lx,lz)` is evaluated at **lot centres** (`GRID_SP` grid, offset to cell
centres). Returns `null` or a full spec. **Single source of truth** for both geometry and collision.
```ts
buildingAt(lx,lz):
  if onRoadTile(lx,lz): return null              // not on/next to a road tile
  if isPark(lx,lz): return null                  // isPark: cityness>0.2 and rng(.,.,23)()<0.16
  cn=cityness; core=urbanCore; zn=zone
  br = rng(round(lx), round(lz), 11)             // per-lot PRNG (ORDER OF br() CALLS IS LOAD-BEARING)
  density = zn==1 ? min(1, 0.55+core*0.5) : zn==2 ? 0.6 : min(0.75, cn*0.7+0.15)
  if br() > density: return null                 // (br call #1) sparsity
  room = GRID_SP - 2*ROAD_W - 3                  // = 19; max footprint inside the lot
  fillBase = zn==0 ? 0.45 : zn==2 ? 0.7 : 0.6
  w = max(4, room*(fillBase + br()*0.35))        // (br #2)
  d = max(4, room*(fillBase + br()*0.35))        // (br #3)
  hw=w/2, hd=d/2
  corners = terrainHeight at (lx±hw, lz±hd)
  lowG=min(corners), highG=max(corners)
  if lowG < SEA_LEVEL+0.5: return null           // no buildings in water
  if highG-lowG > 6: return null                 // too steep a lot
  lr = rng(round(lx),round(lz),41)
  isLandmark = core>0.78 and lr()<0.10           // (lr #1)
  hgt = isLandmark ? 80+lr()*60                  // (lr #2)
      : zn==1 ? 12 + core*core*70 + br()*14      // (br #4) downtown towers
      : zn==2 ? 7 + br()*8                        // industrial
      :         6 + br()*(6 + core*10)            // residential
  return {lx,lz,w,d,hw,hd,lowG,highG,isLandmark,hgt,zn,core,br}

buildingFootprintAt(x,z):                        // collision; snaps to owning lot, tests footprint+1
  bx,bz = lot centre containing (x,z)
  B = buildingAt(bx,bz);  return B && |x-bx|<B.hw+1 && |z-bz|<B.hd+1
```
**RENDER + SEATING (the alignment fix — critical):** sample the **rendered terrain-mesh** height
(bilinear over the 2-unit vertex grid, i.e. the surface actually drawn) at the footprint corners+margin.
- **Seat the building base at the MAX** sampled height (never buried into a rising slope).
- **Drop a foundation pad** from the base down past the **MIN** sampled height (−1 m), slightly wider
  than the footprint → no floating edge over falling ground. This is independent of `lowG/highG`, so
  it can't drift from what's drawn.
**Hybrid assets:** the box volume is replaced by authored kit modules — stack `ground` + N×`mid`
(deterministic variant per floor via the lot's `rng`) + `roof` to reach `hgt`, scaled to `w×d`.
**Collision** stays a Havok box from the spec (`w×hgt×d` at the seated base) — visuals may exceed it.

## 8. Streaming & render pipeline
- **Chunks** stream in a `RADIUS` ring around the camera focus (ground-projected position). On enter:
  build terrain+roads+water meshes from `world.ts`; buildings only within an inner ring (drawRings−1,
  HLOD-lite). On exit: dispose. Physics colliders (terrain trimesh + building boxes) stream with the
  inner ring; Havok loads lazily.
- **Instancing:** traffic, peds, props, trees via **thin instances** (one draw call per mesh type).
- **Materials:** `PBRMaterial`; `scene.environmentTexture` (.env) for IBL; `DefaultRenderingPipeline`
  (bloom, FXAA/MSAA, optional SSAO2 + SSR on high tier). `CascadedShadowGenerator` for the sun.
- **Day/night:** directional sun (position/intensity by time), sky + fog colour ramp
  (night→dusk→day), IBL intensity scaled by daylight, headlights at night. Fog hides the streaming
  edge (and gates traffic spawn distance).
- **Quality tiers** (low/med/high) auto-detected + `?tier=` override: scale pixel ratio, draw rings,
  shadow res, post FX, LOD bias.

## 9. Test harness (ported, must stay green)
- **Determinism golden:** `world-golden.json` snapshots 1080 scalar samples + 40 building specs + 5
  road networks + 78 signal states + rng sequences; `world.test.ts` asserts the ported `world.ts`
  reproduces them bit-for-bit.
- **Invariants** (over populated chunks): no road over water; intersections are real crossings;
  crosswalks on-road & dry; road surface clears terrain; no building on a road; **collision matches
  geometry** (buildingFootprintAt ⇔ buildingAt); finite heights; signals never both-green & cycle.
- Regenerate the golden only on an INTENTIONAL world change (`node test/gen-golden.mjs`).

---

## 10. GAMEPLAY (the game we haven't built yet)
**Core loop (60–180s):** explore → accept a hustle (world marker) → do it (drive/deliver/evade) →
earn $ + REP → spend $ on cars/upgrades → repeat at higher tiers.

**Player/vehicles:** on-foot (walk/sprint) + in-car; **E** enter/steal nearest car. Arcade handling
(Havok raycast vehicle: accel/topspeed/grip/handling per vehicle). Owned garage; selected car on call.
**Upgrades** per car: engine/tires/armor/nitro, $-gated.

**Hustles (v1)** — spawn as markers near the player, pure-function from world seed + time + REP tier:
| Hustle | Loop | Pay | Heat |
|---|---|---|---|
| Delivery | parcel → drop-off before timer | $ | – |
| Taxi fare | pick up ped → destination (+smooth-driving bonus) | $ | – |
| Courier rush | multi-stop chain, escalating timer | $$ | low |
| Repo/steal | steal a marked car → chop shop | $$ | med |
| Getaway | drive client A→B evading police | $$$ | high |
| Street race | checkpoints, beat par/rivals | $$ | low |

**Economy & progression:** **$** (cars, upgrades, garage slots, bail) and **REP** (ranks
Rookie→Kingpin → unlock hustle tiers + better shop cars + payout multiplier). Higher tiers pay more
but raise **heat**.

**Heat/police:** wanted stars 0–5 from crimes; police spawn + pursue; evade (break LOS + distance +
time) or get busted (lose cash/bail, car impounded); stars decay when uncontested.

**UI:** HUD (cash, REP/rank, mini-map w/ markers+objective, wanted stars, speedo, objective+timer);
menus (garage, hustle board, settings); 60s onboarding delivery; KB/M + touch controls.
**Audio:** procedural radio, speed-mapped engine SFX, sirens/UI/pickup SFX, positional.
**Persistence:** localStorage v1 (cash, REP, cars, upgrades, settings, seed); cloud later.

---

## 11. Milestones (game-first, each playable/verifiable)
- **B0** scaffold (Babylon+Vite+TS, lit PBR box, deploy `/city-hustle/`, headless boot)
- **B1** port `world.ts` + harness + golden — vitest green (*crown jewel secured*)
- **B2** streaming city (terrain/roads/buildings/water, thin instances, CSM, day/night, fog) → parity
- **B3** Havok vehicle + capsule character + follow camera, enter/exit (drive & walk)
- **B4** traffic + peds (ported sim, off-screen spawn)
- **G2** first hustle (delivery) + cash HUD + payout + localStorage
- **G3** hustle variety + REP ranks + payout multiplier + hustle-board UI
- **G4** heat/police + repo/getaway
- **G5** garage + per-car upgrades
- **G6** authored vehicle/character/building kits, audio, onboarding, mobile, perf
- **G7** ship (balance, save migration, deploy)

**Verification gates (every milestone):** typecheck + vitest (harness/determinism) + build + headless
smoke (no console errors) + `?cam=`/Inspector + owner desktop drive.

## 12. Honest notes
- The engine swap fixes none of the prior bugs (they were world-gen/placement logic — all corrected
  above). The rebuild re-earns streaming/physics/post that already work in three.js; keep that build
  live during the rebuild and reuse `world.ts`/harness/ECS/asset-pipeline verbatim.
- Reproduce-from-spec test: a fresh implementation of §3–7 with SEED=1337 must pass the ported golden.
