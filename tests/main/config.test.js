import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, injectTestDb } from './db-helpers.js';

function loadFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

function freshConfig() {
  const db = createTestDb();
  injectTestDb(db);
  return { config: loadFresh('../../src/main/config.js'), db };
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

describe('config defaults', () => {
  it('getModel returns "small" by default', () => {
    const { config } = freshConfig();
    expect(config.getModel()).toBe('small');
  });

  it('getProgrammingMode returns false by default', () => {
    const { config } = freshConfig();
    expect(config.getProgrammingMode()).toBe(false);
  });

  it('getGrammarEnabled returns false by default', () => {
    const { config } = freshConfig();
    expect(config.getGrammarEnabled()).toBe(false);
  });

  it('getTheme returns "dark" by default (no stored value)', () => {
    const { config } = freshConfig();
    expect(config.getTheme()).toBe('dark');
  });

  it('getFloatingBarEnabled returns false by default', () => {
    const { config } = freshConfig();
    expect(config.getFloatingBarEnabled()).toBe(false);
  });

  it('getSoundsEnabled returns true by default', () => {
    const { config } = freshConfig();
    expect(config.getSoundsEnabled()).toBe(true);
  });

  it('getMuteWhileDictating returns false by default', () => {
    const { config } = freshConfig();
    expect(config.getMuteWhileDictating()).toBe(false);
  });

  it('getShowInDock returns true by default', () => {
    const { config } = freshConfig();
    expect(config.getShowInDock()).toBe(true);
  });

  it('getTranslationEnabled returns false by default', () => {
    const { config } = freshConfig();
    expect(config.getTranslationEnabled()).toBe(false);
  });

  it('getTranslationLanguage returns "ja" by default', () => {
    const { config } = freshConfig();
    expect(config.getTranslationLanguage()).toBe('ja');
  });

  it('getTranscriptionEngine returns "parakeet" by default', () => {
    const { config } = freshConfig();
    expect(config.getTranscriptionEngine()).toBe('parakeet');
  });

  it('getGrammarModel returns "qwen2.5-0.5b" by default', () => {
    const { config } = freshConfig();
    expect(config.getGrammarModel()).toBe('qwen2.5-0.5b');
  });

  it('getGrammarTone returns "casual" by default', () => {
    const { config } = freshConfig();
    expect(config.getGrammarTone()).toBe('casual');
  });

  it('isOnboardingComplete returns false by default', () => {
    const { config } = freshConfig();
    expect(config.isOnboardingComplete()).toBe(false);
  });

  it('getAccessibilityGrantedOnce returns false by default', () => {
    const { config } = freshConfig();
    expect(config.getAccessibilityGrantedOnce()).toBe(false);
  });

  it('getHotkey returns default hotkey when nothing stored', () => {
    const { config } = freshConfig();
    const hotkey = config.getHotkey();
    expect(hotkey).toHaveProperty('names');
    expect(hotkey).toHaveProperty('label');
    expect(hotkey.names).toContain('FN');
  });
});

// ─── Get/Set round-trips ──────────────────────────────────────────────────────

describe('config get/set round-trips', () => {
  it('setModel / getModel', () => {
    const { config } = freshConfig();
    config.setModel('large');
    expect(config.getModel()).toBe('large');
  });

  it('setProgrammingMode / getProgrammingMode', () => {
    const { config } = freshConfig();
    config.setProgrammingMode(true);
    expect(config.getProgrammingMode()).toBe(true);
  });

  it('setGrammarEnabled / getGrammarEnabled', () => {
    const { config } = freshConfig();
    config.setGrammarEnabled(true);
    expect(config.getGrammarEnabled()).toBe(true);
  });

  it('setGrammarModel / getGrammarModel', () => {
    const { config } = freshConfig();
    config.setGrammarModel('smollm2-360m');
    expect(config.getGrammarModel()).toBe('smollm2-360m');
  });

  it('setGrammarTone / getGrammarTone', () => {
    const { config } = freshConfig();
    config.setGrammarTone('formal');
    expect(config.getGrammarTone()).toBe('formal');
  });

  it('setTheme / getTheme', () => {
    const { config } = freshConfig();
    config.setTheme('light');
    expect(config.getTheme()).toBe('light');
  });

  it('setFloatingBarEnabled / getFloatingBarEnabled', () => {
    const { config } = freshConfig();
    config.setFloatingBarEnabled(true);
    expect(config.getFloatingBarEnabled()).toBe(true);
  });

  it('setSoundsEnabled / getSoundsEnabled', () => {
    const { config } = freshConfig();
    config.setSoundsEnabled(false);
    expect(config.getSoundsEnabled()).toBe(false);
  });

  it('setMuteWhileDictating / getMuteWhileDictating', () => {
    const { config } = freshConfig();
    config.setMuteWhileDictating(true);
    expect(config.getMuteWhileDictating()).toBe(true);
  });

  it('setShowInDock / getShowInDock', () => {
    const { config } = freshConfig();
    config.setShowInDock(false);
    expect(config.getShowInDock()).toBe(false);
  });

  it('setTranslationEnabled / getTranslationEnabled', () => {
    const { config } = freshConfig();
    config.setTranslationEnabled(true);
    expect(config.getTranslationEnabled()).toBe(true);
  });

  it('setTranslationLanguage / getTranslationLanguage', () => {
    const { config } = freshConfig();
    config.setTranslationLanguage('fr');
    expect(config.getTranslationLanguage()).toBe('fr');
  });

  it('setTranscriptionEngine / getTranscriptionEngine', () => {
    const { config } = freshConfig();
    config.setTranscriptionEngine('parakeet');
    expect(config.getTranscriptionEngine()).toBe('parakeet');
    config.setTranscriptionEngine('whisper');
    expect(config.getTranscriptionEngine()).toBe('whisper');
  });

  it('setOnboardingComplete / isOnboardingComplete', () => {
    const { config } = freshConfig();
    config.setOnboardingComplete(true);
    expect(config.isOnboardingComplete()).toBe(true);
  });

  it('setAccessibilityGrantedOnce / getAccessibilityGrantedOnce', () => {
    const { config } = freshConfig();
    config.setAccessibilityGrantedOnce(true);
    expect(config.getAccessibilityGrantedOnce()).toBe(true);
  });

  it('setHotkey / getHotkey', () => {
    const { config } = freshConfig();
    const hotkey = { names: ['LEFT CTRL', 'A'], label: 'A' };
    config.setHotkey(hotkey);
    const retrieved = config.getHotkey();
    expect(retrieved.names).toEqual(['LEFT CTRL', 'A']);
    expect(retrieved.label).toBe('A');
  });

  it('overwriting a setting replaces the previous value', () => {
    const { config } = freshConfig();
    config.setModel('tiny');
    config.setModel('medium');
    expect(config.getModel()).toBe('medium');
  });
});

// ─── Hotkey migration ──────────────────────────────────────────────────────────

describe('hotkey migration from old uiohook format', () => {
  it('migrates a plain alt-only hotkey (keycode 56 = LEFT ALT)', () => {
    const { config } = freshConfig();
    const oldFormat = { keycode: 56, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, label: 'Option' };
    config.setHotkey(oldFormat);
    const migrated = config.getHotkey();
    expect(migrated.names).toContain('LEFT ALT');
  });

  it('migrates a Ctrl+A hotkey (keycode for A + ctrlKey)', () => {
    const { config } = freshConfig();
    const oldFormat = { keycode: 30, altKey: false, ctrlKey: true, shiftKey: false, metaKey: false, label: 'a' };
    config.setHotkey(oldFormat);
    const migrated = config.getHotkey();
    expect(migrated.names).toContain('LEFT CTRL');
  });

  it('migrates metaKey correctly', () => {
    const { config } = freshConfig();
    const oldFormat = { keycode: 56, altKey: true, ctrlKey: false, shiftKey: false, metaKey: true, label: 'Option' };
    config.setHotkey(oldFormat);
    const migrated = config.getHotkey();
    expect(migrated.names).toContain('LEFT META');
    expect(migrated.names).toContain('LEFT ALT');
  });

  it('does not double-migrate a new-format hotkey', () => {
    const { config } = freshConfig();
    const newFormat = { names: ['RIGHT ALT'], label: 'Right Option' };
    config.setHotkey(newFormat);
    const retrieved = config.getHotkey();
    expect(retrieved.names).toEqual(['RIGHT ALT']);
  });
});

// ─── Dictionary CRUD ──────────────────────────────────────────────────────────

describe('dictionary CRUD', () => {
  let config;

  beforeEach(() => {
    ({ config } = freshConfig());
  });

  it('getDictionary returns empty array initially', () => {
    expect(config.getDictionary()).toEqual([]);
  });

  it('addDictionaryEntry adds an entry and returns full list', () => {
    const result = config.addDictionaryEntry('colour', 'color');
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe('colour');
    expect(result[0].to).toBe('color');
    expect(typeof result[0].id).toBe('number');
  });

  it('getDictionary returns all entries', () => {
    config.addDictionaryEntry('colour', 'color');
    config.addDictionaryEntry('favour', 'favor');
    expect(config.getDictionary()).toHaveLength(2);
  });

  it('removeDictionaryEntry removes by id', () => {
    config.addDictionaryEntry('colour', 'color');
    const [entry] = config.getDictionary();
    const after = config.removeDictionaryEntry(entry.id);
    expect(after).toEqual([]);
  });

  it('removeDictionaryEntry leaves other entries untouched', () => {
    config.addDictionaryEntry('colour', 'color');
    config.addDictionaryEntry('favour', 'favor');
    const [first] = config.getDictionary();
    config.removeDictionaryEntry(first.id);
    const remaining = config.getDictionary();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].from).toBe('favour');
  });

  it('updateDictionaryEntry changes from/to values', () => {
    config.addDictionaryEntry('colour', 'color');
    const [entry] = config.getDictionary();
    config.updateDictionaryEntry(entry.id, 'grey', 'gray');
    const updated = config.getDictionary();
    expect(updated[0].from).toBe('grey');
    expect(updated[0].to).toBe('gray');
  });

  it('setDictionary replaces the entire dictionary', () => {
    config.addDictionaryEntry('a', 'b');
    config.setDictionary([
      { from: 'colour', to: 'color' },
      { from: 'favour', to: 'favor' },
    ]);
    const entries = config.getDictionary();
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.from)).toContain('colour');
    expect(entries.map(e => e.from)).toContain('favour');
  });

  it('addDictionaryEntry treats missing "to" as empty string', () => {
    const result = config.addDictionaryEntry('sth');
    expect(result[0].to).toBe('');
  });

  it('addDictionaryEntry sets packId to null for manual rows', () => {
    const [row] = config.addDictionaryEntry('colour', 'color');
    expect(row.packId).toBeNull();
  });
});

