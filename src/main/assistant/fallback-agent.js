/**
 * Fallback agent — calls Ollama native API or OpenAI-compatible API.
 * Uses Ollama's /api/chat for local models (proper tool calling).
 * Uses /v1/chat/completions for cloud providers.
 */
const assistantConfig = require('./config');
const secureStore = require('./secure-store');

const SYSTEM_PROMPT = `You are a helpful voice assistant running locally on the user's Mac.
You respond concisely — keep answers under 2-3 sentences unless asked for detail.
You have access to tools for controlling the computer. ALWAYS use tools when the user asks to perform an action.
Respond naturally as if speaking — avoid markdown, bullet points, or formatted text.`;

// Tool definitions in Ollama native format
const OLLAMA_TOOLS = [
  { type: 'function', function: { name: 'open_app', description: 'Launch or activate a macOS application', parameters: { type: 'object', properties: { name: { type: 'string', description: 'App name' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'open_url', description: 'Open a URL in the default browser', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'search_web', description: 'Search the web', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'get_time', description: 'Get current date and time', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'get_clipboard', description: 'Read clipboard contents', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'type_text', description: 'Type text into active app', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'set_volume', description: 'Set system volume 0-100', parameters: { type: 'object', properties: { level: { type: 'number' } }, required: ['level'] } } },
  { type: 'function', function: { name: 'toggle_dark_mode', description: 'Toggle system dark mode on/off', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'get_active_app', description: 'Get frontmost application name', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'list_apps', description: 'List running applications', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'screenshot', description: 'Take a screenshot', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'file_search', description: 'Search files using Spotlight', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'create_reminder', description: 'Create reminder in Apple Reminders', parameters: { type: 'object', properties: { title: { type: 'string' }, notes: { type: 'string' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'create_note', description: 'Create note in Apple Notes', parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'set_timer', description: 'Set a timer (notification when done)', parameters: { type: 'object', properties: { seconds: { type: 'number' }, label: { type: 'string' } }, required: ['seconds'] } } },
  { type: 'function', function: { name: 'run_command', description: 'Run a safe shell command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'run_shortcut', description: 'Run a macOS Shortcut by name', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
];

/** Strip <think>...</think> blocks */
function stripThinking(text) {
  if (!text) return '';
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// Conversation history
let conversationMessages = [{ role: 'system', content: SYSTEM_PROMPT }];
const MAX_MESSAGES = 20;

function addMessage(msg) {
  conversationMessages.push(msg);
  if (conversationMessages.length > MAX_MESSAGES + 1) {
    conversationMessages = [conversationMessages[0], ...conversationMessages.slice(-MAX_MESSAGES)];
  }
}

function clearHistory() {
  conversationMessages = [{ role: 'system', content: SYSTEM_PROMPT }];
}

function isLocalProvider() {
  const p = assistantConfig.getProvider();
  return ['ollama', 'llamacpp'].includes(p);
}

function toOllamaModel(model) {
  if (!model) return 'qwen3:4b';
  if (model.includes(':')) return model;
  const MAP = { 'gemma-3-4b': 'gemma3:latest', 'gemma-3-1b': 'gemma3:1b', 'qwen3-0.6b': 'qwen3:0.6b', 'qwen3-4b': 'qwen3:4b' };
  return MAP[model] || model;
}

// Models that support tool calling
const TOOL_CAPABLE_MODELS = ['qwen', 'llama', 'mistral', 'command', 'gpt', 'claude', 'deepseek'];
function modelSupportsTools(model) {
  const m = (model || '').toLowerCase();
  return TOOL_CAPABLE_MODELS.some(t => m.includes(t));
}

/**
 * Query via Ollama native API (/api/chat) — proper tool calling support.
 */
async function queryOllama(userMessage, { onToolCall, signal } = {}) {
  if (userMessage) addMessage({ role: 'user', content: userMessage });

  const model = toOllamaModel(assistantConfig.getModel());
  const provider = assistantConfig.getProvider();
  const useTools = onToolCall && modelSupportsTools(model);
  console.log(`[fallback-agent] provider=${provider} model=${model} useTools=${useTools} supportsTools=${modelSupportsTools(model)}`);

  const body = {
    model,
    messages: conversationMessages,
    stream: false,
    // Higher token budget when tools enabled — model needs tokens for thinking + tool call JSON
    options: { num_predict: useTools ? 2048 : 512 },
  };
  if (useTools) body.tools = OLLAMA_TOOLS;

  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Ollama error (${res.status}): ${err.slice(0, 150)}`);
  }

  const data = await res.json();
  const msg = data.message;

  if (msg?.tool_calls?.length && onToolCall) {
    // Add assistant message with tool calls to history
    addMessage(msg);

    // Execute each tool call and collect results
    const toolResults = [];
    for (const tc of msg.tool_calls) {
      const name = tc.function.name;
      const args = tc.function.arguments || {};
      console.log(`[assistant] TOOL CALL: ${name}(${JSON.stringify(args)})`);

      const result = await onToolCall(name, args);
      console.log(`[assistant] TOOL RESULT: ${String(result).slice(0, 100)}`);

      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      toolResults.push({ name, result: resultStr });
      addMessage({ role: 'tool', content: resultStr });
    }

    // Re-query so model generates a natural language response after tool results
    const response = await queryOllama(null, { onToolCall, signal });

    // If model just says "Done." or similar terse reply, include the actual tool output
    if (!response || response === 'Done.' || response.length < 10) {
      const summary = toolResults.map(t => `[${t.name}]: ${t.result}`).join('\n');
      return summary;
    }
    return response;
  }

  const text = stripThinking(msg?.content || 'Done.');
  addMessage({ role: 'assistant', content: text });
  return text;
}

/**
 * Query via OpenAI-compatible API (for cloud providers).
 */
async function queryCloud(userMessage, { onPartial, onToolCall, signal } = {}) {
  if (userMessage) addMessage({ role: 'user', content: userMessage });

  const provider = assistantConfig.getProvider();
  const model = assistantConfig.getModel();
  const apiKey = secureStore.getApiKey(provider);

  const endpoints = {
    openai: { url: 'https://api.openai.com/v1/chat/completions', model: model || 'gpt-4o-mini' },
    anthropic: { url: 'https://openrouter.ai/api/v1/chat/completions', model: `anthropic/${model || 'claude-sonnet-4-6'}` },
    groq: { url: 'https://api.groq.com/openai/v1/chat/completions', model: model || 'llama-3.3-70b-versatile' },
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', model: model || 'openai/gpt-4o-mini' },
    deepseek: { url: 'https://api.deepseek.com/v1/chat/completions', model: model || 'deepseek-chat' },
    huggingface: { url: 'https://api-inference.huggingface.co/v1/chat/completions', model: model || 'Qwen/Qwen3-4B' },
  };
  const ep = endpoints[provider] || endpoints.openrouter;
  const key = apiKey || secureStore.getApiKey('openrouter');

  if (!key) {
    const msg = `No API key for ${provider}. Add one in Settings.`;
    addMessage({ role: 'assistant', content: msg });
    return msg;
  }

  const useTools = onToolCall && modelSupportsTools(ep.model);
  const body = {
    model: ep.model,
    messages: conversationMessages,
    tools: useTools ? OLLAMA_TOOLS : undefined,
    stream: false,
    max_tokens: 500,
  };

  const res = await fetch(ep.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`API error (${res.status}): ${err.slice(0, 150)}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];

  if (choice?.message?.tool_calls?.length && onToolCall) {
    addMessage(choice.message);
    for (const tc of choice.message.tool_calls) {
      const result = await onToolCall(tc.function.name, JSON.parse(tc.function.arguments || '{}'));
      addMessage({ role: 'tool', tool_call_id: tc.id, content: typeof result === 'string' ? result : JSON.stringify(result) });
    }
    return queryCloud(null, { onPartial, onToolCall, signal });
  }

  const text = stripThinking(choice?.message?.content || 'Done.');
  addMessage({ role: 'assistant', content: text });
  if (onPartial) onPartial(text);
  return text;
}

/**
 * Main query entry point — routes to Ollama or cloud.
 */
async function query(userMessage, { onPartial, onToolCall, signal } = {}) {
  if (isLocalProvider()) {
    return queryOllama(userMessage, { onToolCall, signal });
  }
  return queryCloud(userMessage, { onPartial, onToolCall, signal });
}

async function testConnection() {
  try {
    if (isLocalProvider()) {
      const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(5000) });
      return { ok: res.ok };
    }
    return { ok: false, error: 'Use Test button for cloud providers' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { query, clearHistory, testConnection };
