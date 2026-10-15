import { describe, it, expect } from 'vitest';
import {
  classifyApp,
  extractContextVocabulary,
  buildWhisperPrompt,
  normalizeSpokenFileNames,
  snapToVocabulary,
  applyContextVocabulary,
} from '../../src/main/app-context.js';
import { parseContextOutput } from '../../src/main/mac-automation.js';

describe('classifyApp', () => {
  it('recognises chat apps and editors by name or bundle id', () => {
    expect(classifyApp('Slack')).toBe('chat');
    expect(classifyApp('Whatever', 'com.tinyspeck.slackmacgap')).toBe('chat');
    expect(classifyApp('Cursor')).toBe('code');
    expect(classifyApp('Code')).toBe('code');
    expect(classifyApp('Notes')).toBe('other');
  });
});

describe('extractContextVocabulary', () => {
  it('pulls names from a Slack DM title, mentions and capitalised names', () => {
    const v = extractContextVocabulary({
      app: 'Slack',
      windowTitle: 'Priyanka Raghunathan (DM) - Acme Corp - Slack',
      focusedValue: 'hey @marcus.okafor can you sync with Siobhan',
    });
    expect(v.kind).toBe('chat');
    expect(v.names).toEqual(expect.arrayContaining(['Priyanka Raghunathan', 'Marcus Okafor', 'Siobhan']));
    expect(v.names).not.toContain('Slack');
  });

  it('pulls file names and identifiers from an editor', () => {
    const v = extractContextVocabulary({
      app: 'Cursor',
      windowTitle: 'useTranscription.ts — tellaflow-app',
      focusedValue: 'import { parseConfig } from "./config_loader.py"; const retryCount = 3;',
    });
    expect(v.kind).toBe('code');
    expect(v.files).toEqual(expect.arrayContaining(['useTranscription.ts', 'config_loader.py']));
    expect(v.terms).toEqual(expect.arrayContaining(['parseConfig', 'retryCount', 'tellaflow-app']));
  });
});

describe('buildWhisperPrompt', () => {
  it('builds a short glossary prompt', () => {
    expect(buildWhisperPrompt({ names: ['Jane Doe'], files: ['index.js'], terms: [] })).toBe('Names: Jane Doe. Files: index.js.');
    expect(buildWhisperPrompt({ names: [], files: [], terms: [] })).toBe('');
  });
  it('caps the prompt length', () => {
    const names = Array.from({ length: 200 }, (_, i) => `Person${i}`);
    expect(buildWhisperPrompt({ names, files: [], terms: [] }).length).toBeLessThanOrEqual(400);
  });
});

describe('normalizeSpokenFileNames', () => {
  it('turns "index dot js" into index.js', () => {
    expect(normalizeSpokenFileNames('open index dot js please')).toBe('open index.js please');
  });
  it('matches multi-word stems to known files', () => {
    expect(normalizeSpokenFileNames('look at app config dot ts', ['appConfig.ts'])).toBe('look at appConfig.ts');
  });
  it('leaves non-file "dot" alone', () => {
    expect(normalizeSpokenFileNames('connect the dot to the line')).toBe('connect the dot to the line');
  });
});

describe('snapToVocabulary', () => {
  it('fixes near-miss spellings of names', () => {
    expect(snapToVocabulary('ask Siobahn and Priyanka Ragunathan about it', ['Siobhan', 'Priyanka Raghunathan']))
      .toBe('ask Siobhan and Priyanka Raghunathan about it');
  });
  it('fixes casing of exact matches and keeps punctuation', () => {
    expect(snapToVocabulary('ping marcus okafor, thanks', ['Marcus Okafor'])).toBe('ping Marcus Okafor, thanks');
  });
  it('never rewrites everyday words', () => {
    expect(snapToVocabulary('the meeting is over', ['Meeting Notes', 'Theo'])).toBe('the meeting is over');
  });
});

describe('applyContextVocabulary', () => {
  it('handles a code dictation end to end', () => {
    const vocab = extractContextVocabulary({ app: 'Code', windowTitle: 'useTranscription.ts — tellaflow-app', focusedValue: '' });
    expect(applyContextVocabulary('open use transcription dot ts and fix it', vocab)).toBe('open useTranscription.ts and fix it');
  });
});

describe('parseContextOutput', () => {
  it('splits the osascript output and keeps multi-line field values', () => {
    const out = 'Slack\ncom.tinyspeck.slackmacgap\nJane (DM) - Acme - Slack\nline one\nline two';
    expect(parseContextOutput(out)).toEqual({
      app: 'Slack',
      bundleId: 'com.tinyspeck.slackmacgap',
      windowTitle: 'Jane (DM) - Acme - Slack',
      focusedValue: 'line one\nline two',
    });
  });
});
