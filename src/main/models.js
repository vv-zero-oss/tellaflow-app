const path = require('path');
const fs = require('fs');
const https = require('https');
const { app } = require('electron');

const MODEL_REGISTRY = {
  tiny:   { file: 'ggml-tiny.bin',      size: '75 MB',   bytes: 78_000_000,    quality: 'Basic' },
  base:   { file: 'ggml-base.bin',      size: '145 MB',  bytes: 148_000_000,   quality: 'Fair' },
  small:  { file: 'ggml-small.bin',     size: '460 MB',  bytes: 488_000_000,   quality: 'Good' },
  medium: { file: 'ggml-medium.bin',    size: '1.5 GB',  bytes: 1_533_000_000, quality: 'Great' },
  large:  { file: 'ggml-large-v3.bin',  size: '3 GB',    bytes: 3_095_000_000, quality: 'Best' },
};

const HF_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

const activeDownloads = {};
const pausedModels = new Set();

function getBundledModelsDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'models');
  }
  return path.join(__dirname, '..', '..', 'resources', 'models');
}

function getUserModelsDir() {
  const dir = path.join(app.getPath('userData'), 'models');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getModelPath(modelKey) {
  const info = MODEL_REGISTRY[modelKey];
  if (!info) return null;

  const bundled = path.join(getBundledModelsDir(), info.file);
  if (fs.existsSync(bundled)) return bundled;

  const user = path.join(getUserModelsDir(), info.file);
  if (fs.existsSync(user)) return user;

  return null;
}

function isModelAvailable(modelKey) {
  return getModelPath(modelKey) !== null;
}

function getPartialSize(modelKey) {
  const info = MODEL_REGISTRY[modelKey];
  if (!info) return 0;
  const tmpPath = path.join(getUserModelsDir(), info.file + '.tmp');
  try {
    return fs.statSync(tmpPath).size;
  } catch {
    return 0;
  }
}

function getModelsStatus() {
  const result = {};
  for (const [key, info] of Object.entries(MODEL_REGISTRY)) {
    const available = isModelAvailable(key);
    const dl = activeDownloads[key];
    let status = available ? 'downloaded' : 'not_downloaded';
    let downloaded = 0;
    let total = info.bytes;

    if (dl) {
      status = 'downloading';
      downloaded = dl.downloaded;
      total = dl.total || info.bytes;
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

/**
 * Start or resume a model download. Fires onProgress callbacks and
 * calls onComplete/onError when finished. Does NOT return a promise
 * that blocks — callers should use callbacks.
 */
function startDownload(modelKey, { onProgress, onComplete, onError }) {
  const info = MODEL_REGISTRY[modelKey];
  if (!info) { onError?.(new Error(`Unknown model: ${modelKey}`)); return; }

  const destPath = path.join(getUserModelsDir(), info.file);
  const tmpPath = destPath + '.tmp';

  if (fs.existsSync(destPath)) { onComplete?.(destPath); return; }

  if (activeDownloads[modelKey]) { onError?.(new Error(`Already downloading ${modelKey}`)); return; }

  pausedModels.delete(modelKey);

  let startByte = 0;
  try { startByte = fs.statSync(tmpPath).size; } catch {}

  const url = `${HF_BASE_URL}/${info.file}`;

  const MAX_REDIRECTS = 10;
  function doRequest(requestUrl, resumeFrom, redirectCount = 0) {
    if (redirectCount > MAX_REDIRECTS) {
      delete activeDownloads[modelKey];
      onError?.(new Error(`Too many redirects (>${MAX_REDIRECTS})`));
      return;
    }
    const headers = {};
    if (resumeFrom > 0) headers['Range'] = `bytes=${resumeFrom}-`;

    const proto = requestUrl.startsWith('https') ? https : require('http');
    const req = proto.get(requestUrl, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        doRequest(res.headers.location, resumeFrom, redirectCount + 1);
        return;
      }

      if (res.statusCode === 416) {
        try { fs.unlinkSync(tmpPath); } catch {}
        doRequest(requestUrl, 0, redirectCount + 1);
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
        if (range) {
          const m = range.match(/\/(\d+)$/);
          totalBytes = m ? parseInt(m[1], 10) : info.bytes;
        } else {
          totalBytes = resumeFrom + parseInt(res.headers['content-length'] || '0', 10);
        }
      } else {
        totalBytes = parseInt(res.headers['content-length'], 10) || info.bytes;
        startByte = 0;
      }

      let downloadedBytes = res.statusCode === 206 ? resumeFrom : 0;
      const flags = res.statusCode === 206 ? 'a' : 'w';
      const writeStream = fs.createWriteStream(tmpPath, { flags });

      activeDownloads[modelKey] = {
        request: req,
        response: res,
        writeStream,
        downloaded: downloadedBytes,
        total: totalBytes,
      };

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const dl = activeDownloads[modelKey];
        if (dl) dl.downloaded = downloadedBytes;
        onProgress?.({
          modelKey,
          downloaded: downloadedBytes,
          total: totalBytes,
          percent: Math.round((downloadedBytes / totalBytes) * 100),
        });
      });

      res.pipe(writeStream);

      writeStream.on('finish', () => {
        if (pausedModels.has(modelKey)) return;
        delete activeDownloads[modelKey];
        try {
          fs.renameSync(tmpPath, destPath);
          onComplete?.(destPath);
        } catch (err) {
          onError?.(err);
        }
      });

      writeStream.on('error', (err) => {
        delete activeDownloads[modelKey];
        try { fs.unlinkSync(tmpPath); } catch {}
        onError?.(err);
      });

      res.on('error', (err) => {
        delete activeDownloads[modelKey];
        onError?.(err);
      });
    });

    req.on('error', (err) => {
      delete activeDownloads[modelKey];
      onError?.(err);
    });
  }

  doRequest(url, startByte);
}

