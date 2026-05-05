/**
 * ZeroClaw client — calls the compiled binary directly.
 * Uses `zeroclaw agent -m "message"` in single-shot mode.
 * Falls back to the HTTP fallback-agent if the binary fails.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assistantConfig = require('./config');
const secureStore = require('./secure-store');

let sessionFile = null;

function getBinaryPath() {
  const { app } = require('electron');
  const isDev = !app.isPackaged;
  if (isDev) {
    const devPath = path.join(app.getAppPath(), 'resources', 'zeroclaw', 'zeroclaw');
    if (fs.existsSync(devPath)) return devPath;
    return null;
  }
  return path.join(process.resourcesPath, 'zeroclaw', 'zeroclaw');
}

function getSessionFile() {
  if (!sessionFile) {
    const { app } = require('electron');
    const dir = path.join(app.getPath('userData'), 'assistant');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    sessionFile = path.join(dir, 'session.json');
  }
  return sessionFile;
}

function isAvailable() {
  const p = getBinaryPath();
  return p && fs.existsSync(p);
}

/**
 * Send a message to ZeroClaw and get the response.
 * @param {string} message - User message
 * @param {object} opts
 * @param {function} [opts.onPartial] - Streaming callback (chunks)
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<string>} Full response
 */
function query(message, { onPartial, signal } = {}) {
  const binaryPath = getBinaryPath();

  if (!binaryPath || !fs.existsSync(binaryPath)) {
    // Fall back to HTTP agent
    const fallback = require('./fallback-agent');
    return fallback.query(message, { onPartial, signal });
  }

  return new Promise((resolve, reject) => {
    const provider = assistantConfig.getProvider();
    const model = assistantConfig.getModel();

    // Map grammar model keys to Ollama names for local providers
    let resolvedModel = model;
    if (provider === 'llamacpp' || provider === 'ollama') {
      const MAP = {
        'gemma-3-4b': 'gemma3:latest',
        'gemma-3-1b': 'gemma3:1b',
        'qwen3-0.6b': 'qwen3:0.6b',
        'qwen2.5-0.5b': 'qwen3:0.6b',
        'qwen3-4b': 'qwen3:4b',
      };
      if (resolvedModel && !resolvedModel.includes(':')) {
        resolvedModel = MAP[resolvedModel] || resolvedModel;
      }
    }

    // llamacpp provider routes through ollama in zeroclaw
    const resolvedProvider = provider === 'llamacpp' ? 'ollama' : provider;

    const args = ['agent', '-m', message];
    if (resolvedProvider) args.push('-p', resolvedProvider);
    if (resolvedModel) args.push('--model', resolvedModel);
    args.push('--session-state-file', getSessionFile());

    // Build environment with API keys
    const env = { ...process.env };
    const apiKey = secureStore.getApiKey(provider);
    if (apiKey) {
      // Set provider-specific env var
      const envMap = {
        openai: 'OPENAI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        google: 'GEMINI_API_KEY',
        groq: 'GROQ_API_KEY',
        deepseek: 'DEEPSEEK_API_KEY',
        openrouter: 'OPENROUTER_API_KEY',
        huggingface: 'HUGGINGFACE_API_KEY',
        xai: 'XAI_API_KEY',
        mistral: 'MISTRAL_API_KEY',
      };
      if (envMap[provider]) env[envMap[provider]] = apiKey;
    }

    console.log(`[zeroclaw] Running: zeroclaw ${args.slice(0, 4).join(' ')}...`);

    const proc = spawn(binaryPath, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      // Strip ANSI escape codes for display
      const clean = chunk.replace(/\x1b\[[0-9;]*m/g, '').trim();
      if (clean && onPartial) onPartial(clean);
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        // Clean the output — ZeroClaw may include ANSI codes and log lines
        const clean = stdout
          .replace(/\x1b\[[0-9;]*m/g, '')  // strip ANSI
          .replace(/^\d{4}-\d{2}-\d{2}T.*$/gm, '') // strip log lines
          .trim();
        resolve(clean || 'Done.');
      } else {
        console.error(`[zeroclaw] Exit code ${code}: ${stderr.slice(0, 200)}`);
        // Fall back to HTTP agent on failure
        const fallback = require('./fallback-agent');
        fallback.query(message, { onPartial, signal }).then(resolve).catch(reject);
      }
    });

    proc.on('error', (err) => {
      console.error('[zeroclaw] Spawn error:', err.message);
      const fallback = require('./fallback-agent');
      fallback.query(message, { onPartial, signal }).then(resolve).catch(reject);
    });

    // Handle abort
    if (signal) {
      signal.addEventListener('abort', () => {
        proc.kill('SIGTERM');
        reject(new Error('Aborted'));
      }, { once: true });
    }
  });
}

function clearHistory() {
  const f = getSessionFile();
  try { fs.unlinkSync(f); } catch {}
  sessionFile = null;
}

module.exports = { query, clearHistory, isAvailable, getBinaryPath };
