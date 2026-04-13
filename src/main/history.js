const fs = require('fs');
const { getDb } = require('./db');

const MAX_ENTRIES = 1000;

function addEntry(text, audioPath = null) {
  const db = getDb();
  db.prepare('INSERT INTO history (text, timestamp, audio_path) VALUES (?, ?, ?)').run(text, Date.now(), audioPath);

  const rows = db.prepare(`
    SELECT id, audio_path FROM history ORDER BY timestamp ASC LIMIT ?
  `).all(Math.max(0, db.prepare('SELECT COUNT(*) as cnt FROM history').get().cnt - MAX_ENTRIES));

  if (rows.length > 0) {
    for (const row of rows) {
      if (row.audio_path) {
        try { fs.unlinkSync(row.audio_path); } catch { /* already gone */ }
      }
    }
    const ids = rows.map(r => r.id);
    db.prepare(`DELETE FROM history WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
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

module.exports = { addEntry, getEntries, deleteEntry, clearHistory };
