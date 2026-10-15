#!/usr/bin/env node
/**
 * The assistant, end to end in the real app: real bb (started by the app on
 * its bundled Node, in a throwaway data folder), the real AI, the island.
 * Sends commands the way the command key does and screenshots every island
 * state, then the Assistant page (bb framed) and Settings › Assistant.
 *
 *   xvfb-run -a node scripts/e2e-assistant.mjs [outDir]
 *
 * Needs: `npm run download-node`, a signed-in provider CLI (`claude`), the
 * Electron setup in CLAUDE.md. On Linux the desktop is a pretend one
 * (scripts/e2e-fake-desktop.js) — Peekaboo is macOS-only — so a desktop task
 * runs the real model and loop against a simulated TextEdit.
 *
 * Env: E2E_PROVIDER (default claude-code) names the AI, for machines where bb
 * cannot tell the CLI is signed in.
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
const bbData = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-assistant-bb-'));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
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

// Each case: the request, what to press on a confirmation, and what must hold.
const CASES = [
  { id: 'answer', request: 'What is 15 percent of 240? Answer in one short sentence.', expect: (v, t) => /36/.test(t) },
  {
    id: 'desktop',
    request: 'Open TextEdit and type: Buy milk',
    onApproval: 'approve',
    expect: (v, t, desk) => desk.doc === 'Buy milk' && v?.content?.reply?.done === true,
  },
  {
    id: 'declined',
    request: 'Quit TextEdit',
    onApproval: 'cancel',
    expect: (v, t, desk) => !desk.acts.some((a) => a.type === 'os_app' && a.action === 'quit'),
  },
  {
    id: 'delegate',
    request: 'This is a bigger job for a chat: write a packing list for a weekend hiking trip.',
    expect: (v) => v?.content?.reply?.chat === true,
    then: 'open-chat',
  },
];

const vite = spawn('npx', ['vite', '--config', 'vite.config.ts'], { cwd: ROOT, stdio: 'ignore', detached: true });
await waitFor(async () => { try { return (await fetch('http://localhost:5173/index.html')).ok; } catch { return false; } }, { label: 'vite' });

const app = await electron.launch({
  executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
  cwd: ROOT,
  env: {
    ...process.env,
    TELLAFLOW_E2E: '1',
    TELLAFLOW_E2E_DESKTOP: 'fake',
    TELLAFLOW_BB_DATA_DIR: bbData,
    TELLAFLOW_BB_SERVER_PORT: '38986',
    TELLAFLOW_BB_DAEMON_PORT: '38987',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  },
  timeout: 60_000,
});
const mainLogs = [];
app.process().stdout.on('data', (d) => mainLogs.push(String(d)));
app.process().stderr.on('data', (d) => mainLogs.push(String(d)));

async function T(fn, arg) {
  for (let i = 0; ; i++) {
    try { return await app.evaluate(fn, arg); } catch (err) {
      if (i < 20 && /context was destroyed|Target closed|navigation|garbage collected/i.test(err.message)) { await sleep(500); continue; }
      throw err;
    }
  }
}
const view = () => T(() => globalThis.__tellaflowTest.island.view());
const act = (name) => T((_, n) => globalThis.__tellaflowTest.island.action(n), name);
const desk = () => T(() => globalThis.__tellaflowTest.fakeDesktop?.() ?? null);
const islandPage = () => app.windows().find((w) => w.url().includes('toast.html'));
async function shot(name, settle = 300) {
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
  await main.evaluate((p) => window.tellaflow.assistantSetSettings({ provider: p, screenVision: false }), process.env.E2E_PROVIDER || 'claude-code');

  for (const c of CASES) {
    const t0 = Date.now();
    await T((_, r) => globalThis.__tellaflowTest.island.command(r), c.request);
    const seen = [];
    let n = 0;
    let lastText = '';
    let firstWordsMs = null;
    for (;;) {
      const v = await view();
      const st = v?.state;
      const reply = v?.content?.reply;
      if (reply?.text && firstWordsMs === null) firstWordsMs = Date.now() - t0;
      // A frame per state, per status line, and when the text has grown by a lot.
      const key = `${st}|${reply?.status ?? ''}|${v?.content?.notice?.body ?? ''}|${reply?.done ? 'done' : ''}`;
      const grew = (reply?.text ?? '').length - lastText.length > 25;
      if ((seen[seen.length - 1] !== key || grew) && st && st !== 'none' && st !== 'idle') {
        seen.push(key);
        lastText = reply?.text ?? '';
        await shot(`${c.id}-${String(++n).padStart(2, '0')}-${st}`, 150);
        if (st === 'approval') { await sleep(500); await act(c.onApproval || 'approve'); }
      }
      const settled = (st === 'reply' && reply && !reply.working) || ['error', 'setup'].includes(st);
      if (settled || Date.now() - t0 > 240_000) {
        await shot(`${c.id}-${String(++n).padStart(2, '0')}-final`, 600);
        const d = await desk();
        check(`${c.id}: "${c.request}"`, !!c.expect(v, reply?.text ?? '', d ?? {}), `${st}: ${JSON.stringify(reply?.text ?? v?.content?.notice ?? '')} · first words ${firstWordsMs ?? '—'} ms · ${Math.round((Date.now() - t0) / 1000)} s`);
        break;
      }
      await sleep(120);
    }
    summary.push(`${c.id}: "${c.request}" → ${seen.map((s) => s.split('|')[0]).join(' → ')}`);
    await act(c.then || 'dismiss');
    await sleep(800);
  }

  // The transcript and what reached the pretend desktop.
  const transcript = await main.evaluate(() => window.tellaflow.assistantTranscript());
  fs.writeFileSync(path.join(OUT, 'transcript.json'), JSON.stringify({ transcript, desktop: await desk() }, null, 2));

  // The Assistant page: bb's own app, framed — and the chat the island opened.
  await T(() => globalThis.__tellaflowTest.navigate('assistant'));
  const frame = await waitFor(async () => {
    const f = main.frames().find((fr) => /127\.0\.0\.1:38986/.test(fr.url()));
    return f && (await f.locator('body').innerText().catch(() => '')).length > 20 ? f : null;
  }, { label: 'bb in the Assistant page', timeout: 60_000 }).catch(() => null);
  check('Assistant page frames bb, on the chat the island opened', !!frame && /\/threads\/thr_/.test(frame.url()), frame?.url() ?? 'no frame');
  await sleep(2500);
  await main.screenshot({ path: path.join(OUT, 'assistant-page.png') });

  await T(() => globalThis.__tellaflowTest.navigate('settings'));
  await sleep(800);
  await main.locator('text=Run actions without asking').first().scrollIntoViewIfNeeded();
  await sleep(2500);
  await main.screenshot({ path: path.join(OUT, 'settings-assistant.png') });
  check('Settings › Assistant has no Control apps row', (await main.locator('text=Control apps').count()) === 0);

  await T(() => globalThis.__tellaflowTest.navigate('models'));
  await sleep(800);
  await main.screenshot({ path: path.join(OUT, 'models.png') });
  check('Models page has no AI Models tab', (await main.locator('text=AI Models').count()) === 0);
} catch (err) {
  console.log('FAILED:', err.message);
  results.push({ name: 'run', ok: false });
} finally {
  fs.writeFileSync(path.join(OUT, 'main.log'), mainLogs.join(''));
  await app.close().catch(() => {});
  try { process.kill(-vite.pid); } catch {}
}
fs.writeFileSync(path.join(OUT, 'summary.txt'), summary.join('\n') + '\n');
console.log(`\n${summary.join('\n')}\nScreenshots in ${OUT}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
