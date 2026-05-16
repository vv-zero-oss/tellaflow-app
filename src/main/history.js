const fs = require('fs');
const { getDb } = require('./db');

const MAX_ENTRIES = 1000;

function addEntry(text, audioPath = null) {
  const db = getDb();
  db.prepare('INSERT INTO history (text, timestamp, audio_path) VALUES (?, ?, ?)').run(text, Date.now(), audioPath);

  // SQLite allows LIMIT -1 OFFSET N to mean "all rows after the first N". Combined
  // with DESC ordering and RETURNING, this trims overflow + returns the deleted
  // audio paths for unlink in a single statement (saves a SELECT vs the prior impl).
  const removed = db.prepare(`
    DELETE FROM history
    WHERE id IN (
      SELECT id FROM history ORDER BY timestamp DESC LIMIT -1 OFFSET ?
    )
    RETURNING audio_path
  `).all(MAX_ENTRIES);

  for (const row of removed) {
    if (row.audio_path) {
      fs.promises.unlink(row.audio_path).catch(() => { /* already gone */ });
    }
  }
}

function getEntries() {
  return getDb()
    .prepare('SELECT id, text, timestamp, audio_path as audioPath FROM history ORDER BY timestamp DESC LIMIT ?')
    .all(MAX_ENTRIES);
}

function deleteEntry(id) {
  const db = getDb();
  const row = db.prepare('SELECT audio_path FROM history WHERE id = ?').get(id);
  if (row && row.audio_path) {
    try { fs.unlinkSync(row.audio_path); } catch { /* already gone */ }
  }
  db.prepare('DELETE FROM history WHERE id = ?').run(id);
}

function clearHistory() {
  const db = getDb();
  const rows = db.prepare('SELECT audio_path FROM history WHERE audio_path IS NOT NULL').all();
  for (const row of rows) {
    try { fs.unlinkSync(row.audio_path); } catch { /* already gone */ }
  }
  db.prepare('DELETE FROM history').run();
}

function getEntryById(id) {
  return getDb()
    .prepare('SELECT id, text, timestamp, audio_path as audioPath FROM history WHERE id = ?')
    .get(id);
}

function updateEntryText(id, text) {
  getDb().prepare('UPDATE history SET text = ? WHERE id = ?').run(text, id);
}

module.exports = { addEntry, getEntries, getEntryById, updateEntryText, deleteEntry, clearHistory };
