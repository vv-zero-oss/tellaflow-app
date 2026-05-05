/**
 * Secure API key storage using Electron's safeStorage (backed by macOS Keychain).
 * Keys are encrypted at rest in the SQLite config and decrypted at runtime.
 */
let safeStorage;
try { ({ safeStorage } = require('electron')); } catch {}
const config = require('../config');

const KEY_PREFIX = 'apiKey_';

/**
 * Store an API key securely (encrypted via macOS Keychain).
 * @param {string} provider - Provider name (e.g. 'openai', 'anthropic')
 * @param {string} key - The API key to store
 */
function setApiKey(provider, key) {
  if (!key || !key.trim()) {
    // Remove key if empty
    config.setSetting(`${KEY_PREFIX}${provider}`, null);
    return;
  }

  if (safeStorage?.isEncryptionAvailable?.()) {
    const encrypted = safeStorage.encryptString(key).toString('base64');
    config.setSetting(`${KEY_PREFIX}${provider}`, encrypted);
  } else {
    // Fallback: store plain (dev mode or if Keychain unavailable)
    config.setSetting(`${KEY_PREFIX}${provider}`, `plain:${key}`);
  }
}

/**
 * Retrieve a decrypted API key.
 * @param {string} provider - Provider name
 * @returns {string|null}
 */
function getApiKey(provider) {
  const stored = config.getSetting(`${KEY_PREFIX}${provider}`);
  if (!stored) return null;

  if (stored.startsWith('plain:')) {
    return stored.slice(6);
  }

  if (safeStorage?.isEncryptionAvailable?.()) {
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Check if an API key exists for a provider.
 * @param {string} provider
 * @returns {boolean}
 */
function hasApiKey(provider) {
  return !!config.getSetting(`${KEY_PREFIX}${provider}`);
}

/**
 * Remove an API key.
 * @param {string} provider
 */
function removeApiKey(provider) {
  config.setSetting(`${KEY_PREFIX}${provider}`, null);
}

/**
 * List providers that have API keys stored.
 * @returns {string[]}
 */
function getStoredProviders() {
  // Note: this requires a way to query keys with prefix from config
  // For now, check known providers
  const providers = ['openai', 'anthropic', 'google', 'deepseek', 'groq', 'openrouter', 'huggingface', 'xai', 'mistral'];
  return providers.filter(p => hasApiKey(p));
}

module.exports = { setApiKey, getApiKey, hasApiKey, removeApiKey, getStoredProviders };
