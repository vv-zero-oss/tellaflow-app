const fs = require('fs');
const path = require('path');

const wavPath = process.argv[2] || '/Users/mac/Downloads/harvard.wav';
const modelPath = path.join(__dirname, '..', 'resources', 'models', 'ggml-small.bin');

if (!fs.existsSync(wavPath)) {
  console.error('WAV file not found:', wavPath);
  process.exit(1);
}
if (!fs.existsSync(modelPath)) {
  console.error('Model not found:', modelPath);
  process.exit(1);
}

function readWav(filePath) {
  const buf = fs.readFileSync(filePath);

  const riff = buf.toString('ascii', 0, 4);
  if (riff !== 'RIFF') throw new Error('Not a RIFF file');

  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);

  console.log(`WAV: ${sampleRate}Hz, ${numChannels}ch, ${bitsPerSample}bit`);

  let dataOffset = 12;
  while (dataOffset < buf.length - 8) {
    const chunkId = buf.toString('ascii', dataOffset, dataOffset + 4);
    const chunkSize = buf.readUInt32LE(dataOffset + 4);
    if (chunkId === 'data') {
      dataOffset += 8;
      const dataEnd = Math.min(dataOffset + chunkSize, buf.length);
      const pcmBuf = buf.slice(dataOffset, dataEnd);

      const numSamples = pcmBuf.length / (bitsPerSample / 8) / numChannels;
      const mono16k = new Float32Array(Math.floor(numSamples * 16000 / sampleRate));

      for (let i = 0; i < mono16k.length; i++) {
        const srcIdx = Math.floor(i * sampleRate / 16000);
        const byteOffset = srcIdx * numChannels * (bitsPerSample / 8);
        if (byteOffset + 1 < pcmBuf.length) {
          const sample = pcmBuf.readInt16LE(byteOffset);
          mono16k[i] = sample / 32768.0;
        }
      }

      console.log(`Converted to ${mono16k.length} samples @ 16kHz (${(mono16k.length / 16000).toFixed(1)}s)`);
      return mono16k;
    }
    dataOffset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) dataOffset++;
  }
  throw new Error('No data chunk found in WAV');
}

async function main() {
  console.log('Loading WAV:', wavPath);
  const pcm = readWav(wavPath);

  console.log('Loading whisper addon...');
  const whisper = require('@kutalia/whisper-node-addon');

  console.log('Transcribing with model:', modelPath);
  const start = Date.now();

  const result = await whisper.transcribe({
    model: modelPath,
    pcmf32: pcm,
    use_gpu: true,
    language: 'en',
    n_threads: 4,
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s\n`);

  if (Array.isArray(result)) {
    const text = result.map(s => s.text).join(' ').trim();
    console.log('Transcription:', text);
  } else {
    console.log('Result:', JSON.stringify(result, null, 2));
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
