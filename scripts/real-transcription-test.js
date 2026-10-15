#!/usr/bin/env node
/**
 * Real-model end-to-end check of the transcription stack (no Electron needed).
 *
 * Runs the app's actual worker process (src/main/transcription-worker.js),
 * supervisor, job journal and pipeline against real Whisper / Parakeet
 * models and real audio files, then:
 *   1. transcribes a short clip with each engine,
 *   2. transcribes long recordings (windowed 30 s chunks),
 *   3. hard-kills the worker mid-transcription and checks the job is retried,
 *   4. simulates a crash that exhausts retries → audio parked as a failed job
 *      → a fresh "app restart" retries it from disk successfully.
 *
 * Usage:
 *   node scripts/real-transcription-test.js <short.wav> <long.wav> [<very-long.wav>]
 * Models: resources/models/ggml-base.en.bin (or set WHISPER_MODEL) and
 *         resources/models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { fork } = require('child_process');
const { createTranscriptionService } = require('../src/main/transcription-service');
const { createJobJournal } = require('../src/main/job-journal');
const { createPipeline } = require('../src/main/transcription-pipeline');
const { decodeWavToPcm } = require('../src/main/audio-utils');
const { trimSilence, normalizeVolume } = require('../src/main/audio-preprocess');

const ROOT = path.resolve(__dirname, '..');
const platform = process.platform === 'darwin' ? 'mac' : process.platform;
const ADDON_DIR = path.join(ROOT, 'node_modules/@kutalia/whisper-node-addon/dist', `${platform}-${process.arch}`);
const WHISPER_MODEL = process.env.WHISPER_MODEL || path.join(ROOT, 'resources/models/ggml-base.en.bin');
const PARAKEET_DIR = path.join(ROOT, 'resources/models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8');
const THREADS = Math.max(2, Math.min(8, os.cpus().length));

const SPECS = {
  whisper: { engine: 'whisper', modelPath: WHISPER_MODEL, addonDir: ADDON_DIR, numThreads: THREADS, language: 'en' },
  parakeet: {
    engine: 'parakeet',
    numThreads: Math.min(4, THREADS),
    parakeetPaths: {
      encoder: path.join(PARAKEET_DIR, 'encoder.int8.onnx'),
      decoder: path.join(PARAKEET_DIR, 'decoder.int8.onnx'),
      joiner: path.join(PARAKEET_DIR, 'joiner.int8.onnx'),
      tokens: path.join(PARAKEET_DIR, 'tokens.txt'),
    },
  },
};

const children = new Set();
function spawnWorker({ onMessage, onExit }) {
  const child = fork(path.join(ROOT, 'src/main/transcription-worker.js'), [], {
    env: { ...process.env, LD_LIBRARY_PATH: `${ADDON_DIR}:${process.env.LD_LIBRARY_PATH || ''}` },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    serialization: 'advanced',
  });
  children.add(child);
  child.on('message', onMessage);
  child.on('exit', (code, signal) => { children.delete(child); onExit(code ?? signal); });
  return { send: (m) => child.send(m), kill: () => child.kill('SIGKILL'), pid: child.pid };
}
const killAllWorkers = () => { for (const c of children) c.kill('SIGKILL'); };

const quiet = { log() {}, warn() {}, error: console.error };
const secs = (pcm) => pcm.length / 16000;
const fmt = (s) => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
const preprocess = (pcm) => normalizeVolume(trimSilence(pcm));
const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
}
const words = (t) => (t.match(/[A-Za-z']+/g) || []).length;
const excerpt = (t, n = 220) => (t.length > n ? `${t.slice(0, n)}…` : t);

async function main() {
  const [shortWav, longWav, veryLongWav] = process.argv.slice(2);
  if (!shortWav || !longWav) {
    console.error('usage: real-transcription-test.js <short.wav> <long.wav> [<very-long.wav>]');
    process.exit(2);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-real-'));
  const journalDir = path.join(tmp, 'jobs');
  const recDir = path.join(tmp, 'recordings');

  const short = decodeWavToPcm(shortWav);
  const long = decodeWavToPcm(longWav);
  console.log(`audio: short ${fmt(secs(short))}, long ${fmt(secs(long))}${veryLongWav ? '' : ''}\n`);

  // 1. Short clip, both engines
  for (const engine of ['whisper', 'parakeet']) {
    const svc = createTranscriptionService({ spawn: spawnWorker, getSpec: () => SPECS[engine], log: quiet, options: { idleMs: 0 } });
    try {
      const cold0 = Date.now();
      const t1 = await svc.transcribe(preprocess(short));
      const cold = Date.now() - cold0;
      const warm0 = Date.now();
      await svc.transcribe(preprocess(short));
      const warm = Date.now() - warm0;
      report(`${engine}: short clip`, words(t1) >= 10, `cold ${cold} ms (incl. model load), warm ${warm} ms → "${excerpt(t1, 160)}"`);
    } catch (err) {
      report(`${engine}: short clip`, false, err.message);
    } finally {
      svc.dispose();
    }
  }

  // 2. Long recording through the pipeline (30 s windows)
  for (const engine of ['parakeet', 'whisper']) {
    const svc = createTranscriptionService({ spawn: spawnWorker, getSpec: () => SPECS[engine], log: quiet, options: { idleMs: 0 } });
    const journal = createJobJournal(journalDir);
    const pipe = createPipeline({ service: svc, journal, recordingsDir: recDir, preprocess, log: quiet });
    try {
      const job = pipe.saveRecording(long, { source: 'dictation' });
      const t0 = Date.now();
      const { text } = await pipe.runJob(job.id);
      const sec = (Date.now() - t0) / 1000;
      pipe.finishJob(job.id);
      const st = svc.getStats();
      report(
        `${engine}: long recording ${fmt(secs(long))}`,
        words(text) > secs(long) * 1.2,
        `${sec.toFixed(1)} s (${(secs(long) / sec).toFixed(1)}x real-time), ${words(text)} words, ${st.completed} windows, worker RSS ${(st.workerRss / 1048576).toFixed(0)} MB\n      "${excerpt(text)}"`,
      );
      fs.writeFileSync(path.join(tmp, `${engine}-long.txt`), text);
    } catch (err) {
      report(`${engine}: long recording`, false, err.message);
    } finally {
      svc.dispose();
    }
  }

  // 3. Hard crash mid-transcription → automatic restart + retry
  {
    const svc = createTranscriptionService({ spawn: spawnWorker, getSpec: () => SPECS.whisper, log: quiet, options: { idleMs: 0 } });
    try {
      await svc.transcribe(preprocess(short)); // worker warm
      const clip = preprocess(long.subarray(0, 25 * 16000));
      const p = svc.transcribe(clip);
      setTimeout(() => { console.log('      … SIGKILL worker mid-transcription'); killAllWorkers(); }, 150);
      const text = await p;
      const st = svc.getStats();
      report('crash mid-job: worker restarted and job retried', st.crashes === 1 && words(text) > 20, `crashes=${st.crashes} retries=${st.retries} spawned=${st.spawned} → "${excerpt(text, 120)}"`);
    } catch (err) {
      report('crash mid-job: worker restarted and job retried', false, err.message);
    } finally {
      svc.dispose();
    }
  }

  // 4. Crash that exhausts retries → failed job with audio → retry after "restart"
  {
    const svc = createTranscriptionService({ spawn: spawnWorker, getSpec: () => SPECS.whisper, log: quiet, options: { idleMs: 0 } });
    const journal = createJobJournal(journalDir);
    const pipe = createPipeline({ service: svc, journal, recordingsDir: recDir, preprocess, log: quiet });
    const job = pipe.saveRecording(short, { source: 'dictation' });
    const killer = setInterval(killAllWorkers, 50); // every attempt dies
    let failedOk = false;
    try {
      await pipe.runJob(job.id);
    } catch (err) {
      const j = journal.get(job.id);
      failedOk = j.status === 'failed' && fs.existsSync(j.audioPath);
      report('crash loop: recording parked in Needs attention with audio', failedOk, `status=${j.status} error="${j.error}" audio=${path.basename(j.audioPath)}`);
    } finally {
      clearInterval(killer);
      svc.dispose();
    }

    // "App restarts": brand-new service/journal/pipeline over the same dirs.
    const svc2 = createTranscriptionService({ spawn: spawnWorker, getSpec: () => SPECS.whisper, log: quiet, options: { idleMs: 0 } });
    const journal2 = createJobJournal(journalDir);
    const pipe2 = createPipeline({ service: svc2, journal: journal2, recordingsDir: recDir, preprocess, log: quiet });
    try {
      const failed = journal2.list({ status: 'failed' });
      const { text } = await pipe2.runJob(failed[0].id);
      pipe2.finishJob(failed[0].id);
      report('retry after restart transcribes the saved audio', failedOk && words(text) >= 10, `"${excerpt(text, 120)}"`);
    } catch (err) {
      report('retry after restart transcribes the saved audio', false, err.message);
    } finally {
      svc2.dispose();
    }
  }

  // 5. Optional very long file (Parakeet) — memory stays flat via 30 s windows + recycling
  if (veryLongWav) {
    const vlong = decodeWavToPcm(veryLongWav);
    const svc = createTranscriptionService({ spawn: spawnWorker, getSpec: () => SPECS.parakeet, log: quiet, options: { idleMs: 0, maxJobsPerWorker: 40 } });
    const pipe = createPipeline({ service: svc, journal: createJobJournal(journalDir), recordingsDir: recDir, preprocess, log: quiet });
    let peak = 0;
    svc.onEvent((e) => { if (e.type === 'recycle') console.log(`      … worker recycled after ${e.jobs} jobs (${(e.rss / 1048576).toFixed(0)} MB)`); });
    const timer = setInterval(() => { peak = Math.max(peak, svc.getStats().workerRss); }, 200);
    try {
      const t0 = Date.now();
      const text = await pipe.transcribePcm(vlong);
      const sec = (Date.now() - t0) / 1000;
      const st = svc.getStats();
      report(
        `parakeet: very long file ${fmt(secs(vlong))}`,
        words(text) > secs(vlong) * 1.2,
        `${sec.toFixed(1)} s (${(secs(vlong) / sec).toFixed(1)}x real-time), ${words(text)} words, ${st.completed} windows, ${st.recycles} recycles, peak worker RSS ${(peak / 1048576).toFixed(0)} MB\n      "${excerpt(text)}"`,
      );
      fs.writeFileSync(path.join(tmp, 'parakeet-very-long.txt'), text);
    } catch (err) {
      report('parakeet: very long file', false, err.message);
    } finally {
      clearInterval(timer);
      svc.dispose();
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed · transcripts in ${tmp}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); killAllWorkers(); process.exit(1); });
