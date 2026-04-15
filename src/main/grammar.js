const path = require('path');
const fs = require('fs');
const https = require('https');
const { fork } = require('child_process');

// ─── Registry ──────────────────────────────────────────────────────────────────

const GRAMMAR_REGISTRY = {
  'qwen2.5-0.5b': {
    name: 'Qwen2.5 0.5B',
    filename: 'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf',
    size: '413 MB',
    bytes: 413_000_000,
    quality: 'Good',
    context: '32K',
    description: 'Better quality with 32K context. Handles longer transcriptions.',
    url: 'https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf',
  },
  'qwen3-0.6b': {
    name: 'Qwen3 0.6B',
    filename: 'Qwen_Qwen3-0.6B-Q4_K_M.gguf',
    size: '480 MB',
    bytes: 480_000_000,
    quality: 'Best',
    context: '32K',
    description: 'Latest generation, best accuracy. Recommended.',
    url: 'https://huggingface.co/bartowski/Qwen_Qwen3-0.6B-GGUF/resolve/main/Qwen_Qwen3-0.6B-Q4_K_M.gguf',
  },
  'gemma-3-1b': {
    name: 'Gemma 3 1B',
    filename: 'google_gemma-3-1b-it-Q4_K_M.gguf',
    size: '806 MB',
    bytes: 806_000_000,
    quality: 'Good',
    context: '32K',
    description: 'Google\'s Gemma 3 1B. Fast and efficient for on-device corrections.',
    url: 'https://huggingface.co/bartowski/google_gemma-3-1b-it-GGUF/resolve/main/google_gemma-3-1b-it-Q4_K_M.gguf',
  },
  'gemma-3-4b': {
    name: 'Gemma 3 4B',
    filename: 'google_gemma-3-4b-it-qat-Q4_K_M.gguf',
    size: '2.49 GB',
    bytes: 2_490_000_000,
    quality: 'Best',
    context: '128K',
    description: 'Google\'s Gemma 3 4B with QAT. Outperforms Gemma 2-27B. 128K context.',
    url: 'https://huggingface.co/bartowski/google_gemma-3-4b-it-qat-GGUF/resolve/main/google_gemma-3-4b-it-qat-Q4_K_M.gguf',
  },
};

// ─── Paths ─────────────────────────────────────────────────────────────────────

