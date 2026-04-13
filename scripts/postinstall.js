const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const addonDist = path.join(__dirname, '..', 'node_modules', '@kutalia', 'whisper-node-addon', 'dist');

if (!fs.existsSync(addonDist)) {
  console.log('whisper-node-addon not installed, skipping postinstall.');
  process.exit(0);
}

// Create symlinks for darwin naming convention
const links = { 'darwin-arm64': 'mac-arm64', 'darwin-x64': 'mac-x64' };
for (const [link, target] of Object.entries(links)) {
  const linkPath = path.join(addonDist, link);
  const targetPath = path.join(addonDist, target);
  if (fs.existsSync(targetPath) && !fs.existsSync(linkPath)) {
    try {
      fs.symlinkSync(target, linkPath, 'dir');
      console.log(`Symlink: ${link} -> ${target}`);
    } catch (err) {
      console.warn(`Symlink failed for ${link}:`, err.message);
    }
  }
}

// Fix rpaths on macOS so dylibs resolve relative to the .node binary
if (process.platform === 'darwin') {
  const arch = process.arch;
  const binDir = path.join(addonDist, `mac-${arch}`);
  if (!fs.existsSync(binDir)) {
    console.log(`No binaries for mac-${arch}, skipping rpath fix.`);
    process.exit(0);
  }

  const ciRpath = '/Users/runner/work/whisper-node-addon/whisper-node-addon/deps/whisper.cpp/build/Release';
  const files = fs.readdirSync(binDir).filter(f => f.endsWith('.node') || f.endsWith('.dylib'));

  for (const file of files) {
    const filePath = path.join(binDir, file);
    try {
      const otool = execSync(`otool -l "${filePath}" 2>/dev/null`, { encoding: 'utf-8' });
      if (otool.includes(ciRpath)) {
        execSync(`install_name_tool -delete_rpath "${ciRpath}" "${filePath}" 2>/dev/null`);
        execSync(`install_name_tool -add_rpath "@loader_path" "${filePath}" 2>/dev/null`);
        console.log(`Fixed rpath: ${file}`);
      }
    } catch {
      // File may already be fixed or not a Mach-O binary
    }
  }

  console.log('rpath fix complete.');
}

// Rebuild better-sqlite3 for Electron's Node.js version
try {
  console.log('Rebuilding better-sqlite3 for Electron...');
  execSync('npx electron-rebuild -f -w better-sqlite3', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  console.log('better-sqlite3 rebuild complete.');
} catch (err) {
  console.warn('better-sqlite3 rebuild failed:', err.message);
}
