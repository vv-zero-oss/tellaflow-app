/**
 * The assistant's action vocabulary — the ONLY things the brain may ask for.
 *
 * Ported from canvas's `src/editor/mascot/mascot-actions.ts` (Jarvis). Tellaflow
 * has no editor, so the board/editor/shell actions (point_at, select, command,
 * tabs, guide, move_to …) are not here; what remains is canvas's desktop tier
 * (`os_*`) and the actions that hand control away (`ask_user`,
 * `delegate_to_agent`, `task_done`, `end_turn`). Everything that is here is
 * verbatim, rules and comments included.
 *
 * The allowlist is the real security boundary: the prompt merely describes it,
 * `validateMascotAction` enforces it, and ACTION_SCHEMA_HINT is GENERATED from
 * the same table (`ACTION_SPECS`) so the prompt can never advertise a type the
 * validator drops — the failure that produces an assistant which confidently
 * says "done" and then silently does nothing.
 */

/** Caps. A turn that emits more than this is truncated, not rejected — a
 *  slightly over-eager reply should still do its first few useful things. */
const MAX_ACTIONS_PER_TURN = 6;
/** OS actions are separately (and more tightly) capped — each one is real input
 *  injected into another app, so a runaway chain is worse than a no-op. */
const MAX_OS_ACTIONS_PER_TURN = 8;

/** The only schemes `os_open_url` opens. Anything else — `file:`, `javascript:`,
 *  a custom app scheme that launches something — is not "a web page". */
const OS_URL_PROTOCOLS = ['http:', 'https:'];
const MAX_OS_URL_CHARS = 2048;
const MAX_OS_PATH_CHARS = 1024;
/** `os_clipboard_write`'s cap: a clipboard is for a snippet, and every
 *  character is shown in full in a confirmation. */
const MAX_OS_CLIPBOARD_CHARS = 10_000;
/** `os_wait` bounds. A wait longer than this is a stuck task, not patience. */
const MIN_OS_WAIT_MS = 100;
const MAX_OS_WAIT_MS = 10_000;
const MAX_OS_WAIT_UNTIL_CHARS = 120;
const MAX_TASK_SUMMARY_CHARS = 200;

/**
 * Actions after which the turn must STOP, because everything the brain queued
 * behind them was written without knowing what came back: `ask_user` hands
 * control to the user, `delegate_to_agent` to a visible bb chat, `end_turn`
 * says so outright, and `task_done` ends a computer-use task.
 *
 * Read by `validateMascotActions` (truncates a model's list) AND by
 * `runMascotActions` (stops a chain mid-flight).
 */
const TERMINAL_ACTIONS = new Set(['ask_user', 'delegate_to_agent', 'end_turn', 'task_done']);

/** True for the desktop tier, which the dispatcher gates on the Accessibility
 *  grant. One greppable name for the tier boundary. */
function isOsAction(a) {
  return typeof a?.type === 'string' && a.type.startsWith('os_');
}

const asString = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

// eslint-disable-next-line no-control-regex -- matching control characters IS the rule
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function parseOsTarget(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const elementId = asString(raw.elementId);
  if (elementId) return { elementId };
  const { x, y } = raw;
  if (Number.isFinite(x) && Number.isFinite(y)) return { x: Number(x), y: Number(y) };
  return null;
}

/** A web address `os_open_url` may open: parseable, http(s), no credentials
 *  (`https://user:pass@host` is a phishing shape, and nothing a reply needs). */
function isOpenableUrl(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_OS_URL_CHARS || CONTROL.test(raw)) return false;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (!OS_URL_PROTOCOLS.includes(url.protocol)) return false;
  return !url.username && !url.password && !!url.hostname;
}

/**
 * Turn one untrusted object from the model's JSON into an action, or null.
 * Null is always "drop this action", never "throw" — a single bad entry in an
 * otherwise good list must not cost the user the whole turn.
 */
