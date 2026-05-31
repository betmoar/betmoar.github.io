// Asset pipeline. For every expected module id it INGESTS your real Blender export from
// `app/kits-src/<id>.glb` when present, otherwise authors a placeholder from scratch — so you can
// drop in any subset of files and the rest stay placeholder. Each module is optimized with
// gltf-transform (dequantize → weld → dedup → prune → EXT_meshopt_compression), normalized, hashed,
// and written to `app/public/kits/` with a generated `manifest.json`.   Run:  npm run assets
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { weld, dedup, prune, dequantize } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'kits');
const srcDir = join(here, '..', 'kits-src');
type V3 = [number, number, number];
interface Box { x?: number; y?: number; z?: number; w: number; h: number; d: number; col?: V3 }

// ---- placeholder geometry builder (used only when a source .glb is absent) ----
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

type Def = { height: number; boxes: Box[] };
const BUILDINGS: Record<string, { ground: Def; mid: Def[]; roof: Def }> = {
  z0: {
    ground: { height: 3.5, boxes: [{ y: 0, w: 1.0, h: 3.5, d: 1.0 }, { y: 0, w: 1.06, h: 0.4, d: 1.06 }] },
    mid: [{ height: 3.0, boxes: [{ y: 0, w: 0.97, h: 3.0, d: 0.97 }, { y: 2.7, w: 1.02, h: 0.3, d: 1.02 }] }],
    roof: { height: 2.2, boxes: [{ y: 0, w: 1.0, h: 1.6, d: 1.0 }, { y: 1.6, w: 1.05, h: 0.3, d: 1.05 }] },
  },
  z1: {
    ground: { height: 4, boxes: [{ y: 0, w: 1.0, h: 4, d: 1.0 }, { y: 0, w: 1.06, h: 0.5, d: 1.06 }, { y: 3.7, w: 1.04, h: 0.3, d: 1.04 }] },
    mid: [
      { height: 3.5, boxes: [{ y: 0, w: 0.96, h: 3.5, d: 0.96 }, { y: 3.2, w: 1.02, h: 0.3, d: 1.02 }] },
      { height: 3.5, boxes: [{ y: 0, w: 0.98, h: 3.5, d: 0.92 }, { y: 3.2, w: 1.02, h: 0.3, d: 1.0 }] },
    ],
    roof: { height: 3, boxes: [{ y: 0, w: 1.0, h: 2.2, d: 1.0 }, { y: 2.2, w: 1.04, h: 0.4, d: 1.04 }, { x: 0.18, z: -0.15, y: 2.6, w: 0.4, h: 0.4, d: 0.4 }] },
  },
  z2: {
    ground: { height: 5, boxes: [{ y: 0, w: 1.0, h: 5, d: 1.0 }, { y: 0, w: 1.04, h: 0.6, d: 1.04 }] },
    mid: [{ height: 4.0, boxes: [{ y: 0, w: 1.0, h: 4.0, d: 1.0 }] }],
    roof: { height: 1.6, boxes: [{ y: 0, w: 1.0, h: 1.0, d: 1.0 }, { x: -0.2, z: 0.2, y: 1.0, w: 0.5, h: 0.5, d: 0.5 }, { x: 0.25, z: -0.2, y: 1.0, w: 0.3, h: 0.7, d: 0.3 }] },
  },
};
const BODY: V3 = [1, 1, 1], GLASS: V3 = [0.10, 0.12, 0.17], TYRE: V3 = [0.04, 0.04, 0.05];
const VEHICLE: Box[] = [
  { y: 0.42, w: 2.0, h: 0.55, d: 4.0, col: BODY }, { y: 0.30, w: 2.05, h: 0.3, d: 3.4, col: BODY },
  { y: 0.95, z: -0.2, w: 1.6, h: 0.5, d: 1.9, col: GLASS },
  { x: 0.85, z: 1.35, y: 0, w: 0.45, h: 0.7, d: 0.7, col: TYRE }, { x: -0.85, z: 1.35, y: 0, w: 0.45, h: 0.7, d: 0.7, col: TYRE },
  { x: 0.85, z: -1.35, y: 0, w: 0.45, h: 0.7, d: 0.7, col: TYRE }, { x: -0.85, z: -1.35, y: 0, w: 0.45, h: 0.7, d: 0.7, col: TYRE },
];

// ---- shared IO ----
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

function buildPlaceholderDoc(boxes: Box[], withColor: boolean): Document {
  const doc = new Document();
  const buf = doc.createBuffer();
  const { pos, nrm, col } = boxSoup(boxes);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buf))
    .setMaterial(doc.createMaterial('m').setRoughnessFactor(0.7).setMetallicFactor(0.05).setBaseColorFactor([0.6, 0.62, 0.68, 1]));
  if (withColor) prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(buf));
  doc.createScene().addChild(doc.createNode('n').setMesh(doc.createMesh('mesh').addPrimitive(prim)));
  return doc;
}

