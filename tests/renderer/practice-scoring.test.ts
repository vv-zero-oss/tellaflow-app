import { describe, expect, it } from 'vitest';
import { normalizeForPractice, scoreEchoRound, tokenize } from '@/lib/practice-scoring';

describe('normalizeForPractice', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeForPractice('Hello, World!')).toBe('hello world');
  });
});

describe('tokenize', () => {
  it('splits on spaces', () => {
    expect(tokenize('a b c')).toEqual(['a', 'b', 'c']);
  });
});

describe('scoreEchoRound', () => {
  it('perfect match passes', () => {
    const r = scoreEchoRound('The quick fox', 'the quick fox', 0.85);
    expect(r.wer).toBe(0);
    expect(r.pass).toBe(true);
    expect(r.matchedRefIndices.size).toBe(3);
  });

  it('one substitution lowers accuracy', () => {
    const r = scoreEchoRound('the quick fox', 'the slow fox', 0.85);
    expect(r.refTokens).toEqual(['the', 'quick', 'fox']);
    expect(r.wer).toBeCloseTo(1 / 3);
    expect(r.pass).toBe(false);
  });

  it('empty hypothesis fails when reference non-empty', () => {
    const r = scoreEchoRound('hello world', '', 0.85);
    expect(r.wer).toBe(1);
    expect(r.pass).toBe(false);
  });

  it('extra words count as insertions', () => {
    const r = scoreEchoRound('hello world', 'hello there world today', 0.85);
    expect(r.wer).toBeGreaterThan(0);
  });

  it('respects custom threshold', () => {
    const r = scoreEchoRound('a b', 'a x', 0.6);
    expect(r.pass).toBe(false);
    const r2 = scoreEchoRound('a b', 'a x', 0.5);
    expect(r2.pass).toBe(true);
  });
});
