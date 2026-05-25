'use strict';

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

let binaryPath = null;

function getBinaryPath() {
  if (binaryPath) return binaryPath;

  const { app } = require('electron');

  // In production: binary is in app.asar.unpacked/native/mic-mode/
  if (app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'native', 'mic-mode', 'mic-mode');
    if (fs.existsSync(unpacked)) {
      binaryPath = unpacked;
      return binaryPath;
    }
  }

  // In development: binary is at project root
  binaryPath = path.join(__dirname, '..', '..', 'native', 'mic-mode', 'mic-mode');
  return binaryPath;
}

function run(command) {
  return new Promise((resolve, reject) => {
    const bin = getBinaryPath();
    if (!fs.existsSync(bin)) {
      resolve({ supported: false, error: 'mic-mode binary not found' });
      return;
    }

    execFile(bin, [command], { timeout: 3000 }, (err, stdout) => {
      if (err) {
        resolve({ supported: false, error: err.message });
        return;
      }
      const output = (stdout || '').trim();
      if (output === 'unsupported') {
        resolve({ supported: false, error: 'macOS 14.0+ required' });
        return;
      }
      resolve({ supported: true, output });
    });
  });
}

/**
 * Get the current microphone mode.
 * Returns { supported, active, preferred } or { supported: false, error }.
 */
async function getStatus() {
  const result = await run('status');
  if (!result.supported) return result;

  // Parse "active:voice-isolation preferred:standard"
  const parts = result.output.split(' ');
  const active = parts[0]?.split(':')[1] || 'unknown';
  const preferred = parts[1]?.split(':')[1] || 'unknown';

  return { supported: true, active, preferred };
}

/**
 * Open the macOS system microphone mode picker (Control Center panel).
 */
async function openPicker() {
  return run('picker');
}

/**
 * Check if Voice Isolation is currently active.
 */
async function isVoiceIsolationActive() {
  const status = await getStatus();
  return status.supported && status.active === 'voice-isolation';
}

module.exports = { getStatus, openPicker, isVoiceIsolationActive };
