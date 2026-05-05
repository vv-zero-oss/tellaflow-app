/**
 * Action executors for voice assistant tool calls.
 * Uses osascript for macOS automation + CUA server for desktop control.
 */
const { exec, execSync } = require('child_process');
const { shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

const HOME = process.env.HOME || '/Users/' + process.env.USER;

function execAS(script) {
  return new Promise((resolve, reject) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 10000 }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout.trim());
    });
  });
}

function sh(cmd, timeout = 10000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, env: { ...process.env, HOME } }, (err, stdout, stderr) => {
      resolve(stdout?.trim() || stderr?.trim() || (err ? err.message : 'done'));
    });
  });
}

const ACTIONS = {
  // ─── App Control ────────────────────────────────────────────────────────────
  open_app: {
    execute: async ({ name }) => {
      await execAS(`tell application "${name}" to activate`);
      return `Opened ${name}`;
    },
  },
  close_app: {
    execute: async ({ name }) => {
      await execAS(`tell application "${name}" to quit`);
      return `Closed ${name}`;
    },
  },
  get_active_app: {
    execute: async () => {
      return await execAS('tell application "System Events" to get name of first process whose frontmost is true');
    },
  },
  list_apps: {
    execute: async () => {
      return await execAS('tell application "System Events" to get name of every process whose background only is false');
    },
  },

  // ─── System Control ─────────────────────────────────────────────────────────
  toggle_dark_mode: {
    execute: async () => {
      await execAS('tell application "System Events" to tell appearance preferences to set dark mode to not dark mode');
      const isDark = await execAS('tell application "System Events" to get dark mode of appearance preferences');
      return `Dark mode is now ${isDark === 'true' ? 'ON' : 'OFF'}`;
    },
  },
  set_volume: {
    execute: async ({ level }) => {
      const vol = Math.max(0, Math.min(100, Math.round(level)));
      await execAS(`set volume output volume ${vol}`);
      return `Volume set to ${vol}%`;
    },
  },
  get_volume: {
    execute: async () => {
      const vol = await execAS('output volume of (get volume settings)');
      return `Volume is at ${vol}%`;
    },
  },
  set_brightness: {
    execute: async ({ level }) => {
      await sh(`brightness ${Math.max(0, Math.min(1, level))}`);
      return `Brightness set to ${Math.round(level * 100)}%`;
    },
  },
  get_time: {
    execute: async () => {
      return new Date().toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    },
  },
  get_battery: {
    execute: async () => {
      return await sh('pmset -g batt | grep -Eo "\\d+%.*"');
    },
  },
  get_wifi: {
    execute: async () => {
      return await sh('/System/Library/PrivateFrameworks/Apple80211.framework/Resources/airport -I | grep " SSID"');
    },
  },
  lock_screen: {
    execute: async () => {
      await sh('pmset displaysleepnow');
      return 'Screen locked';
    },
  },
  empty_trash: {
    execute: async () => {
      await execAS('tell application "Finder" to empty the trash');
      return 'Trash emptied';
    },
  },
  sleep_mac: {
    execute: async () => {
      await sh('pmset sleepnow');
      return 'Mac going to sleep';
    },
  },

  // ─── File System ────────────────────────────────────────────────────────────
  list_files: {
    execute: async ({ folder, count }) => {
      const dir = (folder || '~/Downloads').replace('~', HOME);
      const n = count || 10;
      const result = await sh(`ls -lt "${dir}" | head -${n + 1}`);
      return result || `No files found in ${folder || '~/Downloads'}`;
    },
  },
  file_search: {
    execute: async ({ query, folder }) => {
      const scope = folder ? `-onlyin "${folder.replace('~', HOME)}"` : `-onlyin "${HOME}"`;
      const result = await sh(`mdfind ${scope} "${query}" | head -10`);
      return result || 'No files found';
    },
  },
  read_file: {
    execute: async ({ path: filePath }) => {
      const resolved = filePath.replace('~', HOME);
      try {
        const content = fs.readFileSync(resolved, 'utf-8');
        return content.slice(0, 2000) + (content.length > 2000 ? '\n...(truncated)' : '');
      } catch (e) {
        return `Cannot read: ${e.message}`;
      }
    },
  },
  get_folder_size: {
    execute: async ({ folder }) => {
      const dir = (folder || '~').replace('~', HOME);
      return await sh(`du -sh "${dir}" 2>/dev/null | cut -f1`);
    },
  },
  create_folder: {
    execute: async ({ path: folderPath }) => {
      const resolved = folderPath.replace('~', HOME);
      fs.mkdirSync(resolved, { recursive: true });
      return `Created folder: ${folderPath}`;
    },
  },
  move_file: {
    execute: async ({ from, to }) => {
      await sh(`mv "${from.replace('~', HOME)}" "${to.replace('~', HOME)}"`);
      return `Moved ${from} to ${to}`;
    },
  },
  copy_file: {
    execute: async ({ from, to }) => {
      await sh(`cp -r "${from.replace('~', HOME)}" "${to.replace('~', HOME)}"`);
      return `Copied ${from} to ${to}`;
    },
  },
  open_file: {
    execute: async ({ path: filePath }) => {
      await sh(`open "${filePath.replace('~', HOME)}"`);
      return `Opened ${filePath}`;
    },
  },

  // ─── Web & URLs ─────────────────────────────────────────────────────────────
  open_url: {
    execute: async ({ url }) => {
      await shell.openExternal(url);
      return `Opened ${url}`;
    },
  },
  search_web: {
    execute: async ({ query }) => {
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      await shell.openExternal(url);
      return `Searching: ${query}`;
    },
  },

  // ─── Clipboard ──────────────────────────────────────────────────────────────
  get_clipboard: {
    execute: async () => {
      return clipboard.readText() || '(empty clipboard)';
    },
  },
  set_clipboard: {
    execute: async ({ text }) => {
      clipboard.writeText(text);
      return `Copied to clipboard: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`;
    },
  },

  // ─── Text Input ─────────────────────────────────────────────────────────────
  type_text: {
    execute: async ({ text }) => {
      const paste = require('../paste');
      await paste.pasteText(text);
      return `Typed: "${text.slice(0, 50)}"`;
    },
  },
  press_keys: {
    execute: async ({ keys }) => {
      // keys like "cmd+c", "cmd+shift+4"
      const parts = keys.toLowerCase().split('+');
      const key = parts.pop();
      const mods = parts.map(m => ({ cmd: 'command', ctrl: 'control', alt: 'option', shift: 'shift' }[m] || m));
      const using = mods.length ? ` using {${mods.map(m => m + ' down').join(', ')}}` : '';
      await execAS(`tell application "System Events" to keystroke "${key}"${using}`);
      return `Pressed: ${keys}`;
    },
  },

  // ─── Apple Apps ─────────────────────────────────────────────────────────────
  create_reminder: {
    execute: async ({ title, notes }) => {
      const body = notes ? `, body:"${notes}"` : '';
      await execAS(`tell application "Reminders" to make new reminder with properties {name:"${title}"${body}}`);
      return `Reminder created: "${title}"`;
    },
  },
  create_note: {
    execute: async ({ title, body }) => {
      await execAS(`tell application "Notes" to make new note at folder "Notes" with properties {name:"${title}", body:"${body || ''}"}`);
      return `Note created: "${title}"`;
    },
  },
  create_calendar_event: {
    execute: async ({ title, date, time }) => {
      // Simplified — creates an all-day event for today
      await execAS(`tell application "Calendar" to tell calendar "Home" to make new event with properties {summary:"${title}", start date:current date}`);
      return `Calendar event created: "${title}"`;
    },
  },
  send_message: {
    execute: async ({ to, text }) => {
      await execAS(`tell application "Messages" to send "${text}" to buddy "${to}"`);
      return `Message sent to ${to}`;
    },
  },

  // ─── Music ──────────────────────────────────────────────────────────────────
  play_music: {
    execute: async () => { await execAS('tell application "Music" to play'); return 'Playing music'; },
  },
  pause_music: {
    execute: async () => { await execAS('tell application "Music" to pause'); return 'Music paused'; },
  },
  next_track: {
    execute: async () => { await execAS('tell application "Music" to next track'); return 'Skipped to next track'; },
  },
  get_current_track: {
    execute: async () => {
      const name = await execAS('tell application "Music" to get name of current track');
      const artist = await execAS('tell application "Music" to get artist of current track');
      return `Now playing: ${name} by ${artist}`;
    },
  },

  // ─── Screenshots (via CUA or native) ────────────────────────────────────────
  screenshot: {
    execute: async () => {
      const { app } = require('electron');
      const dir = path.join(app.getPath('userData'), 'screenshots');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, `screenshot-${Date.now()}.png`);
      await sh(`screencapture -x "${dest}"`);
      return `Screenshot saved to ${dest}`;
    },
  },

  // ─── Notifications & Timers ─────────────────────────────────────────────────
  set_timer: {
    execute: async ({ seconds, label }) => {
      const ms = (seconds || 60) * 1000;
      const title = label || `${seconds}s timer`;
      setTimeout(() => {
        const { Notification } = require('electron');
        new Notification({ title: 'Timer Complete', body: title }).show();
      }, ms);
      return `Timer set: "${title}" (${seconds}s)`;
    },
  },
  show_notification: {
    execute: async ({ title, body }) => {
      const { Notification } = require('electron');
      new Notification({ title: title || 'Assistant', body: body || '' }).show();
      return `Notification shown: "${title}"`;
    },
  },

  // ─── Shell Commands ─────────────────────────────────────────────────────────
  run_command: {
    execute: async ({ command }) => {
      const BLOCKED = ['rm -rf /', 'sudo rm', 'mkfs', 'dd if=', '> /dev', 'shutdown -h', 'reboot'];
      if (BLOCKED.some(b => command.includes(b))) return 'Blocked: dangerous command';
      return await sh(command);
    },
  },

  // ─── macOS Shortcuts ────────────────────────────────────────────────────────
  run_shortcut: {
    execute: async ({ name }) => {
      return await sh(`shortcuts run "${name}"`, 15000);
    },
  },
  list_shortcuts: {
    execute: async () => {
      return await sh('shortcuts list | head -20');
    },
  },

  // ─── System Info ────────────────────────────────────────────────────────────
  get_system_info: {
    execute: async () => {
      const [hostname, os, mem, cpu] = await Promise.all([
        sh('hostname'), sh('sw_vers -productVersion'),
        sh('sysctl -n hw.memsize | awk \'{print $1/1073741824 " GB"}\''),
        sh('sysctl -n machdep.cpu.brand_string'),
      ]);
      return `${hostname} | macOS ${os} | ${mem.trim()} RAM | ${cpu}`;
    },
  },
  get_disk_space: {
    execute: async () => {
      return await sh('df -h / | tail -1 | awk \'{print "Used: " $3 " / " $2 " (" $5 " full)"}\'');
    },
  },
  get_ip_address: {
    execute: async () => {
      const local = await sh('ipconfig getifaddr en0 2>/dev/null || echo "not connected"');
      return `Local IP: ${local}`;
    },
  },
  list_processes: {
    execute: async ({ sort_by }) => {
      const sort = sort_by === 'memory' ? '-m' : '-r';
      return await sh(`ps aux --sort=${sort === '-m' ? '-%mem' : '-%cpu'} | head -6`);
    },
  },
  kill_process: {
    execute: async ({ name }) => {
      await sh(`pkill -f "${name}"`);
      return `Killed process: ${name}`;
    },
  },
};

async function executeAction(name, params) {
  const action = ACTIONS[name];
  if (!action) return `Unknown action: ${name}`;
  try {
    return await action.execute(params);
  } catch (err) {
    return `Action failed: ${err.message}`;
  }
}

function getActionNames() { return Object.keys(ACTIONS); }

module.exports = { ACTIONS, executeAction, getActionNames };
