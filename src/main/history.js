const fs = require('fs');
const { getDb } = require('./db');

const MAX_ENTRIES = 1000;
const COLUMNS = "id, text, timestamp, audio_path as audioPath, COALESCE(kind, 'dictation') as kind";

/** Inserts an entry and returns its id. */
function addEntry(text, audioPath = null, { kind = 'dictation', timestamp = Date.now() } = {}) {
  const db = getDb();
  const info = db.prepare('INSERT INTO history (text, timestamp, audio_path, kind) VALUES (?, ?, ?, ?)').run(text, timestamp, audioPath, kind);

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
  return Number(info.lastInsertRowid);
}

function getEntries() {
  return getDb()
    .prepare(`SELECT ${COLUMNS} FROM history ORDER BY timestamp DESC LIMIT ?`)
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
    .prepare(`SELECT ${COLUMNS} FROM history WHERE id = ?`)
    .get(id);
}

function updateEntryText(id, text) {
  getDb().prepare('UPDATE history SET text = ? WHERE id = ?').run(text, id);
}

function setEntryAudioPath(id, audioPath) {
  getDb().prepare('UPDATE history SET audio_path = ? WHERE id = ?').run(audioPath, id);
}

/** Every audio file history still references (for orphan detection). */
function getAllAudioPaths() {
  return new Set(
    getDb().prepare('SELECT audio_path FROM history WHERE audio_path IS NOT NULL').all().map((r) => r.audio_path),
  );
}

/**
 * Deletes audio for entries older than `cutoffMs` (the transcript is kept).
 * Returns the number of files removed.
 */
function pruneAudioOlderThan(cutoffMs) {
  const db = getDb();
  const rows = db.prepare('SELECT id, audio_path FROM history WHERE audio_path IS NOT NULL AND timestamp < ?').all(cutoffMs);
  const clear = db.prepare('UPDATE history SET audio_path = NULL WHERE id = ?');
  for (const row of rows) {
    try { fs.unlinkSync(row.audio_path); } catch { /* already gone */ }
    clear.run(row.id);
  }
  return rows.length;
}

/** Legacy '[Transcription failed]' rows from before the job journal existed. */
const LEGACY_FAILED_TEXT = '[Transcription failed]';
function takeLegacyFailedEntries() {
  const db = getDb();
  const rows = db.prepare(`SELECT ${COLUMNS} FROM history WHERE text = ?`).all(LEGACY_FAILED_TEXT);
  const del = db.prepare('DELETE FROM history WHERE id = ?');
  for (const r of rows) del.run(r.id);
  return rows;
}

module.exports = {
  addEntry,
  getEntries,
  getEntryById,
  updateEntryText,
  setEntryAudioPath,
  deleteEntry,
  clearHistory,
  getAllAudioPaths,
  pruneAudioOlderThan,
  takeLegacyFailedEntries,
};
