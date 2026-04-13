const path = require('path');
const fs = require('fs');

// ─── State ────────────────────────────────────────────────────────────────────

let llamaLib = null;
let model = null;
let voices = null;
let ort = null;
let onnxSession = null;
let phonemize = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function toPhones(text) {
  const phrases = await phonemize(text, 'en-us');
  // Normalize whitespace, same as Python: split + rejoin with single spaces
  return phrases.join(' ').split(/\s+/).filter(Boolean).join(' ');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init({ backbonePath, decoderPath, voicesDir }) {
  console.log('[neutts-worker] loading phonemizer (WASM)…');
  const phonemizerMod = await import('phonemizer');
  phonemize = phonemizerMod.phonemize;
  console.log('[neutts-worker] phonemizer ready');

  // Warm-up to initialize the WASM engine before first synthesis call
  await phonemize('hello world', 'en-us');
  console.log('[neutts-worker] phonemizer warmed up');

  console.log('[neutts-worker] loading backbone GGUF from:', backbonePath);
  if (!require('fs').existsSync(backbonePath)) throw new Error(`NeuTTS backbone not found at: ${backbonePath}`);
  const { getLlama } = await import('node-llama-cpp');
  llamaLib = await getLlama();
  model = await llamaLib.loadModel({ modelPath: backbonePath });
  console.log('[neutts-worker] backbone loaded');

  console.log('[neutts-worker] loading NeuCodec ONNX decoder from:', decoderPath);
  const { existsSync } = require('fs');
  if (!existsSync(decoderPath)) throw new Error(`NeuCodec decoder not found at: ${decoderPath}`);
  ort = require('onnxruntime-node');
  // Try CoreML (macOS GPU/ANE) first for a big speedup, fall back to CPU
  let sessionOpts;
  try {
    onnxSession = await ort.InferenceSession.create(decoderPath, {
      executionProviders: [
        { name: 'coreml', coreMlFlags: 0 },
        'cpu',
      ],
      graphOptimizationLevel: 'basic',
    });
    console.log('[neutts-worker] ONNX decoder loaded with CoreML provider');
    sessionOpts = 'coreml+cpu';
  } catch (coremlErr) {
    console.log('[neutts-worker] CoreML unavailable, using CPU only:', coremlErr.message);
    onnxSession = await ort.InferenceSession.create(decoderPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'basic',   // 'all' is very slow on large FP32 models
    });
    sessionOpts = 'cpu';
  }
  console.log('[neutts-worker] ONNX decoder ready (' + sessionOpts + ') — inputs:', onnxSession.inputNames, 'outputs:', onnxSession.outputNames);

  console.log('[neutts-worker] loading voice reference data from:', voicesDir);
  const voiceNames = ['dave', 'jo', 'greta', 'juliette', 'mateo'];
  voices = {};
  for (const name of voiceNames) {
    const fp = path.join(voicesDir, `${name}.json`);
    if (fs.existsSync(fp)) {
      voices[name] = JSON.parse(fs.readFileSync(fp, 'utf8'));
      console.log(`[neutts-worker] loaded voice "${name}" (${voices[name].codes.length} ref codes)`);
    }
  }

  // Pre-phonemize every voice's reference text once here so synthesis never has to do it
  console.log('[neutts-worker] pre-phonemizing voice reference texts…');
  for (const [name, v] of Object.entries(voices)) {
    v.refPhones = await toPhones(v.text);
    console.log(`[neutts-worker] voice "${name}" refPhones cached (${v.refPhones.length} chars)`);
  }

  process.send({ type: 'init-done' });
  console.log('[neutts-worker] all models ready');
}

// ─── Synthesis ────────────────────────────────────────────────────────────────

