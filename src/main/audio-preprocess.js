/**
 * Lightweight audio preprocessing for 16kHz Float32 PCM.
 * Pure JS, zero dependencies.
 *
 * Pipeline: trimSilence -> normalizeVolume -> (Whisper)
 */

const SAMPLE_RATE = 16000;
const FRAME_MS = 30;
const FRAME_SIZE = Math.floor(SAMPLE_RATE * FRAME_MS / 1000); // 480 samples per frame

// RMS threshold below which a frame is considered silence.
// Tuned for typical close-range microphone input.
const SILENCE_THRESHOLD = 0.01;

// Maximum silence gap to keep in the middle of speech (in seconds).
const MAX_INTERNAL_SILENCE_SEC = 0.3;
const MAX_INTERNAL_SILENCE_FRAMES = Math.ceil(
  (MAX_INTERNAL_SILENCE_SEC * 1000) / FRAME_MS
);

/**
 * Trim leading/trailing silence and compress long internal silence gaps.
 * Uses simple RMS energy-based voice activity detection.
 */
function trimSilence(pcm) {
  if (!pcm || pcm.length < FRAME_SIZE) return pcm;

  const numFrames = Math.floor(pcm.length / FRAME_SIZE);
  const frameEnergy = new Float32Array(numFrames);
  const isVoice = new Uint8Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const start = f * FRAME_SIZE;
    let sumSq = 0;
    for (let i = start; i < start + FRAME_SIZE; i++) {
      sumSq += pcm[i] * pcm[i];
    }
    frameEnergy[f] = Math.sqrt(sumSq / FRAME_SIZE);
    isVoice[f] = frameEnergy[f] >= SILENCE_THRESHOLD ? 1 : 0;
  }

  // Find first and last voiced frames
  let firstVoice = -1;
  let lastVoice = -1;
  for (let f = 0; f < numFrames; f++) {
    if (isVoice[f]) {
      if (firstVoice === -1) firstVoice = f;
      lastVoice = f;
    }
  }

  if (firstVoice === -1) return pcm; // all silence -- pass through for Whisper to decide

  // Build output: keep voiced frames and limit silence gaps
  const outFrames = [];
  let silenceRun = 0;

  for (let f = firstVoice; f <= lastVoice; f++) {
    if (isVoice[f]) {
      silenceRun = 0;
      outFrames.push(f);
    } else {
      silenceRun++;
      if (silenceRun <= MAX_INTERNAL_SILENCE_FRAMES) {
        outFrames.push(f);
      }
    }
  }

  const out = new Float32Array(outFrames.length * FRAME_SIZE);
  for (let i = 0; i < outFrames.length; i++) {
    const srcStart = outFrames[i] * FRAME_SIZE;
    out.set(pcm.subarray(srcStart, srcStart + FRAME_SIZE), i * FRAME_SIZE);
  }

  return out;
}

/**
 * Peak-normalize audio to a target amplitude.
 * Helps with quiet or inconsistent microphone input.
 */
function normalizeVolume(pcm, targetPeak = 0.9) {
  if (!pcm || pcm.length === 0) return pcm;

  let maxAbs = 0;
  for (let i = 0; i < pcm.length; i++) {
    const abs = Math.abs(pcm[i]);
    if (abs > maxAbs) maxAbs = abs;
  }

  if (maxAbs < 0.001) return pcm; // near-silence, don't amplify noise

  const gain = targetPeak / maxAbs;
  if (Math.abs(gain - 1.0) < 0.05) return pcm; // already close to target

  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = pcm[i] * gain;
  }
  return out;
}

module.exports = { trimSilence, normalizeVolume };
