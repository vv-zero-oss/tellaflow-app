// The assistant's runtime (Node + bb) is a download, not part of the app.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const runtime = require('../../src/main/jarvis/runtime');
const { BB_APP_VERSION } = require('../../src/main/jarvis/bb/supervisor');

function fakeInstall(dir, installed) {
  fs.mkdirSync(path.join(dir, 'node', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node', 'bin', 'node'), '');
  fs.mkdirSync(path.join(dir, 'bb', 'node_modules', 'bb-app', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bb', 'node_modules', 'bb-app', 'dist', 'bb-app.js'), '');
  if (installed) fs.writeFileSync(path.join(dir, 'INSTALLED.json'), JSON.stringify(installed));
}
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-rt-')), 'assistant');
const current = () => ({ node: runtime.NODE_VERSION, bb: BB_APP_VERSION, target: `${process.platform}-${process.arch}` });

describe('assistant runtime', () => {
  it('installs the bb the supervisor pins, on a Node pinned for the release build', () => {
    expect(runtime.pinnedBbVersion()).toBe(BB_APP_VERSION);
    expect(runtime.NODE_SHA256['darwin-arm64']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is missing until INSTALLED.json is written, the last step of an install', () => {
    const dir = tmp();
    expect(runtime.runtimeStatus(dir)).toMatchObject({ state: 'missing', launcher: null, node: null });
    fakeInstall(dir, null);
    expect(runtime.runtimeStatus(dir).state).toBe('missing');
  });

  it('is installed with the paths bb launches from', () => {
    const dir = tmp();
    fakeInstall(dir, current());
    const s = runtime.runtimeStatus(dir);
    expect(s.state).toBe('installed');
    expect(s.node).toBe(path.join(dir, 'node', 'bin', 'node'));
    expect(s.launcher).toBe(path.join(dir, 'bb', 'node_modules', 'bb-app', 'dist', 'bb-app.js'));
  });

  it('is outdated after an app update pins another bb or Node — and still runs', () => {
    for (const patch of [{ bb: '0.0.1' }, { node: 'v20.0.0' }, { target: 'other-arch' }]) {
      const dir = tmp();
      fakeInstall(dir, { ...current(), ...patch });
      const s = runtime.runtimeStatus(dir);
      expect(s.state).toBe('outdated');
      expect(s.launcher).toBeTruthy();
    }
  });

  it('remove deletes the download and anything half-staged', () => {
    const dir = tmp();
    fakeInstall(dir, current());
    fs.mkdirSync(`${dir}.part`);
    runtime.removeRuntime(dir);
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(`${dir}.part`)).toBe(false);
  });

  it('runs npm with none of a parent npm run’s settings, on the downloaded Node first', () => {
    const env = runtime.installEnv('/dl/node/bin', '/tmp/cache', {
      PATH: '/usr/bin', npm_config_ignore_scripts: 'true', NPM_CONFIG_PREFIX: '/x', ELECTRON_RUN_AS_NODE: '1', HOME: '/home/me',
    });
    expect(env.PATH).toBe(`/dl/node/bin${path.delimiter}/usr/bin`);
    expect(env.npm_config_ignore_scripts).toBeUndefined();
    expect(env.NPM_CONFIG_PREFIX).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.npm_config_cache).toBe('/tmp/cache');
    expect(env.HOME).toBe('/home/me');
  });

  it('ships only the manifest and lockfile in the app', () => {
    const yml = fs.readFileSync(path.join(__dirname, '..', '..', 'electron-builder.yml'), 'utf8');
    expect(yml).toContain('from: resources/assistant-runtime/');
    expect(yml).not.toMatch(/resources\/node\//);
    expect(yml).not.toMatch(/node_modules\/\{[^}]*bb-app/);
    const pkg = require('../../package.json');
    expect(pkg.dependencies['bb-app']).toBeUndefined();
  });
});
