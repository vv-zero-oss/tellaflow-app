// The assistant's controller against a scripted brain and a fake desktop:
// what reaches the island, what reaches other apps, and what does not.
import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import { createJarvis } from '../../src/main/jarvis/index.js';

const fence = (actions) => `\n\n\`\`\`mascot\n${JSON.stringify({ actions })}\n\`\`\``;

/** A brain that answers each turn with the next scripted reply, streamed in
 *  three pieces like bb's deltas. */
function scriptedThreads(replies) {
  const prompts = [];
  let emit = null;
  return {
    prompts,
    bind: (fn) => { emit = fn; },
    threads: {
      warm: async () => ({ ok: true }),
      stop: async () => {},
      reset: async () => {},
      turn: async (req) => {
        prompts.push(req.prompt);
        const text = replies.shift() ?? 'Done.';
        const third = Math.ceil(text.length / 3);
        for (let i = 1; i <= 3; i++) {
          await new Promise((r) => setTimeout(r, 1));
          emit({ turnId: req.turnId, kind: 'text', text: text.slice(0, third * i) });
        }
        emit({ turnId: req.turnId, kind: 'done', text });
      },
    },
  };
}

function fakeDesktop() {
  const state = { front: 'Finder', doc: '' };
  const acts = [];
  const elements = () => (state.front === 'TextEdit'
    ? [{ id: 'e1', role: 'AXTextArea', value: state.doc, focused: true }]
    : [{ id: 'e9', role: 'AXIcon', label: 'Disk' }]);
  return {
    acts,
    state,
    os: {
      getOsStatus: async () => ({ supported: true, accessibility: true, screenRecording: true, peekaboo: { ok: true } }),
      osSee: async () => ({ ok: true, elements: elements(), app: state.front, frontmostApp: state.front, foreground: true }),
      osAct: async (a) => {
        acts.push(a);
        if (a.type === 'os_app') state.front = a.name;
        if (a.type === 'os_type') state.doc += a.text;
        return { ok: true };
      },
      osInspect: async () => ({ ok: false, error: 'n/a' }),
      captureScreen: async () => ({ ok: false }),
    },
  };
}

function setup({ replies, settings = {}, onShow } = {}) {
  const brain = scriptedThreads(replies);
  const desk = fakeDesktop();
  const shown = [];
  const j = createJarvis({
    island: {
      show: (state, opts) => { shown.push({ state, content: opts?.content }); onShow?.(state, opts, j); },
      rest: () => shown.push({ state: 'rest' }),
    },
    getSettings: () => ({ desktopActions: true, fullAccess: false, screenVision: false, provider: 'auto', ...settings }),
    os: desk.os,
    workspaceDir: path.join(os.tmpdir(), 'tellaflow-jarvis-test'),
    bb: {
      ensureServer: async () => { throw new Error('no bb in unit tests'); },
      createThreads: (emit) => { brain.bind(emit); return brain.threads; },
      workspace: { listWorkspaceThreads: async () => [] },
    },
    log: () => {},
  });
  return { j, brain, desk, shown };
}

describe('assistant controller', () => {
  it('streams the reply onto the island and never shows the fence', async () => {
    const { j, shown } = setup({ replies: ['Seventeen times three is fifty-one, and that is the whole answer.' + fence([{ type: 'end_turn' }])] });
    await j.ask('what is 17 times 3');
    const texts = shown.filter((s) => s.state === 'reply').map((s) => s.content.reply.text);
    expect(texts.at(-1)).toBe('Seventeen times three is fifty-one, and that is the whole answer.');
    expect(new Set(texts.filter(Boolean)).size).toBeGreaterThan(1); // it grew in place
    for (const t of texts) expect(t).not.toContain('`');
    expect(j.transcript().map((t) => t.role)).toEqual(['user', 'mascot']);
  });

  it('asks before acting, runs the loop to task_done, and checks each step', async () => {
    const { j, desk, brain, shown } = setup({
      replies: [
        'Opening TextEdit.' + fence([{ type: 'os_app', name: 'TextEdit', action: 'launch' }]),
        'Typing it.' + fence([{ type: 'os_type', text: 'Buy milk' }]),
        'Done.' + fence([{ type: 'task_done', summary: 'Typed it in TextEdit.' }]),
      ],
      onShow: (state, _o, j) => { if (state === 'approval') setTimeout(() => j.action('approve'), 1); },
    });
    await j.ask('open TextEdit and type buy milk');
    expect(desk.acts.map((a) => a.type)).toEqual(['os_app', 'os_type']);
    expect(desk.state.doc).toBe('Buy milk');
    expect(shown.filter((s) => s.state === 'approval').map((s) => s.content.notice.body)).toEqual(['Open TextEdit', 'Type this:\n\n“Buy milk”']);
    // The second step's prompt was a loop step, with a fresh look and the check.
    expect(brain.prompts[1]).toMatch(/STEP 2 of the desktop task/);
    expect(brain.prompts[1]).toMatch(/step check: screen changed/);
    expect(brain.prompts[1]).toMatch(/Frontmost app: TextEdit/);
    const last = shown.filter((s) => s.state === 'reply').at(-1).content.reply;
    expect(last).toMatchObject({ done: true, working: false });
  });

  it('"No" stops the task and nothing reaches the app', async () => {
    const { j, desk } = setup({
      replies: ['Quitting Notes.' + fence([{ type: 'os_app', name: 'Notes', action: 'quit' }])],
      settings: { fullAccess: true }, // a forced confirmation asks anyway
      onShow: (state, opts, j) => {
        if (state === 'approval') {
          expect(opts.content.notice.secondary).toBeNull(); // no "run the rest" on a forced one
          setTimeout(() => j.action('cancel'), 1);
        }
      },
    });
    await j.ask('quit notes');
    expect(desk.acts).toEqual([]);
    expect(j.transcript().at(-1).actions[0]).toMatch(/declined \(quit\)/);
  });

  it('a question is answered on the island and the answer starts the next turn', async () => {
    const { j, brain } = setup({
      replies: ['Which note?' + fence([{ type: 'ask_user', question: 'Which note?', options: ['Groceries', 'Work'] }]), 'Got it.'],
      onShow: (state, _o, j) => { if (state === 'ask') setTimeout(() => j.action('answer:1'), 1); },
    });
    await j.ask('open my note');
    expect(brain.prompts[1]).toMatch(/USER MESSAGE:\nWork/);
  });

  it('registers the warm thread before bb is up, so a first command cannot race it', async () => {
    const calls = [];
    const { j, brain } = setup({ replies: ['Hi.'] });
    const warm = brain.threads.warm;
    brain.threads.warm = async (...a) => { calls.push('warm'); return warm(...a); };
    const turn = brain.threads.turn;
    brain.threads.turn = async (...a) => { calls.push('turn'); return turn(...a); };
    const warming = j.warm(); // bb fails to start in this test; the warm is still first
    await j.ask('hello');
    await warming;
    expect(calls).toEqual(['warm', 'turn']);
  });

  it('Stop silences the turn', async () => {
    let jRef;
    const { j, shown } = setup({
      replies: ['A long answer that keeps going and going.'],
      onShow: (state, opts) => { if (state === 'reply' && opts.content.reply.text) jRef?.action('stop'); },
    });
    jRef = j;
    await j.ask('tell me something');
    const afterRest = shown.slice(shown.findIndex((s) => s.state === 'rest') + 1);
    expect(afterRest.filter((s) => s.state === 'reply')).toEqual([]);
  });
});