function validateMascotAction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = asString(raw.type);
  if (!type || !Object.prototype.hasOwnProperty.call(ACTION_SPECS, type)) return null;

  switch (type) {
    case 'end_turn': return { type: 'end_turn' };
    case 'ask_user': {
      const question = asString(raw.question);
      if (!question) return null;
      const options = (Array.isArray(raw.options) ? raw.options : [])
        .map((o) => asString(typeof o === 'object' && o ? o.label : o))
        .filter((o) => !!o)
        .slice(0, 4);
      // An UNANSWERABLE question must not be constructible: with no options
      // the island offers a reply on the Assistant page instead.
      const allowFreeText = raw.allowFreeText === true || options.length === 0;
      return { type: 'ask_user', question, options, ...(allowFreeText ? { allowFreeText: true } : {}) };
    }
    case 'delegate_to_agent': {
      const task = asString(raw.task);
      if (!task) return null;
      // "new" (or nothing) is a chat of its own; anything else names one of the
      // ASSISTANT CHATS listed in the turn. The dispatcher re-checks the id
      // against that list — an invented id falls back to a new chat.
      const chatRaw = asString(raw.chat);
      const chat = chatRaw && chatRaw.toLowerCase() !== 'new' ? chatRaw.slice(0, 128) : '';
      return { type: 'delegate_to_agent', task, ...(chat ? { chat } : {}) };
    }

    // ── Desktop tier ──
    case 'os_see': {
      const app = asString(raw.app);
      return app ? { type: 'os_see', app } : { type: 'os_see' };
    }
    case 'os_point': {
      const target = parseOsTarget(raw.target);
      return target ? { type: 'os_point', target } : null;
    }
    case 'os_click': {
      const target = parseOsTarget(raw.target);
      if (!target) return null;
      const button = raw.button === 'right' ? 'right' : undefined;
      const double = raw.double === true ? true : undefined;
      return { type: 'os_click', target, ...(button ? { button } : {}), ...(double ? { double } : {}) };
    }
    case 'os_type': {
      // Typing a lone space is a legitimate instruction, so only a non-string
      // or empty string is rejected.
      const text = typeof raw.text === 'string' ? raw.text : null;
      return text && text.length > 0 ? { type: 'os_type', text } : null;
    }
    case 'os_press': {
      const keys = asString(raw.keys);
      if (!keys) return null;
      // `keys` becomes SEVERAL argv tokens (main splits on whitespace), so a
      // chord starting with "-" would be read as a flag — `"cmd+q --app
      // Terminal"` aims the key at an app the denylist never saw. Dropped here
      // and refused again by `argvForAction` in os-actions.js.
      if (keys.split(/\s+/).some((chord) => chord.startsWith('-'))) return null;
      return { type: 'os_press', keys };
    }
    case 'os_scroll': {
      const dir = asString(raw.direction);
      if (!dir || !['up', 'down', 'left', 'right'].includes(dir)) return null;
      const amount = Number.isFinite(raw.amount) ? Math.min(Math.max(Math.round(Number(raw.amount)), 1), 30) : undefined;
      const target = parseOsTarget(raw.target) ?? undefined;
      return { type: 'os_scroll', direction: dir, ...(amount !== undefined ? { amount } : {}), ...(target ? { target } : {}) };
    }
    case 'os_menu': {
      const app = asString(raw.app);
      const path = (Array.isArray(raw.path) ? raw.path : []).map(asString).filter((p) => !!p);
      return app && path.length ? { type: 'os_menu', app, path } : null;
    }
    case 'os_app': {
      const name = asString(raw.name);
      const action = asString(raw.action);
      // `app launch` passes the name POSITIONALLY, so a leading dash is a flag.
      if (name?.startsWith('-')) return null;
      return name && action && ['launch', 'focus', 'quit'].includes(action) ? { type: 'os_app', name, action } : null;
    }
    case 'os_drag': {
      const from = parseOsTarget(raw.from);
      const to = parseOsTarget(raw.to);
      return from && to ? { type: 'os_drag', from, to } : null;
    }
    case 'os_open_url': {
      const url = asString(raw.url);
      return url && isOpenableUrl(url) ? { type: 'os_open_url', url } : null;
    }
    case 'os_open_file': {
      // WHERE it resolves (inside home, a program or not) is main's to measure
      // and the dispatcher's to rule on — a string cannot answer either.
      const path = asString(raw.path);
      if (!path || path.length > MAX_OS_PATH_CHARS || CONTROL.test(path)) return null;
      return path.startsWith('/') || path.startsWith('~/') ? { type: 'os_open_file', path } : null;
    }
    case 'os_clipboard_read': return { type: 'os_clipboard_read' };
    case 'os_clipboard_write': {
      // Not trimmed: what is copied is exactly what was approved.
      const text = typeof raw.text === 'string' ? raw.text : '';
      return text.length > 0 && text.length <= MAX_OS_CLIPBOARD_CHARS ? { type: 'os_clipboard_write', text } : null;
    }
    case 'os_wait': {
      const until = asString(raw.until);
      const ms = Number.isFinite(raw.ms) ? Math.min(Math.max(Math.round(Number(raw.ms)), MIN_OS_WAIT_MS), MAX_OS_WAIT_MS) : undefined;
      if (until) {
        if (until.length > MAX_OS_WAIT_UNTIL_CHARS || CONTROL.test(until)) return null;
        return { type: 'os_wait', until, ...(ms !== undefined ? { ms } : {}) };
      }
      return ms !== undefined ? { type: 'os_wait', ms } : null;
    }
    case 'task_done': {
      const summary = asString(raw.summary);
      return summary ? { type: 'task_done', summary: summary.slice(0, MAX_TASK_SUMMARY_CHARS) } : null;
    }
    default:
      return null;
  }
}

