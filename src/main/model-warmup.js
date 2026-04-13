/**
 * Model pre-warm utility.
 *
 * Runs the bundled test.mp3 through the active transcription model once so
 * the model's weights are paged into memory before the user's first real
 * dictation.  Called from the onboarding renderer when the user reaches the
 * final "You're all set!" step.
 *
 * All heavy dependencies are injected via opts so the function is fully
 * unit-testable without touching the file system or native addons.
 *
 * @typedef {{ success: true }
 *         | { skipped: true; reason: 'model_unavailable'|'decode_failed'|'error'; error?: string }
 * } WarmUpResult
 */

'use strict';

/**
 * Pre-warms a transcription model.
 *
 * @param {object}   opts
 * @param {string}   opts.audioPath     - Absolute path to the test audio file.
 * @param {Function} opts.decodeFn      - (path: string) => Float32Array | null
 * @param {Function} opts.isAvailableFn - () => boolean   — model files on disk?
 * @param {Function} [opts.isLoadedFn]  - () => boolean   — already in memory?
 * @param {Function} [opts.loadFn]      - () => void      — load into memory.
 * @param {Function} opts.transcribeFn  - (Float32Array) => Promise<string>
 * @returns {Promise<WarmUpResult>}
 */
async function warmUpModel({
  audioPath,
  decodeFn,
  isAvailableFn,
  isLoadedFn = () => false,
  loadFn,
  transcribeFn,
}) {
  try {
    if (!isAvailableFn()) {
      console.log('[warm-up] Model not available — skipping pre-warm');
      return { skipped: true, reason: 'model_unavailable' };
    }

    if (!isLoadedFn() && loadFn) {
      loadFn();
    }

    const pcm = decodeFn(audioPath);
    if (!pcm) {
      console.warn('[warm-up] Could not decode test audio (ffmpeg missing?) — skipping pre-warm');
      return { skipped: true, reason: 'decode_failed' };
    }

    await transcribeFn(pcm);
    console.log('[warm-up] Model pre-warmed ✓');
    return { success: true };
  } catch (err) {
    console.warn('[warm-up] Pre-warm failed (non-fatal):', err.message);
    return { skipped: true, reason: 'error', error: err.message };
  }
}

module.exports = { warmUpModel };
