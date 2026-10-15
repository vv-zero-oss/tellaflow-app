/**
 * Real-process test: the actual transcription-worker.js is forked as a child
 * process (fake engine via TELLAFLOW_WORKER_FAKE_ENGINE) and driven by the
 * real transcription service. A clip starting with 999 makes the worker call
 * process.abort() — a genuine native-style crash — and the service must
 * restart it and keep serving.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { fork } from 'child_process';
import path from 'path';
import { createTranscriptionService, WorkerCrashError } from '../../src/main/transcription-service.js';

const WORKER = path.resolve(__dirname, '../../src/main/transcription-worker.js');
const quiet = { log() {}, warn() {}, error() {} };

function spawnReal({ onMessage, onExit }) {
  const child = fork(WORKER, [], {
    env: { ...process.env, TELLAFLOW_WORKER_FAKE_ENGINE: '1' },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'advanced', // structured clone, like utilityProcess
  });
  child.on('message', onMessage);
  child.on('exit', (code, signal) => onExit(code ?? signal));
  return { send: (m) => child.send(m), kill: () => child.kill('SIGKILL'), pid: child.pid };
}

const spec = { engine: 'whisper', modelPath: '/fake.bin', addonDir: '/fake' };
const clip = (n, first = 0.1) => { const a = new Float32Array(n); a[0] = first; return a; };

describe('transcription worker process (real child process)', () => {
  let service;
  afterEach(() => service?.dispose());

  it('transcribes, survives a hard crash, and keeps going', async () => {
    service = createTranscriptionService({ spawn: spawnReal, getSpec: () => spec, log: quiet, options: { idleMs: 0 } });

    const first = await service.transcribe(clip(1600));
    expect(first).toMatch(/^fake 1600 samples pid (\d+)$/);
    const pid1 = first.match(/pid (\d+)/)[1];

    // 999 → process.abort() on both attempts → reported as a crash, not a hang.
    await expect(service.transcribe(clip(1600, 999))).rejects.toBeInstanceOf(WorkerCrashError);
    expect(service.getStats().crashes).toBe(2);

    // The app is still alive and a fresh worker serves the next job.
    const after = await service.transcribe(clip(3200));
    expect(after).toMatch(/^fake 3200 samples/);
    expect(after.match(/pid (\d+)/)[1]).not.toBe(pid1);
  }, 30_000);

  it('kills and replaces a hung worker after the job timeout', async () => {
    service = createTranscriptionService({
      spawn: spawnReal,
      getSpec: () => spec,
      log: quiet,
      options: { idleMs: 0, maxCrashRetries: 0, jobTimeoutMs: () => 1500 },
    });
    await expect(service.transcribe(clip(1600, 888))).rejects.toThrow(/timed out/);
    expect(await service.transcribe(clip(800))).toMatch(/^fake 800 samples/);
  }, 30_000);
});
