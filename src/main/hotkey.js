const config = require('./config');

let listener = null;
let onRecordStart = null;
let onRecordStop = null;
let isRecording = false;
let isWaitingForActivation = false;
let activationTimer = null;
let running = false;
let keyDownTime = 0;
let restartCount = 0;

const MIN_HOLD_MS = 300;
const MAX_RESTARTS = 5;

// For single-key hotkeys (like fn, option), we match the trigger key directly.
// For combos (e.g. Ctrl+A), the last name in the array is the trigger,
// the rest are modifiers that must all be in the `down` map simultaneously.
function matchesHotkey(e, down) {
  const hk = config.getHotkey(); // { names: string[], label: string }
  if (!hk || !Array.isArray(hk.names) || hk.names.length === 0) return false;

  // Last entry is the "main" key, preceding entries are required modifiers
  const names = hk.names;
  const triggerName = names[names.length - 1];
  const modNames = names.slice(0, -1);

  if (e.name !== triggerName) return false;
  return modNames.every(mod => down[mod]);
}

// For keyup: trigger must match (regardless of what's in `down` since key is being released)
function matchesTrigger(e) {
  const hk = config.getHotkey();
  if (!hk || !Array.isArray(hk.names) || hk.names.length === 0) return false;
  const triggerName = hk.names[hk.names.length - 1];
  return e.name === triggerName;
}

function start({ onStart, onStop }) {
  // Stop any existing listener before starting a new one
  if (listener) {
    try { listener.kill(); } catch {}
    listener = null;
    running = false;
    isRecording = false;
  }

  onRecordStart = onStart;
  onRecordStop = onStop;
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
        // The native MacKeyServer binary can exit unexpectedly (e.g. when the fn/Globe key
        // is pressed on Apple Silicon). Auto-restart so the hotkey keeps working.
        listener = null;
        running = false;
        isRecording = false;
        isWaitingForActivation = false;
        if (activationTimer) { clearTimeout(activationTimer); activationTimer = null; }
        restartCount++;
        if (restartCount > MAX_RESTARTS) {
          console.error(`keyspy crashed ${restartCount} times, giving up. Use tray menu to retry.`);
          return;
        }
        const delay = Math.min(500 * restartCount, 5000);
        console.warn(`keyspy native process exited (code ${code}), restart ${restartCount}/${MAX_RESTARTS} in ${delay}ms...`);
        setTimeout(() => start({ onStart, onStop }), delay);
      },
    },
  });

  listener.addListener((e, down) => {
    if (e.state === 'DOWN') {
      if (isRecording || isWaitingForActivation) return;
      if (!matchesHotkey(e, down)) return;

      keyDownTime = Date.now();
      const delay = config.getHotkeyActivationDelay();

      if (delay > 0) {
        // Wait for the activation delay before starting recording
        isWaitingForActivation = true;
        activationTimer = setTimeout(() => {
          activationTimer = null;
          isWaitingForActivation = false;
          isRecording = true;
          if (onRecordStart) onRecordStart();
        }, delay);
      } else {
        // No delay — start immediately (original behaviour)
        isRecording = true;
        if (onRecordStart) onRecordStart();
      }
    } else if (e.state === 'UP') {
      if (!matchesTrigger(e)) return;

      // Released during activation wait — cancel silently (no recording started)
      if (isWaitingForActivation) {
        if (activationTimer) { clearTimeout(activationTimer); activationTimer = null; }
        isWaitingForActivation = false;
        return;
      }

      if (!isRecording) return;

      isRecording = false;
      const holdDuration = Date.now() - keyDownTime;

      if (holdDuration < MIN_HOLD_MS) {
        console.log(`Recording too short (${holdDuration}ms), discarding.`);
        if (onRecordStop) onRecordStop({ cancelled: true, reason: 'too_short' });
        return;
      }

      if (onRecordStop) onRecordStop({ cancelled: false });
    }
  }).then(() => {
    // The fn/Globe key on Apple Silicon can crash the native binary, leaving its stdin
    // broken. Attach an error handler so the EPIPE doesn't become an uncaught exception.
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
}

function stop() {
  if (activationTimer) { clearTimeout(activationTimer); activationTimer = null; }
  isWaitingForActivation = false;
  if (listener) {
    try { listener.kill(); } catch (e) { console.warn('keyspy kill error:', e.message); }
    listener = null;
    running = false;
    isRecording = false;
    console.log('Hotkey listener stopped.');
  }
}

function isRunning() {
  return running;
}

function getIsRecording() {
  return isRecording;
}

function resetRecordingState() {
  if (activationTimer) { clearTimeout(activationTimer); activationTimer = null; }
  isWaitingForActivation = false;
  isRecording = false;
  keyDownTime = 0;
}

module.exports = { start, stop, isRunning, getIsRecording, resetRecordingState };
