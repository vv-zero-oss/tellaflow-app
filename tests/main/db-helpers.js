/**
 * Pure-JS in-memory DB mock that mimics the better-sqlite3 synchronous API
 * (prepare().run() / prepare().all() / prepare().get()) used by config.js and snippets.js.
 *
 * We avoid loading the actual better-sqlite3 binary because it is compiled for
 * Electron's Node.js ABI and won't load under system Node.js used by Vitest.
 */

let nextId = 1;

function createTestDb() {
  const tables = {
    settings: [],    // { key, value }
    dictionary: [],  // { id, from_word, to_word }
    snippets: [],    // { id, trigger, content }
    history: [],     // { id, text, timestamp }
  };

  /**
   * Minimal SQL interpreter for the patterns used by config.js and snippets.js.
   * Supports:
   *   SELECT … FROM table [WHERE col = ?] [ORDER BY …]
   *   INSERT INTO table (cols) VALUES (?)
   *   INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
   *   DELETE FROM table [WHERE id = ?]
   *   UPDATE table SET col = ?, … WHERE id = ?
   */
  function prepare(sql) {
    const s = sql.trim().replace(/\s+/g, ' ');

    return {
      run(...args) {
        // DELETE FROM table
        if (/^DELETE FROM (\w+)$/i.test(s)) {
          const table = s.match(/^DELETE FROM (\w+)$/i)[1].toLowerCase();
          tables[table] = [];
          return;
        }
        // DELETE FROM table WHERE id = ?
        if (/^DELETE FROM (\w+) WHERE id = \?$/i.test(s)) {
          const table = s.match(/^DELETE FROM (\w+)/i)[1].toLowerCase();
          const id = Number(args[0]);
          tables[table] = tables[table].filter((r) => r.id !== id);
          return;
        }
        // DELETE FROM dictionary WHERE id = ?  (already covered above)
        // INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
        if (/^INSERT OR REPLACE INTO settings/i.test(s)) {
          const [key, value] = args;
          const idx = tables.settings.findIndex((r) => r.key === key);
          if (idx >= 0) tables.settings[idx].value = value;
          else tables.settings.push({ key, value });
          return;
        }
        // INSERT INTO dictionary (from_word, to_word) VALUES (?, ?)
        if (/^INSERT INTO dictionary/i.test(s)) {
          const [from_word, to_word] = args;
          tables.dictionary.push({ id: nextId++, from_word, to_word });
          return;
        }
        // INSERT INTO snippets (trigger, content) VALUES (?, ?)
        if (/^INSERT INTO snippets/i.test(s)) {
          const [trigger, content] = args;
          tables.snippets.push({ id: nextId++, trigger, content });
          return;
        }
        // UPDATE dictionary SET from_word = ?, to_word = ? WHERE id = ?
        if (/^UPDATE dictionary/i.test(s)) {
          const [from_word, to_word, id] = args;
          const row = tables.dictionary.find((r) => r.id === Number(id));
          if (row) { row.from_word = from_word; row.to_word = to_word; }
          return;
        }
        // UPDATE snippets SET trigger = ?, content = ? WHERE id = ?
        if (/^UPDATE snippets/i.test(s)) {
          const [trigger, content, id] = args;
          const row = tables.snippets.find((r) => r.id === Number(id));
          if (row) { row.trigger = trigger; row.content = content; }
          return;
        }
        // INSERT OR IGNORE INTO settings …  (seedDefaults guard — just ignore)
        if (/^INSERT OR IGNORE INTO settings/i.test(s)) {
          const [key, value] = args;
          if (!tables.settings.find((r) => r.key === key)) {
            tables.settings.push({ key, value });
          }
          return;
        }
      },

      all(...args) {
        // SELECT id, from_word, to_word FROM dictionary ORDER BY id
        if (/FROM dictionary/i.test(s)) {
          return [...tables.dictionary].sort((a, b) => a.id - b.id);
        }
        // SELECT id, trigger, content, created_at FROM snippets ORDER BY id
        if (/FROM snippets/i.test(s)) {
          return [...tables.snippets].sort((a, b) => a.id - b.id);
        }
        return [];
      },

      get(...args) {
        // SELECT COUNT(*) as cnt FROM settings
        if (/COUNT\(\*\) as cnt FROM settings/i.test(s)) {
          return { cnt: tables.settings.length };
        }
        // SELECT value FROM settings WHERE key = ?
        if (/SELECT value FROM settings WHERE key = \?/i.test(s)) {
          const row = tables.settings.find((r) => r.key === args[0]);
          return row ? { value: row.value } : undefined;
        }
        return undefined;
      },
    };
  }

  return {
    prepare,
    pragma: () => {},
    exec: () => {},
    transaction: (fn) => fn,  // execute immediately, no real transaction
    // expose tables for inspection in tests
    _tables: tables,
  };
}

/**
 * Injects a fake DB into the module cache so config.js / snippets.js use it.
 */
function injectTestDb(db) {
  const dbModulePath = require.resolve('../../src/main/db');
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: {
      getDb: () => db,
      closeDb: () => {},
    },
  };
}

module.exports = { createTestDb, injectTestDb };
