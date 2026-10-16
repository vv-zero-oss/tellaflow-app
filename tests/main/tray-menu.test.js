import { describe, it, expect, vi } from 'vitest';
const { buildTrayTemplate, previewOf } = require('../../src/main/tray-menu.js');

function actions() {
  return {
    open: vi.fn(), startRecording: vi.fn(), stopRecording: vi.fn(), startMeeting: vi.fn(), stopMeeting: vi.fn(),
    checkForUpdates: vi.fn(), installUpdate: vi.fn(), pasteLast: vi.fn(), openPage: vi.fn(),
    setMicrophone: vi.fn(), setLanguage: vi.fn(), quit: vi.fn(),
  };
}
const find = (items, label) => items.find((i) => i.label === label);
const labels = (items) => items.map((i) => (i.type === 'separator' ? '---' : i.label));

describe('tray menu', () => {
  it('lays out the menu like the reference: actions, updates, paste last, settings, quit', () => {
    const t = buildTrayTemplate({ lastTranscript: 'Yeah, we cannot see this one' }, actions());
    expect(labels(t)).toEqual([
      'Start Recording', 'Open Tellaflow', '---',
      'Check for Updates…', '---',
      'Paste Last Transcript', '“Yeah, we cannot see this one”', '---',
      'Shortcuts', 'Microphone', 'Language', 'Settings…', '---',
      'Quit Tellaflow',
    ]);
    const paste = find(t, 'Paste Last Transcript');
    expect(paste.accelerator).toBe('Control+Command+V');
    expect(paste.registerAccelerator).toBe(false);
    expect(paste.enabled).toBe(true);
  });

  it('disables Paste Last Transcript when nothing was dictated', () => {
    const t = buildTrayTemplate({ lastTranscript: '' }, actions());
    expect(find(t, 'Paste Last Transcript').enabled).toBe(false);
    expect(find(t, 'Nothing dictated yet').enabled).toBe(false);
  });

  it('previews long transcripts on one short line', () => {
    const p = previewOf('This is a very long transcript\nthat spans lines and keeps going on and on and on');
    expect(p).not.toMatch(/\n/);
    expect(p.length).toBeLessThanOrEqual(48);
    expect(p.endsWith('…')).toBe(true);
  });

  it('shows recording, meeting, update and attention states', () => {
    const a = actions();
    const t = buildTrayTemplate({
      recording: true, meeting: { enabled: true, active: true, app: 'Zoom' }, failedCount: 2,
      update: { phase: 'downloaded', version: '0.9.2' },
    }, a);
    expect(labels(t)).toContain('Stop Recording');
    expect(labels(t)).toContain('Stop Meeting Notes (Zoom)');
    expect(labels(t)).toContain('Restart to Install Update (v0.9.2)');
    find(t, '2 Recordings Need Attention…').click();
    expect(a.openPage).toHaveBeenCalledWith('transcripts');
  });

  it('lists microphones as radio items and selects one', () => {
    const a = actions();
    const t = buildTrayTemplate({
      microphoneId: 'usb',
      microphones: [
        { deviceId: 'default', label: 'Default - MacBook Pro Microphone' },
        { deviceId: 'built-in', label: 'MacBook Pro Microphone' },
        { deviceId: 'usb', label: 'Shure MV7' },
      ],
    }, a);
    const mic = find(t, 'Microphone').submenu;
    expect(find(mic, 'Auto-detect (MacBook Pro Microphone)').checked).toBe(false);
    expect(find(mic, 'Shure MV7').checked).toBe(true);
    expect(mic.filter((i) => i.label?.startsWith('Default -'))).toHaveLength(0);
    find(mic, 'MacBook Pro Microphone').click();
    expect(a.setMicrophone).toHaveBeenCalledWith('built-in');
  });

  it('keeps each submenu\'s radio items in one group (a separator would split it)', () => {
    const t = buildTrayTemplate({
      microphones: [{ deviceId: 'a', label: 'A' }, { deviceId: 'b', label: 'B' }],
      translation: { available: true, enabled: false },
    }, actions());
    for (const name of ['Microphone', 'Language']) {
      const sub = find(t, name).submenu;
      const radios = sub.map((i, n) => (i.type === 'radio' ? n : -1)).filter((n) => n >= 0);
      expect(radios[radios.length - 1] - radios[0] + 1).toBe(radios.length);
      expect(sub.filter((i) => i.checked)).toHaveLength(1);
    }
  });

  it('keeps a chosen microphone that is unplugged checked rather than moving the mark', () => {
    const mic = find(buildTrayTemplate({ microphoneId: 'gone', microphones: [] }, actions()), 'Microphone').submenu;
    expect(mic.filter((i) => i.checked)).toEqual([expect.objectContaining({ label: 'Selected microphone (not connected)' })]);
  });

  it('offers languages only when the model can translate', () => {
    const a = actions();
    const off = find(buildTrayTemplate({ translation: { available: false, unavailableReason: 'Parakeet is English only' } }, a), 'Language').submenu;
    expect(labels(off)).toEqual(['English', 'Parakeet is English only', '---', 'Choose a Model…']);

    const on = find(buildTrayTemplate({ translation: { available: true, enabled: true, language: 'it' } }, a), 'Language').submenu;
    expect(find(on, 'Italian').checked).toBe(true); // a language picked on the Models page still shows
    expect(find(on, 'English').checked).toBe(false);
    find(on, 'Japanese').click();
    expect(a.setLanguage).toHaveBeenCalledWith('ja');
    find(on, 'English').click();
    expect(a.setLanguage).toHaveBeenCalledWith('en');
  });

  it('lists the current shortcuts', () => {
    const sc = find(buildTrayTemplate({ shortcuts: { dictate: 'fn', command: null, assistant: true } }, actions()), 'Shortcuts').submenu;
    expect(find(sc, 'Dictate').sublabel).toBe('fn');
    expect(find(sc, 'Ask the assistant').sublabel).toBe('Off');
    expect(find(sc, 'Paste last transcript').sublabel).toBe('⌃⌘V');
  });

  it('lists the assistant’s key only while the assistant is on', () => {
    const sc = find(buildTrayTemplate({ shortcuts: { dictate: 'fn', command: 'Right ⌥', assistant: false } }, actions()), 'Shortcuts').submenu;
    expect(sc.some((i) => i.label === 'Ask the assistant')).toBe(false);
  });

  it('opens the Dictation tab of Settings for shortcuts and microphones', () => {
    const a = actions();
    const t = buildTrayTemplate({ shortcuts: {} }, a);
    find(find(t, 'Shortcuts').submenu, 'Change Shortcuts…').click();
    find(find(t, 'Microphone').submenu, 'Microphone Settings…').click();
    expect(a.openPage.mock.calls).toEqual([['settings/dictation'], ['settings/dictation']]);
  });
});
