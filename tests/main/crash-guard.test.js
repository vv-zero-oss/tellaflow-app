import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { createCrashGuard } from '../../src/main/crash-guard.js';

const quiet = { log() {}, warn() {}, error() {} };

describe('crash guard', () => {
  function make(opts = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-guard-'));
    const relaunches = [];
    const guard = createCrashGuard({ getLogDir: () => dir, relaunch: (r) => relaunches.push(r), log: quiet, checkEveryMs: 0, ...opts });
    return { guard, dir, relaunches };
  }

  it('logs uncaught exceptions instead of crashing', () => {
    const { guard, dir } = make();
    const proc = new EventEmitter();
    guard.install(proc);
    expect(() => proc.emit('uncaughtException', new Error('kaboom'))).not.toThrow();
    expect(fs.readFileSync(path.join(dir, 'error-log.txt'), 'utf8')).toMatch(/uncaughtException: Error: kaboom/);
    guard.uninstall(proc);
  });

  it('silently ignores keyspy EPIPE', () => {
    const { guard, dir } = make();
    const err = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    guard.onUncaught(err);
    expect(fs.existsSync(path.join(dir, 'error-log.txt'))).toBe(false);
  });

  it('relaunches when exceptions storm', () => {
    const { guard, relaunches } = make();
    for (let i = 0; i < 25; i++) guard.onUncaught(new Error(`e${i}`));
    expect(relaunches).toHaveLength(1);
  });

  it('memory watchdog relaunches only when over the ceiling AND idle', () => {
    let idle = false;
    let rss = 2e9;
    const { guard, relaunches } = make({ maxRssBytes: 1e9, isIdle: () => idle, memoryUsage: () => ({ rss }) });
    expect(guard.checkMemory()).toBe(false); // busy (e.g. recording)
    idle = true;
    rss = 5e8;
    expect(guard.checkMemory()).toBe(false); // under ceiling
    rss = 2e9;
    expect(guard.checkMemory()).toBe(true);
    expect(relaunches).toHaveLength(1);
  });
});
