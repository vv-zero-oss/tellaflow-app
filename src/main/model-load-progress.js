// Tracks the transcription model load so the UI can show a progress bar.
//
// Neither whisper.cpp nor sherpa-onnx reports load progress, so the bar is
// time-based: the expected duration is the last measured load time for this
// model (persisted), or an estimate from the model's size on disk the first
// time. The renderer animates toward ~95% and snaps to 100% on 'loaded'.

const fs = require('fs');

const FALLBACK_BASE_MS = 800;
const FALLBACK_BYTES_PER_MS = 500 * 1024; // ~500 MB/s read + init

function sizeOnDisk(spec) {
  const files = spec.engine === 'parakeet'
    ? Object.values(spec.parakeetPaths || {})
    : [spec.modelPath];
  let total = 0;
  for (const f of files) {
    try { if (f) total += fs.statSync(f).size; } catch { /* missing file */ }
  }
  return total;
}

function modelId(spec) {
  if (spec.engine === 'parakeet') {
    return `parakeet:${spec.parakeetPaths?.encoder || ''}`;
  }
  return `whisper:${spec.modelPath || ''}`;
}

function createModelLoadProgress({ getSpec, getTimes, setTime, broadcast, now = Date.now }) {
  let state = { loading: false };

  function start() {
    const spec = getSpec();
    const id = modelId(spec);
    const remembered = getTimes()[id];
    const expectedMs = Number.isFinite(remembered) && remembered > 0
      ? remembered
      : FALLBACK_BASE_MS + sizeOnDisk(spec) / FALLBACK_BYTES_PER_MS;
    state = { loading: true, id, engine: spec.engine, startedAt: now(), expectedMs: Math.round(expectedMs) };
    broadcast(state);
  }

  function finish(ok, ms) {
    if (!state.loading) return;
    if (ok && Number.isFinite(ms) && ms > 0) setTime(state.id, Math.round(ms));
    state = { loading: false, ok, engine: state.engine };
    broadcast(state);
  }

  return { start, finish, getState: () => state };
}

module.exports = { createModelLoadProgress, sizeOnDisk };
