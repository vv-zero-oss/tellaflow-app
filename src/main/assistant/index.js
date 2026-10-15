/**
 * Assistant service: owns runs, approvals and provider selection, and turns
 * agent steps into IPC events for the Assistant page.
 */

const { runAgent } = require('./agent');
const { createProviders, detectProviders, pickProvider } = require('./providers');
const { createMacTools } = require('./mac-tools');

const MAX_RUNS_KEPT = 20;

function createAssistantService({
  getSettings,
  send = () => {},
  saveToHistory = () => {},
  providers = createProviders({ ollama: { getModel: () => getSettings().ollamaModel || '' } }),
  tools = createMacTools(),
  log = console,
}) {
  const runs = new Map(); // runId → { id, request, steps, status, final, provider, approvals, controller }
  let nextId = 1;

  function trim() {
    while (runs.size > MAX_RUNS_KEPT) {
      const oldest = runs.keys().next().value;
      const r = runs.get(oldest);
      if (r.status === 'running') break;
      runs.delete(oldest);
    }
  }

  function summary(r) {
    return { id: r.id, request: r.request, steps: r.steps, status: r.status, final: r.final, provider: r.provider, startedAt: r.startedAt, source: r.source };
  }

  async function start(request, { source = 'typed' } = {}) {
    const text = String(request || '').trim();
    if (!text) throw new Error('Empty request');
    const settings = getSettings();
    const id = `run-${Date.now()}-${nextId++}`;
    const run = { id, request: text, steps: [], status: 'running', final: null, provider: null, approvals: new Map(), controller: new AbortController(), startedAt: Date.now(), source };
    runs.set(id, run);
    trim();
    send('assistant-run', summary(run));

    const provider = await pickProvider(providers, settings.provider || 'auto');
    if (!provider) {
      run.status = 'error';
      const step = { id: 1, at: Date.now(), type: 'error', text: 'No AI is available. Sign in to Claude Code, Codex or Gemini CLI, or start Ollama — see Settings → Assistant.' };
      run.steps.push(step);
      send('assistant-step', { runId: id, step });
      send('assistant-run', summary(run));
      return id;
    }
    run.provider = provider.id;
    send('assistant-run', summary(run));

    runAgent({
      request: text,
      complete: (prompt, o) => provider.complete(prompt, o),
      tools,
      fullAccess: !!settings.fullAccess,
      vision: !!provider.vision,
      maxSteps: 10,
      signal: run.controller.signal,
      onStep: (step) => {
        run.steps.push(step);
        send('assistant-step', { runId: id, step });
      },
      approve: (actionStep) => new Promise((resolve) => {
        run.approvals.set(actionStep.id, resolve);
        run.controller.signal.addEventListener('abort', () => resolve(false), { once: true });
      }),
    }).then((res) => {
      run.status = res.status;
      run.final = res.final;
      send('assistant-run', summary(run));
      if (res.final) {
        try { saveToHistory(`Assistant: ${text}\n\n${res.final}`); } catch {}
      }
    }).catch((err) => {
      log.error?.('[assistant] run failed:', err);
      run.status = 'error';
      send('assistant-run', summary(run));
    });
    return id;
  }

  function respondApproval(runId, actionId, approved) {
    const run = runs.get(runId);
    const resolve = run?.approvals.get(actionId);
    if (!resolve) return false;
    run.approvals.delete(actionId);
    resolve(!!approved);
    return true;
  }

  function cancel(runId) {
    const run = runs.get(runId);
    if (!run || run.status !== 'running') return false;
    run.controller.abort();
    return true;
  }

  return {
    start,
    respondApproval,
    cancel,
    listRuns: () => [...runs.values()].map(summary).reverse(),
    detect: () => detectProviders(providers),
    toolList: () => tools.map((t) => ({ name: t.name, description: t.description, readOnly: !!t.readOnly, alwaysAsk: !!t.alwaysAsk })),
  };
}

module.exports = { createAssistantService };
