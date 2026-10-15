import { describe, it, expect } from 'vitest';
import { extractCorrections, isLearnable, createAutoLearnWatcher } from '../../src/main/auto-learn.js';

describe('extractCorrections', () => {
  it('learns a misheard multi-word term the user fixed', () => {
    const pasted = 'we should deploy it to cooper netties tonight';
    const before = `Hi team, ${pasted}`;
    const after = 'Hi team, we should deploy it to Kubernetes tonight';
    expect(extractCorrections(pasted, before, after)).toEqual([{ from: 'cooper netties', to: 'Kubernetes' }]);
  });

  it('learns a misspelled name', () => {
    const pasted = 'thanks Katlin for the update';
    expect(extractCorrections(pasted, pasted, 'thanks Caitlin for the update')).toEqual([{ from: 'katlin', to: 'Caitlin' }]);
  });

  it('learns proper-noun capitalisation of a non-everyday word', () => {
    const pasted = 'open tellaflow settings';
    expect(extractCorrections(pasted, pasted, 'open Tellaflow settings')).toEqual([{ from: 'tellaflow', to: 'Tellaflow' }]);
  });

  it('ignores style rewrites between everyday words', () => {
    const pasted = 'this is a great idea';
    expect(extractCorrections(pasted, pasted, 'this is a good idea')).toEqual([]);
  });

  it('ignores corrections outside the pasted span', () => {
    const pasted = 'see you tomorrow';
    const before = `Dear Jon, ${pasted}`;
    const after = `Dear John, ${pasted}`;
    expect(extractCorrections(pasted, before, after)).toEqual([]);
  });

  it('ignores pure insertions and deletions', () => {
    const pasted = 'call me later';
    expect(extractCorrections(pasted, pasted, 'call me much later')).toEqual([]);
    expect(extractCorrections(pasted, pasted, 'call later')).toEqual([]);
  });

  it('ignores numbers, URLs, paths and code', () => {
    expect(isLearnable('for tea', '42')).toBe(false);
    expect(isLearnable('example dot com', 'example.com')).toBe(false);
    expect(isLearnable('user bin', '/usr/bin')).toBe(false);
    expect(isLearnable('foo bar', 'foo()')).toBe(false);
  });

  it('does not let a single everyday word hijack speech', () => {
    expect(isLearnable('mark', 'Marc')).toBe(false);
  });

  it('rejects unrelated replacements (doesn’t sound alike)', () => {
    const pasted = 'ping zylophant about it';
    expect(extractCorrections(pasted, pasted, 'ping Bartholomew about it')).toEqual([]);
  });

  it('returns nothing when the pasted text is not in the field', () => {
    expect(extractCorrections('hello there', 'something else', 'something else entirely')).toEqual([]);
  });
});

describe('auto-learn watcher', () => {
  function fakeTimers() {
    const q = [];
    return {
      setTimeout: (fn) => { q.push(fn); return q.length; },
      clearTimeout: () => {},
      async runAll(max = 50) { for (let i = 0; i < max && q.length; i++) { await q.shift()(); } },
    };
  }

  it('learns from the last good field value even after a chat app clears it on send', async () => {
    const pasted = 'ask cooper netties team';
    const values = [pasted, pasted, 'ask Kubernetes team', '' /* sent */];
    const timers = fakeTimers();
    const learned = [];
    const w = createAutoLearnWatcher({
      readFocused: async () => ({ app: 'Slack', value: values.length > 1 ? values.shift() : values[0] }),
      onLearn: (c, ctx) => learned.push({ c, ctx }),
      timers,
      windowMs: 1e9,
    });
    w.watch(pasted, { app: 'Slack' });
    await timers.runAll(6);
    w.stop(true);
    expect(learned).toHaveLength(1);
    expect(learned[0].c).toEqual([{ from: 'cooper netties', to: 'Kubernetes' }]);
    expect(learned[0].ctx.app).toBe('Slack');
  });

  it('stops (and evaluates) when the user switches apps', async () => {
    const pasted = 'meet katlin at noon';
    const seq = [
      { app: 'Mail', value: pasted },
      { app: 'Mail', value: 'meet Caitlin at noon' },
      { app: 'Safari', value: 'whatever' },
    ];
    const timers = fakeTimers();
    const learned = [];
    const w = createAutoLearnWatcher({ readFocused: async () => seq.shift(), onLearn: (c) => learned.push(...c), timers, windowMs: 1e9 });
    w.watch(pasted, { app: 'Mail' });
    await timers.runAll();
    expect(w.isWatching()).toBe(false);
    expect(learned).toEqual([{ from: 'katlin', to: 'Caitlin' }]);
  });

  it('does nothing when disabled or when the field never contained the paste', async () => {
    const timers = fakeTimers();
    const learned = [];
    const disabled = createAutoLearnWatcher({ readFocused: async () => null, onLearn: (c) => learned.push(c), isEnabled: () => false, timers });
    disabled.watch('hello world');
    expect(disabled.isWatching()).toBe(false);

    const w = createAutoLearnWatcher({ readFocused: async () => ({ app: 'X', value: 'unrelated' }), onLearn: (c) => learned.push(c), timers });
    w.watch('hello there friend', { app: 'X' });
    await timers.runAll();
    expect(w.isWatching()).toBe(false);
    expect(learned).toEqual([]);
  });
});
