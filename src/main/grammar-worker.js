// ─── System prompt ────────────────────────────────────────────────────────────
// Single focused task: punctuate and capitalise a raw speech transcript while
// keeping the speaker's wording intact. Small models drift badly when given
// many rules, so this stays minimal — the behaviour is anchored by the
// few-shot examples we inject as chat history before every correction.

const SYSTEM_PROMPT =
  "You are a punctuation and capitalisation engine for speech-to-text transcripts.\n" +
  "The user message is a raw transcript. Reply with ONLY that same transcript, with proper punctuation and capitalisation.\n" +
  "Hard rules:\n" +
  "- Keep the speaker's exact words and order. Do not add, remove, paraphrase, or summarise.\n" +
  "- No preamble (no \"Okay\", \"Sure\", \"Here is\", \"I've\"). No explanation. No markdown.\n" +
  "- Only fix an obviously misrecognised word when context makes the right word certain.\n" +
  "- Output is the corrected transcript and nothing else.";

// Few-shot examples are inserted into the chat history before each correction.
// Showing the model the exact input → output shape it must mimic is far more
// reliable than describing the format in prose for sub-1B parameter models.
const FEW_SHOT = [
  {
    user: 'hey can you grab some milk from the store on your way home thanks',
    assistant: 'Hey, can you grab some milk from the store on your way home? Thanks.',
  },
  {
    user: "so i was thinking we should probably move the meeting to tuesday instead of monday because john is out",
    assistant: "So I was thinking we should probably move the meeting to Tuesday instead of Monday because John is out.",
  },
  {
    user: "remind me to email sarah about the launch tomorrow morning and also pick up the dry cleaning",
    assistant: "Remind me to email Sarah about the launch tomorrow morning, and also pick up the dry cleaning.",
  },
  {
    user: 'whats the status on the deployment did the release go out',
    assistant: "What's the status on the deployment? Did the release go out?",
  },
  {
    user: "i ran the script and it worked the first time which honestly surprised me",
    assistant: 'I ran the script and it worked the first time, which honestly surprised me.',
  },
];

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

// Build a chat-history array node-llama-cpp accepts. We re-seed this on every
// call so each transcript is corrected in isolation — no cross-talk between
// dictations and no slow context growth. The system message is included
// explicitly so setChatHistory cannot drop it.
function buildHistory() {
  const history = [{ type: 'system', text: SYSTEM_PROMPT }];
  for (const ex of FEW_SHOT) {
    history.push({ type: 'user', text: ex.user });
    history.push({ type: 'model', response: [ex.assistant] });
  }
  return history;
}

// ─── Output cleaning ──────────────────────────────────────────────────────────

function stripPreamble(output, originalText) {
  let text = output.trim();

  // Strip Qwen3 <think>...</think> reasoning blocks (tags vary by export).
  text = text.replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, '').trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Strip code fences if the model wrapped the output.
  text = text.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // Strip explicit "Output:" / "Corrected:" labels the model sometimes echoes.
  text = text.replace(/^(?:output|corrected|fixed|result)\s*:\s*/i, '');

  // Strip common chat-assistant intros ("Okay, here's…", "Sure! I've…").
  text = text.replace(
    /^(?:Okay|OK|Sure|Alright|Yes|Great|Of course)[,!]?\s+(?:here(?:'s| is)|I(?:'ve| will| can))[^\n]*(?:\n+|$)/i,
    '',
  );
  text = text.replace(
    /^(?:here(?:'s| is) (?:the )?(?:formatted|corrected|punctuated|clean|fixed|updated|rewritten) (?:version|text|transcript)[:\s]*\n*)/i,
    '',
  );
  text = text.replace(
    /^(?:the (?:formatted|corrected|punctuated|fixed) (?:version|text|transcript) is[:\s]*\n*)/i,
    '',
  );

  // Strip trailing assistant explanations like "I changed X to Y".
  const cutIdx = text.search(
    /\n\n(?:I (?:changed|corrected|fixed|made|also|added|removed|adjusted)|(?:Note|Changes|Explanation|Here|The (?:text|changes|corrections|formatting|following)))/i,
  );
  if (cutIdx > 0) text = text.substring(0, cutIdx);

  return text.trim() || originalText;
}

/** Reject outputs that look like the model rewrote rather than punctuated. */
function shouldRejectAsAssistantRewrite(output, originalText) {
  if (!output || !originalText) return true;
  const o = output.trim();
  const i = originalText.trim();
  if (o.length === 0) return true;

  // Markdown bold/italic/bullet means the model is formatting, not punctuating.
  if (/\*\*[^*]+\*\*/.test(o)) return true;
  if (/^\s*[-*]\s+/m.test(o) && !/^\s*[-*]\s+/m.test(i)) return true;

  // Assistant-style intros that slipped past the stripPreamble pass.
  if (/^(?:Okay|OK|Sure|Alright|Great|Yes)\b/i.test(o) && !/^(?:Okay|OK|Sure|Alright|Great|Yes)\b/i.test(i)) {
    return true;
  }
  if (/\bbased on (?:your |the )?(?:input|request|transcript)\b/i.test(o)) return true;

  // Length sanity: a punctuated version shouldn't be wildly longer or shorter.
  const ratio = o.length / i.length;
  if (ratio > 1.6 || ratio < 0.6) return true;

  // Word-overlap: most longer words from the transcript must survive intact.
  const tokenize = (s) =>
    (s.toLowerCase().match(/\b[a-z0-9']{4,}\b/g) || []).map((w) => w.replace(/'/g, ''));
  const ins = tokenize(i);
  if (ins.length < 5) return false;
  const outs = new Set(tokenize(o));
  let hits = 0;
  for (const w of ins) if (outs.has(w)) hits += 1;
  if (hits / ins.length < 0.7) return true;

  return false;
}

// ─── Inference ────────────────────────────────────────────────────────────────

async function correct(text) {
  // Re-seed history with the few-shot examples so every correction starts
  // from the same anchored state. The system prompt is preserved by the
  // session and re-applied automatically.
  session.setChatHistory(buildHistory());

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  // Allow generous headroom for punctuation/capitalisation but never less than
  // ~1.3x the input — small models occasionally pad slightly with whitespace.
  const maxTokens = Math.min(768, Math.max(48, Math.ceil(wordCount * 2.5)));

  const result = await session.prompt(text, {
    maxTokens,
    temperature: 0,
    topP: 1,
    repeatPenalty: {
      penalty: 1.1,
      lastTokens: 32,
      penalizeNewLine: false,
    },
    // Stop as soon as the model tries to start a fresh user turn — guards
    // against runaway generations on models that don't honour maxTokens cleanly.
    customStopTriggers: ['\nUser:', '\nuser:', '\nInput:'],
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
