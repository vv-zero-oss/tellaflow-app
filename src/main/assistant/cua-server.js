/**
 * CUA Computer Server — sidecar process manager.
 * Manages the PyInstaller-compiled CUA binary that provides desktop control.
 * Communicates via WebSocket on localhost.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

// Lazy-require ws to avoid crash if not installed (CUA is Phase 3, optional)
let WebSocket;
function getWS() {
  if (!WebSocket) {
    try { WebSocket = require('ws'); } catch {
      // ws not available — use Node's built-in (Electron 35+ has it)
      // Fallback: CUA tools will be unavailable
      console.warn('[cua] ws module not available — CUA tools disabled');
      return null;
    }
  }
  return WebSocket;
}

let process_ = null;
let port = null;
let ws = null;
let reconnectTimer = null;

/**
 * Find the CUA server binary path.
 */
function getBinaryPath() {
  const { app } = require('electron');
  const isDev = !app.isPackaged;

  if (isDev) {
    const devPath = path.join(app.getAppPath(), 'resources', 'cua-server', 'cua-server');
    if (fs.existsSync(devPath)) return devPath;
    return null; // CUA not available in dev without building
  }

  return path.join(process.resourcesPath, 'cua-server', 'cua-server');
}

/**
 * Find an available port.
 */
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
 * Start the CUA server (lazy — only called when computer-use tool is first invoked).
 */
async function start() {
  if (process_) return port;

  const binaryPath = getBinaryPath();
  if (!binaryPath || !fs.existsSync(binaryPath)) {
    console.warn('[cua] Binary not found — computer-use tools disabled');
    return null;
  }

  port = await findPort();

  console.log(`[cua] Starting server on port ${port}`);

  process_ = spawn(binaryPath, ['--port', String(port), '--host', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  process_.stdout.on('data', (d) => console.log(`[cua] ${d.toString().trim()}`));
  process_.stderr.on('data', (d) => console.error(`[cua:err] ${d.toString().trim()}`));

  process_.on('exit', (code) => {
    console.warn(`[cua] Exited with code ${code}`);
    process_ = null;
    ws = null;
  });

  process_.on('error', (err) => {
    console.error(`[cua] Spawn error:`, err.message);
    process_ = null;
  });

  // Wait for server to be ready
  await waitForReady();
  await connect();

  return port;
}

/**
 * Wait for the CUA server to accept connections.
 */
function waitForReady(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (!port) { reject(new Error('No port')); return; }
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.on('connect', () => { socket.destroy(); resolve(); });
      socket.on('error', () => { socket.destroy(); retry(); });
      socket.on('timeout', () => { socket.destroy(); retry(); });
      socket.connect(port, '127.0.0.1');
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) { reject(new Error('CUA server timeout')); return; }
      setTimeout(check, 300);
    };
    check();
  });
}

/**
 * Connect WebSocket to CUA server.
 */
async function connect() {
  if (ws) return;
  if (!port) return;
  const WS = getWS();
  if (!WS) return;

  ws = new WS(`ws://127.0.0.1:${port}`);

  ws.on('open', () => console.log('[cua] WebSocket connected'));
  ws.on('close', () => { ws = null; });
  ws.on('error', (err) => { console.error('[cua] WS error:', err.message); ws = null; });
}

/**
 * Send a command to CUA and get the result.
 * @param {string} action - Action type (click, type, screenshot, etc.)
 * @param {object} params - Action parameters
 * @returns {Promise<object>} Result from CUA
 */
async function sendCommand(action, params = {}) {
  // Auto-start if not running
  if (!process_) {
    const p = await start();
    if (!p) return { error: 'CUA server not available' };
  }

  const WS = getWS();
  if (!ws || ws.readyState !== (WS?.OPEN ?? 1)) {
    await connect();
    if (!ws) return { error: 'CUA WebSocket not connected' };
  }

  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const timeout = setTimeout(() => resolve({ error: 'CUA command timeout' }), 10000);

    const handler = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.removeListener('message', handler);
          resolve(msg.result || msg);
        }
      } catch {}
    };

    ws.on('message', handler);
    ws.send(JSON.stringify({ id, action, ...params }));
  });
}

/**
 * Stop the CUA server.
 */
function stop() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { try { ws.close(); } catch {} ws = null; }
  if (process_) {
    process_.kill('SIGTERM');
    setTimeout(() => { try { process_?.kill('SIGKILL'); } catch {} }, 3000);
    process_ = null;
  }
  port = null;
}

/**
 * Check if CUA is running.
 */
function isRunning() {
  return process_ !== null;
}

// ─── High-level actions (exposed as tools to ZeroClaw/agent) ────────────────────

async function screenshot() {
  return sendCommand('screenshot');
}

async function click(x, y, button = 'left') {
  return sendCommand('click', { x, y, button });
}

async function typeText(text) {
  return sendCommand('type', { text });
}

async function pressKey(keys) {
  return sendCommand('keypress', { keys });
}

async function scroll(x, y, direction = 'down', amount = 3) {
  return sendCommand('scroll', { x, y, direction, amount });
}

async function getScreenSize() {
  return sendCommand('get_screen_size');
}

async function getAccessibilityTree() {
  return sendCommand('get_accessibility_tree');
}

module.exports = {
  start, stop, isRunning, sendCommand, getBinaryPath,
  screenshot, click, typeText, pressKey, scroll, getScreenSize, getAccessibilityTree,
};
