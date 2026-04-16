const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const path = require('path');

const execAsync = promisify(exec);

const SAFE_TIMEOUT = 15000; // 15 s max per command
const MAX_OUTPUT   = 6000;  // truncate large output

/**
 * Run a shell command and return stdout + stderr trimmed.
 * Rejects on non-zero exit unless `allowFailure` is true.
 */
async function run(cmd, { cwd, allowFailure = false } = {}) {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: SAFE_TIMEOUT,
      cwd: cwd || os.homedir(),
      env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' + (process.env.PATH ? ':' + process.env.PATH : '') },
    });
    const out = (stdout + (stderr ? '\n[stderr] ' + stderr : '')).trim();
    return out.length > MAX_OUTPUT ? out.slice(0, MAX_OUTPUT) + '\n[output truncated]' : out;
  } catch (err) {
    if (allowFailure) return `[exit ${err.code}] ${err.stderr || err.message}`.trim();
    throw new Error(err.stderr?.trim() || err.message);
  }
}

module.exports = {
  name: 'Shell',
  description: 'Run terminal commands, scripts, and shell operations',
  tools: [
    {
      name: 'run_command',
      description:
        'Execute a shell command and return its output. Use for file operations, git, searching, compiling, etc. ' +
        'Prefer specific tools over this when available. Commands run from the home directory.',
      parameters: {
        command: { type: 'string', description: 'The shell command to run, e.g. "ls ~/Downloads"' },
        cwd: { type: 'string', description: 'Optional working directory. Defaults to home (~).' },
      },
      async execute({ command, cwd }) {
        return await run(command, { cwd, allowFailure: true });
      },
    },

    {
      name: 'get_latest_download',
      description:
        'Find the most recently downloaded file in ~/Downloads. ' +
        'Returns the full file path. Optionally filter by extension (e.g. "pdf", "zip").',
      parameters: {
        extension: { type: 'string', description: 'Optional file extension filter without dot, e.g. "pdf"' },
      },
      async execute({ extension } = {}) {
        const downloadsDir = path.join(os.homedir(), 'Downloads');
        const fs = require('fs');
        let entries = fs.readdirSync(downloadsDir, { withFileTypes: true })
          .filter(e => e.isFile() && !e.name.startsWith('.'));

        if (extension) {
          const ext = extension.toLowerCase().replace(/^\./, '');
          entries = entries.filter(e => e.name.toLowerCase().endsWith('.' + ext));
        }

        if (entries.length === 0) {
          return extension
            ? `No ${extension} files found in Downloads.`
            : 'Downloads folder is empty.';
        }

        // Sort by modification time descending
        const withTimes = entries.map(e => {
          const full = path.join(downloadsDir, e.name);
          const stat = fs.statSync(full);
          return { name: e.name, path: full, mtime: stat.mtimeMs };
        });
        withTimes.sort((a, b) => b.mtime - a.mtime);

        const latest = withTimes[0];
        return latest.path;
      },
    },

    {
      name: 'list_downloads',
      description: 'List the most recent files in ~/Downloads (newest first).',
      parameters: {
        limit: { type: 'string', description: 'Max number of files to return. Default 10.' },
      },
      async execute({ limit } = {}) {
        const downloadsDir = path.join(os.homedir(), 'Downloads');
        const fs = require('fs');
        const entries = fs.readdirSync(downloadsDir, { withFileTypes: true })
          .filter(e => e.isFile() && !e.name.startsWith('.'));

        const withTimes = entries.map(e => {
          const full = path.join(downloadsDir, e.name);
          const stat = fs.statSync(full);
          return { name: e.name, mtime: stat.mtimeMs, size: stat.size };
        });
        withTimes.sort((a, b) => b.mtime - a.mtime);

        const n = Math.min(parseInt(limit) || 10, withTimes.length);
        const lines = withTimes.slice(0, n).map(f => {
          const date = new Date(f.mtime).toLocaleDateString();
          const kb = (f.size / 1024).toFixed(1);
          return `${f.name}  (${kb} KB, ${date})`;
        });
        return lines.join('\n') || '(empty)';
      },
    },

    {
      name: 'open_terminal',
      description: 'Open a new Terminal window, optionally running a command inside it.',
      parameters: {
        command: { type: 'string', description: 'Optional shell command to run in the new Terminal window.' },
      },
      async execute({ command } = {}) {
        const { execFile } = require('child_process');
        const { promisify: prom } = require('util');
        const execFileAsync = prom(execFile);

        if (command) {
          const safe = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          await execFileAsync('osascript', [
            '-e', 'tell application "Terminal" to activate',
            '-e', `tell application "Terminal" to do script "${safe}"`,
          ]);
        } else {
          await execFileAsync('osascript', [
            '-e', 'tell application "Terminal" to activate',
            '-e', 'tell application "Terminal" to do script ""',
          ]);
        }
        return command ? `Opened Terminal with: ${command}` : 'Opened Terminal';
      },
    },

    {
      name: 'find_files',
      description: 'Search for files by name pattern in a directory.',
      parameters: {
        pattern: { type: 'string', description: 'Filename pattern to search for, e.g. "*.pdf" or "report"' },
        directory: { type: 'string', description: 'Directory to search in. Defaults to home directory.' },
      },
      async execute({ pattern, directory } = {}) {
        const dir = directory || os.homedir();
        const safe = pattern.replace(/'/g, "\\'");
        const safeDir = dir.replace(/'/g, "\\'");
        const output = await run(`find '${safeDir}' -name '${safe}' -not -path '*/.*' -maxdepth 6 2>/dev/null | head -30`, { allowFailure: true });
        return output || 'No files found.';
      },
    },
  ],
};
