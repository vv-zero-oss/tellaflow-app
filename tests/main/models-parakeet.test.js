import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
let models;
let userData;

beforeAll(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-models-'));
  // models.js only needs app paths from Electron. Pretend to be packaged with
  // an empty resources folder so models in the checkout don't leak in.
  const id = require.resolve('electron');
  require.cache[id] = { id, filename: id, loaded: true, exports: { app: { isPackaged: true, getPath: () => userData } } };
  process.resourcesPath = path.join(userData, 'resources');
  models = require('../../src/main/models');
});

afterAll(() => fs.rmSync(userData, { recursive: true, force: true }));

function fakeDownload(variant) {
  const dir = path.join(userData, 'models', models.PARAKEET_VARIANTS[variant].dir);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']) fs.writeFileSync(path.join(dir, f), 'x');
  return dir;
}

describe('Parakeet variants', () => {
  it('knows v2 and Unified, each with its own folder and download', () => {
    expect(Object.keys(models.PARAKEET_VARIANTS)).toEqual(['v2', 'unified']);
    const { v2, unified } = models.PARAKEET_VARIANTS;
    expect(unified.dir).toBe('sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-non-streaming');
    expect(unified.url).toMatch(/asr-models\/sherpa-onnx-nemo-parakeet-unified-en-0\.6b-int8-non-streaming\.tar\.bz2$/);
    expect(unified.dir).not.toBe(v2.dir);
    expect(unified.tmpName).not.toBe(v2.tmpName);
  });

  it('reports a downloaded variant and gives the worker its file paths', () => {
    expect(models.isParakeetAvailable('unified')).toBe(false);
    expect(models.getParakeetStatus('unified')).toMatchObject({ variant: 'unified', status: 'not_downloaded', available: false });

    const dir = fakeDownload('unified');
    expect(models.isParakeetAvailable('unified')).toBe(true);
    expect(models.getParakeetStatus('unified')).toMatchObject({ status: 'downloaded', available: true, label: 'Parakeet Unified 0.6b' });
    expect(models.getParakeetFilePaths('unified')).toEqual({
      encoder: path.join(dir, 'encoder.int8.onnx'),
      decoder: path.join(dir, 'decoder.int8.onnx'),
      joiner: path.join(dir, 'joiner.int8.onnx'),
      tokens: path.join(dir, 'tokens.txt'),
    });
  });

  it('deleting one variant leaves the other alone', () => {
    fakeDownload('unified');
    const v2Dir = fakeDownload('v2');
    models.deleteParakeet('unified');
    expect(fs.existsSync(path.join(userData, 'models', models.PARAKEET_VARIANTS.unified.dir))).toBe(false);
    expect(fs.existsSync(v2Dir)).toBe(true);
  });

  it('rejects unknown variants without downloading anything', () => {
    let error = null;
    models.startParakeetDownload('nope', { onError: (e) => { error = e; } });
    expect(error?.message).toMatch(/Unknown Parakeet model/);
    expect(models.isParakeetDownloading()).toBe(false);
  });
});

describe('Whisper turbo', () => {
  it('is a downloadable Whisper model with the quantised large-v3-turbo file', () => {
    expect(models.MODEL_REGISTRY.turbo).toMatchObject({ file: 'ggml-large-v3-turbo-q5_0.bin', bytes: 574_041_195 });
    expect(models.getModelsStatus().turbo).toMatchObject({ available: false, status: 'not_downloaded' });
  });
});
