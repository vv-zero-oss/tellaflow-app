const config = require('./config');

function applyDictionary(text) {
  const entries = config.getDictionary();
  if (!entries || entries.length === 0) return text;

  for (const { from, to } of entries) {
    if (!from) continue;
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    text = text.replace(regex, to);
  }
  return text;
}

module.exports = { applyDictionary };
