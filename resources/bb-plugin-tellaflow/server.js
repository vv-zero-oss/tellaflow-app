/**
 * bb-plugin-tellaflow — the bridge between bb's agents and Tellaflow's island.
 *
 * Tellaflow is a voice app: the user holds a key, speaks, and reads the answer
 * on a small island at the top of the screen while they keep working. Work the
 * assistant hands to a bb chat used to finish INSIDE that chat — written into a
 * window nobody was looking at — so a spoken request ended in silence. This
 * plugin gives every agent in Tellaflow's bb a way back to the user:
 *
 *  - `tellaflow_say`  — put one or two spoken-style sentences on the island:
 *                       the result when a job is done, or a short progress line.
 *  - `tellaflow_ask`  — ask the user a question on the island and WAIT for the
 *                       answer (they tap an option or say it), then carry on.
 *
 * Transport: nothing here knows where Tellaflow is. Events queue in memory and
 * Tellaflow's main process long-polls `GET /api/v1/plugins/tellaflow/http/events`
 * on bb's loopback port (the same server it already drives), and answers a
 * question with `POST …/answer`. "local" auth: loopback, no browser origin.
 *
 * Plain ESM with no dependencies, so a path install loads it as-is — no build,
 * no toolchain download. Tool parameters are JSON schema objects for the same
 * reason (bb validates them; `execute` re-checks what it relies on).
 */

const VERSION = '0.1.0';
/** Events kept for a poller that reconnects. Small: the island shows one. */
const MAX_EVENTS = 100;
/** A long-poll answers at the latest after this. */
const MAX_WAIT_MS = 25_000;
/** A question nobody answers ends here and the agent carries on. */
const ASK_TIMEOUT_MS = 5 * 60_000;
const MAX_TEXT = 600;
const MAX_OPTION = 80;

const INSTRUCTIONS = [
  'You are working for someone using Tellaflow, a voice assistant for their Mac. They asked for this by voice and are',
  'probably NOT watching this chat: they read a small island at the top of their screen while they keep working.',
  '- When you finish the job (or cannot), call tellaflow_say ONCE with kind "answer": one or two plain spoken sentences',
  '  with the result itself (the number, the answer, what changed and where) — not "I have finished", no markdown, no lists.',
  '- On a job that takes more than a minute, you may call tellaflow_say with kind "progress" at a real milestone. Keep it',
  '  rare (at most one every few minutes) and under 12 words.',
  '- When you need a decision only the user can make, call tellaflow_ask with a short question and up to 4 short options',
  '  instead of asking in chat and stopping; it waits for their answer. Decide anything you reasonably can yourself.',
  '- Still write your normal full reply in this chat; the island line is the spoken summary of it.',
].join('\n');

