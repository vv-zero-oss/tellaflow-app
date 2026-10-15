/**
 * The computer-use loop's pure parts, ported verbatim from canvas's
 * `src/editor/mascot/mascot-host.tsx` (Jarvis): step captions, the evidence
 * signature a step is verified on, the confirmation sentence, and the element
 * map as the prompt shows it.
 *
 * A desktop task is a LOOP: see → plan → act (one turn) → re-see → check → the
 * next step. Every step is verified by a FRESH look, never by what the model
 * said: the held map is dropped before every act, a new one is taken after,
 * and a step whose acting actions left the screen exactly as it was goes into
 * the transcript as a failure the next turn sees. Two in a row end the task.
 */

/** How long an `os_see` element map counts as evidence. A stale map reads as
 *  NO map, and the dispatcher's refusal then asks the model to look first. */
const OS_SEEN_TTL_MS = 60_000;

/** How many rows of the element map reach the prompt. */
const MAX_PROMPT_OS_ELEMENTS = 60;

/** The desktop actions that CHANGE something — the ones a step is verified on. */
const ACTING_OS = new Set([
  'os_click', 'os_type', 'os_press', 'os_scroll', 'os_menu', 'os_app', 'os_drag',
  'os_open_url', 'os_open_file', 'os_clipboard_write',
]);

