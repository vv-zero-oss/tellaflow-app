const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const { shell } = require('electron');

const execFileAsync = promisify(execFile);

async function runScript(script) {
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 5000 });
  return stdout.trim();
}

function sanitizeAppName(name) {
  return (name || '').replace(/[\\'"]/g, '').trim();
}

module.exports = {
  name: 'App Control',
  description: 'Open, switch, quit, hide, and manage macOS applications',
  tools: [
    {
      name: 'open_app',
      description: 'Open or bring an application to the foreground. Use the full app name as it appears in Finder or the Dock.',
      parameters: {
        app: { type: 'string', description: 'Application name, e.g. "Spotify", "Google Chrome", "Terminal"' },
      },
      async execute({ app }) {
        const safe = sanitizeAppName(app);
        await runScript(`tell application "${safe}" to activate`);
        return `Opened ${app}`;
      },
    },
    {
      name: 'quit_app',
      description: 'Quit an application.',
      parameters: {
        app: { type: 'string', description: 'Application name' },
      },
      async execute({ app }) {
        const safe = sanitizeAppName(app);
        await runScript(`tell application "${safe}" to quit`);
        return `Quit ${app}`;
      },
    },
    {
      name: 'hide_app',
      description: 'Hide an application window without quitting it.',
      parameters: {
        app: { type: 'string', description: 'Application name' },
      },
      async execute({ app }) {
        const safe = sanitizeAppName(app);
        await runScript(`tell application "System Events" to set visible of process "${safe}" to false`);
        return `Hid ${app}`;
      },
    },
    {
      name: 'minimize_window',
      description: 'Minimize the frontmost window of an application.',
      parameters: {
        app: { type: 'string', description: 'Application name. Leave empty to minimize the current frontmost window.' },
      },
      async execute({ app }) {
        if (app) {
          const safe = sanitizeAppName(app);
          await runScript(`tell application "${safe}" to activate\ndelay 0.1\ntell application "System Events" to keystroke "m" using command down`);
        } else {
          await runScript(`tell application "System Events" to keystroke "m" using command down`);
        }
        return 'Minimized window';
      },
    },
    {
      name: 'get_frontmost_app',
      description: 'Get the name of the currently active application.',
      parameters: {},
      async execute() {
        const name = await runScript(
          'tell application "System Events" to get name of first process whose frontmost is true'
        );
        return name || 'Unknown';
      },
    },
    {
      name: 'take_screenshot',
      description: 'Take a screenshot and save it to the Desktop.',
      parameters: {
        filename: { type: 'string', description: 'Optional filename without extension. Defaults to "Screenshot YYYY-MM-DD".' },
      },
      async execute({ filename } = {}) {
        const os = require('os');
        const path = require('path');
        const date = new Date().toISOString().slice(0, 10);
        const name = filename ? `${filename}.png` : `Screenshot ${date}.png`;
        const dest = path.join(os.homedir(), 'Desktop', name);
        await execFileAsync('screencapture', ['-x', dest], { timeout: 10000 });
        return `Screenshot saved to Desktop/${name}`;
      },
    },
    {
      name: 'list_running_apps',
      description: 'List all currently running applications.',
      parameters: {},
      async execute() {
        const result = await runScript(
          'tell application "System Events" to get name of every process whose background only is false'
        );
        return result;
      },
    },
  ],
};
