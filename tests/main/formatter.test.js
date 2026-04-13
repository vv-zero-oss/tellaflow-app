import { describe, it, expect } from 'vitest';
import { formatTranscription } from '../../src/main/formatter.js';

describe('formatTranscription', () => {
  it('returns empty string for null/undefined/empty input', () => {
    expect(formatTranscription(null)).toBe('');
    expect(formatTranscription(undefined)).toBe('');
    expect(formatTranscription('')).toBe('');
  });

  it('returns empty string for non-string input', () => {
    expect(formatTranscription(42)).toBe('');
    expect(formatTranscription({})).toBe('');
  });

  it('capitalizes the first character', () => {
    expect(formatTranscription('hello world')).toBe('Hello world');
  });

  it('capitalizes after sentence-ending punctuation', () => {
    const result = formatTranscription('hello. world. this is great.');
    expect(result).toBe('Hello. World. This is great.');
  });

  it('capitalizes after newlines', () => {
    const result = formatTranscription('good morning\nhello world');
    expect(result).toBe('Good morning\nHello world');
  });
});

// ─── Filler removal ───────────────────────────────────────────────────────────

describe('formatTranscription – filler removal', () => {
  it('removes "um"', () => {
    const result = formatTranscription('um hello there');
    expect(result).not.toMatch(/\bum\b/i);
  });

  it('removes "uh"', () => {
    const result = formatTranscription('uh I think uh this is right');
    expect(result).not.toMatch(/\buh\b/i);
  });

  it('removes "you know"', () => {
    const result = formatTranscription('you know this is good');
    expect(result).not.toMatch(/you know/i);
  });

  it('removes "basically"', () => {
    const result = formatTranscription('basically we need to do this');
    expect(result).not.toMatch(/\bbasically\b/i);
  });

  it('removes "actually"', () => {
    const result = formatTranscription('actually I was wrong');
    expect(result).not.toMatch(/\bactually\b/i);
  });

  it('removes "sort of"', () => {
    const result = formatTranscription('it is sort of clear');
    expect(result).not.toMatch(/sort of/i);
  });
});

// ─── Voice commands ───────────────────────────────────────────────────────────

describe('formatTranscription – voice commands', () => {
  it('converts "new paragraph" to double newline', () => {
    const result = formatTranscription('hello new paragraph world');
    expect(result).toContain('\n\n');
  });

  it('converts "new line" to single newline', () => {
    const result = formatTranscription('hello new line world');
    expect(result).toContain('\n');
  });

  it('converts "full stop" to period', () => {
    const result = formatTranscription('hello full stop world');
    expect(result).toContain('.');
    expect(result).not.toMatch(/full stop/i);
  });

  it('converts "question mark" to ?', () => {
    const result = formatTranscription('are you sure question mark');
    expect(result).toContain('?');
    expect(result).not.toMatch(/question mark/i);
  });

  it('converts "exclamation mark" to !', () => {
    const result = formatTranscription('great exclamation mark');
    expect(result).toContain('!');
    expect(result).not.toMatch(/exclamation mark/i);
  });

  it('converts "open parenthesis" and "close parenthesis"', () => {
    const result = formatTranscription('test open parenthesis note close parenthesis');
    expect(result).toContain('(');
    expect(result).toContain(')');
  });
});

// ─── List detection ───────────────────────────────────────────────────────────

describe('formatTranscription – list detection', () => {
  it('formats ordinal lists (first … second …)', () => {
    const result = formatTranscription('first apples second bananas third cherries');
    expect(result).toMatch(/1\./);
    expect(result).toMatch(/2\./);
    expect(result).toMatch(/3\./);
  });

  it('formats "number one … number two …" style lists', () => {
    const result = formatTranscription('number one apples number two bananas number three cherries');
    expect(result).toMatch(/1\./);
    expect(result).toMatch(/2\./);
    expect(result).toMatch(/3\./);
  });

  it('formats "point one … point two …" style lists', () => {
    const result = formatTranscription('point one first item point two second item');
    expect(result).toMatch(/1\./);
    expect(result).toMatch(/2\./);
  });

  it('formats digit lists (1. … 2. … 3. …)', () => {
    const result = formatTranscription('1. buy milk 2. walk dog 3. read book');
    expect(result).toMatch(/1\./);
    expect(result).toMatch(/2\./);
    expect(result).toMatch(/3\./);
  });

  it('does NOT format ordinal list with only one ordinal', () => {
    const result = formatTranscription('first of all this is fine');
    expect(result).not.toMatch(/^1\.\s/m);
  });
});

// ─── Whitespace cleanup ───────────────────────────────────────────────────────

describe('formatTranscription – whitespace cleanup', () => {
  it('collapses multiple spaces', () => {
    const result = formatTranscription('hello   world');
    expect(result).toBe('Hello world');
  });

  it('trims leading and trailing whitespace', () => {
    const result = formatTranscription('  hello world  ');
    expect(result).toBe('Hello world');
  });

  it('removes space before punctuation', () => {
    const result = formatTranscription('hello , world');
    expect(result).not.toContain(' ,');
    expect(result).toContain(',');
  });

  it('caps triple newlines at double newline', () => {
    const result = formatTranscription('line one\n\n\n\nline two');
    expect(result).not.toMatch(/\n{3,}/);
  });
});
