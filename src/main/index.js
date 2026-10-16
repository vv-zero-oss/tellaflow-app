// Anti-crash guards are installed first so even early startup errors are
// logged instead of killing the app (see crash-guard.js).
const { createCrashGuard } = require('./crash-guard');
const { app, ipcMain, BrowserWindow, Notification, clipboard, dialog, shell, powerMonitor, utilityProcess, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

const crashGuard = createCrashGuard({
  getLogDir: () => { try { return app.getPath('userData'); } catch { return null; } },
  relaunch: () => {
    app.relaunch({ args: [...process.argv.slice(1).filter((a) => a !== '--background-relaunch'), '--background-relaunch'] });
    gracefulQuit();
  },
  // Only recycle the main process when nothing is in flight.
  isIdle: () => !isAnyRecordingActive() && !transcriptionService?.isBusy() && !meetingNotes?.isActive(),
});
crashGuard.install();

const config = require('./config');
const { createTray, getTray, destroyTray } = require('./tray');
const { buildTrayTemplate, PASTE_LAST_ACCELERATOR } = require('./tray-menu');
const { createOnboardingWindow, closeOnboarding, getOnboardingWindow } = require('./onboarding');
const hotkey = require('./hotkey');
const { pasteText, undoPaste } = require('./paste');
const permissions = require('./permissions');
const models = require('./models');
const { trimSilence, normalizeVolume } = require('./audio-preprocess');
const { decodeWavToPcm, createWavWriter } = require('./audio-utils');
const { createTranscriptionService, WorkerCrashError } = require('./transcription-service');
const { createJobJournal } = require('./job-journal');
const { createPipeline } = require('./transcription-pipeline');
const { buildEngineSpec, getActiveEngine, isEngineAvailable } = require('./engine-spec');
const { createModelLoadProgress } = require('./model-load-progress');
const { extractContextVocabulary, buildWhisperPrompt, applyContextVocabulary, isEmptyVocab } = require('./app-context');
const { createAutoLearnWatcher, extractCorrections } = require('./auto-learn');
const { createMeetingDetector } = require('./meeting-detector');
const { createMeetingNotes } = require('./meeting-notes');
const macAutomation = require('./mac-automation');
const { createJarvis } = require('./jarvis');
const osActions = require('./jarvis/desktop/os-actions');
const { setPeekabooDownloadRoot, resolvePeekaboo } = require('./jarvis/desktop/peekaboo');
const { installPeekaboo } = require('./jarvis/desktop/peekaboo-install');
const { currentBbServer } = require('./jarvis/bb/supervisor');
const { buildBbChromeScript } = require('./jarvis/bb/bb-chrome');
const { formatTranscription } = require('./formatter');
const { applyDictionary } = require('./dictionary');
const snippets = require('./snippets');
const { showToast, hideToast, destroyToast, sendToToast, initFloatingBar, setFloatingBarEnabled: toastSetFloatingBarEnabled, getToastWindow, getCurrentToastState, setToastInteractive, getIslandView, showIsland, restIsland, setRestOverride, isResting, refreshPlacement, onIslandRest } = require('./toast');
const { showMainWindow, sendToMainWindow, destroyMainWindow, createMainWindow, getMainWindow } = require('./main-window');
const history = require('./history');
const { closeDb } = require('./db');
const { registerDictionaryPackIpc } = require('./dictionary-pack-ipc');
const sounds = require('./sounds');
const { runStartupSmokeTest } = require('./startup-smoke-test');
const updater = require('./updater');
const { createAppMenu, refreshAppMenu } = require('./app-menu');

// Whisper outputs non-speech annotations in several forms — strip them all
// so they never reach history or clipboard.
//   [BLANK_AUDIO], [NOISE], etc.  — bracketed uppercase tokens
//   (wind blowing), (heartbeat)   — parenthesised sound descriptions
//   *singing*, *laughing*         — asterisk-wrapped action notes
const WHISPER_ARTIFACT_RE =
  /\[\s*(?:BLANK_AUDIO|INAUDIBLE|NOISE|MUSIC|APPLAUSE|LAUGHTER|SILENCE|NO_SPEECH|inaudible|blank_audio)\s*\]|\([^)]+\)|\*[^*]+\*/gi;

function stripWhisperArtifacts(text) {
  if (!text) return '';
  const cleaned = text.replace(WHISPER_ARTIFACT_RE, '').trim();
  return cleaned;
}

// Throttles a progress callback so it fires at most once per `intervalMs`. The
// terminal event (downloaded === total) is always forwarded so the UI doesn't
// stall at 99% just because the previous tick fell inside the throttle window.
// Without this, multi-GB model downloads can fire thousands of IPC messages.
function throttleProgress(fn, intervalMs = 100) {
  let lastSent = 0;
  return (progress) => {
    const now = Date.now();
    const isTerminal = progress && progress.total > 0 && progress.downloaded >= progress.total;
    if (isTerminal || now - lastSent >= intervalMs) {
      lastSent = now;
      fn(progress);
    }
  };
}

let audioCaptureWindow = null;
let isQuitting = false;
let pendingStop = false;

// Streaming chunked transcription session. When the renderer records for >2 min
// it sends intermediate audio chunks via 'audio-chunk' IPC. Each chunk is
// transcribed in parallel with ongoing recording. When 'audio-captured' fires
// (recording stopped), the final tail is transcribed and all results are merged.
// Audio of the session is appended to a WAV on disk as chunks arrive, and a
// journal job exists from the first chunk, so a crash mid-recording still
// leaves a recoverable recording.
let streamingSession = null; // { chunkPromises: Promise<string>[], writer, job }
let recordingTimeout = null;
// Grace period after hotkey release — keeps the mic open a little longer so the
// user's last word isn't clipped when they lift the key slightly before finishing.
const RELEASE_GRACE_MS = 400;
// Safety cap for *click-to-record* only. The hotkey path is bounded by key
// release, so it has no auto-stop. Click mode has no terminator, so without
// this an accidental click would leave the mic running until the app quits.
const CLICK_MODE_MAX_RECORDING_MS = 30 * 60 * 1000;
let accessibilityInitialState = null; // null = not yet checked

// App captured at recording-start (before Electron stole focus).
// Used as a fallback if Electron is still frontmost when paste fires.
let clickPasteTargetApp = null;
// Which key started the recording: 'dictation' types the text, 'command'
// sends it to the assistant.
let recordingPurpose = 'dictation';

// ── Voice island ─────────────────────────────────────────────────────────────
// Who owns what the island shows right now, so its buttons reach the right
// flow: 'dictation' | 'assistant' | 'meeting' | 'learn' | 'error' | null.
let islandOwner = null;
let lastPaste = null;         // { app } — for Undo on the "done" pill
let islandErrorAction = null; // what "Try again" on a dictation error does
let pendingMeeting = null;    // detector info while we ask "Transcribe meeting?"
let pendingLearn = null;      // correction we're offering to the dictionary

function island(owner, state, opts) {
  if (owner !== 'learn') commitUnansweredLearn();
  islandOwner = owner;
  showIsland(state, opts);
}

/** Add learned corrections to the dictionary and tell the user. */
function learnCorrections(corrections, appName) {
  const added = config.addLearnedEntries(corrections);
  if (!added.length) {
    console.log('[auto-learn] corrections already in the dictionary or previously removed — nothing added');
    return added;
  }
  console.log(`[auto-learn] learned ${added.map((a) => `"${a.from}" → "${a.to}"`).join(', ')}${appName ? ` from ${appName}` : ''}`);
  sendToMainWindow('dictionary-changed', config.getDictionary());
  try {
    new Notification({
      title: 'Tellaflow learned a word',
      body: added.map((a) => `${a.from} → ${a.to}`).join(', ') + '. Remove it in Dictionary if it is wrong.',
    }).show();
  } catch (err) { console.warn('[auto-learn] notification failed:', err.message); }
  return added;
}

/** Corrections found in the user's edit: ask on the island, or learn quietly. */
function offerLearnedCorrections(corrections, appName) {
  // Only offer what isn't already in the dictionary / blocked.
  const fresh = config.filterNewLearnedEntries(corrections);
  if (!fresh.length) {
    console.log('[auto-learn] corrections already in the dictionary or previously removed — nothing to offer');
    return;
  }
  // Ask on the island when it's free; otherwise learn quietly.
  if (isResting()) {
    console.log(`[auto-learn] offering ${fresh.map((a) => `"${a.from}" → "${a.to}"`).join(', ')} from ${appName}`);
    pendingLearn = { corrections: fresh, app: appName };
    island('learn', 'dictionary', { correctedWord: fresh[0].to, autoRestMs: 12_000 });
    return;
  }
  learnCorrections(fresh, appName);
}

// The "Add to dictionary?" prompt timed out or was replaced without an answer:
// learn the word anyway (as when the island is busy) rather than dropping it.
// Saying No, or deleting it from Dictionary later, blocks it.
function commitUnansweredLearn() {
  const learn = pendingLearn;
  pendingLearn = null;
  if (learn) learnCorrections(learn.corrections, learn.app);
}

function islandRest() {
  islandOwner = null;
  restIsland();
}

// ── Core services (created in initCoreServices once the app is ready) ───────
let transcriptionService = null;
let journal = null;
let pipeline = null;
let meetingNotes = null;
let meetingDetector = null;
let meetingCaptureWindow = null;
let assistant = null;
let pendingChatUrl = null;   // a chat the island asked the Assistant page to show
let autoLearn = null;
let modelLoading = false;
const modelLoad = createModelLoadProgress({
  getSpec: () => buildEngineSpec(),
  getTimes: () => config.getModelLoadTimes(),
  setTime: (id, ms) => config.setModelLoadTime(id, ms),
  broadcast: (state) => sendToMainWindow('model-load-state', state),
});
// App context (frontmost app, window title, focused text) captured when a
// recording starts; resolves to { ctx, vocab } or null.
let recordingContextPromise = null;

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function getRecordingsDir() {
  return path.join(app.getPath('userData'), 'recordings');
}

function toFloat32(pcmArray) {
  if (pcmArray instanceof Float32Array) return pcmArray;
  return pcmArray && pcmArray.length ? new Float32Array(pcmArray) : null;
}

// Transcription runs in an Electron utility process so a native Whisper /
// Parakeet crash or OOM can't take the app down (see transcription-service.js).
let currentWorkerChild = null;
function spawnTranscriptionWorker({ onMessage, onExit }) {
  const child = utilityProcess.fork(path.join(__dirname, 'transcription-worker.js'), [], {
    serviceName: 'Tellaflow Transcription',
    stdio: 'pipe',
  });
  child.stdout?.on('data', (d) => process.stdout.write(`[worker] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[worker] ${d}`));
  child.on('message', onMessage);
  child.on('exit', onExit);
  currentWorkerChild = child;
  return {
    send: (msg) => child.postMessage(msg),
    kill: () => child.kill(),
  };
}

// raw transcript → artifacts stripped → context vocabulary → dictionary →
// formatting → snippets.
async function postProcessTranscript(raw, { context } = {}) {
  let text = raw;
  if (getActiveEngine() === 'whisper') text = stripWhisperArtifacts(text);
  if (!text) return '';
  if (context && context.vocab && config.getContextAwarenessEnabled()) {
    text = applyContextVocabulary(text, context.vocab);
  }
  text = applyDictionary(text);
  text = formatTranscription(text);
  return snippets.applySnippets(text);
}

function transcribeOptsFor(recCtx) {
  if (!recCtx || isEmptyVocab(recCtx.vocab) || getActiveEngine() !== 'whisper') return undefined;
  if (!config.getContextAwarenessEnabled()) return undefined;
  const prompt = buildWhisperPrompt(recCtx.vocab);
  return prompt ? { spec: buildEngineSpec({ prompt }) } : undefined;
}

