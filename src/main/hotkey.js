const config = require('./config');

let listener = null;
let onRecordStart = null;
let onRecordStop = null;
let onAssistantStart_ = null;
let onAssistantStop_ = null;
let isRecording = false;
let running = false;
let keyDownTime = 0;
let restartCount = 0;

// Active mode: only one mode can be recording at a time
// 'dictation' | 'assistant' | null
let activeMode = null;

const MIN_HOLD_MS = 300;
const MAX_RESTARTS = 5;

// For single-key hotkeys (like fn, option), we match the trigger key directly.
// For combos (e.g. Ctrl+A), the last name in the array is the trigger,
// the rest are modifiers that must all be in the `down` map simultaneously.
function matchesHotkeyConfig(e, down, hk) {
  if (!hk || !Array.isArray(hk.names) || hk.names.length === 0) return false;

  const names = hk.names;
  const triggerName = names[names.length - 1];
  const modNames = names.slice(0, -1);

  if (e.name !== triggerName) return false;
  return modNames.every(mod => down[mod]);
}

function matchesTriggerConfig(e, hk) {
  if (!hk || !Array.isArray(hk.names) || hk.names.length === 0) return false;
  const triggerName = hk.names[hk.names.length - 1];
  return e.name === triggerName;
}

// Original API — preserved for backward compatibility
function matchesHotkey(e, down) {
  return matchesHotkeyConfig(e, down, config.getHotkey());
}

function matchesTrigger(e) {
  return matchesTriggerConfig(e, config.getHotkey());
}

// Get assistant hotkey config (lazy, safe)
function getAssistantHotkey() {
  try {
    const ac = require('./assistant/config');
    if (!ac.isEnabled()) return null;
    return ac.getHotkey();
  } catch {
    return null;
  }
}

function start({ onStart, onStop, onAssistantStart, onAssistantStop }) {
  // Stop any existing listener before starting a new one
  if (listener) {
    try { listener.kill(); } catch {}
    listener = null;
    running = false;
    isRecording = false;
    activeMode = null;
  }

  onRecordStart = onStart;
  onRecordStop = onStop;
  onAssistantStart_ = onAssistantStart || null;
  onAssistantStop_ = onAssistantStop || null;
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
        isRecording = false;
        activeMode = null;
        restartCount++;
        if (restartCount > MAX_RESTARTS) {
          console.error(`keyspy crashed ${restartCount} times, giving up. Use tray menu to retry.`);
          return;
        }
        const delay = Math.min(500 * restartCount, 5000);
        console.warn(`keyspy native process exited (code ${code}), restart ${restartCount}/${MAX_RESTARTS} in ${delay}ms...`);
        setTimeout(() => start({ onStart, onStop, onAssistantStart, onAssistantStop }), delay);
      },
    },
  });

  listener.addListener((e, down) => {
    if (e.state === 'DOWN') {
      if (activeMode) return;

      // 1. Check dictation hotkey FIRST (always)
      if (matchesHotkey(e, down)) {
        activeMode = 'dictation';
        isRecording = true;
        keyDownTime = Date.now();
        if (onRecordStart) onRecordStart();
        return;
      }

      // 2. Check assistant hotkey (only if enabled and configured)
      const assistantHk = getAssistantHotkey();
      if (assistantHk && onAssistantStart_ && matchesHotkeyConfig(e, down, assistantHk)) {
        activeMode = 'assistant';
        isRecording = true;
        keyDownTime = Date.now();
        if (onAssistantStart_) onAssistantStart_();
        return;
      }
    } else if (e.state === 'UP') {
      if (!activeMode) return;

      if (activeMode === 'dictation') {
        if (!matchesTrigger(e)) return;

        activeMode = null;
        isRecording = false;
        const holdDuration = Date.now() - keyDownTime;

        if (holdDuration < MIN_HOLD_MS) {
          console.log(`Recording too short (${holdDuration}ms), discarding.`);
          if (onRecordStop) onRecordStop({ cancelled: true, reason: 'too_short' });
          return;
        }

        if (onRecordStop) onRecordStop({ cancelled: false });
      } else if (activeMode === 'assistant') {
        const assistantHk = getAssistantHotkey();
        if (!matchesTriggerConfig(e, assistantHk)) return;

        activeMode = null;
        isRecording = false;
        const holdDuration = Date.now() - keyDownTime;

        if (holdDuration < MIN_HOLD_MS) {
          console.log(`[assistant] Recording too short (${holdDuration}ms), discarding.`);
          if (onAssistantStop_) onAssistantStop_({ cancelled: true, reason: 'too_short' });
          return;
        }

        if (onAssistantStop_) onAssistantStop_({ cancelled: false });
      }
    }
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
  console.log('Hotkey listener started (keyspy). Configured hotkey:', JSON.stringify(config.getHotkey()));
  const ah = getAssistantHotkey();
  if (ah) console.log('Assistant hotkey:', JSON.stringify(ah));
}

function stop() {
  if (listener) {
    try { listener.kill(); } catch (e) { console.warn('keyspy kill error:', e.message); }
    listener = null;
    running = false;
    isRecording = false;
    activeMode = null;
    console.log('Hotkey listener stopped.');
  }
}

function isRunning() {
  return running;
}

function getIsRecording() {
  return isRecording;
}

module.exports = { start, stop, isRunning, getIsRecording };
