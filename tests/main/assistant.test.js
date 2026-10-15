import { describe, it, expect } from 'vitest';
import { buildPrompt, parseStep, extractJsonObject } from '../../src/main/assistant/protocol.js';
import { runAgent, needsApproval } from '../../src/main/assistant/agent.js';
import { createMacTools, dateParts } from '../../src/main/assistant/mac-tools.js';
import {
  createClaudeProvider,
  createCodexProvider,
  createGeminiProvider,
  createOllamaProvider,
  pickProvider,
} from '../../src/main/assistant/providers.js';
import { createAssistantService } from '../../src/main/assistant/index.js';

// ─── protocol ────────────────────────────────────────────────────────────────

describe('step protocol', () => {
  const tools = [{ name: 'open_app', description: 'Open an app', args: { name: 'string' } }];

  it('prompt lists tools, the request and prior steps', () => {
    const p = buildPrompt({
      tools,
      request: 'open safari',
      history: [{ kind: 'action', thought: 't', tool: 'open_app', args: { name: 'Safari' }, result: { ok: true, output: 'Opened' } }],
      now: new Date(0),
    });
    expect(p).toContain('- open_app(name: string) — Open an app');
    expect(p).toContain('USER REQUEST: open safari');
    expect(p).toContain('"tool":"open_app"');
    expect(p).toContain('RESULT: {"ok":true,"output":"Opened"}');
  });

  it('extracts JSON even when wrapped in prose or code fences', () => {
    expect(extractJsonObject('Sure!\n```json\n{"final": "done {ok}"}\n```')).toEqual({ final: 'done {ok}' });
    expect(extractJsonObject('{"a": {"b": "}"}} trailing')).toEqual({ a: { b: '}' } });
    expect(extractJsonObject('no json here')).toBeNull();
  });

  it('parses actions and finals, rejecting unknown tools', () => {
    expect(parseStep('{"thought":"x","action":{"tool":"open_app","args":{"name":"Safari"}}}', ['open_app']))
      .toEqual({ thought: 'x', action: { tool: 'open_app', args: { name: 'Safari' } } });
    expect(parseStep('{"final":"All set"}', ['open_app'])).toEqual({ thought: '', final: 'All set' });
    expect(() => parseStep('{"action":{"tool":"rm_rf"}}', ['open_app'])).toThrow(/Unknown tool/);
    expect(() => parseStep('hello', ['open_app'])).toThrow(/not a JSON/);
  });
});

// ─── agent loop ──────────────────────────────────────────────────────────────

function scripted(replies) {
  const prompts = [];
  return {
    prompts,
    complete: async (prompt) => {
      prompts.push(prompt);
      const r = replies.shift();
      if (r instanceof Error) throw r;
      return typeof r === 'string' ? r : JSON.stringify(r);
    },
  };
}

function fakeTools(log) {
  return [
    { name: 'get_date_time', description: 'now', args: {}, readOnly: true, run: async () => 'Tue 10:00' },
    { name: 'open_app', description: 'open', args: { name: 'string' }, run: async ({ name }) => { log.push(['open', name]); return `Opened ${name}.`; } },
    { name: 'run_applescript', description: 'script', args: { script: 'string' }, alwaysAsk: true, preview: ({ script }) => script, run: async ({ script }) => { log.push(['as', script]); return 'ran'; } },
    { name: 'flaky', description: 'fails', args: {}, run: async () => { throw new Error('Safari is not installed'); } },
  ];
}

