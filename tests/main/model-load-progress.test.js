import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { createModelLoadProgress } = require('../../src/main/model-load-progress.js');

function setup({ spec, times = {} } = {}) {
  const events = [];
  const saved = { ...times };
  let t = 1000;
  const p = createModelLoadProgress({
    getSpec: () => spec,
    getTimes: () => saved,
    setTime: (id, ms) => { saved[id] = ms; },
    broadcast: (s) => events.push(s),
    now: () => t,
  });
  return { p, events, saved, advance: (ms) => { t += ms; } };
}

describe('model load progress', () => {
  it('estimates the first load from model size, then remembers the measured time', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlp-'));
    const modelPath = path.join(dir, 'ggml.bin');
    fs.writeFileSync(modelPath, Buffer.alloc(500 * 1024 * 100)); // ~50 MB → 100 ms at 500 MB/s
    const { p, events, saved } = setup({ spec: { engine: 'whisper', modelPath } });

    p.start();
    expect(events[0]).toMatchObject({ loading: true, engine: 'whisper', startedAt: 1000, expectedMs: 900 });
    p.finish(true, 2345);
    expect(events[1]).toEqual({ loading: false, ok: true, engine: 'whisper' });
    expect(saved[`whisper:${modelPath}`]).toBe(2345);

    p.start();
    expect(events[2].expectedMs).toBe(2345);
  });

  it('does not record a time for failed loads and ignores finish when idle', () => {
    const spec = { engine: 'parakeet', parakeetPaths: { encoder: '/nope/encoder.onnx' } };
    const { p, events, saved } = setup({ spec });
    p.finish(true, 100);
    expect(events).toHaveLength(0);
    p.start();
    expect(events[0].expectedMs).toBe(800);
    p.finish(false);
    expect(p.getState()).toEqual({ loading: false, ok: false, engine: 'parakeet' });
    expect(saved).toEqual({});
  });
});
