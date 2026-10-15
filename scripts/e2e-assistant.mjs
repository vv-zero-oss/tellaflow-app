#!/usr/bin/env node
/**
 * Sends real commands to the assistant (as the command key does) and
 * screenshots every island state each run passes through, plus the Assistant
 * page. Needs a signed-in AI CLI (e.g. `claude`) on this machine.
 *
 *   xvfb-run -a node scripts/e2e-assistant.mjs [outDir]
 *
 * On Linux the Mac tools themselves (AppleScript, `open`) fail, so runs that
 * act on the Mac show the AI reacting to that failure — the island flow is
 * the same as on a Mac.
 */
import { _electron as electron } from 'playwright-core';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'e2e-assistant'));
fs.mkdirSync(OUT, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-assistant-ud-'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 60_000, every = 200, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(every);
  }
}

// Each case: the request, and what to press if it asks for approval.
const CASES = [
  { id: 'screen', request: "What's on my screen right now?" },
  { id: 'time', request: 'What time is it?' },
  { id: 'math', request: 'What is 15 percent of 240?' },
  { id: 'note', request: 'Create a note called Groceries with eggs and milk', onApproval: 'approve' },
  { id: 'safari', request: 'Open Safari', onApproval: 'cancel' },
  { id: 'plan', request: 'Check what apps are running, then tell me which one is using the most attention and set the volume to 30', onApproval: 'approve' },
];

const vite = spawn('npx', ['vite', '--config', 'vite.config.ts'], { cwd: ROOT, stdio: 'ignore', detached: true });
await waitFor(async () => { try { return (await fetch('http://localhost:5173/index.html')).ok; } catch { return false; } }, { label: 'vite' });

const app = await electron.launch({
  executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
  cwd: ROOT,
  env: { ...process.env, TELLAFLOW_E2E: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  timeout: 60_000,
});

async function T(fn, arg) {
  for (let i = 0; ; i++) {
    try { return await app.evaluate(fn, arg); } catch (err) {
      if (i < 20 && /context was destroyed|Target closed|navigation|garbage collected/i.test(err.message)) { await sleep(500); continue; }
      throw err;
    }
  }
}
const islandState = () => T(() => globalThis.__tellaflowTest.island.state());
const act = (name) => T((_, n) => globalThis.__tellaflowTest.island.action(n), name);
const islandPage = () => app.windows().find((w) => w.url().includes('toast.html'));
async function shot(name, settle = 400) {
  await sleep(settle);
  const page = await waitFor(islandPage, { label: 'island window' });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), omitBackground: true });
}

const summary = [];
try {
  const onboarding = await waitFor(() => app.windows().find((w) => w.url().includes('onboarding')), { label: 'onboarding' });
  await onboarding.waitForLoadState('domcontentloaded');
  await onboarding.evaluate(() => window.tellaflow.completeOnboarding());
  const main = await waitFor(() => app.windows().find((w) => w.url().includes('index.html')), { label: 'main window' });
  await main.waitForLoadState('domcontentloaded');
  await main.setViewportSize({ width: 1076, height: 900 });
  await waitFor(() => main.locator('text=Ready').count(), { label: 'Ready', timeout: 180_000 });

  for (const c of CASES) {
    await T((_, r) => globalThis.__tellaflowTest.island.command(r), c.request);
    const seen = [];
    let n = 0;
    const t0 = Date.now();
    for (;;) {
      const st = await islandState();
      const view = await T(() => globalThis.__tellaflowTest.island.view?.());
      const key = `${st}|${JSON.stringify(view?.content?.plan?.steps || view?.content?.notice?.title || '')}`;
      if (seen[seen.length - 1]?.key !== key && st !== 'none' && st !== 'idle') {
        seen.push({ key, st });
        await shot(`${c.id}-${++n}-${st}`, st === 'answer' ? 2500 : 300);
        if (st === 'approval') { await sleep(600); await act(c.onApproval || 'approve'); }
      }
      if (['answer', 'setup', 'error'].includes(st) || Date.now() - t0 > 240_000) break;
      await sleep(150);
    }
    summary.push(`${c.id}: "${c.request}" → ${seen.map((s) => s.st).join(' → ')}`);
    console.log(summary[summary.length - 1]);
    await act('dismiss');
    await sleep(800);
  }

  await T(() => globalThis.__tellaflowTest.navigate('assistant'));
  await sleep(1500);
  await main.screenshot({ path: path.join(OUT, 'assistant-page.png') });
  await T(() => globalThis.__tellaflowTest.navigate('settings'));
  await sleep(800);
  await main.locator('text=Full access').first().scrollIntoViewIfNeeded();
  await sleep(400);
  await main.screenshot({ path: path.join(OUT, 'settings-assistant.png') });
} catch (err) {
  console.log('FAILED:', err.message);
} finally {
  await app.close().catch(() => {});
  try { process.kill(-vite.pid); } catch {}
}
fs.writeFileSync(path.join(OUT, 'summary.txt'), summary.join('\n') + '\n');
console.log(`\nScreenshots in ${OUT}`);
