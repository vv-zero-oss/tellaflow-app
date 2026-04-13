const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

const wavPath = process.argv[2] || '/Users/mac/Downloads/harvard.wav';
const whisperModelPath = path.join(__dirname, '..', 'resources', 'models', 'ggml-small.bin');
const grammarModelPath = path.join(__dirname, '..', 'resources', 'models', 'SmolLM2-135M-Instruct.Q8_0.gguf');

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
        if (byteOffset + 1 < pcmBuf.length) mono16k[i] = pcmBuf.readInt16LE(byteOffset) / 32768.0;
      }
      return mono16k;
    }
    dataOffset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) dataOffset++;
  }
  throw new Error('No data chunk found');
}

function runGrammarInChildProcess(text) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, '..', 'src', 'main', 'grammar-worker.js');
    const child = fork(workerPath, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });

    child.stdout.on('data', (d) => process.stdout.write(d));
    child.stderr.on('data', (d) => process.stderr.write(d));

    child.on('message', (msg) => {
      if (msg.type === 'init-done') {
        child.send({ type: 'correct', id: 1, text });
      } else if (msg.type === 'result') {
        resolve(msg.text);
        child.kill();
      } else if (msg.type === 'error') {
        reject(new Error(msg.error));
        child.kill();
      }
    });

    child.on('exit', (code) => {
      if (code !== 0 && code !== null) reject(new Error(`Worker exited with code ${code}`));
    });

    child.send({ type: 'init', modelPath: grammarModelPath });
  });
}

async function main() {
  console.log('=== End-to-End: Whisper + SmolLM2 Grammar (child process) ===\n');

  // Step 1: Whisper transcription
  console.log('1. Transcribing with Whisper...');
  const pcm = readWav(wavPath);
  const whisper = require('@kutalia/whisper-node-addon');

  const t1 = Date.now();
  const result = await whisper.transcribe({
    model: whisperModelPath,
    pcmf32: pcm,
    use_gpu: true,
    language: 'en',
    no_timestamps: true,
    flash_attn: false,
    no_prints: true,
    comma_in_time: false,
    translate: false,
    detect_language: false,
    audio_ctx: 0,
    max_len: 0,
  });
  const whisperTime = Date.now() - t1;

  let rawText = '';
  if (Array.isArray(result)) {
    rawText = result.map(s => (s.text || s[2] || '')).join(' ').trim();
  } else if (result?.transcription) {
    rawText = result.transcription.map(s => s[2]).join(' ').trim();
  }

  console.log(`   Whisper output (${whisperTime}ms):`);
  console.log(`   "${rawText}"\n`);

  // Step 2: Grammar correction in child process
  console.log('2. Correcting grammar with SmolLM2 (child process)...');
  const t2 = Date.now();
  const corrected = await runGrammarInChildProcess(rawText);
  const grammarTime = Date.now() - t2;

  console.log(`   Grammar output (${grammarTime}ms):`);
  console.log(`   "${corrected}"\n`);

  console.log('=== Summary ===');
  console.log(`Whisper:  ${whisperTime}ms`);
  console.log(`Grammar:  ${grammarTime}ms`);
  console.log(`Total:    ${whisperTime + grammarTime}ms`);

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
