import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../../src/main/assistant/protocol.js';
import { runAgent, needsApproval } from '../../src/main/assistant/agent.js';
import { createMacTools } from '../../src/main/assistant/mac-tools.js';
import { createClaudeProvider, createCodexProvider, createOllamaProvider } from '../../src/main/assistant/providers.js';

const resolve = async (name) => `/opt/bin/${name}`;

function scripted(replies) {
  const calls = [];
  let i = 0;
  return {
    calls,
    complete: async (prompt, opts) => { calls.push({ prompt, images: opts?.images || [] }); return JSON.stringify(replies[i++]); },
  };
}

const screenTool = {
  name: 'look_at_screen',
  description: 'Look at the screen',
  args: {},
  readOnly: true,
  run: async () => ({ text: 'Screenshot taken.', image: '/tmp/screen-1.jpg' }),
};
const openTool = { name: 'open_app', description: 'open', args: { name: 'string' }, run: async ({ name }) => `Opened ${name}.` };

describe('full access', () => {
  it('runs every action without asking, scripts included', async () => {
    const script = { name: 'run_applescript', description: 's', args: { script: 'string' }, preview: ({ script: x }) => x, run: async () => 'ran' };
    expect(needsApproval(script, { fullAccess: true })).toBe(false);
    const m = scripted([{ action: { tool: 'run_applescript', args: { script: 'beep' } } }, { final: 'Done.' }]);
    let asked = false;
    const res = await runAgent({ request: 'beep', complete: m.complete, tools: [script], approve: async () => { asked = true; return true; }, fullAccess: true });
    expect(asked).toBe(false);
    expect(res.status).toBe('done');
  });
});

describe('seeing the screen', () => {
  it('attaches the screenshot to the next turns and deletes it afterwards', async () => {
    const removed = [];
    const m = scripted([
      { action: { tool: 'look_at_screen', args: {} } },
      { action: { tool: 'open_app', args: { name: 'Safari' } } },
      { final: 'Opened the link you were looking at.' },
    ]);
    const res = await runAgent({
      request: 'open this', complete: m.complete, tools: [screenTool, openTool], approve: async () => true,
      fullAccess: true, vision: true, removeFile: (f) => removed.push(f),
    });
    expect(res.status).toBe('done');
    expect(m.calls.map((c) => c.images)).toEqual([[], ['/tmp/screen-1.jpg'], ['/tmp/screen-1.jpg']]);
    expect(m.calls[1].prompt).toContain('Screenshot taken.');
    expect(removed).toEqual(['/tmp/screen-1.jpg']);
  });

  it('hides look_at_screen from an AI that cannot see images', async () => {
    const m = scripted([{ final: 'ok' }]);
    await runAgent({ request: 'x', complete: m.complete, tools: [screenTool, openTool], approve: async () => true, vision: false });
    expect(m.calls[0].prompt).not.toContain('look_at_screen');
  });

  it('the Mac tool takes a silent screenshot and returns it as an image', async () => {
    const calls = [];
    const tools = createMacTools({ exec: async (cmd, args) => { calls.push([cmd, ...args]); return ''; } });
    const look = tools.find((t) => t.name === 'look_at_screen');
    expect(look.readOnly).toBe(true);
    const out = await look.run({});
    expect(out.image).toMatch(/tellaflow-screen-.*\.jpg$/);
    expect(calls[0]).toEqual(['screencapture', '-x', '-t', 'jpg', out.image]);
  });
});

describe('prompt', () => {
  it('tells the AI to act without asking, about full access and the screen', () => {
    const p = buildPrompt({ tools: [screenTool], request: 'what is this', fullAccess: true, vision: true });
    expect(p).toMatch(/Act, don't ask/);
    expect(p).toMatch(/full access/);
    expect(p).toMatch(/call look_at_screen/);
    const plain = buildPrompt({ tools: [], request: 'x' });
    expect(plain).toMatch(/approval first/);
    expect(plain).not.toMatch(/look_at_screen/);
  });
});

describe('providers with images', () => {
  const readFile = () => Buffer.from('IMG');

  it('claude: sends the screenshot as an image block over stream-json', async () => {
    const calls = [];
    const run = async (cmd, args, opts) => {
      calls.push({ args, input: opts.input });
      return { code: 0, stdout: `${JSON.stringify({ type: 'system' })}\n${JSON.stringify({ type: 'result', result: '{"final":"seen"}', is_error: false })}\n`, stderr: '' };
    };
    const p = createClaudeProvider({ run, resolve, readFile });
    expect(p.vision).toBe(true);
    expect(await p.complete('PROMPT', { images: ['/tmp/s.jpg'] })).toBe('{"final":"seen"}');
    expect(calls[0].args).toEqual(expect.arrayContaining(['--input-format', 'stream-json', '--output-format', 'stream-json', '--tools', '']));
    const msg = JSON.parse(calls[0].input);
    expect(msg.message.content).toEqual([
      { type: 'text', text: 'PROMPT' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('IMG').toString('base64') } },
    ]);
  });

  it('codex: passes the screenshot with --image', async () => {
    const calls = [];
    const run = async (cmd, args) => { calls.push(args); return { code: 0, stdout: 'x', stderr: '' }; };
    await createCodexProvider({ run, resolve }).complete('P', { images: ['/tmp/s.jpg'] });
    expect(calls[0]).toEqual(expect.arrayContaining(['--image', '/tmp/s.jpg']));
  });

  it('ollama: base64 images on the message', async () => {
    let body = null;
    const http = async (url, opts) => { if (opts?.body) body = opts.body; return url.endsWith('/api/tags') ? { models: [{ name: 'llava' }] } : { message: { content: '{}' } }; };
    await createOllamaProvider({ http, readFile }).complete('P', { images: ['/tmp/s.jpg'] });
    expect(body.messages[0].images).toEqual([Buffer.from('IMG').toString('base64')]);
  });
});
