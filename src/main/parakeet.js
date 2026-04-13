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

const { isParakeetAvailable, getParakeetFilePaths } = require('./models');

let recognizer = null;

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

  recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: paths.encoder,
        decoder: paths.decoder,
        joiner: paths.joiner,
      },
      tokens: paths.tokens,
      numThreads: 4,
      provider: 'cpu',
      modelType: 'nemo_transducer',
      debug: 0,
    },
    decodingMethod: 'greedy_search',
  });

  console.log('Parakeet model loaded from:', paths.encoder);
}

function isLoaded() {
  return recognizer !== null;
}

function isAvailable() {
  return isParakeetAvailable();
}

async function transcribe(pcmFloat32Array) {
  if (!recognizer) {
    loadModel();
  }

  const stream = recognizer.createStream();
  try {
    stream.acceptWaveform({ samples: pcmFloat32Array, sampleRate: 16000 });
    recognizer.decode(stream);
    const result = recognizer.getResult(stream);
    return (result.text || '').trim();
  } finally {
    try { stream.free(); } catch {}
  }
}

function free() {
  if (recognizer) {
    try { recognizer.free?.(); } catch {}
    recognizer = null;
  }
}

module.exports = { loadModel, transcribe, isLoaded, isAvailable, free };
