const path = require('path');
const fs = require('fs');
const { getModelPath } = require('./models');
const config = require('./config');

let whisperTranscribe = null;
let currentModelPath = null;

// Whisper's native addon is not re-entrant — concurrent calls cause a fatal
// GGML_ASSERT. All calls are serialised through this promise chain so they
// execute one at a time regardless of how many callers fire simultaneously.
let transcribeChain = Promise.resolve();

function getAddonDir() {
  const { app } = require('electron');
  const platform = process.platform === 'darwin' ? 'mac' : process.platform;
  const arch = process.arch;
  const relDir = path.join(
    'node_modules', '@kutalia', 'whisper-node-addon', 'dist',
    `${platform}-${arch}`
  );

  if (app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', relDir);
    if (fs.existsSync(unpacked)) return unpacked;
  }

  return path.join(__dirname, '..', '..', relDir);
}

function loadAddon() {
  if (whisperTranscribe) return;

  const dir = getAddonDir();
  const nodePath = path.join(dir, 'whisper.node');
  console.log('Loading whisper addon from:', nodePath);

  try {
    const { whisper } = require(nodePath);
    const { promisify } = require('util');
    whisperTranscribe = promisify(whisper);
    console.log('Whisper native addon loaded successfully');
  } catch (err) {
    console.error('whisper-node-addon failed to load:', err.message);
    whisperTranscribe = null;
  }
}

async function loadModel(modelKey) {
  const modelPath = getModelPath(modelKey || config.getModel());
  if (!modelPath) {
    throw new Error(`Model "${modelKey}" not found. Download it first.`);
  }
  currentModelPath = modelPath;
  loadAddon();
  console.log(`Whisper model ready: ${modelPath}`);
  return modelPath;
}

async function _doTranscribe(pcmFloat32Array) {
  if (!currentModelPath) {
    await loadModel(config.getModel());
  }

  if (!whisperTranscribe) {
    throw new Error('Whisper addon not loaded');
  }

  const translationEnabled = config.getTranslationEnabled();
  const translationLanguage = config.getTranslationLanguage();

  const opts = {
    model: currentModelPath,
    pcmf32: pcmFloat32Array,
    // When translating, set the source language so Whisper skips language
    // detection and goes straight to transcription+translation. Otherwise
    // default to English for fastest, most accurate single-language results.
    language: translationEnabled ? translationLanguage : 'en',
    use_gpu: true,
    flash_attn: false,
    no_prints: true,
    comma_in_time: false,
    translate: translationEnabled,
    no_timestamps: true,
    detect_language: false,
    audio_ctx: 0,
    max_len: 0,
  };

  if (config.getProgrammingMode()) {
    opts.initial_prompt = 'Technical dictation with programming terminology.';
  }

  const result = await whisperTranscribe(opts);

  let text = '';
  if (result && result.transcription && Array.isArray(result.transcription)) {
    text = result.transcription.map(seg => seg[2]).join(' ');
  } else if (Array.isArray(result)) {
    text = result.map(s => (s.text || s[2] || '')).join(' ');
  } else {
    text = result?.text || '';
  }

  return text.trim();
}

// Public wrapper — queues calls so the native addon is never invoked concurrently.
let whisperCallCount = 0;

function transcribe(pcmFloat32Array) {
  const next = transcribeChain.then(() => _doTranscribe(pcmFloat32Array));
  // Swallow rejections on the chain tail so a failed call doesn't poison
  // subsequent queued calls; callers receive the real error via `next`.
  transcribeChain = next.catch(() => {});

  // Nudge GC periodically to free intermediate PCM buffers and resolved
  // promise references. Safe: chained normally, no concurrency risk.
  whisperCallCount++;
  if (whisperCallCount % 10 === 0 && global.gc) {
    transcribeChain = transcribeChain.then(() => {
      try { global.gc(); } catch {}
    });
  }

  return next;
}

async function warmup() {
  if (!currentModelPath || !whisperTranscribe) return;
  console.log('Whisper warmup: forcing full model load + GPU init...');
  const silence = new Float32Array(8000);
  // Route through the serialisation queue so startup warmup and an
  // immediately-following run-model-test don't race each other.
  const next = transcribeChain.then(() =>
    whisperTranscribe({
      model: currentModelPath,
      pcmf32: silence,
      language: 'en',
      use_gpu: true,
      flash_attn: false,
      no_prints: true,
      no_timestamps: true,
      audio_ctx: 0,
      max_len: 0,
    }).then(() => {
      console.log('Whisper warmup complete — model fully loaded');
    }).catch((err) => {
      console.warn('Whisper warmup transcription failed (non-critical):', err.message);
    })
  );
  transcribeChain = next.catch(() => {});
  return next;
}

module.exports = { loadModel, transcribe, warmup };
