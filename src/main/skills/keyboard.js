const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

async function runScript(script) {
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 5000 });
  return stdout.trim();
}

// Maps human-readable modifier names to AppleScript modifier names
const MODIFIER_MAP = {
  cmd: 'command down',
  command: 'command down',
  ctrl: 'control down',
  control: 'control down',
  alt: 'option down',
  option: 'option down',
  shift: 'shift down',
};

// Maps key names to special AppleScript key codes
const KEY_CODE_MAP = {
  return: 36,
  enter: 36,
  tab: 48,
  space: 49,
  delete: 51,
  backspace: 51,
  escape: 53,
  esc: 53,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  up: 126,
  down: 125,
  left: 123,
  right: 124,
  f1: 122, f2: 120, f3: 99, f4: 118,
  f5: 96, f6: 97, f7: 98, f8: 100,
  f9: 101, f10: 109, f11: 103, f12: 111,
};

function buildKeyScript(key, modifiers = []) {
  const mods = modifiers
    .map(m => MODIFIER_MAP[m.toLowerCase()])
    .filter(Boolean);

  const keyLower = key.toLowerCase();
  if (KEY_CODE_MAP[keyLower] !== undefined) {
    const code = KEY_CODE_MAP[keyLower];
    const modPart = mods.length > 0 ? ` using {${mods.join(', ')}}` : '';
    return `tell application "System Events" to key code ${code}${modPart}`;
  }

  const modPart = mods.length > 0 ? ` using {${mods.join(', ')}}` : '';
  const safKey = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `tell application "System Events" to keystroke "${safKey}"${modPart}`;
}

module.exports = {
  name: 'Keyboard',
  description: 'Simulate keyboard input, shortcuts, and text typing',
  tools: [
    {
      name: 'type_text',
      description: 'Type a string of text at the current cursor position.',
      parameters: {
        text: { type: 'string', description: 'The text to type' },
      },
      async execute({ text }) {
        const safe = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        await runScript(`tell application "System Events" to keystroke "${safe}"`);
        return `Typed: ${text}`;
      },
    },
    {
      name: 'press_key',
      description: 'Press a key, optionally with modifier keys.',
      parameters: {
        key: { type: 'string', description: 'Key to press, e.g. "c", "v", "enter", "escape", "tab", "up", "down"' },
        modifiers: { type: 'array', description: 'Modifier keys: ["cmd"], ["cmd","shift"], ["ctrl"], etc.', items: { type: 'string' } },
      },
      async execute({ key, modifiers = [] }) {
        await runScript(buildKeyScript(key, modifiers));
        const label = modifiers.length ? `${modifiers.join('+')}+${key}` : key;
        return `Pressed ${label}`;
      },
    },
    {
      name: 'shortcut',
      description: 'Execute a common named keyboard shortcut.',
      parameters: {
        action: {
          type: 'string',
          description: 'Shortcut name: "copy", "paste", "cut", "undo", "redo", "select_all", "save", "new_tab", "close_tab", "find", "new_window"',
        },
      },
      async execute({ action }) {
        const shortcuts = {
          copy: ['c', ['cmd']],
          paste: ['v', ['cmd']],
          cut: ['x', ['cmd']],
          undo: ['z', ['cmd']],
          redo: ['z', ['cmd', 'shift']],
          select_all: ['a', ['cmd']],
          save: ['s', ['cmd']],
          new_tab: ['t', ['cmd']],
          close_tab: ['w', ['cmd']],
          find: ['f', ['cmd']],
          new_window: ['n', ['cmd']],
        };
        const pair = shortcuts[action.toLowerCase()];
        if (!pair) throw new Error(`Unknown shortcut: ${action}`);
        await runScript(buildKeyScript(pair[0], pair[1]));
        return `Executed ${action}`;
      },
    },
    {
      name: 'select_all_and_type',
      description: 'Select all existing text in the focused input and replace it with new text.',
      parameters: {
        text: { type: 'string', description: 'Replacement text' },
      },
      async execute({ text }) {
        const safe = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        await runScript(`
          tell application "System Events"
            keystroke "a" using command down
            delay 0.1
            keystroke "${safe}"
          end tell
        `);
        return `Replaced text with: ${text}`;
      },
    },
  ],
};
