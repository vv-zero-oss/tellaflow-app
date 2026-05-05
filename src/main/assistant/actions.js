/**
 * Action executors for voice assistant tool calls.
 * These are the actual functions that run when the LLM calls a tool.
 */
const { exec } = require('child_process');
const { shell, clipboard } = require('electron');

function execAppleScript(script) {
  return new Promise((resolve, reject) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

// ─── Action Registry ────────────────────────────────────────────────────────────

const ACTIONS = {
  open_app: {
    name: 'open_app',
    description: 'Launch or activate a macOS application',
    execute: async ({ name }) => {
      await execAppleScript(`tell application "${name}" to activate`);
      return `Opened ${name}`;
    },
  },

  open_url: {
    name: 'open_url',
    description: 'Open a URL in the default browser',
    execute: async ({ url }) => {
      await shell.openExternal(url);
      return `Opened ${url}`;
    },
  },

  search_web: {
    name: 'search_web',
    description: 'Search the web',
    execute: async ({ query }) => {
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      await shell.openExternal(url);
      return `Searching for: ${query}`;
    },
  },

  get_time: {
    name: 'get_time',
    description: 'Get current date and time',
    execute: async () => {
      return new Date().toLocaleString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      });
    },
  },

  get_clipboard: {
    name: 'get_clipboard',
    description: 'Read clipboard contents',
    execute: async () => {
      return clipboard.readText() || '(clipboard is empty)';
    },
  },

  type_text: {
    name: 'type_text',
    description: 'Type text into the active application',
    execute: async ({ text }) => {
      // Reuse existing paste logic
      const paste = require('../paste');
      await paste.pasteText(text);
      return `Typed: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`;
    },
  },

  set_volume: {
    name: 'set_volume',
    description: 'Set system volume (0-100)',
    execute: async ({ level }) => {
      const vol = Math.max(0, Math.min(100, Math.round(level)));
      const macVol = Math.round(vol * 7 / 100); // macOS uses 0-7
      await execAppleScript(`set volume output volume ${vol}`);
      return `Volume set to ${vol}%`;
    },
  },

  toggle_dark_mode: {
    name: 'toggle_dark_mode',
    description: 'Toggle system dark mode',
    execute: async () => {
      await execAppleScript('tell application "System Events" to tell appearance preferences to set dark mode to not dark mode');
      return 'Dark mode toggled';
    },
  },

  get_active_app: {
    name: 'get_active_app',
    description: 'Get the currently active application',
    execute: async () => {
      const result = await execAppleScript('tell application "System Events" to get name of first application process whose frontmost is true');
      return `Active app: ${result}`;
    },
  },

  set_timer: {
    name: 'set_timer',
    description: 'Set a timer (shows notification when done)',
    execute: async ({ seconds, label }) => {
      const ms = (seconds || 60) * 1000;
      const title = label || `${seconds}s timer`;
      setTimeout(() => {
        const { Notification } = require('electron');
        new Notification({ title: 'Timer Complete', body: title }).show();
      }, ms);
      return `Timer set for ${seconds} seconds: "${title}"`;
    },
  },

  create_reminder: {
    name: 'create_reminder',
    description: 'Create a reminder in Apple Reminders',
    execute: async ({ title, notes }) => {
      const script = notes
        ? `tell application "Reminders" to make new reminder with properties {name:"${title}", body:"${notes}"}`
        : `tell application "Reminders" to make new reminder with properties {name:"${title}"}`;
      await execAppleScript(script);
      return `Reminder created: "${title}"`;
    },
  },

  file_search: {
    name: 'file_search',
    description: 'Search for files using Spotlight',
    execute: async ({ query }) => {
      return new Promise((resolve, reject) => {
        exec(`mdfind "${query}" | head -5`, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim() || 'No files found');
        });
      });
    },
  },
};

/**
 * Execute a tool call by name.
 * @param {string} name - Tool name
 * @param {object} params - Tool parameters
 * @returns {Promise<string>} Result text
 */
async function executeAction(name, params) {
  const action = ACTIONS[name];
  if (!action) return `Unknown action: ${name}`;

  try {
    return await action.execute(params);
  } catch (err) {
    return `Action failed: ${err.message}`;
  }
}

/**
 * Get all action names for tool schemas.
 */
function getActionNames() {
  return Object.keys(ACTIONS);
}

module.exports = { ACTIONS, executeAction, getActionNames };
