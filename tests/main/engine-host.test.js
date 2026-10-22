import { describe, it, expect } from 'vitest';
import { createEngineHost, computeAudioCtx, buildWhisperOptions, whisperResultToText } from '../../src/main/engines/engine-host.js';

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
  it('is always a multiple of 8 (Metal aborts on any other window size)', () => {
    expect(computeAudioCtx(22.5 * 16000)).toBe(1176); // 1175 aborted the worker
    for (let n = 1; n < 28 * 16000; n += 997) {
      const ctx = computeAudioCtx(n);
      expect(ctx % 8).toBe(0);
      expect(ctx).toBeLessThan(1500);
    }
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
  it('uses the full default window on a retry after a crash', () => {
    const pcm = new Float32Array(16000);
    expect(buildWhisperOptions({ modelPath: '/m' }, pcm, { fullWindow: true }).audio_ctx).toBe(0);
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
