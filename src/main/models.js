const path = require('path');
const fs = require('fs');
const https = require('https');
const { app } = require('electron');

const MODEL_REGISTRY = {
  tiny:   { file: 'ggml-tiny.bin',      size: '75 MB',   bytes: 78_000_000,    quality: 'Basic' },
  base:   { file: 'ggml-base.bin',      size: '145 MB',  bytes: 148_000_000,   quality: 'Fair' },
  small:  { file: 'ggml-small.bin',     size: '460 MB',  bytes: 488_000_000,   quality: 'Good' },
  medium: { file: 'ggml-medium.bin',    size: '1.5 GB',  bytes: 1_533_000_000, quality: 'Great' },
  // large-v3-turbo, 5-bit quantised: near large-v3 accuracy at a fraction of
  // the size and several times the speed. Transcribes only (no translation).
  turbo:  { file: 'ggml-large-v3-turbo-q5_0.bin', size: '574 MB', bytes: 574_041_195, quality: 'Best' },
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

// ── Parakeet (NVIDIA NeMo transducers via sherpa-onnx) ──────────────────────
// Each variant ships as a tarball holding the same 4 files:
//   encoder.int8.onnx, decoder.int8.onnx, joiner.int8.onnx, tokens.txt
// extracted to userData/models/<dir>/. v2 is bundled with the app; the others
// are downloaded on demand. The active one is config `parakeetVariant`.

const ASR_RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';
const PARAKEET_VARIANTS = {
  v2: {
    label: 'Parakeet TDT 0.6b v2',
    dir: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
    url: `${ASR_RELEASE}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2`,
    tmpName: 'parakeet-tdt.tar.bz2',
    totalBytes: 662_000_000,
    size: '~632 MB',
    quality: 'Excellent',
  },
  unified: {
    label: 'Parakeet Unified 0.6b',
    dir: 'sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-non-streaming',
    url: `${ASR_RELEASE}/sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-non-streaming.tar.bz2`,
    tmpName: 'parakeet-unified.tar.bz2',
    totalBytes: 501_350_460,
    size: '~500 MB',
    quality: 'Best',
  },
};
const PARAKEET_MODEL_KEY = 'parakeet-tdt-0.6b-v2';
const PARAKEET_FILES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'];

const parakeetDownloads = {}; // variant → { request, response, writeStream, downloaded, total }
const parakeetCancelled = new Set();

/** The variant the app should use (falls back to v2 for unknown values). */
function getActiveParakeetVariant() {
  const v = require('./config').getParakeetVariant();
  return PARAKEET_VARIANTS[v] ? v : 'v2';
}

function variantInfo(variant) {
  return PARAKEET_VARIANTS[variant] || PARAKEET_VARIANTS[getActiveParakeetVariant()];
}

function hasParakeetFiles(dir) {
  return PARAKEET_FILES.every((f) => fs.existsSync(path.join(dir, f)));
}

function getParakeetDir(variant = getActiveParakeetVariant()) {
  const info = variantInfo(variant);
  // Check bundled models first (shipped with app)
  const bundled = path.join(getBundledModelsDir(), info.dir);
  if (hasParakeetFiles(bundled)) return bundled;
  // Fall back to user-downloaded models
  return path.join(getUserModelsDir(), info.dir);
}

function isParakeetAvailable(variant = getActiveParakeetVariant()) {
  return hasParakeetFiles(getParakeetDir(variant));
}

function getParakeetFilePaths(variant = getActiveParakeetVariant()) {
  const dir = getParakeetDir(variant);
  return {
    encoder: path.join(dir, 'encoder.int8.onnx'),
    decoder: path.join(dir, 'decoder.int8.onnx'),
    joiner: path.join(dir, 'joiner.int8.onnx'),
    tokens: path.join(dir, 'tokens.txt'),
  };
}

function parakeetTmpPath(variant) {
  return path.join(getUserModelsDir(), variantInfo(variant).tmpName + '.tmp');
}

function getParakeetPartialSize(variant) {
  try { return fs.statSync(parakeetTmpPath(variant)).size; } catch { return 0; }
}

function getParakeetStatus(variant = getActiveParakeetVariant()) {
  const info = variantInfo(variant);
  const available = isParakeetAvailable(variant);
  const dl = parakeetDownloads[variant];
  let status = available ? 'downloaded' : 'not_downloaded';
  let downloaded = 0;
  const total = (dl && dl.total) || info.totalBytes;

  if (dl) {
    status = 'downloading';
    downloaded = dl.downloaded;
  } else if (!available) {
    const partial = getParakeetPartialSize(variant);
    if (partial > 0) {
      status = 'paused';
      downloaded = partial;
    }
  }

  return {
    variant,
    label: info.label,
    size: info.size,
    quality: info.quality,
    available,
    status,
    downloaded,
    total,
  };
}

function startParakeetDownload(variant, { onProgress, onComplete, onError } = {}) {
  if (typeof variant === 'object') { ({ onProgress, onComplete, onError } = variant); variant = 'v2'; }
  if (!PARAKEET_VARIANTS[variant]) { onError?.(new Error(`Unknown Parakeet model: ${variant}`)); return; }
  const info = PARAKEET_VARIANTS[variant];
  if (isParakeetAvailable(variant)) { onComplete?.(); return; }
  if (parakeetDownloads[variant]) { onError?.(new Error(`Already downloading ${info.label}`)); return; }

  parakeetCancelled.delete(variant);

  const tmpPath = parakeetTmpPath(variant);
  const finalPath = path.join(getUserModelsDir(), info.tmpName);

  let startByte = 0;
  try { startByte = fs.statSync(tmpPath).size; } catch {}

  const MAX_REDIRECTS = 10;
  function doRequest(requestUrl, resumeFrom, redirectCount = 0) {
    if (redirectCount > MAX_REDIRECTS) {
      delete parakeetDownloads[variant];
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
        delete parakeetDownloads[variant];
        onError?.(new Error(`${info.label} download failed: HTTP ${res.statusCode}`));
        return;
      }

      let totalBytes;
      if (res.statusCode === 206) {
        const range = res.headers['content-range'];
        if (range) {
          const m = range.match(/\/(\d+)$/);
          totalBytes = m ? parseInt(m[1], 10) : info.totalBytes;
        } else {
          totalBytes = resumeFrom + parseInt(res.headers['content-length'] || '0', 10);
        }
      } else {
        totalBytes = parseInt(res.headers['content-length'], 10) || info.totalBytes;
        resumeFrom = 0;
      }

      let downloadedBytes = resumeFrom;
      const flags = res.statusCode === 206 ? 'a' : 'w';
      const writeStream = fs.createWriteStream(tmpPath, { flags });

      parakeetDownloads[variant] = { request: req, response: res, writeStream, downloaded: downloadedBytes, total: totalBytes };

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (parakeetDownloads[variant]) parakeetDownloads[variant].downloaded = downloadedBytes;
        onProgress?.({ modelKey: PARAKEET_MODEL_KEY, variant, downloaded: downloadedBytes, total: totalBytes, percent: Math.round((downloadedBytes / totalBytes) * 100) });
      });

      res.pipe(writeStream);

      writeStream.on('finish', () => {
        if (parakeetCancelled.has(variant)) return;
        delete parakeetDownloads[variant];

        try { fs.renameSync(tmpPath, finalPath); } catch (err) { onError?.(err); return; }

        // Extract tarball
        const { execFile } = require('child_process');
        execFile('tar', ['xf', finalPath, '-C', getUserModelsDir()], (err) => {
          try { fs.unlinkSync(finalPath); } catch {}
          if (err) { onError?.(err); return; }
          if (isParakeetAvailable(variant)) {
            onComplete?.();
          } else {
            onError?.(new Error('Extraction done but model files are missing'));
          }
        });
      });

      writeStream.on('error', (err) => { delete parakeetDownloads[variant]; onError?.(err); });
      res.on('error', (err) => { delete parakeetDownloads[variant]; onError?.(err); });
    });

    req.on('error', (err) => { delete parakeetDownloads[variant]; onError?.(err); });
  }

  doRequest(info.url, startByte);
}

function cancelParakeetDownload(variant = 'v2') {
  parakeetCancelled.add(variant);
  const dl = parakeetDownloads[variant];
  if (dl) {
    try { dl.response.unpipe(dl.writeStream); } catch {}
    try { dl.response.destroy(); } catch {}
    try { dl.request.destroy(); } catch {}
    try { dl.writeStream.end(); } catch {}
    delete parakeetDownloads[variant];
  }
  try { fs.unlinkSync(parakeetTmpPath(variant)); } catch {}
}

/** Removes a downloaded variant. Bundled models are never deleted. */
function deleteParakeet(variant = 'v2') {
  cancelParakeetDownload(variant);
  const dir = path.join(getUserModelsDir(), variantInfo(variant).dir);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function isParakeetDownloading(variant) {
  return variant ? !!parakeetDownloads[variant] : Object.keys(parakeetDownloads).length > 0;
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
  PARAKEET_VARIANTS,
  getActiveParakeetVariant,
  getParakeetDir,
  getParakeetFilePaths,
  isParakeetAvailable,
  getParakeetStatus,
  startParakeetDownload,
  cancelParakeetDownload,
  deleteParakeet,
  isParakeetDownloading,
};
