import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createIslandAssistant, actionLabel } = require('../../src/main/island-assistant');

function setup() {
  const shown = [];
  const island = {
    show: vi.fn((state, opts) => shown.push({ state, ...opts })),
    rest: vi.fn(),
  };
  const assistant = { respondApproval: vi.fn() };
  const startSignIn = vi.fn();
  const openSettings = vi.fn();
  const ia = createIslandAssistant({ island, assistant, startSignIn, openSettings });
  const last = () => shown[shown.length - 1];
  const step = (runId, s) => ia.handle('assistant-step', { runId, step: s });
  return { ia, island, assistant, startSignIn, openSettings, shown, last, step };
}

describe('island assistant', () => {
  it('shows thinking, then a plan, then the answer', () => {
    const t = setup();
    t.ia.expect('open safari');
    expect(t.last().state).toBe('thinking');

    t.ia.handle('assistant-run', { id: 'r1', request: 'open safari', status: 'running', provider: 'claude' });
    t.step('r1', { id: 2, type: 'action', tool: 'open_app', args: { name: 'Safari' } });
    expect(t.last().state).toBe('plan');
    expect(t.last().content.plan.steps).toEqual([{ label: 'Open app: Safari', status: 'current' }]);

    t.step('r1', { id: 3, type: 'result', actionId: 2, ok: true });
    expect(t.last().content.plan.steps[0].status).toBe('done');

    t.step('r1', { id: 4, type: 'final', text: 'Safari is open.' });
    expect(t.last().state).toBe('answer');
    expect(t.last().content.answerText).toBe('Safari is open.');
    expect(t.last().autoRestMs).toBeGreaterThan(0);
  });

  it('ignores runs it was not asked to show', () => {
    const t = setup();
    t.ia.handle('assistant-run', { id: 'typed', request: 'typed in the app', status: 'running' });
    t.step('typed', { id: 1, type: 'final', text: 'hi' });
    expect(t.shown).toEqual([]);
  });

  it('routes approval buttons to the pending action', () => {
    const t = setup();
    t.ia.expect('quit music');
    t.ia.handle('assistant-run', { id: 'r2', request: 'quit music', status: 'running' });
    t.step('r2', { id: 2, type: 'action', tool: 'quit_app', args: { name: 'Music' } });
    t.step('r2', { id: 3, type: 'approval', actionId: 2, status: 'pending', tool: 'quit_app' });
    expect(t.last().state).toBe('approval');
    expect(t.last().content.notice).toMatchObject({ title: 'Allow Quit app: Music?', primary: 'Allow', tertiary: 'Deny' });

    expect(t.ia.action('approve')).toBe(true);
    expect(t.assistant.respondApproval).toHaveBeenCalledWith('r2', 2, true);
  });

  it('turns "not signed in" into a setup card whose button starts sign-in', () => {
    const t = setup();
    t.ia.expect('how');
    t.ia.handle('assistant-run', { id: 'r3', request: 'how', status: 'running', provider: 'claude' });
    t.step('r3', { id: 1, type: 'error', text: 'AI provider error: claude is installed but not signed in. Run `claude` in Terminal once to sign in.' });
    expect(t.last().state).toBe('setup');
    expect(t.last().content.notice.title).toBe('Sign in to Claude');

    t.ia.action('open-settings');
    expect(t.startSignIn).toHaveBeenCalledWith('claude');
  });

  it('catches the "no AI" error even when it arrives before start() returns', () => {
    const t = setup();
    t.ia.expect('  hello  ');
    // assistant.start reports the run and its error synchronously.
    t.ia.handle('assistant-run', { id: 'r4', request: 'hello', status: 'running' });
    t.step('r4', { id: 1, type: 'error', text: 'No AI is available. Sign in to Claude Code…' });
    expect(t.last().state).toBe('setup');
    t.ia.action('open-settings');
    expect(t.openSettings).toHaveBeenCalled();
  });

  it('offers to retry other errors', () => {
    const t = setup();
    t.ia.expect('do it');
    t.ia.handle('assistant-run', { id: 'r5', request: 'do it', status: 'running' });
    t.step('r5', { id: 1, type: 'error', text: "The AI didn't follow the step format" });
    expect(t.last().state).toBe('error');
    expect(t.ia.action('retry')).toEqual({ retry: 'do it' });
  });
});

describe('actionLabel', () => {
  it('names the action and its first argument', () => {
    expect(actionLabel('create_note', { title: 'Groceries', body: 'eggs' })).toBe('Create note: Groceries');
    expect(actionLabel('get_date_time', {})).toBe('Get date time');
  });
});
