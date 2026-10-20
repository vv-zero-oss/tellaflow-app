// The bb plugin (resources/bb-plugin-tellaflow/server.js) against a fake bb
// plugin API: the tools queue events, the routes serve and answer them.
import { describe, it, expect } from 'vitest';
import plugin from '../../resources/bb-plugin-tellaflow/server.js';

function fakeApi() {
  const routes = new Map();
  const tools = new Map();
  let configure = null;
  const bb = {
    log: { info: () => {} },
    http: { route: (method, p, handler) => routes.set(`${method} ${p}`, handler) },
    agents: {
      registerTool: (t) => tools.set(t.name, t),
      configure: (fn) => { configure = fn; },
    },
    onDispose: () => {},
  };
  plugin(bb);
  /** Call a route like Hono would. */
  async function call(method, p, { query = {}, body } = {}) {
    let status = 200;
    let out;
    const c = {
      req: { query: (k) => query[k], json: async () => body, raw: {} },
      json: (v, s) => { out = v; status = s ?? 200; return v; },
    };
    await routes.get(`${method} ${p}`)(c);
    return { status, body: out };
  }
  return { tools, call, configure: () => configure({}) };
}

const ctx = { threadId: 'thr_1', projectId: 'proj_1' };

describe('bb-plugin-tellaflow', () => {
  it('offers both tools and the island instructions to every thread', () => {
    const api = fakeApi();
    expect([...api.tools.keys()]).toEqual(['tellaflow_say', 'tellaflow_ask']);
    const conf = api.configure();
    expect(conf.tools).toEqual(['tellaflow_say', 'tellaflow_ask']);
    expect(conf.instructions).toMatch(/tellaflow_say ONCE/);
    expect(conf.instructions.length).toBeLessThanOrEqual(4096);
  });

  it('tellaflow_say queues an event the long-poll returns', async () => {
    const api = fakeApi();
    await api.tools.get('tellaflow_say').execute({ text: '  It is   31°C in Mumbai. ', kind: 'answer' }, ctx);
    const r = await api.call('GET', '/events', { query: { after: '0' } });
    expect(r.body.seq).toBe(1);
    expect(r.body.events).toMatchObject([{ seq: 1, type: 'say', kind: 'answer', text: 'It is 31°C in Mumbai.', threadId: 'thr_1', projectId: 'proj_1' }]);
    expect((await api.call('GET', '/events', { query: { after: '1' } })).body.events).toEqual([]);
  });

  it('a long-poll waits for the next event', async () => {
    const api = fakeApi();
    const poll = api.call('GET', '/events', { query: { after: '0', wait: '2000' } });
    setTimeout(() => api.tools.get('tellaflow_say').execute({ text: 'Done.' }, ctx), 20);
    const r = await poll;
    expect(r.body.events.map((e) => e.text)).toEqual(['Done.']);
  });

  it('tellaflow_ask waits for the answer posted back, then closes the question', async () => {
    const api = fakeApi();
    const asking = api.tools.get('tellaflow_ask').execute({ question: 'Words or digits?', options: ['Words', 'Digits', '', 'x', 'y'] }, ctx);
    const { body } = await api.call('GET', '/events', { query: { after: '0' } });
    const ask = body.events[0];
    expect(ask).toMatchObject({ type: 'ask', question: 'Words or digits?', options: ['Words', 'Digits', 'x', 'y'] });
    expect((await api.call('POST', '/answer', { body: { id: ask.id, answer: 'Digits' } })).status).toBe(200);
    expect(await asking).toBe('The user answered: Digits');
    const after = await api.call('GET', '/events', { query: { after: String(ask.seq) } });
    expect(after.body.events).toMatchObject([{ type: 'ask-closed', id: ask.id }]);
    // A second answer to the same question finds nothing open.
    expect((await api.call('POST', '/answer', { body: { id: ask.id, answer: 'Words' } })).status).toBe(404);
  });

  it('no answer tells the agent to carry on with its own judgement', async () => {
    const api = fakeApi();
    const asking = api.tools.get('tellaflow_ask').execute({ question: 'Which?' }, ctx);
    const { body } = await api.call('GET', '/events', { query: { after: '0' } });
    await api.call('POST', '/answer', { body: { id: body.events[0].id, answer: null } });
    const r = await asking;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/best judgement/);
  });

  it('reports a reset to a poller that is ahead (the plugin restarted)', async () => {
    const api = fakeApi();
    await api.tools.get('tellaflow_say').execute({ text: 'hi' }, ctx);
    const r = await api.call('GET', '/events', { query: { after: '40' } });
    expect(r.body).toMatchObject({ seq: 1, reset: true });
    expect(r.body.events.map((e) => e.text)).toEqual(['hi']);
  });

  it('refuses an empty say', async () => {
    const api = fakeApi();
    const r = await api.tools.get('tellaflow_say').execute({ text: '   ' }, ctx);
    expect(r.isError).toBe(true);
  });
});
