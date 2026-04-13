const path = require('path');
const fs = require('fs');

// ─── System prompt ────────────────────────────────────────────────────────────
// Kept intentionally short — small models (135M–1B) hallucinate or go off-rails
// when given long rule lists. The user message wraps the text with explicit
// INPUT/OUTPUT markers to prevent the model from treating it as conversation.

const SYSTEM_PROMPT =
  'You fix transcribed speech. Given the INPUT, output only the cleaned text as OUTPUT.\n' +
  'Remove filler words (um, uh, er, like, you know). Fix grammar and punctuation. ' +
  'Remove stutters and false starts. Keep the speaker\'s words and intent. ' +
  'Do not add commentary, explanations, or new content.';

// ─── Model / context / session ────────────────────────────────────────────────
// All three are kept alive for the lifetime of the worker process so that
// every correction after the first pays only the inference cost, not the
// context-allocation cost.

let model   = null;
let context = null;
let session = null;

async function init(modelPath) {
  const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
  const llama = await getLlama();
  model   = await llama.loadModel({ modelPath });
  context = await model.createContext();
  session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt: SYSTEM_PROMPT,
  });
}

// ─── Output cleaning ──────────────────────────────────────────────────────────

function stripPreamble(output, originalText) {
  let text = output.trim();

  // Strip Qwen3 <think>...</think> reasoning blocks
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Strip leading preamble phrases (including echoed OUTPUT: marker)
  text = text.replace(/^OUTPUT:\s*/i, '');
  text = text.replace(/^(?:here(?:'s| is) (?:the )?(?:formatted|corrected|clean|fixed|updated|rewritten) (?:version|text)[:\s]*\n*)/i, '');
  text = text.replace(/^(?:the (?:formatted|corrected|clean|fixed) (?:version|text) is[:\s]*\n*)/i, '');
  text = text.replace(/^(?:(?:formatted|corrected|fixed|clean|output)[:\s]*\n*)/i, '');

  // Strip trailing explanations
  const cutIdx = text.search(/\n\n(?:I (?:changed|corrected|fixed|made|also|added|removed|formatted)|(?:Note|Changes|Explanation|Here|The (?:text|changes|corrections|formatting|following)))/i);
  if (cutIdx > 0) {
    text = text.substring(0, cutIdx);
  }

  return text.trim() || originalText;
}

// ─── Inference ────────────────────────────────────────────────────────────────

async function correct(text) {
  // Clear chat history from previous corrections so they don't bleed into
  // this turn. The system prompt is re-applied automatically by the session.
  session.setChatHistory([]);

  const userMessage = `INPUT: ${text}\nOUTPUT:`;
  const wordCount = text.split(/\s+/).length;

  const result = await session.prompt(userMessage, {
    maxTokens: Math.min(512, Math.max(32, Math.ceil(wordCount * 2))),
    temperature: 0.05,
    repeatPenalty: {
      penalty: 1.3,
      lastTokens: 32,
      penalizeNewLine: false,
    },
  });

  return stripPreamble(result, text);
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

process.on('message', async (msg) => {
  try {
    if (msg.type === 'init') {
      await init(msg.modelPath);
      process.send({ type: 'init-done' });
    } else if (msg.type === 'correct') {
      const result = await correct(msg.text);
      process.send({ type: 'result', id: msg.id, text: result });
    }
  } catch (err) {
    if (msg.type === 'init') {
      // init messages have no id — send a dedicated init-error so the parent
      // can reject the ensureWorker() promise properly.
      process.send({ type: 'error', error: err.message });
    } else {
      process.send({ type: 'error', id: msg.id, error: err.message });
    }
  }
});
