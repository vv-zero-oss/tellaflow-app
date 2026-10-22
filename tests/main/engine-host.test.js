import { describe, it, expect } from 'vitest';
import { createEngineHost, computeAudioCtx, buildWhisperOptions, whisperResultToText, hasRepetitionLoop, collapseRepetitions } from '../../src/main/engines/engine-host.js';

describe('computeAudioCtx', () => {
  it('uses the full context for ≥28 s and 0 for empty input', () => {
    expect(computeAudioCtx(30 * 16000)).toBe(0);
    expect(computeAudioCtx(0)).toBe(0);
  });
  it('shrinks the encoder window for short clips, with a floor', () => {
    expect(computeAudioCtx(2 * 16000)).toBe(512); // (2+1)*50 = 150 → floor 512
    expect(computeAudioCtx(15 * 16000)).toBe(800); // (15+1)*50
    expect(computeAudioCtx(27 * 16000)).toBe(1400);
  });
});

describe('buildWhisperOptions', () => {
  it('passes threads and the prompt using the addon’s `prompt` field', () => {
    const o = buildWhisperOptions({ modelPath: '/m', numThreads: 6, prompt: 'Names: Jane Doe.' }, new Float32Array(16000));
    expect(o.n_threads).toBe(6);
    expect(o.prompt).toBe('Names: Jane Doe.');
    expect(o).not.toHaveProperty('initial_prompt');
    expect(o.audio_ctx).toBe(512);
  });
  it('sets translation language when translating', () => {
    const o = buildWhisperOptions({ modelPath: '/m', translate: true, language: 'ja' }, new Float32Array(10));
    expect(o).toMatchObject({ translate: true, language: 'ja' });
  });
});

describe('whisperResultToText', () => {
  it('joins segment arrays', () => {
    expect(whisperResultToText({ transcription: [['0', '1', ' hello'], ['1', '2', ' world ']] })).toBe('hello world');
  });
});

describe('engine host', () => {
  function fakeSherpa(log) {
    return {
      OfflineRecognizer: class {
        constructor(cfg) { this.cfg = cfg; log.push(['new', cfg.modelConfig.numThreads]); }
        createStream() { const s = { samples: null, free: () => log.push(['free-stream']) }; return Object.assign(s, { acceptWaveform: ({ samples }) => { s.samples = samples; } }); }
        decode() {}
        getResult(s) { return { text: ` parakeet ${s.samples.length} ` }; }
        free() { log.push(['free-rec']); }
      },
    };
  }

  it('transcribes with parakeet, reuses the recognizer and frees streams', async () => {
    const log = [];
    const host = createEngineHost({ loadWhisperAddon: () => { throw new Error('no'); }, loadSherpa: () => fakeSherpa(log) });
    const spec = { engine: 'parakeet', parakeetPaths: { encoder: 'e', decoder: 'd', joiner: 'j', tokens: 't' }, numThreads: 2 };
    expect(await host.transcribe(spec, new Float32Array(5))).toBe('parakeet 5');
    expect(await host.transcribe(spec, new Float32Array(7))).toBe('parakeet 7');
    expect(log.filter((l) => l[0] === 'new')).toHaveLength(1);
    expect(log.filter((l) => l[0] === 'free-stream')).toHaveLength(2);
  });

  it('reports engine errors as error messages with the job id', async () => {
    const host = createEngineHost({ loadWhisperAddon: () => async () => { throw new Error('ggml boom'); }, loadSherpa: () => ({}) });
    const sent = [];
    await host.handle({ type: 'transcribe', id: 7, spec: { engine: 'whisper', modelPath: '/m', addonDir: '/a' }, pcm: new Float32Array(10) }, (m) => sent.push(m));
    expect(sent[0]).toMatchObject({ type: 'error', id: 7, error: 'ggml boom' });
  });

  it('fails clearly when the whisper model path is missing', async () => {
    const host = createEngineHost({ loadWhisperAddon: () => async () => ({}), loadSherpa: () => ({}) });
    await expect(host.transcribe({ engine: 'whisper', addonDir: '/a' }, new Float32Array(10))).rejects.toThrow(/model not found/i);
  });
});

describe('Whisper repetition loops', () => {
  const loop = 'The army found the people in poverty and left them in comparative wealth. The army found the people in poverty and left them in comparative wealth.';

  it('detects a sentence written twice, or a long run repeated', () => {
    expect(hasRepetitionLoop(loop)).toBe(true);
    expect(hasRepetitionLoop('Thank you for watching. Thank you for watching.')).toBe(true);
    expect(hasRepetitionLoop("So Ali related all that had passed, and the caliph said, 'I had not thought that thou wouldst kill him.' Ali was a sorcerer, and the caliph said, 'I had not thought that thou wouldst kill him.'")).toBe(true);
  });

  it('leaves ordinary dictation alone', () => {
    expect(hasRepetitionLoop('Pray, pray, pray, say you will not.')).toBe(false);
    expect(hasRepetitionLoop('No, no. I said send it today, not tomorrow, and send it to Jane.')).toBe(false);
    expect(hasRepetitionLoop('')).toBe(false);
  });

  it('collapses back-to-back copies to one', () => {
    expect(collapseRepetitions(loop)).toBe('The army found the people in poverty and left them in comparative wealth.');
    expect(collapseRepetitions('Hello there. One two three four five six seven one two three four five six seven one two three four five six seven end.'))
      .toBe('Hello there. One two three four five six seven end.');
    expect(collapseRepetitions('Pray, pray, pray, say you will not.')).toBe('Pray, pray, pray, say you will not.');
  });

  function fakeWhisper(calls, answer) {
    return () => async (opts) => { calls.push(opts.audio_ctx); return { transcription: [['', '', answer(opts)]] }; };
  }
  const spec = { engine: 'whisper', modelPath: '/m', addonDir: '/a' };

  it('re-runs a looping short clip with the full encoder window', async () => {
    const calls = [];
    const host = createEngineHost({ loadWhisperAddon: fakeWhisper(calls, (o) => (o.audio_ctx ? loop : 'The army found the people.')), loadSherpa: () => ({}) });
    expect(await host.transcribe(spec, new Float32Array(5 * 16000))).toBe('The army found the people.');
    expect(calls).toEqual([512, 0]);
  });

  it('does not re-run a clean clip', async () => {
    const calls = [];
    const host = createEngineHost({ loadWhisperAddon: fakeWhisper(calls, () => 'Hello world.'), loadSherpa: () => ({}) });
    expect(await host.transcribe(spec, new Float32Array(5 * 16000))).toBe('Hello world.');
    expect(calls).toEqual([512]);
  });

  it('collapses a loop that survives the full window', async () => {
    const calls = [];
    const host = createEngineHost({ loadWhisperAddon: fakeWhisper(calls, () => loop), loadSherpa: () => ({}) });
    expect(await host.transcribe(spec, new Float32Array(5 * 16000))).toBe('The army found the people in poverty and left them in comparative wealth.');
    expect(calls).toEqual([512, 0]);
    calls.length = 0; // a long window already ran full: no second pass
    await host.transcribe(spec, new Float32Array(30 * 16000));
    expect(calls).toEqual([0]);
  });
});