/** Called the moment a recording starts: warm the engine, read app context. */
function beginRecording() {
  try { transcriptionService?.prewarm(); } catch {}
  // The command key: start bb and the assistant's thread while the user is
  // still talking — a cold thread is ~14 s to its first word, a warm one ~1.5 s.
  if (recordingPurpose === 'command') assistant?.warm().catch(() => {});
  autoLearn?.stop(true); // a new dictation ends any pending correction watch
  if (process.platform === 'darwin' && config.getContextAwarenessEnabled()) {
    recordingContextPromise = macAutomation.getFrontmostContext()
      .then((ctx) => (ctx && !isOwnApp(ctx.app) ? { ctx, vocab: extractContextVocabulary(ctx) } : null))
      .catch(() => null);
  } else {
    recordingContextPromise = Promise.resolve(null);
  }
}

function peekRecordingContext() {
  const p = recordingContextPromise || Promise.resolve(null);
  // Never let a hung osascript hold up transcription.
  return Promise.race([p, new Promise((r) => setTimeout(() => r(null), 1500))]);
}

async function takeRecordingContext() {
  const ctx = await peekRecordingContext();
  recordingContextPromise = null;
  return ctx;
}

function failedJobsSummary() {
  if (!journal) return [];
  return journal.list({ status: 'failed' }).map((j) => ({
    id: j.id,
    audioPath: j.audioPath,
    source: j.source,
    error: j.error,
    createdAt: j.createdAt,
    durationSec: j.durationSec,
    attempts: j.attempts,
    meetingId: j.meta?.meetingId || null,
  }));
}

function broadcastFailedJobs() {
  sendToMainWindow('failed-jobs-changed', failedJobsSummary());
  try { refreshAppMenu(); } catch {}
}

/** Drop the in-progress streaming session. keep=true parks its audio for retry. */
function abandonStreamingSession({ keep }) {
  const s = streamingSession;
  streamingSession = null;
  if (!s) return;
  try { s.writer.finalize(); } catch {}
  if (keep) {
    pipeline.failJob(s.job.id, new Error('Recording stopped unexpectedly before it was transcribed.'));
    broadcastFailedJobs();
  } else {
    journal.remove(s.job.id, { deleteAudio: true });
  }
}

/** Startup recovery: interrupted jobs, legacy failed rows, orphaned WAVs. */
function recoverJobsOnStartup() {
  let recovered = 0;
  try { recovered += journal.recoverInterrupted(); } catch (err) { console.warn('[recovery] journal:', err.message); }
  try {
    for (const e of history.takeLegacyFailedEntries()) {
      if (!e.audioPath || !fs.existsSync(e.audioPath)) continue;
      const job = journal.create({ audioPath: e.audioPath, source: 'dictation' });
      journal.update(job.id, { createdAt: Number(e.timestamp) || job.createdAt });
      journal.markFailed(job.id, 'Transcription failed (saved by an earlier version).');
      recovered++;
    }
  } catch (err) { console.warn('[recovery] legacy entries:', err.message); }
  try {
    recovered += journal.adoptOrphans(getRecordingsDir(), history.getAllAudioPaths()).length;
  } catch (err) { console.warn('[recovery] orphans:', err.message); }
  if (recovered > 0) {
    console.log(`[recovery] ${recovered} recording(s) need attention`);
    new Notification({
      title: 'Tellaflow — Recordings recovered',
      body: `${recovered} recording${recovered === 1 ? '' : 's'} weren't transcribed. Open Transcripts → Needs attention to retry.`,
    }).show();
  }
}

/** Delete audio older than the retention window (transcripts are kept). */
function pruneOldRecordings() {
  const days = config.getAudioRetentionDays();
  if (!days) return;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  try { removed += history.pruneAudioOlderThan(cutoff); } catch (err) { console.warn('[prune] history:', err.message); }
  // Stray files nobody references and that are past retention.
  try {
    const keep = history.getAllAudioPaths();
    for (const j of journal.list()) if (j.audioPath) keep.add(j.audioPath);
    const dir = getRecordingsDir();
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (keep.has(full)) continue;
      try {
        if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); removed++; }
      } catch {}
    }
  } catch (err) { console.warn('[prune] files:', err.message); }
  if (removed) {
    console.log(`[prune] removed ${removed} recording(s) older than ${days} days`);
    sendToMainWindow('history-update', history.getEntries());
  }
}

// Voice / command-key requests run on the island; the Assistant page still
// lists them.
function startAssistantFromVoice(request) {
  islandOwner = 'assistant';
  assistant.ask(request, { source: 'voice' })
    .catch((err) => {
      console.error('[assistant] start failed:', err);
      island('error', 'error', { content: { notice: { title: 'Couldn’t start the assistant', body: String(err.message || err), primary: null, secondary: 'Dismiss' } } });
    });
}

// ── Meeting notes ───────────────────────────────────────────────────────────
function getMeetingState() {
  const m = meetingNotes?.getActive();
  return {
    enabled: config.getMeetingNotesEnabled(),
    active: !!m,
    app: m?.app || null,
    since: m?.startedAt || null,
    historyId: m?.historyId ?? null,
  };
}

