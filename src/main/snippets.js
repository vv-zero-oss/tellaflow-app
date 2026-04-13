const { getDb } = require('./db');

function getSnippets() {
  return getDb()
    .prepare('SELECT id, trigger, content, created_at FROM snippets ORDER BY id')
    .all()
    .map((r) => ({ id: r.id, trigger: r.trigger, content: r.content }));
}

function addSnippet(trigger, content) {
  getDb()
    .prepare('INSERT INTO snippets (trigger, content) VALUES (?, ?)')
    .run(trigger, content);
  return getSnippets();
}

function removeSnippet(id) {
  getDb().prepare('DELETE FROM snippets WHERE id = ?').run(id);
  return getSnippets();
}

function updateSnippet(id, trigger, content) {
  getDb()
    .prepare('UPDATE snippets SET trigger = ?, content = ? WHERE id = ?')
    .run(trigger, content, id);
  return getSnippets();
}

function clearSnippets() {
  getDb().prepare('DELETE FROM snippets').run();
  return getSnippets();
}

function applySnippets(text) {
  const snippets = getSnippets();
  if (!snippets || snippets.length === 0) return text;

  for (const { trigger, content } of snippets) {
    if (!trigger) continue;
    const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    text = text.replace(regex, content);
  }
  return text;
}

module.exports = { getSnippets, addSnippet, removeSnippet, updateSnippet, clearSnippets, applySnippets };
