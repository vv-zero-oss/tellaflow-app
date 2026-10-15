/**
 * Thin, safe wrappers around `osascript`.
 *
 * Safety rule used everywhere in Tellaflow: user- or AI-supplied text is
 * passed as separate argv entries (`on run argv`) and NEVER interpolated into
 * script source, so it cannot break out of a string literal and run code.
 */

const { execFile } = require('child_process');

function runOsascript(args, { timeout = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('osascript', args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').toString().trim();
        reject(new Error(msg || 'osascript failed'));
        return;
      }
      resolve(stdout.toString().replace(/\n$/, ''));
    });
  });
}

/**
 * Run an AppleScript whose body is wrapped in `on run argv … end run`.
 * `argv` values reach the script as `item n of argv`.
 */
function runAppleScript(body, argv = [], opts) {
  const script = `on run argv\n${body}\nend run`;
  return runOsascript(['-e', script, ...argv.map((a) => String(a))], opts);
}

/** Run raw AppleScript source as-is (only for user-approved scripts). */
function runRawAppleScript(source, opts) {
  return runOsascript(['-e', source], opts);
}

const FRONTMOST_CONTEXT_SCRIPT = `
set appName to ""
set bid to ""
set winTitle to ""
set fv to ""
tell application "System Events"
  set p to first application process whose frontmost is true
  set appName to name of p
  try
    set bid to bundle identifier of p
  end try
  try
    set winTitle to (value of attribute "AXTitle" of (value of attribute "AXFocusedWindow" of p)) as text
  end try
  try
    set fv to (value of attribute "AXValue" of (value of attribute "AXFocusedUIElement" of p)) as text
  end try
end tell
return appName & linefeed & bid & linefeed & winTitle & linefeed & fv
`;

// Like FRONTMOST_CONTEXT_SCRIPT, but when the focused element has no value it
// asks the app to expose its accessibility tree (Electron apps such as Slack,
// Discord, Notion and VS Code, and Chromium browsers, keep it off unless an
// assistive app sets AXManualAccessibility) and reads again.
const FOCUSED_FIELD_SCRIPT = `
set appName to ""
set fv to ""
tell application "System Events"
  set p to first application process whose frontmost is true
  set appName to name of p
  try
    set fv to (value of attribute "AXValue" of (value of attribute "AXFocusedUIElement" of p)) as text
  end try
  if fv is "" then
    try
      set value of attribute "AXManualAccessibility" of p to true
      delay 0.1
      set fv to (value of attribute "AXValue" of (value of attribute "AXFocusedUIElement" of p)) as text
    end try
  end if
end tell
return appName & linefeed & "" & linefeed & "" & linefeed & fv
`;

function parseContextOutput(out, maxValue = 4000) {
  const lines = String(out || '').split('\n');
  const [app = '', bundleId = '', windowTitle = '', ...rest] = lines;
  const value = rest.join('\n');
  return {
    app: app.trim(),
    bundleId: bundleId.trim(),
    windowTitle: windowTitle.trim(),
    focusedValue: value.length > maxValue ? value.slice(-maxValue) : value,
  };
}

/** Frontmost app, bundle id, focused window title and focused field text. */
async function getFrontmostContext() {
  try {
    return parseContextOutput(await runAppleScript(FRONTMOST_CONTEXT_SCRIPT, [], { timeout: 1500 }), 4000);
  } catch {
    return null;
  }
}

/** { app, value } of the focused text field — used by auto-learn. */
async function readFocusedField() {
  try {
    const ctx = parseContextOutput(await runAppleScript(FOCUSED_FIELD_SCRIPT, [], { timeout: 1500 }), 20000);
    return { app: ctx.app, value: ctx.focusedValue };
  } catch {
    return null;
  }
}

/** Names of running GUI apps (System Events, no app launch side effects). */
async function listRunningApps() {
  try {
    const out = await runAppleScript(
      'tell application "System Events" to set n to name of every application process whose background only is false\n' +
      "set AppleScript's text item delimiters to linefeed\nreturn n as text",
      [],
      { timeout: 2000 },
    );
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Window titles of a running app process ([] if not running / no permission). */
async function getWindowTitles(appName) {
  try {
    const out = await runAppleScript(
      'tell application "System Events"\n' +
      '  if not (exists application process (item 1 of argv)) then return ""\n' +
      '  set t to name of every window of application process (item 1 of argv)\n' +
      'end tell\n' +
      "set AppleScript's text item delimiters to linefeed\nreturn t as text",
      [appName],
      { timeout: 2000 },
    );
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const CHROMIUM_BROWSERS = ['Google Chrome', 'Arc', 'Brave Browser', 'Microsoft Edge', 'Vivaldi', 'Chromium'];

/**
 * Tab URLs of a browser that is ALREADY running. `tell application` would
 * launch it otherwise, so callers must pass only names from listRunningApps().
 * Requires the user's Automation permission for that browser.
 */
async function getBrowserTabUrls(browser) {
  const isSafari = browser === 'Safari';
  if (!isSafari && !CHROMIUM_BROWSERS.includes(browser)) return [];
  // App name must be a literal in a `tell` block; we only accept names from
  // the fixed allow-list above, never caller text.
  const body = isSafari
    ? 'tell application "Safari" to set u to URL of every tab of every window'
    : `tell application "${browser}" to set u to URL of every tab of every window`;
  try {
    const out = await runAppleScript(
      `${body}\nset out to {}\nrepeat with w in u\nrepeat with t in w\nset end of out to (t as text)\nend repeat\nend repeat\n` +
      "set AppleScript's text item delimiters to linefeed\nreturn out as text",
      [],
      { timeout: 2500 },
    );
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Executable names of all running processes (`ps`), used to spot Zoom's CptHost. */
function listProcessNames() {
  return new Promise((resolve) => {
    execFile('ps', ['-axo', 'comm='], { timeout: 2000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      resolve(stdout.toString().split('\n').map((l) => l.trim().split('/').pop()).filter(Boolean));
    });
  });
}

module.exports = {
  runOsascript,
  runAppleScript,
  runRawAppleScript,
  parseContextOutput,
  getFrontmostContext,
  readFocusedField,
  listRunningApps,
  getWindowTitles,
  getBrowserTabUrls,
  listProcessNames,
  CHROMIUM_BROWSERS,
};
