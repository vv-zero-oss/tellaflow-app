import { describe, it, expect } from 'vitest';
import { encodePcmToWav } from '../../src/main/audio-utils.js';

// Helper: read a 32-bit LE uint from a Buffer
function readUInt32LE(buf, offset) {
  return buf.readUInt32LE(offset);
}

describe('encodePcmToWav', () => {
  it('returns a Buffer', () => {
    const pcm = new Float32Array(160);
    const result = encodePcmToWav(pcm);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('produces the correct total size (44 header + 2 bytes/sample)', () => {
    const numSamples = 320;
    const pcm = new Float32Array(numSamples);
    const result = encodePcmToWav(pcm);
    expect(result.length).toBe(44 + numSamples * 2);
  });

  it('starts with RIFF header', () => {
    const pcm = new Float32Array(160);
    const result = encodePcmToWav(pcm);
    expect(result.toString('ascii', 0, 4)).toBe('RIFF');
  });

  it('contains WAVE marker at offset 8', () => {
    const pcm = new Float32Array(160);
    const result = encodePcmToWav(pcm);
    expect(result.toString('ascii', 8, 12)).toBe('WAVE');
  });

  it('contains fmt  sub-chunk at offset 12', () => {
    const pcm = new Float32Array(160);
    const result = encodePcmToWav(pcm);
    expect(result.toString('ascii', 12, 16)).toBe('fmt ');
  });

  it('sets AudioFormat to PCM (1)', () => {
    const pcm = new Float32Array(160);
    const result = encodePcmToWav(pcm);
    expect(result.readUInt16LE(20)).toBe(1);
  });

  it('sets NumChannels to 1 (mono)', () => {
    const pcm = new Float32Array(160);
    const result = encodePcmToWav(pcm);
    expect(result.readUInt16LE(22)).toBe(1);
  });

  it('sets SampleRate to 16000 by default', () => {
    const pcm = new Float32Array(160);
    const result = encodePcmToWav(pcm);
    expect(readUInt32LE(result, 24)).toBe(16000);
  });

  it('accepts a custom sample rate', () => {
    const pcm = new Float32Array(160);
    const result = encodePcmToWav(pcm, 44100);
    expect(readUInt32LE(result, 24)).toBe(44100);
  });

  it('sets BitsPerSample to 16', () => {
    const pcm = new Float32Array(160);
    const result = encodePcmToWav(pcm);
    expect(result.readUInt16LE(34)).toBe(16);
  });

  it('clamps samples above 1.0 without throwing', () => {
    const pcm = new Float32Array([2.0, -3.0]);
    expect(() => encodePcmToWav(pcm)).not.toThrow();
    const wav = encodePcmToWav(pcm);
    const s0 = wav.readInt16LE(44);
    const s1 = wav.readInt16LE(46);
    expect(s0).toBe(0x7fff);  // clamped to +1 → 0x7FFF
    expect(s1).toBe(-0x8000); // clamped to -1 → -0x8000
  });

  it('encodes 0.0 as 0', () => {
    const pcm = new Float32Array([0.0]);
    const wav = encodePcmToWav(pcm);
    expect(wav.readInt16LE(44)).toBe(0);
  });

  it('encodes 1.0 as 0x7FFF', () => {
    const pcm = new Float32Array([1.0]);
    const wav = encodePcmToWav(pcm);
    expect(wav.readInt16LE(44)).toBe(0x7fff);
  });

  it('encodes -1.0 as -0x8000', () => {
    const pcm = new Float32Array([-1.0]);
    const wav = encodePcmToWav(pcm);
    expect(wav.readInt16LE(44)).toBe(-0x8000);
  });

  it('handles an empty PCM array (header-only WAV)', () => {
    const pcm = new Float32Array(0);
    const wav = encodePcmToWav(pcm);
    expect(wav.length).toBe(44);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  });

  it('writes correct RIFF chunk size (file size - 8)', () => {
    const numSamples = 100;
    const pcm = new Float32Array(numSamples);
    const wav = encodePcmToWav(pcm);
    const chunkSize = readUInt32LE(wav, 4);
    expect(chunkSize).toBe(wav.length - 8);
  });

  it('writes correct data sub-chunk size', () => {
    const numSamples = 100;
    const pcm = new Float32Array(numSamples);
    const wav = encodePcmToWav(pcm);
    const dataSize = readUInt32LE(wav, 40);
    expect(dataSize).toBe(numSamples * 2);
  });
});

// ─── createWavWriter / decodeWavToPcm (crash-durable recordings) ─────────────
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createWavWriter, decodeWavToPcm } from '../../src/main/audio-utils.js';

describe('createWavWriter', () => {
  const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-wav-')), 'r.wav');

  it('appends chunks and finalizes a valid WAV header', () => {
    const file = tmp();
    const w = createWavWriter(file);
    w.append(new Float32Array([0.5, -0.5]));
    w.append(new Float32Array([0.25]));
    w.finalize();
    const buf = fs.readFileSync(file);
    expect(buf.readUInt32LE(40)).toBe(6);
    expect(buf.readUInt32LE(4)).toBe(36 + 6);
    const pcm = decodeWavToPcm(file);
    expect(pcm.length).toBe(3);
    expect(pcm[0]).toBeCloseTo(0.5, 3);
    expect(pcm[2]).toBeCloseTo(0.25, 3);
    expect(w.durationSec).toBeCloseTo(3 / 16000);
  });

  it('a recording cut off by a crash (never finalized) still decodes', () => {
    const file = tmp();
    const w = createWavWriter(file);
    w.append(new Float32Array(1000).fill(0.1));
    // no finalize(): header still says 0 bytes of data
    const pcm = decodeWavToPcm(file);
    expect(pcm.length).toBe(1000);
  });

  it('encodePcmToWav round-trips through decodeWavToPcm', () => {
    const file = tmp();
    const src = new Float32Array([0, 1, -1, 0.123]);
    fs.writeFileSync(file, encodePcmToWav(src));
    const out = decodeWavToPcm(file);
    expect(out[1]).toBeCloseTo(1, 3);
    expect(out[2]).toBeCloseTo(-1, 3);
    expect(out[3]).toBeCloseTo(0.123, 3);
  });
});
