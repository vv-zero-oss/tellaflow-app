// The island bridge's transport: plugin install/reload, the long-poll, answers.
import { describe, it, expect } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { createIslandBridge, bridgePluginDir } from '../../src/main/jarvis/bb/island-bridge.js';

function pluginDir(version = '0.1.0') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-bridge-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'bb-plugin-tellaflow', version }));
  return dir;
}

/** A bb plugin route stand-in: queued event pages, the health version, answers. */
function fakeBb({ health = '0.1.0', pages = [] } = {}) {
  const calls = { installs: [], reloads: [], answers: [], polls: [] };
  const client = {
    baseUrl: 'http://bb/api/v1',
    installPlugin: async (source) => { calls.installs.push(source); return { id: 'tellaflow' }; },
    reloadPlugin: async (id) => { calls.reloads.push(id); },
  };
  let waiting = null;
  const fetch = async (url, init) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/health')) return { ok: true, json: async () => ({ ok: true, version: health }) };
    if (u.pathname.endsWith('/answer')) { calls.answers.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ok: true }) }; }
    calls.polls.push(Number(u.searchParams.get('after')));
    const page = pages.shift();
    if (page) return { ok: true, json: async () => page };
    // No more news: hold the poll like the real route does.
    await new Promise((r) => { waiting = r; });
    return { ok: true, json: async () => ({ seq: 0, events: [] }) };
  };
  return { client, fetch, calls, release: () => waiting?.() };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('island bridge', () => {
  it('installs the plugin by path once, and reloads it when bb runs an older copy', async () => {
    const bb = fakeBb({ health: '0.0.9' });
    const dir = pluginDir('0.1.0');
    const bridge = createIslandBridge({ client: async () => bb.client, onEvent: () => {}, pluginDir: dir, fetch: bb.fetch });
    expect(await bridge.ensure(bb.client)).toBe(true);
    expect(await bridge.ensure(bb.client)).toBe(true);
    expect(bb.calls.installs).toEqual([`path:${dir}`]);
    expect(bb.calls.reloads).toEqual(['tellaflow']);
  });

  it('delivers each event once, in order, and resumes after the last seq', async () => {
    const bb = fakeBb({
      pages: [
        { seq: 2, events: [{ seq: 1, type: 'say', text: 'a' }, { seq: 2, type: 'say', text: 'b' }] },
        { seq: 3, events: [{ seq: 2, type: 'say', text: 'b' }, { seq: 3, type: 'ask', id: 'q1', question: '?' }] },
      ],
    });
    const got = [];
    const bridge = createIslandBridge({ client: async () => bb.client, onEvent: (e) => got.push(e), pluginDir: pluginDir(), fetch: bb.fetch });
    bridge.start();
    await tick(); await tick();
    bridge.stop();
    bb.release();
    expect(got.map((e) => e.text ?? e.id)).toEqual(['a', 'b', 'q1']);
    expect(bb.calls.polls).toEqual([0, 2, 3]);
  });

  it('replays what a restarted plugin holds when it reports a reset', async () => {
    const bb = fakeBb({
      pages: [
        { seq: 5, events: [{ seq: 5, type: 'say', text: 'old' }] },
        { seq: 1, reset: true, events: [{ seq: 1, type: 'say', text: 'after restart' }] },
      ],
    });
    const got = [];
    const bridge = createIslandBridge({ client: async () => bb.client, onEvent: (e) => got.push(e.text), pluginDir: pluginDir(), fetch: bb.fetch });
    bridge.start();
    await tick(); await tick();
    bridge.stop();
    bb.release();
    expect(got).toEqual(['old', 'after restart']);
    expect(bb.calls.polls).toEqual([0, 5, 1]);
  });

  it('posts an answer back by question id', async () => {
    const bb = fakeBb();
    const bridge = createIslandBridge({ client: async () => bb.client, onEvent: () => {}, pluginDir: pluginDir(), fetch: bb.fetch });
    expect(await bridge.answer('q1', 'Digits')).toBe(true);
    expect(bb.calls.answers).toEqual([{ id: 'q1', answer: 'Digits' }]);
  });

  it('finds the plugin in the repo during development', () => {
    expect(fs.existsSync(path.join(bridgePluginDir(undefined), 'server.js'))).toBe(true);
  });
});
