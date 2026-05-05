/**
 * Assistant Orchestrator — Wires the entire voice assistant pipeline.
 *
 * Flow: Hotkey → Record → STT → Agent (ZeroClaw/Fallback) → TTS → Playback
 *
 * This module is the single entry point. index.js calls init() once.
 */
const aiToast = require('../ai-toast');
const hotkeyHandler = require('./hotkey-handler');
const zeroclawProcess = require('./zeroclaw-process');
const zeroclawClient = require('./zeroclaw-client');
const tts = require('./tts');
const actions = require('./actions');
const assistantConfig = require('./config');
const events = require('./events');

let isActive = false;
let abortController = null;
let idleTimer = null;

// Exposed so index.js can check if last recording was for assistant
let _lastMode = null;

// ─── Initialization ─────────────────────────────────────────────────────────────

/**
 * Initialize the assistant system.
 * Called once from index.js after app is ready.
 * Does NOT start sidecars — those are lazy-loaded on first use.
 */
function init() {
  // Set up hotkey callbacks
  hotkeyHandler.setCallbacks({
    onStart: handleRecordStart,
    onStop: handleRecordStop,
  });

  // Set up toast IPC
  aiToast.setupIPC();

  // Listen for toast actions (user clicking buttons in the floating island)
  events.on('toast-action', handleToastAction);

  // ZeroClaw is lazy-started on first assistant hotkey press.
  // Pre-enable fallback since binary likely doesn't exist yet in dev.
  const binaryPath = zeroclawProcess.getBinaryPath();
  const fs = require('fs');
  if (!binaryPath || (binaryPath !== 'zeroclaw' && !fs.existsSync(binaryPath))) {
    zeroclawClient.enableFallback();
    console.log('[orchestrator] ZeroClaw binary not found — using fallback agent');
  }

  console.log('[orchestrator] Assistant initialized (lazy mode)');
}

/**
 * Start the assistant (lazy init sidecars on first use).
 */
async function activate() {
  if (isActive) return;
  isActive = true;
  clearIdleTimer();

  // Unload grammar model if using local LLM (GAP-7 fix)
  if (assistantConfig.shouldAutoUnload() && assistantConfig.getProvider() === 'llamacpp') {
    try {
      const grammarWorker = require('../grammar');
      grammarWorker.dispose?.();
      console.log('[orchestrator] Grammar model unloaded for assistant');
    } catch {}
  }

  // Start ZeroClaw if not running and not in fallback
  if (!zeroclawClient.isFallbackActive() && !zeroclawProcess.isRunning()) {
    try {
      await zeroclawProcess.start({
        onError: () => zeroclawClient.enableFallback(),
      });
    } catch {
      zeroclawClient.enableFallback();
    }
  }

  // Initialize TTS if not ready
  if (!tts.isModelDownloaded()) {
    console.warn('[orchestrator] TTS model not downloaded — responses will be text-only');
  } else {
    await tts.init();
  }

  // Show AI toast
  aiToast.create();
  aiToast.idle();
}

/**
 * Deactivate the assistant (start idle timer for sidecar cleanup).
 */
function deactivate() {
  isActive = false;
  startIdleTimer();
}

// ─── Recording handlers ─────────────────────────────────────────────────────────

function handleRecordStart() {
  activate();
  _lastMode = 'assistant';
  abortController?.abort();
  abortController = new AbortController();
  tts.stopPlayback();

  aiToast.listening();

  // Create the audio capture window (same as dictation uses)
  // We call the exported function from index.js
  try {
    const { createAudioCaptureWindow } = require('./index-bridge');
    createAudioCaptureWindow();
  } catch {
    // In case bridge isn't available yet, the hotkey.js onStart will handle it
  }
}

function handleRecordStop({ cancelled }) {
  if (cancelled) {
    aiToast.idle();
    return;
  }

  aiToast.thinking();

  // Audio capture will send 'audio-captured' event with PCM data
  // The main index.js routes assistant audio through the existing whisper pipeline
  // and calls processTranscript() with the result
}

// ─── Processing pipeline ────────────────────────────────────────────────────────

/**
 * Process a transcribed user message through the agent.
 * Called by index.js after Whisper transcription completes.
 *
 * @param {string} transcript - The user's spoken words
 */
async function processTranscript(transcript) {
  if (!transcript || !transcript.trim()) {
    return;
  }

  console.log(`[orchestrator] User said: "${transcript}"`);

  const { sendToMainWindow } = require('../main-window');

  // Send user message to chat UI
  sendToMainWindow('assistant-chat-message', { role: 'user', content: transcript, timestamp: Date.now() });

  try {
    const response = await zeroclawClient.query(transcript, {
      signal: abortController?.signal,
      onPartial: (chunk) => {
        // Could stream to UI here
      },
    });

    // Send assistant response to chat UI
    sendToMainWindow('assistant-chat-message', { role: 'assistant', content: response, timestamp: Date.now() });

    // Speak the response via TTS if available
    if (response && tts.isModelDownloaded()) {
      try {
        await tts.speak(response, { signal: abortController?.signal });
      } catch {}
    }

    console.log(`[orchestrator] Response: "${response?.slice(0, 80)}..."`);
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('[orchestrator] Error:', err.message);
    sendToMainWindow('assistant-chat-message', { role: 'assistant', content: `Error: ${err.message}`, timestamp: Date.now() });
  }
}

// ─── Toast action handler ───────────────────────────────────────────────────────

function handleToastAction(action) {
  switch (action.type) {
    case 'cancel':
    case 'stop':
      abortController?.abort();
      tts.stopPlayback();
      aiToast.idle();
      break;

    case 'retry':
      // Re-process last transcript
      break;

    case 'confirm-yes':
      events.emit('confirm-response', true);
      break;

    case 'confirm-no':
      events.emit('confirm-response', false);
      break;

    case 'skip':
      tts.stopPlayback();
      aiToast.idle();
      break;

    case 'repeat':
      // Re-speak last response
      break;

    case 'new-topic':
      zeroclawClient.clearHistory();
      aiToast.idle();
      break;

    default:
      console.log('[orchestrator] Unhandled toast action:', action);
  }
}

// ─── Idle timer (cleanup sidecars after inactivity) ─────────────────────────────

function startIdleTimer() {
  clearIdleTimer();
  const timeout = assistantConfig.getIdleTimeout();
  idleTimer = setTimeout(() => {
    console.log('[orchestrator] Idle timeout — unloading sidecars');
    zeroclawProcess.stop();
    tts.dispose();
    aiToast.hide();

    // Reload grammar model if it was unloaded
    if (assistantConfig.shouldAutoUnload()) {
      try {
        const grammar = require('../grammar');
        grammar.reinit?.();
      } catch {}
    }
  }, timeout);
}

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

// ─── Cleanup ────────────────────────────────────────────────────────────────────

function dispose() {
  clearIdleTimer();
  abortController?.abort();
  zeroclawProcess.stop();
  tts.dispose();
  aiToast.destroy();
}

// ─── Public API ─────────────────────────────────────────────────────────────────

module.exports = {
  init,
  activate,
  deactivate,
  dispose,
  processTranscript,
  handleRecordStart,
  handleRecordStop,
  hotkeyHandler,
  get _lastMode() { return _lastMode; },
  set _lastMode(v) { _lastMode = v; },
};
