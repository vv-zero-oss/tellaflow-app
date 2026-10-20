const { clipboard } = require('electron');
const { execFile } = require('child_process');

// How long the target app gets to read the clipboard after Cmd+V has been
// delivered before the user's own clipboard goes back. Apps handle the
// keystroke asynchronously, so "osascript returned" is not "pasted" yet.
const RESTORE_DELAY_MS = 600;
// An app that hangs on activate must not hold every later paste hostage.
const SCRIPT_TIMEOUT_MS = 5000;

const PASTE_KEY = 'tell application "System Events" to keystroke "v" using command down';
const UNDO_KEY = 'tell application "System Events" to keystroke "z" using command down';

// Strip characters that would break the osascript string literal. Names come
// from System Events, so this is a safety measure, not a user-input concern.
function sanitizeApp(name) {
  return name ? name.replace(/[\\"'\n\r]/g, '') : null;
}

// Keys the user is still holding combine with our synthetic keystroke: after
// ⌃⌘V (Paste Last Transcript) a held ⌃⌘ turns Cmd+V into ⌃⌘V again — our own
// shortcut, not a paste — and a held ⌥ or ⇧ turns it into "move" in Finder or
// "paste and match style". So wait for ⇧⌃⌥⌘ to be released first. They are
// bits 17–20 of NSEvent.modifierFlags (AppleScript has no bitwise ops, hence
// div/mod). Still held after MODIFIER_WAIT_TICKS × 20 ms → fail, which leaves
// the text on the clipboard to paste by hand.
const MODIFIER_WAIT_TICKS = 150;
const WAIT_FOR_MODIFIERS = [
  'set waited to 0',
  'repeat while ((current application\'s NSEvent\'s modifierFlags()) div 131072) mod 16 > 0',
  `if waited >= ${MODIFIER_WAIT_TICKS} then error "Modifier keys are still held down" number 1`,
  'delay 0.02',
  'set waited to waited + 1',
  'end repeat',
].join('\n');

// Re-activate the target before the keystroke so it lands in the right field
// whatever stole focus meanwhile. With no target, the keystroke goes to the
// frontmost window (best effort).
function keystrokeScript(key, targetApp) {
  const safeTarget = sanitizeApp(targetApp);
  return [
    'use framework "AppKit"',
    'use scripting additions',
    ...(safeTarget ? [`tell application "${safeTarget}" to activate`, 'delay 0.15'] : []),
    WAIT_FOR_MODIFIERS,
    key,
  ].join('\n');
}

function runOsascript(script) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: SCRIPT_TIMEOUT_MS }, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Everything on the clipboard that we can put back: plain text, rich text,
 * HTML, an image, a bookmark, and a file copied in Finder. Reading only the
 * text would turn a copied image or file into an empty clipboard.
 */
function snapshotClipboard(cb) {
  const formats = cb.availableFormats();
  const snap = { formats };
  if (!formats.length) return snap;
  const text = cb.readText();
  if (text) snap.text = text;
  if (formats.includes('text/html')) {
    const html = cb.readHTML();
    if (html) snap.html = html;
  }
  if (formats.includes('text/rtf')) {
    const rtf = cb.readRTF();
    if (rtf) snap.rtf = rtf;
  }
  if (formats.some((f) => f.startsWith('image/'))) {
    const image = cb.readImage();
    if (image && !image.isEmpty()) snap.image = image;
  }
  if (process.platform === 'darwin') {
    try {
      const fileUrl = cb.readBuffer('public.file-url');
      if (fileUrl && fileUrl.length) snap.fileUrl = fileUrl;
    } catch {}
  }
  return snap;
}

function restoreClipboard(cb, snap) {
  if (!snap.formats.length) { cb.clear(); return; }
  // A Finder file copy is only pasteable as a file through its file URL.
  if (snap.fileUrl) { cb.writeBuffer('public.file-url', snap.fileUrl); return; }
  const data = {};
  for (const key of ['text', 'html', 'rtf', 'image']) if (snap[key] !== undefined) data[key] = snap[key];
  if (Object.keys(data).length) cb.write(data);
  else cb.clear();
}

/**
 * Pasting goes through the clipboard: put our text on it, press Cmd+V, then
 * put the user's clipboard back. The edge cases this handles:
 *
 * - The keystroke lands after activate + delay + osascript start-up, so the
 *   restore waits for the script to finish (plus RESTORE_DELAY_MS). Restoring
 *   on a fixed timer from the moment we wrote raced it: a slow activate meant
 *   Cmd+V pasted the user's old clipboard instead of our text.
 * - Pastes are serialized. A second paste writing the clipboard while the
 *   first's Cmd+V is still in flight would paste the wrong text into the
 *   first app.
 * - Back-to-back pastes restore the clipboard from before the first one, once,
 *   after the last one — never a transcript.
 * - If the clipboard no longer holds our text at restore time, the user (or
 *   another app) copied something meanwhile: that is kept, not overwritten.
 * - Modifier keys still held (⌃⌘ from ⌃⌘V) are waited out before Cmd+V; see
 *   WAIT_FOR_MODIFIERS.
 * - If the keystroke failed (no Accessibility, script timed out, modifiers
 *   never released), our text is left on the clipboard so the user can paste
 *   it by hand.
 * - Non-text clipboards (images, rich text, Finder files) and an empty
 *   clipboard are restored as they were.
 */
function createPaster({ clipboard: cb, runScript = runOsascript, restoreDelayMs = RESTORE_DELAY_MS, wait } = {}) {
  const sleep = wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let queue = Promise.resolve();
  let pending = 0;
  // The clipboard from before the current burst of pastes, and the text we
  // last wrote (to tell whether anyone has copied over it since).
  let original = null;
  let ours = null;

  async function pasteOne(text, targetApp) {
    if (original === null) original = snapshotClipboard(cb);
    cb.writeText(text);
    ours = text;

    if (!sanitizeApp(targetApp)) console.warn('pasteText: no target app known — pasting into current frontmost window.');
    let pasted = true;
    try {
      await runScript(keystrokeScript(PASTE_KEY, targetApp));
    } catch (err) {
      pasted = false;
      console.error('Failed to simulate paste:', err.message);
    }
    await sleep(restoreDelayMs);

    // Another paste is queued: it keeps the same original and restores it.
    if (pending > 1) return pasted;
    const snap = original;
    original = null;
    if (!pasted) return pasted;
    if (cb.readText() !== ours) return pasted;
    restoreClipboard(cb, snap);
    return pasted;
  }

  function pasteText(text, targetApp = null) {
    pending++;
    const run = queue.then(() => pasteOne(text, targetApp)).finally(() => { pending--; });
    queue = run.catch(() => {});
    return run;
  }

  return { pasteText };
}

const paster = createPaster({ clipboard });

/**
 * Paste text into the target app (re-activated first). Resolves to whether
 * the Cmd+V keystroke was delivered; callers may ignore the promise.
 */
function pasteText(text, targetApp = null) {
  return paster.pasteText(text, targetApp);
}

/** Undo the last paste: re-activate the app it went into and press Cmd+Z. */
function undoPaste(targetApp = null) {
  runOsascript(keystrokeScript(UNDO_KEY, targetApp)).catch((err) => {
    console.error('Failed to simulate undo:', err.message);
  });
}

module.exports = { pasteText, undoPaste, createPaster, snapshotClipboard, restoreClipboard, keystrokeScript };
