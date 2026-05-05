/**
 * TTS Engine — Pocket TTS via sherpa-onnx-node (Kokoro-82M).
 * Synthesizes text to PCM audio and plays back via IPC to a renderer window.
 *
 * sherpa-onnx-node is already installed (used for Parakeet STT).
 * It supports offline TTS with Kokoro/VITS models.
 */
const path = require('path');
const fs = require('fs');
const { BrowserWindow } = require('electron');

let tts = null;
let playbackWindow = null;
let isInitialized = false;

// ─── Model paths ────────────────────────────────────────────────────────────────

function getTTSModelsDir() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'models', 'tts');
}

function getModelConfig() {
  const dir = getTTSModelsDir();
  return {
    modelDir: dir,
    modelFile: path.join(dir, 'kokoro-v1.0.onnx'),
    voicesFile: path.join(dir, 'voices.bin'),
    tokensFile: path.join(dir, 'tokens.txt'),
    dataDirFile: path.join(dir, 'espeak-ng-data'),
  };
}

function isModelDownloaded() {
  const config = getModelConfig();
  return fs.existsSync(config.modelFile);
}

// ─── Initialization ─────────────────────────────────────────────────────────────

/**
 * Initialize the TTS engine. Call after model is downloaded.
 * Uses sherpa-onnx-node's OfflineTts API.
 */
async function init() {
  if (isInitialized) return;
  if (!isModelDownloaded()) {
    console.warn('[tts] Model not downloaded yet');
    return;
  }

  try {
    const sherpa = require('sherpa-onnx-node');
    const config = getModelConfig();

    // Initialize sherpa-onnx TTS
    // The exact API depends on sherpa-onnx-node version
    // This is the standard OfflineTts interface
    tts = new sherpa.OfflineTts({
      model: {
        vits: {
          model: config.modelFile,
          tokens: config.tokensFile,
          dataDir: config.dataDirFile,
        },
      },
      numThreads: 2,
      maxNumSentences: 1,
    });

    isInitialized = true;
    console.log('[tts] Initialized successfully');
  } catch (err) {
    console.error('[tts] Init failed:', err.message);
    // TTS is optional — app works without it (just no voice output)
    tts = null;
  }
}

/**
 * Dispose the TTS engine to free memory.
 */
function dispose() {
  tts = null;
  isInitialized = false;
  console.log('[tts] Disposed');
}

// ─── Synthesis ──────────────────────────────────────────────────────────────────

/**
 * Synthesize text to PCM audio.
 * @param {string} text - Text to synthesize
 * @param {object} [opts]
 * @param {number} [opts.sid=0] - Speaker ID (voice)
 * @param {number} [opts.speed=1.0] - Speed multiplier
 * @returns {{ samples: Float32Array, sampleRate: number } | null}
 */
function synthesize(text, { sid = 0, speed = 1.0 } = {}) {
  if (!tts) return null;

  try {
    const audio = tts.generate({ text, sid, speed });
    return { samples: audio.samples, sampleRate: audio.sampleRate };
  } catch (err) {
    console.error('[tts] Synthesis failed:', err.message);
    return null;
  }
}

/**
 * Synthesize text in streaming fashion (sentence by sentence).
 * Yields audio chunks as they're ready.
 *
 * @param {string} text - Full text to synthesize
 * @param {object} [opts]
 * @param {number} [opts.sid=0]
 * @param {number} [opts.speed=1.0]
 * @param {function} [opts.onChunk] - (samples: Float32Array, sampleRate: number) => void
 * @param {AbortSignal} [opts.signal]
 */
async function synthesizeStream(text, { sid = 0, speed = 1.0, onChunk, signal } = {}) {
  if (!tts || !onChunk) return;

  // Split text into sentences for streaming
  const sentences = splitSentences(text);

  for (const sentence of sentences) {
    if (signal?.aborted) break;
    if (!sentence.trim()) continue;

    const audio = synthesize(sentence, { sid, speed });
    if (audio) {
      onChunk(audio.samples, audio.sampleRate);
    }
  }
}

