const { execFile } = require('child_process');

// ---------------------------------------------------------------------------
// Inline text commands (recognized within transcription text)
// Sorted longest-pattern-first to prevent partial matches.
// ---------------------------------------------------------------------------

const INLINE_COMMANDS = [
  // Multi-word (longer) patterns first
  { pattern: 'new paragraph', replacement: '\n\n' },
  { pattern: 'new line', replacement: '\n' },
  { pattern: 'newline', replacement: '\n' },
  { pattern: 'tab key', replacement: '\t' },
  { pattern: 'full stop', replacement: '.' },
  { pattern: 'question mark', replacement: '?' },
  { pattern: 'exclamation point', replacement: '!' },
  { pattern: 'exclamation mark', replacement: '!' },
  { pattern: 'semi colon', replacement: ';' },
  { pattern: 'semicolon', replacement: ';' },
  { pattern: 'open quote', replacement: '\u201c' },
  { pattern: 'close quote', replacement: '\u201d' },
  { pattern: 'end quote', replacement: '\u201d' },
  { pattern: 'open parenthesis', replacement: '(' },
  { pattern: 'open paren', replacement: '(' },
  { pattern: 'close parenthesis', replacement: ')' },
  { pattern: 'close paren', replacement: ')' },
  { pattern: 'at sign', replacement: '@' },
  { pattern: 'dollar sign', replacement: '$' },
  { pattern: 'percent sign', replacement: '%' },
  { pattern: 'forward slash', replacement: '/' },
  { pattern: 'plus sign', replacement: '+' },
  { pattern: 'equals sign', replacement: '=' },
  // Single-word patterns
  { pattern: 'period', replacement: '.' },
  { pattern: 'comma', replacement: ',' },
  { pattern: 'colon', replacement: ':' },
  { pattern: 'hyphen', replacement: '-' },
  { pattern: 'dash', replacement: '-' },
  { pattern: 'underscore', replacement: '_' },
  { pattern: 'hashtag', replacement: '#' },
  { pattern: 'hash', replacement: '#' },
  { pattern: 'percent', replacement: '%' },
  { pattern: 'ampersand', replacement: '&' },
  { pattern: 'asterisk', replacement: '*' },
  { pattern: 'star', replacement: '*' },
  { pattern: 'slash', replacement: '/' },
  { pattern: 'backslash', replacement: '\\' },
  { pattern: 'equals', replacement: '=' },
  { pattern: 'plus', replacement: '+' },
];

// Pre-compile regexes for each inline command (word-boundary, case-insensitive)
const INLINE_REGEXES = INLINE_COMMANDS.map((cmd) => ({
  regex: new RegExp(`\\b${cmd.pattern.replace(/\s+/g, '\\s+')}\\b`, 'gi'),
  replacement: cmd.replacement,
}));

// ---------------------------------------------------------------------------
// Action commands (entire transcription must match exactly)
// ---------------------------------------------------------------------------

const ACTION_COMMANDS = {
  'undo': 'keystroke "z" using command down',
  'undo that': 'keystroke "z" using command down',
  'redo': 'keystroke "z" using {command down, shift down}',
  'redo that': 'keystroke "z" using {command down, shift down}',
  'select all': 'keystroke "a" using command down',
  'copy': 'keystroke "c" using command down',
  'copy that': 'keystroke "c" using command down',
  'cut': 'keystroke "x" using command down',
  'cut that': 'keystroke "x" using command down',
  'delete': 'key code 51',
  'delete that': 'key code 51',
  'backspace': 'key code 51',
  'escape': 'key code 53',
};

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

/**
 * Process voice commands in transcription text.
 * Returns { type: 'action', action: '...' } if the entire utterance is a
 * recognized action command, or { type: 'text', text: '...' } with inline
 * replacements applied.
 */
function processVoiceCommands(text) {
  if (!text || typeof text !== 'string') {
    return { type: 'text', text: text || '' };
  }

  // Check for action commands first (entire transcription must match)
  const normalized = text.trim().toLowerCase();
  const action = ACTION_COMMANDS[normalized];
  if (action) {
    return { type: 'action', action };
  }

  // Apply inline text command replacements
  let result = text;
  for (const { regex, replacement } of INLINE_REGEXES) {
    // Reset lastIndex in case of sticky state
    regex.lastIndex = 0;
    result = result.replace(regex, replacement);
  }

  return { type: 'text', text: result };
}

// ---------------------------------------------------------------------------
// Action execution (osascript, matching paste.js style)
// ---------------------------------------------------------------------------

/**
 * Execute a keyboard action via osascript in the target application.
 * @param {string} action - The System Events tell command (e.g. 'keystroke "z" using command down')
 * @param {string|null} targetApp - The application to target (optional)
 */
function executeAction(action, targetApp) {
  const safeTarget = targetApp ? targetApp.replace(/[\\"'\n\r]/g, '') : null;
  const activateScript = safeTarget
    ? `tell application "${safeTarget}" to activate\ndelay 0.15\n`
    : '';
  const script = `${activateScript}tell application "System Events" to ${action}`;

  execFile('osascript', ['-e', script], (err) => {
    if (err) console.error('Voice command action failed:', err.message);
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  processVoiceCommands,
  executeAction,
};
