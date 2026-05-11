#!/usr/bin/env node
// Generates resources/icon.icns and build/icon.icns from resources/icon.png.
// Run via `node scripts/generate-icns.js` whenever the source PNG changes.
// macOS-only: relies on `sips` and `iconutil` which ship with the OS.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'resources', 'icon.png');
const OUT_RESOURCES = path.join(ROOT, 'resources', 'icon.icns');
const OUT_BUILD = path.join(ROOT, 'build', 'icon.icns');

if (process.platform !== 'darwin') {
  console.warn('[generate-icns] Skipping: macOS-only (sips/iconutil).');
  process.exit(0);
}

if (!fs.existsSync(SRC)) {
  console.error('[generate-icns] Missing source PNG:', SRC);
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tellaflow-icon-'));
const iconset = path.join(tmpDir, 'icon.iconset');
fs.mkdirSync(iconset);

const sizes = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
];

for (const [size, name] of sizes) {
  execFileSync('sips', [
    '-z', String(size), String(size),
    SRC,
    '--out', path.join(iconset, name),
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
}

execFileSync('iconutil', ['-c', 'icns', iconset, '-o', OUT_RESOURCES], { stdio: 'inherit' });
fs.copyFileSync(OUT_RESOURCES, OUT_BUILD);
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('[generate-icns] Wrote', OUT_RESOURCES);
console.log('[generate-icns] Wrote', OUT_BUILD);
