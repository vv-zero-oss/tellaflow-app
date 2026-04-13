import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Create a Buffer of raw float32-LE values (all 0.1) matching `samples` samples. */
function makeFloat32Buffer(samples) {
  const buf = Buffer.allocUnsafe(samples * 4);
  for (let i = 0; i < samples; i++) buf.writeFloatLE(0.1, i * 4);
  return buf;
}

/**
 * Inject a fake spawnSync into the require cache so that any fresh
 * require('child_process') inside the module under test gets our mock.
 */
function injectSpawnSync(mockFn) {
  const resolved = require.resolve('child_process');
  const orig = require.cache[resolved];
  require.cache[resolved] = {
    ...(orig ?? {}),
    exports: { ...(orig ? orig.exports : {}), spawnSync: mockFn },
  };
}

/** Restore the real child_process in the require cache. */
function restoreSpawnSync() {
  const resolved = require.resolve('child_process');
  delete require.cache[resolved];
  require(resolved); // re-prime with the real module
}

/** Load a fresh copy of startup-smoke-test so mocks are picked up. */
function loadFresh() {
  const resolved = require.resolve('../../src/main/startup-smoke-test.js');
  delete require.cache[resolved];
  return require(resolved);
}

// ─── fixtures ─────────────────────────────────────────────────────────────────

let tmpDir;
let dummyAudio;

beforeEach(() => {
  tmpDir     = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-test-'));
  dummyAudio = path.join(tmpDir, 'test.mp3');
  fs.writeFileSync(dummyAudio, 'dummy');
});

