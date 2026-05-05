/**
 * ZeroClaw subprocess manager.
 * Spawns the compiled Rust binary, manages lifecycle, health checks, and auto-restart.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

let process_ = null;
let port = null;
let healthCheckInterval = null;
let crashCount = 0;
const MAX_CRASHES = 3;
const HEALTH_CHECK_INTERVAL = 30000; // 30s

/**
 * Find the ZeroClaw binary path.
 * In dev: resources/zeroclaw/zeroclaw
 * In production: unpacked from asar in Resources/zeroclaw/zeroclaw
 */
function getBinaryPath() {
  const { app } = require('electron');
  const isDev = !app.isPackaged;

  if (isDev) {
    // Dev mode: look in project resources
    const devPath = path.join(app.getAppPath(), 'resources', 'zeroclaw', 'zeroclaw');
    if (fs.existsSync(devPath)) return devPath;
    // Fallback: system path
    return 'zeroclaw';
  }

  // Production: extraResources path
  return path.join(process.resourcesPath, 'zeroclaw', 'zeroclaw');
}

/**
 * Find an available port on localhost.
 */
function findAvailablePort() {
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
 * Start the ZeroClaw gateway subprocess.
 * @param {object} [opts]
 * @param {string} [opts.configPath] - Path to ZeroClaw config file
 * @param {function} [opts.onReady] - Called when gateway is accepting connections
 * @param {function} [opts.onExit] - Called when process exits
 * @param {function} [opts.onError] - Called on fatal error
 */
async function start({ configPath, onReady, onExit, onError } = {}) {
  if (process_) {
    onReady?.();
    return;
  }

  const binaryPath = getBinaryPath();

  // Check binary exists
  if (binaryPath !== 'zeroclaw' && !fs.existsSync(binaryPath)) {
    const err = new Error(`ZeroClaw binary not found at: ${binaryPath}`);
    onError?.(err);
    return;
  }

  port = await findAvailablePort();

  const args = ['gateway', '--bind', 'loopback', '--port', String(port)];
  if (configPath) args.push('--config', configPath);

  console.log(`[zeroclaw] Starting: ${binaryPath} ${args.join(' ')}`);

  process_ = spawn(binaryPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  process_.stdout.on('data', (data) => {
    const line = data.toString().trim();
    if (line) console.log(`[zeroclaw] ${line}`);
    // Detect when gateway is ready
    if (line.includes('listening') || line.includes('started') || line.includes('ready')) {
      onReady?.();
    }
  });

  process_.stderr.on('data', (data) => {
    console.error(`[zeroclaw:err] ${data.toString().trim()}`);
  });

  process_.on('exit', (code, signal) => {
    console.warn(`[zeroclaw] Exited with code=${code} signal=${signal}`);
    process_ = null;
    stopHealthCheck();

    if (code !== 0 && code !== null) {
      crashCount++;
      if (crashCount >= MAX_CRASHES) {
        console.error(`[zeroclaw] Crashed ${crashCount} times, giving up. Using fallback agent.`);
        onError?.(new Error(`ZeroClaw crashed ${crashCount} times`));
        return;
      }
      // Auto-restart after brief delay
      console.log(`[zeroclaw] Restarting (attempt ${crashCount}/${MAX_CRASHES})...`);
      setTimeout(() => start({ configPath, onReady, onExit, onError }), 1000 * crashCount);
    } else {
      onExit?.();
    }
  });

  process_.on('error', (err) => {
    console.error(`[zeroclaw] Spawn error:`, err.message);
    process_ = null;
    onError?.(err);
  });

  // Wait for ready with timeout
  await waitForReady(5000).catch((err) => {
    console.warn(`[zeroclaw] Ready timeout, proceeding anyway:`, err.message);
  });

  startHealthCheck();
}

/**
 * Wait for the gateway to be accepting connections.
 */
function waitForReady(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (!port) { reject(new Error('No port')); return; }
      const req = require('http').get(`http://127.0.0.1:${port}/health`, (res) => {
        if (res.statusCode === 200) { resolve(); return; }
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, retry);
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) { reject(new Error('Timeout')); return; }
      setTimeout(check, 200);
    };
    check();
  });
}

/**
 * Periodic health check.
 */
function startHealthCheck() {
  stopHealthCheck();
  healthCheckInterval = setInterval(async () => {
    if (!process_ || !port) return;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) console.warn(`[zeroclaw] Health check failed: ${res.status}`);
    } catch {
      console.warn('[zeroclaw] Health check failed — process may be unresponsive');
    }
  }, HEALTH_CHECK_INTERVAL);
}

function stopHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

/**
 * Stop the ZeroClaw subprocess.
 */
function stop() {
  stopHealthCheck();
  if (process_) {
    console.log('[zeroclaw] Stopping...');
    process_.kill('SIGTERM');
    // Force kill after 3s if still running
    const p = process_;
    setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 3000);
    process_ = null;
  }
  port = null;
  crashCount = 0;
}

/**
 * Get the current gateway port (null if not running).
 */
function getPort() {
  return port;
}

/**
 * Check if ZeroClaw is currently running.
 */
function isRunning() {
  return process_ !== null;
}

/**
 * Get the base URL for API calls.
 */
function getBaseUrl() {
  if (!port) return null;
  return `http://127.0.0.1:${port}`;
}

/**
 * Reset crash counter (e.g., after successful use).
 */
function resetCrashCount() {
  crashCount = 0;
}

module.exports = { start, stop, getPort, isRunning, getBaseUrl, resetCrashCount, getBinaryPath };
