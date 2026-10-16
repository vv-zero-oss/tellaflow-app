import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const MIC_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';

// permissions.js only talks to macOS on darwin; pretend to be a Mac with a
// fake electron so the TCC branches run.
function load(status, askResult = true) {
  const calls = { asked: 0, opened: [] };
  const electronId = require.resolve('electron');
  require.cache[electronId] = {
    id: electronId, filename: electronId, loaded: true,
    exports: {
      systemPreferences: {
        getMediaAccessStatus: () => status,
        askForMediaAccess: async () => { calls.asked++; return askResult; },
      },
      shell: { openExternal: (url) => { calls.opened.push(url); } },
      desktopCapturer: {},
    },
  };
  const id = require.resolve('../../src/main/permissions.js');
  delete require.cache[id];
  return { permissions: require(id), calls };
}

describe('requestMicrophone', () => {
  const platform = process.platform;
  beforeEach(() => { Object.defineProperty(process, 'platform', { value: 'darwin' }); });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
    delete require.cache[require.resolve('electron')];
  });

  it('shows the macOS prompt the first time', async () => {
    const { permissions, calls } = load('not-determined', true);
    expect(await permissions.requestMicrophone()).toBe(true);
    expect(calls.asked).toBe(1);
    expect(calls.opened).toEqual([]);
  });

  it('opens System Settings → Microphone once access was denied (macOS will not prompt again)', async () => {
    const { permissions, calls } = load('denied');
    expect(await permissions.requestMicrophone()).toBe(false);
    expect(calls.asked).toBe(0);
    expect(calls.opened).toEqual([MIC_PANE]);
  });

  it('opens System Settings when access is restricted', async () => {
    const { permissions, calls } = load('restricted');
    expect(await permissions.requestMicrophone()).toBe(false);
    expect(calls.opened).toEqual([MIC_PANE]);
  });

  it('does nothing when already granted', async () => {
    const { permissions, calls } = load('granted');
    expect(await permissions.requestMicrophone()).toBe(true);
    expect(calls.asked).toBe(0);
    expect(calls.opened).toEqual([]);
  });
});
