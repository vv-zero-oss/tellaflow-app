/**
 * Parakeet integration / smoke test.
 *
 * Verifies that:
 *  1. sherpa-onnx-node loads without errors.
 *  2. The downloaded Parakeet TDT int8 ONNX model files exist.
 *  3. Transcribing resources/test.mp3 produces text with ≥ 90% word accuracy
 *     compared to the known expected transcript.
 *
 * Run via:
 *   npm run test:integration
 *
 * The test is automatically skipped when the model files are absent
 * (i.e. the model has not been downloaded in the app yet).
 *
 * Model location (macOS):
 *   ~/Library/Application Support/tellaflow/models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const MP3_PATH = path.join(ROOT, 'resources', 'test.mp3');

const PARAKEET_DIR = path.join(
  os.homedir(),
  'Library', 'Application Support', 'tellaflow', 'models',
  'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8'
);

const MODEL_FILES = {
  encoder: path.join(PARAKEET_DIR, 'encoder.int8.onnx'),
  decoder: path.join(PARAKEET_DIR, 'decoder.int8.onnx'),
  joiner:  path.join(PARAKEET_DIR, 'joiner.int8.onnx'),
  tokens:  path.join(PARAKEET_DIR, 'tokens.txt'),
};

const EXPECTED_TRANSCRIPT =
  'Welcome to the new frontier where your voice becomes the interface to every interaction with machines.';

const MIN_WORD_ACCURACY = 0.9;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Decode an audio file to a 16 kHz mono Float32Array using ffmpeg.
 */
function decodeAudioToFloat32(audioPath) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-loglevel', 'error',
      '-i', audioPath,
      '-ar', '16000',
      '-ac', '1',
      '-f', 'f32le',
      'pipe:1',
    ],
    { maxBuffer: 50 * 1024 * 1024 }
  );

  if (result.error) {
    throw new Error(`ffmpeg spawn error: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`ffmpeg exited ${result.status}: ${result.stderr?.toString()}`);
  }

  const buf = result.stdout;
  const numSamples = Math.floor(buf.length / 4);
  const pcm = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    pcm[i] = buf.readFloatLE(i * 4);
  }
  return pcm;
}

/**
 * Calculates what fraction of the expected words appear in the transcript
 * (order-independent, case-insensitive, punctuation-stripped).
 */
function wordAccuracy(transcript, expected) {
  const tokenize = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(Boolean);

  const gotTokens = tokenize(transcript);
  const expTokens = tokenize(expected);

  const pool = [...gotTokens];
  let matched = 0;

  for (const word of expTokens) {
    const idx = pool.indexOf(word);
    if (idx !== -1) {
      matched++;
      pool.splice(idx, 1);
    }
  }

  return expTokens.length > 0 ? matched / expTokens.length : 0;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const modelFilesExist = Object.values(MODEL_FILES).every(fs.existsSync);
const mp3Exists = fs.existsSync(MP3_PATH);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe.skipIf(!modelFilesExist || !mp3Exists)(
  'parakeet smoke test (requires downloaded ONNX model)',
  () => {
    let recognizer;

    beforeAll(() => {
      let sherpa;
      try {
        sherpa = require('sherpa-onnx-node');
      } catch (err) {
        throw new Error(`Failed to load sherpa-onnx-node: ${err.message}`);
      }

      recognizer = new sherpa.OfflineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          transducer: {
            encoder: MODEL_FILES.encoder,
            decoder: MODEL_FILES.decoder,
            joiner:  MODEL_FILES.joiner,
          },
          tokens:     MODEL_FILES.tokens,
          numThreads: 4,
          provider:   'cpu',
          modelType:  'nemo_transducer',
          debug:      0,
        },
        decodingMethod: 'greedy_search',
      });

      console.log(`\nParakeet model loaded from: ${PARAKEET_DIR}`);
    });

    it('sherpa-onnx-node OfflineRecognizer loads without errors', () => {
      expect(recognizer).toBeDefined();
    });

    it(
      `transcribes test.mp3 with ≥${MIN_WORD_ACCURACY * 100}% word accuracy`,
      async () => {
        const pcm = decodeAudioToFloat32(MP3_PATH);
        expect(pcm.length).toBeGreaterThan(0);

        const durationSec = (pcm.length / 16000).toFixed(1);
        console.log(`\nAudio: ${durationSec}s @ 16 kHz mono (${pcm.length} samples)`);

        const stream = recognizer.createStream();
        try {
          stream.acceptWaveform({ samples: pcm, sampleRate: 16000 });
          recognizer.decode(stream);
          const result = recognizer.getResult(stream);
          const text = (result.text || '').trim();

          console.log(`Expected : "${EXPECTED_TRANSCRIPT}"`);
          console.log(`Got      : "${text}"`);

          const accuracy = wordAccuracy(text, EXPECTED_TRANSCRIPT);
          console.log(`Accuracy : ${(accuracy * 100).toFixed(1)}%`);

          expect(
            accuracy,
            `Word accuracy ${(accuracy * 100).toFixed(1)}% is below the required ${MIN_WORD_ACCURACY * 100}%.\n` +
              `Expected: "${EXPECTED_TRANSCRIPT}"\n` +
              `Got:      "${text}"`
          ).toBeGreaterThanOrEqual(MIN_WORD_ACCURACY);
        } finally {
          try { stream.free(); } catch {}
        }
      },
      120_000
    );
  }
);

// ─── Prerequisites (always run) ───────────────────────────────────────────────

describe('parakeet prerequisites', () => {
  it('all ONNX model files exist in tellaflow userData/models/', () => {
    for (const [name, filePath] of Object.entries(MODEL_FILES)) {
      expect(
        fs.existsSync(filePath),
        `Missing ${name}: ${filePath}\nDownload via Settings → Models → Parakeet`
      ).toBe(true);
    }
  });

  it('test.mp3 fixture exists in resources/', () => {
    expect(
      mp3Exists,
      `Test audio not found at: ${MP3_PATH}`
    ).toBe(true);
  });

  it('ffmpeg is available on PATH', () => {
    const result = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
    expect(result.status, 'ffmpeg not found — install it via: brew install ffmpeg').toBe(0);
  });
});
