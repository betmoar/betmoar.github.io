# Voxel City 2 — Asset Spec (Blender → web)

Everything renders on generated **placeholders** until you drop real `.glb` files into
`app/kits-src/`. The pipeline (`npm run assets`) ingests each one, optimizes + normalizes it, and
regenerates `public/kits/manifest.json`. You can provide any subset — missing modules stay
placeholder. **No code changes are needed when you add assets.**

## File format (all modules)
- **glTF 2.0 binary `.glb`**, one object/mesh per file.
- **+Y up, metres** (1 Blender unit = 1 m).
- **PBR Metallic/Roughness** materials. Pack Occlusion/Roughness/Metallic into one ORM texture if you
  can; albedo/normal/ORM are all fine. (Textures pass through today; KTX2/Basis compression is a
  planned pipeline step — see *Roadmap* below.)
- **Apply transforms before export** (Blender: Object → Apply → All Transforms). The pipeline reads
  raw vertex positions and assumes node transforms are baked.
- Keep polycount sane (LOD generation is a later pipeline step). Rough targets: building module
  ≤ ~2k tris, vehicle ≤ ~3k tris.

## What to provide

### 1. Buildings — modular kit (per zone)
Buildings are **stacked**: `ground` (street level) → N × `mid` (repeated floors) → `roof` (cap). The
engine scales each module to the target building's width/depth and stacks `mid`s to reach its height.

**Author each building module with:**
- Footprint roughly **square around the origin** in X/Z (it gets normalized to exactly 1×1 — so model
  it at any convenient size; proportions in X vs Z are preserved by the per-building scale, the
  absolute footprint is not).
- Built **upward from the ground** (base near y=0; the pipeline floors it to y=0 exactly).
- A `mid` module should **tile vertically** — its top edge should meet its own bottom edge cleanly so
  stacked floors look continuous.

| Zone | Character | Files (minimum in **bold**) |
|------|-----------|------------------------------|
| z0 residential | low, warm, modest | **bld_z0_ground.glb**, bld_z0_mid_0.glb …, **bld_z0_roof.glb** |
| z1 downtown | tall glass towers | **bld_z1_ground.glb**, bld_z1_mid_0.glb …, **bld_z1_roof.glb** |
| z2 industrial | wide, blocky | **bld_z2_ground.glb**, bld_z2_mid_0.glb …, **bld_z2_roof.glb** |

Add more `mid` variants (`bld_z1_mid_1.glb`, `bld_z1_mid_2.glb`, …) for variety — `selectKit` picks
among them deterministically per floor.

### 2. Vehicle
- **veh_sedan.glb** — model at **real size ≈ 2.1 m wide (X) × 4.2 m long (Z)**, length along **Z**,
  wheels resting near **y=0** (the pipeline centres it in XZ and floors wheels to y=0; it does **not**
  rescale — so author it true-to-size).
- Make the **body** white (or vertex-paint it white) so the engine's per-instance **paint colour**
  tints it. Cabin/glass and wheels can be their own colours.
- Optional later: `veh_van`, `veh_truck`, etc. (needs a small loader change — ask when ready).

### 3. Pedestrian (optional, larger effort)
- **char_ped.glb** — a **rigged + skinned** humanoid ~1.8 m tall with animation clips named
  `idle`, `walk`, `run`. Peds stay box-humanoids until this lands (needs an animation-system step).

## Normalization the pipeline applies for you
| Module kind | Footprint (X/Z) | Vertical | Notes |
|---|---|---|---|
| building | scaled to **1×1**, centred on origin | base floored to **y=0**; height read from bbox | per-building w/d scale restores real proportions |
| vehicle | centred on origin, **not scaled** | wheels floored to **y=0** | author at real metres |

## Pipeline steps (`npm run assets`)
`dequantize → weld → dedup → prune → EXT_meshopt_compression` per module, then a hashed filename
(`bld_z1_mid_0.<hash>.glb`) and a regenerated `manifest.json`. Hashing = long-cache friendly +
automatic cache-busting.

## Workflow
```
# 1. export your .glb files from Blender into:
app/kits-src/        # e.g. bld_z1_ground.glb, bld_z1_mid_0.glb, veh_sedan.glb
# 2. regenerate optimized assets + manifest:
cd app && npm run assets
# 3. preview:
npm run build && npm run preview     # open /voxel-city2/
```
Commit both your `kits-src/*.glb` (sources) and the regenerated `public/kits/*` (optimized output).

## Roadmap (pipeline additions, when needed)
- **KTX2/Basis** texture compression (UASTC normals/ORM, ETC1S albedo) + a `KTX2Loader` in the app.
- **LOD generation** (meshopt simplify → LOD1/LOD2) wired to the existing distance LOD system.
- Multiple vehicle types + props (`prop_lamp`, `prop_tree`, `prop_signal`, `prop_bench`).