function clip(v, n) {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

export default function plugin(bb) {
  /** @type {{seq:number, at:number, type:string, threadId:string|null, [k:string]:unknown}[]} */
  const events = [];
  let seq = 0;
  /** Long-polls waiting for the next event. */
  const waiters = new Set();
  /** Open questions: id → { resolve, threadId }. */
  const asks = new Map();
  let lastPoll = 0;

  function push(event) {
    const row = { ...event, seq: ++seq, at: Date.now() };
    events.push(row);
    while (events.length > MAX_EVENTS) events.shift();
    for (const wake of [...waiters]) wake();
    return row;
  }

  function settleAsk(id, answer) {
    const open = asks.get(id);
    if (!open) return false;
    asks.delete(id);
    open.resolve(answer);
    return true;
  }

  // ── Tellaflow's side ─────────────────────────────────────────────────────

  bb.http.route('GET', '/health', (c) => c.json({ ok: true, version: VERSION, seq, open: asks.size }));

  bb.http.route('GET', '/events', async (c) => {
    lastPoll = Date.now();
    const after = Number(c.req.query('after') || 0) || 0;
    const wait = Math.max(0, Math.min(MAX_WAIT_MS, Number(c.req.query('wait') || 0) || 0));
    const newer = () => events.filter((e) => e.seq > after);
    // A poller that is ahead of us (bb restarted the plugin, so seq began again)
    // gets everything we have, and our seq to resume from.
    if (after > seq) return c.json({ seq, reset: true, events: events.slice() });
    if (newer().length === 0 && wait > 0) {
      await new Promise((resolve) => {
        const done = () => { clearTimeout(timer); waiters.delete(done); resolve(); };
        const timer = setTimeout(done, wait);
        waiters.add(done);
        c.req.raw.signal?.addEventListener?.('abort', done, { once: true });
      });
    }
    return c.json({ seq, events: newer() });
  });

  bb.http.route('POST', '/answer', async (c) => {
    let body = null;
    try { body = await c.req.json(); } catch { /* answered below */ }
    const id = typeof body?.id === 'string' ? body.id : '';
    const answer = typeof body?.answer === 'string' ? clip(body.answer, 1000) : null;
    const ok = settleAsk(id, answer);
    return c.json({ ok }, ok ? 200 : 404);
  });

  // ── The agents' side ─────────────────────────────────────────────────────

  bb.agents.registerTool({
    name: 'tellaflow_say',
    description:
      "Show one or two short spoken-style sentences on the user's Tellaflow island (the small panel at the top of their screen). " +
      'Use kind "answer" once when the job is done — with the result itself — and kind "progress" for a rare milestone on a long job.',
    presentation: { label: { pending: 'Telling you on the island', completed: 'Told you on the island' } },
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What to say: plain sentences, no markdown, at most ~2 sentences.' },
        kind: { type: 'string', enum: ['answer', 'progress'], description: '"answer" for the result (default), "progress" for a milestone.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      const text = clip(input?.text, MAX_TEXT);
      if (!text) return textResult('Nothing to say: `text` was empty.', true);
      const kind = input?.kind === 'progress' ? 'progress' : 'answer';
      push({ type: 'say', kind, text, threadId: ctx?.threadId ?? null, projectId: ctx?.projectId ?? null });
      const listening = Date.now() - lastPoll < MAX_WAIT_MS * 2;
      return listening
        ? `Shown on the user's island${kind === 'answer' ? ' as your answer' : ''}.`
        : "Queued for the user's island (Tellaflow is not connected right now; they will see it in this chat).";
    },
  });

  bb.agents.registerTool({
    name: 'tellaflow_ask',
    description:
      "Ask the user a question on their Tellaflow island and wait for the answer (they tap an option or say one). " +
      'Use it only for a decision you cannot reasonably make yourself. Returns their answer as text.',
    presentation: { label: { pending: 'Asking you on the island', completed: 'Asked you on the island' } },
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'One short question.' },
        options: { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'Up to 4 short answers to offer (optional).' },
      },
      required: ['question'],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      const question = clip(input?.question, 300);
      if (!question) return textResult('No question: `question` was empty.', true);
      const options = (Array.isArray(input?.options) ? input.options : []).map((o) => clip(o, MAX_OPTION)).filter(Boolean).slice(0, 4);
      const id = `ask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const answered = new Promise((resolve) => asks.set(id, { resolve, threadId: ctx?.threadId ?? null }));
      push({ type: 'ask', id, question, options, threadId: ctx?.threadId ?? null, projectId: ctx?.projectId ?? null });
      const timer = setTimeout(() => settleAsk(id, null), ASK_TIMEOUT_MS);
      const onAbort = () => settleAsk(id, null);
      ctx?.signal?.addEventListener?.('abort', onAbort, { once: true });
      const answer = await answered;
      clearTimeout(timer);
      ctx?.signal?.removeEventListener?.('abort', onAbort);
      push({ type: 'ask-closed', id, threadId: ctx?.threadId ?? null });
      if (answer === null || answer === '') {
        return textResult('The user did not answer. Carry on with your best judgement, and say what you chose in your tellaflow_say answer.', true);
      }
      return `The user answered: ${answer}`;
    },
  });

  bb.agents.configure(() => ({
    tools: ['tellaflow_say', 'tellaflow_ask'],
    skills: [],
    instructions: INSTRUCTIONS,
  }));

  bb.onDispose?.(() => {
    for (const id of [...asks.keys()]) settleAsk(id, null);
    for (const wake of [...waiters]) wake();
  });

  bb.log?.info?.(`tellaflow bridge ${VERSION} ready`);
}
