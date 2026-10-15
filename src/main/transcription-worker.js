/**
 * Transcription worker entry point.
 *
 * Launched by transcription-service.js as an Electron utilityProcess (or a
 * Node child process in tests). Native Whisper / Parakeet inference lives
 * here so a crash or OOM kills only this process; the supervisor restarts it
 * and retries the job.
 */

const path = require('path');
const { createEngineHost } = require('./engines/engine-host');

// Messages are processed strictly one at a time — neither native engine is
// re-entrant, and concurrent whisper.cpp calls abort with GGML_ASSERT.
let chain = Promise.resolve();

// Test hook: a fake engine so the real process/IPC/crash path can be tested
// without native models. A clip whose first sample is 999 aborts the process
// like a native crash would; 888 hangs forever.
const fakeEngine = process.env.TELLAFLOW_WORKER_FAKE_ENGINE === '1';

const host = createEngineHost(fakeEngine ? {
  loadWhisperAddon() {
    return async (opts) => {
      const first = opts.pcmf32[0];
      if (first === 999) process.abort();
      if (first === 888) await new Promise(() => {});
      return { transcription: [['', '', `fake ${opts.pcmf32.length} samples pid ${process.pid}`]] };
    };
  },
  loadSherpa() { throw new Error('no sherpa in fake mode'); },
} : {
  loadWhisperAddon(addonDir) {
    const { promisify } = require('util');
    const { whisper } = require(path.join(addonDir, 'whisper.node'));
    return promisify(whisper);
  },
  loadSherpa() {
    return require('sherpa-onnx-node');
  },
});

const port = process.parentPort; // present when run via utilityProcess

function send(msg) {
  if (port) port.postMessage(msg);
  else if (process.send) process.send(msg);
}

function onMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'shutdown') {
    host.dispose();
    process.exit(0);
  }
  chain = chain.then(() => host.handle(msg, send));
}

if (port) port.on('message', (e) => onMessage(e.data));
else process.on('message', onMessage);

process.on('uncaughtException', (err) => {
  // Report and die: the supervisor treats exit as a crash and restarts us.
  try { send({ type: 'fatal', error: err.message }); } catch {}
  process.exit(70);
});

send({ type: 'ready' });
