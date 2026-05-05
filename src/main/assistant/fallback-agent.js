/**
 * Fallback agent — lightweight OpenAI-compatible chat client.
 * Used when ZeroClaw binary is unavailable or crashes.
 * Supports: Ollama (local), OpenAI, Anthropic-via-OpenAI-compat, any OpenAI-compatible endpoint.
 *
 * ~200 lines, no external dependencies beyond Node.js fetch.
 */
const assistantConfig = require('./config');
const secureStore = require('./secure-store');

const SYSTEM_PROMPT = `You are a helpful voice assistant running locally on the user's Mac.
You respond concisely — keep answers under 2-3 sentences unless asked for detail.
You have access to tools for controlling the computer. Use them when the user asks.
Respond naturally as if speaking — avoid markdown, bullet points, or formatted text.
Never mention that you are an AI unless directly asked.
/no_think`;

// Built-in tool definitions for basic actions
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'open_app',
      description: 'Launch or activate a macOS application by name',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'Application name' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_url',
      description: 'Open a URL in the default browser',
      parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL to open' } }, required: ['url'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_time',
      description: 'Get the current date and time',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the web for something',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_volume',
      description: 'Set the system volume (0-100)',
      parameters: { type: 'object', properties: { level: { type: 'number', description: 'Volume level 0-100' } }, required: ['level'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: 'Type text into the active application',
      parameters: { type: 'object', properties: { text: { type: 'string', description: 'Text to type' } }, required: ['text'] },
    },
  },
];

/**
 * Map grammar model keys or generic names to Ollama model names.
 * Grammar registry uses keys like 'gemma-3-4b', Ollama uses 'gemma3:4b'.
 */
function toOllamaModel(model) {
  if (!model) return null;
  // Already an Ollama-style name (contains colon)
  if (model.includes(':')) return model;
  // Map known grammar model keys to Ollama names
  const MAP = {
    'gemma-3-4b': 'gemma3:latest',
    'gemma-3-1b': 'gemma3:1b',
    'qwen3-0.6b': 'qwen3:0.6b',
    'qwen2.5-0.5b': 'qwen3:0.6b',
    'qwen3-4b': 'qwen3:4b',
  };
  return MAP[model] || model;
}

/**
 * Resolve the API endpoint for the configured provider.
 */
function resolveEndpoint() {
  const provider = assistantConfig.getProvider();
  const model = assistantConfig.getModel();

  switch (provider) {
    case 'ollama':
    case 'llamacpp':
      // Both local providers route through Ollama's OpenAI-compatible API
      // llamacpp grammar model keys (gemma-3-4b, qwen3-0.6b) need to be
      // mapped to Ollama model names (gemma3:4b, qwen3:0.6b)
      return { url: 'http://localhost:11434/v1/chat/completions', model: toOllamaModel(model) || 'qwen3:4b', apiKey: 'ollama' };
    case 'openai':
      return { url: 'https://api.openai.com/v1/chat/completions', model: model || 'gpt-4o-mini', apiKey: secureStore.getApiKey('openai') };
    case 'anthropic':
      return { url: 'https://openrouter.ai/api/v1/chat/completions', model: `anthropic/${model || 'claude-sonnet-4-6'}`, apiKey: secureStore.getApiKey('openrouter') || secureStore.getApiKey('anthropic') };
    case 'groq':
      return { url: 'https://api.groq.com/openai/v1/chat/completions', model: model || 'llama-3.3-70b-versatile', apiKey: secureStore.getApiKey('groq') };
    case 'openrouter':
      return { url: 'https://openrouter.ai/api/v1/chat/completions', model: model || 'openai/gpt-4o-mini', apiKey: secureStore.getApiKey('openrouter') };
    case 'deepseek':
      return { url: 'https://api.deepseek.com/v1/chat/completions', model: model || 'deepseek-chat', apiKey: secureStore.getApiKey('deepseek') };
    case 'huggingface':
      return { url: 'https://api-inference.huggingface.co/v1/chat/completions', model: model || 'Qwen/Qwen3-4B', apiKey: secureStore.getApiKey('huggingface') };
    default:
      return { url: 'http://localhost:11434/v1/chat/completions', model: toOllamaModel(model) || 'qwen3:4b', apiKey: 'ollama' };
  }
}

