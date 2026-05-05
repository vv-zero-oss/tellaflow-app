/**
 * Assistant hotkey handler.
 * Integrates with the existing hotkey.js listener by providing a secondary
 * hotkey match function. The main hotkey.js calls into this module when
 * the event doesn't match the dictation hotkey.
 *
 * This module does NOT create its own keyspy listener — it piggybacks on
 * the existing one in hotkey.js to avoid running two native binaries.
 */
const assistantConfig = require('./config');

let onAssistantStart = null;
let onAssistantStop = null;
let isAssistantRecording = false;
let keyDownTime = 0;

const MIN_HOLD_MS = 300;

/**
 * Check if the keyboard event matches the assistant hotkey.
 * Called from the main hotkey.js listener.
 */
function matchesAssistantHotkey(e, down) {
  const hk = assistantConfig.getHotkey();
  if (!hk || !Array.isArray(hk.names) || hk.names.length === 0) return false;

  const names = hk.names;
  const triggerName = names[names.length - 1];
  const modNames = names.slice(0, -1);

  if (e.name !== triggerName) return false;
  return modNames.every(mod => down[mod]);
}

/**
 * Check if a keyup event matches the assistant trigger key.
 */
function matchesAssistantTrigger(e) {
  const hk = assistantConfig.getHotkey();
  if (!hk || !Array.isArray(hk.names) || hk.names.length === 0) return false;
  return e.name === hk.names[hk.names.length - 1];
}

/**
 * Handle keydown for assistant hotkey.
 * Returns true if this event was consumed by the assistant.
 */
function handleKeyDown(e, down) {
  if (!assistantConfig.isEnabled()) return false;
  if (isAssistantRecording) return false;
  if (!matchesAssistantHotkey(e, down)) return false;

  isAssistantRecording = true;
  keyDownTime = Date.now();

  // Start the orchestrator (shows AI toast, marks mode)
  if (onAssistantStart) onAssistantStart();

  // Also trigger audio capture (same mechanism as dictation)
  // This is handled by the orchestrator which calls back to create the capture window
  return true;
}

/**
 * Handle keyup for assistant hotkey.
 * Returns true if this event was consumed by the assistant.
 */
function handleKeyUp(e) {
  if (!isAssistantRecording) return false;
  if (!matchesAssistantTrigger(e)) return false;

  isAssistantRecording = false;
  const holdDuration = Date.now() - keyDownTime;

  if (holdDuration < MIN_HOLD_MS) {
    console.log(`[assistant] Recording too short (${holdDuration}ms), discarding.`);
    if (onAssistantStop) onAssistantStop({ cancelled: true, reason: 'too_short' });
    return true;
  }

  if (onAssistantStop) onAssistantStop({ cancelled: false });
  return true;
}

/**
 * Register callbacks for assistant hotkey events.
 */
function setCallbacks({ onStart, onStop }) {
  onAssistantStart = onStart;
  onAssistantStop = onStop;
}

/**
 * Check if assistant is currently recording.
 */
function getIsRecording() {
  return isAssistantRecording;
}

/**
 * Force-stop recording (e.g., when assistant is interrupted).
 */
function cancelRecording() {
  if (isAssistantRecording) {
    isAssistantRecording = false;
    if (onAssistantStop) onAssistantStop({ cancelled: true, reason: 'interrupted' });
  }
}

module.exports = {
  handleKeyDown, handleKeyUp, setCallbacks,
  getIsRecording, cancelRecording,
  matchesAssistantHotkey, matchesAssistantTrigger,
};
