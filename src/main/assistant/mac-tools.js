/**
 * Built-in Mac tools the assistant can call.
 *
 * Safety:
 *   - Every piece of model/user text reaches AppleScript as an argv item
 *     (`item n of argv`) — never spliced into script source.
 *   - App names for Music/Spotify control come from a fixed allow-list.
 *   - There is no shell tool. `open` / `say` are invoked with execFile argv.
 *   - run_applescript is the escape hatch for anything else. With Full access
 *     (the default) it runs like any other tool; otherwise the user approves
 *     it after seeing the script.
 *   - look_at_screen returns `{ text, image }`: the agent attaches the image to
 *     the AI's next turn (for AIs that can see images).
 *
 * OS access is injected (`deps`) so tools are unit-testable on any platform.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const mac = require('../mac-automation');

function execFileP(cmd, args, { timeout = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || '').toString().trim()));
      else resolve(stdout.toString().trim());
    });
  });
}

const defaultDeps = {
  applescript: (body, argv, opts) => mac.runAppleScript(body, argv, opts),
  rawAppleScript: (src, opts) => mac.runRawAppleScript(src, opts),
  exec: execFileP,
  exists: (p) => fs.existsSync(p),
  home: () => os.homedir(),
  now: () => new Date(),
};

function str(v, name, { max = 2000, required = true } = {}) {
  if (v == null || v === '') {
    if (required) throw new Error(`Missing "${name}".`);
    return '';
  }
  const s = String(v);
  if (s.length > max) throw new Error(`"${name}" is too long (max ${max} chars).`);
  return s;
}

function appName(v) {
  const s = str(v, 'name', { max: 100 });
  if (/[\n\r\0]/.test(s)) throw new Error('Invalid app name.');
  return s;
}

/** ISO / "YYYY-MM-DD HH:MM" → local date parts for AppleScript. */
function dateParts(v, name) {
  const d = new Date(str(v, name, { max: 40 }));
  if (isNaN(d.getTime())) throw new Error(`"${name}" must be an ISO date like 2026-10-15T14:30.`);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
}

// Builds an AppleScript date from 5 numeric argv items starting at index i.
const AS_DATE = (i, v = 'd') => `set ${v} to current date
set day of ${v} to 1
set year of ${v} to (item ${i} of argv as integer)
set month of ${v} to (item ${i + 1} of argv as integer)
set day of ${v} to (item ${i + 2} of argv as integer)
set hours of ${v} to (item ${i + 3} of argv as integer)
set minutes of ${v} to (item ${i + 4} of argv as integer)
set seconds of ${v} to 0`;

