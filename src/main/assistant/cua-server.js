/**
 * CUA Computer Server — manages the bundled PyInstaller binary.
 * Provides desktop control: screenshots, clicks, keyboard, window management.
 * Communicates via HTTP on localhost (no ws dependency needed).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

let process_ = null;
let port = null;

function getBinaryPath() {
  const { app } = require('electron');
  if (!app.isPackaged) {
    const devPath = path.join(app.getAppPath(), 'resources', 'cua-server', 'cua-server');
    if (fs.existsSync(devPath)) return devPath;
    return null;
  }
  return path.join(process.resourcesPath, 'cua-server', 'cua-server');
}

function findPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const p = server.address().port;
      server.close(() => resolve(p));
    });
    server.on('error', reject);
  });
}

/**
 * Start the CUA server (lazy — called on first computer-use action).
 */
async function start() {
  if (process_ && port) return port;

  const binaryPath = getBinaryPath();
  if (!binaryPath) {
    console.warn('[cua] Binary not found');
    return null;
  }

  port = await findPort();
  console.log(`[cua] Starting on port ${port}`);

  process_ = spawn(binaryPath, ['--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  process_.stdout.on('data', (d) => {
    const line = d.toString().trim();
    if (line) console.log(`[cua] ${line}`);
  });
  process_.stderr.on('data', (d) => console.error(`[cua:err] ${d.toString().trim()}`));
  process_.on('exit', (code) => { console.log(`[cua] Exited ${code}`); process_ = null; });
  process_.on('error', (e) => { console.error(`[cua] Error: ${e.message}`); process_ = null; });

  // Wait for server to be ready (CUA takes ~3-4s to start)
  await waitForReady(10000);
  return port;
}

function waitForReady(timeoutMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const check = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) { resolve(); return; }
      } catch {}
      if (Date.now() - t0 > timeoutMs) { reject(new Error('CUA startup timeout')); return; }
      setTimeout(check, 500);
    };
    check();
  });
}

function stop() {
  if (process_) { process_.kill('SIGTERM'); process_ = null; }
  port = null;
}

/**
 * Send a command to CUA server.
 */
async function sendCommand(action, params = {}) {
  if (!port) {
    const p = await start();
    if (!p) return { error: 'CUA not available' };
  }

  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
    signal: AbortSignal.timeout(15000),
  });

  return res.json();
}

// High-level actions
const screenshot = () => sendCommand('screenshot');
const click = (x, y, button) => sendCommand('click', { x, y, button });
const typeText = (text) => sendCommand('type', { text });
const pressKey = (keys) => sendCommand('keypress', { keys });
const scroll = (x, y, direction, amount) => sendCommand('scroll', { x, y, direction, amount });
const getScreenSize = () => sendCommand('get_screen_size');
const getAccessibilityTree = () => sendCommand('get_accessibility_tree');
const getFrontmostApp = () => sendCommand('get_frontmost_app');
const launchApp = (name) => sendCommand('launch_app', { name });
const getWindowList = () => sendCommand('get_window_list');

module.exports = {
  start, stop, sendCommand, getBinaryPath,
  screenshot, click, typeText, pressKey, scroll,
  getScreenSize, getAccessibilityTree, getFrontmostApp, launchApp, getWindowList,
};
