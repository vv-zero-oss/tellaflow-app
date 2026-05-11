const { clipboard } = require('electron');
const { pasteViaShell } = require('./platform-shell');

const RESTORE_DELAY_MS = 600;

// Each paste captures the clipboard state at call time. We track the
// ORIGINAL pre-first-paste value so back-to-back recordings don't
// overwrite it with a transcription string.
let _restoreTimer = null;
let _originalClipboard = null;

/**
 * Paste text into the target app.
 * Always re-activates `targetApp` before simulating Cmd+V (mac) / Ctrl+V (win)
 * so the keystroke lands in the correct text field regardless of what stole
 * focus during recording (hidden BrowserWindow creation, notifications, etc.).
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

  if (!targetApp) {
    console.warn('pasteText: no target app known — pasting into current frontmost window.');
  }

  pasteViaShell(targetApp).catch((err) => {
    console.error('Failed to simulate paste:', err && err.message ? err.message : err);
  });

  _restoreTimer = setTimeout(() => {
    if (_originalClipboard !== null) clipboard.writeText(_originalClipboard);
    _originalClipboard = null;
    _restoreTimer = null;
  }, RESTORE_DELAY_MS);
}

module.exports = { pasteText };
