/**
 * First-install smoke test.
 *
 * Runs once after the initial onboarding completes (or after a clean
 * reinstall that wipes userData).  Decodes resources/test.mp3, runs it
 * through the already-loaded Whisper model, and verifies that word
 * accuracy is ≥ MIN_ACCURACY.
 *
 * Failures are appended to <userData>/error-log.txt and logged to the
 * console but never throw — the app always continues normally.
 *
 * A flag file (<userData>/.smoke-test-done) is written on the first
 * successful pass so the test never runs again on subsequent launches.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const EXPECTED_TRANSCRIPT =
  'Welcome to the new frontier where your voice becomes the interface to every interaction with machines.';

const MIN_ACCURACY = 0.9;

// ─── helpers ──────────────────────────────────────────────────────────────────

function extractText(raw) {
  if (raw && raw.transcription && Array.isArray(raw.transcription)) {
    return raw.transcription.map((seg) => seg[2] ?? seg.text ?? '').join(' ').trim();
  }
  if (Array.isArray(raw)) {
    return raw.map((s) => s.text || s[2] || '').join(' ').trim();
  }
  return raw?.text?.trim() ?? '';
}

function wordAccuracy(transcript, expected) {
  const tokenize = (s) =>
    s.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);

  const got = tokenize(transcript);
  const exp = tokenize(expected);
  if (exp.length === 0) return 1;

  const pool = [...got];
  let matched = 0;
  for (const word of exp) {
    const idx = pool.indexOf(word);
    if (idx !== -1) { matched++; pool.splice(idx, 1); }
  }
  return matched / exp.length;
}

/**
 * Decode an audio file (MP3, WAV, …) to 16 kHz mono Float32Array using ffmpeg.
 * Returns null when ffmpeg is not on PATH or decoding fails.
 */
function decodeWithFfmpeg(audioPath) {
  let result;
  try {
    result = spawnSync(
      'ffmpeg',
      [
        '-loglevel', 'error',
        '-i', audioPath,
        '-ar', '16000',
        '-ac', '1',
        '-f', 'f32le',
        'pipe:1',
      ],
      { maxBuffer: 50 * 1024 * 1024, timeout: 30_000 }
    );
  } catch {
    return null;
  }

  if (result.error || result.status !== 0) return null;

  const buf = result.stdout;
  const numSamples = Math.floor(buf.length / 4);
  if (numSamples === 0) return null;

  const pcm = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    pcm[i] = buf.readFloatLE(i * 4);
  }
  return pcm;
}

function appendErrorLog(logPath, message) {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] STARTUP_SMOKE_TEST: ${message}\n`, 'utf8');
  } catch (e) {
    console.error('[smoke-test] Could not write error log:', e.message);
  }
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string}   opts.userDataPath  - app.getPath('userData')
 * @param {string}   opts.audioPath     - absolute path to resources/test.mp3
 * @param {Function} opts.transcribeFn  - whisper.transcribe (accepts Float32Array, returns Promise<string>)
 */
async function runStartupSmokeTest({ userDataPath, audioPath, transcribeFn }) {
  const flagFile = path.join(userDataPath, '.smoke-test-done');
  const logFile  = path.join(userDataPath, 'error-log.txt');

  // ── already ran and passed ────────────────────────────────────────────────
  if (fs.existsSync(flagFile)) return;

  console.log('[smoke-test] Running first-install transcription smoke test…');

  // ── decode MP3 → 16 kHz mono float32 ─────────────────────────────────────
  const pcm = decodeWithFfmpeg(audioPath);
  if (!pcm) {
    const msg =
      'ffmpeg not found or failed — cannot decode test.mp3.  ' +
      'Install ffmpeg (brew install ffmpeg) to enable the startup smoke test.';
    console.warn(`[smoke-test] ${msg}`);
    appendErrorLog(logFile, msg);
    return;  // skip gracefully; do NOT write flagFile so it retries next launch
  }

  // ── transcribe ────────────────────────────────────────────────────────────
  let transcript = '';
  try {
    transcript = await transcribeFn(pcm);
  } catch (err) {
    const msg = `Transcription threw: ${err.message}`;
    console.error(`[smoke-test] ${msg}`);
    appendErrorLog(logFile, msg);
    return;  // do not flag as done — will retry on next launch
  }

  // ── accuracy check ────────────────────────────────────────────────────────
  const accuracy = wordAccuracy(transcript, EXPECTED_TRANSCRIPT);
  const pct = (accuracy * 100).toFixed(1);

  console.log(`[smoke-test] transcript : "${transcript}"`);
  console.log(`[smoke-test] accuracy   : ${pct}%`);

  if (accuracy < MIN_ACCURACY) {
    const msg =
      `Word accuracy ${pct}% is below the required ${MIN_ACCURACY * 100}%. ` +
      `Expected: "${EXPECTED_TRANSCRIPT}" — Got: "${transcript}"`;
    console.error(`[smoke-test] FAILED — ${msg}`);
    appendErrorLog(logFile, msg);
    // Still write the flag so we don't spam the log on every launch.
    // A human can check error-log.txt to investigate.
  } else {
    console.log('[smoke-test] PASSED ✓');
  }

  // Mark as complete regardless of pass/fail so we only log once.
  try {
    fs.writeFileSync(flagFile, new Date().toISOString(), 'utf8');
  } catch (e) {
    console.error('[smoke-test] Could not write flag file:', e.message);
  }
}

module.exports = { runStartupSmokeTest, decodeWithFfmpeg };
