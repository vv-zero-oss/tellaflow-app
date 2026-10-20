import { describe, it, expect } from 'vitest';
import { createTestDb, injectTestDb } from './db-helpers.js';

function loadFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

function freshConfig() {
  injectTestDb(createTestDb());
  return loadFresh('../../src/main/config.js');
}

describe('feature settings defaults', () => {
  it('has safe defaults', () => {
    const config = freshConfig();
    expect(config.getAutoLearnEnabled()).toBe(true);
    expect(config.getContextAwarenessEnabled()).toBe(true);
    expect(config.getMeetingNotesEnabled()).toBe(false); // opt-in
    expect(config.getMeetingBrowserDetection()).toBe(true);
    expect(config.getAudioRetentionDays()).toBe(30);
    expect(config.getAssistantSettings()).toEqual({ provider: 'auto', fullAccess: true, desktopActions: true, screenVision: true });
  });

  it('persists toggles and validates assistant settings', () => {
    const config = freshConfig();
    config.setMeetingNotesEnabled(true);
    config.setAudioRetentionDays(0);
    expect(config.getMeetingNotesEnabled()).toBe(true);
    expect(config.getAudioRetentionDays()).toBe(0);
    // bb's provider ids; anything not shaped like one is ignored.
    const s = config.setAssistantSettings({ provider: 'Not An Id!', fullAccess: false, desktopActions: false });
    expect(s).toMatchObject({ provider: 'auto', fullAccess: false, desktopActions: false, screenVision: true });
    expect(config.setAssistantSettings({ provider: 'claude-code' }).provider).toBe('claude-code');
  });
});

describe('rewrite settings', () => {
  it('defaults to fixing grammar on ⌃⌥F, and can be turned off', () => {
    const config = freshConfig();
    expect(config.getRewriteSettings()).toEqual({ style: 'grammar', instructions: '', dictation: true });
    expect(config.setRewriteSettings({ dictation: false }).dictation).toBe(false);
    expect(config.getRewriteHotkey()).toEqual({ names: ['LEFT CTRL', 'LEFT ALT', 'F'], label: '⌃⌥F' });
    config.setRewriteHotkey(null);
    expect(config.getRewriteHotkey()).toBeNull();
    config.setRewriteHotkey({ names: ['RIGHT META', 'G'], label: '⌘G' });
    expect(config.getRewriteHotkey().names).toEqual(['RIGHT META', 'G']);
  });

  it('keeps only known styles and caps the instructions', () => {
    const config = freshConfig();
    expect(config.setRewriteSettings({ style: 'formal' }).style).toBe('formal');
    expect(config.setRewriteSettings({ style: 'shouty' }).style).toBe('formal');
    expect(config.setRewriteSettings({ style: 'custom', instructions: 'x'.repeat(900) }).instructions).toHaveLength(500);
  });
});

describe('auto-learned dictionary entries', () => {
  it('adds learned corrections tagged as auto-learned', () => {
    const config = freshConfig();
    const added = config.addLearnedEntries([{ from: 'cooper netties', to: 'Kubernetes' }]);
    expect(added).toEqual([{ from: 'cooper netties', to: 'Kubernetes' }]);
    expect(config.getDictionary()).toEqual([expect.objectContaining({ from: 'cooper netties', to: 'Kubernetes', packId: 'auto-learned' })]);
  });

  it('never overrides an existing entry', () => {
    const config = freshConfig();
    config.addDictionaryEntry('cooper netties', 'K8s');
    expect(config.addLearnedEntries([{ from: 'Cooper Netties', to: 'Kubernetes' }])).toEqual([]);
    expect(config.getDictionary()).toHaveLength(1);
  });

  it('does not re-learn a word the user deleted', () => {
    const config = freshConfig();
    config.addLearnedEntries([{ from: 'katlin', to: 'Caitlin' }]);
    const [entry] = config.getDictionary();
    config.removeDictionaryEntry(entry.id);
    expect(config.addLearnedEntries([{ from: 'katlin', to: 'Caitlin' }])).toEqual([]);
    expect(config.getDictionary()).toEqual([]);
    // A different correction for the same sound is still allowed.
    expect(config.addLearnedEntries([{ from: 'katlin', to: 'Kaitlyn' }])).toHaveLength(1);
  });

  it('filters out corrections that would not be added, without writing', () => {
    const config = freshConfig();
    config.addDictionaryEntry('jon', 'John');
    config.blockLearnedEntries([{ from: 'katlin', to: 'Caitlin' }]);
    expect(config.filterNewLearnedEntries([
      { from: 'Jon', to: 'John' },
      { from: 'katlin', to: 'Caitlin' },
      { from: 'cooper netties', to: 'Kubernetes' },
    ])).toEqual([{ from: 'cooper netties', to: 'Kubernetes' }]);
    expect(config.getDictionary()).toHaveLength(1);
  });

  it('deleting a manual entry does not blocklist it', () => {
    const config = freshConfig();
    config.addDictionaryEntry('jon', 'John');
    config.removeDictionaryEntry(config.getDictionary()[0].id);
    expect(config.getAutoLearnBlocklist()).toEqual([]);
  });
});
