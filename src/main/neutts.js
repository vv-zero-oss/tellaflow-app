const path = require('path');
const fs = require('fs');
const https = require('https');
const { fork } = require('child_process');
const { ipcMain } = require('electron');
const { sendToMainWindow } = require('./main-window');

// ─── Model registry ───────────────────────────────────────────────────────────

const NEUTTS_MODELS = {
  backbone: {
    key: 'backbone',
    label: 'NeuTTS Nano (backbone)',
    filename: 'neutts-nano-Q4_0.gguf',
    size: '185 MB',
    bytes: 194_600_640,
    url: 'https://huggingface.co/neuphonic/neutts-nano-q4-gguf/resolve/main/neutts-nano-Q4_0.gguf',
  },
  decoder: {
    key: 'decoder',
    label: 'NeuCodec ONNX decoder (int8)',
    filename: 'neucodec-decoder-int8.onnx',
    size: '312 MB',
    bytes: 312_292_102,
    url: 'https://huggingface.co/neuphonic/neucodec-onnx-decoder-int8/resolve/main/model.onnx',
  },
};

// ─── Paths ────────────────────────────────────────────────────────────────────

function getNeuTTSDir() {
  const { app } = require('electron');
  const dir = path.join(app.getPath('userData'), 'neutts');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getBackbonePath() {
  return path.join(getNeuTTSDir(), NEUTTS_MODELS.backbone.filename);
}

function getDecoderPath() {
  // Accept either filename for backward compat
  const int8Path = path.join(getNeuTTSDir(), NEUTTS_MODELS.decoder.filename);
  const oldPath = path.join(getNeuTTSDir(), 'neucodec-decoder.onnx');
  return fs.existsSync(oldPath) ? oldPath : int8Path;
}

function getVoicesDir() {
  if (require('electron').app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'main', 'voice-refs');
  }
  return path.join(__dirname, 'voice-refs');
}

function isBackboneDownloaded() {
  try { return fs.existsSync(getBackbonePath()); } catch { return false; }
}

function isDecoderDownloaded() {
  try { return fs.existsSync(getDecoderPath()); } catch { return false; }
}

function isFullyDownloaded() {
  return isBackboneDownloaded() && isDecoderDownloaded();
}

/** Returns true if the user has the slow FP32 decoder instead of the INT8 one */
function isUsingLegacyDecoder() {
  const oldPath = path.join(getNeuTTSDir(), 'neucodec-decoder.onnx');
  return fs.existsSync(oldPath);
}

/**
 * Delete the FP32 decoder so the app will fall through to the INT8 path.
 * The caller should then trigger a fresh INT8 download.
 */
function deleteLegacyDecoder() {
  const oldPath = path.join(getNeuTTSDir(), 'neucodec-decoder.onnx');
  try {
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    // Kill the worker so it re-initialises with the INT8 decoder once downloaded
    if (worker) { try { worker.kill(); } catch {} }
    resetWorkerState('Switching to optimised decoder');
    console.log('[neutts] legacy FP32 decoder deleted, worker reset');
    return true;
  } catch (e) {
    console.error('[neutts] failed to delete legacy decoder:', e.message);
    return false;
  }
}

// ─── Download state ───────────────────────────────────────────────────────────

const activeDownloads = {};  // key → { req, res, writeStream }
const pausedFiles = new Set();

function getDownloadStatus() {
  return {
    backbone: {
      ...NEUTTS_MODELS.backbone,
      available: isBackboneDownloaded(),
      status: isBackboneDownloaded() ? 'downloaded'
        : activeDownloads.backbone ? 'downloading'
        : pausedFiles.has('backbone') ? 'paused'
        : 'not_downloaded',
      downloaded: getPartialSize('backbone'),
      total: NEUTTS_MODELS.backbone.bytes,
    },
    decoder: {
      ...NEUTTS_MODELS.decoder,
      available: isDecoderDownloaded(),
      status: isDecoderDownloaded() ? 'downloaded'
        : activeDownloads.decoder ? 'downloading'
        : pausedFiles.has('decoder') ? 'paused'
        : 'not_downloaded',
      downloaded: getPartialSize('decoder'),
      total: NEUTTS_MODELS.decoder.bytes,
    },
    ready: isFullyDownloaded(),
  };
}

function getPartialSize(key) {
  const p = path.join(getNeuTTSDir(), NEUTTS_MODELS[key].filename + '.tmp');
  try { return fs.statSync(p).size; } catch { return 0; }
}