function startMeetingNotes(info = {}) {
  if (!meetingNotes || meetingNotes.isActive()) return;
  meetingNotes.start(info);
  meetingCaptureWindow = new BrowserWindow({
    show: false,
    focusable: false,
    width: 1,
    height: 1,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  meetingCaptureWindow.webContents.on('render-process-gone', () => {
    console.warn('[meeting] capture renderer died — closing meeting notes');
    meetingCaptureWindow = null;
    finishMeetingNotes();
  });
  meetingCaptureWindow.loadFile(path.join(__dirname, '..', 'renderer', 'audio-capture.html'), { query: { mode: 'meeting' } });
  // The island rests on the recording pill (timer + Stop) until it ends.
  pendingMeeting = null;
  const recordingView = { state: 'recording', content: { recordingSince: Date.now() } };
  setRestOverride(recordingView);
  if (isResting() || islandOwner === 'meeting' || !islandOwner) island('meeting', 'recording', recordingView);
  sendToMainWindow('meeting-state', getMeetingState());
  try { refreshAppMenu(); } catch {}
}

/** No microphone access: say so on the island instead of recording silence. */
function micBlocked() {
  if (process.platform !== 'darwin' || permissions.getMicrophoneStatus() === 'granted') return false;
  island('setup', 'setup', {});
  return true;
}

/** Every island button lands here, routed by who owns the island. */
function handleIslandAction(action) {
  if (islandOwner === 'assistant') {
    const r = assistant.action(action);
    if (r && r.retry) { startAssistantFromVoice(r.retry); return; }
    if (r) return;
  }
  switch (action) {
    case 'start-listening':
      startClickRecording();
      break;
    case 'expand-listening':
      hotkey.enterHandsFree();
      break;
    case 'cancel-dictation':
      ipcMain.emit('click-cancel-recording');
      break;
    case 'finish-dictation':
      ipcMain.emit('click-finish-recording');
      break;
    case 'undo':
      if (lastPaste) undoPaste(lastPaste.app);
      lastPaste = null;
      islandRest();
      break;
    case 'dictionary-yes':
    case 'dictionary-no': {
      const learn = pendingLearn;
      pendingLearn = null;
      if (learn && action === 'dictionary-yes') {
        const added = learnCorrections(learn.corrections, learn.app);
        if (added.length) {
          island('dictation', 'done', {
            content: { doneText: `Added “${added[0].to}”${added.length > 1 ? ` +${added.length - 1}` : ''} to dictionary`, canUndo: false },
            autoRestMs: 2500,
          });
          break;
        }
      } else if (learn) {
        config.blockLearnedEntries(learn.corrections);
      }
      islandRest();
      break;
    }
    case 'transcribe':
      startMeetingNotes(pendingMeeting || { app: 'Manual' });
      break;
    case 'not-now':
      pendingMeeting = null;
      islandRest();
      break;
    case 'stop-recording':
      stopMeetingNotes();
      break;
    case 'retry': {
      const target = islandErrorAction;
      islandErrorAction = null;
      islandRest();
      if (target) { showMainWindow(); sendToMainWindow('navigate', target); }
      break;
    }
    case 'open-settings':
      islandRest();
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
      break;
    case 'dismiss':
    case 'later':
    case 'cancel':
      islandErrorAction = null;
      islandRest();
      break;
    default:
      break;
  }
}

function askToTranscribeMeeting(info = {}) {
  if (meetingNotes?.isActive()) return;
  pendingMeeting = info;
  island('meeting', 'meeting', {
    content: {
      notice: {
        title: info.app ? `${info.app} meeting started` : 'A meeting started',
        body: 'Take notes as it happens? Everything is transcribed on this Mac.',
        primary: 'Transcribe meeting',
        secondary: 'Not now',
      },
    },
  });
}

/** Ask the capture page to flush its last chunk; it replies with final=true. */
function stopMeetingNotes() {
  if (meetingCaptureWindow && !meetingCaptureWindow.isDestroyed()) {
    try { meetingCaptureWindow.webContents.send('stop-recording'); } catch {}
    // If the page never answers, finish anyway.
    setTimeout(() => { if (meetingNotes?.isActive()) finishMeetingNotes(); }, 5000);
  } else {
    finishMeetingNotes();
  }
}

function finishMeetingNotes() {
  if (meetingCaptureWindow && !meetingCaptureWindow.isDestroyed()) meetingCaptureWindow.destroy();
  meetingCaptureWindow = null;
  setRestOverride(null);
  if (!meetingNotes?.isActive()) { if (islandOwner === 'meeting') islandRest(); return; }
  if (islandOwner === 'meeting' || isResting()) {
    island('meeting', 'done', { content: { doneText: 'Meeting notes saved', canUndo: false }, autoRestMs: 3000 });
  }
  meetingNotes.stop().then(() => {
    sendToMainWindow('history-update', history.getEntries());
    sendToMainWindow('meeting-state', getMeetingState());
  }).catch((err) => console.warn('[meeting] stop failed:', err.message));
}

function initCoreServices() {
  const userData = app.getPath('userData');
  const recordingsDir = getRecordingsDir();
  fs.mkdirSync(recordingsDir, { recursive: true });

  journal = createJobJournal(path.join(userData, 'jobs'));
  transcriptionService = createTranscriptionService({
    spawn: spawnTranscriptionWorker,
    getSpec: () => buildEngineSpec(),
  });
  transcriptionService.onEvent((e) => {
    if (e.type === 'crash') console.warn(`[transcription] worker crashed (code ${e.code}) — restarting`);
    if (e.type === 'recycle') console.log(`[transcription] worker recycled (${e.reason}, ${e.jobs} jobs, ${(e.rss / 1048576).toFixed(0)} MB)`);
    if (e.type === 'loaded') {
      console.log(`[transcription] ${e.engine} model ready in ${e.ms} ms`);
      modelLoad.finish(true, e.ms);
      if (modelLoading) { modelLoading = false; broadcastStatus('Ready'); }
    }
    if (e.type === 'load-error') {
      console.error('[transcription] model load failed:', e.error);
      modelLoad.finish(false);
      if (modelLoading) { modelLoading = false; broadcastStatus('Model load failed'); }
    }
  });

  pipeline = createPipeline({
    service: transcriptionService,
    journal,
    recordingsDir,
    preprocess: (pcm) => normalizeVolume(trimSilence(pcm)),
    postProcess: (raw, { context }) => postProcessTranscript(raw, { context }),
  });

  meetingNotes = createMeetingNotes({
    pipeline,
    history,
    dir: path.join(userData, 'meetings'),
    recordingsDir,
    onUpdate: () => {
      sendToMainWindow('history-update', history.getEntries());
      broadcastFailedJobs();
    },
  });

  // The island going back to rest while asking "Add to dictionary?" means the
  // question went unanswered — keep the word instead of losing it.
  onIslandRest(() => commitUnansweredLearn());

  autoLearn = createAutoLearnWatcher({
    readFocused: macAutomation.readFocusedField,
    isEnabled: () => process.platform === 'darwin' && config.getAutoLearnEnabled(),
    onLearn: (corrections, { app: appName }) => offerLearnedCorrections(corrections, appName),
  });

  setPeekabooDownloadRoot(path.join(userData, 'tools', 'peekaboo'));
  assistant = createJarvis({
    island: {
      show: (state, opts) => island('assistant', state, opts),
      rest: () => { if (islandOwner === 'assistant') islandRest(); },
    },
    getSettings: () => config.getAssistantSettings(),
    // Where the user was when they pressed the key (read at key-down, before
    // the island or anything of ours could come to the front).
    getContext: async () => {
      const c = await peekRecordingContext();
      return c?.ctx ? { app: c.ctx.app, windowTitle: c.ctx.windowTitle } : null;
    },
    // e2e on Linux: a pretend desktop (scripts/e2e-fake-desktop.js), since
    // Peekaboo is macOS-only. Never set outside the test run.
    os: process.env.TELLAFLOW_E2E === '1' && process.env.TELLAFLOW_E2E_DESKTOP === 'fake'
      ? require(path.join(__dirname, '..', '..', 'scripts', 'e2e-fake-desktop.js'))
      : osActions,
    workspaceDir: path.join(userData, 'assistant', 'workspace'),
    record: (entry) => {
      if (entry.role !== 'mascot' || !entry.text) return;
      sendToMainWindow('assistant-transcript', entry);
    },
    onStatus: (status) => sendToMainWindow('assistant-status', status),
    // The page may not be mounted yet: it takes this on its first load
    // (assistant-workspace-url), and the event covers a page already open.
    openChat: (url) => { pendingChatUrl = { url, at: Date.now() }; showMainWindow(); sendToMainWindow('navigate', 'assistant'); sendToMainWindow('assistant-open-chat', url); },
    openAccessibility: () => { osActions.requestAccessibility().catch(() => {}); },
    openSettings: () => { showMainWindow(); sendToMainWindow('navigate', 'settings'); },
    // Insert: the answer typed into the app the user was in when they pressed
    // the key — the same paste dictation uses.
    insertText: async (text) => {
      const c = await peekRecordingContext();
      const target = c?.ctx?.app && !isOwnApp(c.ctx.app) ? c.ctx.app : null;
      pasteText(text, target);
      lastPaste = { app: target };
      islandRest();
    },
    copyText: (text) => clipboard.writeText(text),
    // Answers live with the transcripts, as the assistant's always have.
    saveAnswer: ({ request, text }) => {
      config.setAssistantUsed(true);
      history.addEntry(`Assistant: ${request}\n\n${text}`, null, { kind: 'assistant' });
      sendToMainWindow('history-update', history.getEntries());
    },
    // Sign in: the AI's own login in Terminal (it opens the browser).
    signIn: async () => {
      let cmd = 'claude';
      try {
        const list = await assistant.providers();
        const pick = config.getAssistantSettings().provider;
        const p = list.find((x) => x.id === pick) || list.find((x) => x.status === 'unauthenticated' || x.status === 'expired');
        if (p?.loginCommand) cmd = p.loginCommand;
      } catch {}
      if (process.platform !== 'darwin') { showMainWindow(); sendToMainWindow('navigate', 'settings'); return; }
      macAutomation.runAppleScript('tell application "Terminal"\nactivate\ndo script (item 1 of argv)\nend tell', [cmd])
        .catch((err) => console.error('[assistant] could not open Terminal for sign-in:', err.message));
    },
    installHelper: (onProgress) => installPeekaboo(onProgress),
  });

  meetingDetector = createMeetingDetector({
    probes: {
      listProcessNames: macAutomation.listProcessNames,
      listRunningApps: macAutomation.listRunningApps,
      getWindowTitles: macAutomation.getWindowTitles,
      getBrowserTabUrls: macAutomation.getBrowserTabUrls,
    },
    checkBrowsers: () => config.getMeetingBrowserDetection(),
    // Ask first; recording starts only if the user says yes.
    onStart: (info) => askToTranscribeMeeting(info),
    onEnd: () => {
      if (pendingMeeting) { pendingMeeting = null; if (islandOwner === 'meeting') islandRest(); }
      stopMeetingNotes();
    },
  });

  recoverJobsOnStartup();
  pruneOldRecordings();
  setInterval(pruneOldRecordings, PRUNE_INTERVAL_MS).unref?.();

  if (process.platform === 'darwin' && config.getMeetingNotesEnabled()) meetingDetector.start();

  // End-to-end test hook (scripts/e2e-electron.mjs). Lets an automated run
  // drive the real dictation pipeline from a WAV file — no microphone — and
  // reach internals for assertions. Never enabled in normal use.
  if (process.env.TELLAFLOW_E2E === '1') {
    globalThis.__tellaflowTest = {
      // Same path as a real recording: renderer → 'audio-captured' IPC.
      dictateWav: (wavPath) => ipcMain.emit('audio-captured', { sender: null }, decodeWavToPcm(wavPath)),
      meetingChunkFromWav: (wavPath) => meetingNotes.addChunk(decodeWavToPcm(wavPath)),
      startMeeting: (appName) => { meetingNotes.start({ app: appName }); sendToMainWindow('meeting-state', getMeetingState()); },
      history: () => history.getEntries(),
      failedJobs: () => failedJobsSummary(),
      journal,
      stats: () => transcriptionService.getStats(),
      // Hard-kill the worker like a native crash would.
      killWorker: () => {
        const pid = currentWorkerChild && currentWorkerChild.pid;
        if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
        return pid || null;
      },
      navigate: (page) => sendToMainWindow('navigate', page),
      // The menubar menu: its items (labels, checks) and a pop-up of it — or of
      // one of its submenus — on the main window, for screenshots.
      trayMenu: {
        items: async () => {
          await refreshTrayMicrophones().catch(() => {});
          const strip = (items) => items.map(({ click, submenu, ...rest }) => ({ ...rest, ...(submenu ? { submenu: strip(submenu) } : {}) }));
          return strip(buildTrayTemplate(trayMenuState(), trayMenuActions));
        },
        popup: async (submenu = null) => {
          await refreshTrayMicrophones().catch(() => {});
          let t = buildTrayTemplate(trayMenuState(), trayMenuActions);
          if (submenu) t = t.find((i) => i.label === submenu).submenu;
          globalThis.__tellaflowTest.trayMenu.open = require('electron').Menu.buildFromTemplate(t);
          globalThis.__tellaflowTest.trayMenu.open.popup({ window: getMainWindow(), x: 640, y: 8 });
        },
        close: () => globalThis.__tellaflowTest.trayMenu.open?.closePopup(),
        click: (label, submenu = null) => {
          let t = buildTrayTemplate(trayMenuState(), trayMenuActions);
          if (submenu) t = t.find((i) => i.label === submenu).submenu;
          t.find((i) => i.label === label).click();
        },
      },
      // What reached the pretend desktop (TELLAFLOW_E2E_DESKTOP=fake).
      fakeDesktop: () => (process.env.TELLAFLOW_E2E_DESKTOP === 'fake'
        ? (({ front, doc, acts }) => ({ front, doc, acts }))(require(path.join(__dirname, '..', '..', 'scripts', 'e2e-fake-desktop.js')).state)
        : null),
      learn: (corrections) => {
        const added = config.addLearnedEntries(corrections);
        sendToMainWindow('dictionary-changed', config.getDictionary());
        return added;
      },
      broadcastFailedJobs,
      // The engine + model files the next transcription will use.
      engineSpec: () => buildEngineSpec(),
      // Voice island: drive the real flows and read what it shows.
      island: {
        state: () => getCurrentToastState(),
        view: () => getIslandView(),
        action: (name) => handleIslandAction(name),
        startClickRecording: () => startClickRecording(),
        askMeeting: (info) => askToTranscribeMeeting(info),
        command: (request) => startAssistantFromVoice(request),
        // Any assistant view, for the island gallery (scripts/e2e-island-assistant.mjs).
        show: (state, opts) => island('assistant', state, opts),
        // Same path as a real edit the watcher saw in another app.
        learnFromEdit: (pasted, before, after) => {
          const corrections = extractCorrections(pasted, before, after);
          if (corrections.length) offerLearnedCorrections(corrections, 'e2e');
          return corrections;
        },
        offerWord: (corrections) => {
          pendingLearn = { corrections, app: 'e2e' };
          island('learn', 'dictionary', { correctedWord: corrections[0].to });
        },
        setRecordingPurpose: (p) => { recordingPurpose = p; },
      },
    };
  }
}

// Returns the name of the current frontmost application asynchronously.
// EC2 — resolves null after 800 ms if osascript hangs, preventing the
// audio-captured handler from stalling indefinitely.
function getFrontmostApp() {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    const timer = setTimeout(() => {
      console.warn('getFrontmostApp timed out');
      resolve(null);
    }, 800);
    execFile('osascript', [
      '-e',
      'tell application "System Events" to get name of first process whose frontmost is true',
    ], (err, stdout) => {
      clearTimeout(timer);
      resolve(err ? null : (stdout.trim() || null));
    });
  });
}

// ── Menubar menu ────────────────────────────────────────────────────────────
// What the menu shows (tray-menu.js builds it) and what its items do.
let trayMicrophones = [];

function lastDictation() {
  try { return history.getEntries().find((e) => e.kind === 'dictation') || null; } catch { return null; }
}

function trayMenuState() {
  const engine = config.getTranscriptionEngine();
  const turbo = config.getModel() === 'turbo';
  const status = updater.getStatus() || {};
  return {
    recording: isAnyRecordingActive(),
    meeting: {
      enabled: config.getMeetingNotesEnabled(),
      active: !!meetingNotes?.isActive(),
      app: meetingNotes?.isActive() ? meetingNotes.getActive().app : null,
    },
    failedCount: journal ? journal.list({ status: 'failed' }).length : 0,
    update: { phase: status.phase, version: status.updateVersion },
    lastTranscript: lastDictation()?.text || '',
    shortcuts: { dictate: config.getHotkey()?.label, command: config.getCommandHotkey()?.label || null },
    microphoneId: config.getMicrophoneDeviceId(),
    microphones: trayMicrophones,
    translation: {
      available: engine === 'whisper' && !turbo,
      unavailableReason: engine === 'parakeet' ? 'Parakeet is English only' : 'Whisper Turbo is English only',
      enabled: !!config.getTranslationEnabled(),
      language: config.getTranslationLanguage(),
    },
  };
}

// The main window stays alive hidden, so its renderer can list the mics.
async function refreshTrayMicrophones() {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  const list = await win.webContents.executeJavaScript(
    "navigator.mediaDevices.enumerateDevices().then((ds) => ds.filter((d) => d.kind === 'audioinput').map((d) => ({ deviceId: d.deviceId, label: d.label })))",
    true,
  );
  if (Array.isArray(list)) trayMicrophones = list;
}

function openPage(page) {
  showMainWindow();
  sendToMainWindow('navigate', page);
}

/** Paste the newest dictation into the app in front (menu item and ⌃⌘V). */
async function pasteLastTranscript() {
  const entry = lastDictation();
  if (!entry?.text) return;
  const front = await getFrontmostApp();
  const target = isOwnApp(front) ? null : front;
  pasteText(entry.text, target);
  lastPaste = { app: target };
}

function registerPasteLastShortcut() {
  try {
    if (!globalShortcut.register(PASTE_LAST_ACCELERATOR, () => { pasteLastTranscript(); })) {
      console.warn(`[tray] ${PASTE_LAST_ACCELERATOR} is taken by another app; Paste Last Transcript is menu-only`);
    }
  } catch (err) {
    console.warn('[tray] could not register the paste-last shortcut:', err.message);
  }
}

const trayMenuActions = {
  open: () => showMainWindow(),
  startRecording: () => {
    // Capture frontmost app synchronously before the menu click steals focus
    clickPasteTargetApp = null;
    try {
      const { execFileSync } = require('child_process');
      const name = execFileSync('osascript', [
        '-e',
        'tell application "System Events" to get name of first process whose frontmost is true',
      ]).toString().trim();
      if (name && !isOwnApp(name)) clickPasteTargetApp = name;
    } catch {}
    startClickRecording();
  },
  stopRecording: () => stopAnyActiveRecording(),
  startMeeting: () => startMeetingNotes({ app: 'Manual' }),
  stopMeeting: () => stopMeetingNotes(),
  checkForUpdates: () => updater.checkForUpdates({ silent: false }),
  installUpdate: () => updater.quitAndInstall(),
  pasteLast: () => { pasteLastTranscript(); },
  openPage,
  setMicrophone: (deviceId) => {
    config.setMicrophoneDeviceId(deviceId);
    sendToMainWindow('config-changed', { microphoneDeviceId: deviceId });
  },
  // 'en' turns translation off; any other code is the language spoken, which
  // Whisper translates to English (the Models page's Translation setting).
  setLanguage: (code) => {
    const enabled = code !== 'en';
    config.setTranslationEnabled(enabled);
    if (enabled) config.setTranslationLanguage(code);
    sendToMainWindow('config-changed', { translationEnabled: enabled, translationLanguage: config.getTranslationLanguage() });
  },
  quit: () => gracefulQuit(),
};

