import { describe, it, expect, vi } from 'vitest';
import { createPaster } from '../../src/main/paste.js';

// A clipboard with Electron's API shape. `pasted` records what the target app
// would have read when Cmd+V landed.
function fakeClipboard(initial = { text: 'user copy' }) {
  let data = { ...initial };
  const formatsOf = () => [
    ...(data.text !== undefined ? ['text/plain'] : []),
    ...(data.html !== undefined ? ['text/html'] : []),
    ...(data.rtf !== undefined ? ['text/rtf'] : []),
    ...(data.image !== undefined ? ['image/png'] : []),
  ];
  return {
    get data() { return data; },
    availableFormats: () => formatsOf(),
    readText: () => data.text ?? '',
    readHTML: () => data.html ?? '',
    readRTF: () => data.rtf ?? '',
    readImage: () => data.image ?? { isEmpty: () => true },
    readBuffer: () => Buffer.alloc(0),
    writeText: (text) => { data = { text }; },
    write: (d) => { data = { ...d }; },
    writeBuffer: vi.fn(),
    clear: () => { data = {}; },
  };
}

function setup(initial, { scriptMs = 0, fail = false } = {}) {
  const cb = fakeClipboard(initial);
  const pasted = [];
  const runScript = async () => {
    // Cmd+V lands only after activate + delay: the clipboard is read then.
    await new Promise((r) => setTimeout(r, scriptMs));
    if (fail) throw new Error('not allowed assistive access');
    pasted.push(cb.readText());
  };
  const paster = createPaster({ clipboard: cb, runScript, restoreDelayMs: 5 });
  return { cb, pasted, paster };
}

describe('pasteText', () => {
  it('pastes our text even when the keystroke is slower than the restore delay', async () => {
    const { cb, pasted, paster } = setup({ text: 'user copy' }, { scriptMs: 40 });
    expect(await paster.pasteText('hello world', 'Notes')).toBe(true);
    expect(pasted).toEqual(['hello world']);
    expect(cb.data).toEqual({ text: 'user copy' });
  });

  it('serializes back-to-back pastes and restores the pre-burst clipboard once', async () => {
    const { cb, pasted, paster } = setup({ text: 'user copy' }, { scriptMs: 10 });
    await Promise.all([paster.pasteText('one'), paster.pasteText('two'), paster.pasteText('three')]);
    expect(pasted).toEqual(['one', 'two', 'three']);
    expect(cb.data).toEqual({ text: 'user copy' });
  });

  it('keeps what the user copied while the paste was in flight', async () => {
    const { cb, paster } = setup({ text: 'old' }, { scriptMs: 10 });
    const p = paster.pasteText('dictated');
    setTimeout(() => cb.writeText('copied meanwhile'), 12);
    await p;
    expect(cb.data).toEqual({ text: 'copied meanwhile' });
  });

  it('leaves our text on the clipboard when the keystroke failed', async () => {
    const { cb, paster } = setup({ text: 'old' }, { fail: true });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await paster.pasteText('dictated', 'Notes')).toBe(false);
    expect(cb.data).toEqual({ text: 'dictated' });
    err.mockRestore();
  });

  it('restores rich text and images, not just plain text', async () => {
    const image = { isEmpty: () => false };
    const { cb, pasted, paster } = setup({ text: 'Bold', html: '<b>Bold</b>', rtf: '{\\rtf1 Bold}', image });
    await paster.pasteText('dictated', 'Notes');
    expect(pasted).toEqual(['dictated']);
    expect(cb.data).toEqual({ text: 'Bold', html: '<b>Bold</b>', rtf: '{\\rtf1 Bold}', image });
  });

  it('restores an image-only clipboard instead of blanking it', async () => {
    const image = { isEmpty: () => false };
    const { cb, paster } = setup({ image });
    await paster.pasteText('dictated', 'Notes');
    expect(cb.data).toEqual({ image });
  });

  it('restores an empty clipboard as empty', async () => {
    const { cb, paster } = setup({});
    await paster.pasteText('dictated', 'Notes');
    expect(cb.data).toEqual({});
  });

  it('keeps going after a failed paste in a burst', async () => {
    let calls = 0;
    const cb = fakeClipboard({ text: 'user copy' });
    const pasted = [];
    const runScript = async () => { if (calls++ === 0) throw new Error('timeout'); pasted.push(cb.readText()); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const paster = createPaster({ clipboard: cb, runScript, restoreDelayMs: 1 });
    const results = await Promise.all([paster.pasteText('one'), paster.pasteText('two')]);
    expect(results).toEqual([false, true]);
    expect(pasted).toEqual(['two']);
    expect(cb.data).toEqual({ text: 'user copy' });
    err.mockRestore();
  });
});
