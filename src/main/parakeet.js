/**
 * Parakeet TDT 0.6b v2 transcription engine.
 *
 * Uses sherpa-onnx-node's OfflineRecognizer with the NVIDIA NeMo transducer
 * model (int8-quantised). The model must first be downloaded via
 * models.startParakeetDownload() — it extracts to:
 *   userData/models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/
 *
 * Input:  Float32Array of 16 kHz mono PCM (same format as Whisper pipeline)
 * Output: Transcribed string with punctuation and correct casing
 */

const os = require('os');
const { isParakeetAvailable, getParakeetFilePaths } = require('./models');

let recognizer = null;
let transcriptionCount = 0;

// ONNX Runtime's BFCArena memory allocator accumulates internal memory pools
// across inference runs without releasing them. On 8 GB machines this causes
// an OOM crash (EXC_BREAKPOINT in BFCArena::Extend) after ~30-60 min of use.
// Recycling the recognizer every N transcriptions forces ONNX to release its
// pools. The reload takes ~2-3 s — imperceptible between dictation sessions.
const RECYCLE_INTERVAL = 50;

function getThreadCount() {
  const totalMemGB = os.totalmem() / (1024 * 1024 * 1024);
  // On 8 GB machines, use 2 threads to halve ONNX working memory.
  // On 16 GB+, use 4 threads for best throughput.
  return totalMemGB <= 10 ? 2 : 4;
}

function loadModel() {
  if (!isParakeetAvailable()) {
    throw new Error('Parakeet model not downloaded. Please download it first in Settings → Models.');
  }

  let sherpa;
  try {
    sherpa = require('sherpa-onnx-node');
  } catch (e) {
    throw new Error('sherpa-onnx-node not available: ' + e.message);
  }

  const paths = getParakeetFilePaths();

  if (recognizer) {
    try { recognizer.free?.(); } catch {}
    recognizer = null;
  }

  const numThreads = getThreadCount();

  recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: paths.encoder,
        decoder: paths.decoder,
        joiner: paths.joiner,
      },
      tokens: paths.tokens,
      numThreads,
      provider: 'cpu',
      modelType: 'nemo_transducer',
      debug: 0,
    },
    decodingMethod: 'greedy_search',
  });

  transcriptionCount = 0;
  console.log(`Parakeet model loaded (threads=${numThreads}) from: ${paths.encoder}`);
}

function isLoaded() {
  return recognizer !== null;
}

function isAvailable() {
  return isParakeetAvailable();
}

async function transcribe(pcmFloat32Array) {
  // Recycle recognizer periodically to release ONNX BFCArena memory pools.
  // This prevents the OOM crash on low-RAM machines after prolonged use.
  // Done synchronously BEFORE the transcription — safe because this only
  // fires in the gap between dictation sessions (user must release hotkey,
  // think, and speak again).
  if (!recognizer || transcriptionCount >= RECYCLE_INTERVAL) {
    if (transcriptionCount >= RECYCLE_INTERVAL) {
      console.log(`Parakeet: recycling recognizer after ${transcriptionCount} transcriptions to free memory`);
    }
    loadModel();
  }

  let stream;
  try {
    stream = recognizer.createStream();
    stream.acceptWaveform({ samples: pcmFloat32Array, sampleRate: 16000 });
    recognizer.decode(stream);
    const result = recognizer.getResult(stream);
    transcriptionCount++;
    return (result.text || '').trim();
  } catch (err) {
    // If ONNX hits an allocation failure, recycle and retry once.
    if (err.message && (err.message.includes('alloc') || err.message.includes('memory') || err.message.includes('OOM'))) {
      console.warn('Parakeet: allocation failure, recycling recognizer and retrying:', err.message);
      try { stream?.free?.(); } catch {}
      stream = null; // prevent double-free in finally
      loadModel();
      stream = recognizer.createStream();
      stream.acceptWaveform({ samples: pcmFloat32Array, sampleRate: 16000 });
      recognizer.decode(stream);
      const result = recognizer.getResult(stream);
      transcriptionCount++;
      return (result.text || '').trim();
    }
    throw err;
  } finally {
    try { stream?.free?.(); } catch {}
  }
}

function free() {
  if (recognizer) {
    try { recognizer.free?.(); } catch {}
    recognizer = null;
  }
  transcriptionCount = 0;
}

module.exports = { loadModel, transcribe, isLoaded, isAvailable, free };
