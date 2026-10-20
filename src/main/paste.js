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

// The focused element's selected text, through Accessibility. Electron and
// Chromium apps keep their tree off until an assistive app asks for it.
// Prints "ok" + linefeed + the selection (empty: nothing selected), or
// "unknown" when the app doesn't say.
const SELECTED_TEXT_SCRIPT = `
tell application "System Events"
  set p to first application process whose frontmost is true
  try
    set s to value of attribute "AXSelectedText" of (value of attribute "AXFocusedUIElement" of p)
    if s is missing value then error "none"
    return "ok" & linefeed & (s as text)
  end try
  try
    set value of attribute "AXManualAccessibility" of p to true
    delay 0.1
    set s to value of attribute "AXSelectedText" of (value of attribute "AXFocusedUIElement" of p)
    if s is missing value then error "none"
    return "ok" & linefeed & (s as text)
  end try
end tell
return "unknown"
`;

function osa(script, timeout = 3000) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

/** Press keys in System Events and read what landed on the clipboard. */
async function copyWith(keys, safeTarget) {
  clipboard.clear();
  const body = `tell application "System Events"\n${keys}\nend tell`;
  await osa(safeTarget ? `tell application "${safeTarget}" to activate\ndelay 0.1\n${body}` : body);
  for (const t0 = Date.now(); Date.now() - t0 < COPY_WAIT_MS;) {
    const text = clipboard.readText();
    if (text) return text;
    await new Promise((r) => setTimeout(r, 50));
  }
  return '';
}

const COPY = 'keystroke "c" using command down';
const SELECT_ALL_COPY = 'keystroke "a" using command down\ndelay 0.05\nkeystroke "c" using command down';

/**
 * The text to rewrite in the focused field: { text, app, scope }.
 * What the user selected (scope 'selection'); with nothing selected, the
 * whole field (scope 'all', selected with ⌘A so the paste replaces it).
 * The selection is read through Accessibility first; an app that doesn't
 * expose it is asked with ⌘C (an empty copy means nothing is selected). The
 * clipboard is put back afterwards.
 */
async function copyForRewrite(targetApp = null) {
  const safeTarget = targetApp ? targetApp.replace(/[\\"'\n\r]/g, '') : null;
  let selection = null; // null: the app didn't say
  try {
    const out = (await osa(SELECTED_TEXT_SCRIPT, 2000)).replace(/\n$/, '');
    if (out.startsWith('ok\n') || out === 'ok') selection = out.slice(3);
  } catch {}
  if (selection) return { text: selection, app: safeTarget, scope: 'selection' };

  const original = clipboard.readText();
  try {
    if (selection === null) {
      const copied = await copyWith(COPY, safeTarget);
      if (copied) return { text: copied, app: safeTarget, scope: 'selection' };
    }
    return { text: await copyWith(SELECT_ALL_COPY, safeTarget), app: safeTarget, scope: 'all' };
  } finally {
    clipboard.writeText(original);
  }
}

module.exports = { pasteText, undoPaste, copyForRewrite };