/**
 * Split text into sentences for streaming TTS.
 */
function splitSentences(text) {
  // Split on sentence-ending punctuation, keeping the punctuation
  return text
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.trim().length > 0);
}

// ─── Audio Playback (via hidden window) ─────────────────────────────────────────

/**
 * Create the hidden playback window for audio output.
 * Uses Web Audio API in a renderer process.
 */
function createPlaybackWindow() {
  if (playbackWindow) return;

  playbackWindow = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', '..', 'preload', 'ai-playback-preload.js'),
    },
  });

  playbackWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'ai-playback.html'));

  playbackWindow.on('closed', () => { playbackWindow = null; });
}

/**
 * Play PCM audio through the hidden playback window.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {Promise<void>}
 */
function playAudio(samples, sampleRate) {
  return new Promise((resolve) => {
    if (!playbackWindow) {
      createPlaybackWindow();
      // Wait for window to load
      playbackWindow.webContents.once('did-finish-load', () => {
        playbackWindow.webContents.send('play-audio', { samples: Array.from(samples), sampleRate });
        resolve();
      });
    } else {
      playbackWindow.webContents.send('play-audio', { samples: Array.from(samples), sampleRate });
      resolve();
    }
  });
}

/**
 * Stop any currently playing audio.
 */
function stopPlayback() {
  if (playbackWindow) {
    playbackWindow.webContents.send('stop-audio');
  }
}

// ─── High-level API ─────────────────────────────────────────────────────────────

/**
 * Speak text aloud (synthesize + play).
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.sid]
 * @param {number} [opts.speed]
 * @param {function} [opts.onWordStart] - (wordIndex: number) => void — for word highlighting
 * @param {AbortSignal} [opts.signal]
 */
async function speak(text, { sid = 0, speed = 1.0, onWordStart, signal } = {}) {
  if (!isInitialized) await init();
  if (!tts) {
    console.warn('[tts] Cannot speak — TTS not available');
    return;
  }

  createPlaybackWindow();

  // Stream sentence by sentence for lower perceived latency
  const sentences = splitSentences(text);
  let wordOffset = 0;

  for (const sentence of sentences) {
    if (signal?.aborted) break;

    const audio = synthesize(sentence, { sid, speed });
    if (audio) {
      onWordStart?.(wordOffset);
      await playAudio(audio.samples, audio.sampleRate);
      wordOffset += sentence.split(/\s+/).length;
    }
  }
}

// ─── Model download info ────────────────────────────────────────────────────────

const TTS_MODEL_REGISTRY = {
  'kokoro-82m': {
    name: 'Kokoro 82M',
    files: [
      { filename: 'kokoro-v1.0.onnx', url: 'https://huggingface.co/csukuangfj/kokoro-onnx-models/resolve/main/kokoro-v1.0.onnx', bytes: 170_000_000 },
      { filename: 'voices.bin', url: 'https://huggingface.co/csukuangfj/kokoro-onnx-models/resolve/main/voices.bin', bytes: 50_000_000 },
      { filename: 'tokens.txt', url: 'https://huggingface.co/csukuangfj/kokoro-onnx-models/resolve/main/tokens.txt', bytes: 10_000 },
    ],
    totalBytes: 220_000_000,
    description: 'Natural-sounding voice synthesis. CPU-efficient, 24kHz output.',
  },
};

function getTTSModelStatus() {
  const downloaded = isModelDownloaded();
  return {
    ...TTS_MODEL_REGISTRY['kokoro-82m'],
    downloaded,
    status: downloaded ? 'downloaded' : 'not_downloaded',
  };
}

module.exports = {
  init, dispose, synthesize, synthesizeStream, speak, stopPlayback,
  isModelDownloaded, getTTSModelsDir, getTTSModelStatus, TTS_MODEL_REGISTRY,
  createPlaybackWindow,
};
