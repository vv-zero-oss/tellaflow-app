/**
 * Transcription service — supervises the transcription worker process.
 *
 *   - Jobs run one at a time (the native engines are not re-entrant).
 *   - If the worker crashes or hangs mid-job it is restarted and the job is
 *     retried once; a second crash rejects with `WorkerCrashError` so the
 *     caller can park the audio in the "Needs attention" list.
 *   - The worker is recycled between jobs after a fixed number of jobs, when
 *     its RSS grows past a ceiling (headroom on top of the model's own size,
 *     `spec.modelBytes`, so a 3 GB model isn't reloaded after every job), or
 *     after an idle period, so native memory pools (ONNX BFCArena, ggml/Metal
 *     buffers) are returned to the OS.
 *   - Repeated crashes back off exponentially instead of spinning.
 *
 * Process creation is injected (`spawn`) so the logic is testable with fakes.
 */

class WorkerCrashError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'WorkerCrashError';
    this.reason = reason;
  }
}

const RECYCLABLE_ERROR_RE = /alloc|out of memory|\bOOM\b|bad_alloc|memory/i;

const DEFAULTS = {
  maxJobsPerWorker: 40,
  maxRssBytes: 1.6 * 1024 * 1024 * 1024,
  idleMs: 10 * 60 * 1000,
  maxCrashRetries: 1,
  // Generous: ~4x real-time plus model load time on a cold worker.
  jobTimeoutMs: (numSamples) => 90_000 + Math.ceil((numSamples / 16000) * 4000),
  crashWindowMs: 60_000,
};

