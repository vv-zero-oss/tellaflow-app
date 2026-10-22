/**
 * Engine host — runs inside the transcription worker process.
 *
 * Owns the native Whisper / Parakeet engines so that a native crash or an
 * out-of-memory abort takes down only the worker, never the Electron main
 * process. Everything it needs (model paths, addon dir, thread count, prompt)
 * arrives in the job `spec`, so this module never touches Electron APIs and
 * can be unit-tested with fake engines.
 *
 * Message protocol (parent → worker):
 *   { type: 'load', spec }                    preload the engine/model
 *   { type: 'transcribe', id, spec, pcm }     transcribe Float32Array PCM
 *   { type: 'ping', id }
 * Worker → parent:
 *   { type: 'ready' }
 *   { type: 'loaded', engine, ms, rss }
 *   { type: 'result', id, text, ms, rss }
 *   { type: 'error', id, error, rss }
 *   { type: 'pong', id, rss }
 */

const SAMPLE_RATE = 16000;
// Whisper's encoder always sees a 30 s window (1500 context frames, 50 per
// second). Shrinking it for short clips cuts encoder time roughly in
// proportion. Below ~10 s of context Whisper starts hallucinating, so we keep
// a floor and add one second of headroom.
const FULL_AUDIO_CTX = 1500;
const MIN_AUDIO_CTX = 512;

function computeAudioCtx(numSamples) {
  const seconds = numSamples / SAMPLE_RATE;
  if (!isFinite(seconds) || seconds <= 0 || seconds >= 28) return 0; // 0 = model default
  const ctx = Math.ceil((seconds + 1) * 50);
  return Math.min(FULL_AUDIO_CTX, Math.max(MIN_AUDIO_CTX, ctx));
}

function buildWhisperOptions(spec, pcm) {
  const opts = {
    model: spec.modelPath,
    pcmf32: pcm,
    language: spec.language || 'en',
    use_gpu: true,
    flash_attn: false,
    no_prints: true,
    comma_in_time: false,
    translate: !!spec.translate,
    no_timestamps: true,
    detect_language: false,
    audio_ctx: computeAudioCtx(pcm.length),
    max_len: 0,
  };
  if (spec.numThreads > 0) opts.n_threads = spec.numThreads;
  // The addon reads whisper.cpp's `prompt` field (initial prompt). Keep it
  // short: whisper only uses the last ~224 tokens and long prompts slow decode.
  if (spec.prompt) opts.prompt = String(spec.prompt).slice(0, 600);
  return opts;
}

// A shrunk encoder window makes Whisper loop on some short clips: it writes
// the sentence, then writes it again ("The army found… The army found…").
// Any 8-word run that appears twice is taken as that loop (real dictation
// rarely repeats that much) and the clip is transcribed again with the full
// window, which fixes it. A loop that survives the full window is cut back to
// one copy — only back-to-back repeats, so a phrase said twice apart is kept.
const LOOP_NGRAM = 8;
const MIN_COLLAPSE_SPAN = 6;
const MIN_WHOLE_REPEAT_SPAN = 3;

const normWord = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

function hasRepetitionLoop(text) {
  const words = String(text || '').split(/\s+/).map(normWord).filter(Boolean);
  if (words.length >= 2 * MIN_WHOLE_REPEAT_SPAN && wholeTextRepeatSpan(words) > 0) return true;
  const firstAt = new Map();
  for (let i = 0; i + LOOP_NGRAM <= words.length; i++) {
    const key = words.slice(i, i + LOOP_NGRAM).join(' ');
    const prev = firstAt.get(key);
    if (prev === undefined) firstAt.set(key, i);
    else if (i - prev >= LOOP_NGRAM) return true; // non-overlapping second copy
  }
  return false;
}

// The span length if the whole text is one span written two or more times.
function wholeTextRepeatSpan(words) {
  for (let span = MIN_WHOLE_REPEAT_SPAN; span <= words.length / 2; span++) {
    if (words.length % span) continue;
    if (words.every((w, i) => w === words[i % span])) return span;
  }
  return 0;
}

function collapseRepetitions(text) {
  const tokens = String(text || '').split(/\s+/).filter(Boolean);
  const words = tokens.map(normWord);
  const same = (a, b, n) => {
    for (let k = 0; k < n; k++) if (!words[a + k] || words[a + k] !== words[b + k]) return false;
    return true;
  };
  const whole = wholeTextRepeatSpan(words);
  if (whole) return tokens.slice(0, whole).join(' ');
  for (let i = 0; i < tokens.length; i++) {
    for (let span = Math.floor((tokens.length - i) / 2); span >= MIN_COLLAPSE_SPAN; span--) {
      while (same(i, i + span, span)) {
        tokens.splice(i + span, span);
        words.splice(i + span, span);
      }
    }
  }
  return tokens.join(' ');
}

