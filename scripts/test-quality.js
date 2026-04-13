const fs = require('fs');
const path = require('path');

const wavPath = process.argv[2] || '/Users/mac/Downloads/harvard.wav';
const modelDir = path.join(__dirname, '..', 'resources', 'models');

function readWav(filePath) {
  const buf = fs.readFileSync(filePath);
  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);

  let dataOffset = 12;
  while (dataOffset < buf.length - 8) {
    const chunkId = buf.toString('ascii', dataOffset, dataOffset + 4);
    const chunkSize = buf.readUInt32LE(dataOffset + 4);
    if (chunkId === 'data') {
      dataOffset += 8;
      const pcmBuf = buf.slice(dataOffset, Math.min(dataOffset + chunkSize, buf.length));
      const numSamples = pcmBuf.length / (bitsPerSample / 8) / numChannels;
      const mono16k = new Float32Array(Math.floor(numSamples * 16000 / sampleRate));
      for (let i = 0; i < mono16k.length; i++) {
        const srcIdx = Math.floor(i * sampleRate / 16000);
        const byteOffset = srcIdx * numChannels * (bitsPerSample / 8);
        if (byteOffset + 1 < pcmBuf.length) {
          mono16k[i] = pcmBuf.readInt16LE(byteOffset) / 32768.0;
        }
      }
      return mono16k;
    }
    dataOffset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) dataOffset++;
  }
  throw new Error('No data chunk');
}

async function testWithParams(label, modelFile, extraParams) {
  const modelPath = path.join(modelDir, modelFile);
  if (!fs.existsSync(modelPath)) {
    console.log(`[${label}] SKIP - model not found: ${modelFile}`);
    return;
  }

  const platform = process.platform === 'darwin' ? 'mac' : process.platform;
  const nodePath = path.join(__dirname, '..', 'node_modules',
    '@kutalia', 'whisper-node-addon', 'dist',
    `${platform}-${process.arch}`, 'whisper.node');
  const { whisper } = require(nodePath);
  const { promisify } = require('util');
  const transcribeFn = promisify(whisper);

  const pcm = readWav(wavPath);
  console.log(`\n[${label}] Transcribing (${pcm.length} samples)...`);
  const start = Date.now();

  const opts = {
    model: modelPath,
    pcmf32: pcm,
    language: 'en',
    use_gpu: true,
    flash_attn: false,
    no_prints: true,
    comma_in_time: false,
    translate: false,
    no_timestamps: false,
    detect_language: false,
    audio_ctx: 0,
    max_len: 0,
    ...extraParams,
  };

  const result = await transcribeFn(opts);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  let text = '';
  if (result?.transcription) {
    text = result.transcription.map(s => s[2]).join(' ').trim();
  }
  console.log(`[${label}] ${elapsed}s → ${text}`);
}

async function main() {
  console.log('WAV:', wavPath);

  await testWithParams('small-default', 'ggml-small.bin', {});

  await testWithParams('small+prompt', 'ggml-small.bin', {
    initial_prompt: 'Ingredients: dark chocolate, cocoa solids, cocoa butter, emulsifier, soya lecithin, hydrogenated vegetable fats, iodized salt, refined wheat flour, milk solids, raising agent, natural identical flavouring substance.',
  });

  await testWithParams('medium-default', 'ggml-medium.bin', {});

  await testWithParams('medium+prompt', 'ggml-medium.bin', {
    initial_prompt: 'Ingredients: dark chocolate, cocoa solids, cocoa butter, emulsifier, soya lecithin, hydrogenated vegetable fats, iodized salt, refined wheat flour, milk solids, raising agent, natural identical flavouring substance.',
  });
}

main().catch(console.error);
