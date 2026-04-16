/**
 * agent-worker.js — Forked LLM worker process
 *
 * Runs in its own Node.js process. Loads the GGUF model once, then handles
 * multiple `run` requests from the parent.
 *
 * Multi-turn support:
 *   - A LlamaChatSession is kept alive between consecutive runs in the same
 *     "session". The parent controls session lifecycle via `reset_session`.
 *   - The `ask_user` tool lets the LLM pause and ask a clarifying question.
 *     The worker signals the parent which shows the question to the user; the
 *     next user utterance is delivered back as a `user_answer` message and the
 *     LLM continues with the answer in context.
 */

const path = require('path');

// ─── State ────────────────────────────────────────────────────────────────────

let model   = null;
let context = null;
let session = null;
let loadedModelPath = null;

// Pending tool calls: reqId → resolve
const pendingToolCalls = new Map();

// Pending ask_user calls: reqId → resolve
const pendingAskUser = new Map();

// ─── React-compatible input fill helper (for page-injected scripts) ───────────
// (Not used here, included as documentation reference)

// ─── Build system prompt ──────────────────────────────────────────────────────

function buildSystemPrompt(contextText) {
  const parts = [
    'You are a voice-controlled Mac assistant. ALWAYS execute tools — never just reply with words.',
    'Chain tools for multi-step tasks. Be brief in final replies (1-2 sentences).',
    '',
    '## RULES',
    '- ALWAYS call at least one tool before replying, unless the user asked a simple factual question.',
    '- "Play X on YouTube": call search_youtube(query="X") THEN youtube_click_first_result(query="X").',
    '- "Go to X and do Y": call open_url(url="https://X") first, then do Y.',
    '- If you need more information to complete a task, call ask_user(question="...") ONCE.',
    '- When a task is complete, end your reply with: ✓ Done.',
    '- Pass the same query string to both search_youtube AND youtube_click_first_result.',
  ];

  if (contextText && contextText.trim()) {
    parts.push('', '## Context', contextText.trim());
  }

  return parts.join('\n');
}

// ─── Build function definitions ───────────────────────────────────────────────

async function buildFunctions(tools) {
  const { defineChatSessionFunction } = await import('node-llama-cpp');

  const functions = {};

  // ask_user: LLM pauses and asks a clarifying question
  functions['ask_user'] = defineChatSessionFunction({
    description:
      'Ask the user a clarifying question when you need more information to complete the task. ' +
      'Use ONLY when genuinely necessary. The user will answer by speaking.',
    params: {
      type: 'object',
      properties: {
        question: { type: 'string' },
      },
    },
    async handler({ question }) {
      return new Promise((resolve) => {
        const reqId = Math.random().toString(36).slice(2);
        pendingAskUser.set(reqId, resolve);
        process.send({ type: 'ask_user', reqId, question });
      });
    },
  });

  for (const tool of tools) {
    const properties = {};
    for (const [paramName, def] of Object.entries(tool.parameters || {})) {
      if (def.type === 'array') {
        properties[paramName] = { type: 'array', items: def.items || { type: 'string' } };
      } else {
        properties[paramName] = { type: def.type || 'string' };
      }
    }

    functions[tool.name] = defineChatSessionFunction({
      description: tool.description,
      params: { type: 'object', properties },
      async handler(params) {
        return new Promise((resolve) => {
          const reqId = Math.random().toString(36).slice(2);
          pendingToolCalls.set(reqId, resolve);
          process.send({ type: 'tool-call', reqId, toolName: tool.name, args: params });
        });
      },
    });
  }

  return functions;
}

// ─── Create / reuse context + session ────────────────────────────────────────

async function ensureSession(tools, contextText, forceReset = false) {
  const { LlamaChatSession } = await import('node-llama-cpp');

  if (forceReset || !context || !session) {
    if (session) { try { session.dispose?.(); } catch {} session = null; }
    if (context) { try { context.dispose?.(); } catch {} context = null; }

    context = await model.createContext({ contextSize: 8192 });
    const seq = context.getSequence();
    session = new LlamaChatSession({
      contextSequence: seq,
      systemPrompt: buildSystemPrompt(contextText),
    });
  }

  return session;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init(modelPath) {
  const { getLlama } = await import('node-llama-cpp');
  const llama = await getLlama();
  model = await llama.loadModel({ modelPath });
  loadedModelPath = modelPath;
}

// ─── Run one agent turn ────────────────────────────────────────────────────────

async function run(id, transcript, tools, contextText, resetSession = false) {
  if (!model) throw new Error('Agent worker not initialized');

  const s = await ensureSession(tools, contextText, resetSession);
  const functions = await buildFunctions(tools);

  const result = await s.prompt(transcript, {
    functions,
    maxTokens: 600,
    temperature: 0.1,
    maxToolResponseTokens: 512,
  });

  // Strip Qwen3 <think> blocks
  const clean = result.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  return clean;
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

process.on('message', async (msg) => {
  try {
    if (msg.type === 'init') {
      await init(msg.modelPath);
      process.send({ type: 'init-done' });

    } else if (msg.type === 'run') {
      const reply = await run(msg.id, msg.transcript, msg.tools, msg.contextText || '', msg.resetSession || false);
      process.send({ type: 'result', id: msg.id, reply });

    } else if (msg.type === 'tool-result') {
      const resolve = pendingToolCalls.get(msg.reqId);
      if (resolve) { pendingToolCalls.delete(msg.reqId); resolve(msg.result); }

    } else if (msg.type === 'user_answer') {
      // Answer to an ask_user call
      const resolve = pendingAskUser.get(msg.reqId);
      if (resolve) { pendingAskUser.delete(msg.reqId); resolve(msg.answer); }

    } else if (msg.type === 'reset_session') {
      if (session) { try { session.dispose?.(); } catch {} session = null; }
      if (context) { try { context.dispose?.(); } catch {} context = null; }
      process.send({ type: 'session-reset' });
    }
  } catch (err) {
    if (msg.type === 'init') {
      process.send({ type: 'error', error: err.message });
    } else {
      process.send({ type: 'error', id: msg?.id, error: err.message });
    }
  }
});
