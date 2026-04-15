const path = require('path');
const fs = require('fs');

let db = null;

const DEFAULTS = {
  hotkey: { names: ['LEFT ALT'], label: 'Left Option (⌥)' },
  model: 'small',
  grammarEnabled: false,
  onboardingComplete: false,
  accessibilityGrantedOnce: false,
};

function getDb() {
  if (db) return db;

  const { app } = require('electron');
  const Database = require('better-sqlite3');
  const dbPath = path.join(app.getPath('userData'), 'tellaflow.db');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS history (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      text      TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dictionary (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      from_word TEXT NOT NULL,
      to_word   TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snippets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger    TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);

  try {
    db.exec(`ALTER TABLE history ADD COLUMN audio_path TEXT`);
  } catch (err) {
    // SQLite throws "duplicate column name" when the column already exists —
    // that's expected after the first run. Re-throw anything else.
    if (!err.message?.includes('duplicate column name')) throw err;
  }

  migrateFromJson(app.getPath('userData'));
  seedDefaults();

  return db;
}

function seedDefaults() {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM settings').get();
  if (row.cnt > 0) return;

  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const seed = db.transaction(() => {
    for (const [key, val] of Object.entries(DEFAULTS)) {
      insert.run(key, JSON.stringify(val));
    }
  });
  seed();
}

function migrateFromJson(userDataPath) {
  const configPath = path.join(userDataPath, 'tellaflow-config.json');
  const historyPath = path.join(userDataPath, 'tellaflow-history.json');

  const settingsCount = db.prepare('SELECT COUNT(*) as cnt FROM settings').get().cnt;
  const historyCount = db.prepare('SELECT COUNT(*) as cnt FROM history').get().cnt;

  if (settingsCount === 0 && fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log('Migrating settings from JSON to SQLite...');

      const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      const insertDict = db.prepare('INSERT INTO dictionary (from_word, to_word) VALUES (?, ?)');

      const migrate = db.transaction(() => {
        for (const [key, val] of Object.entries(raw)) {
          if (key === 'dictionary') continue;
          insert.run(key, JSON.stringify(val));
        }
        if (Array.isArray(raw.dictionary)) {
          for (const entry of raw.dictionary) {
            if (entry.from) {
              insertDict.run(entry.from, entry.to || '');
            }
          }
        }
      });
      migrate();

      fs.renameSync(configPath, configPath + '.bak');
      console.log('Settings migration complete.');
    } catch (err) {
      console.error('Failed to migrate config JSON:', err.message);
    }
  }

  if (historyCount === 0 && fs.existsSync(historyPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      if (Array.isArray(raw.entries) && raw.entries.length > 0) {
        console.log('Migrating history from JSON to SQLite...');

        const insert = db.prepare('INSERT INTO history (text, timestamp) VALUES (?, ?)');
        const migrate = db.transaction(() => {
          for (const entry of raw.entries) {
            insert.run(entry.text, entry.timestamp);
          }
        });
        migrate();

        fs.renameSync(historyPath, historyPath + '.bak');
        console.log('History migration complete.');
      }
    } catch (err) {
      console.error('Failed to migrate history JSON:', err.message);
    }
  }
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