// True when the given app name is our own Electron process (not a real user app).
function isOwnApp(name) {
  if (!name) return true;
  const own = app.getName();
  return name === 'Electron' || name === own;
}

// Suppresses the app.on('activate') → showMainWindow() call that fires
// when the user clicks the toast window and Electron becomes frontmost.
let suppressActivationShow = false;
let suppressActivationTimer = null;

function suppressNextActivation() {
  if (suppressActivationTimer) clearTimeout(suppressActivationTimer);
  suppressActivationShow = true;
  suppressActivationTimer = setTimeout(() => {
    suppressActivationShow = false;
    suppressActivationTimer = null;
  }, 5000);
}

app.setName('Tellaflow');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  showMainWindow();
});

function performCleanup() {
  try { meetingDetector?.stop(); } catch (e) { console.error('meetingDetector.stop error:', e); }
  try { autoLearn?.stop(false); } catch (e) { console.error('autoLearn.stop error:', e); }
  try { if (meetingCaptureWindow && !meetingCaptureWindow.isDestroyed()) meetingCaptureWindow.destroy(); } catch {}
  try { transcriptionService?.dispose(); } catch (e) { console.error('transcriptionService.dispose error:', e); }
  try { hotkey.stop(); } catch (e) { console.error('hotkey.stop error:', e); }
  try { assistant?.dispose(); } catch (e) { console.error('assistant.dispose error:', e); }
  try { destroyToast(); } catch (e) { console.error('destroyToast error:', e); }
  try { destroyAudioCaptureWindow(); } catch (e) { console.error('destroyAudioCaptureWindow error:', e); }
  try { closeOnboarding(); } catch (e) { console.error('closeOnboarding error:', e); }
  try { destroyMainWindow(); } catch (e) { console.error('destroyMainWindow error:', e); }
  // Destroy the tray so its menubar icon disappears immediately when we
  // initiate quit (in particular for the auto-update relaunch path —
  // users were reporting the tray icon lingering because the process
  // never died). Safe to call even if the tray is already gone.
  try { destroyTray(); } catch (e) { console.error('destroyTray error:', e); }
  try { closeDb(); } catch (e) { console.error('closeDb error:', e); }
}

function gracefulQuit() {
  if (isQuitting) return;
  isQuitting = true;
  app.isQuitting = true;
  performCleanup();

  // Force-exit after 3s if cleanup or app.quit() hangs (e.g. native addon keeps event loop alive)
  setTimeout(() => {
    console.warn('Graceful quit timed out, forcing exit.');
    process.exit(0);
  }, 3000).unref();

  app.quit();
}

app.whenReady().then(async () => {
  createAppMenu({
    onCheckForUpdates: () => updater.checkForUpdates({ silent: false }),
    onInstallUpdate: () => updater.quitAndInstall(),
    getUpdaterStatus: () => updater.getStatus(),
  });

  createTray({
    getTemplate: () => buildTrayTemplate(trayMenuState(), trayMenuActions),
    // Microphone names come from Chromium; refresh them before the menu opens.
    beforeOpen: refreshTrayMicrophones,
  });
  registerPasteLastShortcut();

  accessibilityInitialState = permissions.isTrustedAccessibility();
  console.log('Accessibility initial state:', accessibilityInitialState);

  // Clean boot: accessibility already granted, so clear any stale "needs restart" flag
  if (accessibilityInitialState) {
    config.setAccessibilityGrantedOnce(false);
  }

  initCoreServices();
  registerIPC();
  registerDictionaryPackIpc();

  // Start the hotkey listener early so it's available during onboarding playground
  startHotkeyListener();

  if (!config.isOnboardingComplete()) {
    const onboardingWin = createOnboardingWindow();
    // Safety net: if the onboarding window is closed by any means that bypasses
    // the IPC handlers (Cmd+W, force-close, etc.) still start the app so it
    // remains functional in the tray for this session.
    // complete-onboarding sets onboardingComplete=true BEFORE closing the window,
    // so the check below correctly skips calling startApp() a second time.
    onboardingWin.once('closed', () => {
      if (!config.isOnboardingComplete()) {
        startApp().catch(err => console.error('[onboarding] startApp after unexpected close:', err));
      }
    });
  } else {
    await startApp();
  }
});

app.on('activate', () => {
  if (isQuitting) return;
  // Never show the main window when the toast bar is interactive — the click
  // that activated Electron came from the floating bar, not the Dock/app icon.
  // Using the current toast state (not a timer) means this is reliable even
  // if the user pauses on the bar for longer than any fixed timeout.
  const toastState = getCurrentToastState();
  if (toastState === 'floating-idle' || toastState === 'click-recording') return;
  if (!suppressActivationShow) showMainWindow();
});

// Restart hotkey listener after system sleep — keyspy's native process may hang
// or lose its event tap after suspend. Also re-check accessibility in case the
// user toggled it while the lid was closed.
powerMonitor.on('resume', () => {
  console.log('System resumed from sleep — restarting hotkey listener.');
  hotkey.stop();
  startHotkeyListener();
});

app.on('before-quit', () => {
  isQuitting = true;
  app.isQuitting = true;
});

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch {}
  performCleanup();

  // Safety net: force exit if native addons (keyspy, etc.) keep the event loop alive
  setTimeout(() => {
    console.warn('will-quit cleanup timed out, forcing exit.');
    process.exit(0);
  }, 3000).unref();
});

app.on('window-all-closed', () => {
  // On macOS tray apps, don't quit when all windows close — user reopens via tray or dock
  if (process.platform !== 'darwin') {
    gracefulQuit();
  }
});

async function startApp() {
  // After a watchdog relaunch, come back quietly in the menubar.
  createMainWindow({ showOnReady: !process.argv.includes('--background-relaunch') });

  // Wire updater listeners BEFORE the slow model load below so the tray's
  // "Check for Updates…" works even during startup. initAutoUpdater is a no-op
  // in dev (app is not packaged), and the first silent check is delayed 30s
  // internally so it never competes with startup work.
  updater.initAutoUpdater({
    broadcast: (status) => {
      sendToMainWindow('update-status', status);
      // Rebuild the app menu so the item flips between "Check for Updates…"
      // and "Restart to Install Update (vX.Y.Z)" as state changes.
      refreshAppMenu();
    },
    // Run our normal teardown the moment the user accepts the restart prompt,
    // BEFORE Squirrel.Mac sends [NSApp terminate:]. This frees native addons
    // and tears down windows synchronously so nothing keeps the event loop
    // alive while ShipIt is waiting for the process to exit.
    beforeQuitForUpdate: () => {
      isQuitting = true;
      app.isQuitting = true;
      performCleanup();
    },
  });

  if (app.dock) app.dock.show();

  if (getActiveEngine() === 'whisper' && !models.isModelAvailable(config.getModel())) {
    const configuredKey = config.getModel();
    if (models.isModelAvailable('small')) {
      // Silently fall back to small and persist the change
      config.setModel('small');
      new Notification({
        title: 'Tellaflow — Model Changed',
        body: `"${configuredKey}" model not found. Switched to the Small model automatically.`,
      }).show();
      broadcastStatus('Switched to Small model');
      sendToMainWindow('models-changed', models.getModelsStatus());
    } else {
      broadcastStatus('No model downloaded');
      new Notification({
        title: 'Tellaflow — No Model Found',
        body: 'No transcription model is available. Please download one from Settings → Models.',
      }).show();
    }
  }

  if (isEngineAvailable()) {
    // The worker loads the model in the background; status flips to Ready on
    // the service's 'loaded' event.
    modelLoading = true;
    broadcastStatus('Loading model...');
    modelLoad.start();
    transcriptionService.prewarm();

    // Run first-install smoke test in the background — never blocks startup.
    const testAudioPath = app.isPackaged
      ? path.join(process.resourcesPath, 'test.mp3')
      : path.join(__dirname, '..', '..', 'resources', 'test.mp3');
    runStartupSmokeTest({
      userDataPath: app.getPath('userData'),
      audioPath: testAudioPath,
      transcribeFn: (pcm) => transcriptionService.transcribe(pcm),
    }).then(() => {
      console.log('[smoke-test] Test complete.');
    }).catch((err) => {
      console.error('[smoke-test] Unexpected error:', err.message);
    });
  }

  // Bring bb up and warm the assistant's thread in the background, so the
  // first command answers in seconds rather than after a cold start — but
  // only for someone who uses the assistant: a warm is a (tiny) model call,
  // and nobody who only dictates should pay for one on every launch. Their
  // first command warms it on key-down (beginRecording) instead.
  if (config.getAssistantUsed()) setTimeout(() => { assistant?.warm().catch(() => {}); }, 8000).unref?.();

  startHotkeyListener();
  initFloatingBar();

  // Respect showInDock setting on startup
  if (!config.getShowInDock()) {
    if (app.dock) app.dock.hide();
  }
}

function broadcastStatus(text) {
  sendToMainWindow('status-change', text);
  // Also send to onboarding window so the playground can react to hotkey events
  const onboardingWin = getOnboardingWindow();
  if (onboardingWin && !onboardingWin.isDestroyed()) {
    onboardingWin.webContents.send('status-change', text);
  }
}

function clearRecordingTimeout() {
  if (recordingTimeout) {
    clearTimeout(recordingTimeout);
    recordingTimeout = null;
  }
}

function forceStopRecording() {
  console.warn('Force-stopping click-mode recording (30-min safety cap reached).');
  clearRecordingTimeout();
  pendingStop = false;
  hotkey.resetRecordingState();
  sounds.unmuteMusic();
  // Long click-mode recording: the captured target app is stale; let
  // getFrontmostApp() at paste time pick the current window instead.
  clickPasteTargetApp = null;

  if (audioCaptureWindow && !audioCaptureWindow.isDestroyed()) {
    try { audioCaptureWindow.webContents.send('stop-recording'); } catch {}
  }
  setTimeout(() => {
    // Renderer never answered: keep whatever audio reached disk for retry.
    if (streamingSession) abandonStreamingSession({ keep: true });
    destroyAudioCaptureWindow();
    islandRest();
    broadcastStatus('Ready');
  }, 500);
}

function startClickRecording() {
  // Don't start click recording if hotkey recording is already active
  if (audioCaptureWindow && !audioCaptureWindow.isDestroyed()) return;
  if (micBlocked()) return;

  recordingPurpose = 'dictation';
  pendingStop = false;
  clearRecordingTimeout();
  sounds.playStart();
  sounds.muteMusic();
  broadcastStatus('Recording...');
  island('dictation', 'dictating');
  createAudioCaptureWindow();
  beginRecording();
  recordingTimeout = setTimeout(forceStopRecording, CLICK_MODE_MAX_RECORDING_MS);
}

// True whenever any recording flow (hotkey, click, hands-free) is active.
// Used by the tray menu to flip "Start Recording" → "Stop Recording".
function isAnyRecordingActive() {
  if (hotkey.isRunning() && hotkey.getIsRecording && hotkey.getIsRecording()) return true;
  return !!(audioCaptureWindow && !audioCaptureWindow.isDestroyed());
}

// Stop whichever recording flow is currently active, then transcribe.
// Mirrors the click-finish path (graceful release of the mic) and also
// terminates a hands-free hotkey session.
function stopAnyActiveRecording() {
  // Reset hotkey state so a later key release doesn't double-fire onStop.
  // Safe even when no hotkey recording is active.
  try { hotkey.resetRecordingState(); } catch {}

  clearRecordingTimeout();
  sounds.playStop();
  sounds.unmuteMusic();

  if (audioCaptureWindow && !audioCaptureWindow.isDestroyed()) {
    if (audioCaptureWindow.webContents.isLoading()) {
      pendingStop = true;
    } else {
      audioCaptureWindow.webContents.send('stop-recording');
    }
  } else {
    islandRest();
    broadcastStatus('Ready');
  }
}

