# kits-src — drop your Blender `.glb` exports here

Put authored modules in this folder named exactly per the spec (see `../ASSETS.md`), then run:

```
cd app && npm run assets
```

The pipeline ingests every `<id>.glb` it finds here, optimizes + normalizes it, writes a hashed copy
to `public/kits/`, and regenerates `public/kits/manifest.json`. Any module you *don't* provide stays
a generated placeholder, so you can drop in files a few at a time.

Expected ids (minimum set in **bold**):

| id | what |
|----|------|
| **bld_z0_ground**, bld_z0_mid_0…, **bld_z0_roof** | residential building modules |
| **bld_z1_ground**, bld_z1_mid_0…, **bld_z1_roof** | downtown tower modules |
| **bld_z2_ground**, bld_z2_mid_0…, **bld_z2_roof** | industrial building modules |
| **veh_sedan** | the traffic car |

Add more `mid` variants (`bld_z1_mid_2.glb`, …) for visual variety — `selectKit` picks among them
per floor. This folder is committed (so the dir exists); your `.glb`s get committed too.
