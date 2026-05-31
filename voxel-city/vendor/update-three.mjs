// update-three.mjs — re-vendor Three.js locally so the game is fully self-contained
// (no CDN at runtime). Run from the voxel-city dir in a network-enabled environment:
//
//     node vendor/update-three.mjs            # uses THREE_VERSION below
//     THREE_VERSION=0.161.0 node vendor/update-three.mjs
//
// What it does:
//   1. `npm pack three@<version>` into a temp dir (npm registry, not the jsDelivr CDN —
//      the CDN is blocked in some sandboxes, npm is not).
//   2. Copies build/three.module.js to vendor/three/three.module.js.
//   3. Starting from the addon ENTRY_POINTS this game imports, follows every relative
//      import and copies exactly the reachable files into vendor/three/addons/ — so we
//      vendor the minimal closure, not all ~570 example modules.
//   4. Copies the LICENSE.
//
// The importmap in index.html points "three" and "three/addons/" at these local files.
// If you start importing a new addon, add it to ENTRY_POINTS and re-run.

import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync, copyFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const VERSION = process.env.THREE_VERSION || '0.160.0';
const ENTRY_POINTS = [
  'postprocessing/EffectComposer.js',
  'postprocessing/RenderPass.js',
  'postprocessing/UnrealBloomPass.js',
];

const here = dirname(fileURLToPath(import.meta.url));         // .../voxel-city/vendor
const DEST = join(here, 'three');
const ADDONS_DEST = join(DEST, 'addons');
const work = join(tmpdir(), 'three-vendor-' + Date.now());

console.log(`Vendoring three@${VERSION} -> ${relative(process.cwd(), DEST)}`);
mkdirSync(work, { recursive: true });
execSync(`npm pack three@${VERSION}`, { cwd: work, stdio: 'inherit' });
const tgz = readdirSync(work).find(f => f.endsWith('.tgz'));
if (!tgz) throw new Error('npm pack produced no tarball');
execSync(`tar xzf ${tgz}`, { cwd: work });

const SRC = join(work, 'package');
const JSM = join(SRC, 'examples/jsm');
const importRe = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;

const seen = new Set();
function walk(relPath) {
  if (seen.has(relPath)) return;
  seen.add(relPath);
  const abs = join(JSM, relPath);
  const code = readFileSync(abs, 'utf8');
  let m;
  while ((m = importRe.exec(code))) {
    const spec = m[1];
    if (spec === 'three' || spec.startsWith('three/')) continue; // core handled by importmap
    if (!spec.startsWith('.')) throw new Error(`unexpected bare import "${spec}" in ${relPath}`);
    walk(relative(JSM, resolve(dirname(abs), spec)));
  }
}
for (const e of ENTRY_POINTS) walk(e);

// fresh copy
rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
copyFileSync(join(SRC, 'build/three.module.js'), join(DEST, 'three.module.js'));
if (existsSync(join(SRC, 'LICENSE'))) copyFileSync(join(SRC, 'LICENSE'), join(DEST, 'LICENSE'));
for (const rel of seen) {
  const to = join(ADDONS_DEST, rel);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(JSM, rel), to);
}
rmSync(work, { recursive: true, force: true });

console.log(`core: three.module.js`);
console.log(`addons (${seen.size}):`);
for (const rel of [...seen].sort()) console.log('  ' + rel);
console.log('Done. Verify the game still loads, then commit vendor/.');
