// Asset pipeline (placeholder kit, all zones + vehicle). Authors building modules for every zone
// and a low-poly vehicle from scratch, optimizes with gltf-transform (weld → dedup → prune →
// meshopt), writes hashed .glb to public/kits/ + manifest.json. Proves the full content pipeline;
// real authored .glb files drop into the same optimize+manifest path.  Run: npm run assets
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { weld, dedup, prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'kits');
type V3 = [number, number, number];
interface Box { x?: number; y?: number; z?: number; w: number; h: number; d: number; col?: V3 }

function boxSoup(boxes: Box[]) {
  const P: number[] = [], N: number[] = [], C: number[] = [];
  for (const { x = 0, y = 0, z = 0, w, h, d, col = [1, 1, 1] } of boxes) {
    const hx = w / 2, hz = d / 2;
    const v: V3[] = [
      [-hx, y, -hz], [hx, y, -hz], [hx, y + h, -hz], [-hx, y + h, -hz],
      [-hx, y, hz], [hx, y, hz], [hx, y + h, hz], [-hx, y + h, hz],
    ].map(([a, b, c]) => [a + x, b, c + z] as V3);
    const faces: Array<[number, number, number, V3]> = [
      [0, 2, 1, [0, 0, -1]], [0, 3, 2, [0, 0, -1]], [5, 7, 4, [0, 0, 1]], [5, 6, 7, [0, 0, 1]],
      [4, 3, 0, [-1, 0, 0]], [4, 7, 3, [-1, 0, 0]], [1, 6, 5, [1, 0, 0]], [1, 2, 6, [1, 0, 0]],
      [3, 6, 2, [0, 1, 0]], [3, 7, 6, [0, 1, 0]], [4, 1, 5, [0, -1, 0]], [4, 0, 1, [0, -1, 0]],
    ];
    for (const [a, b, c, nm] of faces) for (const idx of [a, b, c]) { P.push(...v[idx]); N.push(...nm); C.push(...col); }
  }
  return { pos: new Float32Array(P), nrm: new Float32Array(N), col: new Float32Array(C) };
}

// ---- module definitions ----
type Def = { height: number; boxes: Box[] };
const BUILDINGS: Record<string, Record<string, Def | Def[]>> = {
  // zone 0 — residential (low, warm brick), modest banded floors
  z0: {
    ground: { height: 3.5, boxes: [{ y: 0, w: 1.0, h: 3.5, d: 1.0 }, { y: 0, w: 1.06, h: 0.4, d: 1.06 }] },
    mid: [{ height: 3.0, boxes: [{ y: 0, w: 0.97, h: 3.0, d: 0.97 }, { y: 2.7, w: 1.02, h: 0.3, d: 1.02 }] }],
    roof: { height: 2.2, boxes: [{ y: 0, w: 1.0, h: 1.6, d: 1.0 }, { y: 1.6, w: 1.05, h: 0.3, d: 1.05 }] },
  },
  // zone 1 — downtown glass towers (tallest, strong floor banding)
  z1: {
    ground: { height: 4, boxes: [{ y: 0, w: 1.0, h: 4, d: 1.0 }, { y: 0, w: 1.06, h: 0.5, d: 1.06 }, { y: 3.7, w: 1.04, h: 0.3, d: 1.04 }] },
    mid: [
      { height: 3.5, boxes: [{ y: 0, w: 0.96, h: 3.5, d: 0.96 }, { y: 3.2, w: 1.02, h: 0.3, d: 1.02 }] },
      { height: 3.5, boxes: [{ y: 0, w: 0.98, h: 3.5, d: 0.92 }, { y: 3.2, w: 1.02, h: 0.3, d: 1.0 }] },
    ],
    roof: { height: 3, boxes: [{ y: 0, w: 1.0, h: 2.2, d: 1.0 }, { y: 2.2, w: 1.04, h: 0.4, d: 1.04 }, { x: 0.18, z: -0.15, y: 2.6, w: 0.4, h: 0.4, d: 0.4 }] },
  },
  // zone 2 — industrial (low, wide, blocky with rooftop vents)
  z2: {
    ground: { height: 5, boxes: [{ y: 0, w: 1.0, h: 5, d: 1.0 }, { y: 0, w: 1.04, h: 0.6, d: 1.04 }] },
    mid: [{ height: 4.0, boxes: [{ y: 0, w: 1.0, h: 4.0, d: 1.0 }] }],
    roof: { height: 1.6, boxes: [{ y: 0, w: 1.0, h: 1.0, d: 1.0 }, { x: -0.2, z: 0.2, y: 1.0, w: 0.5, h: 0.5, d: 0.5 }, { x: 0.25, z: -0.2, y: 1.0, w: 0.3, h: 0.7, d: 0.3 }] },
  },
};