describe('agent loop', () => {
  it('runs thought → action → result → final and reports every step', async () => {
    const log = [];
    const m = scripted([
      { thought: 'Need Safari', action: { tool: 'open_app', args: { name: 'Safari' } } },
      { thought: 'Done', final: 'Safari is open.' },
    ]);
    const steps = [];
    const res = await runAgent({ request: 'open safari', complete: m.complete, tools: fakeTools(log), approve: async () => true, onStep: (s) => steps.push(s) });
    expect(res).toMatchObject({ status: 'done', final: 'Safari is open.' });
    expect(log).toEqual([['open', 'Safari']]);
    expect(steps.map((s) => s.type)).toEqual(['thought', 'action', 'approval', 'approval', 'result', 'thought', 'final']);
    // the second prompt carries the tool result back to the model
    expect(m.prompts[1]).toContain('Opened Safari.');
  });

  it('read-only tools never ask; auto-approve skips asking for normal tools', async () => {
    const tools = fakeTools([]);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(needsApproval(byName.get_date_time, { autoApprove: false })).toBe(false);
    expect(needsApproval(byName.open_app, { autoApprove: false })).toBe(true);
    expect(needsApproval(byName.open_app, { autoApprove: true })).toBe(false);
    expect(needsApproval(byName.run_applescript, { autoApprove: true })).toBe(true);
  });

  it('a denied action is not executed and the model is told', async () => {
    const log = [];
    const m = scripted([
      { action: { tool: 'run_applescript', args: { script: 'beep' } } },
      { final: 'Okay, I did not run it.' },
    ]);
    const res = await runAgent({ request: 'beep', complete: m.complete, tools: fakeTools(log), approve: async () => false, autoApprove: true });
    expect(log).toEqual([]);
    expect(res.final).toBe('Okay, I did not run it.');
    expect(m.prompts[1]).toContain('The user denied this action.');
  });

  it('feeds tool errors back so the model can adapt', async () => {
    const m = scripted([{ action: { tool: 'flaky', args: {} } }, { final: 'Could not do it: Safari is not installed.' }]);
    const steps = [];
    await runAgent({ request: 'x', complete: m.complete, tools: fakeTools([]), approve: async () => true, autoApprove: true, onStep: (s) => steps.push(s) });
    expect(steps.find((s) => s.type === 'result')).toMatchObject({ ok: false, error: 'Safari is not installed' });
    expect(m.prompts[1]).toContain('Safari is not installed');
  });

  it('recovers from one malformed reply, gives up after two', async () => {
    const ok = scripted(['I think I should open it', { final: 'done' }]);
    expect((await runAgent({ request: 'x', complete: ok.complete, tools: fakeTools([]), approve: async () => true })).status).toBe('done');
    expect(ok.prompts[1]).toContain('Reply was not a JSON object.');

    const bad = scripted(['nope', 'still nope']);
    expect((await runAgent({ request: 'x', complete: bad.complete, tools: fakeTools([]), approve: async () => true })).status).toBe('error');
  });

  it('stops at maxSteps and on cancel', async () => {
    const loop = { complete: async () => JSON.stringify({ action: { tool: 'get_date_time', args: {} } }) };
    expect((await runAgent({ request: 'x', complete: loop.complete, tools: fakeTools([]), approve: async () => true, maxSteps: 3 })).status).toBe('max-steps');

    const ctrl = new AbortController();
    ctrl.abort();
    expect((await runAgent({ request: 'x', complete: loop.complete, tools: fakeTools([]), approve: async () => true, signal: ctrl.signal })).status).toBe('cancelled');
  });

  it('surfaces provider errors', async () => {
    const m = scripted([new Error('claude is installed but not signed in')]);
    const res = await runAgent({ request: 'x', complete: m.complete, tools: fakeTools([]), approve: async () => true });
    expect(res.status).toBe('error');
    expect(res.steps.at(-1).text).toMatch(/not signed in/);
  });
});

// ─── Mac tools (AppleScript injection safety) ────────────────────────────────

