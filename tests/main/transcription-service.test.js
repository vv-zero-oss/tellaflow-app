import { describe, it, expect, beforeEach } from 'vitest';
import { createTranscriptionService, WorkerCrashError } from '../../src/main/transcription-service.js';

// ─── Fake worker processes + manual timers ─────────────────────────────────

function createFakeTimers() {
  let now = 0;
  let id = 0;
  const pending = new Map();
  return {
    setTimeout(fn, ms) { const t = ++id; pending.set(t, { at: now + ms, fn }); return t; },
    clearTimeout(t) { pending.delete(t); },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let next = null;
        for (const [t, e] of pending) if (e.at <= target && (!next || e.at < next[1].at)) next = [t, e];
        if (!next) break;
        pending.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = target;
    },
    count: () => pending.size,
  };
}

/**
 * Each spawned fake worker records messages; `behaviour(msg, worker)` decides
 * how to respond: return {text}, {error}, 'crash', 'hang'.
 */
function createFakeSpawner(behaviour) {
  const workers = [];
  function spawn({ onMessage, onExit }) {
    const w = { id: workers.length + 1, sent: [], alive: true, killed: false, onMessage, onExit };
    w.exit = (code = 1) => { if (!w.alive) return; w.alive = false; onExit(code); };
    w.handle = {
      send(msg) {
        if (!w.alive) throw new Error('channel closed');
        w.sent.push(msg);
        if (msg.type === 'shutdown') { queueMicrotask(() => w.exit(0)); return; }
        queueMicrotask(() => {
          if (!w.alive) return;
          const r = behaviour(msg, w);
          if (r === 'crash') w.exit(134);
          else if (r === 'hang') { /* never answers */ }
          else if (r && r.loaded) onMessage({ type: 'loaded', engine: 'whisper', ms: 5, rss: r.rss || 1 });
          else if (r && 'error' in r) onMessage({ type: 'error', id: msg.id, error: r.error, rss: r.rss || 1 });
          else if (r) onMessage({ type: 'result', id: msg.id, text: r.text, rss: r.rss || 1 });
        });
      },
      kill() { w.killed = true; queueMicrotask(() => w.exit(null)); },
    };
    workers.push(w);
    return w.handle;
  }
  return { spawn, workers };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const pcm = (n = 16000, first = 0) => { const a = new Float32Array(n); a[0] = first; return a; };
const quiet = { log() {}, warn() {}, error() {} };

describe('transcription service', () => {
  let timers;
  beforeEach(() => { timers = createFakeTimers(); });

  function make(behaviour, options = {}) {
    const spawner = createFakeSpawner(behaviour);
    const service = createTranscriptionService({
      spawn: spawner.spawn,
      getSpec: () => ({ engine: 'whisper', modelPath: '/m.bin' }),
      timers,
      log: quiet,
      options: { idleMs: 0, ...options },
    });
    return { service, spawner };
  }

  it('transcribes through a worker and reuses it', async () => {
    const { service, spawner } = make((msg) => (msg.type === 'transcribe' ? { text: `ok ${msg.pcm.length}` } : null));
    expect(await service.transcribe(pcm(100))).toBe('ok 100');
    expect(await service.transcribe(pcm(200))).toBe('ok 200');
    expect(spawner.workers).toHaveLength(1);
    expect(service.getStats().completed).toBe(2);
  });

  it('runs jobs strictly one at a time', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { service } = make((msg) => {
      if (msg.type !== 'transcribe') return null;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      inFlight--;
      return { text: 'x' };
    });
    await Promise.all([service.transcribe(pcm()), service.transcribe(pcm()), service.transcribe(pcm())]);
    expect(maxInFlight).toBe(1);
  });

  it('restarts a crashed worker and retries the job once', async () => {
    let calls = 0;
    const { service, spawner } = make((msg) => {
      if (msg.type !== 'transcribe') return null;
      calls++;
      return calls === 1 ? 'crash' : { text: 'recovered' };
    });
    expect(await service.transcribe(pcm())).toBe('recovered');
    expect(spawner.workers).toHaveLength(2);
    expect(service.getStats().crashes).toBe(1);
    expect(service.getStats().retries).toBe(1);
  });

  it('rejects with WorkerCrashError when the retry crashes too', async () => {
    const { service } = make((msg) => (msg.type === 'transcribe' ? 'crash' : null));
    const p = service.transcribe(pcm()).catch((e) => e);
    // second attempt may be delayed by crash back-off on a fake clock
    await flush(); await flush();
    timers.advance(60_000);
    expect(await p).toBeInstanceOf(WorkerCrashError);
  });

  it('keeps working for the next job after a job failed by crashing', async () => {
    let n = 0;
    const { service } = make((msg) => {
      if (msg.type !== 'transcribe') return null;
      n++;
      return n <= 2 ? 'crash' : { text: 'fine' };
    });
    const first = service.transcribe(pcm()).catch((e) => e);
    await flush(); await flush();
    timers.advance(60_000);
    expect((await first).message).toMatch(/crashed/);
    const second = service.transcribe(pcm());
    await flush(); await flush();
    timers.advance(60_000);
    await expect(second).resolves.toBe('fine');
  });

  it('kills a hung worker on timeout and retries', async () => {
    let n = 0;
    const { service, spawner } = make((msg) => {
      if (msg.type !== 'transcribe') return null;
      n++;
      return n === 1 ? 'hang' : { text: 'after timeout' };
    }, { jobTimeoutMs: () => 1000 });
    const p = service.transcribe(pcm());
    await flush();
    timers.advance(1000);
    await flush(); await flush();
    expect(spawner.workers[0].killed).toBe(true);
    await expect(p).resolves.toBe('after timeout');
  });

  it('does not retry plain engine errors', async () => {
    const { service } = make((msg) => (msg.type === 'transcribe' ? { error: 'Whisper model not found' } : null));
    await expect(service.transcribe(pcm())).rejects.toThrow('Whisper model not found');
    expect(service.getStats().retries).toBe(0);
  });

  it('recycles the worker and retries on allocation errors', async () => {
    let n = 0;
    const { service, spawner } = make((msg) => {
      if (msg.type !== 'transcribe') return null;
      n++;
      return n === 1 ? { error: 'Failed to allocate memory for BFCArena' } : { text: 'fresh heap' };
    });
    expect(await service.transcribe(pcm())).toBe('fresh heap');
    expect(spawner.workers).toHaveLength(2);
    expect(spawner.workers[0].sent.some((m) => m.type === 'shutdown')).toBe(true);
  });

  it('recycles after maxJobsPerWorker jobs', async () => {
    const { service, spawner } = make((msg) => (msg.type === 'transcribe' ? { text: 't' } : null), { maxJobsPerWorker: 2 });
    for (let i = 0; i < 5; i++) await service.transcribe(pcm());
    await flush();
    expect(spawner.workers.length).toBe(3);
    expect(service.getStats().recycles).toBeGreaterThanOrEqual(2);
    expect(service.getStats().crashes).toBe(0);
  });

  it('recycles when worker memory exceeds the ceiling', async () => {
    const { service, spawner } = make((msg) => (msg.type === 'transcribe' ? { text: 't', rss: 5_000 } : null), { maxRssBytes: 1_000 });
    await service.transcribe(pcm());
    await flush();
    await service.transcribe(pcm());
    expect(spawner.workers.length).toBe(2);
  });

  it('releases an idle worker and respawns on demand', async () => {
    const { service, spawner } = make((msg) => (msg.type === 'transcribe' ? { text: 't' } : null), { idleMs: 5000 });
    await service.transcribe(pcm());
    timers.advance(5000);
    await flush();
    expect(service.getStats().workerAlive).toBe(false);
    expect(spawner.workers[0].alive).toBe(false);
    expect(service.getStats().crashes).toBe(0);
    await service.transcribe(pcm());
    expect(spawner.workers).toHaveLength(2);
  });

  it('prewarm spawns the worker and sends a load message once per spec', async () => {
    const { service, spawner } = make((msg) => (msg.type === 'load' ? { loaded: true } : null));
    service.prewarm();
    service.prewarm();
    await flush();
    expect(spawner.workers).toHaveLength(1);
    expect(spawner.workers[0].sent.filter((m) => m.type === 'load')).toHaveLength(1);
  });

  it('a model switch during a job reloads the new model once the job finishes', async () => {
    let finishJob;
    const spawner = createFakeSpawner((msg, w) => {
      if (msg.type === 'load') return { loaded: true };
      if (msg.type === 'transcribe') { finishJob = () => w.onMessage({ type: 'result', id: msg.id, text: 'done' }); return 'hang'; }
      return null;
    });
    let modelPath = '/old.bin';
    const service = createTranscriptionService({
      spawn: spawner.spawn,
      getSpec: () => ({ engine: 'whisper', modelPath }),
      timers,
      log: quiet,
      options: { idleMs: 0 },
    });
    const events = [];
    service.onEvent((e) => events.push(e.type));

    const job = service.transcribe(pcm());
    await flush();
    modelPath = '/new.bin';
    service.reset();
    service.prewarm();
    await flush();
    expect(events).not.toContain('loaded');

    finishJob();
    expect(await job).toBe('done');
    await flush();
    expect(spawner.workers[0].alive).toBe(false); // old worker retired
    expect(spawner.workers[1].sent).toContainEqual({ type: 'load', spec: { engine: 'whisper', modelPath: '/new.bin' } });
    expect(events).toContain('loaded');
  });

  it('dispose rejects queued and in-flight jobs', async () => {
    const { service } = make((msg) => (msg.type === 'transcribe' ? 'hang' : null));
    const a = service.transcribe(pcm());
    const b = service.transcribe(pcm());
    await flush();
    service.dispose();
    await expect(a).rejects.toThrow(/disposed/);
    await expect(b).rejects.toThrow(/disposed/);
  });
});
