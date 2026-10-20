/**
 * Instant commands: the command key's simple requests, done without the AI.
 *
 * "Take a screenshot", "open Spotify", "pause the music", "volume up" — each of
 * these is one system call, and sending it through the brain cost a model turn
 * (or three, as a desktop task: look, act, check) for something the user
 * expects to happen as they let go of the key. So the request is matched here
 * first, against WHOLE-utterance patterns: anything with a clause more ("open
 * Notes and start a list", "play something relaxing") is not matched and goes
 * to the AI as before. A command whose system call fails (an app name `open`
 * does not know) also goes to the AI, which can look for it.
 *
 * Nothing here can do what the desktop tier would ask about first: no quitting,
 * no deleting, no denylisted app (mascot-dispatch's OS_DENYLISTED_APPS) — those
 * fall through to the AI, which asks.
 *
 * Electron-free; every runner is injected so the whole of it runs in Vitest.
 */

const path = require('path');
const { OS_DENYLISTED_APPS } = require('./mascot-dispatch');

/** What the user can say, for Settings and the docs. One line per command. */
const QUICK_COMMANDS = [
  { id: 'screenshot', say: 'Take a screenshot', does: 'Saves the whole screen to your Desktop' },
  { id: 'screenshot-area', say: 'Screenshot an area', does: 'Lets you drag the part of the screen to save' },
  { id: 'open-app', say: 'Open Safari', does: 'Opens or switches to any app by name' },
  { id: 'open-folder', say: 'Open Downloads', does: 'Downloads, Desktop, Documents, Applications, home' },
  { id: 'open-url', say: 'Go to github.com', does: 'Opens a web address' },
  { id: 'web-search', say: 'Google best pizza near me', does: 'Searches Google (or “search YouTube for …”)' },
  { id: 'media', say: 'Pause the music', does: 'Play, pause, next and previous track' },
  { id: 'volume', say: 'Volume up', does: 'Up, down, mute, unmute, “set volume to 30”' },
  { id: 'lock', say: 'Lock my screen', does: 'Locks the Mac' },
  { id: 'display-sleep', say: 'Turn off the display', does: 'Puts the display to sleep' },
  { id: 'time', say: 'What time is it?', does: 'Also “what’s the date?”' },
];

/** Words people wrap a command in. Stripped before matching, never after. */
const LEAD = /^(?:(?:hey|ok|okay|so|um|uh|please|jarvis|tellaflow|assistant)[,!.]?\s+)+/;
const ASK = /^(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+(?:want|need)\s+(?:you\s+)?to\s+|i'?d\s+like\s+(?:you\s+)?to\s+|go\s+ahead\s+and\s+|just\s+)/;
const TAIL = /(?:\s+(?:please|for\s+me|now|right\s+now|thanks|thank\s+you))+$/;

/** The utterance as matched: lower case, wrapping words and punctuation gone. */
function normalize(text) {
  let t = String(text || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  t = t.replace(/[.!?,;:]+$/g, '').trim();
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t.replace(LEAD, '').replace(ASK, '').replace(TAIL, '').replace(/[.!?,;:]+$/g, '').trim();
    if (t === before) break;
  }
  return t;
}

const FOLDERS = {
  downloads: 'Downloads',
  'download folder': 'Downloads',
  desktop: 'Desktop',
  documents: 'Documents',
  'my documents': 'Documents',
  applications: '/Applications',
  apps: '/Applications',
  home: '',
  'home folder': '',
  pictures: 'Pictures',
  movies: 'Movies',
  music: null, // "open music" is the Music app, not ~/Music
};

/** Words that make "open X" something other than an app's name. */
const NOT_AN_APP = /^(?:a|an|the|new|my|this|that|it|its|these|those|some|any|file|files|folder|document|doc|tab|tabs|window|link|url|email|mail message|message|last|recent|previous|next)\b/;
const CLAUSE = /\b(?:and|then|with|in|on|to|from|for|about|that|which|where|so|but|if|when|after|before)\b/;
const DOMAIN = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|app|ai|co|edu|gov|me|tv|so|xyz|info|us|uk|in|de|fr|jp|ca|au)(?:\.[a-z]{2})?)(\/\S*)?$/;

function isDenylisted(name) {
  const n = name.toLowerCase().replace(/\s+/g, ' ').trim();
  return OS_DENYLISTED_APPS.some((entry) => n.includes(entry));
}

