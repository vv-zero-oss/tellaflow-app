/**
 * Whisper integration / smoke test.
 *
 * Verifies that:
 *  1. The native whisper addon loads without errors.
 *  2. The bundled ggml-small.bin model exists.
 *  3. Transcribing resources/test.mp3 produces text with ≥ 90% word accuracy
 *     compared to the known expected transcript.
 *
 * Run via:
 *   npm run test:integration
 *
 * The test is automatically skipped when the model file is absent
 * (e.g. fresh checkout before first run).
 *
 * DYLD_LIBRARY_PATH must be set before the process starts — the npm script
 * in package.json handles this automatically.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const MODEL_PATH = path.join(ROOT, 'resources', 'models', 'ggml-small.bin');
const MP3_PATH = path.join(ROOT, 'resources', 'test.mp3');

const EXPECTED_TRANSCRIPT =
  'Welcome to the new frontier where your voice becomes the interface to every interaction with machines.';

const MIN_WORD_ACCURACY = 0.9;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Decode an audio file (MP3, WAV, etc.) to a 16 kHz mono Float32Array using ffmpeg.
 * Outputs raw 32-bit float little-endian PCM.
 */
function decodeAudioToFloat32(audioPath) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-loglevel', 'error',
      '-i', audioPath,
      '-ar', '16000',   // 16 kHz
      '-ac', '1',       // mono
      '-f', 'f32le',    // raw float32 little-endian
      'pipe:1',         // write to stdout
    ],
    { maxBuffer: 50 * 1024 * 1024 }  // 50 MB — enough for several minutes of audio
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
 * Extracts transcript text from the raw value returned by the whisper addon.
 * The addon can return several different shapes depending on options.
 */
function extractText(result) {
  if (result && result.transcription && Array.isArray(result.transcription)) {
    return result.transcription.map((seg) => seg[2] ?? seg.text ?? '').join(' ').trim();
  }
  if (Array.isArray(result)) {
    return result.map((s) => s.text || s[2] || '').join(' ').trim();
  }
  return result?.text?.trim() ?? '';
}

/**
 * Calculates what fraction of the expected words appear in the transcript
 * (order-independent, case-insensitive, punctuation-stripped).
 *
 * Returns a value in [0, 1].
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

const modelExists = fs.existsSync(MODEL_PATH);
const mp3Exists = fs.existsSync(MP3_PATH);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe.skipIf(!modelExists || !mp3Exists)(
  'whisper smoke test (requires bundled ggml-small.bin)',
  () => {
    let transcribe;

    beforeAll(() => {
      // Load the native addon.  DYLD_LIBRARY_PATH must already be set (done by
      // the npm script) so the linked .dylib files can be resolved.
      try {
        ({ transcribe } = require('@kutalia/whisper-node-addon'));
      } catch (err) {
        throw new Error(
          `Failed to load whisper addon — is DYLD_LIBRARY_PATH set?\n${err.message}`
        );
      }
    });

    it('addon loads without errors', () => {
      expect(typeof transcribe).toBe('function');
    });

    it(
      `transcribes test.mp3 with ≥${MIN_WORD_ACCURACY * 100}% word accuracy`,
      async () => {
        // 1. Decode MP3 → 16 kHz mono float32 PCM
        const pcm = decodeAudioToFloat32(MP3_PATH);
        expect(pcm.length).toBeGreaterThan(0);

        const durationSec = (pcm.length / 16000).toFixed(1);
        console.log(`\nAudio: ${durationSec}s @ 16 kHz mono (${pcm.length} samples)`);

        // 2. Run transcription
        const raw = await transcribe({
          model: MODEL_PATH,
          pcmf32: pcm,
          language: 'en',
          use_gpu: true,
          flash_attn: false,
          no_prints: true,
          no_timestamps: true,
          detect_language: false,
          translate: false,
          audio_ctx: 0,
          max_len: 0,
        });

        // 3. Extract text
        const text = extractText(raw);

        console.log(`Expected : "${EXPECTED_TRANSCRIPT}"`);
        console.log(`Got      : "${text}"`);

        // 4. Calculate and assert word accuracy
        const accuracy = wordAccuracy(text, EXPECTED_TRANSCRIPT);
        console.log(`Accuracy : ${(accuracy * 100).toFixed(1)}%`);

        expect(
          accuracy,
          `Word accuracy ${(accuracy * 100).toFixed(1)}% is below the required ${MIN_WORD_ACCURACY * 100}%.\n` +
            `Expected: "${EXPECTED_TRANSCRIPT}"\n` +
            `Got:      "${text}"`
        ).toBeGreaterThanOrEqual(MIN_WORD_ACCURACY);
      },
      120_000  // up to 2 minutes — small model on first run can be slow
    );
  }
);

// ─── Model / file existence assertions (always run) ──────────────────────────

describe('whisper prerequisites', () => {
  it('bundled ggml-small.bin model exists in resources/models/', () => {
    expect(
      modelExists,
      `Model not found at: ${MODEL_PATH}\nRun: npm run download-model`
    ).toBe(true);
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