afterEach(() => {
  restoreSpawnSync();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('runStartupSmokeTest', () => {
  it('skips (no-op) when the flag file already exists', async () => {
    fs.writeFileSync(path.join(tmpDir, '.smoke-test-done'), 'done');
    const spawnSyncMock = vi.fn();
    injectSpawnSync(spawnSyncMock);

    const { runStartupSmokeTest } = loadFresh();
    const transcribeFn = vi.fn();

    await runStartupSmokeTest({ userDataPath: tmpDir, audioPath: dummyAudio, transcribeFn });

    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(transcribeFn).not.toHaveBeenCalled();
  });

  it('skips and logs a warning when ffmpeg is not available', async () => {
    injectSpawnSync(vi.fn().mockReturnValue({
      error: new Error('ENOENT'), status: null, stdout: Buffer.alloc(0),
    }));

    const { runStartupSmokeTest } = loadFresh();
    const transcribeFn = vi.fn();

    await runStartupSmokeTest({ userDataPath: tmpDir, audioPath: dummyAudio, transcribeFn });

    expect(transcribeFn).not.toHaveBeenCalled();

    const logContent = fs.readFileSync(path.join(tmpDir, 'error-log.txt'), 'utf8');
    expect(logContent).toMatch(/ffmpeg/i);

    // Flag file must NOT be written so the test retries next launch (once ffmpeg is installed)
    expect(fs.existsSync(path.join(tmpDir, '.smoke-test-done'))).toBe(false);
  });

  it('skips when ffmpeg exits with non-zero status', async () => {
    injectSpawnSync(vi.fn().mockReturnValue({
      error: null, status: 1, stdout: Buffer.alloc(0),
    }));

    const { runStartupSmokeTest } = loadFresh();
    const transcribeFn = vi.fn();

    await runStartupSmokeTest({ userDataPath: tmpDir, audioPath: dummyAudio, transcribeFn });

    expect(transcribeFn).not.toHaveBeenCalled();
  });

  it('writes flag file and does NOT log an error on a passing transcription', async () => {
    injectSpawnSync(vi.fn().mockReturnValue({
      error: null, status: 0, stdout: makeFloat32Buffer(1600),
    }));

    const { runStartupSmokeTest } = loadFresh();
    const transcribeFn = vi.fn().mockResolvedValue(
      'Welcome to the new frontier where your voice becomes the interface to every interaction with machines.'
    );

    await runStartupSmokeTest({ userDataPath: tmpDir, audioPath: dummyAudio, transcribeFn });

    expect(transcribeFn).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(tmpDir, '.smoke-test-done'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'error-log.txt'))).toBe(false);
  });

  it('writes flag file AND logs an error when accuracy is below 90%', async () => {
    injectSpawnSync(vi.fn().mockReturnValue({
      error: null, status: 0, stdout: makeFloat32Buffer(1600),
    }));

    const { runStartupSmokeTest } = loadFresh();
    const transcribeFn = vi.fn().mockResolvedValue('completely wrong text that does not match');

    await runStartupSmokeTest({ userDataPath: tmpDir, audioPath: dummyAudio, transcribeFn });

    expect(transcribeFn).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(tmpDir, '.smoke-test-done'))).toBe(true);

    const logContent = fs.readFileSync(path.join(tmpDir, 'error-log.txt'), 'utf8');
    expect(logContent).toMatch(/STARTUP_SMOKE_TEST/);
    expect(logContent).toMatch(/accuracy/i);
    expect(logContent).toMatch(/below/i);
  });

  it('does NOT write flag file and logs an error when transcription throws', async () => {
    injectSpawnSync(vi.fn().mockReturnValue({
      error: null, status: 0, stdout: makeFloat32Buffer(1600),
    }));

    const { runStartupSmokeTest } = loadFresh();
    const transcribeFn = vi.fn().mockRejectedValue(new Error('addon crash'));

    await runStartupSmokeTest({ userDataPath: tmpDir, audioPath: dummyAudio, transcribeFn });

    expect(fs.existsSync(path.join(tmpDir, '.smoke-test-done'))).toBe(false);

    const logContent = fs.readFileSync(path.join(tmpDir, 'error-log.txt'), 'utf8');
    expect(logContent).toMatch(/addon crash/);
  });

  it('never throws even when everything goes wrong', async () => {
    injectSpawnSync(vi.fn().mockImplementation(() => { throw new Error('total failure'); }));

    const { runStartupSmokeTest } = loadFresh();
    await expect(
      runStartupSmokeTest({ userDataPath: tmpDir, audioPath: dummyAudio, transcribeFn: vi.fn() })
    ).resolves.not.toThrow();
  });

  it('passes a Float32Array decoded from the ffmpeg output to transcribeFn', async () => {
    injectSpawnSync(vi.fn().mockReturnValue({
      error: null, status: 0, stdout: makeFloat32Buffer(1600),
    }));

    const { runStartupSmokeTest } = loadFresh();
    const transcribeFn = vi.fn().mockResolvedValue('some words');

    await runStartupSmokeTest({ userDataPath: tmpDir, audioPath: dummyAudio, transcribeFn });

    expect(transcribeFn).toHaveBeenCalledWith(expect.any(Float32Array));
    const pcm = transcribeFn.mock.calls[0][0];
    expect(pcm.length).toBe(1600);
    expect(pcm[0]).toBeCloseTo(0.1, 5);
  });

  it('error log entries include an ISO timestamp', async () => {
    injectSpawnSync(vi.fn().mockReturnValue({
      error: null, status: 0, stdout: makeFloat32Buffer(1600),
    }));

    const { runStartupSmokeTest } = loadFresh();
    const transcribeFn = vi.fn().mockResolvedValue('wrong text here');

    await runStartupSmokeTest({ userDataPath: tmpDir, audioPath: dummyAudio, transcribeFn });

    const logContent = fs.readFileSync(path.join(tmpDir, 'error-log.txt'), 'utf8');
    expect(logContent).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('90% partial match still passes (strips punctuation)', async () => {
    injectSpawnSync(vi.fn().mockReturnValue({
      error: null, status: 0, stdout: makeFloat32Buffer(1600),
    }));

    const { runStartupSmokeTest } = loadFresh();
    // Drop one word out of 18 → accuracy ≈ 94.4% — should pass
    const transcribeFn = vi.fn().mockResolvedValue(
      'Welcome to the new frontier where your voice becomes the interface to every interaction with machines'
    );

    await runStartupSmokeTest({ userDataPath: tmpDir, audioPath: dummyAudio, transcribeFn });

    expect(fs.existsSync(path.join(tmpDir, '.smoke-test-done'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'error-log.txt'))).toBe(false);
  });
});
