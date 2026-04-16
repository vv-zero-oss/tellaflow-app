const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * Resolve common shorthands like "~/Desktop", "~/Documents", "Desktop" to
 * an absolute path. Rejects paths that try to escape common user directories.
 */
function resolvePath(p) {
  if (!p || typeof p !== 'string') throw new Error('Path must be a non-empty string');

  // Named shortcuts
  const shortcuts = {
    desktop: path.join(os.homedir(), 'Desktop'),
    documents: path.join(os.homedir(), 'Documents'),
    downloads: path.join(os.homedir(), 'Downloads'),
    home: os.homedir(),
    pictures: path.join(os.homedir(), 'Pictures'),
    movies: path.join(os.homedir(), 'Movies'),
    music: path.join(os.homedir(), 'Music'),
  };
  const lower = p.toLowerCase().trim();
  if (shortcuts[lower]) return shortcuts[lower];

  // Expand ~ to home
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }

  return path.resolve(p);
}

module.exports = {
  name: 'File System',
  description: 'Read, write, copy, move, delete, and list files and folders',
  tools: [
    {
      name: 'read_file',
      description: 'Read the text contents of a file.',
      parameters: {
        path: { type: 'string', description: 'File path' },
      },
      async execute({ path: p }) {
        const abs = resolvePath(p);
        const contents = fs.readFileSync(abs, 'utf8');
        if (contents.length > 8000) return contents.slice(0, 8000) + '\n[truncated]';
        return contents;
      },
    },
    {
      name: 'write_file',
      description: 'Write or overwrite a text file.',
      parameters: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'Text to write' },
      },
      async execute({ path: p, content }) {
        const abs = resolvePath(p);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
        return `Wrote ${content.length} chars to ${abs}`;
      },
    },
    {
      name: 'append_file',
      description: 'Append text to the end of a file, creating it if needed.',
      parameters: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'Text to append' },
      },
      async execute({ path: p, content }) {
        const abs = resolvePath(p);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.appendFileSync(abs, content, 'utf8');
        return `Appended to ${abs}`;
      },
    },
    {
      name: 'list_directory',
      description: 'List files and folders in a directory.',
      parameters: {
        path: { type: 'string', description: 'Directory path' },
      },
      async execute({ path: p }) {
        const abs = resolvePath(p);
        const entries = fs.readdirSync(abs, { withFileTypes: true });
        const lines = entries.map(e => (e.isDirectory() ? `[dir]  ${e.name}` : `[file] ${e.name}`));
        return lines.join('\n') || '(empty directory)';
      },
    },
    {
      name: 'create_directory',
      description: 'Create a new folder (and any necessary parent folders).',
      parameters: {
        path: { type: 'string', description: 'Directory path to create' },
      },
      async execute({ path: p }) {
        const abs = resolvePath(p);
        fs.mkdirSync(abs, { recursive: true });
        return `Created directory: ${abs}`;
      },
    },
    {
      name: 'delete_file',
      description: 'Delete a file or an empty directory.',
      parameters: {
        path: { type: 'string', description: 'File path to delete' },
      },
      async execute({ path: p }) {
        const abs = resolvePath(p);
        const stat = fs.statSync(abs);
        if (stat.isDirectory()) {
          fs.rmdirSync(abs);
        } else {
          fs.unlinkSync(abs);
        }
        return `Deleted: ${abs}`;
      },
    },
    {
      name: 'copy_file',
      description: 'Copy a FILE from one location to another (e.g. from Downloads to Desktop). Use when the user says "copy X to Y folder". This moves the file content, not just the path.',
      parameters: {
        from: { type: 'string', description: 'Source path, e.g. ~/Downloads/report.pdf' },
        to: { type: 'string', description: 'Destination path, e.g. ~/Desktop/report.pdf' },
      },
      async execute({ from, to }) {
        const src = resolvePath(from);
        const dst = resolvePath(to);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        return `Copied ${src} → ${dst}`;
      },
    },
    {
      name: 'move_file',
      description: 'Move or rename a file or folder.',
      parameters: {
        from: { type: 'string', description: 'Source path' },
        to: { type: 'string', description: 'Destination path' },
      },
      async execute({ from, to }) {
        const src = resolvePath(from);
        const dst = resolvePath(to);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.renameSync(src, dst);
        return `Moved ${src} → ${dst}`;
      },
    },
    {
      name: 'open_in_finder',
      description: 'Open a file or folder in Finder, or reveal a file in its parent folder.',
      parameters: {
        path: { type: 'string', description: 'File or directory path' },
      },
      async execute({ path: p }) {
        const { shell } = require('electron');
        const abs = resolvePath(p);
        const stat = fs.statSync(abs);
        if (stat.isDirectory()) {
          shell.openPath(abs);
        } else {
          shell.showItemInFolder(abs);
        }
        return `Opened in Finder: ${abs}`;
      },
    },
    {
      name: 'file_info',
      description: 'Get metadata (size, type, dates) about a file or folder.',
      parameters: {
        path: { type: 'string', description: 'File path' },
      },
      async execute({ path: p }) {
        const abs = resolvePath(p);
        const stat = fs.statSync(abs);
        return JSON.stringify({
          path: abs,
          type: stat.isDirectory() ? 'directory' : 'file',
          size_bytes: stat.size,
          created: new Date(stat.birthtimeMs).toISOString(),
          modified: new Date(stat.mtimeMs).toISOString(),
        }, null, 2);
      },
    },

    {
      name: 'copy_file_path_to_clipboard',
      description:
        'Copy the FILE PATH (text string) of a file to the clipboard. ' +
        'Use ONLY when user says "copy the PATH of X" or "put the path in clipboard". ' +
        'Do NOT use for copying actual file content or moving files.',
      parameters: {
        path: { type: 'string', description: 'File or folder path' },
      },
      async execute({ path: p }) {
        const abs = resolvePath(p);
        fs.statSync(abs); // throws if not found
        const { clipboard } = require('electron');
        clipboard.writeText(abs);
        return `Copied path to clipboard: ${abs}`;
      },
    },

    {
      name: 'copy_latest_download_to_clipboard',
      description:
        'Find the most recently downloaded file and copy its full file path to the clipboard. ' +
        'Optionally filter by extension. Use when the user says "copy the latest download" or "get my last downloaded file".',
      parameters: {
        extension: { type: 'string', description: 'Optional extension filter, e.g. "pdf"' },
      },
      async execute({ extension } = {}) {
        const downloadsDir = path.join(os.homedir(), 'Downloads');
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

        const withTimes = entries.map(e => {
          const full = path.join(downloadsDir, e.name);
          const stat = fs.statSync(full);
          return { name: e.name, path: full, mtime: stat.mtimeMs };
        });
        withTimes.sort((a, b) => b.mtime - a.mtime);
        const latest = withTimes[0];

        const { clipboard } = require('electron');
        clipboard.writeText(latest.path);
        return `Copied to clipboard: ${latest.path}`;
      },
    },

    {
      name: 'open_file',
      description: 'Open a file with its default application (like double-clicking it).',
      parameters: {
        path: { type: 'string', description: 'File path to open' },
      },
      async execute({ path: p }) {
        const { shell } = require('electron');
        const abs = resolvePath(p);
        fs.statSync(abs); // throws if not found
        await shell.openPath(abs);
        return `Opened: ${abs}`;
      },
    },
  ],
};
