/**
 * Lightweight audio preprocessing for 16kHz Float32 PCM.
 * Pure JS, zero dependencies.
 *
 * Pipeline: estimateNoiseFloor -> softNoiseGate -> trimSilence -> normalizeVolume -> (Whisper)
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
 * Estimate the noise floor from the first 200ms of audio.
 * Returns an adaptive RMS threshold (at least 0.005) based on the median
 * frame energy in the initial segment. Falls back to SILENCE_THRESHOLD
 * when the audio is too short for a reliable estimate.
 */
function estimateNoiseFloor(pcm) {
  if (!pcm || pcm.length < FRAME_SIZE) return SILENCE_THRESHOLD;

  const sampleWindow = Math.min(pcm.length, Math.floor(0.2 * SAMPLE_RATE)); // 200ms
  const numFrames = Math.floor(sampleWindow / FRAME_SIZE);
  if (numFrames === 0) return SILENCE_THRESHOLD;

  const energies = [];
  for (let f = 0; f < numFrames; f++) {
    const start = f * FRAME_SIZE;
    let sumSq = 0;
    for (let i = start; i < start + FRAME_SIZE; i++) {
      sumSq += pcm[i] * pcm[i];
    }
    energies.push(Math.sqrt(sumSq / FRAME_SIZE));
  }

  energies.sort((a, b) => a - b);
  const median = energies[Math.floor(energies.length / 2)];
  return Math.max(median * 2.5, 0.005);
}

/**
 * Trim leading/trailing silence and compress long internal silence gaps.
 * Uses adaptive RMS energy + zero-crossing rate for voice activity detection.
 */
function trimSilence(pcm) {
  if (!pcm || pcm.length < FRAME_SIZE) return pcm;

  const adaptiveThreshold = estimateNoiseFloor(pcm);
  const numFrames = Math.floor(pcm.length / FRAME_SIZE);
  const frameEnergy = new Float32Array(numFrames);
  const isVoice = new Uint8Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const start = f * FRAME_SIZE;
    let sumSq = 0;
    let zeroCrossings = 0;
    for (let i = start; i < start + FRAME_SIZE; i++) {
      sumSq += pcm[i] * pcm[i];
      if (i > start && ((pcm[i] >= 0) !== (pcm[i - 1] >= 0))) {
        zeroCrossings++;
      }
    }
    frameEnergy[f] = Math.sqrt(sumSq / FRAME_SIZE);
    const hasEnergy = frameEnergy[f] >= adaptiveThreshold;
    const hasVoicelikeZCR = zeroCrossings >= 5 && zeroCrossings <= 80;
    isVoice[f] = (hasEnergy && hasVoicelikeZCR) ? 1 : 0;
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
 * Soft noise gate that attenuates frames below the noise floor.
 * Frames with RMS above gateThreshold (1.5x noiseFloor) pass through
 * unchanged. Frames at or below the noiseFloor are reduced to gateRatio
 * (10%). Frames in between are linearly interpolated.
 */
function softNoiseGate(pcm, noiseFloor) {
  if (!pcm || pcm.length < FRAME_SIZE || noiseFloor <= 0) return pcm;

  const out = new Float32Array(pcm.length);
  const numFrames = Math.floor(pcm.length / FRAME_SIZE);
  const gateThreshold = noiseFloor * 1.5;
  const gateRatio = 0.1;

  for (let f = 0; f < numFrames; f++) {
    const start = f * FRAME_SIZE;
    let sumSq = 0;
    for (let i = start; i < start + FRAME_SIZE; i++) {
      sumSq += pcm[i] * pcm[i];
    }
    const rms = Math.sqrt(sumSq / FRAME_SIZE);

    let gain;
    if (rms >= gateThreshold) {
      gain = 1.0;
    } else if (rms <= noiseFloor) {
      gain = gateRatio;
    } else {
      gain = gateRatio + (1.0 - gateRatio) * (rms - noiseFloor) / (gateThreshold - noiseFloor);
    }

    for (let i = start; i < start + FRAME_SIZE; i++) {
      out[i] = pcm[i] * gain;
    }
  }

  // Copy remaining samples unchanged
  const tailStart = numFrames * FRAME_SIZE;
  for (let i = tailStart; i < pcm.length; i++) {
    out[i] = pcm[i];
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

module.exports = { trimSilence, normalizeVolume, estimateNoiseFloor, softNoiseGate };
