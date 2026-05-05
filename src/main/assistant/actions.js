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

  // CUA-powered computer control actions (uses bundled CUA server binary)
  screenshot: {
    name: 'screenshot',
    description: 'Take a screenshot of the current screen',
    execute: async () => {
      try {
        const cua = require('./cua-server');
        const result = await cua.screenshot();
        if (result.image) {
          // Save screenshot to disk
          const path = require('path');
          const { app } = require('electron');
          const dir = path.join(app.getPath('userData'), 'screenshots');
          const fs = require('fs');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const dest = path.join(dir, `screenshot-${Date.now()}.png`);
          fs.writeFileSync(dest, Buffer.from(result.image, 'base64'));
          return `Screenshot saved (${Math.round(result.image.length * 0.75 / 1024)} KB)`;
        }
        return 'Screenshot captured';
      } catch {
        // Fallback to native screencapture
        return new Promise((resolve, reject) => {
          exec('screencapture -x /tmp/screenshot.png', (err) => {
            if (err) reject(err); else resolve('Screenshot saved to /tmp/screenshot.png');
          });
        });
      }
    },
  },

  run_shortcut: {
    name: 'run_shortcut',
    description: 'Run a macOS Shortcut by name',
    execute: async ({ name }) => {
      return new Promise((resolve, reject) => {
        exec(`shortcuts run "${name}"`, { timeout: 15000 }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim() || `Shortcut "${name}" executed`);
        });
      });
    },
  },

  list_apps: {
    name: 'list_apps',
    description: 'List currently running applications',
    execute: async () => {
      return execAppleScript('tell application "System Events" to get name of every process whose background only is false');
    },
  },

  create_note: {
    name: 'create_note',
    description: 'Create a note in Apple Notes',
    execute: async ({ title, body }) => {
      const script = `tell application "Notes" to make new note at folder "Notes" with properties {name:"${title}", body:"${body || ''}"}`;
      await execAppleScript(script);
      return `Note created: "${title}"`;
    },
  },

  set_brightness: {
    name: 'set_brightness',
    description: 'Set display brightness (0.0 to 1.0)',
    execute: async ({ level }) => {
      const l = Math.max(0, Math.min(1, parseFloat(level)));
      return new Promise((resolve, reject) => {
        exec(`brightness ${l}`, (err) => {
          if (err) resolve(`Brightness command not available. Install: brew install brightness`);
          else resolve(`Brightness set to ${Math.round(l * 100)}%`);
        });
      });
    },
  },

  run_command: {
    name: 'run_command',
    description: 'Run a shell command and return the output (safe commands only)',
    execute: async ({ command }) => {
      // Safety: block destructive commands
      const BLOCKED = ['rm ', 'sudo ', 'mkfs', 'dd ', 'format', '> /dev', 'shutdown', 'reboot'];
      if (BLOCKED.some(b => command.toLowerCase().includes(b))) {
        return 'Blocked: that command is not allowed for safety reasons.';
      }
      return new Promise((resolve) => {
        exec(command, { timeout: 10000 }, (err, stdout, stderr) => {
          if (err) resolve(`Error: ${stderr || err.message}`);
          else resolve(stdout.trim() || 'Command executed (no output)');
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