function startHotkeyListener() {
  // Don't restart if already running — prevents orphaning an active recording
  if (hotkey.isRunning()) return;

  try {
    hotkey.start({
      onStart: ({ purpose } = {}) => {
        // Don't start hotkey recording if click recording is already active
        if (audioCaptureWindow && !audioCaptureWindow.isDestroyed()) return;
        if (micBlocked()) { hotkey.resetRecordingState(); return; }

        // Capture the frontmost app SYNCHRONOUSLY and BEFORE createAudioCaptureWindow().
        // An async query races with window creation — on macOS, creating a new
        // BrowserWindow can briefly activate Electron, corrupting a concurrent
        // osascript query and making it return 'Electron' instead of the user's app.
        clickPasteTargetApp = null;
        try {
          const { execFileSync } = require('child_process');
          const name = execFileSync('osascript', [
            '-e',
            'tell application "System Events" to get name of first process whose frontmost is true',
          ], { timeout: 500 }).toString().trim();
          if (name && !isOwnApp(name)) {
            clickPasteTargetApp = name;
          }
        } catch {}

        recordingPurpose = purpose === 'command' ? 'command' : 'dictation';
        pendingStop = false;
        clearRecordingTimeout();
        sounds.playStart();
        sounds.muteMusic();
        broadcastStatus(recordingPurpose === 'command' ? 'Listening for a command...' : 'Recording...');
        island('dictation', recordingPurpose === 'command' ? 'asking' : 'listening');
        createAudioCaptureWindow();
        beginRecording();
      },
      onHandsFree: () => {
        // Recording continues from the first press, but the bar now also
        // shows X/✓ buttons so the user can finish without touching fn again.
        island('dictation', 'dictating');
        broadcastStatus('Recording (hands-free)...');
      },
      onStop: ({ cancelled, reason }) => {
        clearRecordingTimeout();
        sounds.playStop();
        sounds.unmuteMusic();

        if (cancelled) {
          pendingStop = false;
          clickPasteTargetApp = null;
          recordingContextPromise = null;
          abandonStreamingSession({ keep: false }); // user cancelled: discard audio
          destroyAudioCaptureWindow();
          islandRest();
          broadcastStatus('Ready');
          return;
        }

        // Keep the mic open briefly after key release so the user's last
        // syllable isn't clipped — they often lift the key a split-second
        // before finishing the final word.
        setTimeout(() => {
          if (audioCaptureWindow && !audioCaptureWindow.isDestroyed()) {
            if (audioCaptureWindow.webContents.isLoading()) {
              console.log('Audio window still loading — deferring stop.');
              pendingStop = true;
            } else {
              audioCaptureWindow.webContents.send('stop-recording');
            }
          } else {
            islandRest();
            broadcastStatus('Ready');
          }
        }, RELEASE_GRACE_MS);
      },
    });
    // Hotkey started successfully.
    // Only clear the restart-needed flag when accessibility was already trusted at
    // launch (accessibilityInitialState === true). If accessibility was just granted
    // mid-session (accessibilityInitialState === false), the native event tap may
    // not have activated yet on this process — keep the flag so the main window's
    // restart prompt stays visible and the user is guided to restart.
    if (accessibilityInitialState) {
      config.setAccessibilityGrantedOnce(false);
    } else if (config.getAccessibilityGrantedOnce()) {
      // Accessibility was granted during this session; the hotkey listener started
      // but the event tap might not capture keys until the app restarts.
      broadcastStatus('Restart required');
      // Slight delay so the main window has time to mount its IPC listeners
      // before we send the banner event.
      setTimeout(() => sendToMainWindow('show-restart-banner'), 1500);
    }
  } catch (err) {
    console.warn('Hotkey listener failed:', err.message);

    const accGranted = permissions.isTrustedAccessibility();
    if (accGranted) {
      config.setAccessibilityGrantedOnce(true);
      broadcastStatus('Restart required');
      sendToMainWindow('show-restart-banner');
      new Notification({
        title: 'Tellaflow',
        body: 'Accessibility is granted but a restart is needed for the hotkey to work.',
      }).show();
    } else {
      broadcastStatus('Accessibility required');
      new Notification({
        title: 'Tellaflow',
        body: 'Grant Accessibility permission to enable the hotkey. Use the tray menu to retry.',
      }).show();
    }
  }
}

function createAudioCaptureWindow() {
  if (audioCaptureWindow && !audioCaptureWindow.isDestroyed()) {
    audioCaptureWindow.webContents.send('start-recording', { deviceId: config.getMicrophoneDeviceId() });
    return;
  }

  audioCaptureWindow = new BrowserWindow({
    show: false,
    focusable: false,
    width: 1,
    height: 1,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Anti-crash: if the capture renderer dies mid-recording, reset the
  // recording state (instead of leaving the mic "busy" forever) and keep any
  // audio that already reached disk.
  audioCaptureWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[capture] renderer gone:', details.reason);
    audioCaptureWindow = null;
    pendingStop = false;
    clearRecordingTimeout();
    try { hotkey.resetRecordingState(); } catch {}
    sounds.unmuteMusic();
    if (streamingSession) abandonStreamingSession({ keep: true });
    islandRest();
    broadcastStatus('Ready');
  });

  audioCaptureWindow.loadFile(
    path.join(__dirname, '..', 'renderer', 'audio-capture.html')
  );
}

function destroyAudioCaptureWindow() {
  pendingStop = false;
  if (audioCaptureWindow && !audioCaptureWindow.isDestroyed()) {
    audioCaptureWindow.destroy();
  }
  audioCaptureWindow = null;
}