function createTranscriptionService({
  spawn,
  getSpec,
  log = console,
  options = {},
  timers = { setTimeout, clearTimeout },
  now = () => Date.now(),
}) {
  const opts = { ...DEFAULTS, ...options };
  let worker = null;
  let nextJobId = 1;
  let nextWorkerId = 1;
  const queue = [];
  let inflight = null;
  let idleTimer = null;
  let resetPending = false;
  let prewarmPending = false;
  let backoffTimer = null;
  let disposed = false;
  const crashTimes = [];
  const stats = { spawned: 0, crashes: 0, recycles: 0, retries: 0, completed: 0, failed: 0 };
  const listeners = new Set();

  function emit(event) {
    for (const fn of listeners) {
      try { fn(event); } catch {}
    }
  }

  function specKey(spec) {
    if (!spec) return '';
    return [spec.engine, spec.modelPath, spec.parakeetPaths?.encoder, spec.numThreads].join('|');
  }

  function clearIdle() {
    if (idleTimer) { timers.clearTimeout(idleTimer); idleTimer = null; }
  }

  function armIdle() {
    clearIdle();
    if (!opts.idleMs || !worker) return;
    idleTimer = timers.setTimeout(() => {
      idleTimer = null;
      if (worker && !inflight && queue.length === 0) {
        log.log?.('[transcription] worker idle — releasing it to free memory');
        retire('idle');
      }
    }, opts.idleMs);
    idleTimer?.unref?.();
  }

  function spawnWorker() {
    const id = nextWorkerId++;
    const w = { id, jobs: 0, rss: 0, modelBytes: 0, loadedKey: null, retiring: false, handle: null };
    stats.spawned++;
    w.handle = spawn({
      onMessage: (msg) => onWorkerMessage(w, msg),
      onExit: (code) => onWorkerExit(w, code),
    });
    worker = w;
    emit({ type: 'spawn', workerId: id });
    return w;
  }

  function retire(reason) {
    const w = worker;
    if (!w) return;
    w.retiring = true;
    worker = null;
    clearIdle();
    if (reason !== 'idle') stats.recycles++;
    emit({ type: 'recycle', workerId: w.id, reason, jobs: w.jobs, rss: w.rss });
    try { w.handle.send({ type: 'shutdown' }); } catch {}
    // Hard kill if it doesn't exit promptly on its own.
    const t = timers.setTimeout(() => { try { w.handle.kill(); } catch {} }, 2000);
    t?.unref?.();
  }

  function shouldRecycle(w) {
    if (!w) return null;
    if (w.jobs >= opts.maxJobsPerWorker) return 'job-count';
    if (opts.maxRssBytes && w.rss > opts.maxRssBytes + w.modelBytes) return 'memory';
    return null;
  }

  function finishJob(job) {
    if (job.timer) { timers.clearTimeout(job.timer); job.timer = null; }
    if (inflight === job) inflight = null;
  }

  function onWorkerMessage(w, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (typeof msg.rss === 'number') w.rss = msg.rss;
    if (msg.type === 'loaded') {
      emit({ type: 'loaded', workerId: w.id, ms: msg.ms, engine: msg.engine });
      return;
    }
    if (msg.type === 'error' && msg.id == null) {
      // Prewarm (model load) failed — nothing in flight to reject.
      w.loadedKey = null;
      emit({ type: 'load-error', workerId: w.id, error: msg.error });
      return;
    }
    const job = inflight;
    if (!job || job.worker !== w || msg.id !== job.id) return;

    if (msg.type === 'result') {
      w.jobs++;
      w.loadedKey = job.key;
      finishJob(job);
      stats.completed++;
      job.resolve(msg.text || '');
      afterJob();
    } else if (msg.type === 'error') {
      w.jobs++;
      finishJob(job);
      const recyclable = RECYCLABLE_ERROR_RE.test(msg.error || '');
      if (recyclable && job.attempts <= opts.maxCrashRetries) {
        // Allocation failure inside the engine: a fresh process gets a clean heap.
        stats.retries++;
        if (worker === w) retire('memory');
        queue.unshift(job);
      } else {
        stats.failed++;
        job.reject(new Error(msg.error || 'Transcription failed'));
      }
      afterJob();
    }
  }

  function onWorkerExit(w, code) {
    if (worker === w) worker = null;
    if (w.retiring) return;
    // Unplanned exit = crash.
    stats.crashes++;
    const t = now();
    crashTimes.push(t);
    while (crashTimes.length && t - crashTimes[0] > opts.crashWindowMs) crashTimes.shift();
    clearIdle();
    log.warn?.(`[transcription] worker ${w.id} exited unexpectedly (code ${code})`);
    emit({ type: 'crash', workerId: w.id, code });

    const job = inflight && inflight.worker === w ? inflight : null;
    if (job) {
      finishJob(job);
      if (job.attempts <= opts.maxCrashRetries) {
        stats.retries++;
        queue.unshift(job);
      } else {
        stats.failed++;
        job.reject(new WorkerCrashError(
          job.timedOut ? 'Transcription timed out' : 'Transcription engine crashed',
          job.timedOut ? 'timeout' : 'crash',
        ));
      }
    }
    afterJob();
  }

  function backoffMs() {
    // 0 for the first crash in the window, then 1 s, 2 s, 4 s … capped at 30 s.
    const n = crashTimes.length;
    if (n <= 1) return 0;
    return Math.min(30_000, 1000 * 2 ** (n - 2));
  }

  function afterJob() {
    // A model switch that arrived mid-job: apply it once the queue drains so
    // the new model loads and 'loaded' fires (the UI waits on it).
    if (!inflight && queue.length === 0 && (resetPending || prewarmPending)) {
      const doPrewarm = prewarmPending;
      if (resetPending && worker) retire('config');
      resetPending = false;
      prewarmPending = false;
      if (doPrewarm) { prewarm({ force: true }); return; }
    }
    if (worker && !inflight) {
      const reason = shouldRecycle(worker);
      if (reason) retire(reason);
    }
    if (queue.length === 0) { armIdle(); return; }
    const delay = worker ? 0 : backoffMs();
    if (delay > 0) {
      if (!backoffTimer) {
        backoffTimer = timers.setTimeout(() => { backoffTimer = null; pump(); }, delay);
      }
    } else {
      pump();
    }
  }

  function pump() {
    if (disposed || inflight || queue.length === 0 || backoffTimer) return;
    clearIdle();
    const job = queue.shift();
    const w = worker || spawnWorker();
    let spec;
    try {
      spec = job.spec || getSpec();
    } catch (err) {
      job.reject(err);
      afterJob();
      return;
    }
    job.attempts++;
    job.worker = w;
    w.modelBytes = spec.modelBytes || 0;
    job.key = specKey(spec);
    job.timedOut = false;
    inflight = job;
    const timeout = opts.jobTimeoutMs(job.pcm.length);
    job.timer = timers.setTimeout(() => {
      if (inflight !== job) return;
      log.warn?.(`[transcription] job ${job.id} timed out after ${timeout}ms — killing worker`);
      job.timedOut = true;
      try { w.handle.kill(); } catch {}
    }, timeout);
    try {
      w.handle.send({ type: 'transcribe', id: job.id, spec, pcm: job.pcm, attempt: job.attempts });
    } catch (err) {
      // Channel already dead — the exit handler will requeue the job.
      log.warn?.('[transcription] send failed:', err.message);
    }
  }

  function transcribe(pcm, { spec } = {}) {
    if (disposed) return Promise.reject(new Error('Transcription service disposed'));
    const samples = pcm instanceof Float32Array ? pcm : new Float32Array(pcm || []);
    return new Promise((resolve, reject) => {
      queue.push({ id: nextJobId++, pcm: samples, spec, attempts: 0, resolve, reject, timer: null });
      pump();
    });
  }

  /** Start the worker and load the model ahead of the first job. */
  function prewarm({ force = false } = {}) {
    if (disposed) return;
    if (inflight || queue.length > 0) { prewarmPending = true; return; }
    let spec;
    try { spec = getSpec(); } catch { return; }
    const key = specKey(spec);
    if (worker && worker.loadedKey === key) {
      // A deferred prewarm whose model a job already loaded: still report it.
      if (force) emit({ type: 'loaded', workerId: worker.id, engine: spec.engine });
      armIdle();
      return;
    }
    const w = worker || spawnWorker();
    w.loadedKey = key;
    try { w.handle.send({ type: 'load', spec }); } catch {}
    armIdle();
  }

  /** Drop the current worker (e.g. after the model or engine changes). */
  function reset() {
    if (inflight || queue.length > 0) { resetPending = true; return; }
    if (worker) retire('config');
  }

  function dispose() {
    disposed = true;
    clearIdle();
    if (backoffTimer) { timers.clearTimeout(backoffTimer); backoffTimer = null; }
    const err = new Error('Transcription service disposed');
    if (inflight) { const job = inflight; finishJob(job); job.reject(err); }
    for (const job of queue.splice(0)) job.reject(err);
    if (worker) {
      worker.retiring = true;
      try { worker.handle.kill(); } catch {}
      worker = null;
    }
  }

  return {
    transcribe,
    prewarm,
    reset,
    dispose,
    isBusy: () => !!inflight || queue.length > 0,
    getStats: () => ({ ...stats, workerAlive: !!worker, workerJobs: worker?.jobs || 0, workerRss: worker?.rss || 0, queued: queue.length }),
    onEvent: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

module.exports = { createTranscriptionService, WorkerCrashError };
