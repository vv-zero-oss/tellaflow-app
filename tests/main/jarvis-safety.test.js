// The assistant's boundary (ported from canvas's Jarvis): the allowlist, the
// reply fence, and the desktop tier's gates. Each case is a way a reply once
// did — or could do — something nobody approved.
import { describe, it, expect } from 'vitest';
import {
  ACTION_SPECS,
  ACTION_SCHEMA_HINT,
  validateMascotAction,
  validateMascotActions,
  MAX_OS_ACTIONS_PER_TURN,
} from '../../src/main/jarvis/mascot-actions.js';
import { splitMascotReply, parseMascotActions } from '../../src/main/jarvis/mascot-reply.js';
import {
  forcedConfirmReason,
  secureTypeRefusal,
  splitOsKeyChords,
  isDestructiveKeySequence,
  isDenylistedApp,
  runMascotActions,
} from '../../src/main/jarvis/mascot-dispatch.js';
import { splitKeyChords } from '../../src/main/jarvis/desktop/peekaboo.js';
import { verifyStep, describeOsAction, serializeOsElements } from '../../src/main/jarvis/desktop-loop.js';

describe('allowlist', () => {
  it('accepts every advertised sample, and the prompt lists every type', () => {
    for (const [type, spec] of Object.entries(ACTION_SPECS)) {
      expect(validateMascotAction(spec.sample)?.type).toBe(type);
      expect(ACTION_SCHEMA_HINT).toContain(`"type":"${type}"`);
    }
  });

  it('drops what is not on it — editor actions included', () => {
    for (const type of ['point_at', 'command', 'run_shell', 'move_to', 'start_guide']) {
      expect(validateMascotAction({ type })).toBeNull();
    }
  });

  it('refuses a key chord that would become a flag', () => {
    expect(validateMascotAction({ type: 'os_press', keys: 'cmd+q --app Terminal' })).toBeNull();
    expect(validateMascotAction({ type: 'os_app', name: '--help', action: 'launch' })).toBeNull();
  });

  it('opens only plain http(s) addresses', () => {
    expect(validateMascotAction({ type: 'os_open_url', url: 'javascript:alert(1)' })).toBeNull();
    expect(validateMascotAction({ type: 'os_open_url', url: 'https://u:p@evil.test' })).toBeNull();
    expect(validateMascotAction({ type: 'os_open_url', url: 'https://example.com' })).toBeTruthy();
  });

  it('caps desktop actions and stops at a terminal action', () => {
    const many = Array.from({ length: 20 }, () => ({ type: 'os_see' }));
    expect(validateMascotActions(many).length).toBeLessThanOrEqual(MAX_OS_ACTIONS_PER_TURN);
    const cut = validateMascotActions([{ type: 'task_done', summary: 'ok' }, { type: 'os_see' }]);
    expect(cut.map((a) => a.type)).toEqual(['task_done']);
  });
});

describe('reply fence', () => {
  it('never shows a half-written fence, at any point of the stream', () => {
    const full = 'Opening Notes.\n\n```mascot\n{"actions":[{"type":"os_app","name":"Notes","action":"launch"}]}\n```';
    for (let i = 1; i <= full.length; i++) {
      const { prose } = splitMascotReply(full.slice(0, i));
      expect(prose).not.toContain('`');
      expect(prose).not.toContain('{"actions"');
    }
    const { prose, fence } = splitMascotReply(full);
    expect(prose).toBe('Opening Notes.');
    expect(parseMascotActions(fence)).toEqual([{ type: 'os_app', name: 'Notes', action: 'launch' }]);
  });
});