/** Validate a whole list, applying the per-turn caps and the terminal rule. */
function validateMascotActions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  let osCount = 0;
  for (const entry of raw) {
    if (out.length >= MAX_ACTIONS_PER_TURN) break;
    const action = validateMascotAction(entry);
    if (!action) continue;
    if (isOsAction(action)) {
      if (osCount >= MAX_OS_ACTIONS_PER_TURN) continue;
      osCount++;
    }
    out.push(action);
    if (TERMINAL_ACTIONS.has(action.type)) break;
  }
  return out;
}

/**
 * Every action type, with the line the prompt shows for it and one example the
 * validator must accept. THE list of types (see the header).
 */
const ACTION_SPECS = {
  ask_user: {
    hint: '{"type":"ask_user","question":"…","options":["…"]}  — ask ONE question; at most 4 short options; stops the turn',
    sample: { type: 'ask_user', question: 'Which one?', options: ['A'] },
  },
  delegate_to_agent: {
    hint: [
      '{"type":"delegate_to_agent","task":"…","chat":"new"|"<chat id>"}  — hand a bigger job (research, writing a long document, code, anything with many steps that is not on the screen) to a visible chat on the Assistant page, where the user can watch and talk to it; stops the turn.',
      '    "chat": the id of one of the ASSISTANT CHATS listed below when this continues that work; "new" when it is a different job. It runs at once: never ask permission, just say what you handed over.',
    ].join('\n'),
    sample: { type: 'delegate_to_agent', task: 'Write the report' },
  },
  os_see: {
    hint: '{"type":"os_see","app":"Safari"}  — look at an app\'s controls (an element map with ids); no app = whatever is in front',
    sample: { type: 'os_see' },
  },
  os_point: {
    hint: '{"type":"os_point","target":{"elementId":"…"}|{"x":0,"y":0}}  — point at a control; never clicks',
    sample: { type: 'os_point', target: { elementId: 'e1' } },
  },
  os_click: {
    hint: '{"type":"os_click","target":{…},"button":"right","double":true}  — button defaults to left, double to false',
    sample: { type: 'os_click', target: { elementId: 'e1' } },
  },
  os_drag: {
    hint: '{"type":"os_drag","from":{…},"to":{…}}  — press at one control or point, move to another, release',
    sample: { type: 'os_drag', from: { x: 1, y: 1 }, to: { x: 2, y: 2 } },
  },
  os_type: { hint: '{"type":"os_type","text":"…"}  — typed into whatever has the keyboard', sample: { type: 'os_type', text: 'hi' } },
  os_press: { hint: '{"type":"os_press","keys":"cmd+s"}', sample: { type: 'os_press', keys: 'cmd+s' } },
  os_scroll: {
    hint: '{"type":"os_scroll","direction":"up"|"down"|"left"|"right","amount":3,"target":{…}}  — amount 1–30',
    sample: { type: 'os_scroll', direction: 'down' },
  },
  os_menu: {
    hint: '{"type":"os_menu","app":"TextEdit","path":["File","Save"]}',
    sample: { type: 'os_menu', app: 'TextEdit', path: ['File', 'Save'] },
  },
  os_app: {
    hint: '{"type":"os_app","name":"Safari","action":"launch"|"focus"|"quit"}',
    sample: { type: 'os_app', name: 'Safari', action: 'launch' },
  },
  os_open_url: {
    hint: `{"type":"os_open_url","url":"https://…"}  — open a web address in the default browser (${OS_URL_PROTOCOLS.map((p) => p.slice(0, -1)).join('/')} only)`,
    sample: { type: 'os_open_url', url: 'https://example.com' },
  },
  os_open_file: {
    hint: '{"type":"os_open_file","path":"~/Documents/notes.txt"}  — open a file inside the user\'s home folder with its default app; a program always asks first',
    sample: { type: 'os_open_file', path: '~/notes.txt' },
  },
  os_clipboard_read: {
    hint: '{"type":"os_clipboard_read"}  — read the clipboard\'s text (the next message shows it); a copied password is never read',
    sample: { type: 'os_clipboard_read' },
  },
  os_clipboard_write: {
    hint: `{"type":"os_clipboard_write","text":"…"}  — put text on the clipboard (up to ${MAX_OS_CLIPBOARD_CHARS} characters)`,
    sample: { type: 'os_clipboard_write', text: 'hi' },
  },
  os_wait: {
    hint: `{"type":"os_wait","ms":1000} or {"type":"os_wait","until":"Save"}  — pause ${MIN_OS_WAIT_MS}–${MAX_OS_WAIT_MS} ms, or until a control whose name or value contains that text is on screen`,
    sample: { type: 'os_wait', ms: 500 },
  },
  task_done: {
    hint: '{"type":"task_done","summary":"…"}  — a desktop task you were working through step by step is finished; one short sentence for the user; stops the turn',
    sample: { type: 'task_done', summary: 'Typed the note in TextEdit.' },
  },
  end_turn: { hint: '{"type":"end_turn"}  — nothing more to do', sample: { type: 'end_turn' } },
};

/** The action reference pasted into the brain prompt, built FROM the same
 *  table the validator checks against. */
const ACTION_SCHEMA_HINT = [
  'Each action is one JSON object with a `type`. A desktop target is {"elementId":"<id from DESKTOP ELEMENTS>"} or {"x":0,"y":0} (screen points). Available types:',
  ...Object.values(ACTION_SPECS).map((spec) => `- ${spec.hint}`),
  '',
  `At most ${MAX_ACTIONS_PER_TURN} actions per reply (${MAX_OS_ACTIONS_PER_TURN} of them os_*). Anything after ${[...TERMINAL_ACTIONS].join(', ')} is`,
  'ignored — each hands control away (to the user, a chat, or ends the task), so stop there.',
].join('\n');

module.exports = {
  MAX_ACTIONS_PER_TURN,
  MAX_OS_ACTIONS_PER_TURN,
  OS_URL_PROTOCOLS,
  MAX_OS_CLIPBOARD_CHARS,
  MIN_OS_WAIT_MS,
  MAX_OS_WAIT_MS,
  TERMINAL_ACTIONS,
  ACTION_SPECS,
  ACTION_SCHEMA_HINT,
  isOsAction,
  isOpenableUrl,
  validateMascotAction,
  validateMascotActions,
};
