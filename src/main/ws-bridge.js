/**
 * ws-bridge.js — WebSocket server for the Chrome extension bridge
 *
 * Listens on ws://localhost:9009
 * The Tellaflow Chrome extension connects here and waits for commands.
 * Commands are JSON: { id, action, params }
 * Responses:         { id, result } or { id, error }
 *
 * Used by the browser_ext_* tools in the skill system.
 */

const { WebSocketServer } = require('ws');

const WS_PORT = 9009;
const REQUEST_TIMEOUT_MS = 20000;

let wss = null;
let extSocket = null; // connected extension socket
let requestId = 0;
const pending = new Map(); // id → { resolve, reject, timer }

// ── Lifecycle ────────────────────────────────────────────────────────────────

function startServer() {
  if (wss) return;

  wss = new WebSocketServer({ port: WS_PORT });
  console.log(`[ws-bridge] Listening on ws://localhost:${WS_PORT}`);

  wss.on('connection', (socket, req) => {
    const addr = req.socket.remoteAddress;
    console.log(`[ws-bridge] Client connected from ${addr}`);

    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'hello') {
        // Extension announcing itself
        extSocket = socket;
        console.log('[ws-bridge] Chrome extension registered:', msg.agent);
        return;
      }

      if (msg.type === 'get_status') {
        socket.send(JSON.stringify({ connected: extSocket === socket }));
        return;
      }

      // Response to a pending request
      if (msg.id !== undefined) {
        const p = pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(msg.error));
          } else {
            p.resolve(msg.result);
          }
        }
      }
    });

    socket.on('close', () => {
      if (socket === extSocket) {
        extSocket = null;
        console.log('[ws-bridge] Chrome extension disconnected');
      }
    });

    socket.on('error', () => {
      if (socket === extSocket) extSocket = null;
    });
  });

  wss.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[ws-bridge] Port ${WS_PORT} already in use — bridge disabled`);
    } else {
      console.error('[ws-bridge] Server error:', err.message);
    }
  });
}

function stopServer() {
  if (wss) {
    wss.close();
    wss = null;
  }
  extSocket = null;
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error('ws-bridge server stopped'));
  }
  pending.clear();
}

// ── Command execution ────────────────────────────────────────────────────────

/**
 * Send a command to the Chrome extension and await the result.
 * @param {string} action
 * @param {object} params
 * @returns {Promise<string>}
 */
async function sendToExtension(action, params = {}) {
  if (!extSocket || extSocket.readyState !== 1 /* OPEN */) {
    throw new Error(
      'Chrome extension is not connected. Install and enable the Tellaflow extension, then reload Chrome.'
    );
  }

  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Extension action "${action}" timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });
    extSocket.send(JSON.stringify({ id, action, params }));
  });
}

function isExtensionConnected() {
  return extSocket !== null && extSocket.readyState === 1;
}

module.exports = { startServer, stopServer, sendToExtension, isExtensionConnected };
