'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');

function ok(msg) {
  console.log(`PASS: ${msg}`);
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
}

function listFilesRecursive(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        out.push(full);
      }
    }
  }
  return out;
}

function rel(p) {
  return path.relative(repoRoot, p).split(path.sep).join('/');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function checkBuildArtifacts() {
  if (!fs.existsSync(distDir)) {
    fail('dist/ does not exist. Run npm run build:win first.');
    return false;
  }

  const allFiles = listFilesRecursive(distDir);
  const windowsInstallers = allFiles.filter((file) => {
    const lower = file.toLowerCase();
    return lower.endsWith('.exe') && !lower.includes('win-unpacked');
  });

  if (windowsInstallers.length === 0) {
    fail('No Windows installer .exe found in dist/.');
    return false;
  }

  ok(`Found Windows installer artifact(s): ${windowsInstallers.map(rel).join(', ')}`);
  return true;
}

function checkExpectedProjectFiles() {
  const requiredPaths = [
    'docs/windows-installer-smoke-checklist.md',
    'src/main/platform.js',
    'electron-builder.yml',
    'package.json',
  ];

  let allPresent = true;
  for (const rp of requiredPaths) {
    const full = path.join(repoRoot, rp);
    if (!fs.existsSync(full)) {
      fail(`Missing expected file: ${rp}`);
      allPresent = false;
    } else {
      ok(`Expected file present: ${rp}`);
    }
  }
  return allPresent;
}

function checkConfigDefaults() {
  const configPath = path.join(repoRoot, 'src', 'main', 'config.js');
  const configText = fs.readFileSync(configPath, 'utf8');

  const expectations = [
    "{ names: ['LEFT CTRL', 'LEFT ALT'], label: 'Left Control (^) + Left Alt' }",
    "{ names: ['LEFT ALT'], label: 'Left Option (⌥)' }",
  ];

  let allGood = true;
  for (const needle of expectations) {
    if (!configText.includes(needle)) {
      fail(`Config default expectation missing: ${needle}`);
      allGood = false;
    } else {
      ok(`Config default expectation present: ${needle}`);
    }
  }
  return allGood;
}

function checkPackageScripts() {
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  const scripts = pkg.scripts || {};

  const requiredScripts = ['build:win', 'build:win:qa', 'smoke:win'];
  let allPresent = true;

  for (const name of requiredScripts) {
    if (!scripts[name]) {
      fail(`Missing package script: ${name}`);
      allPresent = false;
    } else {
      ok(`Package script present: ${name}`);
    }
  }

  return allPresent;
}

function main() {
  console.log('Running Windows smoke checks...');

  const checks = [
    checkBuildArtifacts(),
    checkExpectedProjectFiles(),
    checkConfigDefaults(),
    checkPackageScripts(),
  ];

  const failed = checks.some((result) => !result);
  if (failed) {
    console.error('\nWindows smoke checks failed.');
    process.exit(1);
  }

  console.log('\nAll Windows smoke checks passed.');
}

main();
