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

function systemPrompt(tools, { now = new Date() } = {}) {
  return [
    'You are Tellaflow Assistant. You operate the user\'s Mac ONLY through the tools listed below; the app executes each tool for you and shows the user every step.',
    '',
    'Reply with exactly ONE JSON object and nothing else — no prose, no markdown, no code fences. Either:',
    '  {"thought": "<one short sentence>", "action": {"tool": "<tool name>", "args": {<arguments>}}}',
    'or, when the task is complete (or impossible):',
    '  {"thought": "<one short sentence>", "final": "<short answer for the user>"}',
    '',
    'Rules:',
    '- One action per reply. Wait for its result before the next.',
    '- Use only the tools listed. Prefer a specific tool over run_applescript; use run_applescript only when no other tool fits.',
    '- If a tool fails or the user denies it, adapt or finish with a final explaining what happened.',
    '- Never invent results. Keep "final" brief and concrete.',
    `- Current local time: ${now.toString()}.`,
    '',
    'Tools:',
    describeTools(tools),
  ].join('\n');
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
function buildPrompt({ tools, request, history = [], now }) {
  const lines = [systemPrompt(tools, { now }), '', `USER REQUEST: ${request}`];
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
