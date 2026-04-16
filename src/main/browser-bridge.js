/**
 * browser-bridge.js
 *
 * Spawns a local @playwright/mcp server as a child process (stdio transport)
 * and exposes browser tools to the agent's skill system.
 *
 * Architecture:
 *   agent-worker  →  skill-loader  →  browser-bridge  →  @playwright/mcp  →  Chromium
 *
 * The MCP server is lazily started on the first browser tool call and kept
 * alive for the session. JSON-RPC 2.0 messages are sent over stdin/stdout.
 *
 * Prerequisites:
 *   @playwright/mcp must be installed (npm install @playwright/mcp)
 *   Playwright Chromium must be downloaded (npx playwright install chromium)
 */

const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

const REQUEST_TIMEOUT_MS = 30000;

class BrowserBridge extends EventEmitter {
  constructor() {
    super();
    this._proc = null;
    this._ready = false;
    this._startPromise = null;
    this._requestId = 0;
    this._pending = new Map(); // id → { resolve, reject, timer }
    this._buffer = '';
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async start() {
    if (this._startPromise) return this._startPromise;

    this._startPromise = new Promise((resolve, reject) => {
      const mcpBin = this._findMcpBin();
      if (!mcpBin) {
        this._startPromise = null;
        return reject(new Error(
          '@playwright/mcp is not installed. Run: npm install @playwright/mcp'
        ));
      }

      console.log('[browser-bridge] Starting @playwright/mcp server…');

      this._proc = spawn(process.execPath, [mcpBin, '--headless'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: this._getBrowsersPath() },
      });

      this._proc.stdout.setEncoding('utf8');
      this._proc.stdout.on('data', (chunk) => this._onData(chunk));

      this._proc.stderr.on('data', (d) => {
        const msg = d.toString().trim();
        if (msg) console.log('[browser-bridge stderr]', msg);
      });

      this._proc.on('exit', (code) => {
        console.warn('[browser-bridge] MCP server exited, code', code);
        this._proc = null;
        this._ready = false;
        this._startPromise = null;
        for (const [, p] of this._pending) {
          clearTimeout(p.timer);
          p.reject(new Error('Browser bridge server exited'));
        }
        this._pending.clear();
      });

      this._proc.on('error', (err) => {
        console.error('[browser-bridge] Process error:', err.message);
        this._startPromise = null;
        reject(err);
      });

      // Send MCP initialize handshake
      const initTimeout = setTimeout(() => {
        reject(new Error('Browser bridge init timed out'));
      }, 15000);

      this._sendRaw({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'tellaflow-agent', version: '1.0.0' },
        },
      });

      this.once('_initialized', () => {
        clearTimeout(initTimeout);
        this._ready = true;
        console.log('[browser-bridge] Ready.');
        resolve();
      });

      this.once('_init-error', (err) => {
        clearTimeout(initTimeout);
        this._startPromise = null;
        reject(err);
      });
    });

    return this._startPromise;
  }

  stop() {
    if (this._proc) {
      try { this._proc.kill(); } catch {}
      this._proc = null;
    }
    this._ready = false;
    this._startPromise = null;
  }

  get isReady() { return this._ready; }

  // ── Tool execution ──────────────────────────────────────────────────────────

  async callTool(name, args = {}) {
    await this.start();

    const id = ++this._requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Browser tool "${name}" timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this._pending.set(id, { resolve, reject, timer });

      this._sendRaw({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name, arguments: args },
      });
    });
  }

  async listTools() {
    await this.start();

    const id = ++this._requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error('listTools timed out'));
      }, REQUEST_TIMEOUT_MS);

      this._pending.set(id, { resolve, reject, timer });

      this._sendRaw({
        jsonrpc: '2.0',
        id,
        method: 'tools/list',
        params: {},
      });
    });
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  _findMcpBin() {
    try {
      // Resolve relative to the project root so it works both in dev and packaged
      const root = path.join(__dirname, '..', '..', 'node_modules');
      const candidate = path.join(root, '@playwright', 'mcp', 'cli.js');
      const fs = require('fs');
      if (fs.existsSync(candidate)) return candidate;
      // Fallback: let Node resolve it
      return require.resolve('@playwright/mcp/cli');
    } catch {
      return null;
    }
  }

  _getBrowsersPath() {
    try {
      const { app } = require('electron');
      return path.join(app.getPath('userData'), 'playwright-browsers');
    } catch {
      return undefined;
    }
  }

  _sendRaw(obj) {
    if (!this._proc || !this._proc.stdin.writable) return;
    try {
      this._proc.stdin.write(JSON.stringify(obj) + '\n');
    } catch (err) {
      console.error('[browser-bridge] Write error:', err.message);
    }
  }

  _onData(chunk) {
    this._buffer += chunk;
    const lines = this._buffer.split('\n');
    this._buffer = lines.pop(); // last partial line stays in buffer
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        this._handleMessage(msg);
      } catch {
        // non-JSON output from the process — ignore
      }
    }
  }

  _handleMessage(msg) {
    // Initialization response (id === 0)
    if (msg.id === 0) {
      if (msg.error) {
        this.emit('_init-error', new Error(msg.error.message || 'Init failed'));
      } else {
        // Send 'initialized' notification required by MCP protocol
        this._sendRaw({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
        this.emit('_initialized');
      }
      return;
    }

    // Regular RPC response
    const pending = this._pending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this._pending.delete(msg.id);

    if (msg.error) {
      pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    } else {
      pending.resolve(msg.result);
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

const bridge = new BrowserBridge();

/**
 * Build skill definitions for browser tools, pulled dynamically from the
 * running MCP server. Falls back to a static list if the server isn't up.
 */
async function getBrowserSkills() {
  try {
    await bridge.start();
    const result = await bridge.listTools();
    const tools = result?.tools || [];
    return tools.map(t => ({
      name: `browser_${t.name}`,
      description: `[Browser] ${t.description || t.name}`,
      parameters: t.inputSchema?.properties
        ? Object.fromEntries(
            Object.entries(t.inputSchema.properties).map(([k, v]) => [k, { type: v.type || 'string' }])
          )
        : {},
      async execute(args) {
        const res = await bridge.callTool(t.name, args);
        // MCP returns content array; flatten to string
        if (Array.isArray(res?.content)) {
          return res.content
            .map(c => (c.type === 'text' ? c.text : JSON.stringify(c)))
            .join('\n');
        }
        return JSON.stringify(res);
      },
    }));
  } catch (err) {
    console.warn('[browser-bridge] Could not load browser tools:', err.message);
    return [];
  }
}

function stopBridge() {
  bridge.stop();
}

module.exports = { bridge, getBrowserSkills, stopBridge };