function downloadFile(key, onProgress) {
  return new Promise((resolve, reject) => {
    const model = NEUTTS_MODELS[key];
    const tmpPath = path.join(getNeuTTSDir(), model.filename + '.tmp');
    const destPath = path.join(getNeuTTSDir(), model.filename);

    if (fs.existsSync(destPath)) {
      resolve();
      return;
    }

    const resume = fs.existsSync(tmpPath) ? fs.statSync(tmpPath).size : 0;
    const writeStream = fs.createWriteStream(tmpPath, { flags: resume > 0 ? 'a' : 'w' });

    const headers = { 'User-Agent': 'Tellaflow/1.0' };
    if (resume > 0) headers['Range'] = `bytes=${resume}-`;

    console.log(`[neutts] downloading ${key} from ${model.url} (resume at ${resume})`);

    function doRequest(url) {
      const req = https.get(url, { headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          req.destroy();
          doRequest(res.headers.location);
          return;
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          reject(new Error(`HTTP ${res.statusCode} for ${key}`));
          return;
        }

        const total = parseInt(res.headers['content-length'] || '0', 10) + resume;
        let downloaded = resume;

        activeDownloads[key] = { req, res, writeStream };

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          onProgress({ key, downloaded, total, status: 'downloading' });
        });

        res.pipe(writeStream);

        writeStream.on('finish', () => {
          delete activeDownloads[key];
          try {
            fs.renameSync(tmpPath, destPath);
            console.log(`[neutts] ${key} download complete`);
            resolve();
          } catch (e) {
            reject(e);
          }
        });

        res.on('error', (e) => {
          delete activeDownloads[key];
          reject(e);
        });
        writeStream.on('error', (e) => {
          delete activeDownloads[key];
          reject(e);
        });
      });

      req.on('error', (e) => {
        delete activeDownloads[key];
        reject(e);
      });
    }

    doRequest(model.url);
  });
}

function pauseDownload(key) {
  const dl = activeDownloads[key];
  if (!dl) return;
  pausedFiles.add(key);
  try { dl.res.unpipe(dl.writeStream); } catch {}
  try { dl.res.destroy(); } catch {}
  try { dl.req.destroy(); } catch {}
  try { dl.writeStream.end(); } catch {}
  delete activeDownloads[key];
}

function cancelDownload(key) {
  pauseDownload(key);
  pausedFiles.delete(key);
  const tmp = path.join(getNeuTTSDir(), NEUTTS_MODELS[key]?.filename + '.tmp');
  try { fs.unlinkSync(tmp); } catch {}
}

function deleteModel(key) {
  cancelDownload(key);
  const dest = path.join(getNeuTTSDir(), NEUTTS_MODELS[key]?.filename || '');
  try { fs.unlinkSync(dest); } catch {}
}

// ─── Worker lifecycle ─────────────────────────────────────────────────────────

let worker = null;
let initPromise = null;
let initReject = null;   // so we can reject it if the worker exits during init
let workerReady = false;
let reqId = 0;
const pending = new Map(); // id → { resolve, reject }

function getWorkerPath() {
  const { app } = require('electron');
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'main', 'neutts-worker.js');
  }
  return path.join(__dirname, 'neutts-worker.js');
}

function resetWorkerState(reason) {
  const err = new Error(reason || 'NeuTTS worker reset');
  worker = null;
  initPromise = null;
  workerReady = false;
  // Reset the synthesis queue so the next synthesize() call starts fresh
  synthQueue = Promise.resolve();
  // Reject any in-flight synthesis requests
  for (const [, p] of pending) p.reject(err);
  pending.clear();
  // Reject a pending init if the worker never became ready
  if (initReject) { initReject(err); initReject = null; }
}

function ensureWorker() {
  if (initPromise) return initPromise;
  if (!isFullyDownloaded()) {
    return Promise.reject(new Error('NeuTTS models not downloaded'));
  }

  initPromise = new Promise((resolve, reject) => {
    initReject = reject;

    worker = fork(getWorkerPath(), [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });

    worker.stdout.on('data', (d) => process.stdout.write(d));
    worker.stderr.on('data', (d) => process.stderr.write(d));

    worker.on('message', (msg) => {
      if (msg.type === 'init-done') {
        workerReady = true;
        initReject = null;
        console.log('[neutts] worker ready');
        resolve();
      } else if (msg.type === 'result') {
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); p.resolve({ pcmBase64: msg.pcmBase64, sampleRate: msg.sampleRate }); }
      } else if (msg.type === 'error') {
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); p.reject(new Error(msg.error)); }
        else if (!workerReady) { resetWorkerState(msg.error); }
      }
    });

    worker.on('exit', (code, signal) => {
      console.warn('[neutts] worker exited — code:', code, 'signal:', signal);
      resetWorkerState(`NeuTTS worker exited (code=${code})`);
    });

    worker.send({
      type: 'init',
      backbonePath: getBackbonePath(),
      decoderPath: getDecoderPath(),
      voicesDir: getVoicesDir(),
    });
  });

  return initPromise;
}