// bbox over every POSITION in the doc (assumes node transforms are applied — see ASSETS.md)
function bbox(doc: Document) {
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'); if (!pos) continue;
    const a = pos.getArray() as ArrayLike<number>;
    for (let i = 0; i < a.length; i += 3) {
      mnx = Math.min(mnx, a[i]); mxx = Math.max(mxx, a[i]);
      mny = Math.min(mny, a[i + 1]); mxy = Math.max(mxy, a[i + 1]);
      mnz = Math.min(mnz, a[i + 2]); mxz = Math.max(mxz, a[i + 2]);
    }
  }
  return { mnx, mny, mnz, mxx, mxy, mxz };
}
function remap(doc: Document, fn: (x: number, y: number, z: number) => [number, number, number]): void {
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'); if (!pos) continue;
    const a = Float32Array.from(pos.getArray() as ArrayLike<number>);
    for (let i = 0; i < a.length; i += 3) { const [x, y, z] = fn(a[i], a[i + 1], a[i + 2]); a[i] = x; a[i + 1] = y; a[i + 2] = z; }
    pos.setArray(a);
  }
}
// Normalize a building module: footprint → exactly 1×1 centred on origin, base → y=0. Returns height.
function normalizeBuilding(doc: Document): number {
  const b = bbox(doc);
  const cx = (b.mnx + b.mxx) / 2, cz = (b.mnz + b.mxz) / 2;
  const ex = Math.max(1e-4, b.mxx - b.mnx), ez = Math.max(1e-4, b.mxz - b.mnz);
  remap(doc, (x, y, z) => [(x - cx) / ex, y - b.mny, (z - cz) / ez]);
  return b.mxy - b.mny;
}
// Normalize the vehicle: centred on origin in XZ, wheels on y=0. Real-size (no scaling).
function normalizeVehicle(doc: Document): void {
  const b = bbox(doc);
  const cx = (b.mnx + b.mxx) / 2, cz = (b.mnz + b.mxz) / 2;
  remap(doc, (x, y, z) => [x - cx, y - b.mny, z - cz]);
}

async function emit(doc: Document, id: string): Promise<string> {
  await doc.transform(weld(), dedup(), prune());
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const glb = await io.writeBinary(doc);
  const hash = createHash('sha1').update(glb).digest('hex').slice(0, 8);
  const file = `${id}.${hash}.glb`;
  writeFileSync(join(outDir, file), Buffer.from(glb));
  return `kits/${file}`;
}

type Entry = { id: string; url: string; height: number };
const srcFiles = existsSync(srcDir) ? readdirSync(srcDir).filter((f) => f.endsWith('.glb')) : [];
function hasSrc(id: string): boolean { return srcFiles.includes(`${id}.glb`); }

// Resolve one building module: ingest source if present, else author placeholder.
async function building(id: string, ph: Def | undefined): Promise<Entry | null> {
  if (hasSrc(id)) {
    const doc = await io.read(join(srcDir, `${id}.glb`));
    await doc.transform(dequantize());
    const height = normalizeBuilding(doc);
    console.log(`  [src] ${id}  h=${height.toFixed(2)}`);
    return { id, url: await emit(doc, id), height };
  }
  if (ph) { console.log(`  [placeholder] ${id}`); return { id, url: await emit(buildPlaceholderDoc(ph.boxes, false), id), height: ph.height }; }
  return null;
}

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) rmSync(join(outDir, f));

const manifest: { kits: Record<string, { ground: Entry; mid: Entry[]; roof: Entry }>; vehicle: { id: string; url: string } } = { kits: {}, vehicle: { id: 'veh_sedan', url: '' } };

for (const zone of Object.keys(BUILDINGS)) {
  const ph = BUILDINGS[zone];
  const ground = (await building(`bld_${zone}_ground`, ph.ground))!;
  const roof = (await building(`bld_${zone}_roof`, ph.roof))!;
  // mids = placeholder indices ∪ any bld_<zone>_mid_<n>.glb dropped into kits-src/
  const ids = new Set<string>(ph.mid.map((_, i) => `bld_${zone}_mid_${i}`));
  for (const f of srcFiles) { const m = f.match(new RegExp(`^(bld_${zone}_mid_\\d+)\\.glb$`)); if (m) ids.add(m[1]); }
  const mid: Entry[] = [];
  for (const id of [...ids].sort()) {
    const i = Number(id.split('_').pop());
    const e = await building(id, ph.mid[i]);
    if (e) mid.push(e);
  }
  manifest.kits[zone] = { ground, mid, roof };
}

// vehicle
{
  const id = 'veh_sedan';
  if (hasSrc(id)) {
    const doc = await io.read(join(srcDir, `${id}.glb`));
    await doc.transform(dequantize());
    normalizeVehicle(doc);
    console.log(`  [src] ${id}`);
    manifest.vehicle = { id, url: await emit(doc, id) };
  } else {
    console.log(`  [placeholder] ${id}`);
    manifest.vehicle = { id, url: await emit(buildPlaceholderDoc(VEHICLE, true), id) };
  }
}

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
const nSrc = srcFiles.length;
console.log(`\nwrote manifest.json — zones ${Object.keys(manifest.kits).join(',')} + vehicle  (${nSrc} source file${nSrc === 1 ? '' : 's'} ingested, rest placeholder)`);
