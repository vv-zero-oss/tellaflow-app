/**
 * The one place a validated action becomes a real effect.
 *
 * Ported from canvas's `src/editor/mascot/mascot-dispatch.ts` — the desktop
 * tier (`dispatchOsAction`), its safety tables and `runMascotActions` are
 * verbatim; the board/editor branches are gone with the editor. In canvas this
 * ran in the renderer and reached main over IPC; Tellaflow has no renderer of
 * its own for the assistant (the island is a view), so it runs in main and the
 * `os` capability is os-actions.js directly.
 *
 * The rules that earn their keep here:
 *
 *  1. **Honest results, always returned.** Every action produces a result and
 *     `runMascotActions` returns the whole list even after it stops early. The
 *     controller feeds those into the next turn ("WHAT YOUR LAST REPLY'S
 *     ACTIONS DID") — the anti-confabulation loop.
 *  2. **A chain is cancellable, and cancelled is silent.** Every action is
 *     gated on `ctx.isLive()`, between actions and inside any that awaits.
 *  3. **The desktop tier is gated like what it is.** `os_*` actions inject
 *     real input into OTHER applications, where nothing can be undone. The
 *     order inside `dispatchOsAction` is the safety order: gates (the switch,
 *     then Accessibility, re-read per action), the outright refusals (a
 *     password field, a concealed clipboard, a file outside home), target
 *     resolution, the confirmation, the effect. Quitting an app, a
 *     Delete/Trash/Erase/Shut Down menu path, a destructive chord ANYWHERE in
 *     an `os_press` sequence and anything aimed at a denylisted app are
 *     confirmed even when the user said "run without asking".
 */

const {
  MAX_ACTIONS_PER_TURN,
  MAX_OS_WAIT_MS,
  TERMINAL_ACTIONS,
  MAX_OS_ACTIONS_PER_TURN,
  isOpenableUrl,
  isOsAction,
} = require('./mascot-actions');

// ── The desktop tier: the security boundary, as data ───────────────────────

/**
 * Apps whose windows are never a safe place for a chat reply to click, type or
 * look: credential stores, the shell, and the settings surface that grants the
 * permissions this whole tier runs on. Matched as SUBSTRINGS of the normalised
 * name, so "iterm" covers "iTerm2" and "1password" covers "1Password 8"; the
 * false positives land on the safe side (one extra confirmation).
 */
const OS_DENYLISTED_APPS = [
  'system settings',
  'system preferences',
  'keychain access',
  'terminal',
  'iterm',
  '1password',
  'bitwarden',
  'lastpass',
  'dashlane',
  'keepassxc',
  'passwords',
];

/** Menu-path fragments that always confirm, whatever the app: the document,
 *  the app or the machine is gone afterwards. */
const OS_DESTRUCTIVE_MENU_PHRASES = [
  'quit',
  'delete',
  'move to trash',
  'empty trash',
  'secure empty trash',
  'erase',
  'shut down',
  'restart',
  'log out',
];

/** Key chords that always confirm — ⌘Q, ⌘⌫ and ⌘⇧⌫ do what a Quit/Delete
 *  menu path does, through `os_press`. Compared after `normalizeKeyChord`. */
const OS_DESTRUCTIVE_KEYS = [
  'cmd+q',              // quit the frontmost app
  'cmd+delete',         // move to trash
  'cmd+shift+delete',   // empty trash
  'cmd+opt+esc',        // force quit
  'ctrl+cmd+q',         // lock screen — harmless, but it strands the chain
];

/** The `os_*` actions that inject input, open something or touch the
 *  clipboard, and therefore confirm unless the user runs actions without
 *  asking. `os_see`, `os_point` and `os_wait` only read. */
const OS_ACTIONS_NEEDING_CONFIRMATION = new Set([
  'os_click', 'os_type', 'os_press', 'os_scroll', 'os_menu', 'os_app',
  'os_drag', 'os_open_url', 'os_open_file', 'os_clipboard_read', 'os_clipboard_write',
]);

/**
 * Fold an app name or menu item to the form the lists above are written in:
 * NFKC (fullwidth "ＴＥＲＭＩＮＡＬ" is Terminal), zero-width characters deleted,
 * whitespace collapsed.
 */