/** Strip <think>...</think> reasoning blocks from qwen3 output */
function stripThinking(text) {
  if (!text) return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, '')
    .trim();
}

// Conversation history (kept in memory, capped)
let messages = [{ role: 'system', content: SYSTEM_PROMPT }];
const MAX_MESSAGES = 20;

function addMessage(role, content) {
  messages.push({ role, content });
  // Keep last N messages + system prompt
  if (messages.length > MAX_MESSAGES + 1) {
    messages = [messages[0], ...messages.slice(-(MAX_MESSAGES))];
  }
}

function clearHistory() {
  messages = [{ role: 'system', content: SYSTEM_PROMPT }];
}

/**
 * Send a query to the configured LLM and get a response.
 * Supports streaming via onPartial callback.
 *
 * @param {string} userMessage - The user's transcribed speech
 * @param {object} opts
 * @param {function} [opts.onPartial] - (text) => void — called with each chunk
 * @param {function} [opts.onToolCall] - (name, params) => Promise<string> — tool executor
 * @param {AbortSignal} [opts.signal] - AbortController signal
 * @returns {Promise<string>} Full response text
 */
async function query(userMessage, { onPartial, onToolCall, signal } = {}) {
  addMessage('user', userMessage);

  const endpoint = resolveEndpoint();
  if (!endpoint.apiKey) {
    const msg = `No API key configured for ${assistantConfig.getProvider()}. Please add one in Settings.`;
    addMessage('assistant', msg);
    return msg;
  }

  // Not all models support tool calling (e.g. gemma3 doesn't).
  // Only include tools for models known to support them.
  const TOOL_CAPABLE = ['qwen', 'gpt', 'claude', 'llama', 'mistral', 'deepseek', 'command'];
  const modelLower = (endpoint.model || '').toLowerCase();
  const supportsTools = onToolCall && TOOL_CAPABLE.some(t => modelLower.includes(t));

  const body = {
    model: endpoint.model,
    messages: messages,
    tools: supportsTools ? TOOLS : undefined,
    stream: !!onPartial,
    max_tokens: 300,
    temperature: 0.7,
  };

  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${endpoint.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const msg = `API error (${response.status}): ${errText.slice(0, 100)}`;
    addMessage('assistant', msg);
    throw new Error(msg);
  }

  if (onPartial && response.body) {
    // Streaming response
    let fullText = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;

          if (delta?.tool_calls && onToolCall) {
            // Handle tool call in streaming mode
            const tc = delta.tool_calls[0];
            if (tc?.function?.name) {
              const result = await onToolCall(tc.function.name, JSON.parse(tc.function.arguments || '{}'));
              addMessage('tool', result);
              // Re-query with tool result
              return query('', { onPartial, onToolCall, signal });
            }
          }

          if (delta?.content) {
            fullText += delta.content;
            onPartial(delta.content);
          }
        } catch {}
      }
    }

    fullText = stripThinking(fullText);
    addMessage('assistant', fullText);
    return fullText;
  } else {
    // Non-streaming response
    const data = await response.json();
    const choice = data.choices?.[0];

    if (choice?.message?.tool_calls && onToolCall) {
      const tc = choice.message.tool_calls[0];
      const result = await onToolCall(tc.function.name, JSON.parse(tc.function.arguments || '{}'));
      addMessage('assistant', choice.message.content || '');
      addMessage('tool', result);
      return query('', { onPartial, onToolCall, signal });
    }

    let text = choice?.message?.content || 'I could not generate a response.';
    text = stripThinking(text);
    addMessage('assistant', text);
    return text;
  }
}

/**
 * Test if the configured provider is reachable.
 */
async function testConnection() {
  const endpoint = resolveEndpoint();
  if (!endpoint.apiKey) return { ok: false, error: 'No API key' };

  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${endpoint.apiKey}` },
      body: JSON.stringify({ model: endpoint.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(10000),
    });
    return { ok: response.ok, status: response.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { query, clearHistory, testConnection, resolveEndpoint };