function pauseDownload(modelKey) {
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

function cancelDownload(modelKey) {
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
  const info = MODEL_REGISTRY[modelKey];
  if (info) {
    const tmpPath = path.join(getUserModelsDir(), info.file + '.tmp');
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

function deleteModel(modelKey) {
  cancelDownload(modelKey);
  const info = MODEL_REGISTRY[modelKey];
  if (!info) return;
  const userPath = path.join(getUserModelsDir(), info.file);
  try { fs.unlinkSync(userPath); } catch {}
}

function isDownloading(modelKey) {
  return !!activeDownloads[modelKey];
}

// ── Parakeet TDT 0.6b v2 ────────────────────────────────────────────────────
// The model ships as a single tarball containing 4 files:
//   encoder.int8.onnx (~622 MB), decoder.int8.onnx, joiner.int8.onnx, tokens.txt
// Extracted to userData/models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/

const PARAKEET_TARBALL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2';
const PARAKEET_DIR_NAME = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8';
const PARAKEET_MODEL_KEY = 'parakeet-tdt-0.6b-v2';
const PARAKEET_TOTAL_BYTES = 662_000_000;
const PARAKEET_FILES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'];

let parakeetDownload = null;
let parakeetCancelled = false;

function getParakeetDir() {
  return path.join(getUserModelsDir(), PARAKEET_DIR_NAME);
}

function isParakeetAvailable() {
  const dir = getParakeetDir();
  return PARAKEET_FILES.every(f => fs.existsSync(path.join(dir, f)));
}

function getParakeetFilePaths() {
  const dir = getParakeetDir();
  return {
    encoder: path.join(dir, 'encoder.int8.onnx'),
    decoder: path.join(dir, 'decoder.int8.onnx'),
    joiner: path.join(dir, 'joiner.int8.onnx'),
    tokens: path.join(dir, 'tokens.txt'),
  };
}

function getParakeetPartialSize() {
  const tmpPath = path.join(getUserModelsDir(), 'parakeet-tdt.tar.bz2.tmp');
  try { return fs.statSync(tmpPath).size; } catch { return 0; }
}

function getParakeetStatus() {
  const available = isParakeetAvailable();
  const dl = parakeetDownload;
  let status = available ? 'downloaded' : 'not_downloaded';
  let downloaded = 0;
  const total = (dl && dl.total) || PARAKEET_TOTAL_BYTES;

  if (dl) {
    status = 'downloading';
    downloaded = dl.downloaded;
  } else if (!available) {
    const partial = getParakeetPartialSize();
    if (partial > 0) {
      status = 'paused';
      downloaded = partial;
    }
  }

  return {
    size: '~632 MB',
    quality: 'Excellent',
    available,
    status,
    downloaded,
    total,
  };
}

function startParakeetDownload({ onProgress, onComplete, onError }) {
  if (isParakeetAvailable()) { onComplete?.(); return; }
  if (parakeetDownload) { onError?.(new Error('Already downloading Parakeet')); return; }

  parakeetCancelled = false;

  const tmpPath = path.join(getUserModelsDir(), 'parakeet-tdt.tar.bz2.tmp');
  const finalPath = path.join(getUserModelsDir(), 'parakeet-tdt.tar.bz2');

  let startByte = 0;
  try { startByte = fs.statSync(tmpPath).size; } catch {}

  const MAX_REDIRECTS = 10;
  function doRequest(requestUrl, resumeFrom, redirectCount = 0) {
    if (redirectCount > MAX_REDIRECTS) {
      parakeetDownload = null;
      onError?.(new Error(`Too many redirects (>${MAX_REDIRECTS})`));
      return;
    }
    const headers = {};
    if (resumeFrom > 0) headers['Range'] = `bytes=${resumeFrom}-`;

    const proto = requestUrl.startsWith('https') ? https : require('http');
    const req = proto.get(requestUrl, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        doRequest(res.headers.location, resumeFrom, redirectCount + 1);
        return;
      }

      if (res.statusCode === 416) {
        try { fs.unlinkSync(tmpPath); } catch {}
        doRequest(requestUrl, 0, redirectCount + 1);
        return;
      }

      if (res.statusCode !== 200 && res.statusCode !== 206) {
        parakeetDownload = null;
        onError?.(new Error(`Parakeet download failed: HTTP ${res.statusCode}`));
        return;
      }

      let totalBytes;
      if (res.statusCode === 206) {
        const range = res.headers['content-range'];
        if (range) {
          const m = range.match(/\/(\d+)$/);
          totalBytes = m ? parseInt(m[1], 10) : PARAKEET_TOTAL_BYTES;
        } else {
          totalBytes = resumeFrom + parseInt(res.headers['content-length'] || '0', 10);
        }
      } else {
        totalBytes = parseInt(res.headers['content-length'], 10) || PARAKEET_TOTAL_BYTES;
        resumeFrom = 0;
      }

      let downloadedBytes = resumeFrom;
      const flags = res.statusCode === 206 ? 'a' : 'w';
      const writeStream = fs.createWriteStream(tmpPath, { flags });

      parakeetDownload = { request: req, response: res, writeStream, downloaded: downloadedBytes, total: totalBytes };

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (parakeetDownload) parakeetDownload.downloaded = downloadedBytes;
        onProgress?.({ modelKey: PARAKEET_MODEL_KEY, downloaded: downloadedBytes, total: totalBytes, percent: Math.round((downloadedBytes / totalBytes) * 100) });
      });

      res.pipe(writeStream);

      writeStream.on('finish', () => {
        if (parakeetCancelled) return;
        parakeetDownload = null;

        try { fs.renameSync(tmpPath, finalPath); } catch (err) { onError?.(err); return; }

        // Extract tarball
        const { execFile } = require('child_process');
        execFile('tar', ['xf', finalPath, '-C', getUserModelsDir()], (err) => {
          try { fs.unlinkSync(finalPath); } catch {}
          if (err) { onError?.(err); return; }
          if (isParakeetAvailable()) {
            onComplete?.();
          } else {
            onError?.(new Error('Extraction done but model files are missing'));
          }
        });
      });

      writeStream.on('error', (err) => { parakeetDownload = null; onError?.(err); });
      res.on('error', (err) => { parakeetDownload = null; onError?.(err); });
    });

    req.on('error', (err) => { parakeetDownload = null; onError?.(err); });
  }

  doRequest(PARAKEET_TARBALL_URL, startByte);
}

