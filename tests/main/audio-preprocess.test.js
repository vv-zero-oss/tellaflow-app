import { describe, it, expect } from 'vitest';
import { trimSilence, normalizeVolume } from '../../src/main/audio-preprocess.js';

// Constants mirrored from the module under test
const SAMPLE_RATE = 16000;
const FRAME_MS = 30;
const FRAME_SIZE = Math.floor(SAMPLE_RATE * FRAME_MS / 1000); // 480

// Helpers

function silentPcm(frames) {
  return new Float32Array(frames * FRAME_SIZE); // all zeros
}

function loudPcm(frames, amplitude = 0.5) {
  const pcm = new Float32Array(frames * FRAME_SIZE);
  // Generate a sine wave so the signal has realistic zero-crossing rate
  // (a constant fill has ZCR=0 and would fail the improved VAD).
  const freq = 200; // Hz — typical speech fundamental
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = amplitude * Math.sin(2 * Math.PI * freq * i / SAMPLE_RATE);
  }
  return pcm;
}

function concat(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

// ─── trimSilence ─────────────────────────────────────────────────────────────

describe('trimSilence', () => {
  it('returns the input unchanged when shorter than one frame', () => {
    const tiny = new Float32Array(100);
    tiny.fill(0.5);
    const result = trimSilence(tiny);
    expect(result).toBe(tiny);
  });

  it('passes through all-silence audio (Whisper decides)', () => {
    const pcm = silentPcm(10);
    const result = trimSilence(pcm);
    expect(result).toBe(pcm);
  });

  it('trims leading silence frames', () => {
    const leading = silentPcm(5);
    const speech = loudPcm(3);
    const input = concat(leading, speech);

    const result = trimSilence(input);
    expect(result.length).toBeLessThan(input.length);
    expect(result.length).toBe(speech.length);
  });

  it('trims trailing silence frames', () => {
    // 8 frames of leading silence covers the 200ms noise estimation window
    const leading = silentPcm(8);
    const speech = loudPcm(3);
    const trailing = silentPcm(5);
    const input = concat(leading, speech, trailing);

    const result = trimSilence(input);
    expect(result.length).toBeLessThan(input.length);
    expect(result.length).toBe(speech.length);
  });

  it('trims both leading and trailing silence', () => {
    const input = concat(silentPcm(4), loudPcm(2), silentPcm(4));
    const result = trimSilence(input);
    expect(result.length).toBe(loudPcm(2).length);
  });

  it('preserves short internal silence (≤ MAX_INTERNAL_SILENCE)', () => {
    // MAX_INTERNAL_SILENCE = ceil(300ms / 30ms) = 10 frames
    const speech1 = loudPcm(3);
    const shortGap = silentPcm(2); // 2 frames — under threshold
    const speech2 = loudPcm(3);
    const input = concat(speech1, shortGap, speech2);

    const result = trimSilence(input);
    expect(result.length).toBe(input.length);
  });

  it('compresses long internal silence gaps', () => {
    // 8 frames of leading silence covers the 200ms noise estimation window
    const leading = silentPcm(8);
    const speech1 = loudPcm(3);
    const longGap = silentPcm(15); // 15 frames — over threshold
    const speech2 = loudPcm(3);
    const input = concat(leading, speech1, longGap, speech2);

    const result = trimSilence(input);
    expect(result.length).toBeLessThan(input.length);
  });
});

// ─── normalizeVolume ──────────────────────────────────────────────────────────

describe('normalizeVolume', () => {
  it('returns the input unchanged for null/undefined', () => {
    expect(normalizeVolume(null)).toBeNull();
    expect(normalizeVolume(undefined)).toBeUndefined();
  });

  it('returns the input unchanged for an empty array', () => {
    const empty = new Float32Array(0);
    expect(normalizeVolume(empty)).toBe(empty);
  });

  it('returns the input unchanged when peak is near zero (noise protection)', () => {
    const nearSilence = new Float32Array(10).fill(0.0005);
    const result = normalizeVolume(nearSilence);
    expect(result).toBe(nearSilence);
  });

  it('returns the input unchanged when already close to target (gain ≈ 1)', () => {
    const pcm = new Float32Array(10).fill(0.88); // peak 0.88, target 0.9 → gain ≈ 1.02, within 5%
    const result = normalizeVolume(pcm);
    expect(result).toBe(pcm);
  });

  it('normalizes a quiet signal to the target peak', () => {
    const pcm = new Float32Array(10).fill(0.1); // peak 0.1
    const targetPeak = 0.9;
    const result = normalizeVolume(pcm, targetPeak);

    const maxAbs = Math.max(...result.map(Math.abs));
    expect(maxAbs).toBeCloseTo(targetPeak, 5);
  });

  it('normalizes a loud signal down to the target peak', () => {
    const pcm = new Float32Array([0.95, -0.95, 0.5]);
    const targetPeak = 0.5;
    const result = normalizeVolume(pcm, targetPeak);

    const maxAbs = Math.max(...result.map(Math.abs));
    expect(maxAbs).toBeCloseTo(targetPeak, 5);
  });

  it('uses 0.9 as the default target peak', () => {
    const pcm = new Float32Array(10).fill(0.1);
    const result = normalizeVolume(pcm);
    const maxAbs = Math.max(...result.map(Math.abs));
    expect(maxAbs).toBeCloseTo(0.9, 5);
  });

  it('returns a new Float32Array (does not mutate input)', () => {
    const pcm = new Float32Array(10).fill(0.1);
    const result = normalizeVolume(pcm);
    expect(result).not.toBe(pcm);
    expect(pcm[0]).toBeCloseTo(0.1, 5); // original unchanged
  });
});
