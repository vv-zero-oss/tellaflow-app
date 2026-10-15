import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let permissions;

beforeAll(() => {
  // permissions.js pulls in Electron; stub it so the logic runs under Node.
  const id = require.resolve('electron');
  require.cache[id] = { id, filename: id, loaded: true, exports: { systemPreferences: {}, shell: { openExternal() {} }, desktopCapturer: {} } };
  permissions = require('../../src/main/permissions');
});

describe('requestAutomation', () => {
  const targets = [
    { app: 'System Events', probe: 'count processes' },
    { app: 'Notes', probe: 'count accounts' },
  ];

  it('asks every target app once and reports granted when all succeed', async () => {
    const scripts = [];
    const res = await permissions.requestAutomation({ targets, runScript: async (s) => { scripts.push(s); return '1'; } });
    expect(res.granted).toBe(true);
    expect(scripts).toEqual(['tell application "System Events" to count processes', 'tell application "Notes" to count accounts']);
  });

  it('is not granted when the user refuses an app (-1743)', async () => {
    const res = await permissions.requestAutomation({
      targets,
      runScript: async (s) => { if (s.includes('Notes')) throw new Error('Not authorized to send Apple events to Notes. (-1743)'); return '1'; },
    });
    expect(res.granted).toBe(false);
    expect(res.results.find((r) => r.app === 'Notes').error).toBe('not-authorized');
  });

  it('ignores apps that fail for other reasons (e.g. not installed)', async () => {
    const res = await permissions.requestAutomation({
      targets,
      runScript: async (s) => { if (s.includes('Notes')) throw new Error("Can't get application \"Notes\""); return '1'; },
    });
    expect(res.granted).toBe(true);
  });

  it('quits background apps it had to launch for the prompt', async () => {
    const scripts = [];
    await permissions.requestAutomation({
      targets: [{ app: 'Music', probe: 'count playlists', background: true }],
      runScript: async (s) => { scripts.push(s); return '1'; },
    });
    // Not running before (osascript unavailable in tests ⇒ treated as not running) → quit afterwards.
    expect(scripts).toEqual(['tell application "Music" to count playlists', 'tell application "Music" to quit']);
  });
});
