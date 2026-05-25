/**
 * Spectral noise subtraction — pure JS, zero dependencies.
 *
 * Uses a radix-2 Cooley-Tukey FFT to decompose audio into frequency bins,
 * estimates the noise spectrum from a leading silent region, subtracts it
 * from each frame, then reconstructs via overlap-add IFFT.
 *
 * Input:  Float32Array of 16 kHz mono PCM
 * Output: Float32Array of denoised 16 kHz mono PCM (same length)
 */

'use strict';

const SAMPLE_RATE = 16000;
const FFT_SIZE = 512;           // 32ms window at 16 kHz
const HOP_SIZE = FFT_SIZE / 2;  // 50% overlap
const BINS = FFT_SIZE / 2 + 1;  // 257 frequency bins

// Over-subtraction factor: higher = more aggressive noise removal but
// higher risk of "musical noise" artifacts. 2.0 is a balanced default.
const OVER_SUBTRACT = 2.0;

// Spectral floor: after subtraction, no bin drops below this fraction
// of its original magnitude. Prevents musical noise chirping.
const SPECTRAL_FLOOR = 0.01;

// Noise profile frames: use this many frames from the start of audio
const NOISE_PROFILE_MS = 200;
const NOISE_PROFILE_FRAMES = Math.ceil((NOISE_PROFILE_MS / 1000) * SAMPLE_RATE / HOP_SIZE);

// ── Hann window ──────────────────────────────────────────────────────

const hannWindow = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
}

// ── Radix-2 Cooley-Tukey FFT ────────────────────────────────────────

function fft(re, im) {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  // Butterfly stages
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = -2 * Math.PI / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j;
        const b = a + half;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

function ifft(re, im) {
  const n = re.length;
  // Conjugate
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  // Conjugate and scale
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

// ── Spectral denoising ──────────────────────────────────────────────

function spectralDenoise(pcm) {
  if (!pcm || pcm.length < FFT_SIZE * 2) return pcm;

  const numFrames = Math.floor((pcm.length - FFT_SIZE) / HOP_SIZE) + 1;
  if (numFrames < 2) return pcm;

  // Allocate FFT buffers (reused across frames)
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);

  // ── Step 1: Estimate noise spectrum from leading frames ──
  const noiseFrames = Math.min(NOISE_PROFILE_FRAMES, Math.max(1, Math.floor(numFrames / 4)));
  const noiseSpectrum = new Float32Array(BINS);

  for (let f = 0; f < noiseFrames; f++) {
    const offset = f * HOP_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = (offset + i < pcm.length ? pcm[offset + i] : 0) * hannWindow[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < BINS; k++) {
      noiseSpectrum[k] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
  }
  // Average
  for (let k = 0; k < BINS; k++) {
    noiseSpectrum[k] /= noiseFrames;
  }

  // ── Step 2: Process each frame with spectral subtraction ──
  const output = new Float32Array(pcm.length);
  const windowSum = new Float32Array(pcm.length); // for overlap-add normalization

  for (let f = 0; f < numFrames; f++) {
    const offset = f * HOP_SIZE;

    // Window the frame
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = (offset + i < pcm.length ? pcm[offset + i] : 0) * hannWindow[i];
      im[i] = 0;
    }

    fft(re, im);

    // Subtract noise spectrum, preserving phase
    for (let k = 0; k < BINS; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const phase = Math.atan2(im[k], re[k]);

      // Spectral subtraction with floor
      let cleanMag = mag - OVER_SUBTRACT * noiseSpectrum[k];
      const floorMag = SPECTRAL_FLOOR * mag;
      if (cleanMag < floorMag) cleanMag = floorMag;

      re[k] = cleanMag * Math.cos(phase);
      im[k] = cleanMag * Math.sin(phase);

      // Mirror for real signal (except DC and Nyquist)
      if (k > 0 && k < BINS - 1) {
        re[FFT_SIZE - k] = re[k];
        im[FFT_SIZE - k] = -im[k];
      }
    }

    ifft(re, im);

    // Overlap-add with window
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = offset + i;
      if (idx < output.length) {
        output[idx] += re[i] * hannWindow[i];
        windowSum[idx] += hannWindow[i] * hannWindow[i];
      }
    }
  }

  // Normalize by window overlap sum. At the edges where few frames overlap,
  // the window sum is small and division would amplify noise — use the original
  // signal there instead.
  const minWindowSum = 0.1;
  for (let i = 0; i < output.length; i++) {
    if (windowSum[i] >= minWindowSum) {
      output[i] /= windowSum[i];
    } else {
      output[i] = pcm[i]; // fall back to original at edges
    }
  }

  return output;
}

module.exports = { spectralDenoise };
