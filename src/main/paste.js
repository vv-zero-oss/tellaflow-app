const { clipboard } = require('electron');
const { execFile } = require('child_process');

const RESTORE_DELAY_MS = 600;

// Each paste captures the clipboard state at call time. We track the
// ORIGINAL pre-first-paste value so back-to-back recordings don't
// overwrite it with a transcription string.
let _restoreTimer = null;
let _originalClipboard = null;

/**
 * Paste text into the target app.
 * Always re-activates `targetApp` before simulating Cmd+V so the keystroke
 * lands in the correct text field regardless of what stole focus during
 * recording (hidden BrowserWindow creation, notifications, etc.).
 */
function pasteText(text, targetApp = null, { selectAll = false } = {}) {
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

  // selectAll: replace everything in the field (the rewrite shortcut).
  const pasteScript = selectAll
    ? 'tell application "System Events"\nkeystroke "a" using command down\ndelay 0.05\nkeystroke "v" using command down\nend tell'
    : 'tell application "System Events" to keystroke "v" using command down';

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

  _restoreTimer = setTimeout(() => {
    if (_originalClipboard !== null) clipboard.writeText(_originalClipboard);
    _originalClipboard = null;
    _restoreTimer = null;
  }, RESTORE_DELAY_MS);
}

/** Undo the last paste: re-activate the app it went into and press Cmd+Z. */
function undoPaste(targetApp = null) {
  const safeTarget = targetApp ? targetApp.replace(/[\\"'\n\r]/g, '') : null;
  const undoScript = 'tell application "System Events" to keystroke "z" using command down';
  const script = safeTarget
    ? `tell application "${safeTarget}" to activate\ndelay 0.15\n${undoScript}`
    : undoScript;
  execFile('osascript', ['-e', script], (err) => {
    if (err) console.error('Failed to simulate undo:', err.message);
  });
}

const COPY_WAIT_MS = 900;

/**
 * Select everything in the focused field and copy it: { text, app }.
 * The clipboard is emptied first so an app that copies nothing (no field
 * focused) reads as empty instead of as whatever was on it, and is put back
 * afterwards.
 */
async function copyAllText(targetApp = null) {
  const original = clipboard.readText();
  clipboard.clear();
  const safeTarget = targetApp ? targetApp.replace(/[\\"'\n\r]/g, '') : null;
  const copyScript = 'tell application "System Events"\nkeystroke "a" using command down\ndelay 0.05\nkeystroke "c" using command down\nend tell';
  const script = safeTarget
    ? `tell application "${safeTarget}" to activate\ndelay 0.1\n${copyScript}`
    : copyScript;
  try {
    await new Promise((resolve, reject) => {
      execFile('osascript', ['-e', script], { timeout: 3000 }, (err) => (err ? reject(err) : resolve()));
    });
    let text = '';
    for (const t0 = Date.now(); Date.now() - t0 < COPY_WAIT_MS;) {
      text = clipboard.readText();
      if (text) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    return { text, app: safeTarget };
  } finally {
    clipboard.writeText(original);
  }
}

module.exports = { pasteText, undoPaste, copyAllText };