// low-poly vehicle, vertex-coloured: white body (takes the per-instance paint tint), dark cabin +
// near-black wheels. Footprint ~2.1×4.2, length along Z, wheels touching y≈0.
const BODY: V3 = [1, 1, 1], GLASS: V3 = [0.10, 0.12, 0.17], TYRE: V3 = [0.04, 0.04, 0.05];
const VEHICLE: Box[] = [
  { y: 0.42, w: 2.0, h: 0.55, d: 4.0, col: BODY },                         // main body
  { y: 0.30, w: 2.05, h: 0.3, d: 3.4, col: BODY },                         // lower sill
  { y: 0.95, z: -0.2, w: 1.6, h: 0.5, d: 1.9, col: GLASS },               // cabin / greenhouse
  { x: 0.85, z: 1.35, y: 0, w: 0.45, h: 0.7, d: 0.7, col: TYRE },          // wheels
  { x: -0.85, z: 1.35, y: 0, w: 0.45, h: 0.7, d: 0.7, col: TYRE },
  { x: 0.85, z: -1.35, y: 0, w: 0.45, h: 0.7, d: 0.7, col: TYRE },
  { x: -0.85, z: -1.35, y: 0, w: 0.45, h: 0.7, d: 0.7, col: TYRE },
];

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) rmSync(join(outDir, f));

async function emit(id: string, boxes: Box[], withColor: boolean): Promise<string> {
  const doc = new Document();
  const buf = doc.createBuffer();
  const { pos, nrm, col } = boxSoup(boxes);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buf))
    .setMaterial(doc.createMaterial(id).setRoughnessFactor(0.7).setMetallicFactor(0.05).setBaseColorFactor([0.6, 0.62, 0.68, 1]));
  if (withColor) prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(buf));
  doc.createScene().addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(prim)));
  await doc.transform(weld(), dedup(), prune());
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const glb = await io.writeBinary(doc);
  const hash = createHash('sha1').update(glb).digest('hex').slice(0, 8);
  const file = `${id}.${hash}.glb`;
  writeFileSync(join(outDir, file), Buffer.from(glb));
  console.log(`  ${file}  (${glb.byteLength} b)`);
  return `kits/${file}`;
}

type Entry = { id: string; url: string; height: number };
const manifest: { kits: Record<string, { ground: Entry; mid: Entry[]; roof: Entry }>; vehicle: { id: string; url: string } } = { kits: {}, vehicle: { id: 'veh_sedan', url: '' } };

for (const [zone, mods] of Object.entries(BUILDINGS)) {
  const ground = mods.ground as Def, roof = mods.roof as Def, mids = mods.mid as Def[];
  const g: Entry = { id: `bld_${zone}_ground`, url: await emit(`bld_${zone}_ground`, ground.boxes, false), height: ground.height };
  const r: Entry = { id: `bld_${zone}_roof`, url: await emit(`bld_${zone}_roof`, roof.boxes, false), height: roof.height };
  const m: Entry[] = [];
  for (let i = 0; i < mids.length; i++) m.push({ id: `bld_${zone}_mid_${i}`, url: await emit(`bld_${zone}_mid_${i}`, mids[i].boxes, false), height: mids[i].height });
  manifest.kits[zone] = { ground: g, mid: m, roof: r };
}
manifest.vehicle = { id: 'veh_sedan', url: await emit('veh_sedan', VEHICLE, true) };

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('wrote manifest.json — zones:', Object.keys(manifest.kits).join(','), '+ vehicle');