function normalizeOsName(raw) {
  return String(raw)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[​-‏⁠﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when `name` is (or contains) a denylisted app. */
function isDenylistedApp(name) {
  if (!name) return false;
  const normalised = normalizeOsName(name);
  if (!normalised) return false;
  return OS_DENYLISTED_APPS.some((entry) => normalised.includes(entry));
}

/** True when a menu path reaches something unrecoverable — matched against
 *  the JOINED path, so `["Empty", "Trash"]` is caught too. */
function isDestructiveMenuPath(path) {
  const joined = normalizeOsName(path.join(' '));
  return OS_DESTRUCTIVE_MENU_PHRASES.some((phrase) => joined.includes(phrase));
}

const KEY_ALIASES = {
  command: 'cmd', '⌘': 'cmd', meta: 'cmd', super: 'cmd',
  option: 'opt', alt: 'opt', '⌥': 'opt',
  control: 'ctrl', '⌃': 'ctrl',
  '⇧': 'shift',
  backspace: 'delete', del: 'delete', '⌫': 'delete',
  escape: 'esc', '⎋': 'esc',
};
const MODIFIERS = new Set(['cmd', 'ctrl', 'opt', 'shift', 'fn']);

/** Canonical form of a chord: aliases resolved, modifiers sorted. */
function normalizeKeyChord(raw) {
  const parts = normalizeOsName(raw)
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => KEY_ALIASES[p] ?? p);
  const mods = parts.filter((p) => MODIFIERS.has(p)).sort();
  const keys = parts.filter((p) => !MODIFIERS.has(p)).sort();
  return [...mods, ...keys].join('+');
}

const DESTRUCTIVE_CHORDS = new Set(OS_DESTRUCTIVE_KEYS.map(normalizeKeyChord));

/**
 * Split an `os_press` `keys` string into the chords peekaboo will press. A
 * copy of `splitKeyChords` in desktop/peekaboo.js, pinned to it by a test —
 * the last time these two disagreed, "esc cmd+q" quit an app unasked.
 */
function splitOsKeyChords(keys) {
  return keys.trim().split(/\s+/).filter(Boolean);
}

/** True when ANY chord in this `os_press` quits, trashes or force-quits. */
function isDestructiveKeySequence(keys) {
  return splitOsKeyChords(keys).some((chord) =>
    normalizeOsName(chord)
      .split(' ')
      .filter(Boolean)
      .some((part) => DESTRUCTIVE_CHORDS.has(normalizeKeyChord(part))),
  );
}

/** Every app an action could reach: the one it names, AND both names the last
 *  look carries (the window looked at and the app in front). */
function osActionApps(action, seen) {
  const named = [];
  if (action.type === 'os_menu') named.push(action.app);
  else if (action.type === 'os_app') named.push(action.name);
  else if (action.type === 'os_see' && action.app) named.push(action.app);
  if (seen?.frontmostApp) named.push(seen.frontmostApp);
  if (seen?.app) named.push(seen.app);
  return named;
}

/** Why this action must be confirmed even when actions run without asking —
 *  or null. A reason, not a boolean, so the transcript records which fired. */
function forcedConfirmReason(action, seen, file) {
  for (const app of osActionApps(action, seen)) {
    if (isDenylistedApp(app)) return `denylisted app: ${normalizeOsName(app)}`;
  }
  if (action.type === 'os_app' && action.action === 'quit') return 'quit';
  if (action.type === 'os_menu' && isDestructiveMenuPath(action.path)) return 'destructive menu path';
  if (action.type === 'os_press' && isDestructiveKeySequence(action.keys)) return 'destructive shortcut';
  // Opening a program RUNS it.
  if (action.type === 'os_open_file' && (!file || file.program)) return 'opens a program';
  return null;
}

/**
 * Is the held map evidence about the screen `os_type`'s keystrokes will reach?
 * Only a FOREGROUND look, or a look at an app that was frontmost while it
 * looked. Anything else is "cannot tell", which refuses.
 */
function mapDescribesTypingTarget(seen) {
  if (seen.foreground === true) return true;
  const looked = normalizeOsName(seen.app ?? '');
  const frontmost = normalizeOsName(seen.frontmostApp ?? '');
  if (!looked || !frontmost) return false;
  return looked.includes(frontmost) || frontmost.includes(looked);
}

/**
 * The secure-field rule, and the one judgement call in this file: a missing
 * element map is a REFUSAL, not a pass — and not confirmable. A confirmation
 * is exactly how a user gets talked into approving a password being typed
 * somewhere by a chat reply.
 */
function secureTypeRefusal(seen, chain) {
  if (!seen || !seen.ok || seen.elements.length === 0) return 'no element map';
  const focused = seen.elements.find((el) => el.focused);
  if (focused?.secure) return 'secure field focused';
  if (!focused && seen.elements.some((el) => el.secure)) return 'secure field on screen';
  if (chain?.screenTouched) return 'screen touched since the look';
  if (!mapDescribesTypingTarget(seen)) return 'map is of another app';
  return null;
}

const SECURE_TYPE_SPOKEN = {
  'no element map': "Let me look at the screen first — I won't type into an app I haven't checked for a password field.",
  'secure field focused': "That's a password field. I won't type into it.",
  'secure field on screen': "There's a password field on screen and I can't tell what's focused, so I won't type.",
  'map is of another app': "I've only looked at another app's window, and typing goes to whatever's in front — let me look at that first.",
  'screen touched since the look': 'The screen has changed since I looked, so let me look again before I type.',
};

/** The bounds `os_point` refers to, or null — an id not in the map, no
 *  bounds, or a 0×0 box all mean "we do not know where this is". */
function osPointBounds(target, seen) {
  if ('elementId' in target) {
    const bounds = seen?.elements.find((el) => el.id === target.elementId)?.bounds;
    if (!bounds) return null;
    const { x, y, width, height } = bounds;
    if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
    if (width < 1 || height < 1) return null;
    return { x, y, width, height };
  }
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
  return { x: target.x, y: target.y, width: 0, height: 0 };
}

/** Does any control in this map carry `text` in its name or value? */
function mapShows(seen, text) {
  const want = normalizeOsName(text);
  if (!want || !seen?.ok) return false;
  return seen.elements.some((el) =>
    [el.label, el.value].some((v) => typeof v === 'string' && normalizeOsName(v).includes(want)),
  );
}

/** How often `os_wait {until}` looks again. */
const OS_WAIT_POLL_MS = 800;
/** The most of the clipboard a note carries into the next prompt. */
const MAX_CLIPBOARD_NOTE_CHARS = 500;

const flat = (text, max) => {
  const one = String(text).replace(/`/g, '').replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// ── Result helpers ─────────────────────────────────────────────────────────

/** A refusal the USER needs to hear: it is shown on the island as well as
 *  recorded, because a silent no-op reads as "it worked". */
function refuse(ctx, note, spoken) {
  ctx.say?.(spoken);
  return { ok: false, note };
}

/** Absent token = always live, so a hand-built chain needs no gate. */
const isLive = (ctx) => ctx.isLive?.() !== false;

/** A superseded action, recorded but never shown. */
const cancelled = () => ({ ok: false, note: 'cancelled' });

// ── The desktop tier: dispatch ─────────────────────────────────────────────

async function offerOsSettings(ctx, note, spoken) {
  ctx.say?.(spoken);
  ctx.offerSettings?.(spoken);
  return { ok: false, note };
}

/**
 * One `os_*` action, from the gates to the effect. The order is the safety
 * order (see the header) and is not interchangeable.
 */
async function dispatchOsAction(action, ctx, chain) {
  const os = ctx.os;

  // Gate 1: the switch, as the presence of the capability.
  if (!os) {
    return offerOsSettings(ctx, 'desktop actions off', 'Acting on the rest of your desktop is switched off.');
  }

  const status = await os.status();
  if (!isLive(ctx)) return cancelled();

  if (!status.supported) {
    // The helper is simply not downloaded yet: that one has a fix, offered
    // once the turn is over (Tellaflow installs it from the island).
    if (/isn.t installed|not found|install it/i.test(status.peekaboo?.error ?? '') && ctx.offerHelper) {
      ctx.offerHelper();
      return refuse(ctx, 'desktop helper not installed', 'I need the desktop helper to work in your apps.');
    }
    // Otherwise terminal, and therefore NOT a Settings offer.
    const why = status.peekaboo?.error ? ` (${status.peekaboo.error})` : '';
    return refuse(ctx, `desktop actions unsupported${why}`, "I can't act on this Mac's desktop — that needs macOS 15 or later with the desktop helper installed.");
  }

  // Gate 2: Accessibility, re-read for EVERY action — revoking it is the
  // user's kill switch for this tier.
  if (!status.accessibility) {
    return offerOsSettings(ctx, 'accessibility not granted', 'I need Accessibility permission before I can act on other apps.');
  }

  const seen = os.lastSeen();

  if (action.type === 'os_type') {
    const blocked = secureTypeRefusal(seen, chain);
    if (blocked) return refuse(ctx, `os_type refused: ${blocked}`, SECURE_TYPE_SPOKEN[blocked]);
  }

  let file = null;
  if (action.type === 'os_open_url' && !isOpenableUrl(action.url)) {
    return refuse(ctx, 'os_open_url refused: not an http(s) address', 'I only open web addresses — http or https.');
  }
  if (action.type === 'os_open_file') {
    const info = os.inspect ? await os.inspect({ kind: 'file', path: action.path }) : null;
    if (!isLive(ctx)) return cancelled();
    if (!info || !info.ok || info.kind !== 'file') {
      return refuse(ctx, 'os_open_file refused: cannot inspect', "I couldn't check that file, so I won't open it.");
    }
    if (!info.insideHome) return refuse(ctx, 'os_open_file refused: outside home', 'I only open files inside your home folder.');
    if (!info.exists) return refuse(ctx, 'not found', "I couldn't find that file.");
    file = info;
  }
  if (action.type === 'os_clipboard_read') {
    const info = os.inspect ? await os.inspect({ kind: 'clipboard' }) : null;
    if (!isLive(ctx)) return cancelled();
    if (!info || !info.ok || info.kind !== 'clipboard') {
      return refuse(ctx, 'os_clipboard_read refused: cannot inspect', "I couldn't check the clipboard, so I won't read it.");
    }
    // A password manager marks what it copies as CONCEALED. Not confirmable.
    if (info.concealed) return refuse(ctx, 'os_clipboard_read refused: concealed', "There's a password on the clipboard. I won't read it.");
    if (!info.hasText) return refuse(ctx, 'os_clipboard_read: empty', 'The clipboard has no text on it.');
  }

  let pointBounds = null;
  if (action.type === 'os_point') {
    pointBounds = osPointBounds(action.target, seen);
    if (!pointBounds) return refuse(ctx, 'not found', "I couldn't find that on screen to point at.");
  }

  const forced = forcedConfirmReason(action, seen, file);
  if (forced !== null || OS_ACTIONS_NEEDING_CONFIRMATION.has(action.type)) {
    const approved = await os.confirm(action, forced !== null ? { forced: true, reason: forced } : undefined);
    // A confirmation answered AFTER Stop must not then reach into another app.
    if (!isLive(ctx)) return cancelled();
    if (!approved) {
      return refuse(ctx, forced !== null ? `declined (${forced})` : 'declined', "Okay — I'll leave that alone.");
    }
  }
  if (!isLive(ctx)) return cancelled();

  switch (action.type) {
    case 'os_see': {
      const result = await os.see(action.app);
      if (!result.ok) return refuse(ctx, `os_see failed: ${result.error ?? 'unknown'}`, "I couldn't get a look at that app.");
      // A successful look is the ONE thing that re-establishes evidence.
      if (chain) chain.screenTouched = false;
      const where = result.app ?? result.frontmostApp ?? 'desktop';
      return { ok: true, note: `${where}: ${result.elements.length} elements` };
    }

    case 'os_point': {
      // NEVER `act`: pointing stays side-effect free.
      await os.point?.(pointBounds);
      return { ok: true };
    }

    case 'os_wait': {
      const budget = Math.min(action.ms ?? MAX_OS_WAIT_MS, MAX_OS_WAIT_MS);
      if (!action.until) {
        await wait(budget);
        return isLive(ctx) ? { ok: true, note: `waited ${budget} ms` } : cancelled();
      }
      const deadline = Date.now() + budget;
      for (;;) {
        const look = await os.see();
        if (!isLive(ctx)) return cancelled();
        if (look.ok && chain) chain.screenTouched = false;
        if (mapShows(look.ok ? look : null, action.until)) {
          return { ok: true, note: `"${flat(action.until, 60)}" is on screen` };
        }
        if (Date.now() + OS_WAIT_POLL_MS > deadline) break;
        await wait(OS_WAIT_POLL_MS);
        if (!isLive(ctx)) return cancelled();
      }
      return refuse(ctx, `os_wait: "${flat(action.until, 60)}" never appeared`, 'What I was waiting for never showed up, so I\'ve stopped there.');
    }

    default: {
      // The element map stops being evidence HERE, before the await and
      // whether or not the act succeeds.
      if (chain) chain.screenTouched = true;
      os.invalidateSeen?.();
      const result = await os.act(action);
      if (!result.ok) {
        const detail = result.errorCode ?? result.error ?? 'unknown';
        if (result.errorCode === 'CONCEALED') {
          return refuse(ctx, `${action.type} refused: concealed`, "There's a password on the clipboard. I won't read it.");
        }
        return refuse(ctx, `${action.type} failed: ${detail}`, "That didn't work, so I've stopped there.");
      }
      if (action.type === 'os_clipboard_read') {
        return { ok: true, note: `clipboard: "${flat(result.text ?? '', MAX_CLIPBOARD_NOTE_CHARS)}"` };
      }
      return { ok: true };
    }
  }
}

// ── Dispatch ───────────────────────────────────────────────────────────────

async function dispatchMascotAction(action, ctx, chain) {
  switch (action.type) {
    case 'ask_user': {
      // Terminal: control is now the user's. The answer rides back in the note.
      const answer = await ctx.askUser({
        question: action.question,
        options: action.options,
        ...(action.allowFreeText ? { allowFreeText: true } : {}),
      });
      return { ok: true, note: answer };
    }

    case 'delegate_to_agent': {
      if (!isLive(ctx)) return cancelled();
      if (!ctx.delegate) return refuse(ctx, 'delegate unavailable', "I can't open a chat for that from here.");
      // A follow-up goes to the chat named only if that chat was in THIS
      // turn's list — an invented or stale id starts a new chat instead.
      const known = action.chat && ctx.agentChats ? ctx.agentChats().some((c) => c.id === action.chat) : false;
      const chat = known ? action.chat : null;
      const handed = await ctx.delegate(action.task, chat);
      if (!handed.ok) return refuse(ctx, `delegate failed: ${handed.error}`, "I couldn't reach the assistant for that.");
      ctx.onDelegated?.(handed.chat, action.task);
      return { ok: true, note: `handed to the assistant in ${handed.created ? 'a new chat' : 'its existing chat'} id=${handed.chat}` };
    }

    case 'task_done':
      // The loop reads it; the dispatcher only records it.
      return { ok: true, note: action.summary };

    case 'end_turn':
      return { ok: true };

    default:
      if (isOsAction(action)) return dispatchOsAction(action, ctx, chain);
      return { ok: false, note: `unknown action ${action.type}` };
  }
}

/**
 * Run one turn's actions in order. Every result is returned even when the run
 * stops early — a truncated list would show the model a turn that looks like
 * it succeeded up to the last entry.
 */
async function runMascotActions(actions, ctx) {
  const results = [];
  let osCount = 0;
  // The secure-field evidence clock, per TURN: one call is one chain.
  const chain = { screenTouched: false };

  for (const action of actions.slice(0, MAX_ACTIONS_PER_TURN)) {
    if (!isLive(ctx)) {
      results.push(cancelled());
      break;
    }
    if (isOsAction(action)) {
      if (osCount >= MAX_OS_ACTIONS_PER_TURN) {
        results.push(refuse(ctx, 'os action budget reached', "That's as many desktop steps as I'll take in one go — tell me to carry on and I will."));
        break;
      }
      osCount++;
    }

    ctx.beforeAction?.(action);
    let result;
    try {
      result = await dispatchMascotAction(action, ctx, chain);
    } catch (err) {
      result = { ok: false, note: `${action.type} failed: ${String(err?.message || err)}` };
      results.push(result);
      break;
    }
    results.push(result);

    if (TERMINAL_ACTIONS.has(action.type)) break;
    // A chain of real input injected into another app never continues past a
    // step that didn't land.
    if (!result.ok && isOsAction(action)) break;
  }

  return results;
}

module.exports = {
  OS_DENYLISTED_APPS,
  OS_DESTRUCTIVE_MENU_PHRASES,
  OS_DESTRUCTIVE_KEYS,
  OS_ACTIONS_NEEDING_CONFIRMATION,
  OS_WAIT_POLL_MS,
  MAX_CLIPBOARD_NOTE_CHARS,
  normalizeOsName,
  isDenylistedApp,
  isDestructiveMenuPath,
  normalizeKeyChord,
  splitOsKeyChords,
  isDestructiveKeySequence,
  forcedConfirmReason,
  secureTypeRefusal,
  osPointBounds,
  mapShows,
  dispatchOsAction,
  dispatchMascotAction,
  runMascotActions,
};
