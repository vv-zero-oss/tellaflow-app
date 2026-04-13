import { describe, it, expect, vi, beforeEach } from 'vitest';

// Load the module fresh for each test (no shared module-level state)
function loadWarmUp() {
  const resolved = require.resolve('../../src/main/model-warmup.js');
  delete require.cache[resolved];
  return require(resolved);
}

// ─── factory helpers ──────────────────────────────────────────────────────────

/** Returns a base opts object where everything succeeds. */
function makeOpts(overrides = {}) {
  return {
    audioPath: '/fake/test.mp3',
    decodeFn: vi.fn().mockReturnValue(new Float32Array([0.1, 0.2])),
    isAvailableFn: vi.fn().mockReturnValue(true),
    isLoadedFn: vi.fn().mockReturnValue(false),
    loadFn: vi.fn(),
    transcribeFn: vi.fn().mockResolvedValue('hello world'),
    ...overrides,
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('warmUpModel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── happy path ──────────────────────────────────────────────────────────────

  it('returns { success: true } when everything works', async () => {
    const { warmUpModel } = loadWarmUp();
    const opts = makeOpts();
    const result = await warmUpModel(opts);

    expect(result).toEqual({ success: true });
    expect(opts.isAvailableFn).toHaveBeenCalledOnce();
    expect(opts.decodeFn).toHaveBeenCalledWith('/fake/test.mp3');
    expect(opts.transcribeFn).toHaveBeenCalledWith(expect.any(Float32Array));
  });

  it('calls loadFn when model is not yet loaded', async () => {
    const { warmUpModel } = loadWarmUp();
    const opts = makeOpts({ isLoadedFn: vi.fn().mockReturnValue(false) });
    await warmUpModel(opts);
    expect(opts.loadFn).toHaveBeenCalledOnce();
  });

  it('skips loadFn when model is already loaded', async () => {
    const { warmUpModel } = loadWarmUp();
    const opts = makeOpts({ isLoadedFn: vi.fn().mockReturnValue(true) });
    await warmUpModel(opts);
    expect(opts.loadFn).not.toHaveBeenCalled();
  });

  it('still succeeds when loadFn is omitted (undefined)', async () => {
    const { warmUpModel } = loadWarmUp();
    const opts = makeOpts({ loadFn: undefined, isLoadedFn: vi.fn().mockReturnValue(false) });
    const result = await warmUpModel(opts);
    expect(result).toEqual({ success: true });
  });

  it('defaults isLoadedFn to () => false when omitted', async () => {
    const { warmUpModel } = loadWarmUp();
    const loadFn = vi.fn();
    const opts = makeOpts({ isLoadedFn: undefined, loadFn });
    await warmUpModel(opts);
    expect(loadFn).toHaveBeenCalledOnce();
  });

  // ── model not available ─────────────────────────────────────────────────────

  it('skips with reason "model_unavailable" when isAvailableFn returns false', async () => {
    const { warmUpModel } = loadWarmUp();
    const opts = makeOpts({ isAvailableFn: vi.fn().mockReturnValue(false) });
    const result = await warmUpModel(opts);

    expect(result).toEqual({ skipped: true, reason: 'model_unavailable' });
    expect(opts.decodeFn).not.toHaveBeenCalled();
    expect(opts.transcribeFn).not.toHaveBeenCalled();
  });

  // ── audio decode failure (ffmpeg missing or failing) ───────────────────────

  it('skips with reason "decode_failed" when decodeFn returns null', async () => {
    const { warmUpModel } = loadWarmUp();
    const opts = makeOpts({ decodeFn: vi.fn().mockReturnValue(null) });
    const result = await warmUpModel(opts);

    expect(result).toEqual({ skipped: true, reason: 'decode_failed' });
    expect(opts.transcribeFn).not.toHaveBeenCalled();
  });

  it('skips with reason "decode_failed" when decodeFn returns undefined', async () => {
    const { warmUpModel } = loadWarmUp();
    const opts = makeOpts({ decodeFn: vi.fn().mockReturnValue(undefined) });
    const result = await warmUpModel(opts);
    expect(result).toEqual({ skipped: true, reason: 'decode_failed' });
  });

  it('proceeds to transcribe even with an empty Float32Array (object is truthy)', async () => {
    const { warmUpModel } = loadWarmUp();
    // Float32Array(0) is an object — truthy — so decode is considered successful
    // and we still pass it to transcribeFn. The model itself handles empty audio.
    const opts = makeOpts({ decodeFn: vi.fn().mockReturnValue(new Float32Array(0)) });
    const result = await warmUpModel(opts);
    expect(result).toEqual({ success: true });
    expect(opts.transcribeFn).toHaveBeenCalledWith(expect.any(Float32Array));
  });

  // ── transcription error ─────────────────────────────────────────────────────

  it('returns skipped/error when transcribeFn throws', async () => {
    const { warmUpModel } = loadWarmUp();
    const opts = makeOpts({
      transcribeFn: vi.fn().mockRejectedValue(new Error('model crashed')),
    });
    const result = await warmUpModel(opts);

    expect(result).toEqual({ skipped: true, reason: 'error', error: 'model crashed' });
  });

  it('returns skipped/error when transcribeFn rejects with a non-Error', async () => {
    const { warmUpModel } = loadWarmUp();
    const opts = makeOpts({
      // Node converts non-Error rejects to an object whose .message is undefined
      transcribeFn: vi.fn().mockRejectedValue('plain string rejection'),
    });
    const result = await warmUpModel(opts);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('error');
  });

  it('does NOT throw even when everything internally throws', async () => {
    const { warmUpModel } = loadWarmUp();
    const opts = makeOpts({
      isAvailableFn: vi.fn().mockImplementation(() => { throw new Error('boom'); }),
    });
    await expect(warmUpModel(opts)).resolves.toMatchObject({ skipped: true, reason: 'error' });
  });

  // ── load error ──────────────────────────────────────────────────────────────

  it('returns skipped/error when loadFn throws', async () => {
    const { warmUpModel } = loadWarmUp();
    const opts = makeOpts({
      isLoadedFn: vi.fn().mockReturnValue(false),
      loadFn: vi.fn().mockImplementation(() => { throw new Error('native addon missing'); }),
    });
    const result = await warmUpModel(opts);
    expect(result).toMatchObject({ skipped: true, reason: 'error', error: 'native addon missing' });
    // transcribeFn should not be reached
    expect(opts.transcribeFn).not.toHaveBeenCalled();
  });

  // ── audioPath is passed through ─────────────────────────────────────────────

  it('passes the audioPath exactly to decodeFn', async () => {
    const { warmUpModel } = loadWarmUp();
    const opts = makeOpts({ audioPath: '/custom/audio/test.mp3' });
    await warmUpModel(opts);
    expect(opts.decodeFn).toHaveBeenCalledWith('/custom/audio/test.mp3');
  });

  // ── transcribe result is not used (fire-and-forget style) ──────────────────

  it('succeeds even when transcribeFn resolves with empty string', async () => {
    const { warmUpModel } = loadWarmUp();
    const opts = makeOpts({ transcribeFn: vi.fn().mockResolvedValue('') });
    const result = await warmUpModel(opts);
    expect(result).toEqual({ success: true });
  });

  // ── edge: parakeet-style usage (no explicit loadFn, already loaded) ─────────

  it('handles parakeet already-loaded scenario correctly', async () => {
    const { warmUpModel } = loadWarmUp();
    const loadFn = vi.fn();
    const opts = makeOpts({
      isAvailableFn: vi.fn().mockReturnValue(true),
      isLoadedFn: vi.fn().mockReturnValue(true),  // already in memory
      loadFn,
    });
    const result = await warmUpModel(opts);
    expect(result).toEqual({ success: true });
    expect(loadFn).not.toHaveBeenCalled();  // must not double-load
  });
});
