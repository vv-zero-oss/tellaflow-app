const path = require('path');
const fs = require('fs');

let cached = null;

function loadPacksRaw() {
  if (cached) return cached;
  const jsonPath = path.join(__dirname, 'data', 'dictionary-packs.json');
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (!Array.isArray(raw.packs)) {
    throw new Error('dictionary-packs.json must contain a "packs" array');
  }
  cached = raw.packs;
  return cached;
}

function getDictionaryPacksManifest() {
  return loadPacksRaw().map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description || '',
    category: p.category || 'General',
    entryCount: Array.isArray(p.entries) ? p.entries.length : 0,
    entries: Array.isArray(p.entries) ? p.entries : [],
  }));
}

function getPackById(packId) {
  return loadPacksRaw().find((p) => p.id === packId) || null;
}

module.exports = { loadPacksRaw, getDictionaryPacksManifest, getPackById };
