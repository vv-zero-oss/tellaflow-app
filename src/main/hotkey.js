const config = require('./config');
const platform = require('./platform');

let listener = null;
let onRecordStart = null;
let onRecordStop = null;
let isRecording = false;
let running = false;
let keyDownTime = 0;
let restartCount = 0;
let windowsPressed = new Set();

const MIN_HOLD_MS = 300;
const MAX_RESTARTS = 5;

function normalizeKeyName(name) {
  if (!name) return '';
  return String(name).trim().toUpperCase().replace(/\s+/g, ' ');
}

function aliasesFor(name) {
  const n = normalizeKeyName(name);
  const set = new Set([n]);

  if (n === 'LEFT ALT' || n === 'RIGHT ALT' || n === 'ALT' || n === 'MENU') {
    set.add('LEFT ALT');
    set.add('RIGHT ALT');
    set.add('ALT');
    set.add('MENU');
  }
  if (n === 'LEFT CTRL' || n === 'RIGHT CTRL' || n === 'CTRL' || n === 'CONTROL') {
    set.add('LEFT CTRL');
    set.add('RIGHT CTRL');
    set.add('CTRL');
    set.add('CONTROL');
  }
  if (n === 'LEFT SHIFT' || n === 'RIGHT SHIFT' || n === 'SHIFT') {
    set.add('LEFT SHIFT');
    set.add('RIGHT SHIFT');
    set.add('SHIFT');
  }
  if (n === 'LEFT META' || n === 'RIGHT META' || n === 'META' || n === 'WIN' || n === 'WINDOWS') {
    set.add('LEFT META');
    set.add('RIGHT META');
    set.add('META');
    set.add('WIN');
    set.add('WINDOWS');
  }

  return set;
}

function keyMatches(expectedName, eventName) {
  const a = aliasesFor(expectedName);
  const b = aliasesFor(eventName);
  for (const key of a) {
    if (b.has(key)) return true;
  }
  return false;
}

function getEventName(e) {
  const byName = normalizeKeyName(e?.name || e?.key || e?.rawKey || '');
  if (byName) return byName;

  // Windows fallback for cases where name is missing/UNKNOWN but vKey is present.
  const vk = Number(e?.vKey);
  const VK_TO_NAME = {
    18: 'ALT',
    164: 'LEFT ALT',
    165: 'RIGHT ALT',
    17: 'CTRL',
    162: 'LEFT CTRL',
    163: 'RIGHT CTRL',
    16: 'SHIFT',
    160: 'LEFT SHIFT',
    161: 'RIGHT SHIFT',
    91: 'LEFT META',
    92: 'RIGHT META',
    32: 'SPACE',
    13: 'RETURN',
    27: 'ESCAPE',
    8: 'BACKSPACE',
    9: 'TAB',
  };
  return VK_TO_NAME[vk] || '';
}

function modifierIsDown(expectedMod, down) {
  const entries = Object.entries(down || {});
  for (const [name, isDown] of entries) {
    if (!isDown) continue;
    if (keyMatches(expectedMod, name)) return true;
  }
  return false;
}

function updateWindowsPressed(e) {
  const name = getEventName(e);
  if (!name) return;
  if (isDownEvent(e)) {
    windowsPressed.add(name);
  } else if (isUpEvent(e)) {
    windowsPressed.delete(name);
  }
}

function windowsModifierDown(expectedMod) {
  const expected = aliasesFor(expectedMod);
  for (const pressed of windowsPressed) {
    const current = aliasesFor(pressed);
    for (const key of expected) {
      if (current.has(key)) return true;
    }
  }
  return false;
}

// For single-key hotkeys (like fn, option), we match the trigger key directly.
// For combos (e.g. Ctrl+A), the last name in the array is the trigger,
// the rest are modifiers that must all be in the `down` map simultaneously.
function matchesHotkey(e, down) {
  const hk = getEffectiveHotkey(); // { names: string[], label: string }
  if (!hk || !Array.isArray(hk.names) || hk.names.length === 0) return false;

  // Last entry is the "main" key, preceding entries are required modifiers
  const names = hk.names;
  const triggerName = names[names.length - 1];
  const modNames = names.slice(0, -1);

  const eventName = getEventName(e);
  if (!keyMatches(triggerName, eventName)) return false;
  if (platform.isWindows) {
    // Windows-specific strategy: trust our own pressed-key set in background mode.
    return modNames.every((mod) => windowsModifierDown(mod));
  }
  return modNames.every((mod) => modifierIsDown(mod, down));
}

// For keyup: trigger must match (regardless of what's in `down` since key is being released)
function matchesTrigger(e) {
  const hk = getEffectiveHotkey();
  if (!hk || !Array.isArray(hk.names) || hk.names.length === 0) return false;
  const triggerName = hk.names[hk.names.length - 1];
  return keyMatches(triggerName, getEventName(e));
}

function getEffectiveHotkey() {
  const hk = config.getHotkey();
  if (!platform.isWindows || !hk || !Array.isArray(hk.names)) return hk;
  if (hk.names.length >= 2) return hk;

  const trigger = hk.names[0] || 'LEFT ALT';
  const names = /CTRL/i.test(trigger) ? ['LEFT ALT', trigger] : ['LEFT CTRL', trigger];
  return { ...hk, names };
}

function isDownEvent(e) {
  return normalizeKeyName(e?.state) === 'DOWN';
}

function isUpEvent(e) {
  return normalizeKeyName(e?.state) === 'UP';
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
  windowsPressed = new Set();

  let GlobalKeyboardListener;
  try {
    ({ GlobalKeyboardListener } = require('keyspy'));
  } catch (err) {
    console.error('keyspy not available:', err.message);
    console.log('Hotkey detection disabled.');
    return;
  }

  const options = platform.isMac
    ? {
        mac: {
          appName: 'Tellaflow',
          onError: (code) => {
            // The native MacKeyServer binary can exit unexpectedly (e.g. when the fn/Globe key
            // is pressed on Apple Silicon). Auto-restart so the hotkey keeps working.
            listener = null;
            running = false;
            isRecording = false;
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
      }
    : {};
  listener = new GlobalKeyboardListener(options);

  listener.addListener((e, down) => {
    if (platform.isWindows) {
      updateWindowsPressed(e);
    }
    if (isDownEvent(e)) {
      if (isRecording) return;
      if (!matchesHotkey(e, down)) return;

      isRecording = true;
      keyDownTime = Date.now();
      if (onRecordStart) onRecordStart();
    } else if (isUpEvent(e)) {
      if (!isRecording) return;
      if (!matchesTrigger(e)) return;

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
  if (listener) {
    try { listener.kill(); } catch (e) { console.warn('keyspy kill error:', e.message); }
    listener = null;
    running = false;
    isRecording = false;
    windowsPressed = new Set();
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