const MEDIA_APPS = { music: 'Music', spotify: 'Spotify' };
const MEDIA_COMMANDS = { play: 'play', pause: 'pause', playpause: 'playpause', next: 'next track', previous: 'previous track' };

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function createMacTools(overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };
  const as = deps.applescript;

  const tools = [
    {
      name: 'get_date_time',
      description: 'Current local date, time and time zone.',
      args: {},
      readOnly: true,
      run: async () => {
        const d = deps.now();
        return `${d.toString()} (ISO ${d.toISOString()})`;
      },
    },
    {
      name: 'look_at_screen',
      description: 'Take a screenshot of the screen and look at it. Use whenever you need to see what the user sees ("this", "here", a page, a button, an error).',
      args: {},
      readOnly: true,
      run: async () => {
        const file = path.join(os.tmpdir(), `tellaflow-screen-${process.pid}-${Date.now()}.jpg`);
        if (deps.captureScreen) {
          // The app captures it itself (Electron desktopCapturer).
          await deps.captureScreen(file);
        } else {
          // -x: no shutter sound. Shrink so it fits the AI's image limits.
          await deps.exec('screencapture', ['-x', '-t', 'jpg', file], { timeout: 10_000 });
          try { await deps.exec('sips', ['-Z', '1600', file], { timeout: 10_000 }); } catch {}
        }
        return { text: 'Screenshot taken. It is attached to this message as an image.', image: file };
      },
    },
    {
      name: 'get_frontmost_app',
      description: 'Name of the app currently in front.',
      args: {},
      readOnly: true,
      run: () => as('tell application "System Events" to return name of first application process whose frontmost is true', []),
    },
    {
      name: 'list_running_apps',
      description: 'Names of running apps with a UI.',
      args: {},
      readOnly: true,
      run: () => as(
        'tell application "System Events" to set n to name of every application process whose background only is false\n' +
        "set AppleScript's text item delimiters to \", \"\nreturn n as text",
        [],
      ),
    },
    {
      name: 'open_app',
      description: 'Open (or bring to front) an app by name, e.g. "Safari", "Slack".',
      args: { name: 'string, app name' },
      run: async ({ name }) => { await deps.exec('open', ['-a', appName(name)]); return `Opened ${name}.`; },
    },
    {
      name: 'quit_app',
      description: 'Quit an app by name.',
      args: { name: 'string, app name' },
      run: async ({ name }) => {
        await as('tell application (item 1 of argv) to quit', [appName(name)]);
        return `Asked ${name} to quit.`;
      },
    },
    {
      name: 'open_url',
      description: 'Open an http(s) or mailto link in the default app.',
      args: { url: 'string, http(s):// or mailto: URL' },
      validate: ({ url }) => {
        const u = str(url, 'url', { max: 4000 });
        if (!/^(https?:\/\/|mailto:)/i.test(u)) throw new Error('Only http(s):// and mailto: links can be opened.');
      },
      run: async ({ url }) => { await deps.exec('open', [String(url)]); return `Opened ${url}.`; },
    },
    {
      name: 'open_folder',
      description: 'Reveal a folder or file in Finder. Paths may start with ~.',
      args: { path: 'string, e.g. "~/Downloads"' },
      run: async ({ path: p }) => {
        let full = str(p, 'path', { max: 1000 });
        if (full.startsWith('~')) full = path.join(deps.home(), full.slice(1));
        full = path.resolve(full);
        if (!deps.exists(full)) throw new Error(`No such file or folder: ${full}`);
        await deps.exec('open', ['-R', full]);
        return `Showing ${full} in Finder.`;
      },
    },
    {
      name: 'get_volume',
      description: 'Current output volume (0-100) and mute state.',
      args: {},
      readOnly: true,
      run: () => as('set v to get volume settings\nreturn "volume " & (output volume of v) & ", muted " & (output muted of v)', []),
    },
    {
      name: 'set_volume',
      description: 'Set output volume 0-100 (0 mutes).',
      args: { level: 'number 0-100' },
      validate: ({ level }) => {
        const n = Number(level);
        if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('level must be 0-100.');
      },
      run: async ({ level }) => {
        const n = Math.round(Number(level));
        await as('set volume output volume (item 1 of argv as integer)\nif (item 1 of argv as integer) is 0 then set volume with output muted\nif (item 1 of argv as integer) > 0 then set volume without output muted', [n]);
        return `Volume set to ${n}.`;
      },
    },
    {
      name: 'media_control',
      description: 'Control Music or Spotify playback.',
      args: { app: '"Music" or "Spotify"', command: 'play | pause | playpause | next | previous' },
      validate: ({ app, command }) => {
        if (!MEDIA_APPS[String(app || '').toLowerCase()]) throw new Error('app must be "Music" or "Spotify".');
        if (!MEDIA_COMMANDS[String(command || '').toLowerCase()]) throw new Error('command must be play, pause, playpause, next or previous.');
      },
      run: async ({ app, command }) => {
        const a = MEDIA_APPS[String(app).toLowerCase()];
        const c = MEDIA_COMMANDS[String(command).toLowerCase()];
        // Both values come from fixed allow-lists above, never from the model.
        await as(`tell application "${a}" to ${c}`, []);
        return `${a}: ${command}.`;
      },
    },
    {
      name: 'now_playing',
      description: 'Track currently playing in Music or Spotify.',
      args: { app: '"Music" or "Spotify"' },
      readOnly: true,
      validate: ({ app }) => {
        if (!MEDIA_APPS[String(app || '').toLowerCase()]) throw new Error('app must be "Music" or "Spotify".');
      },
      run: ({ app }) => {
        const a = MEDIA_APPS[String(app).toLowerCase()];
        return as(
          `if application "${a}" is not running then return "${a} is not running"\n` +
          `tell application "${a}"\nif player state is stopped then return "Nothing playing"\nreturn (name of current track) & " — " & (artist of current track)\nend tell`,
          [],
        );
      },
    },
    {
      name: 'get_dark_mode',
      description: 'Whether macOS dark mode is on.',
      args: {},
      readOnly: true,
      run: () => as('tell application "System Events" to tell appearance preferences to return dark mode', []),
    },
    {
      name: 'set_dark_mode',
      description: 'Turn macOS dark mode on or off.',
      args: { enabled: 'boolean' },
      run: async ({ enabled }) => {
        const on = enabled === true || enabled === 'true';
        await as('tell application "System Events" to tell appearance preferences to set dark mode to ((item 1 of argv) is "true")', [String(on)]);
        return `Dark mode ${on ? 'on' : 'off'}.`;
      },
    },
    {
      name: 'create_reminder',
      description: 'Add a reminder to the Reminders app (default list).',
      args: { title: 'string', notes: 'string, optional', due: 'ISO date-time, optional' },
      run: async ({ title, notes, due }) => {
        const t = str(title, 'title', { max: 300 });
        const n = str(notes, 'notes', { required: false });
        if (due) {
          const parts = dateParts(due, 'due');
          await as(`${AS_DATE(3)}\ntell application "Reminders" to make new reminder with properties {name:(item 1 of argv), body:(item 2 of argv), due date:d}`, [t, n, ...parts]);
        } else {
          await as('tell application "Reminders" to make new reminder with properties {name:(item 1 of argv), body:(item 2 of argv)}', [t, n]);
        }
        return `Reminder "${t}" created${due ? ` for ${due}` : ''}.`;
      },
    },
    {
      name: 'create_note',
      description: 'Create a note in the Notes app.',
      args: { title: 'string', body: 'string' },
      run: async ({ title, body }) => {
        const t = str(title, 'title', { max: 300 });
        const b = str(body, 'body', { required: false, max: 20000 });
        const html = `<h1>${escapeHtml(t)}</h1><div>${escapeHtml(b)}</div>`;
        await as('tell application "Notes" to make new note with properties {name:(item 1 of argv), body:(item 2 of argv)}', [t, html]);
        return `Note "${t}" created.`;
      },
    },
    {
      name: 'create_calendar_event',
      description: 'Add an event to Calendar.',
      args: { title: 'string', start: 'ISO date-time', durationMinutes: 'number, default 30', calendar: 'string, optional calendar name' },
      run: async ({ title, start, durationMinutes = 30, calendar }) => {
        const t = str(title, 'title', { max: 300 });
        const parts = dateParts(start, 'start');
        const mins = Math.max(1, Math.min(24 * 60, Math.round(Number(durationMinutes) || 30)));
        const cal = str(calendar, 'calendar', { required: false, max: 200 });
        await as(
          `${AS_DATE(4)}\nset e to d + ((item 2 of argv as integer) * minutes)\n` +
          'tell application "Calendar"\n' +
          '  if (item 3 of argv) is "" then\n    set c to first calendar whose writable is true\n  else\n    set c to first calendar whose name is (item 3 of argv)\n  end if\n' +
          '  tell c to make new event with properties {summary:(item 1 of argv), start date:d, end date:e}\n' +
          'end tell',
          [t, mins, cal, ...parts],
          { timeout: 15_000 },
        );
        return `Event "${t}" added at ${start} for ${mins} min.`;
      },
    },
    {
      name: 'show_notification',
      description: 'Show a macOS notification.',
      args: { title: 'string', message: 'string' },
      run: async ({ title, message }) => {
        await as('display notification (item 2 of argv) with title (item 1 of argv)', [str(title, 'title', { max: 200 }), str(message, 'message', { max: 1000 })]);
        return 'Notification shown.';
      },
    },
    {
      name: 'get_clipboard',
      description: 'Read the clipboard as text.',
      args: {},
      readOnly: true,
      run: () => as('try\nreturn (the clipboard as text)\non error\nreturn ""\nend try', []),
    },
    {
      name: 'set_clipboard',
      description: 'Put text on the clipboard.',
      args: { text: 'string' },
      run: async ({ text }) => { await as('set the clipboard to (item 1 of argv)', [str(text, 'text', { max: 100_000 })]); return 'Copied to clipboard.'; },
    },
    {
      name: 'say',
      description: 'Speak text aloud with the system voice.',
      args: { text: 'string' },
      run: async ({ text }) => { await deps.exec('say', [str(text, 'text', { max: 2000 })], { timeout: 60_000 }); return 'Spoken.'; },
    },
    {
      name: 'run_applescript',
      description: 'Run a custom AppleScript for anything the other tools cannot do (clicking, typing, menus, any app).',
      args: { script: 'string, AppleScript source' },
      preview: ({ script }) => String(script || ''),
      run: async ({ script }) => {
        const out = await deps.rawAppleScript(str(script, 'script', { max: 20_000 }), { timeout: 30_000 });
        return out || 'done';
      },
    },
  ];
  return tools;
}

module.exports = { createMacTools, dateParts };