/** "visual studio code" → "Visual Studio Code"; what the island says back. */
function titleCase(s) {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** A spoken domain: "github dot com" → "github.com". */
function spokenDomain(s) {
  return s.replace(/\s+dot\s+/g, '.').replace(/\s+/g, '');
}

/**
 * Match one utterance. Returns `{ id, ...args }` or null (the AI's request).
 * Pure: no clock, no I/O — `time`/`date` are answered by the runner.
 */
function matchQuickCommand(text) {
  const t = normalize(text);
  if (!t || t.length > 80) return null;
  let m;

  // ── Screenshots ──
  if (/^(?:(?:take|grab|capture|make|get|do)\s+(?:me\s+)?(?:a\s+)?)?(?:screenshot|screen\s?shot|screen\s+capture|screen\s+grab)(?:\s+of\s+(?:the|my)\s+(?:whole\s+|entire\s+|full\s+)?screen)?$/.test(t)
    || /^(?:capture|screenshot)\s+(?:the|my)\s+(?:whole\s+|entire\s+)?screen$/.test(t)) {
    return { id: 'screenshot' };
  }
  if (/^(?:(?:take|grab|capture|make)\s+(?:a\s+)?)?(?:screenshot|screen\s?shot)\s+(?:of\s+)?(?:an?|the|part\s+of\s+the)?\s*(?:area|region|selection|part|portion)(?:\s+of\s+the\s+screen)?$/.test(t)
    || /^(?:capture|screenshot)\s+(?:an?\s+)?(?:area|region|selection)$/.test(t)) {
    return { id: 'screenshot-area' };
  }
  if (/^(?:(?:take|grab|capture)\s+(?:a\s+)?)?(?:screenshot|screen\s?shot)\s+(?:of\s+)?(?:a|the|this)\s+window$/.test(t)) {
    return { id: 'screenshot-window' };
  }

  // ── Media ──
  if (/^(?:pause|stop)(?:\s+(?:the|my))?\s+(?:music|song|track|playback|spotify|apple music|audio|podcast|video)$/.test(t) || t === 'pause' || t === 'pause it') {
    return { id: 'media', command: 'pause' };
  }
  // A bare "continue" is too often said to the assistant itself; it needs a noun.
  if (/^(?:play|resume|unpause)(?:\s+(?:the|my))?(?:\s+(?:music|song|playback|spotify|apple music|podcast))?$/.test(t)
    || /^continue(?:\s+(?:the|my))?\s+(?:music|song|playback|podcast)$/.test(t)) {
    return { id: 'media', command: 'play' };
  }
  if (/^(?:(?:play\s+(?:the\s+)?)?next|skip)(?:\s+(?:this|the))?(?:\s+(?:song|track))?$/.test(t) || t === 'next') {
    return { id: 'media', command: 'next' };
  }
  if (/^(?:(?:play\s+(?:the\s+)?)?previous|go\s+back(?:\s+a)?|last)\s+(?:song|track)$/.test(t) || t === 'previous') {
    return { id: 'media', command: 'previous' };
  }

  // ── Volume ──
  if (/^(?:mute|silence)(?:\s+(?:the|my))?(?:\s+(?:sound|volume|audio|mac|computer|it|everything))?$/.test(t)) return { id: 'volume', command: 'mute' };
  if (/^unmute(?:\s+(?:the|my))?(?:\s+(?:sound|volume|audio|mac|computer|it))?$/.test(t)) return { id: 'volume', command: 'unmute' };
  if ((m = /^(?:set|change|put|turn)(?:\s+the)?\s+volume\s+(?:to|at)\s+(\d{1,3})(?:\s*(?:percent|%))?$/.exec(t)) || (m = /^volume\s+(?:to\s+)?(\d{1,3})(?:\s*(?:percent|%))?$/.exec(t))) {
    return { id: 'volume', command: 'set', level: Math.max(0, Math.min(100, Number(m[1]))) };
  }
  if (/^(?:(?:turn|crank|bring|put)\s+(?:the\s+)?volume\s+up|volume\s+up|turn\s+(?:it|the\s+(?:sound|music))\s+up|louder|make\s+it\s+louder|increase\s+(?:the\s+)?volume)$/.test(t)) return { id: 'volume', command: 'up' };
  if (/^(?:(?:turn|bring|put)\s+(?:the\s+)?volume\s+down|volume\s+down|turn\s+(?:it|the\s+(?:sound|music))\s+down|quieter|softer|make\s+it\s+quieter|lower\s+(?:the\s+)?volume|decrease\s+(?:the\s+)?volume)$/.test(t)) return { id: 'volume', command: 'down' };

  // ── Lock / display ──
  if (/^lock(?:\s+(?:my|the))?\s+(?:screen|computer|mac|laptop)$/.test(t) || t === 'lock it') return { id: 'lock' };
  if (/^(?:turn\s+off|sleep)(?:\s+(?:the|my))?\s+(?:screen|display|displays|monitor)$/.test(t) || /^put\s+(?:the\s+)?(?:display|screen)\s+to\s+sleep$/.test(t)) return { id: 'display-sleep' };

  // ── Time / date ──
  if (/^(?:what(?:'s|\s+is)\s+the\s+time|what\s+time\s+is\s+it|(?:tell\s+me\s+)?the\s+time)(?:\s+(?:now|right\s+now))?$/.test(t)) return { id: 'time' };
  if (/^(?:what(?:'s|\s+is)\s+(?:the\s+date|today's\s+date|the\s+day)(?:\s+today)?|what\s+day\s+is\s+(?:it|today)(?:\s+today)?|what's\s+today)$/.test(t)) return { id: 'date' };

  // ── Web ──
  if ((m = /^(?:google|search\s+google\s+for|search\s+the\s+web\s+for|google\s+search(?:\s+for)?)\s+(.+)$/.exec(t))) {
    return { id: 'web-search', engine: 'google', query: m[1] };
  }
  if ((m = /^(?:search\s+youtube\s+for|youtube\s+search(?:\s+for)?|look\s+up\s+on\s+youtube)\s+(.+)$/.exec(t))) {
    return { id: 'web-search', engine: 'youtube', query: m[1] };
  }

  // ── Open: a folder, a web address, an app ──
  if ((m = /^(?:open|launch|start|switch\s+to|go\s+to|bring\s+up|show(?:\s+me)?)\s+(.+?)$/.exec(t))) {
    const verb = t.slice(0, t.length - m[1].length).trim();
    let what = m[1].replace(/^(?:the|my)\s+/, '').trim();
    // Folders first: "open downloads", "open my documents folder".
    const folderKey = what.replace(/\s+(?:folder|directory)$/, '');
    if (Object.prototype.hasOwnProperty.call(FOLDERS, folderKey) && FOLDERS[folderKey] !== null && (verb === 'open' || verb === 'show' || verb === 'show me' || verb === 'go to')) {
      return { id: 'open-folder', folder: FOLDERS[folderKey], label: folderKey === 'home folder' ? 'home' : folderKey };
    }
    const dom = DOMAIN.exec(spokenDomain(what));
    if (dom) return { id: 'open-url', url: `https://${dom[1]}${dom[2] || ''}` };
    if (verb === 'go to' || verb === 'show' || verb === 'show me') return null;
    what = what.replace(/\s+(?:app|application)$/, '').trim();
    const words = what.split(' ');
    if (!what || words.length > 4 || NOT_AN_APP.test(what) || CLAUSE.test(what) || /[^a-z0-9 .&+'-]/.test(what)) return null;
    if (isDenylisted(what)) return null;
    return { id: 'open-app', app: titleCase(what) };
  }
  return null;
}

/** "Screenshot 2026-10-20 at 14.03.09.png" — the name macOS gives its own. */
function screenshotName(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `Screenshot ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.png`;
}

/** Media keys (NX_KEYTYPE_*): the player-agnostic fallback, for audio playing
 *  in a browser. Posting a system-defined event needs Accessibility, which
 *  paste already relies on. */
const MEDIA_KEY = { play: 16, pause: 16, next: 17, previous: 18 };
const MEDIA_KEY_JXA = `ObjC.import('Cocoa');
function run(argv) {
  var code = Number(argv[0]);
  [true, false].forEach(function (down) {
    var ev = $.NSEvent.otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2(
      14, $.NSMakePoint(0, 0), down ? 0xa00 : 0xb00, 0, 0, $(), 8, (code << 16) | ((down ? 0xa : 0xb) << 8), -1);
    $.CGEventPost(0, ev.CGEvent);
  });
}`;
const PLAYER_VERB = { play: 'play', pause: 'pause', next: 'next track', previous: 'previous track' };
const MEDIA_SAID = { play: 'Playing', pause: 'Paused', next: 'Skipped to the next track', previous: 'Back to the previous track' };

/**
 * @param {object} deps
 * @param {(file: string, args: string[]) => Promise<unknown>} deps.exec       run a program (execFile)
 * @param {(body: string, argv?: string[]) => Promise<string>} deps.appleScript run an AppleScript body inside
 *        `on run argv … end run` (mac-automation's runAppleScript): values reach it as argv, never as source
 * @param {(source: string, argv?: string[]) => Promise<string>} [deps.jxa]     run JavaScript for Automation
 * @param {() => Promise<string[]>} [deps.runningApps]                          names of running apps
 * @param {string} deps.homeDir
 * @param {string} [deps.platform]
 * @param {() => Date} [deps.now]
 */
function createQuickCommands(deps) {
  const platform = deps.platform ?? process.platform;
  const now = deps.now ?? (() => new Date());
  const mac = platform === 'darwin';

  /** Commands that need nothing of the OS run anywhere; the rest on a Mac. */
  const PORTABLE = new Set(['time', 'date']);

  function match(text) {
    const m = matchQuickCommand(text);
    if (!m) return null;
    if (!mac && !PORTABLE.has(m.id)) return null;
    return m;
  }

  async function media(command) {
    const running = new Set((await (deps.runningApps?.() ?? Promise.resolve([])).catch(() => [])).map((n) => String(n)));
    const players = ['Spotify', 'Music'].filter((p) => running.has(p));
    if (players.length) {
      // A pause goes to every player (whichever is playing stops); the rest
      // to the first, Spotify before Music.
      const targets = command === 'pause' ? players : players.slice(0, 1);
      for (const p of targets) await deps.appleScript(`tell application "${p}" to ${PLAYER_VERB[command]}`);
      return `${MEDIA_SAID[command]}${command === 'pause' || command === 'play' ? ` ${targets.join(' and ')}` : ''}.`;
    }
    if (!deps.jxa) throw new Error('no player is running');
    await deps.jxa(MEDIA_KEY_JXA, [String(MEDIA_KEY[command])]);
    return command === 'pause' || command === 'play' ? 'Pressed play/pause.' : `${MEDIA_SAID[command]}.`;
  }

  async function volume(m) {
    switch (m.command) {
      case 'mute': await deps.appleScript('set volume output muted true'); return 'Muted.';
      case 'unmute': await deps.appleScript('set volume output muted false'); return 'Unmuted.';
      case 'set': await deps.appleScript('set volume output volume (item 1 of argv as integer) without output muted', [String(m.level)]); return `Volume set to ${m.level}%.`;
      default: {
        const out = await deps.appleScript(`set v to output volume of (get volume settings)\nset v to v ${m.command === 'up' ? '+' : '-'} 12\nif v > 100 then set v to 100\nif v < 0 then set v to 0\nset volume output volume v without output muted\nreturn v`);
        const level = Number.parseInt(String(out ?? '').trim(), 10);
        return Number.isFinite(level) ? `Volume ${m.command} — ${level}%.` : `Volume ${m.command}.`;
      }
    }
  }

  /**
   * Run a matched command. Resolves `{ ok: true, text }` with what the island
   * says, or `{ ok: false, error }` — the caller then hands the request to the
   * AI, so a failure here is never the user's last word.
   */
  async function run(m) {
    try {
      switch (m.id) {
        case 'time':
          return { ok: true, text: `It's ${now().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.` };
        case 'date':
          return { ok: true, text: `It's ${now().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.` };
        case 'screenshot': {
          const file = path.join(deps.homeDir, 'Desktop', screenshotName(now()));
          await deps.exec('screencapture', ['-x', file]);
          return { ok: true, text: 'Screenshot saved to your Desktop.', file };
        }
        case 'screenshot-area':
        case 'screenshot-window': {
          const file = path.join(deps.homeDir, 'Desktop', screenshotName(now()));
          await deps.exec('screencapture', [m.id === 'screenshot-area' ? '-i' : '-iW', file]);
          return { ok: true, text: 'Screenshot saved to your Desktop.', file };
        }
        case 'open-app':
          await deps.exec('open', ['-a', m.app]);
          return { ok: true, text: `Opened ${m.app}.` };
        case 'open-folder': {
          const target = m.folder.startsWith('/') ? m.folder : path.join(deps.homeDir, m.folder);
          await deps.exec('open', [target]);
          return { ok: true, text: `Opened ${m.label === 'home' ? 'your home folder' : titleCase(m.label)}.` };
        }
        case 'open-url':
          await deps.exec('open', [m.url]);
          return { ok: true, text: `Opened ${m.url.replace(/^https:\/\//, '')}.` };
        case 'web-search': {
          const q = encodeURIComponent(m.query);
          const url = m.engine === 'youtube' ? `https://www.youtube.com/results?search_query=${q}` : `https://www.google.com/search?q=${q}`;
          await deps.exec('open', [url]);
          return { ok: true, text: `Searching ${m.engine === 'youtube' ? 'YouTube' : 'Google'} for “${m.query}”.` };
        }
        case 'media':
          return { ok: true, text: await media(m.command) };
        case 'volume':
          return { ok: true, text: await volume(m) };
        case 'lock':
          await deps.appleScript('tell application "System Events" to keystroke "q" using {control down, command down}');
          return { ok: true, text: 'Locked.' };
        case 'display-sleep':
          await deps.exec('pmset', ['displaysleepnow']);
          return { ok: true, text: 'Display off.' };
        default:
          return { ok: false, error: `unknown command ${m.id}` };
      }
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  return { match, run };
}

/** Commands that put something on screen the island must not cover. */
const HIDES_ISLAND = new Set(['screenshot', 'screenshot-area', 'screenshot-window']);

module.exports = { QUICK_COMMANDS, HIDES_ISLAND, normalize, matchQuickCommand, createQuickCommands, screenshotName };