function whisperResultToText(result) {
  let text = '';
  if (result && Array.isArray(result.transcription)) {
    text = result.transcription.map((seg) => (Array.isArray(seg) ? seg[2] : seg) || '').join(' ');
  } else if (Array.isArray(result)) {
    text = result.map((s) => (s.text || s[2] || '')).join(' ');
  } else {
    text = result?.text || '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

function createEngineHost({ loadWhisperAddon, loadSherpa, now = () => Date.now(), memoryUsage = () => process.memoryUsage() }) {
  let whisperFn = null;
  let whisperAddonDir = null;
  let recognizer = null;
  let recognizerKey = null;

  function rss() {
    try { return memoryUsage().rss; } catch { return 0; }
  }

  function ensureWhisper(spec) {
    if (!spec.modelPath) throw new Error('Whisper model not found. Download one in Settings → Models.');
    if (!whisperFn || whisperAddonDir !== spec.addonDir) {
      whisperFn = loadWhisperAddon(spec.addonDir);
      whisperAddonDir = spec.addonDir;
    }
    return whisperFn;
  }

  function freeRecognizer() {
    if (recognizer) {
      try { recognizer.free?.(); } catch {}
    }
    recognizer = null;
    recognizerKey = null;
  }

  function ensureParakeet(spec) {
    const p = spec.parakeetPaths;
    if (!p || !p.encoder) throw new Error('Parakeet model not downloaded. Download it in Settings → Models.');
    const key = `${p.encoder}|${spec.numThreads}`;
    if (recognizer && recognizerKey === key) return recognizer;
    freeRecognizer();
    const sherpa = loadSherpa();
    recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: p.encoder, decoder: p.decoder, joiner: p.joiner },
        tokens: p.tokens,
        numThreads: spec.numThreads > 0 ? spec.numThreads : 2,
        provider: 'cpu',
        modelType: 'nemo_transducer',
        debug: 0,
      },
      decodingMethod: 'greedy_search',
    });
    recognizerKey = key;
    return recognizer;
  }

  async function load(spec) {
    const t0 = now();
    if (spec.engine === 'parakeet') {
      ensureParakeet(spec);
    } else {
      const fn = ensureWhisper(spec);
      // A tiny silent clip forces whisper.cpp to mmap the model and init Metal.
      await fn(buildWhisperOptions(spec, new Float32Array(SAMPLE_RATE / 2)));
    }
    return { engine: spec.engine, ms: now() - t0, rss: rss() };
  }

  async function transcribe(spec, pcm) {
    if (!(pcm instanceof Float32Array)) pcm = new Float32Array(pcm || []);
    if (pcm.length === 0) return '';
    if (spec.engine === 'parakeet') {
      const rec = ensureParakeet(spec);
      let stream = null;
      try {
        stream = rec.createStream();
        stream.acceptWaveform({ samples: pcm, sampleRate: SAMPLE_RATE });
        rec.decode(stream);
        return (rec.getResult(stream).text || '').trim();
      } finally {
        try { stream?.free?.(); } catch {}
      }
    }
    const fn = ensureWhisper(spec);
    const opts = buildWhisperOptions(spec, pcm);
    let text = whisperResultToText(await fn(opts));
    if (!hasRepetitionLoop(text)) return text;
    if (opts.audio_ctx !== 0) {
      text = whisperResultToText(await fn({ ...opts, audio_ctx: 0 }));
      if (!hasRepetitionLoop(text)) return text;
    }
    return collapseRepetitions(text);
  }

  async function handle(msg, send) {
    try {
      if (msg.type === 'load') {
        const r = await load(msg.spec);
        send({ type: 'loaded', ...r });
      } else if (msg.type === 'transcribe') {
        const t0 = now();
        const text = await transcribe(msg.spec, msg.pcm);
        send({ type: 'result', id: msg.id, text, ms: now() - t0, rss: rss() });
      } else if (msg.type === 'ping') {
        send({ type: 'pong', id: msg.id, rss: rss() });
      }
    } catch (err) {
      send({ type: 'error', id: msg.id, error: (err && err.message) || String(err), rss: rss() });
    }
  }

  return { handle, load, transcribe, dispose: freeRecognizer };
}

module.exports = {
  createEngineHost,
  computeAudioCtx,
  buildWhisperOptions,
  whisperResultToText,
  hasRepetitionLoop,
  collapseRepetitions,
};
