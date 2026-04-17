// ─── System prompt ────────────────────────────────────────────────────────────
// Kept relatively tight — small models (135M–1B) hallucinate when rules sprawl.
// The user message wraps the text with explicit INPUT/OUTPUT markers so the
// model does not treat the transcript as a chat turn.

const SYSTEM_PROMPT =
  'You format speech-to-text only. INPUT is a raw transcript. OUTPUT is that transcript, nothing else.\n' +
  'Keep the same words and order. Do not answer, summarize, categorize, or "help" like an assistant.\n' +
  'Allowed: punctuation, capitalization, line breaks, light spacing.\n' +
  'Lists: if the speaker gives several separate tasks or items in one utterance, you may put ONE item per numbered line. ' +
  'Each line must reuse the speaker\'s exact wording for that item — no merging items, no section titles, no bold, no markdown **, no labels like "Grocery:". Do not expand times (if they said 7, keep 7).\n' +
  'Typos: fix only obvious speech-recognition slips when the right word is certain from nearby words. Otherwise keep wording as spoken.\n' +
  'Never start with Okay/Sure/Here/Here\'s/I\'ve or similar. Never add text before the first word of the transcript.\n' +
  'Example style (not literal content): INPUT ends with several short imperatives → OUTPUT is those same phrases as "1. ..." "2. ..." with no intro paragraph.';

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

  // Strip Qwen3 <think>...</think> reasoning blocks (tags vary by export)
  text = text.replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, '').trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Strip leading preamble phrases (including echoed OUTPUT: marker)
  text = text.replace(/^OUTPUT:\s*/i, '');
  text = text.replace(
    /^(?:Okay|OK|Sure|Alright|Yes|Great)[,!]?\s+(?:here(?:'s| is)|I(?:'ve| will| can))[^\n]*(?:\n+|$)/i,
    '',
  );
  text = text.replace(/^(?:here(?:'s| is)|I(?:'ve| will| can)) (?:a |your |the )?(?:formatted |corrected |clean |fixed )?(?:to-?do |task )?list[^\n]*\n+/i, '');
  text = text.replace(/^[^\n]*\bbased on your (?:input|request)\b[^\n]*\n+/i, '');
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

/** If the model answered like a chatbot instead of formatting, keep the raw transcript. */
function shouldRejectAsAssistantRewrite(output, originalText) {
  if (!output || !originalText) return true;
  const o = output.trim();
  const i = originalText.trim();
  if (o.length === 0) return true;

  if (/\*\*[^*]+\*\*/.test(o)) return true;
  if (/\bbased on your (?:input|request)\b/i.test(o)) return true;
  if (/^(?:Okay|OK|Sure|Alright|Great|Yes)\b/i.test(o) && !/^(?:Okay|OK|Sure|Alright|Great|Yes)\b/i.test(i)) {
    return true;
  }

  const tokenize = (s) =>
    (s.toLowerCase().match(/\b[a-z0-9']{4,}\b/g) || []).map((w) => w.replace(/'/g, ''));
  const ins = tokenize(i);
  if (ins.length < 5) return false;
  const outs = new Set(tokenize(o));
  let hits = 0;
  for (const w of ins) {
    if (outs.has(w)) hits += 1;
  }
  // Most longer words from the transcript should still appear (no synonym rewrites).
  if (hits / ins.length < 0.62) return true;
  return false;
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
    temperature: 0,
    repeatPenalty: {
      penalty: 1.3,
      lastTokens: 32,
      penalizeNewLine: false,
    },
  });

  let out = stripPreamble(result, text);
  if (shouldRejectAsAssistantRewrite(out, text)) {
    out = text;
  }
  return out;
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
