/**
 * JSON step protocol shared by every AI provider.
 *
 * Providers are plain "text in → text out" (Claude Code CLI, Codex CLI,
 * Gemini CLI, Ollama), with their own tools disabled. We describe our Mac
 * tools in the prompt and ask for exactly one JSON object per turn:
 *
 *   {"thought": "...", "action": {"tool": "open_app", "args": {"name": "Safari"}}}
 *   {"thought": "...", "final": "Done — Safari is open."}
 *
 * The app runs the action, appends the result to the transcript and asks
 * again, until the model returns `final` or the step budget runs out.
 */

function describeTools(tools) {
  return tools
    .map((t) => {
      const args = Object.entries(t.args || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ');
      return `- ${t.name}(${args})${t.readOnly ? ' [read-only]' : ''} — ${t.description}`;
    })
    .join('\n');
}

function systemPrompt(tools, { now = new Date(), fullAccess = false, vision = false } = {}) {
  return [
    'You are Tellaflow, a fast, capable assistant that operates the user\'s Mac. The user usually speaks a request out loud and wants it done, not discussed. You act ONLY through the tools listed below; Tellaflow runs each one and shows the user every step.',
    '',
    'Reply with exactly ONE JSON object and nothing else — no prose, no markdown, no code fences. Either:',
    '  {"thought": "<one short sentence>", "action": {"tool": "<tool name>", "args": {<arguments>}}}',
    'or, when the task is complete (or impossible):',
    '  {"thought": "<one short sentence>", "final": "<short answer for the user>"}',
    '',
    'How to work:',
    '- Act, don\'t ask. Take the most likely meaning of the request and do it. Fill in sensible defaults yourself (a note title from its content, today for a vague date, the frontmost app for "this app"). Ask the user something only when you truly cannot proceed without it — and then ask it in "final", in one short question.',
    '- Be fast: use the fewest steps that get it done. One action per reply; wait for its result before the next.',
    fullAccess
      ? '- You have full access: every action runs immediately without the user approving it. Do not seek confirmation — just do the task.'
      : '- Actions that change something are shown to the user for approval first. If one is denied, respect it and finish.',
    vision
      ? '- You can see the screen: call look_at_screen whenever you need to know what the user is looking at — "this", "here", "what\'s on my screen", reading a page, finding a button or an error. The screenshot is attached to your next turn. Look before guessing.'
      : null,
    '- Prefer a specific tool; use run_applescript for anything the other tools cannot do (clicking, typing, menus, other apps).',
    '- If a tool fails, adapt and try another way once; otherwise finish and say plainly what happened.',
    '- Never invent results. Write "final" like a person talking: short, natural, concrete — what you did or the answer, no preamble.',
    `- Current local time: ${now.toString()}.`,
    '',
    'Tools:',
    describeTools(tools),
  ].filter((line) => line !== null).join('\n');
}

function formatStepForPrompt(step) {
  if (step.kind === 'action') {
    return `ASSISTANT: ${JSON.stringify({ thought: step.thought || '', action: { tool: step.tool, args: step.args || {} } })}\nRESULT: ${JSON.stringify(step.result)}`;
  }
  if (step.kind === 'invalid') {
    return `ASSISTANT: ${step.raw}\nRESULT: ${JSON.stringify({ ok: false, error: step.error })}`;
  }
  return '';
}

/** Full single-shot prompt (CLIs are invoked statelessly each turn). */
function buildPrompt({ tools, request, history = [], now, fullAccess = false, vision = false }) {
  const lines = [systemPrompt(tools, { now, fullAccess, vision }), '', `USER REQUEST: ${request}`];
  if (history.length) {
    lines.push('', 'STEPS SO FAR:');
    for (const s of history) lines.push(formatStepForPrompt(s));
  }
  lines.push('', 'Reply now with the next JSON object only.');
  return lines.join('\n');
}

/** Find the first balanced top-level {...} in `text` (ignores braces in strings). */
function extractJsonObject(text) {
  const s = String(text || '');
  for (let start = s.indexOf('{'); start !== -1; start = s.indexOf('{', start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const candidate = s.slice(start, i + 1);
          try { return JSON.parse(candidate); } catch { break; }
        }
      }
    }
  }
  return null;
}

/**
 * Parse a model reply into { thought, action } | { thought, final }.
 * Throws with a message suitable for feeding back to the model.
 */
function parseStep(text, toolNames) {
  const obj = extractJsonObject(text);
  if (!obj || typeof obj !== 'object') throw new Error('Reply was not a JSON object.');
  const thought = typeof obj.thought === 'string' ? obj.thought : '';
  if (typeof obj.final === 'string') return { thought, final: obj.final };
  const action = obj.action;
  if (!action || typeof action !== 'object' || typeof action.tool !== 'string') {
    throw new Error('JSON must contain either "final" (string) or "action": {"tool", "args"}.');
  }
  if (toolNames && !toolNames.includes(action.tool)) {
    throw new Error(`Unknown tool "${action.tool}". Available: ${toolNames.join(', ')}.`);
  }
  const args = action.args && typeof action.args === 'object' && !Array.isArray(action.args) ? action.args : {};
  return { thought, action: { tool: action.tool, args } };
}

module.exports = { buildPrompt, parseStep, extractJsonObject, systemPrompt, describeTools };
