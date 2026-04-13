import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, injectTestDb } from './db-helpers.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function loadFresh(modulePath) {
  // Remove from require cache so each test gets a fresh module instance
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

// ─── Dictionary ────────────────────────────────────────────────────────────────

describe('clearDictionary', () => {
  let config;

  beforeEach(() => {
    const db = createTestDb();
    injectTestDb(db);
    config = loadFresh('../../src/main/config.js');
  });

  it('returns empty array when dictionary is already empty', () => {
    const result = config.clearDictionary();
    expect(result).toEqual([]);
  });

  it('removes all dictionary entries', () => {
    config.addDictionaryEntry('colour', 'color');
    config.addDictionaryEntry('favour', 'favor');
    expect(config.getDictionary()).toHaveLength(2);

    const result = config.clearDictionary();
    expect(result).toEqual([]);
  });

  it('getDictionary returns empty after clear', () => {
    config.addDictionaryEntry('foo', 'bar');
    config.clearDictionary();
    expect(config.getDictionary()).toEqual([]);
  });

  it('can add entries again after clearing', () => {
    config.addDictionaryEntry('a', 'b');
    config.clearDictionary();
    config.addDictionaryEntry('c', 'd');
    const entries = config.getDictionary();
    expect(entries).toHaveLength(1);
    expect(entries[0].from).toBe('c');
    expect(entries[0].to).toBe('d');
  });

  it('does not affect other tables', () => {
    const db = createTestDb();
    injectTestDb(db);
    config = loadFresh('../../src/main/config.js');

    // Insert a settings row directly (must match the INSERT OR REPLACE pattern used by the mock)
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('theme', '"dark"');

    config.addDictionaryEntry('x', 'y');
    config.clearDictionary();

    const settingsCount = db.prepare('SELECT COUNT(*) as cnt FROM settings').get().cnt;
    expect(settingsCount).toBe(1);
  });
});

// ─── Snippets ─────────────────────────────────────────────────────────────────

describe('clearSnippets', () => {
  let snippets;

  beforeEach(() => {
    const db = createTestDb();
    injectTestDb(db);
    snippets = loadFresh('../../src/main/snippets.js');
  });

  it('returns empty array when snippets is already empty', () => {
    const result = snippets.clearSnippets();
    expect(result).toEqual([]);
  });

  it('removes all snippets', () => {
    snippets.addSnippet('brb', 'be right back');
    snippets.addSnippet('omw', 'on my way');
    expect(snippets.getSnippets()).toHaveLength(2);

    const result = snippets.clearSnippets();
    expect(result).toEqual([]);
  });

  it('getSnippets returns empty after clear', () => {
    snippets.addSnippet('ty', 'thank you');
    snippets.clearSnippets();
    expect(snippets.getSnippets()).toEqual([]);
  });

  it('can add snippets again after clearing', () => {
    snippets.addSnippet('a', 'alpha');
    snippets.clearSnippets();
    snippets.addSnippet('b', 'beta');
    const entries = snippets.getSnippets();
    expect(entries).toHaveLength(1);
    expect(entries[0].trigger).toBe('b');
    expect(entries[0].content).toBe('beta');
  });
});

// ─── Isolation: dictionary clear does not touch snippets and vice versa ────────

describe('reset isolation', () => {
  let config;
  let snippets;

  beforeEach(() => {
    const db = createTestDb();
    injectTestDb(db);
    config = loadFresh('../../src/main/config.js');
    snippets = loadFresh('../../src/main/snippets.js');
  });

  it('clearDictionary leaves snippets intact', () => {
    config.addDictionaryEntry('colour', 'color');
    snippets.addSnippet('ty', 'thank you');

    config.clearDictionary();

    expect(config.getDictionary()).toEqual([]);
    expect(snippets.getSnippets()).toHaveLength(1);
  });

  it('clearSnippets leaves dictionary intact', () => {
    config.addDictionaryEntry('colour', 'color');
    snippets.addSnippet('ty', 'thank you');

    snippets.clearSnippets();

    expect(snippets.getSnippets()).toEqual([]);
    expect(config.getDictionary()).toHaveLength(1);
  });
});