/** Text other apps chose, made safe for a prompt or a caption. */
function osText(value, max) {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/`/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function urlHost(url) {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/** The step a desktop action is, as a caption: "Opening TextEdit…". */
function stepCaption(action) {
  const q = (t, n = 40) => `“${osText(t, n)}”`;
  switch (action.type) {
    case 'os_see': return action.app ? `Looking at ${osText(action.app, 40)}…` : 'Looking at the screen…';
    case 'os_point': return 'Pointing…';
    case 'os_click': return action.double ? 'Double-clicking…' : action.button === 'right' ? 'Right-clicking…' : 'Clicking…';
    case 'os_drag': return 'Dragging…';
    case 'os_type': return `Typing ${q(action.text, 32)}…`;
    case 'os_press': return `Pressing ${osText(action.keys, 30)}…`;
    case 'os_scroll': return `Scrolling ${action.direction}…`;
    case 'os_menu': return `Choosing ${action.path.map((p) => osText(p, 24)).join(' ▸ ')}…`;
    case 'os_app':
      return action.action === 'launch' ? `Opening ${osText(action.name, 40)}…`
        : action.action === 'quit' ? `Quitting ${osText(action.name, 40)}…`
          : `Switching to ${osText(action.name, 40)}…`;
    case 'os_open_url': return `Opening ${osText(urlHost(action.url), 60)}…`;
    case 'os_open_file': return `Opening ${osText(action.path.split('/').pop() ?? action.path, 50)}…`;
    case 'os_clipboard_read': return 'Reading the clipboard…';
    case 'os_clipboard_write': return 'Copying to the clipboard…';
    case 'os_wait': return action.until ? `Waiting for ${q(action.until, 30)}…` : 'Waiting…';
    case 'delegate_to_agent': return 'Handing it to a chat…';
    default: return '';
  }
}

/** A step's EVIDENCE signature: the app in front and each control's role,
 *  name, value and focus — what an action could change. */
function screenSignature(seen) {
  if (!seen?.ok) return null;
  const rows = seen.elements.map((el) => `${el.role}|${el.label ?? ''}|${el.value ?? ''}|${el.focused ? 1 : 0}`);
  return `${seen.frontmostApp ?? seen.app ?? ''}\n${rows.join('\n')}`;
}

/** A desktop failure worth a fresh look and another try (the act itself went
 *  wrong), as opposed to a refusal, which ends the task. */
function retryableFailure(note) {
  if (!note) return false;
  return /^os_\w+ failed:/.test(note) || note === 'not found' || note.startsWith('os_wait:');
}

/** Did this step change the screen the way it claimed? Null when there is
 *  nothing to verify. */
function verifyStep(actions, results, before, after) {
  const acted = actions.filter((a, i) => ACTING_OS.has(a.type) && results[i]?.ok);
  if (acted.length === 0) return null;
  const a = screenSignature(before);
  const b = screenSignature(after);
  if (!b) return { ok: false, note: 'no fresh look after acting' };
  for (const t of acted.filter((x) => x.type === 'os_type')) {
    const probe = t.text.trim().slice(0, 24);
    if (probe && after?.elements.some((el) => el.focused || el.value) && !after.elements.some((el) => (el.value ?? '').includes(probe))) {
      return { ok: false, note: 'typed text not visible on screen' };
    }
  }
  if (a !== null && a === b) return { ok: false, note: 'no visible effect on screen' };
  return { ok: true, note: 'screen changed' };
}

function osTargetLabel(target, seen) {
  if ('elementId' in target) {
    const el = seen?.elements.find((e) => e.id === target.elementId);
    const name = osText(el?.label, 60) || osText(el?.value, 60) || osText(el?.role, 40);
    return name ? `“${name}”` : `element ${osText(target.elementId, 40)}`;
  }
  return `(${Math.round(target.x)}, ${Math.round(target.y)})`;
}

/**
 * The sentence the user is actually approving. `os_type`, a URL and the
 * clipboard text are shown IN FULL — a confirmation that shows a preview is a
 * click they were talked into.
 */
function describeOsAction(action, seen) {
  switch (action.type) {
    case 'os_see': return action.app ? `Take a look at ${osText(action.app, 60)}` : "Take a look at what's on screen";
    case 'os_point': return `Point at ${osTargetLabel(action.target, seen)}`;
    case 'os_click': {
      const verb = action.double ? 'Double-click' : action.button === 'right' ? 'Right-click' : 'Click';
      return `${verb} ${osTargetLabel(action.target, seen)}`;
    }
    case 'os_type': return `Type this:\n\n“${action.text}”`;
    case 'os_press': return `Press ${osText(action.keys, 40)}`;
    case 'os_scroll': {
      const where = action.target ? ` over ${osTargetLabel(action.target, seen)}` : '';
      return `Scroll ${action.direction}${where}`;
    }
    case 'os_menu': return `Choose ${action.path.map((p) => osText(p, 40)).join(' ▸ ')} in ${osText(action.app, 60)}`;
    case 'os_app':
      switch (action.action) {
        case 'quit': return `Quit ${osText(action.name, 60)}`;
        case 'launch': return `Open ${osText(action.name, 60)}`;
        default: return `Switch to ${osText(action.name, 60)}`;
      }
    case 'os_drag': return `Drag from ${osTargetLabel(action.from, seen)} to ${osTargetLabel(action.to, seen)}`;
    case 'os_open_url': return `Open this address in your browser:\n\n${action.url}`;
    case 'os_open_file': return `Open this file:\n\n${action.path}`;
    case 'os_clipboard_read': return "Read what's on your clipboard";
    case 'os_clipboard_write': return `Put this on your clipboard:\n\n“${action.text}”`;
    case 'os_wait': return action.until ? `Wait for “${osText(action.until, 60)}” to appear` : `Wait ${action.ms ?? 0} ms`;
    default: return String(action.type);
  }
}

/**
 * The element map, as the prompt's DESKTOP ELEMENTS section shows it — honest
 * about WHICH app it is of and HOW OLD it is.
 */
function serializeOsElements(seen, max = MAX_PROMPT_OS_ELEMENTS, ageMs = 0) {
  if (!seen.ok || seen.elements.length === 0) return null;
  const rows = seen.elements.slice(0, max).map((el) => {
    const bits = [`${osText(el.role, 40) || 'AXUnknown'} id=${osText(el.id, 40)}`];
    const label = osText(el.label, 60);
    if (label) bits.push(`"${label}"`);
    const value = osText(el.value, 60);
    if (value) bits.push(`value="${value}"`);
    if (el.focused) bits.push('focused');
    if (el.secure) bits.push('SECURE');
    if (el.enabled === false) bits.push('disabled');
    return bits.join(' ');
  });
  const hidden = seen.elements.length - rows.length;
  const looked = osText(seen.app, 60);
  const frontmost = osText(seen.frontmostApp, 60);
  const foreground = seen.foreground === true || (!!looked && looked === frontmost);
  const heading = foreground || !looked
    ? `Frontmost app: ${frontmost || looked || 'unknown'}`
    : `Looked at ${looked}${frontmost ? `, while ${frontmost} was the app in front` : ', which may not be the app in front'}.`;
  const seconds = Math.round(ageMs / 1000);
  return [
    heading,
    seconds >= 1
      ? `Controls from the last look I took, ${seconds}s ago — not a fresh one. Emit os_see again if it matters that nothing has moved since.`
      : "Controls visible on the user's screen right now.",
    'Target one by its id — {"elementId":"…"} —',
    'in os_click / os_point / os_scroll. Do NOT invent an id that is not listed here.',
    ...rows,
    hidden > 0 ? `…and ${hidden} more not shown.` : null,
  ].filter((line) => line !== null).join('\n');
}

/** The next-step message the loop sends after a verified step. */
function nextStepMessage(goal, step) {
  return [
    `STEP ${step + 1} of the desktop task: "${goal}".`,
    "Your last reply's actions, and the check of what they did to the screen, are listed above. DESKTOP ELEMENTS is a fresh look at the screen, taken just now.",
    'Take the NEXT step toward the goal with os_* actions, then stop — you will be shown the screen again.',
    'When the goal is met, reply with one short sentence and {"type":"task_done","summary":"…"}. If it cannot be done, say why in one sentence and emit end_turn.',
    'Say at most one short sentence per step; the user sees each step as it happens.',
  ].join('\n');
}

module.exports = {
  OS_SEEN_TTL_MS,
  MAX_PROMPT_OS_ELEMENTS,
  ACTING_OS,
  osText,
  stepCaption,
  screenSignature,
  retryableFailure,
  verifyStep,
  describeOsAction,
  serializeOsElements,
  nextStepMessage,
};
