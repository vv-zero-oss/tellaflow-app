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

function setup({ replies, settings = {}, onShow, extra = {}, os: osOverride, bbExtra = {} } = {}) {
  const brain = scriptedThreads(replies);
  const desk = fakeDesktop();
  const shown = [];
  const j = createJarvis({
    island: {
      show: (state, opts) => { shown.push({ state, content: opts?.content }); onShow?.(state, opts, j); },
      rest: () => shown.push({ state: 'rest' }),
    },
    getSettings: () => ({ desktopActions: true, fullAccess: false, screenVision: false, provider: 'auto', ...settings }),
    os: osOverride ?? desk.os,
    ...extra,
    workspaceDir: path.join(os.tmpdir(), 'tellaflow-jarvis-test'),
    bb: {
      ensureServer: async () => { throw new Error('no bb in unit tests'); },
      createThreads: (emit) => { brain.bind(emit); return brain.threads; },
      workspace: { listWorkspaceThreads: async () => [] },
      ...bbExtra,
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
    // The step is the title; what it will type is quoted whole underneath.
    expect(shown.filter((s) => s.state === 'approval').map((s) => [s.content.notice.title, s.content.notice.quote])).toEqual([
      ['Open TextEdit?', undefined],
      ['Type this text?', 'Buy milk'],
    ]);
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
          expect(opts.content.notice.footnote).toMatch(/unsaved work/);
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

  it('an answer in words can be inserted or copied, and is saved with the transcripts', async () => {
    const inserted = [];
    const copied = [];
    const saved = [];
    const { j, shown } = setup({
      replies: ['Dear Sam, thanks for the notes — Thursday works for me.'],
      extra: { insertText: (t) => inserted.push(t), copyText: (t) => copied.push(t), saveAnswer: (a) => saved.push(a) },
    });
    await j.ask('draft a reply to Sam saying Thursday works');
    const last = shown.filter((x) => x.state === 'reply').at(-1).content.reply;
    expect(last.canInsert).toBe(true);
    expect(saved).toEqual([{ request: 'draft a reply to Sam saying Thursday works', text: 'Dear Sam, thanks for the notes — Thursday works for me.' }]);
    j.action('copy');
    expect(copied).toEqual([saved[0].text]);
    expect(shown.filter((x) => x.state === 'reply').at(-1).content.reply.copied).toBe(true);
    j.action('insert');
    expect(inserted).toEqual([saved[0].text]);
  });

  it('a desktop task is not offered for Insert', async () => {
    const { j, shown } = setup({
      replies: ['Opening Notes.' + fence([{ type: 'os_app', name: 'Notes', action: 'launch' }]), 'Done.' + fence([{ type: 'task_done', summary: 'Opened Notes.' }])],
      settings: { fullAccess: true },
      extra: { insertText: () => {} },
    });
    await j.ask('open notes');
    const last = shown.filter((x) => x.state === 'reply').at(-1).content.reply;
    expect(last).toMatchObject({ done: true, canInsert: false, step: 2 });
  });

  it('a missing helper is offered on the island, installed with progress, and the request runs again', async () => {
    let installed = false;
    const desk = fakeDesktop();
    const os2 = {
      ...desk.os,
      getOsStatus: async () => (installed
        ? { supported: true, accessibility: true, screenRecording: true, peekaboo: { ok: true } }
        : { supported: false, accessibility: false, screenRecording: false, peekaboo: { ok: false, error: 'the desktop helper isn’t installed yet — install it from Settings › Assistant' } }),
    };
    const { j, shown } = setup({
      replies: [
        'Opening Notes.' + fence([{ type: 'os_app', name: 'Notes', action: 'launch' }]),
        'Opening Notes.' + fence([{ type: 'os_app', name: 'Notes', action: 'launch' }]),
        'Done.' + fence([{ type: 'task_done', summary: 'Opened Notes.' }]),
      ],
      settings: { fullAccess: true },
      os: os2,
      extra: { installHelper: async (progress) => { progress(5, 10); installed = true; } },
    });
    await j.ask('open notes');
    const offer = shown.filter((x) => x.state === 'setup').at(-1).content.notice;
    expect(offer).toMatchObject({ primary: 'Install', primaryAction: 'install-helper' });
    j.action('install-helper');
    await new Promise((r) => setTimeout(r, 200));
    expect(shown.some((x) => x.state === 'setup' && x.content.notice.progress === 0.5)).toBe(true);
    expect(desk.acts.map((a) => a.type)).toEqual(['os_app']);
  });

  it('a signed-out AI offers Sign in on the island', async () => {
    const signIns = [];
    const brain = setup({ extra: { signIn: () => signIns.push(1) } });
    brain.brain.threads.turn = async (req) => { throw new Error('Claude Code is not authenticated'); };
    await brain.j.ask('hello');
    const card = brain.shown.filter((x) => x.state === 'error').at(-1).content.notice;
    expect(card).toMatchObject({ title: 'Sign in to your AI', primaryAction: 'sign-in', secondaryAction: 'open-settings' });
    brain.j.action('sign-in');
    expect(signIns).toEqual([1]);
  });
});

describe('instant commands', () => {
  const quick = (over = {}) => {
    const ran = [];
    return {
      ran,
      quick: {
        match: (t) => (/screenshot/.test(t) ? { id: 'screenshot' } : /^open (\w+)$/.test(t) ? { id: 'open-app', app: /^open (\w+)$/.exec(t)[1] } : null),
        run: async (m) => { ran.push(m); return m.app === 'nothing' ? { ok: false, error: 'no such app' } : { ok: true, text: m.id === 'screenshot' ? 'Screenshot saved to your Desktop.' : `Opened ${m.app}.` }; },
        ...over,
      },
    };
  };

  it('runs a simple command at once, without the AI, and remembers it', async () => {
    const q = quick();
    const { j, brain, shown } = setup({ replies: [], extra: { quick: q.quick } });
    await j.ask('take a screenshot');
    expect(brain.prompts).toEqual([]);
    expect(q.ran).toEqual([{ id: 'screenshot' }]);
    // The island steps aside for the screenshot, then confirms.
    expect(shown[0].state).toBe('rest');
    const last = shown.filter((s) => s.state === 'reply').at(-1).content.reply;
    expect(last).toMatchObject({ text: 'Screenshot saved to your Desktop.', done: true, working: false, canInsert: false });
    expect(j.transcript()).toMatchObject([
      { role: 'user', text: 'take a screenshot' },
      { role: 'mascot', text: 'Screenshot saved to your Desktop.', actions: ['instant screenshot → done'] },
    ]);
  });

  it('hands the request to the AI when the command fails', async () => {
    const q = quick();
    const { j, brain } = setup({ replies: ['I could not find an app called nothing.'], extra: { quick: q.quick } });
    await j.ask('open nothing');
    expect(q.ran).toHaveLength(1);
    expect(brain.prompts).toHaveLength(1);
    expect(brain.prompts[0]).toMatch(/USER MESSAGE:\nopen nothing/);
  });

  it('is skipped when switched off in Settings', async () => {
    const q = quick();
    const { j, brain } = setup({ replies: ['Done.'], settings: { instantCommands: false }, extra: { quick: q.quick } });
    await j.ask('open Notes');
    expect(q.ran).toEqual([]);
    expect(brain.prompts).toHaveLength(1);
  });

  it('anything else goes to the AI as before', async () => {
    const q = quick();
    const { j, brain } = setup({ replies: ['It is 31 degrees in Mumbai.'], extra: { quick: q.quick } });
    await j.ask('what is the weather in mumbai');
    expect(q.ran).toEqual([]);
    expect(brain.prompts).toHaveLength(1);
  });
});

describe('chats talking back on the island (the bridge)', () => {
  function bridged(opts = {}) {
    let send = null;
    const answers = [];
    const s = setup({
      ...opts,
      bbExtra: {
        ensureServer: async () => ({ client: { origin: 'http://bb' } }),
        createBridge: (onEvent) => { send = onEvent; return { ensure: async () => true, start() {}, stop() {}, answer: async (id, a) => { answers.push([id, a]); return true; } }; },
        workspace: { listWorkspaceThreads: async () => [{ id: 'thr_chat', title: 'Trip plan', createdAt: 0 }], threadUrl: (o, p, t) => `${o}/projects/${p}/threads/${t}` },
      },
    });
    return { ...s, send: (e) => send(e), answers };
  }
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it("shows a chat's answer as a reply, remembers it, and can open the chat", async () => {
    const opened = [];
    const { j, send, shown } = bridged({ extra: { openChat: (u) => opened.push(u) } });
    send({ seq: 1, type: 'say', kind: 'answer', text: 'Your 3-day Goa plan is ready.', threadId: 'thr_chat', projectId: 'proj_1' });
    await settle();
    const card = shown.filter((s) => s.state === 'reply').at(-1).content.reply;
    expect(card).toMatchObject({ title: 'Trip plan', text: 'Your 3-day Goa plan is ready.', done: true });
    expect(j.transcript().at(-1).text).toMatch(/the chat "Trip plan" reported back\) Your 3-day Goa plan is ready\./);
    expect(j.action('open-chat')).toBe(true);
    expect(opened).toEqual(['http://bb/projects/proj_1/threads/thr_chat']);
  });

  it("asks the chat's question on the island and posts the answer back", async () => {
    const { send, shown, answers } = bridged({
      onShow: (state, _o, j) => { if (state === 'ask') setTimeout(() => j.action('answer:1'), 1); },
    });
    send({ seq: 1, type: 'ask', id: 'ask_1', question: 'Beach or hills?', options: ['Beach', 'Hills'], threadId: 'thr_chat' });
    await settle();
    expect(shown.find((s) => s.state === 'ask').content.ask).toEqual({ question: 'Trip plan asks: Beach or hills?', options: ['Beach', 'Hills'] });
    expect(answers).toEqual([['ask_1', 'Hills']]);
  });

  it('a spoken answer answers the chat too', async () => {
    const { j, send, answers } = bridged();
    send({ seq: 1, type: 'ask', id: 'ask_2', question: 'How many days?', options: [], threadId: 'thr_chat' });
    await settle();
    await j.ask('four days');
    expect(answers).toEqual([['ask_2', 'four days']]);
  });

  it('waits for a turn in flight before taking the island', async () => {
    let release;
    const { j, send, shown, brain } = bridged({ replies: ['Fine.'] });
    const turn = brain.threads.turn;
    brain.threads.turn = async (req) => { await new Promise((r) => { release = r; }); return turn(req); };
    const asking = j.ask('how are you');
    await settle();
    send({ seq: 1, type: 'say', kind: 'answer', text: 'The report is done.', threadId: 'thr_chat' });
    await settle();
    expect(shown.some((s) => s.content?.reply?.text === 'The report is done.')).toBe(false);
    release();
    await asking;
    await new Promise((r) => setTimeout(r, 1700));
    expect(shown.filter((s) => s.state === 'reply').at(-1).content.reply.text).toBe('The report is done.');
  });

  it("the island's own thread is part of the turn, not a report", async () => {
    const { send, shown, brain } = bridged({ replies: [] });
    brain.threads.owns = (id) => id === 'thr_mascot';
    send({ seq: 1, type: 'say', kind: 'answer', text: 'should not show', threadId: 'thr_mascot' });
    await settle();
    expect(shown).toEqual([]);
  });
});
