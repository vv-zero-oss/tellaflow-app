const config = require('./config');

let listener = null;
let running = false;
let restartCount = 0;

// Dictation state
let isDictating = false;
let dictKeyDownTime = 0;

// Agent state
let isAgentRecording = false;
let agentKeyDownTime = 0;

const MIN_HOLD_MS = 300;
const MAX_RESTARTS = 5;

// Saved callbacks (needed for auto-restart)
let savedCallbacks = {};

// ─── Hotkey matching ──────────────────────────────────────────────────────────

function matchesHotkey(e, down, hk) {
  if (!hk || !Array.isArray(hk.names) || hk.names.length === 0) return false;
  const names = hk.names;
  const triggerName = names[names.length - 1];
  const modNames = names.slice(0, -1);
  if (e.name !== triggerName) return false;
  return modNames.every(mod => down[mod]);
}

function matchesTrigger(e, hk) {
  if (!hk || !Array.isArray(hk.names) || hk.names.length === 0) return false;
  return e.name === hk.names[hk.names.length - 1];
}

function hotkeyNamesEqual(a, b) {
  if (!a || !b) return false;
  const aa = [...(a.names || [])].sort();
  const bb = [...(b.names || [])].sort();
  return aa.length === bb.length && aa.every((v, i) => v === bb[i]);
}

// ─── Core listener logic ──────────────────────────────────────────────────────

function handleEvent(e, down, callbacks) {
  const {
    onStart, onStop,
    onAgentStart, onAgentStop,
  } = callbacks;

  const dictHk  = config.getHotkey();
  const agentEnabled = config.getAgentEnabled();
  const agentHk = agentEnabled ? config.getAgentHotkey() : null;

  if (e.state === 'DOWN') {
    // ── Dictation key down ──────────────────────────────────────────────────
    if (!isDictating && !isAgentRecording && matchesHotkey(e, down, dictHk)) {
      // Guard: don't start dictation if agent hotkey is the same key
      if (agentHk && hotkeyNamesEqual(dictHk, agentHk)) return;
      isDictating = true;
      dictKeyDownTime = Date.now();
      onStart?.();
      return;
    }

    // ── Agent key down ──────────────────────────────────────────────────────
    if (agentHk && !isAgentRecording && !isDictating && matchesHotkey(e, down, agentHk)) {
      isAgentRecording = true;
      agentKeyDownTime = Date.now();
      onAgentStart?.();
      return;
    }

  } else if (e.state === 'UP') {
    // ── Dictation key up ────────────────────────────────────────────────────
    if (isDictating && matchesTrigger(e, dictHk)) {
      isDictating = false;
      const hold = Date.now() - dictKeyDownTime;
      if (hold < MIN_HOLD_MS) {
        console.log(`Dictation too short (${hold}ms), discarding.`);
        onStop?.({ cancelled: true, reason: 'too_short' });
        return;
      }
      onStop?.({ cancelled: false });
      return;
    }

    // ── Agent key up ────────────────────────────────────────────────────────
    if (isAgentRecording && agentHk && matchesTrigger(e, agentHk)) {
      isAgentRecording = false;
      const hold = Date.now() - agentKeyDownTime;
      if (hold < MIN_HOLD_MS) {
        console.log(`Agent recording too short (${hold}ms), discarding.`);
        onAgentStop?.({ cancelled: true, reason: 'too_short' });
        return;
      }
      onAgentStop?.({ cancelled: false });
      return;
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {{ onStart, onStop, onAgentStart, onAgentStop }} callbacks
 */
function start(callbacks) {
  if (listener) {
    try { listener.kill(); } catch {}
    listener = null;
    running = false;
    isDictating = false;
    isAgentRecording = false;
  }

  savedCallbacks = callbacks;
  restartCount = 0;

  let GlobalKeyboardListener;
  try {
    ({ GlobalKeyboardListener } = require('keyspy'));
  } catch (err) {
    console.error('keyspy not available:', err.message);
    console.log('Hotkey detection disabled.');
    return;
  }

  listener = new GlobalKeyboardListener({
    mac: {
      appName: 'Tellaflow',
      onError: (code) => {
        listener = null;
        running = false;
        isDictating = false;
        isAgentRecording = false;
        restartCount++;
        if (restartCount > MAX_RESTARTS) {
          console.error(`keyspy crashed ${restartCount} times, giving up.`);
          return;
        }
        const delay = Math.min(500 * restartCount, 5000);
        console.warn(`keyspy native process exited (code ${code}), restart ${restartCount}/${MAX_RESTARTS} in ${delay}ms...`);
        setTimeout(() => start(savedCallbacks), delay);
      },
    },
  });

  listener.addListener((e, down) => {
    handleEvent(e, down, savedCallbacks);
  }).then(() => {
    const proc = listener?.keyServer?.proc;
    if (proc?.stdin) {
      proc.stdin.on('error', (err) => {
        if (err.code !== 'EPIPE') console.error('keyspy stdin error:', err);
      });
    }
  }).catch((err) => {
    console.error('keyspy listener startup error:', err);
  });

  running = true;
  console.log('Hotkey listener started (keyspy).');
  console.log('  Dictation hotkey:', JSON.stringify(config.getHotkey()));
  if (config.getAgentEnabled()) {
    console.log('  Agent hotkey:', JSON.stringify(config.getAgentHotkey()));
  }
}

function stop() {
  if (listener) {
    try { listener.kill(); } catch (e) { console.warn('keyspy kill error:', e.message); }
    listener = null;
    running = false;
    isDictating = false;
    isAgentRecording = false;
    console.log('Hotkey listener stopped.');
  }
}

function isRunning() { return running; }
function getIsRecording() { return isDictating; }
function getIsAgentRecording() { return isAgentRecording; }

module.exports = { start, stop, isRunning, getIsRecording, getIsAgentRecording };
