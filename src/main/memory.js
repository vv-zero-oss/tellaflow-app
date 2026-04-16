const { getDb } = require('./db');

// ─── Read ──────────────────────────────────────────────────────────────────────

function getAllFacts() {
  return getDb()
    .prepare('SELECT key, value, category, updated_at FROM agent_memory ORDER BY updated_at DESC')
    .all();
}

function getFact(key) {
  const row = getDb()
    .prepare('SELECT value FROM agent_memory WHERE key = ?')
    .get(key);
  return row ? row.value : null;
}

function getRecentHistory(limit = 5) {
  return getDb()
    .prepare('SELECT transcript, actions, timestamp FROM agent_history ORDER BY timestamp DESC LIMIT ?')
    .all(limit);
}

/**
 * Build a compact context string to prepend to the agent system prompt.
 * Keeps token cost low — only facts + last 3 action summaries.
 */
function buildContext() {
  const facts = getAllFacts();
  const history = getRecentHistory(3);

  const lines = [];

  if (facts.length > 0) {
    lines.push('## What I know about the user');
    for (const f of facts) {
      lines.push(`- ${f.key}: ${f.value}`);
    }
  }

  if (history.length > 0) {
    lines.push('## Recent commands');
    for (const h of history) {
      let actions;
      try { actions = JSON.parse(h.actions); } catch { actions = []; }
      const summary = actions.map(a => a.tool).join(' → ') || 'no actions';
      lines.push(`- "${h.transcript}" → ${summary}`);
    }
  }

  return lines.join('\n');
}

// ─── Write ─────────────────────────────────────────────────────────────────────

function setFact(key, value, category = 'fact') {
  getDb()
    .prepare(`
      INSERT INTO agent_memory (key, value, category, updated_at)
      VALUES (?, ?, ?, strftime('%s','now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value,
        category = excluded.category,
        updated_at = excluded.updated_at
    `)
    .run(key.toLowerCase().trim(), value, category);
}

function deleteFact(key) {
  getDb()
    .prepare('DELETE FROM agent_memory WHERE key = ?')
    .run(key.toLowerCase().trim());
}

function clearAllFacts() {
  getDb().prepare('DELETE FROM agent_memory').run();
}

function addHistoryEntry(transcript, actions = [], success = true) {
  getDb()
    .prepare('INSERT INTO agent_history (transcript, actions, success) VALUES (?, ?, ?)')
    .run(transcript, JSON.stringify(actions), success ? 1 : 0);
}

function clearHistory() {
  getDb().prepare('DELETE FROM agent_history').run();
}

module.exports = {
  getAllFacts,
  getFact,
  getRecentHistory,
  buildContext,
  setFact,
  deleteFact,
  clearAllFacts,
  addHistoryEntry,
  clearHistory,
};