/**
 * Synthesize text using NeuTTS Nano.
 * Returns { pcmBase64, sampleRate } — Float32 PCM audio at 24kHz.
 *
 * A serial queue ensures the worker processes one chunk at a time.
 */
let synthQueue = Promise.resolve();

async function synthesize(text, voiceName = 'dave') {
  return new Promise((resolve, reject) => {
    synthQueue = synthQueue
      .then(async () => {
        await ensureWorker();
        if (!worker) throw new Error('NeuTTS worker unavailable after init');
        const id = ++reqId;
        await new Promise((res, rej) => {
          pending.set(id, {
            resolve: (val) => { resolve(val); res(); },
            reject:  (err) => { reject(err);  res(); },
          });
          worker.send({ type: 'synthesize', id, text, voiceName });
        });
      })
      .catch(err => {
        reject(err);
        // Return resolved so the queue keeps moving
      });
  });
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

let activeDownloadChain = Promise.resolve();

function startDownloadSequence() {
  activeDownloadChain = activeDownloadChain.then(async () => {
    const onProgress = ({ key, downloaded, total }) => {
      sendToMainWindow('neutts-download-progress', { key, downloaded, total });
    };

    if (!isBackboneDownloaded()) {
      try {
        await downloadFile('backbone', onProgress);
      } catch (e) {
        console.error('[neutts] backbone download failed:', e.message);
        sendToMainWindow('neutts-download-error', { key: 'backbone', error: e.message });
        return;
      }
    }

    if (!isDecoderDownloaded()) {
      try {
        await downloadFile('decoder', onProgress);
      } catch (e) {
        console.error('[neutts] decoder download failed:', e.message);
        sendToMainWindow('neutts-download-error', { key: 'decoder', error: e.message });
        return;
      }
    }

    sendToMainWindow('neutts-status-changed', getDownloadStatus());
    console.log('[neutts] all downloads complete');
  });
}

function registerIpc() {
  ipcMain.handle('get-neutts-status', () => getDownloadStatus());

  ipcMain.on('start-neutts-download', () => {
    pausedFiles.clear();
    startDownloadSequence();
    sendToMainWindow('neutts-status-changed', getDownloadStatus());
  });

  ipcMain.on('pause-neutts-download', (_, key) => {
    if (key) {
      pauseDownload(key);
    } else {
      pauseDownload('backbone');
      pauseDownload('decoder');
    }
    sendToMainWindow('neutts-status-changed', getDownloadStatus());
  });

  ipcMain.on('cancel-neutts-download', (_, key) => {
    if (key) {
      cancelDownload(key);
    } else {
      cancelDownload('backbone');
      cancelDownload('decoder');
    }
    sendToMainWindow('neutts-status-changed', getDownloadStatus());
  });

  ipcMain.on('delete-neutts-model', (_, key) => {
    if (key) {
      deleteModel(key);
    } else {
      deleteModel('backbone');
      deleteModel('decoder');
    }
    // Reset worker if running
    if (worker) { try { worker.kill(); } catch {} worker = null; initPromise = null; workerReady = false; }
    sendToMainWindow('neutts-status-changed', getDownloadStatus());
  });

  // Real synthesis IPC — replaces the old stub in audiobook.js
  ipcMain.handle('neutts-synthesize', async (_, { text, voiceName }) => {
    console.log(`[neutts] synthesize IPC: text="${text?.slice(0, 50)}" voice=${voiceName}`);
    try {
      const result = await synthesize(text, voiceName);
      return result;
    } catch (err) {
      console.error('[neutts] synthesize error:', err.message);
      throw err;
    }
  });

  // Decoder quality management
  ipcMain.handle('neutts-decoder-info', () => ({
    isLegacy: isUsingLegacyDecoder(),
    decoderPath: getDecoderPath(),
  }));

  ipcMain.handle('neutts-upgrade-decoder', async () => {
    deleteLegacyDecoder();
    // Kick off INT8 download in background
    startDownloadSequence();
    sendToMainWindow('neutts-status-changed', getDownloadStatus());
    return { started: true };
  });
}

module.exports = { registerIpc, synthesize, isFullyDownloaded, getDownloadStatus, isUsingLegacyDecoder };
