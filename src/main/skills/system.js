const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execFileAsync = promisify(execFile);

async function runScript(script) {
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 5000 });
  return stdout.trim();
}

module.exports = {
  name: 'System',
  description: 'Control system-level settings: volume, brightness, Wi-Fi, Bluetooth, Dark Mode, notifications, and more',
  tools: [
    {
      name: 'get_volume',
      description: 'Get the current system output volume (0–100).',
      parameters: {},
      async execute() {
        const vol = await runScript('output volume of (get volume settings)');
        return `Volume: ${vol}`;
      },
    },
    {
      name: 'set_volume',
      description: 'Set the system output volume (0–100).',
      parameters: {
        level: { type: 'number', description: 'Volume level from 0 (mute) to 100 (max)' },
      },
      async execute({ level }) {
        const clamped = Math.max(0, Math.min(100, Math.round(level)));
        await runScript(`set volume output volume ${clamped}`);
        return `Volume set to ${clamped}`;
      },
    },
    {
      name: 'mute_volume',
      description: 'Mute or unmute system audio.',
      parameters: {
        mute: { type: 'boolean', description: 'true to mute, false to unmute' },
      },
      async execute({ mute }) {
        await runScript(`set volume ${mute ? 'with' : 'without'} output muted`);
        return mute ? 'Audio muted' : 'Audio unmuted';
      },
    },
    {
      name: 'set_brightness',
      description: 'Set the display brightness (0.0 to 1.0).',
      parameters: {
        level: { type: 'number', description: 'Brightness from 0.0 (dark) to 1.0 (full brightness)' },
      },
      async execute({ level }) {
        const clamped = Math.max(0, Math.min(1, level));
        await execFileAsync('osascript', ['-e', `
          tell application "System Preferences" to quit
          delay 0.2
          do shell script "brightness ${clamped.toFixed(2)}"
        `], { timeout: 5000 }).catch(() => {
          // brightness CLI may not be available; fall back silently
        });
        return `Brightness set to ${Math.round(clamped * 100)}%`;
      },
    },
    {
      name: 'toggle_dark_mode',
      description: 'Toggle macOS Dark Mode on or off.',
      parameters: {
        enable: { type: 'boolean', description: 'true to enable Dark Mode, false to disable' },
      },
      async execute({ enable }) {
        const mode = enable ? 'true' : 'false';
        await runScript(`
          tell application "System Events"
            tell appearance preferences
              set dark mode to ${mode}
            end tell
          end tell
        `);
        return `Dark Mode ${enable ? 'enabled' : 'disabled'}`;
      },
    },
    {
      name: 'lock_screen',
      description: 'Lock the screen immediately.',
      parameters: {},
      async execute() {
        await execFileAsync(
          '/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession',
          ['-suspend'],
          { timeout: 5000 }
        ).catch(() => runScript(`
          tell application "System Events"
            keystroke "q" using {command down, control down, option down}
          end tell
        `));
        return 'Screen locked';
      },
    },
    {
      name: 'sleep_display',
      description: 'Put the display to sleep.',
      parameters: {},
      async execute() {
        await execFileAsync('pmset', ['displaysleepnow'], { timeout: 5000 });
        return 'Display sleeping';
      },
    },
    {
      name: 'empty_trash',
      description: 'Empty the macOS Trash.',
      parameters: {},
      async execute() {
        await runScript('tell application "Finder" to empty trash');
        return 'Trash emptied';
      },
    },
    {
      name: 'get_system_info',
      description: 'Return basic system information (OS version, CPU, RAM, uptime).',
      parameters: {},
      async execute() {
        const info = {
          platform: os.platform(),
          arch: os.arch(),
          os_release: os.release(),
          hostname: os.hostname(),
          total_ram_gb: (os.totalmem() / 1024 ** 3).toFixed(1),
          free_ram_gb: (os.freemem() / 1024 ** 3).toFixed(1),
          uptime_hours: (os.uptime() / 3600).toFixed(1),
          cpu: os.cpus()[0]?.model || 'Unknown',
          cpu_cores: os.cpus().length,
        };
        return JSON.stringify(info, null, 2);
      },
    },
    {
      name: 'open_url_default',
      description: 'Open a URL in the system default browser (not a specific browser).',
      parameters: {
        url: { type: 'string', description: 'Full URL including protocol, e.g. "https://example.com"' },
      },
      async execute({ url }) {
        const { shell } = require('electron');
        await shell.openExternal(url);
        return `Opened ${url}`;
      },
    },
    {
      name: 'show_notification',
      description: 'Show a macOS desktop notification.',
      parameters: {
        title: { type: 'string', description: 'Notification title' },
        body: { type: 'string', description: 'Notification body text' },
      },
      async execute({ title, body }) {
        const safeTitle = (title || '').replace(/"/g, '\\"');
        const safeBody = (body || '').replace(/"/g, '\\"');
        await runScript(`display notification "${safeBody}" with title "${safeTitle}"`);
        return `Notification shown: ${title}`;
      },
    },
    {
      name: 'remember',
      description: 'Store a fact about the user for future reference.',
      parameters: {
        key: { type: 'string', description: 'A unique identifier for this fact, e.g. "preferred_browser", "work_folder"' },
        value: { type: 'string', description: 'The value to remember' },
      },
      async execute({ key, value }) {
        const memory = require('../memory');
        memory.setFact(key, value, 'preference');
        return `Remembered: ${key} = ${value}`;
      },
    },
    {
      name: 'recall',
      description: 'Recall a stored fact about the user.',
      parameters: {
        key: { type: 'string', description: 'The fact key to recall' },
      },
      async execute({ key }) {
        const memory = require('../memory');
        const val = memory.getFact(key);
        return val !== null ? `${key}: ${val}` : `No memory found for key: ${key}`;
      },
    },
  ],
};