describe('desktop gates', () => {
  const map = (elements, extra = {}) => ({ ok: true, elements, foreground: true, ...extra });

  it('presses chords exactly as peekaboo splits them', () => {
    for (const keys of ['cmd+s', 'esc cmd+q', '  cmd+a   cmd+c ']) {
      expect(splitOsKeyChords(keys)).toEqual(splitKeyChords(keys));
    }
  });

  it('forces a confirmation for a destructive chord anywhere in a sequence', () => {
    expect(isDestructiveKeySequence('esc cmd+q')).toBe(true);
    expect(isDestructiveKeySequence('Shift+Cmd+Delete')).toBe(true);
    expect(forcedConfirmReason({ type: 'os_press', keys: 'cmd+s cmd+q' }, null)).toBe('destructive shortcut');
    expect(forcedConfirmReason({ type: 'os_press', keys: 'cmd+s' }, null)).toBeNull();
  });

  it('forces a confirmation in a password manager, however its name is spelled', () => {
    expect(isDenylistedApp('ＴＥＲＭＩＮＡＬ')).toBe(true);
    expect(isDenylistedApp('1Pass​word 8')).toBe(true);
    expect(forcedConfirmReason({ type: 'os_click', target: { elementId: 'e1' } }, map([], { frontmostApp: 'Keychain Access' }))).toMatch(/denylisted/);
  });

  it('refuses to type without evidence, into a password field, or after the screen changed', () => {
    const field = { id: 'e1', role: 'AXTextField', focused: true };
    expect(secureTypeRefusal(null)).toBe('no element map');
    expect(secureTypeRefusal(map([{ ...field, secure: true }]))).toBe('secure field focused');
    expect(secureTypeRefusal(map([{ id: 'e2', role: 'AXTextField', secure: true }]))).toBe('secure field on screen');
    expect(secureTypeRefusal(map([field]), { screenTouched: true })).toBe('screen touched since the look');
    expect(secureTypeRefusal({ ok: true, elements: [field], app: 'TextEdit', frontmostApp: '1Password' })).toBe('map is of another app');
    expect(secureTypeRefusal(map([field]))).toBeNull();
  });

  function fakeOs({ seen, confirm = true } = {}) {
    const acts = [];
    const asked = [];
    let held = seen ?? null;
    return {
      acts,
      asked,
      os: {
        status: async () => ({ supported: true, accessibility: true, screenRecording: true, peekaboo: { ok: true } }),
        see: async () => { held = seen; return seen; },
        act: async (a) => { acts.push(a); return { ok: true }; },
        confirm: async (a, o) => { asked.push({ a, forced: !!o?.forced }); return confirm; },
        lastSeen: () => held,
        invalidateSeen: () => { held = null; },
      },
    };
  }

  it('a click invalidates the look, so a type behind it is refused (finding 2)', async () => {
    const f = fakeOs({ seen: map([{ id: 'b', role: 'AXButton', label: 'Sign in' }, { id: 't', role: 'AXTextField', focused: true }]) });
    const said = [];
    const results = await runMascotActions(
      [{ type: 'os_see' }, { type: 'os_click', target: { elementId: 'b' } }, { type: 'os_type', text: 'hunter2' }],
      { os: f.os, say: (t) => said.push(t) },
    );
    expect(results.map((r) => r.ok)).toEqual([true, true, false]);
    expect(results[2].note).toMatch(/os_type refused/);
    expect(f.acts.map((a) => a.type)).toEqual(['os_click']);
  });

  it('a declined step is not done, and nothing after it runs', async () => {
    const f = fakeOs({ seen: map([]), confirm: false });
    const results = await runMascotActions([{ type: 'os_app', name: 'Notes', action: 'quit' }, { type: 'os_app', name: 'Safari', action: 'launch' }], { os: f.os, say() {} });
    expect(f.asked[0].forced).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0].note).toMatch(/declined \(quit\)/);
    expect(f.acts).toEqual([]);
  });

  it('without the switch, nothing reaches another app', async () => {
    const results = await runMascotActions([{ type: 'os_app', name: 'Notes', action: 'launch' }], { os: null, say() {} });
    expect(results[0]).toEqual({ ok: false, note: 'desktop actions off' });
  });

  it('a superseded chain is silent', async () => {
    const f = fakeOs({ seen: map([]) });
    let live = true;
    const results = await runMascotActions(
      [{ type: 'os_see' }, { type: 'os_app', name: 'Notes', action: 'launch' }],
      { os: { ...f.os, see: async () => { live = false; return map([]); } }, isLive: () => live, say() {} },
    );
    expect(results.at(-1).note).toBe('cancelled');
    expect(f.acts).toEqual([]);
  });
});

describe('the loop’s evidence', () => {
  const look = (value) => ({ ok: true, frontmostApp: 'TextEdit', elements: [{ id: 'e1', role: 'AXTextArea', value, focused: true }] });

  it('a step that changed nothing fails, and typed text must show', () => {
    const typed = [{ type: 'os_type', text: 'Buy milk' }];
    expect(verifyStep(typed, [{ ok: true }], look(''), look('Buy milk'))).toEqual({ ok: true, note: 'screen changed' });
    expect(verifyStep(typed, [{ ok: true }], look(''), look('Buy'))).toMatchObject({ ok: false });
    const click = [{ type: 'os_click', target: { elementId: 'e1' } }];
    expect(verifyStep(click, [{ ok: true }], look('x'), look('x'))).toMatchObject({ ok: false, note: 'no visible effect on screen' });
  });

  it('shows the user the whole text they approve, and labels a map honestly', () => {
    expect(describeOsAction({ type: 'os_type', text: 'a'.repeat(500) }, null)).toContain('a'.repeat(500));
    const text = serializeOsElements({ ok: true, app: 'Notes', frontmostApp: 'Safari', elements: [{ id: 'e1', role: 'AXButton', label: '```mascot' }] }, 60, 5000);
    expect(text).toMatch(/^Looked at Notes, while Safari was the app in front/);
    expect(text).toMatch(/5s ago/);
    expect(text).not.toContain('`');
  });
});