function getGrammarModelsDir() {
  const { app } = require('electron');
  const dir = path.join(app.getPath('userData'), 'models');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getModelFilePath(modelKey) {
  const info = GRAMMAR_REGISTRY[modelKey];
  if (!info) return null;
  return path.join(getGrammarModelsDir(), info.filename);
}

function isGrammarModelAvailable(modelKey) {
  const p = getModelFilePath(modelKey);
  if (!p) return false;
  try { return fs.existsSync(p); } catch { return false; }
}

// ─── Download tracking ─────────────────────────────────────────────────────────

const activeDownloads = {};
const pausedModels = new Set();

function getPartialSize(modelKey) {
  const p = getModelFilePath(modelKey);
  if (!p) return 0;
  try { return fs.statSync(p + '.tmp').size; } catch { return 0; }
}

// ─── Status ────────────────────────────────────────────────────────────────────

function getGrammarModelsStatus() {
  const result = {};
  for (const [key, info] of Object.entries(GRAMMAR_REGISTRY)) {
    const available = isGrammarModelAvailable(key);
    const dl = activeDownloads[key];
    let status = available ? 'downloaded' : 'not_downloaded';
    let downloaded = 0;
    const total = info.bytes;

    if (dl) {
      status = 'downloading';
      downloaded = dl.downloaded;
    } else if (!available) {
      const partial = getPartialSize(key);
      if (partial > 0) {
        status = 'paused';
        downloaded = partial;
      }
    }

    result[key] = { ...info, available, status, downloaded, total };
  }
  return result;
}

// ─── Download ──────────────────────────────────────────────────────────────────

function startGrammarDownload(modelKey, { onProgress, onComplete, onError }) {
  const info = GRAMMAR_REGISTRY[modelKey];
  if (!info) { onError?.(new Error(`Unknown grammar model: ${modelKey}`)); return; }

  const destPath = getModelFilePath(modelKey);
  const tmpPath = destPath + '.tmp';

  if (fs.existsSync(destPath)) { onComplete?.(destPath); return; }
  if (activeDownloads[modelKey]) { onError?.(new Error(`Already downloading ${modelKey}`)); return; }

  pausedModels.delete(modelKey);

  let startByte = 0;
  try { startByte = fs.statSync(tmpPath).size; } catch {}

  const MAX_REDIRECTS = 10;
  function doRequest(url, resumeFrom, redirectCount = 0) {
    if (redirectCount > MAX_REDIRECTS) {
      delete activeDownloads[modelKey];
      onError?.(new Error(`Too many redirects (>${MAX_REDIRECTS})`));
      return;
    }
    const headers = {};
    if (resumeFrom > 0) headers['Range'] = `bytes=${resumeFrom}-`;

    const proto = url.startsWith('https') ? https : require('http');
    const req = proto.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        doRequest(res.headers.location, resumeFrom, redirectCount + 1);
        return;
      }
      if (res.statusCode === 416) {
        try { fs.unlinkSync(tmpPath); } catch {}
        doRequest(url, 0, redirectCount + 1);
        return;
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        delete activeDownloads[modelKey];
        onError?.(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }

      let totalBytes;
      if (res.statusCode === 206) {
        const range = res.headers['content-range'];
        totalBytes = range
          ? parseInt(range.match(/\/(\d+)$/)?.[1] ?? info.bytes, 10)
          : resumeFrom + parseInt(res.headers['content-length'] || '0', 10);
      } else {
        totalBytes = parseInt(res.headers['content-length'], 10) || info.bytes;
        resumeFrom = 0;
      }

      let downloadedBytes = res.statusCode === 206 ? resumeFrom : 0;
      const flags = res.statusCode === 206 ? 'a' : 'w';
      const ws = fs.createWriteStream(tmpPath, { flags });

      activeDownloads[modelKey] = { request: req, response: res, writeStream: ws, downloaded: downloadedBytes };

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (activeDownloads[modelKey]) activeDownloads[modelKey].downloaded = downloadedBytes;
        onProgress?.({ modelKey, downloaded: downloadedBytes, total: totalBytes, percent: Math.round((downloadedBytes / totalBytes) * 100) });
      });

      res.pipe(ws);

      ws.on('finish', () => {
        if (pausedModels.has(modelKey)) return;
        delete activeDownloads[modelKey];
        try {
          fs.renameSync(tmpPath, destPath);
          onComplete?.(destPath);
        } catch (err) { onError?.(err); }
      });

      ws.on('error', (err) => { delete activeDownloads[modelKey]; try { fs.unlinkSync(tmpPath); } catch {} onError?.(err); });
      res.on('error', (err) => { delete activeDownloads[modelKey]; onError?.(err); });
    });

    req.on('error', (err) => { delete activeDownloads[modelKey]; onError?.(err); });
  }

  doRequest(info.url, startByte);
}

function pauseGrammarDownload(modelKey) {
  const dl = activeDownloads[modelKey];
  if (!dl) return false;
  pausedModels.add(modelKey);
  try { dl.response.unpipe(dl.writeStream); } catch {}
  try { dl.response.destroy(); } catch {}
  try { dl.request.destroy(); } catch {}
  try { dl.writeStream.end(); } catch {}
  delete activeDownloads[modelKey];
  return true;
}

