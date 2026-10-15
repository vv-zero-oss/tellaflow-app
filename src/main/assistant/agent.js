/**
 * Assistant agent loop: plan one action at a time with a signed-in AI,
 * execute it locally, feed the result back, repeat until `final`.
 *
 * Every step is reported through `onStep` so the UI can render the chain:
 *   thought → action → (approval) → result → … → final
 *
 * Approval policy (the user's "Full access" setting, on by default):
 *   - full access: nothing asks — every action, scripts included, just runs
 *   - otherwise: read-only tools run, everything else asks first
 */

const fs = require('fs');
const { buildPrompt, parseStep } = require('./protocol');

const MAX_RESULT_CHARS = 4000;

function needsApproval(tool, { fullAccess }) {
  if (fullAccess) return false;
  return !tool.readOnly;
}

function truncate(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s == null) return v;
  return s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)}… [truncated]` : v;
}

/**
 * @param {object} p
 * @param {string} p.request                 user's request
 * @param {(prompt: string, o: {signal?: AbortSignal}) => Promise<string>} p.complete
 * @param {Array} p.tools                    tool definitions (see mac-tools.js)
 * @param {(step) => Promise<boolean>} p.approve
 * @param {(step) => void} [p.onStep]
 * @param {boolean} [p.fullAccess]
 * @param {boolean} [p.vision]           the AI can see images (screenshots)
 * @param {number} [p.maxSteps]
 * @param {AbortSignal} [p.signal]
 * @returns {Promise<{ final: string|null, steps: object[], status: 'done'|'error'|'cancelled'|'max-steps' }>}
 */
async function runAgent({ request, complete, tools: allTools, approve, onStep = () => {}, fullAccess = false, vision = false, maxSteps = 10, signal, toolContext = {}, now, removeFile = (f) => fs.rmSync(f, { force: true }) }) {
  // Only offer the screen to an AI that can look at images.
  const tools = vision ? allTools : allTools.filter((t) => t.name !== 'look_at_screen');
  // The latest screenshot rides along with every later turn of this run.
  let screenImage = null;
  try {
    return await loop();
  } finally {
    if (screenImage) { try { removeFile(screenImage); } catch {} }
  }

  async function loop() {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const toolNames = [...byName.keys()];
  const history = [];
  const steps = [];
  let seq = 0;
  let invalidStreak = 0;

  const emit = (step) => {
    const s = { id: ++seq, at: Date.now(), ...step };
    steps.push(s);
    try { onStep(s); } catch {}
    return s;
  };

  const cancelled = () => signal && signal.aborted;

  for (let turn = 0; turn < maxSteps; turn++) {
    if (cancelled()) { emit({ type: 'error', text: 'Cancelled.' }); return { final: null, steps, status: 'cancelled' }; }

    let reply;
    try {
      reply = await complete(
        buildPrompt({ tools, request, history, now: now ? now() : new Date(), fullAccess, vision }),
        { signal, images: screenImage ? [screenImage] : [] },
      );
    } catch (err) {
      if (cancelled()) { emit({ type: 'error', text: 'Cancelled.' }); return { final: null, steps, status: 'cancelled' }; }
      emit({ type: 'error', text: `AI provider error: ${err.message}` });
      return { final: null, steps, status: 'error' };
    }

    let parsed;
    try {
      parsed = parseStep(reply, toolNames);
      invalidStreak = 0;
    } catch (err) {
      invalidStreak++;
      history.push({ kind: 'invalid', raw: String(reply).slice(0, 500), error: err.message });
      if (invalidStreak >= 2) {
        emit({ type: 'error', text: `The AI didn't follow the step format: ${err.message}` });
        return { final: null, steps, status: 'error' };
      }
      continue;
    }

    if (parsed.thought) emit({ type: 'thought', text: parsed.thought });

    if (parsed.final != null) {
      emit({ type: 'final', text: parsed.final });
      return { final: parsed.final, steps, status: 'done' };
    }

    const { tool: name, args } = parsed.action;
    const tool = byName.get(name);
    const ask = needsApproval(tool, { fullAccess });
    const preview = tool.preview ? tool.preview(args) : null;
    const actionStep = emit({ type: 'action', tool: name, args, readOnly: !!tool.readOnly, needsApproval: ask, preview });

    let result;
    if (ask) {
      emit({ type: 'approval', actionId: actionStep.id, status: 'pending', tool: name, args, preview });
      let ok = false;
      try { ok = await approve({ ...actionStep }); } catch { ok = false; }
      if (cancelled()) { emit({ type: 'error', text: 'Cancelled.' }); return { final: null, steps, status: 'cancelled' }; }
      emit({ type: 'approval', actionId: actionStep.id, status: ok ? 'approved' : 'denied', tool: name });
      if (!ok) result = { ok: false, error: 'The user denied this action.' };
    }

    if (!result) {
      try {
        if (tool.validate) tool.validate(args);
        let output = await tool.run(args, toolContext);
        if (output && typeof output === 'object' && output.image) {
          if (screenImage) { try { removeFile(screenImage); } catch {} }
          screenImage = output.image;
          output = output.text;
        }
        result = { ok: true, output: truncate(output ?? 'done') };
      } catch (err) {
        result = { ok: false, error: err.message || String(err) };
      }
    }
    emit({ type: 'result', actionId: actionStep.id, tool: name, ...result });
    history.push({ kind: 'action', thought: parsed.thought, tool: name, args, result });
  }

  emit({ type: 'error', text: `Stopped after ${maxSteps} steps without finishing.` });
  return { final: null, steps, status: 'max-steps' };
  }
}

module.exports = { runAgent, needsApproval };
