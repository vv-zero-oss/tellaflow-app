/**
 * Builds the job `spec` sent to the transcription worker: which engine,
 * model paths, thread count and prompt. Computed in the main process (it
 * needs Electron's `app` and the settings DB) and passed with every job, so
 * the worker itself stays free of Electron / config dependencies.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const models = require('./models');

let cachedPerfCores = null;

/**
 * Number of performance cores. On Apple Silicon, running whisper.cpp on the
 * efficiency cores as well makes it slower (the P-cores wait on E-core
 * stragglers), so we size the thread pool to the P-core count.
 */
function getPerformanceCoreCount() {
  if (cachedPerfCores != null) return cachedPerfCores;
  let n = 0;
  if (process.platform === 'darwin') {
    try {
      const { execFileSync } = require('child_process');
      n = parseInt(execFileSync('sysctl', ['-n', 'hw.perflevel0.physicalcpu'], { timeout: 1000 }).toString().trim(), 10);
    } catch {}
  }
  if (!Number.isFinite(n) || n <= 0) n = Math.max(2, Math.floor((os.cpus()?.length || 4) / 2));
  cachedPerfCores = Math.min(8, n);
  return cachedPerfCores;
}

function getWhisperAddonDir() {
  const { app } = require('electron');
  const platform = process.platform === 'darwin' ? 'mac' : process.platform;
  const relDir = path.join('node_modules', '@kutalia', 'whisper-node-addon', 'dist', `${platform}-${process.arch}`);
  if (app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', relDir);
    if (fs.existsSync(unpacked)) return unpacked;
  }
  return path.join(__dirname, '..', '..', relDir);
}

function getActiveEngine() {
  return config.getTranscriptionEngine() === 'parakeet' && models.isParakeetAvailable() ? 'parakeet' : 'whisper';
}

function buildEngineSpec({ prompt } = {}) {
  const engine = getActiveEngine();
  const perf = getPerformanceCoreCount();
  if (engine === 'parakeet') {
    const lowMem = os.totalmem() / (1024 ** 3) <= 10;
    return {
      engine,
      parakeetPaths: models.getParakeetFilePaths(),
      // ONNX working memory scales with threads; 2 keeps 8 GB Macs safe.
      numThreads: lowMem ? 2 : Math.min(4, perf),
    };
  }
  // large-v3-turbo was trained without the translate task; it only transcribes.
  const translate = !!config.getTranslationEnabled() && config.getModel() !== 'turbo';
  const prompts = [];
  if (config.getProgrammingMode()) prompts.push('Technical dictation with programming terminology.');
  if (prompt) prompts.push(prompt);
  const modelPath = models.getModelPath(config.getModel());
  let modelBytes = 0;
  try { modelBytes = modelPath ? fs.statSync(modelPath).size : 0; } catch {}
  return {
    engine,
    modelPath,
    // The worker's memory ceiling sits on top of this (transcription-service).
    modelBytes,
    addonDir: getWhisperAddonDir(),
    numThreads: perf,
    language: translate ? config.getTranslationLanguage() : 'en',
    translate,
    prompt: prompts.join(' ') || undefined,
  };
}

function isEngineAvailable() {
  return getActiveEngine() === 'parakeet' || models.isModelAvailable(config.getModel());
}

module.exports = { buildEngineSpec, getActiveEngine, getPerformanceCoreCount, isEngineAvailable };
