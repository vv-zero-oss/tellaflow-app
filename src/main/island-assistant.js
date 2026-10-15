/**
 * Shows an assistant run on the voice island.
 *
 * The assistant service already reports every run and step (for the Assistant
 * page). This turns those events into island views for runs started by voice
 * or the command key:
 *
 *   started            → thinking
 *   actions under way  → plan (one row per action, current one spinning)
 *   approval pending   → approval card (Allow / Deny)
 *   final answer       → answer card
 *   not signed in / no AI → setup card
 *   anything else      → error card (Try again / Dismiss)
 *
 * It also maps island button presses back to the run.
 */

const MAX_TITLE = 60;

function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** "open_app" + { name: "Safari" } → "Open app: Safari" */
function actionLabel(tool, args) {
  const words = String(tool || 'action').replace(/_/g, ' ');
  const name = words.charAt(0).toUpperCase() + words.slice(1);
  const first = args && typeof args === 'object'
    ? Object.values(args).find((v) => typeof v === 'string' && v.trim())
    : null;
  return first ? `${name}: ${clip(first, 40)}` : name;
}

const PROVIDER_LABELS = { claude: 'Claude', codex: 'ChatGPT (Codex)', gemini: 'Gemini', ollama: 'Ollama' };

function createIslandAssistant({ island, assistant, openAssistantPage = () => {}, openSettings = () => {}, startSignIn = () => {} }) {
  let run = null; // { id, request, provider, actions: Map<actionId, {label, status}>, approvalId, final, steps }

  function readingTime(text) {
    const words = String(text || '').split(/\s+/).filter(Boolean).length;
    return Math.min(30_000, Math.max(8000, words * 350));
  }

  function plan() {
    const steps = [...run.actions.values()].map(({ label, status }) => ({ label, status }));
    island.show('plan', { content: { plan: { title: clip(run.request, MAX_TITLE), steps } } });
  }

  function showError(text) {
    const notSignedIn = /not signed in/i.test(text);
    const noAi = /no ai is available/i.test(text);
    if (notSignedIn || noAi) {
      const label = PROVIDER_LABELS[run.provider] || 'your AI';
      run.setup = noAi ? 'choose' : 'sign-in';
      island.show('setup', {
        content: {
          notice: noAi
            ? { title: 'Choose an AI to use', body: 'Tellaflow runs commands with an AI you’re signed in to on this Mac. Pick one in Settings.', primary: 'Open Settings', secondary: 'Later' }
            : { title: `Sign in to ${label}`, body: `Sign in once in Terminal — your browser opens to finish. Then ask again: “${clip(run.request, 50)}”.`, primary: 'Sign in', secondary: 'Later' },
        },
      });
      return;
    }
    island.show('error', {
      content: { notice: { title: 'That didn’t work', body: clip(text, 160), primary: 'Try again', secondary: 'Dismiss' } },
    });
  }

  let expected = null; // request text we're about to start

  /**
   * Call just before assistant.start(request): the island shows "thinking" and
   * adopts the run from its first event (which can arrive before start()
   * resolves — e.g. "no AI available" is reported straight away).
   */
  function expect(request) {
    expected = String(request || '').trim();
    run = null;
    island.show('thinking');
  }

  /** Feed every assistant event here. */
  function handle(channel, data) {
    if (!data) return;
    if (!run && expected != null && channel === 'assistant-run' && data.request === expected) {
      run = { id: data.id, request: data.request, provider: null, actions: new Map(), approvalId: null, final: null };
      expected = null;
    }
    if (!run) return;
    if (channel === 'assistant-run') {
      if (data.id !== run.id) return;
      if (data.provider) run.provider = data.provider;
      if (data.status === 'cancelled') { island.rest(); run = null; }
      return;
    }
    if (channel !== 'assistant-step' || data.runId !== run.id) return;
    const step = data.step || {};
    switch (step.type) {
      case 'action':
        for (const a of run.actions.values()) if (a.status === 'current') a.status = 'done';
        run.actions.set(step.id, { label: actionLabel(step.tool, step.args), status: 'current', preview: step.preview });
        plan();
        break;
      case 'approval':
        if (step.status === 'pending') {
          run.approvalId = step.actionId;
          const a = run.actions.get(step.actionId);
          const body = step.preview ? clip(step.preview, 160) : a ? a.label : actionLabel(step.tool, step.args);
          island.show('approval', {
            content: { notice: { title: `Allow ${a ? a.label : actionLabel(step.tool, step.args)}?`, body, primary: 'Allow', secondary: null, tertiary: 'Deny' } },
          });
        } else {
          run.approvalId = null;
          plan();
        }
        break;
      case 'result': {
        const a = run.actions.get(step.actionId);
        if (a) a.status = 'done';
        plan();
        break;
      }
      case 'final':
        run.final = step.text;
        island.show('answer', { content: { answerText: step.text }, autoRestMs: readingTime(step.text) });
        break;
      case 'error':
        if (/^cancelled\.?$/i.test(step.text || '')) break;
        showError(step.text || 'Something went wrong.');
        break;
      default:
        break;
    }
  }

  /** Island button presses that belong to the assistant. Returns true if handled. */
  function action(name) {
    if (!run) return false;
    switch (name) {
      case 'approve':
        if (run.approvalId == null) return false;
        assistant.respondApproval(run.id, run.approvalId, true);
        return true;
      case 'cancel':
        if (run.approvalId == null) return false;
        assistant.respondApproval(run.id, run.approvalId, false);
        return true;
      case 'retry': {
        const { request } = run;
        run = null;
        return { retry: request };
      }
      case 'open-settings':
        if (run.setup === 'sign-in') startSignIn(run.provider || 'claude');
        else openSettings();
        island.rest();
        run = null;
        return true;
      case 'follow-up':
        openAssistantPage();
        island.rest();
        return true;
      case 'dismiss':
      case 'later':
        island.rest();
        run = null;
        return true;
      default:
        return false;
    }
  }

  return { expect, handle, action, isActive: () => !!run };
}

module.exports = { createIslandAssistant, actionLabel };
