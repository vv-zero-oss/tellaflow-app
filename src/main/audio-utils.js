const fs = require('fs');

function writeWavHeader(buffer, dataSize, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);          // PCM sub-chunk size
  buffer.writeUInt16LE(1, 20);           // AudioFormat: PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
}

// Float32 [-1, 1] → little-endian Int16 written straight into `target` at
// `byteOffset`. Uses a typed-array view instead of per-sample writeInt16LE,
// which is ~10x faster for multi-minute recordings.
function floatToInt16Into(pcmFloat32, target, byteOffset) {
  const out = new Int16Array(target.buffer, target.byteOffset + byteOffset, pcmFloat32.length);
  for (let i = 0; i < pcmFloat32.length; i++) {
    const s = pcmFloat32[i] > 1 ? 1 : pcmFloat32[i] < -1 ? -1 : pcmFloat32[i];
    out[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
  }
}

/**
 * Encodes a Float32Array of 16kHz mono PCM samples into a WAV Buffer.
 * Output is standard PCM WAV (16-bit, little-endian).
 */
function encodePcmToWav(pcmFloat32, sampleRate = 16000) {
  const dataSize = pcmFloat32.length * 2;
  // Buffer.alloc is zero-filled and 8-byte aligned at offset 0, so the Int16
  // view at byte 44 is correctly aligned.
  const buffer = Buffer.alloc(44 + dataSize);
  writeWavHeader(buffer, dataSize, sampleRate);
  floatToInt16Into(pcmFloat32, buffer, 44);
  return buffer;
}

/**
 * Decodes a 16-bit mono WAV file back to Float32Array PCM.
 * Inverse of encodePcmToWav — used for retry-transcription. Sizes are taken
 * from the file length, not the header, so partially written recordings from
 * a crash (header never patched) still decode.
 */
function decodeWavToPcm(filePath) {
  const buf = fs.readFileSync(filePath);

  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Invalid WAV file');
  }

  const dataOffset = 44;
  const numSamples = Math.floor((buf.length - dataOffset) / 2);
  if (numSamples <= 0) {
    throw new Error('WAV file contains no audio data');
  }

  const pcm = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const sample = buf.readInt16LE(dataOffset + i * 2);
    pcm[i] = sample / (sample < 0 ? 0x8000 : 0x7fff);
  }
  return pcm;
}

/**
 * Incrementally appends PCM to a WAV file on disk. Used for long recordings
 * and meetings so audio is durable while it is still being captured — if the
 * app dies, everything up to the last append survives and is adopted as a
 * recovered recording on next launch.
 */
function createWavWriter(filePath, sampleRate = 16000) {
  const fd = fs.openSync(filePath, 'w');
  const header = Buffer.alloc(44);
  writeWavHeader(header, 0, sampleRate);
  fs.writeSync(fd, header, 0, 44, 0);
  let dataBytes = 0;
  let closed = false;

  function append(pcmFloat32) {
    if (closed || !pcmFloat32 || pcmFloat32.length === 0) return;
    const chunk = Buffer.alloc(pcmFloat32.length * 2);
    floatToInt16Into(pcmFloat32, chunk, 0);
    fs.writeSync(fd, chunk, 0, chunk.length, 44 + dataBytes);
    dataBytes += chunk.length;
  }

  function finalize() {
    if (closed) return filePath;
    closed = true;
    try {
      const h = Buffer.alloc(44);
      writeWavHeader(h, dataBytes, sampleRate);
      fs.writeSync(fd, h, 0, 44, 0);
    } finally {
      fs.closeSync(fd);
    }
    return filePath;
  }

  return { append, finalize, get durationSec() { return dataBytes / 2 / sampleRate; }, path: filePath };
}

module.exports = { encodePcmToWav, decodeWavToPcm, createWavWriter };
