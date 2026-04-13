/**
 * Encodes a Float32Array of 16kHz mono PCM samples into a WAV Buffer.
 * Output is standard PCM WAV (16-bit, little-endian).
 */
function encodePcmToWav(pcmFloat32, sampleRate = 16000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const numSamples = pcmFloat32.length;
  const dataSize = numSamples * blockAlign;
  const bufferSize = 44 + dataSize;

  const buffer = Buffer.alloc(bufferSize);
  let offset = 0;

  // RIFF chunk descriptor
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;

  // fmt sub-chunk
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4;          // PCM sub-chunk size
  buffer.writeUInt16LE(1, offset); offset += 2;           // AudioFormat: PCM
  buffer.writeUInt16LE(numChannels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(byteRate, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;

  // data sub-chunk
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcmFloat32[i]));
    const sample = s < 0 ? s * 0x8000 : s * 0x7fff;
    buffer.writeInt16LE(Math.round(sample), offset);
    offset += 2;
  }

  return buffer;
}

module.exports = { encodePcmToWav };
