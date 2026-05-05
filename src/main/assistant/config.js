/**
 * Assistant-specific configuration.
 * Extends the existing config module with assistant settings.
 * All keys use 'assistant' prefix to avoid namespace collision.
 */
const config = require('../config');

const DEFAULTS = {
  assistantEnabled: false,
  assistantProvider: 'ollama',            // 'ollama' | 'llamacpp' | 'openai' | 'anthropic' | 'google' | 'deepseek' | 'groq' | 'openrouter' | 'huggingface' | 'xai' | 'mistral'
  assistantModel: 'qwen3:4b',           // Ollama model name or cloud model ID
  assistantHotkey: { names: ['RIGHT ALT'], label: '⌥ Right' },
  assistantVoice: 'alba',               // Kokoro voice name
  assistantAutoUnload: true,            // Unload grammar model when assistant active (8GB machines)
  assistantStreamTTS: true,             // Stream TTS sentence-by-sentence
  assistantMaxContext: 4096,            // Max context tokens before compaction
  assistantIdleTimeout: 300000,         // 5 minutes before unloading sidecars
};

function get(key) {
  const val = config.getSetting(`assistant_${key}`);
  if (val === undefined || val === null) return DEFAULTS[key] ?? null;
  return val;
}

function set(key, value) {
  config.setSetting(`assistant_${key}`, value);
}

// Convenience getters
function isEnabled() { return get('assistantEnabled'); }
function getProvider() { return get('assistantProvider'); }
function getModel() { return get('assistantModel'); }
function getHotkey() { return get('assistantHotkey'); }
function getVoice() { return get('assistantVoice'); }
function shouldAutoUnload() { return get('assistantAutoUnload'); }
function getIdleTimeout() { return get('assistantIdleTimeout'); }

// Convenience setters
function setEnabled(v) { set('assistantEnabled', v); }
function setProvider(v) { set('assistantProvider', v); }
function setModel(v) { set('assistantModel', v); }
function setHotkey(v) { set('assistantHotkey', v); }
function setVoice(v) { set('assistantVoice', v); }
function setAutoUnload(v) { set('assistantAutoUnload', v); }

function getAll() {
  const result = {};
  for (const key of Object.keys(DEFAULTS)) {
    result[key] = get(key);
  }
  return result;
}

module.exports = {
  get, set, getAll, DEFAULTS,
  isEnabled, getProvider, getModel, getHotkey, getVoice, shouldAutoUnload, getIdleTimeout,
  setEnabled, setProvider, setModel, setHotkey, setVoice, setAutoUnload,
};
