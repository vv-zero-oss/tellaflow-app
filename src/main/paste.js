const { clipboard } = require('electron');
const { execFile } = require('child_process');

const RESTORE_DELAY_MS = 600;

// Each paste captures the clipboard state at call time. We track the
// ORIGINAL pre-first-paste value so back-to-back recordings don't
// overwrite it with a transcription string.
let _restoreTimer = null;
let _originalClipboard = null;

// Track last pasted text for undo functionality
let lastPastedText = null;

/**
 * Paste text into the target app.
 * Always re-activates `targetApp` before simulating Cmd+V so the keystroke
 * lands in the correct text field regardless of what stole focus during
 * recording (hidden BrowserWindow creation, notifications, etc.).
 */
function pasteText(text, targetApp = null) {
  // Capture original clipboard only for the first paste in a sequence;
  // subsequent rapid pastes keep the same restore target so back-to-back
  // recordings never permanently overwrite the user's pre-recording clipboard.
  if (_restoreTimer) {
    clearTimeout(_restoreTimer);
    _restoreTimer = null;
    // _originalClipboard already holds the pre-sequence value — don't overwrite
  } else {
    _originalClipboard = clipboard.readText();
  }

  clipboard.writeText(text);

  // EC3 — sanitize app name: strip characters that would break the osascript
  // string literal (quotes, newlines). Names come from System Events so this
  // is a safety measure rather than a user-input concern.
  const safeTarget = targetApp ? targetApp.replace(/[\\"'\n\r]/g, '') : null;

  const pasteScript = 'tell application "System Events" to keystroke "v" using command down';

  // EC4 — if no target is known, paste without activation (best-effort).
  // This avoids sending Cmd+V into a random Electron window.
  const script = safeTarget
    ? `tell application "${safeTarget}" to activate\ndelay 0.15\n${pasteScript}`
    : pasteScript;

  if (!safeTarget) {
    console.warn('pasteText: no target app known — pasting into current frontmost window.');
  }

  execFile('osascript', ['-e', script], (err) => {
    if (err) console.error('Failed to simulate paste:', err.message);
  });

  // Track for undo functionality
  lastPastedText = text;

  _restoreTimer = setTimeout(() => {
    if (_originalClipboard !== null) clipboard.writeText(_originalClipboard);
    _originalClipboard = null;
    _restoreTimer = null;
  }, RESTORE_DELAY_MS);
}

/**
 * Undo the last paste by simulating Cmd+Z in the target app.
 * Returns true if an undo was attempted, false if there was nothing to undo.
 * Can only undo once — subsequent calls return false until a new paste occurs.
 */
function undoLastPaste(targetApp) {
  if (!lastPastedText) return false;

  const safeTarget = targetApp ? targetApp.replace(/[\\"'\n\r]/g, '') : null;
  const script = safeTarget
    ? `tell application "${safeTarget}" to activate\ndelay 0.15\ntell application "System Events" to keystroke "z" using command down`
    : 'tell application "System Events" to keystroke "z" using command down';

  execFile('osascript', ['-e', script], (err) => {
    if (err) console.error('Undo paste failed:', err.message);
  });

  lastPastedText = null;
  return true;
}

/**
 * Returns the last pasted text, or null if nothing has been pasted
 * (or if the last paste was already undone).
 */
function getLastPastedText() {
  return lastPastedText;
}

module.exports = { pasteText, undoLastPaste, getLastPastedText };
