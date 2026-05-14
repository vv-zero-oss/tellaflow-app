const config = require('./config');

let listener = null;
let onRecordStart = null;
let onRecordStop = null;
let onEnterHandsFree = null;
let isRecording = false;
let isWaitingForActivation = false;
let activationTimer = null;
let running = false;
let keyDownTime = 0;
let restartCount = 0;
let lastCrashTime = 0;
let startFailed = false;

// Recording mode and double-press detection.
//   mode = 'held'      → press-and-hold; releasing the trigger ends recording.
//   mode = 'handsfree' → entered via double-press; only fn-press or Esc ends it.
//   pendingDoublePress is set briefly after a quick release of the trigger so
//   that a second press within DOUBLE_PRESS_WINDOW_MS escalates the session
//   into hands-free mode instead of cancelling the (too-short) recording.
let mode = null;
let pendingDoublePress = false;
let doublePressTimer = null;

const MIN_HOLD_MS = 300;
const DOUBLE_PRESS_WINDOW_MS = 400;
const MAX_RESTARTS = 10;

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

function clearDoublePressTimer() {
  if (doublePressTimer) {
    clearTimeout(doublePressTimer);
    doublePressTimer = null;
  }
  pendingDoublePress = false;
}

function finishHandsFree() {
  if (!isRecording) return;
  isRecording = false;
  mode = null;
  clearDoublePressTimer();
  if (onRecordStop) onRecordStop({ cancelled: false });
}

function start({ onStart, onStop, onHandsFree }) {
  // Stop any existing listener before starting a new one
  if (listener) {
    try { listener.kill(); } catch {}
    listener = null;
    running = false;
    isRecording = false;
  }

  onRecordStart = onStart;
  onRecordStop = onStop;
  onEnterHandsFree = onHandsFree;
  restartCount = 0;

  let GlobalKeyboardListener;
  try {
    ({ GlobalKeyboardListener } = require('keyspy'));
    startFailed = false;
  } catch (err) {
    console.error('keyspy not available:', err.message);
    console.log('Hotkey detection disabled.');
    startFailed = true;
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
        mode = null;
        isWaitingForActivation = false;
        clearDoublePressTimer();
        if (activationTimer) { clearTimeout(activationTimer); activationTimer = null; }

        // Decay restart count if last crash was more than 30s ago (stable period)
        const now = Date.now();
        if (now - lastCrashTime > 30000) restartCount = 0;
        lastCrashTime = now;

        restartCount++;
        if (restartCount > MAX_RESTARTS) {
          console.error(`keyspy crashed ${restartCount} times in rapid succession, giving up. Use tray menu to retry.`);
          return;
        }
        const delay = Math.min(500 * restartCount, 5000);
        console.warn(`keyspy native process exited (code ${code}), restart ${restartCount}/${MAX_RESTARTS} in ${delay}ms...`);
        setTimeout(() => start({ onStart, onStop, onHandsFree }), delay);
      },
    },
  });

  listener.addListener((e, down) => {
    // Escape during hands-free ends the recording (whether or not it matches the hotkey).
    if (mode === 'handsfree' && e.state === 'DOWN' && e.name === 'ESCAPE') {
      finishHandsFree();
      return;
    }

    if (e.state === 'DOWN') {
      if (!matchesHotkey(e, down)) return;

      // Hotkey pressed while already in hands-free → stop and transcribe.
      if (mode === 'handsfree') {
        finishHandsFree();
        return;
      }

      // Second press inside the double-press window → escalate to hands-free.
      // The first press already started the recording; we just flip the mode
      // and cancel the pending "too short" auto-stop timer.
      if (pendingDoublePress && isRecording) {
        clearDoublePressTimer();
        mode = 'handsfree';
        if (onEnterHandsFree) onEnterHandsFree();
        return;
      }

      // Ignore presses while we're already recording or queued to start.
      if (isRecording || isWaitingForActivation) return;

      keyDownTime = Date.now();
      const delay = config.getHotkeyActivationDelay();

      if (delay > 0) {
        // Wait for the activation delay before starting recording
        isWaitingForActivation = true;
        activationTimer = setTimeout(() => {
          activationTimer = null;
          isWaitingForActivation = false;
          isRecording = true;
          mode = 'held';
          if (onRecordStart) onRecordStart();
        }, delay);
      } else {
        // No delay — start immediately (original behaviour)
        isRecording = true;
        mode = 'held';
        if (onRecordStart) onRecordStart();
      }
    } else if (e.state === 'UP') {
      if (!matchesTrigger(e)) return;

      // Hands-free ignores trigger release. Only fn-press / Esc ends it.
      if (mode === 'handsfree') return;

      // Released during activation wait — cancel silently (no recording started)
      if (isWaitingForActivation) {
        if (activationTimer) { clearTimeout(activationTimer); activationTimer = null; }
        isWaitingForActivation = false;
        return;
      }

      if (!isRecording) return;

      const holdDuration = Date.now() - keyDownTime;

      if (holdDuration < MIN_HOLD_MS) {
        // Quick release. Don't cancel yet — the user might be double-pressing
        // to enter hands-free mode. Hold the mic open for a short window;
        // if no second press comes, cancel as before.
        if (doublePressTimer) clearTimeout(doublePressTimer);
        pendingDoublePress = true;
        doublePressTimer = setTimeout(() => {
          doublePressTimer = null;
          pendingDoublePress = false;
          if (isRecording && mode === 'held') {
            isRecording = false;
            mode = null;
            console.log(`Recording too short (${holdDuration}ms), discarding.`);
            if (onRecordStop) onRecordStop({ cancelled: true, reason: 'too_short' });
          }
        }, DOUBLE_PRESS_WINDOW_MS);
        return;
      }

      isRecording = false;
      mode = null;
      clearDoublePressTimer();
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
  clearDoublePressTimer();
  isWaitingForActivation = false;
  mode = null;
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

function getMode() {
  return mode;
}

function resetRecordingState() {
  if (activationTimer) { clearTimeout(activationTimer); activationTimer = null; }
  clearDoublePressTimer();
  isWaitingForActivation = false;
  isRecording = false;
  mode = null;
  keyDownTime = 0;
}

function didStartFail() {
  return startFailed;
}

module.exports = { start, stop, isRunning, getIsRecording, getMode, resetRecordingState, didStartFail };