async function synthesize({ id, text, voiceName }) {
  console.log(`[neutts-worker] synthesize id=${id} voice=${voiceName} textLen=${text?.length}`);

  const voice = voices[voiceName] || voices['dave'];
  if (!voice) throw new Error(`Voice "${voiceName}" not found`);

  const refCodes = voice.codes;
  // refPhones is pre-computed at init time — skip re-phonemizing on every call
  const refPhones = voice.refPhones || await toPhones(voice.text);

  // Step 1: Phonemize input text only
  console.log(`[neutts-worker] phonemizing input text (${text.length} chars)…`);
  const inputPhones = await toPhones(text);
  console.log(`[neutts-worker] refPhones="${refPhones.slice(0, 60)}" inputPhones="${inputPhones.slice(0, 60)}"`);

  // Step 2: Build GGUF prompt (exact format from neutts._infer_ggml)
  const codesStr = refCodes.map(c => `<|speech_${c}|>`).join('');
  const prompt =
    `user: Convert the text to speech:<|TEXT_PROMPT_START|>${refPhones} ${inputPhones}` +
    `<|TEXT_PROMPT_END|>\nassistant:<|SPEECH_GENERATION_START|>${codesStr}`;

  console.log(`[neutts-worker] prompt length: ${prompt.length} chars, ref codes: ${refCodes.length}`);

  // Step 3: Run backbone via LlamaCompletion (fresh context per call)
  const { LlamaCompletion } = await import('node-llama-cpp');
    // Keep context small — we never need more than ref_codes + phonemes + 400 output tokens
    const ctx = await model.createContext({ contextSize: 2048 });
  let outputStr;
  try {
    const comp = new LlamaCompletion({ contextSequence: ctx.getSequence() });
    console.log(`[neutts-worker] running backbone inference…`);
    const t0 = Date.now();
    outputStr = await comp.generateCompletion(prompt, {
      stopGenerationTriggers: [{ text: '<|SPEECH_GENERATION_END|>' }],
      temperature: 1.0,
      topK: 50,
      maxTokens: 400,   // 400 ≈ 13 s of audio; keeps ONNX decode fast
    });
    console.log(`[neutts-worker] backbone done in ${Date.now() - t0}ms, output length: ${outputStr?.length}`);
  } finally {
    await ctx.dispose();
  }

  // Step 4: Extract codec token IDs
  const speechIds = [];
  const re = /<\|speech_(\d+)\|>/g;
  let m;
  while ((m = re.exec(outputStr)) !== null) {
    speechIds.push(parseInt(m[1], 10));
  }
  console.log(`[neutts-worker] extracted ${speechIds.length} codec token IDs`);

  if (speechIds.length === 0) {
    throw new Error('No speech tokens generated — backbone may not have understood the prompt');
  }

  // Step 5: Decode with NeuCodec ONNX
  console.log(`[neutts-worker] decoding ${speechIds.length} tokens with NeuCodec…`);
  const t1 = Date.now();
  const codesData = new Int32Array(speechIds);
  const codesTensor = new ort.Tensor('int32', codesData, [1, 1, speechIds.length]);
  const onnxResult = await onnxSession.run({ codes: codesTensor });
  const outputName = onnxSession.outputNames[0];
  const audioData = onnxResult[outputName].data; // Float32Array, shape [1,1,T] flattened
  console.log(`[neutts-worker] ONNX decode done in ${Date.now() - t1}ms, samples: ${audioData.length}`);

  // Convert to base64 for IPC transfer
  const pcmBase64 = Buffer.from(audioData.buffer, audioData.byteOffset, audioData.byteLength).toString('base64');

  process.send({ type: 'result', id, pcmBase64, sampleRate: 24000, samples: audioData.length });
  console.log(`[neutts-worker] sent result for chunk ${id} (${(audioData.length / 24000).toFixed(1)}s audio)`);
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

process.on('message', async (msg) => {
  try {
    if (msg.type === 'init') {
      await init(msg);
    } else if (msg.type === 'synthesize') {
      await synthesize(msg);
    }
  } catch (err) {
    console.error('[neutts-worker] error:', err.message, err.stack);
    if (msg.type === 'init') {
      process.send({ type: 'error', error: err.message });
    } else {
      process.send({ type: 'error', id: msg.id, error: err.message });
    }
  }
});