function cancelParakeetDownload() {
  parakeetCancelled = true;
  const dl = parakeetDownload;
  if (dl) {
    try { dl.response.unpipe(dl.writeStream); } catch {}
    try { dl.response.destroy(); } catch {}
    try { dl.request.destroy(); } catch {}
    try { dl.writeStream.end(); } catch {}
    parakeetDownload = null;
  }
  const tmpPath = path.join(getUserModelsDir(), 'parakeet-tdt.tar.bz2.tmp');
  try { fs.unlinkSync(tmpPath); } catch {}
}

function deleteParakeet() {
  cancelParakeetDownload();
  const dir = getParakeetDir();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function isParakeetDownloading() {
  return !!parakeetDownload;
}

module.exports = {
  MODEL_REGISTRY,
  getModelPath,
  isModelAvailable,
  getAvailableModels: getModelsStatus,
  getModelsStatus,
  startDownload,
  pauseDownload,
  cancelDownload,
  deleteModel,
  isDownloading,
  getBundledModelsDir,
  getUserModelsDir,
  // Parakeet
  PARAKEET_MODEL_KEY,
  getParakeetDir,
  getParakeetFilePaths,
  isParakeetAvailable,
  getParakeetStatus,
  startParakeetDownload,
  cancelParakeetDownload,
  deleteParakeet,
  isParakeetDownloading,
};
