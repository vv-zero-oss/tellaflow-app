import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, injectTestDb } from './db-helpers.js';

function loadFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

function freshSnippets() {
  const db = createTestDb();
  injectTestDb(db);
  return loadFresh('../../src/main/snippets.js');
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

describe('snippets CRUD', () => {
  let snippets;

  beforeEach(() => {
    snippets = freshSnippets();
  });

  it('getSnippets returns empty array initially', () => {
    expect(snippets.getSnippets()).toEqual([]);
  });

  it('addSnippet adds a snippet and returns the full list', () => {
    const result = snippets.addSnippet('brb', 'be right back');
    expect(result).toHaveLength(1);
    expect(result[0].trigger).toBe('brb');
    expect(result[0].content).toBe('be right back');
    expect(typeof result[0].id).toBe('number');
  });

  it('getSnippets returns all added snippets', () => {
    snippets.addSnippet('brb', 'be right back');
    snippets.addSnippet('omw', 'on my way');
    expect(snippets.getSnippets()).toHaveLength(2);
  });

  it('removeSnippet removes the snippet by id', () => {
    snippets.addSnippet('brb', 'be right back');
    const [entry] = snippets.getSnippets();
    const result = snippets.removeSnippet(entry.id);
    expect(result).toEqual([]);
  });

  it('removeSnippet leaves other snippets intact', () => {
    snippets.addSnippet('brb', 'be right back');
    snippets.addSnippet('omw', 'on my way');
    const [first] = snippets.getSnippets();
    snippets.removeSnippet(first.id);
    const remaining = snippets.getSnippets();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].trigger).toBe('omw');
  });

  it('updateSnippet changes trigger and content', () => {
    snippets.addSnippet('brb', 'be right back');
    const [entry] = snippets.getSnippets();
    snippets.updateSnippet(entry.id, 'bbl', 'be back later');
    const updated = snippets.getSnippets();
    expect(updated[0].trigger).toBe('bbl');
    expect(updated[0].content).toBe('be back later');
  });

  it('clearSnippets removes all snippets and returns empty array', () => {
    snippets.addSnippet('brb', 'be right back');
    snippets.addSnippet('omw', 'on my way');
    const result = snippets.clearSnippets();
    expect(result).toEqual([]);
    expect(snippets.getSnippets()).toEqual([]);
  });

  it('can add snippets again after clearing', () => {
    snippets.addSnippet('brb', 'be right back');
    snippets.clearSnippets();
    snippets.addSnippet('ty', 'thank you');
    const entries = snippets.getSnippets();
    expect(entries).toHaveLength(1);
    expect(entries[0].trigger).toBe('ty');
  });
});

// ─── applySnippets ────────────────────────────────────────────────────────────

describe('applySnippets', () => {
  let snippets;

  beforeEach(() => {
    snippets = freshSnippets();
  });

  it('returns the original text when no snippets are defined', () => {
    expect(snippets.applySnippets('hello world')).toBe('hello world');
  });

  it('replaces a trigger with its content', () => {
    snippets.addSnippet('brb', 'be right back');
    expect(snippets.applySnippets('I will brb')).toBe('I will be right back');
  });

  it('is case-insensitive', () => {
    snippets.addSnippet('brb', 'be right back');
    expect(snippets.applySnippets('I will BRB')).toBe('I will be right back');
  });

  it('replaces multiple occurrences in the same text', () => {
    snippets.addSnippet('ty', 'thank you');
    const result = snippets.applySnippets('ty for everything, ty!');
    expect(result).toBe('thank you for everything, thank you!');
  });

  it('applies multiple different snippets', () => {
    snippets.addSnippet('brb', 'be right back');
    snippets.addSnippet('ty', 'thank you');
    const result = snippets.applySnippets('brb, ty');
    expect(result).toBe('be right back, thank you');
  });

  it('escapes regex-special characters in triggers', () => {
    snippets.addSnippet('c++', 'C plus plus');
    const result = snippets.applySnippets('I love c++');
    expect(result).toBe('I love C plus plus');
  });

  it('returns the original text when the trigger is not present', () => {
    snippets.addSnippet('brb', 'be right back');
    expect(snippets.applySnippets('hello world')).toBe('hello world');
  });

  it('handles empty text', () => {
    snippets.addSnippet('brb', 'be right back');
    expect(snippets.applySnippets('')).toBe('');
  });

  it('skips snippets with empty triggers', () => {
    snippets.addSnippet('', 'no trigger');
    expect(snippets.applySnippets('hello')).toBe('hello');
  });
});