function cancelGrammarDownload(modelKey) {
  const dl = activeDownloads[modelKey];
  if (dl) {
    pausedModels.add(modelKey);
    try { dl.response.unpipe(dl.writeStream); } catch {}
    try { dl.response.destroy(); } catch {}
    try { dl.request.destroy(); } catch {}
    try { dl.writeStream.end(); } catch {}
    delete activeDownloads[modelKey];
  }
  pausedModels.delete(modelKey);
  const p = getModelFilePath(modelKey);
  if (p) try { fs.unlinkSync(p + '.tmp'); } catch {}
}

function deleteGrammarModel(modelKey) {
  cancelGrammarDownload(modelKey);
  const p = getModelFilePath(modelKey);
  if (p) try { fs.unlinkSync(p); } catch {}
}

// ─── Active model ──────────────────────────────────────────────────────────────

function getActiveModelKey() {
  const config = require('./config');
  const stored = config.getGrammarModel();
  if (stored && GRAMMAR_REGISTRY[stored] && isGrammarModelAvailable(stored)) return stored;
  // Fall back to first available
  for (const key of Object.keys(GRAMMAR_REGISTRY)) {
    if (isGrammarModelAvailable(key)) return key;
  }
  return null;
}

function getActiveModelPath() {
  const key = getActiveModelKey();
  return key ? getModelFilePath(key) : null;
}

function isModelAvailable() {
  return getActiveModelPath() !== null;
}

// ─── Worker ────────────────────────────────────────────────────────────────────

let worker = null;
let initPromise = null;
let workerReady = false;
let requestId = 0;
const pending = new Map();

function getWorkerPath() {
  const { app } = require('electron');
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'main', 'grammar-worker.js');
  }
  return path.join(__dirname, 'grammar-worker.js');
}

function ensureWorker() {
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    const modelPath = getActiveModelPath();
    if (!modelPath || !fs.existsSync(modelPath)) {
      initPromise = null;
      return reject(new Error(`No grammar model available`));
    }

    worker = fork(getWorkerPath(), [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });

    worker.stdout.on('data', (d) => process.stdout.write(d));
    worker.stderr.on('data', (d) => process.stderr.write(d));

    worker.on('message', (msg) => {
      if (msg.type === 'init-done') {
        workerReady = true;
        console.log(`Grammar worker ready (${getActiveModelKey()})`);
        resolve();
      } else if (msg.type === 'result') {
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); p.resolve(msg.text); }
      } else if (msg.type === 'error') {
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); p.reject(new Error(msg.error)); }
        if (!worker) { initPromise = null; reject(new Error(msg.error)); }
      }
    });

    worker.on('exit', (code) => {
      console.warn('Grammar worker exited with code', code);
      worker = null;
      initPromise = null;
      workerReady = false;
      for (const [, p] of pending) p.reject(new Error('Grammar worker exited'));
      pending.clear();
    });

    worker.send({ type: 'init', modelPath });
  });

  return initPromise;
}

async function correctGrammar(text, tone = 'casual') {
  if (!text || text.trim().length === 0) return text;
  // If the worker is still initialising (background warmup in progress), skip
  // correction for this transcription rather than blocking the pipeline. The
  // worker will be ready for every subsequent call once it has fully loaded.
  if (initPromise && !workerReady) return text;
  await ensureWorker();
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.send({ type: 'correct', id, text, tone });
  });
}

async function dispose() {
  if (worker) { worker.kill(); worker = null; }
  initPromise = null;
  workerReady = false;
  pending.clear();
}

// Restart the worker with the newly-selected model
async function restartWorker() {
  await dispose();
}

async function warmup() {
  if (!isModelAvailable()) return;
  try { await ensureWorker(); } catch (err) { console.warn('Grammar warmup failed:', err.message); }
}

module.exports = {
  GRAMMAR_REGISTRY,
  correctGrammar,
  isModelAvailable,
  isGrammarModelAvailable,
  getGrammarModelsStatus,
  getActiveModelKey,
  startGrammarDownload,
  pauseGrammarDownload,
  cancelGrammarDownload,
  deleteGrammarModel,
  dispose,
  restartWorker,
  warmup,
};