describe('mac tools', () => {
  function recorder() {
    const calls = [];
    const tools = createMacTools({
      applescript: async (body, argv) => { calls.push({ kind: 'as', body, argv }); return 'ok'; },
      rawAppleScript: async (src) => { calls.push({ kind: 'raw', src }); return 'raw ok'; },
      exec: async (cmd, args) => { calls.push({ kind: 'exec', cmd, args }); return ''; },
      exists: (p) => p.startsWith('/Users/me'),
      home: () => '/Users/me',
      now: () => new Date('2026-10-15T09:30:00'),
    });
    const t = Object.fromEntries(tools.map((x) => [x.name, x]));
    return { t, calls };
  }

  const EVIL = 'x" & (do shell script "rm -rf ~") & "';

  it('passes user text only as argv, never inside script source', async () => {
    const { t, calls } = recorder();
    await t.create_reminder.run({ title: EVIL, notes: EVIL });
    await t.create_note.run({ title: EVIL, body: EVIL });
    await t.show_notification.run({ title: EVIL, message: EVIL });
    await t.set_clipboard.run({ text: EVIL });
    await t.quit_app.run({ name: EVIL });
    for (const c of calls) {
      expect(c.body).not.toContain('rm -rf');
      expect(c.argv.join(' ')).toContain('rm -rf');
    }
    // HTML for Notes is escaped
    expect(calls[1].argv[1]).toContain('&amp;');
  });

  it('open_app / say use execFile argv, no shell', async () => {
    const { t, calls } = recorder();
    await t.open_app.run({ name: 'Visual Studio Code' });
    await t.say.run({ text: EVIL });
    expect(calls).toEqual([
      { kind: 'exec', cmd: 'open', args: ['-a', 'Visual Studio Code'] },
      { kind: 'exec', cmd: 'say', args: [EVIL] },
    ]);
  });

  it('validates URLs, volume, media commands and folders', async () => {
    const { t } = recorder();
    expect(() => t.open_url.validate({ url: 'file:///etc/passwd' })).toThrow(/Only http/);
    expect(() => t.open_url.validate({ url: 'javascript:alert(1)' })).toThrow();
    expect(() => t.open_url.validate({ url: 'https://example.com' })).not.toThrow();
    expect(() => t.set_volume.validate({ level: 150 })).toThrow();
    expect(() => t.media_control.validate({ app: 'Terminal', command: 'play' })).toThrow();
    expect(() => t.media_control.validate({ app: 'spotify', command: 'next' })).not.toThrow();
    await expect(t.open_folder.run({ path: '/etc' })).rejects.toThrow(/No such/);
    await expect(t.open_folder.run({ path: '~/Downloads' })).resolves.toMatch('/Users/me/Downloads');
  });

  it('media control uses only allow-listed literals', async () => {
    const { t, calls } = recorder();
    await t.media_control.run({ app: 'SPOTIFY', command: 'Next' });
    expect(calls[0].body).toBe('tell application "Spotify" to next track');
  });

  it('builds calendar dates from numeric argv parts', async () => {
    const { t, calls } = recorder();
    await t.create_calendar_event.run({ title: 'Standup', start: '2026-10-16T10:15', durationMinutes: 15 });
    expect(calls[0].argv).toEqual(['Standup', 15, '', 2026, 10, 16, 10, 15]);
    expect(dateParts('2026-01-02T03:04', 'd')).toEqual([2026, 1, 2, 3, 4]);
    expect(() => dateParts('next tuesday', 'start')).toThrow(/ISO/);
  });

  it('run_applescript always asks and previews the script', () => {
    const { t } = recorder();
    expect(t.run_applescript.alwaysAsk).toBe(true);
    expect(t.run_applescript.preview({ script: 'beep 2' })).toBe('beep 2');
  });

  it('has no shell tool', () => {
    const { t } = recorder();
    expect(Object.keys(t).some((n) => /shell|exec|bash|terminal/i.test(n))).toBe(false);
  });
});

// ─── providers (no API keys; injected process runner) ────────────────────────