function registerIPC() {
  // Onboarding
  ipcMain.on('set-hotkey', (_, hotkeyData) => {
    config.setHotkey(hotkeyData);
    // Notify the settings UI so the displayed label updates immediately
    sendToMainWindow('config-changed', { hotkey: hotkeyData });
    // Update the floating bar hint label
    sendToToast('toast-hotkey', hotkeyData?.label || '');
  });

  ipcMain.handle('request-mic-permission', async () => {
    return await permissions.requestMicrophone();
  });

  ipcMain.handle('check-accessibility', () => {
    const granted = permissions.isTrustedAccessibility();
    if (accessibilityInitialState === null) {
      accessibilityInitialState = granted;
    }
    // Accessibility was just granted this session (wasn't granted at launch)
    if (granted && !accessibilityInitialState && !config.getAccessibilityGrantedOnce()) {
      config.setAccessibilityGrantedOnce(true);
      // Broadcast to all windows so they can show a restart prompt
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('accessibility-granted');
      });
    }
    return granted;
  });

  ipcMain.handle('check-mic-permission', () => {
    return permissions.getMicrophoneStatus() === 'granted';
  });

  ipcMain.on('prompt-accessibility', () => {
    permissions.promptAccessibility();
  });

  ipcMain.on('open-accessibility-settings', () => {
    permissions.openAccessibilityPrefs();
  });

  ipcMain.handle('check-screen-permission', () => permissions.isScreenRecordingGranted());
  ipcMain.handle('request-screen-permission', () => permissions.requestScreenRecording());

  ipcMain.on('complete-onboarding', async () => {
    // Clear playground mode immediately — the onboarding window is about to be
    // destroyed and its renderer can no longer send 'playground-mode-off', so
    // we must reset the flag here before startApp() registers the hotkey listener.
    playgroundMode = false;
    config.setOnboardingComplete(true);
    closeOnboarding();
    await startApp();
  });

  ipcMain.on('dismiss-onboarding', () => {
    closeOnboarding();
  });

  // Triggered by the onboarding renderer when the user reaches the final step.
  // Loads + warms up the active model in the background using the bundled
  // test.mp3 so model weights are in memory before the first real dictation.
  ipcMain.on('warm-up-model', () => {
    const { warmUpModel } = require('./model-warmup');
    const { decodeWithFfmpeg } = require('./startup-smoke-test');

    const testAudioPath = app.isPackaged
      ? path.join(process.resourcesPath, 'test.mp3')
      : path.join(__dirname, '..', '..', 'resources', 'test.mp3');

    const opts = {
      audioPath: testAudioPath,
      decodeFn: decodeWithFfmpeg,
      isAvailableFn: isEngineAvailable,
      transcribeFn: (pcm) => transcriptionService.transcribe(pcm),
    };

    warmUpModel(opts).catch((err) => {
      console.error('[warm-up] Unexpected top-level error:', err.message);
    });
  });

  // Returns the model test result so the onboarding playground can confirm
  // the transcription pipeline is working before the user does a live dry-run.
  // A dedup promise ensures React StrictMode's double-invoke (and any other
  // rapid-fire calls) share a single in-flight test rather than crashing the
  // native addon with concurrent transcriptions.
  let _modelTestPromise = null;
  ipcMain.handle('run-model-test', async () => {
    if (_modelTestPromise) return _modelTestPromise;

    const { warmUpModel } = require('./model-warmup');
    const { decodeWithFfmpeg } = require('./startup-smoke-test');

    const testAudioPath = app.isPackaged
      ? path.join(process.resourcesPath, 'test.mp3')
      : path.join(__dirname, '..', '..', 'resources', 'test.mp3');

    const opts = {
      audioPath: testAudioPath,
      decodeFn: decodeWithFfmpeg,
      isAvailableFn: isEngineAvailable,
      transcribeFn: (pcm) => transcriptionService.transcribe(pcm),
    };

    _modelTestPromise = warmUpModel(opts)
      .catch((err) => ({ skipped: true, reason: 'error', error: err.message }))
      .finally(() => { _modelTestPromise = null; });

    return _modelTestPromise;
  });

  // Playground mode: when active, transcription results are routed back to the
  // onboarding window instead of being pasted into external apps.
  let playgroundMode = false;
  ipcMain.on('playground-mode-on',  () => { playgroundMode = true; });
  ipcMain.on('playground-mode-off', () => { playgroundMode = false; });

  // Settings
  ipcMain.handle('get-config', () => {
    return {
      hotkey: config.getHotkey(),
      model: config.getModel(),
      programmingMode: config.getProgrammingMode(),
      theme: config.getTheme(),
      floatingBarEnabled: config.getFloatingBarEnabled(),
      soundsEnabled: config.getSoundsEnabled(),
      muteWhileDictating: config.getMuteWhileDictating(),
      showInDock: config.getShowInDock(),
      launchAtLogin: app.getLoginItemSettings().openAtLogin,
      translationEnabled: config.getTranslationEnabled(),
      translationLanguage: config.getTranslationLanguage(),
      transcriptionEngine: config.getTranscriptionEngine(),
      parakeetAvailable: models.isParakeetAvailable(),
      parakeetVariant: config.getParakeetVariant(),
      microphoneDeviceId: config.getMicrophoneDeviceId(),
      hotkeyActivationDelay: config.getHotkeyActivationDelay(),
      autoLearnEnabled: config.getAutoLearnEnabled(),
      contextAwarenessEnabled: config.getContextAwarenessEnabled(),
      meetingNotesEnabled: config.getMeetingNotesEnabled(),
      meetingBrowserDetection: config.getMeetingBrowserDetection(),
      audioRetentionDays: config.getAudioRetentionDays(),
      commandHotkey: config.getCommandHotkey(),
      islandPlacement: config.getIslandPlacement(),
      islandMaterial: config.getIslandMaterial(),
    };
  });

  // Feature toggles added in 0.9 share one setter with an allow-list.
  const FEATURE_SETTERS = {
    autoLearnEnabled: (v) => config.setAutoLearnEnabled(v),
    contextAwarenessEnabled: (v) => config.setContextAwarenessEnabled(v),
    meetingBrowserDetection: (v) => config.setMeetingBrowserDetection(v),
    audioRetentionDays: (v) => {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) { config.setAudioRetentionDays(n); pruneOldRecordings(); }
    },
    islandPlacement: (v) => { config.setIslandPlacement(v); refreshPlacement(); },
    islandMaterial: (v) => { config.setIslandMaterial(v); refreshPlacement(); },
    commandHotkey: (v) => config.setCommandHotkey(v),
    meetingNotesEnabled: (v) => {
      config.setMeetingNotesEnabled(!!v);
      if (v && process.platform === 'darwin') meetingDetector.start();
      else { meetingDetector.stop(); stopMeetingNotes(); }
      sendToMainWindow('meeting-state', getMeetingState());
    },
  };
  ipcMain.handle('set-feature-setting', (_, key, value) => {
    const setter = FEATURE_SETTERS[key];
    if (!setter) throw new Error(`Unknown setting: ${key}`);
    setter(value);
    sendToMainWindow('config-changed', { [key]: value });
    return true;
  });

  function reloadEngine() {
    transcriptionService.reset();
    if (!isEngineAvailable()) { modelLoad.finish(false); return; }
    modelLoading = true;
    broadcastStatus('Loading model...');
    modelLoad.start();
    transcriptionService.prewarm();
  }

  ipcMain.on('set-model', (_, model) => {
    config.setModel(model);
    reloadEngine();
  });

  ipcMain.on('set-transcription-engine', (_, engine) => {
    config.setTranscriptionEngine(engine);
    // Swap the worker's engine now so the first transcription is fast.
    reloadEngine();
    sendToMainWindow('config-changed', {
      transcriptionEngine: engine,
      parakeetAvailable: models.isParakeetAvailable(),
    });
  });

  ipcMain.on('set-microphone-device-id', (_, deviceId) => {
    config.setMicrophoneDeviceId(deviceId);
    sendToMainWindow('config-changed', { microphoneDeviceId: deviceId });
  });

  // Parakeet variants: 'v2' (bundled) and 'unified'. Every call names one.
  const parakeetVariantArg = (v) => (models.PARAKEET_VARIANTS[v] ? v : 'v2');

  ipcMain.handle('get-parakeet-status', (_, variant) => models.getParakeetStatus(parakeetVariantArg(variant)));

  ipcMain.on('start-parakeet-download', (_, variant) => {
    const v = parakeetVariantArg(variant);
    models.startParakeetDownload(v, {
      onProgress: throttleProgress((p) => sendToMainWindow('parakeet-download-progress', p)),
      onComplete: () => {
        sendToMainWindow('parakeet-status-changed', models.getParakeetStatus(v));
        // Auto-load the model after download if it's the one in use
        if (getActiveEngine() === 'parakeet' && config.getParakeetVariant() === v) reloadEngine();
      },
      onError: (err) => {
        console.error('Parakeet download error:', err.message);
        sendToMainWindow('parakeet-download-error', { variant: v, error: err.message });
        sendToMainWindow('parakeet-status-changed', models.getParakeetStatus(v));
      },
    });
    sendToMainWindow('parakeet-status-changed', models.getParakeetStatus(v));
  });

  ipcMain.on('cancel-parakeet-download', (_, variant) => {
    const v = parakeetVariantArg(variant);
    models.cancelParakeetDownload(v);
    sendToMainWindow('parakeet-status-changed', models.getParakeetStatus(v));
  });

  ipcMain.on('delete-parakeet', (_, variant) => {
    const v = parakeetVariantArg(variant);
    transcriptionService.reset();
    models.deleteParakeet(v);
    // Deleting the model in use: fall back to the other Parakeet, else Whisper.
    if (config.getParakeetVariant() === v) {
      const other = Object.keys(models.PARAKEET_VARIANTS).find((k) => k !== v && models.isParakeetAvailable(k));
      if (other) config.setParakeetVariant(other);
      else if (config.getTranscriptionEngine() === 'parakeet') config.setTranscriptionEngine('whisper');
    }
    reloadEngine();
    sendToMainWindow('parakeet-status-changed', models.getParakeetStatus(v));
    sendToMainWindow('config-changed', {
      transcriptionEngine: config.getTranscriptionEngine(),
      parakeetVariant: config.getParakeetVariant(),
      parakeetAvailable: models.isParakeetAvailable(),
    });
  });

  ipcMain.on('set-parakeet-variant', (_, variant) => {
    config.setParakeetVariant(parakeetVariantArg(variant));
    reloadEngine();
    sendToMainWindow('config-changed', {
      parakeetVariant: config.getParakeetVariant(),
      parakeetAvailable: models.isParakeetAvailable(),
    });
  });

  ipcMain.on('set-programming-mode', (_, enabled) => {
    config.setProgrammingMode(enabled);
  });

  ipcMain.on('set-theme', (_, theme) => {
    config.setTheme(theme);
  });

  // Dictionary management
  ipcMain.handle('get-dictionary', () => {
    return config.getDictionary();
  });

  ipcMain.handle('add-dictionary-entry', (_, { from, to }) => {
    return config.addDictionaryEntry(from, to);
  });

  ipcMain.handle('remove-dictionary-entry', (_, id) => {
    return config.removeDictionaryEntry(id);
  });

  ipcMain.handle('update-dictionary-entry', (_, { id, from, to }) => {
    return config.updateDictionaryEntry(id, from, to);
  });

  // Snippets management
  ipcMain.handle('get-snippets', () => {
    return snippets.getSnippets();
  });

  ipcMain.handle('add-snippet', (_, { trigger, content }) => {
    return snippets.addSnippet(trigger, content);
  });

  ipcMain.handle('remove-snippet', (_, id) => {
    return snippets.removeSnippet(id);
  });

  ipcMain.handle('update-snippet', (_, { id, trigger, content }) => {
    return snippets.updateSnippet(id, trigger, content);
  });

  ipcMain.handle('clear-snippets', () => {
    return snippets.clearSnippets();
  });

  ipcMain.handle('clear-dictionary', () => {
    return config.clearDictionary();
  });

  ipcMain.handle('reset-permissions', () => {
    config.setAccessibilityGrantedOnce(false);
    config.setOnboardingComplete(false);
    return true;
  });

  // Model management
  ipcMain.handle('get-models', () => {
    return models.getModelsStatus();
  });

  ipcMain.on('start-download', (_, modelKey) => {
    models.startDownload(modelKey, {
      onProgress: throttleProgress((progress) => {
        sendToMainWindow('download-progress', progress);
      }),
      onComplete: () => {
        sendToMainWindow('models-changed', models.getModelsStatus());
      },
      onError: (err) => {
        console.error(`Download ${modelKey} failed:`, err.message);
        sendToMainWindow('download-error', { modelKey, error: err.message });
        sendToMainWindow('models-changed', models.getModelsStatus());
      },
    });
  });

  ipcMain.on('pause-download', (_, modelKey) => {
    models.pauseDownload(modelKey);
    sendToMainWindow('models-changed', models.getModelsStatus());
  });

  ipcMain.on('cancel-download', (_, modelKey) => {
    models.cancelDownload(modelKey);
    sendToMainWindow('models-changed', models.getModelsStatus());
  });

  ipcMain.on('delete-model', (_, modelKey) => {
    models.deleteModel(modelKey);
    sendToMainWindow('models-changed', models.getModelsStatus());
  });

  // Permission grant actions
  ipcMain.handle('grant-mic', async () => {
    const granted = await permissions.requestMicrophone();
    return granted;
  });

  ipcMain.on('grant-accessibility', () => {
    permissions.promptAccessibility();
    permissions.openAccessibilityPrefs();
  });

  ipcMain.on('retry-hotkey', () => {
    startHotkeyListener();
  });

  // ── Hotkey recording session ──────────────────────────────────────────────
  // The renderer cannot detect fn/system keys via DOM — use keyspy in main.
  let recordingSession = null; // { listener, senderWebContents, timer }

  function stopRecordingSession() {
    if (!recordingSession) return;
    clearTimeout(recordingSession.timer);
    try { recordingSession.listener.kill(); } catch {}
    recordingSession = null;
  }

  ipcMain.on('start-hotkey-recording', (event) => {
    stopRecordingSession(); // cancel any previous session
    hotkey.stop(); // pause main hotkey listener to avoid conflicts

    let GlobalKeyboardListener;
    try {
      ({ GlobalKeyboardListener } = require('keyspy'));
    } catch (err) {
      console.error('keyspy unavailable for hotkey recording:', err.message);
      if (!event.sender.isDestroyed()) event.sender.send('hotkey-recording-cancelled');
      startHotkeyListener();
      return;
    }

    let tempListener;
    try {
      tempListener = new GlobalKeyboardListener({ mac: { appName: 'Tellaflow' } });
    } catch (err) {
      console.error('Failed to create hotkey recording listener:', err.message);
      if (!event.sender.isDestroyed()) event.sender.send('hotkey-recording-cancelled');
      startHotkeyListener();
      return;
    }

    // Keys to ignore as the sole trigger (pure modifiers pressed alone are fine
    // only as part of a combo — but we DO allow them as single-key hotkeys too).
    // We filter out keys that would be disruptive (e.g. mouse events).
    const IGNORED_SOLO = new Set(['MOUSE LEFT', 'MOUSE RIGHT', 'MOUSE MIDDLE']);

    tempListener.addListener((e, down) => {
      if (e.state !== 'DOWN') return;
      if (IGNORED_SOLO.has(e.name)) return;

      // Collect all currently held key names (modifiers + the trigger)
      const heldModifiers = Object.entries(down)
        .filter(([name, isDown]) => isDown && name !== e.name)
        .map(([name]) => name)
        // Only keep recognized modifier-like names
        .filter(n => /CTRL|SHIFT|ALT|META|FUNCTION|FN/i.test(n));

      const names = [...heldModifiers, e.name];

      // Build human-readable label
      const LABEL_MAP = {
        'LEFT CTRL': 'Left Control (^)', 'RIGHT CTRL': 'Right Control (^)',
        'LEFT ALT': 'Left Option (⌥)', 'RIGHT ALT': 'Right Option (⌥)',
        'LEFT SHIFT': 'Left Shift (⇧)', 'RIGHT SHIFT': 'Right Shift (⇧)',
        'LEFT META': 'Left Command (⌘)', 'RIGHT META': 'Right Command (⌘)',
        'FN': 'fn',
        'SPACE': 'Space', 'RETURN': 'Return', 'ESCAPE': 'Esc',
        'BACKSPACE': 'Backspace', 'TAB': 'Tab',
      };
      const labelParts = names.map(n => LABEL_MAP[n] || n);
      const label = labelParts.join(' + ');

      if (!event.sender.isDestroyed()) {
        event.sender.send('hotkey-recorded', { names, label });
      }
      stopRecordingSession();
      startHotkeyListener(); // resume main hotkey listener
    });

    const timer = setTimeout(() => {
      stopRecordingSession();
      startHotkeyListener(); // resume main hotkey listener on timeout
      if (!event.sender.isDestroyed()) {
        event.sender.send('hotkey-recording-cancelled');
      }
    }, 10000);

    recordingSession = { listener: tempListener, senderWebContents: event.sender, timer };
  });

  ipcMain.on('stop-hotkey-recording', () => {
    stopRecordingSession();
    startHotkeyListener(); // resume main hotkey listener
  });

  ipcMain.handle('check-needs-restart', () => {
    // Stable: accessibility was absent at launch and has since been granted this session
    return config.getAccessibilityGrantedOnce() && !accessibilityInitialState;
  });

  ipcMain.on('restart-app', () => {
    // If the restart is triggered from the onboarding "Restart Now" button,
    // permissions are already granted — mark onboarding complete so the app
    // starts normally after the restart instead of showing onboarding again.
    if (!config.isOnboardingComplete()) {
      config.setOnboardingComplete(true);
    }
    performCleanup();
    app.relaunch();
    app.exit(0);
  });

  // History
  ipcMain.handle('get-history', () => {
    return history.getEntries();
  });

  ipcMain.on('clear-history', () => {
    history.clearHistory();
  });

  ipcMain.handle('delete-history-entry', (_, id) => {
    history.deleteEntry(id);
    return history.getEntries();
  });

  // Legacy per-history-entry retry (kept for older renderer builds).
  ipcMain.handle('retry-transcription', async (_, entryId) => {
    const entry = history.getEntryById(entryId);
    if (!entry || !entry.audioPath) throw new Error('No audio to retry');
    let pcm;
    try {
      pcm = decodeWavToPcm(entry.audioPath);
    } catch {
      throw new Error('Audio file is corrupted or missing');
    }
    const raw = await pipeline.transcribePcm(pcm);
    if (!raw) throw new Error('No speech detected in audio');
    const text = await postProcessTranscript(raw);
    history.updateEntryText(entryId, text);
    sendToMainWindow('history-update', history.getEntries());
    return text;
  });

  // ── Needs attention: failed / crash-interrupted recordings ────────────────
  async function retryJob(id) {
    const job = journal.get(id);
    if (!job) throw new Error('This recording is no longer available.');
    if (!job.audioPath || !fs.existsSync(job.audioPath)) {
      journal.remove(id);
      broadcastFailedJobs();
      throw new Error('The audio file for this recording is missing.');
    }
    broadcastStatus('Transcribing...');
    try {
      const { text } = await pipeline.runJob(id);
      if (job.source === 'meeting' && job.meta?.meetingId) {
        meetingNotes.addSegment(job.meta.meetingId, job.meta.seq, text, job.meta.at);
        pipeline.finishJob(id, { keepAudio: false });
      } else if (text) {
        history.addEntry(text, job.audioPath, { timestamp: job.createdAt });
        pipeline.finishJob(id);
      } else {
        pipeline.finishJob(id, { keepAudio: false }); // only silence
      }
      sendToMainWindow('history-update', history.getEntries());
      return text;
    } finally {
      broadcastFailedJobs();
      broadcastStatus('Ready');
    }
  }

  ipcMain.handle('get-failed-jobs', () => failedJobsSummary());
  ipcMain.handle('retry-failed-job', (_, id) => retryJob(String(id)));
  ipcMain.handle('retry-all-failed-jobs', async () => {
    let ok = 0;
    let failed = 0;
    for (const j of failedJobsSummary().reverse()) { // oldest first
      try { await retryJob(j.id); ok++; } catch { failed++; }
    }
    return { ok, failed };
  });
  ipcMain.handle('discard-failed-job', (_, id) => {
    journal.remove(String(id), { deleteAudio: true });
    broadcastFailedJobs();
    return failedJobsSummary();
  });
  ipcMain.handle('get-transcription-stats', () => transcriptionService.getStats());

  // ── Meeting notes ─────────────────────────────────────────────────────────
  ipcMain.handle('get-meeting-state', () => getMeetingState());
  ipcMain.handle('start-meeting-notes', () => {
    startMeetingNotes({ app: 'Manual', reason: 'started from Tellaflow' });
    return getMeetingState();
  });
  ipcMain.handle('stop-meeting-notes', () => {
    stopMeetingNotes();
    return getMeetingState();
  });
  ipcMain.on('meeting-chunk', (event, pcmArray, info) => {
    if (!meetingCaptureWindow || event.sender !== meetingCaptureWindow.webContents) return;
    const pcm = toFloat32(pcmArray);
    if (pcm && pcm.length) meetingNotes.addChunk(pcm);
    if (info && info.final) finishMeetingNotes();
  });

  // ── Assistant ─────────────────────────────────────────────────────────────
  // The island conversation runs in main; the Assistant page frames bb itself.
  const errorOf = (err) => ({ ok: false, error: String(err?.message || err) });
  ipcMain.handle('assistant-ask', (_, request) => { islandOwner = 'assistant'; assistant.ask(String(request || ''), { source: 'typed' }); return true; });
  ipcMain.handle('assistant-stop', () => assistant.stop());
  ipcMain.handle('assistant-status', () => assistant.status());
  ipcMain.handle('assistant-providers', () => assistant.providers().catch(() => []));
  ipcMain.handle('assistant-workspace-url', (_, threadId) => {
    // The chat the island's "Open chat" just asked for wins over the list for
    // a few seconds — not once: the page can mount twice in a row (React's dev
    // double mount, a second navigate), and the second must not lose it.
    if (pendingChatUrl && Date.now() - pendingChatUrl.at > 15_000) pendingChatUrl = null;
    if (pendingChatUrl && (threadId === undefined || threadId === null)) {
      const { url } = pendingChatUrl;
      return { ok: true, url, origin: new URL(url).origin };
    }
    if (threadId === '') pendingChatUrl = null; // the Chats button asked for the list
    return assistant.workspaceUrl(typeof threadId === 'string' ? threadId : undefined).then((r) => ({ ok: true, ...r }), errorOf);
  });
  ipcMain.handle('assistant-transcript', () => assistant.transcript());
  // bb's framed app in Tellaflow's theme (src/main/jarvis/bb/bb-chrome.js).
  // Only ever into a frame of the window that asked, served by OUR bb.
  ipcMain.handle('assistant-style-frame', async (event, options) => {
    const server = currentBbServer();
    if (!server) return { ok: false, error: 'the assistant is not running' };
    const origin = server.client.origin;
    const frames = event.sender.mainFrame.framesInSubtree.filter((f) => {
      try { return new URL(f.url).origin === origin; } catch { return false; }
    });
    const script = buildBbChromeScript({
      theme: options?.theme === 'dark' ? 'dark' : 'light',
      tokens: options?.tokens && typeof options.tokens === 'object' ? options.tokens : {},
    });
    let applied = 0;
    for (const frame of frames) {
      try { await frame.executeJavaScript(script); applied++; } catch (err) { console.warn('[assistant] could not style bb:', err.message); }
    }
    return { ok: applied > 0, applied };
  });
  ipcMain.handle('assistant-reset', () => assistant.reset());
  ipcMain.handle('assistant-get-settings', () => config.getAssistantSettings());
  ipcMain.handle('assistant-set-settings', (_, patch) => config.setAssistantSettings(patch || {}));
  // The desktop helper (Peekaboo), downloaded on request — pinned and checksummed.
  ipcMain.handle('assistant-install-helper', async () => {
    try {
      await installPeekaboo((received, total) => sendToMainWindow('assistant-helper-progress', { received, total }));
      return { ok: true };
    } catch (err) { return errorOf(err); }
  });
  ipcMain.handle('assistant-request-accessibility', () => osActions.requestAccessibility());
  ipcMain.handle('assistant-desktop-status', async () => {
    const [status, helper] = await Promise.all([osActions.getOsStatus().catch(() => null), resolvePeekaboo(true).catch(() => null)]);
    return { status, helper };
  });

  ipcMain.handle('get-audio-data', async (_, filePath) => {
    const fsp = require('fs').promises;
    if (!filePath || typeof filePath !== 'string') return null;
    // Prevent path traversal — only allow files inside the recordings directory
    const recordingsDir = getRecordingsDir();
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(recordingsDir + path.sep)) return null;
    let buf;
    try {
      buf = await fsp.readFile(resolved);
    } catch {
      return null;
    }
    // buf.buffer returns the underlying ArrayBuffer from Node's pool, which may
    // be larger than the file contents. Slice to the exact byte range.
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.on('copy-to-clipboard', (_, text) => {
    clipboard.writeText(text);
  });

  ipcMain.on('paste-text', (_, text) => {
    pasteText(text);
  });

  // Open test WAV file dialog
  ipcMain.on('open-external', (_, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // Auto-update IPC
  ipcMain.handle('get-update-status', () => updater.getStatus());
  ipcMain.handle('get-model-load-state', () => modelLoad.getState());
  ipcMain.on('check-for-updates', () => {
    updater.checkForUpdates({ silent: false });
  });
  ipcMain.on('install-update', () => {
    updater.quitAndInstall();
  });

  ipcMain.on('open-test-wav', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a'] }],
      properties: ['openFile'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      processWavFile(result.filePaths[0]);
    }
  });

  ipcMain.on('audio-level', (event, level) => {
    // Meeting capture runs silently in the background — no waveform.
    if (meetingCaptureWindow && event.sender === meetingCaptureWindow.webContents) return;
    sendToToast('audio-level', level);
  });

  // ── Floating bar: capture frontmost app before click steals focus ─────────
  // Called from the renderer on hover-start (before the click activates Electron)
  // so we know which app to re-focus when pasting the transcription result.
  ipcMain.on('record-frontmost-app', () => {
    // Suppress the activate→showMainWindow handler so clicking the toast
    // doesn't bring the main settings window to the front.
    suppressNextActivation();

    // EC1 — always reset first so a failed capture (Electron frontmost) never
    // leaves a stale value from a previous recording session in place.
    clickPasteTargetApp = null;

    // Sync call on hover: blocks for ~100ms but that's invisible to the user
    // since no animation has started yet. Eliminates the race where the user
    // clicks before the async result returns and clickPasteTargetApp is still null.
    try {
      const { execFileSync } = require('child_process');
      const name = execFileSync('osascript', [
        '-e',
        'tell application "System Events" to get name of first process whose frontmost is true',
      ]).toString().trim();
      if (name && !isOwnApp(name)) {
        clickPasteTargetApp = name;
      }
    } catch {}
  });

  // Fired on mousedown on the trigger strip — runs suppressNextActivation again
  // right before the click activates Electron, as a belt-and-suspenders guard
  // in case the hover timer already expired.
  ipcMain.on('suppress-toast-activation', () => {
    suppressNextActivation();
  });

  // Renderer hover signal — captures the mouse only while the cursor is over a
  // visibly-rendered element (pill or trigger strip). Outside those elements
  // the floating bar stays click-through so apps behind it stay usable.
  ipcMain.on('set-toast-interactive', (_, interactive) => {
    setToastInteractive(!!interactive);
  });

  ipcMain.on('island-action', (_, action) => {
    try { handleIslandAction(String(action)); } catch (err) { console.error('[island] action failed:', action, err); }
  });

  // ── Floating bar click-to-dictate ─────────────────────────────────────────
  ipcMain.on('click-start-recording', () => {
    // clickPasteTargetApp is set by record-frontmost-app (fired on hover, before
    // the click activates Electron). No extra capture needed here.
    startClickRecording();
  });

  ipcMain.on('click-cancel-recording', () => {
    clearRecordingTimeout();
    sounds.playStop();
    sounds.unmuteMusic();
    pendingStop = false;
    clickPasteTargetApp = null;
    recordingContextPromise = null;
    abandonStreamingSession({ keep: false }); // user cancelled: discard audio
    // Clear hotkey state too — a hands-free session may be active behind
    // this toast button, and we don't want a later key release to fire
    // a duplicate onStop.
    try { hotkey.resetRecordingState(); } catch {}
    destroyAudioCaptureWindow();
    islandRest();
    broadcastStatus('Ready');
  });

  ipcMain.on('click-finish-recording', () => {
    clearRecordingTimeout();
    sounds.playStop();
    sounds.unmuteMusic();
    try { hotkey.resetRecordingState(); } catch {}
    if (audioCaptureWindow && !audioCaptureWindow.isDestroyed()) {
      if (audioCaptureWindow.webContents.isLoading()) {
        pendingStop = true;
      } else {
        audioCaptureWindow.webContents.send('stop-recording');
      }
    } else {
      islandRest();
      broadcastStatus('Ready');
    }
  });

  // ── System settings IPC ───────────────────────────────────────────────────
  ipcMain.handle('get-floating-bar-enabled', () => config.getFloatingBarEnabled());
  ipcMain.on('set-floating-bar-enabled', (_, enabled) => {
    toastSetFloatingBarEnabled(enabled);
  });

  ipcMain.handle('get-sounds-enabled', () => config.getSoundsEnabled());
  ipcMain.on('set-sounds-enabled', (_, enabled) => {
    config.setSoundsEnabled(enabled);
  });

  ipcMain.handle('get-mute-while-dictating', () => config.getMuteWhileDictating());
  ipcMain.on('set-mute-while-dictating', (_, enabled) => {
    config.setMuteWhileDictating(enabled);
  });

  ipcMain.handle('get-hotkey-activation-delay', () => config.getHotkeyActivationDelay());
  ipcMain.on('set-hotkey-activation-delay', (_, ms) => {
    config.setHotkeyActivationDelay(ms);
  });

  ipcMain.handle('get-show-in-dock', () => config.getShowInDock());
  ipcMain.on('set-show-in-dock', (_, enabled) => {
    config.setShowInDock(enabled);
    if (app.dock) {
      if (enabled) {
        app.dock.show();
      } else {
        app.dock.hide();
      }
    }
  });

  ipcMain.handle('get-launch-at-login', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.on('set-launch-at-login', (_, enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
  });

  ipcMain.handle('get-translation-enabled', () => config.getTranslationEnabled());
  ipcMain.on('set-translation-enabled', (_, enabled) => {
    config.setTranslationEnabled(enabled);
  });

  ipcMain.handle('get-translation-language', () => config.getTranslationLanguage());
  ipcMain.on('set-translation-language', (_, lang) => {
    config.setTranslationLanguage(lang);
  });

  // Audio capture window signals it's loaded and ready
  ipcMain.on('capture-ready', (event) => {
    if (meetingCaptureWindow && !meetingCaptureWindow.isDestroyed() && event.sender === meetingCaptureWindow.webContents) {
      meetingCaptureWindow.webContents.send('start-recording', { deviceId: config.getMicrophoneDeviceId() });
      return;
    }
    if (!audioCaptureWindow || audioCaptureWindow.isDestroyed()) return;

    if (pendingStop) {
      console.log('Audio window ready but stop was pending — start+stop immediately.');
      pendingStop = false;
      audioCaptureWindow.webContents.send('start-recording', { deviceId: config.getMicrophoneDeviceId() });
      setTimeout(() => {
        if (audioCaptureWindow && !audioCaptureWindow.isDestroyed()) {
          audioCaptureWindow.webContents.send('stop-recording');
        }
      }, 150);
    } else {
      audioCaptureWindow.webContents.send('start-recording', { deviceId: config.getMicrophoneDeviceId() });
    }
  });

  function sendPlaygroundText(text) {
    if (!playgroundMode) return false;
    const win = getOnboardingWindow();
    if (win && !win.isDestroyed()) {
      // Always send (even empty text) so the renderer can reset its recording state.
      // Re-focus the onboarding window so subsequent hotkey presses are captured.
      win.webContents.send('playground-text', text || '');
      if (text) win.focus();
      return true;
    }
    // Onboarding window is gone (e.g. user closed it while playground was active).
    // Auto-clear the stale flag so this and future transcriptions paste normally.
    playgroundMode = false;
    return false;
  }

  // Streaming chunked transcription: the renderer sends intermediate audio
  // chunks when recording exceeds 2 minutes. Each chunk is appended to the
  // on-disk WAV and transcribed immediately, in parallel with recording.
  ipcMain.on('audio-chunk', (event, pcmArray) => {
    if (!audioCaptureWindow || event.sender !== audioCaptureWindow.webContents) return;
    const pcm = toFloat32(pcmArray);
    if (!pcm || pcm.length === 0) return;

    if (!streamingSession) {
      const audioPath = pipeline.newAudioPath('recording');
      let writer;
      try {
        writer = createWavWriter(audioPath);
      } catch (err) {
        console.error('Could not open recording file:', err.message);
        return;
      }
      const job = journal.create({ audioPath, source: 'dictation', meta: { streaming: true } });
      streamingSession = { chunkPromises: [], writer, job };
      console.log('Streaming transcription started — first chunk received while recording continues');
    }
    const session = streamingSession;
    try { session.writer.append(pcm); } catch (err) { console.warn('Append to recording failed:', err.message); }

    const chunkIndex = session.chunkPromises.length;
    session.chunkPromises.push(
      peekRecordingContext().then((ctx) => pipeline.transcribePcm(pcm, transcribeOptsFor(ctx))),
    );
    // Avoid unhandled-rejection noise; the failure is surfaced at assembly.
    session.chunkPromises[chunkIndex].catch(() => {});
    console.log(`Streaming chunk ${chunkIndex} queued for transcription (${(pcm.length / 16000).toFixed(1)}s of audio)`);
  });

  // Paste / history / assistant routing for a finished transcript.
  async function deliverTranscript(text, { job }) {
    const purpose = recordingPurpose;
    recordingPurpose = 'dictation';
    if (!text) {
      islandRest();
      clickPasteTargetApp = null;
      if (job) pipeline.finishJob(job.id, { keepAudio: false });
      sendPlaygroundText('');
      return;
    }

    // In playground (onboarding dry-run) mode: send the result back to the
    // onboarding window and skip paste, history, and notifications.
    if (playgroundMode && sendPlaygroundText(text)) {
      islandRest();
      clickPasteTargetApp = null;
      if (job) pipeline.finishJob(job.id, { keepAudio: false });
      return;
    }

    // The command key sends what was said to the assistant, on the island.
    if (purpose === 'command') {
      clickPasteTargetApp = null;
      if (job) pipeline.finishJob(job.id, { keepAudio: false });
      startAssistantFromVoice(text);
      return;
    }

    history.addEntry(text, job ? job.audioPath : null);
    if (job) pipeline.finishJob(job.id);
    sendToMainWindow('history-update', history.getEntries());

    const recordedTarget = clickPasteTargetApp;
    clickPasteTargetApp = null;

    // recordedTarget was captured synchronously at key-press time (before any
    // Electron window creation could corrupt the query). Use it directly.
    // As a bonus, if the user deliberately switched to a different real app
    // during transcription, honour that switch by pasting there instead.
    const currentFrontmost = await getFrontmostApp();
    const pasteTarget = (!isOwnApp(currentFrontmost) && currentFrontmost !== recordedTarget)
      ? currentFrontmost
      : recordedTarget;
    pasteText(text, pasteTarget);
    lastPaste = { app: pasteTarget };
    // The text appearing is confirmation enough: no "Inserted N words" pill.
    islandRest();
    // Watch the field for corrections to learn from (auto-learn dictionary).
    autoLearn.watch(text, { app: pasteTarget });
  }

  // Audio captured from renderer → saved + journaled → worker transcription →
  // post-process → paste. Any failure leaves the audio in "Needs attention".
  ipcMain.on('audio-captured', async (event, pcmArray) => {
    if (audioCaptureWindow && event.sender !== audioCaptureWindow.webContents) return;
    destroyAudioCaptureWindow();

    // Grab and reset the streaming session before doing anything else.
    const session = streamingSession;
    streamingSession = null;
    const isStreaming = !!(session && session.chunkPromises.length > 0);
    const pcm = toFloat32(pcmArray);
    const recCtx = await takeRecordingContext();

    // For non-streaming: bail on empty audio.
    // For streaming: prior chunks exist, so proceed even if the final tail is empty.
    if (!isStreaming && (!pcm || pcm.length === 0)) {
      console.log('Empty audio received — skipping transcription.');
      clickPasteTargetApp = null;
      islandRest();
      broadcastStatus('Ready');
      sendPlaygroundText('');
      return;
    }

    island('dictation', 'transcribing');
    broadcastStatus('Transcribing...');

    // Durably save the audio and journal the job BEFORE transcription.
    let job = null;
    try {
      if (isStreaming) {
        if (pcm && pcm.length) session.writer.append(pcm);
        session.writer.finalize();
        job = session.job;
      } else {
        job = pipeline.saveRecording(pcm, { source: 'dictation', meta: { targetApp: clickPasteTargetApp, contextApp: recCtx?.ctx?.app || null } });
      }
    } catch (err) {
      console.warn('Failed to save audio file — transcribing from memory only:', err.message);
    }

    const transcribeOpts = transcribeOptsFor(recCtx);
    try {
      let rawText;
      if (isStreaming) {
        if (pcm && pcm.length) session.chunkPromises.push(pipeline.transcribePcm(pcm, transcribeOpts));
        const results = await Promise.all(session.chunkPromises);
        rawText = results.filter((t) => t && t.length > 0).join(' ');
        console.log(`Streaming transcription complete — ${results.length} chunks merged`);
      }

      let text;
      if (job) {
        ({ text } = await pipeline.runJob(job.id, { pcm: isStreaming ? undefined : pcm, rawText, transcribeOpts, context: recCtx }));
      } else {
        const raw = rawText ?? await pipeline.transcribePcm(pcm, transcribeOpts);
        text = raw ? await postProcessTranscript(raw, { context: recCtx }) : '';
      }
      await deliverTranscript(text, { job });
    } catch (err) {
      console.error('Transcription failed:', err);
      clickPasteTargetApp = null;
      islandRest();
      if (job) {
        // runJob already marked it; streaming chunk failures reach here first.
        if (journal.get(job.id)?.status !== 'failed') pipeline.failJob(job.id, err);
        broadcastFailedJobs();
      }
      sendPlaygroundText('');

      const isModelMissing = err.message && err.message.includes('not found');
      const crashed = err instanceof WorkerCrashError;
      islandErrorAction = isModelMissing ? 'settings' : job ? 'transcripts' : null;
      island('error', 'error', {
        content: {
          notice: {
            title: isModelMissing ? 'No speech model yet' : 'Transcription failed',
            body: isModelMissing
              ? `${err.message} Download one in Settings → Models.`
              : job
                ? `${crashed ? 'The speech engine crashed and restarted. ' : ''}Your audio is saved — retry it from Transcripts.`
                : String(err.message || err),
            primary: isModelMissing ? 'Open Settings' : job ? 'Open Transcripts' : null,
            secondary: 'Dismiss',
          },
        },
      });

      if (isModelMissing) { broadcastStatus('No model downloaded'); return; }
    }

    broadcastStatus('Ready');
  });
}

async function processWavFile(filePath) {
  try {
    island('dictation', 'transcribing');
    broadcastStatus('Transcribing file...');

    const buf = fs.readFileSync(filePath);

    // Validate WAV header
    if (buf.length < 44) throw new Error('File too small to be a valid WAV');
    const riff = buf.toString('ascii', 0, 4);
    const wave = buf.toString('ascii', 8, 12);
    if (riff !== 'RIFF' || wave !== 'WAVE') throw new Error('Not a valid WAV file');

    const numChannels = buf.readUInt16LE(22);
    const sampleRate = buf.readUInt32LE(24);
    const bitsPerSample = buf.readUInt16LE(34);

    if (numChannels < 1) throw new Error(`Invalid channel count: ${numChannels}`);
    if (sampleRate < 1) throw new Error(`Invalid sample rate: ${sampleRate}`);
    if (![8, 16, 24, 32].includes(bitsPerSample)) throw new Error(`Unsupported bit depth: ${bitsPerSample}`);

    let dataOffset = 12;
    let pcmBuf = null;
    while (dataOffset < buf.length - 8) {
      const chunkId = buf.toString('ascii', dataOffset, dataOffset + 4);
      const chunkSize = buf.readUInt32LE(dataOffset + 4);
      if (chunkId === 'data') {
        dataOffset += 8;
        pcmBuf = buf.slice(dataOffset, Math.min(dataOffset + chunkSize, buf.length));
        break;
      }
      dataOffset += 8 + chunkSize;
      if (chunkSize % 2 !== 0) dataOffset++;
    }

    if (!pcmBuf) throw new Error('No data chunk in WAV');

    const numSamples = pcmBuf.length / (bitsPerSample / 8) / numChannels;
    const mono16k = new Float32Array(Math.floor(numSamples * 16000 / sampleRate));
    for (let i = 0; i < mono16k.length; i++) {
      const srcIdx = Math.floor(i * sampleRate / 16000);
      const byteOffset = srcIdx * numChannels * (bitsPerSample / 8);
      if (byteOffset + 1 < pcmBuf.length) {
        mono16k[i] = pcmBuf.readInt16LE(byteOffset) / 32768.0;
      }
    }

    console.log(`WAV loaded: ${sampleRate}Hz -> 16kHz, ${mono16k.length} samples`);

    // Long files are split into ~30 s windows by the pipeline.
    const rawText = await pipeline.transcribePcm(mono16k);
    if (!rawText) {
      islandRest();
      broadcastStatus('Ready');
      return;
    }
    const text = await postProcessTranscript(rawText);

    islandRest();

    if (text && text.length > 0) {
      history.addEntry(text);
      const entries = history.getEntries();
      sendToMainWindow('history-update', entries);
      pasteText(text);
      new Notification({ title: 'Tellaflow', body: text.length > 80 ? text.substring(0, 80) + '...' : text }).show();
    } else {
      new Notification({ title: 'Tellaflow', body: 'No speech detected.' }).show();
    }

    broadcastStatus('Ready');
  } catch (err) {
    console.error('WAV test failed:', err);
    islandRest();
    broadcastStatus('Ready');
    new Notification({ title: 'Test Failed', body: err.message }).show();
  }
}