// ─── Dictionary preset packs ───────────────────────────────────────────────────

describe('dictionary preset packs', () => {
  let config;

  beforeEach(() => {
    ({ config } = freshConfig());
  });

  it('getDictionaryPacksCatalog lists packs with installed false initially', () => {
    const cat = config.getDictionaryPacksCatalog();
    expect(cat.length).toBeGreaterThan(0);
    expect(cat.some((p) => p.id === 'software-developer')).toBe(true);
    expect(cat.every((p) => p.installed === false)).toBe(true);
  });

  it('installDictionaryPack inserts rows with packId', () => {
    config.installDictionaryPack('software-developer');
    const rows = config.getDictionary();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.packId === 'software-developer')).toBe(true);
  });

  it('installDictionaryPack skips from when a manual entry already exists', () => {
    config.addDictionaryEntry('kubernetes', 'K8s');
    config.installDictionaryPack('software-developer');
    const rows = config.getDictionary();
    const k = rows.filter((r) => r.from.toLowerCase() === 'kubernetes');
    expect(k).toHaveLength(1);
    expect(k[0].packId).toBeNull();
    expect(k[0].to).toBe('K8s');
  });

  it('uninstallDictionaryPack removes only that pack rows', () => {
    config.installDictionaryPack('software-developer');
    config.addDictionaryEntry('zaphod', 'beeblebrox');
    config.uninstallDictionaryPack('software-developer');
    const rows = config.getDictionary();
    expect(rows).toHaveLength(1);
    expect(rows[0].from).toBe('zaphod');
    expect(rows[0].packId).toBeNull();
  });

  it('getDictionaryPacksCatalog marks installed after install', () => {
    config.installDictionaryPack('software-developer');
    const cat = config.getDictionaryPacksCatalog();
    const dev = cat.find((p) => p.id === 'software-developer');
    expect(dev?.installed).toBe(true);
    expect(dev?.installedCount).toBeGreaterThan(0);
  });

  it('installDictionaryPack throws for unknown pack id', () => {
    expect(() => config.installDictionaryPack('not-a-real-pack')).toThrow(/Unknown dictionary pack/);
  });
});