describe('providers', () => {
  const resolve = async (name) => `/opt/bin/${name}`;

  it('claude: tools disabled, prompt on stdin, JSON result parsed', async () => {
    const calls = [];
    const run = async (cmd, args, opts) => { calls.push({ cmd, args, input: opts.input }); return { code: 0, stdout: JSON.stringify({ result: '{"final":"hi"}', is_error: false }), stderr: '' }; };
    const p = createClaudeProvider({ run, resolve });
    expect(await p.complete('PROMPT')).toBe('{"final":"hi"}');
    expect(calls[0].cmd).toBe('/opt/bin/claude');
    expect(calls[0].args).toEqual(expect.arrayContaining(['-p', '--tools', '', '--output-format', 'json']));
    expect(calls[0].input).toBe('PROMPT');
  });

  it('claude: explains when the CLI is not signed in', async () => {
    const run = async () => ({ code: 1, stdout: '', stderr: 'Invalid API key · Please run /login' });
    await expect(createClaudeProvider({ run, resolve }).complete('x')).rejects.toThrow(/not signed in/);
  });

  it('codex: read-only sandbox, prompt on stdin', async () => {
    const calls = [];
    const run = async (cmd, args, opts) => { calls.push({ args, input: opts.input }); return { code: 0, stdout: 'fallback', stderr: '' }; };
    expect(await createCodexProvider({ run, resolve }).complete('P')).toBe('fallback');
    expect(calls[0].args).toEqual(expect.arrayContaining(['exec', '--sandbox', 'read-only', '-']));
    expect(calls[0].input).toBe('P');
  });

  it('gemini: prompt on stdin', async () => {
    const calls = [];
    const run = async (cmd, args, opts) => { calls.push({ args, input: opts.input }); return { code: 0, stdout: '{"final":"g"}', stderr: '' }; };
    expect(await createGeminiProvider({ run, resolve }).complete('P')).toBe('{"final":"g"}');
    expect(calls[0].input).toBe('P');
  });

  it('ollama: picks the first local model and requests JSON', async () => {
    const calls = [];
    const http = async (url, opts = {}) => {
      calls.push({ url, body: opts.body });
      if (url.endsWith('/api/tags')) return { models: [{ name: 'llama3.2' }] };
      return { message: { content: '{"final":"o"}' } };
    };
    const p = createOllamaProvider({ http });
    expect(await p.detect()).toMatchObject({ available: true, models: ['llama3.2'] });
    expect(await p.complete('P')).toBe('{"final":"o"}');
    expect(calls.at(-1).body).toMatchObject({ model: 'llama3.2', format: 'json', stream: false });
  });

  it('auto picks the first available provider in order', async () => {
    const mk = (id, available) => ({ id, label: id, detect: async () => ({ available }) });
    const providers = { claude: mk('claude', false), codex: mk('codex', true), gemini: mk('gemini', true), ollama: mk('ollama', false) };
    expect((await pickProvider(providers, 'auto')).id).toBe('codex');
    expect((await pickProvider(providers, 'gemini')).id).toBe('gemini');
    expect(await pickProvider({ ...providers, codex: mk('codex', false), gemini: mk('gemini', false) }, 'auto')).toBeNull();
  });
});

// ─── service ─────────────────────────────────────────────────────────────────

describe('assistant service', () => {
  it('routes approvals from the UI to the running agent and saves the result', async () => {
    const sent = [];
    const saved = [];
    const replies = [
      { thought: 'open it', action: { tool: 'open_app', args: { name: 'Notes' } } },
      { final: 'Notes is open.' },
    ];
    const provider = { id: 'claude', label: 'Claude', detect: async () => ({ available: true }), complete: async () => JSON.stringify(replies.shift()) };
    const svc = createAssistantService({
      getSettings: () => ({ provider: 'auto', autoApprove: false }),
      send: (ch, d) => sent.push([ch, d]),
      saveToHistory: (t) => saved.push(t),
      providers: { claude: provider, codex: provider, gemini: provider, ollama: provider },
      tools: fakeTools([]),
      log: { error() {} },
    });
    const runId = await svc.start('open notes');
    // wait for the approval request
    for (let i = 0; i < 50 && !sent.some(([ch, d]) => ch === 'assistant-step' && d.step.type === 'approval'); i++) await new Promise((r) => setTimeout(r, 5));
    const approval = sent.find(([ch, d]) => ch === 'assistant-step' && d.step.type === 'approval')[1].step;
    expect(svc.respondApproval(runId, approval.actionId, true)).toBe(true);
    for (let i = 0; i < 50 && !saved.length; i++) await new Promise((r) => setTimeout(r, 5));
    expect(saved).toEqual(['Assistant: open notes\n\nNotes is open.']);
    expect(svc.listRuns()[0]).toMatchObject({ status: 'done', provider: 'claude' });
  });

  it('reports a clear error when no AI is available', async () => {
    const sent = [];
    const none = { id: 'x', label: 'x', detect: async () => ({ available: false }) };
    const svc = createAssistantService({ getSettings: () => ({ provider: 'auto' }), send: (ch, d) => sent.push([ch, d]), providers: { claude: none, codex: none, gemini: none, ollama: none }, tools: [] });
    await svc.start('hi');
    expect(svc.listRuns()[0].status).toBe('error');
    expect(svc.listRuns()[0].steps[0].text).toMatch(/No AI is available/);
  });
});
