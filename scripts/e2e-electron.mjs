#!/usr/bin/env node
/**
 * Drives the real Electron app end to end and saves screenshots.
 *
 *   xvfb-run -a node scripts/e2e-electron.mjs <short.wav> <45s.wav> <30s-a.wav> <30s-b.wav> [outDir]
 *
 * Requires: the Electron binary (node node_modules/electron/install.js),
 * better-sqlite3 built for Electron, playwright-core (npm i --no-save
 * playwright-core), the Vite dev server (started here), and a transcription
 * model in resources/models (Parakeet is the default engine).
 *
 * Uses the TELLAFLOW_E2E hook in src/main/index.js to feed WAV files through
 * the same 'audio-captured' path a real recording takes.
 */
import { _electron as electron } from 'playwright-core';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [shortWav, clip45, chunkA, chunkB, outArg] = process.argv.slice(2);
const OUT = path.resolve(outArg || path.join(ROOT, 'e2e-screenshots'));
fs.mkdirSync(OUT, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-e2e-ud-'));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 60_000, every = 250, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(every);
  }
}

// ── Vite dev server (the unpackaged app loads http://localhost:5173) ──────────
const vite = spawn('npx', ['vite', '--config', 'vite.config.ts'], { cwd: ROOT, stdio: 'ignore', detached: true });
await waitFor(async () => { try { return (await fetch('http://localhost:5173/index.html')).ok; } catch { return false; } }, { label: 'vite', timeout: 60_000 });

const app = await electron.launch({
  executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
  cwd: ROOT,
  env: { ...process.env, TELLAFLOW_E2E: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  timeout: 60_000,
});
const mainLogs = [];
app.process().stdout.on('data', (d) => mainLogs.push(String(d)));
app.process().stderr.on('data', (d) => mainLogs.push(String(d)));
// Main-process evaluate can transiently lose its context while a utility
// process spawns (the debugger re-targets) — retry those.
async function T(fn, arg) {
  for (let i = 0; ; i++) {
    try { return await app.evaluate(fn, arg); } catch (err) {
      if (i < 20 && /context was destroyed|Target closed|navigation/i.test(err.message)) { await sleep(500); continue; }
      throw err;
    }
  }
}

try {
  // ── Onboarding → main window ───────────────────────────────────────────────
  const onboarding = await waitFor(() => app.windows().find((w) => w.url().includes('onboarding')), { label: 'onboarding window' });
  await onboarding.waitForLoadState('domcontentloaded');
  await sleep(1500);
  await onboarding.screenshot({ path: path.join(OUT, '00-onboarding.png') });
  await onboarding.evaluate(() => window.tellaflow.completeOnboarding());

  const main = await waitFor(() => app.windows().find((w) => w.url().includes('index.html')), { label: 'main window' });
  await main.waitForLoadState('domcontentloaded');
  await main.setViewportSize({ width: 1076, height: 800 });
  await waitFor(() => main.locator('text=Ready').count(), { label: 'model Ready', timeout: 120_000 });
  check('app starts and the worker loads the model', true);

  // ── 1. Real dictation through the worker ───────────────────────────────────
  await T((_, p) => globalThis.__tellaflowTest.dictateWav(p), shortWav);
  const first = await waitFor(async () => (await T(() => globalThis.__tellaflowTest.history()))[0], { label: 'first transcript', timeout: 90_000 });
  check('dictation (12 s clip) → transcript in history', /\w+/.test(first.text), `"${first.text.slice(0, 120)}"`);

  // ── 2. Kill the worker mid-transcription → auto restart + retry ────────────
  // Not retried: a retry after a lost context would kill the replacement worker too.
  const killWorker = () => app.evaluate(() => globalThis.__tellaflowTest.killWorker()).catch(() => 'killed (context reset)');
  await T((_, p) => globalThis.__tellaflowTest.dictateWav(p), clip45);
  await sleep(150);
  const killedPid = await killWorker();
  const second = await waitFor(async () => {
    const h = await T(() => globalThis.__tellaflowTest.history());
    return h.length >= 2 ? h[0] : null;
  }, { label: 'transcript after crash', timeout: 120_000 });
  const stats = await T(() => globalThis.__tellaflowTest.stats());
  check('worker SIGKILLed mid-job → restarted, job retried, app alive', !!killedPid && stats.crashes >= 1 && /\w+/.test(second.text),
    `killed pid ${killedPid}, crashes=${stats.crashes}, retries=${stats.retries} → "${second.text.slice(0, 100)}"`);

  // ── 3. Crash loop → recording parked in Needs attention ────────────────────
  // Kill every worker that comes up, from the driver side.
  let looping = true;
  const killLoop = (async () => { while (looping) { await killWorker().catch(() => {}); await sleep(100); } })();
  await T((_, p) => globalThis.__tellaflowTest.dictateWav(p), shortWav);
  const failed = await waitFor(async () => (await T(() => globalThis.__tellaflowTest.failedJobs()))[0], { label: 'failed job', timeout: 120_000 });
  looping = false;
  await killLoop;
  check('repeated crashes → audio saved under Needs attention', !!failed && fs.existsSync(failed.audioPath), `error: "${failed.error}"`);

  // ── 4. Meeting notes entry (two real 30 s chunks) ──────────────────────────
  await T(() => globalThis.__tellaflowTest.startMeeting('Zoom'));
  await T((_, p) => globalThis.__tellaflowTest.meetingChunkFromWav(p), chunkA);
  await T((_, p) => globalThis.__tellaflowTest.meetingChunkFromWav(p), chunkB);
  const meeting = await waitFor(async () => (await T(() => globalThis.__tellaflowTest.history())).find((e) => e.kind === 'meeting' && /\[\d\d:\d\d\][\s\S]*\[\d\d:\d\d\]/.test(e.text)), { label: 'meeting entry', timeout: 120_000 });
  check('meeting notes: 30 s chunks transcribed into one entry', !!meeting, `"${meeting.text.split('\n').slice(0, 3).join(' / ').slice(0, 140)}"`);

  // ── Screenshots: Transcripts ───────────────────────────────────────────────
  await T(() => globalThis.__tellaflowTest.navigate('transcripts'));
  await sleep(1200);
  await main.screenshot({ path: path.join(OUT, '01-transcripts-needs-attention-meeting.png') });

  // Retry the failed recording from the UI
  await main.locator('button[title="Retry transcription"]').first().click();
  await waitFor(async () => (await T(() => globalThis.__tellaflowTest.failedJobs())).length === 0, { label: 'retry from UI', timeout: 120_000 });
  await sleep(800);
  check('Retry button in Needs attention transcribes the saved audio', true);
  await main.screenshot({ path: path.join(OUT, '02-transcripts-after-retry.png') });

  // ── Dictionary with an auto-learned word ───────────────────────────────────
  await T(() => globalThis.__tellaflowTest.learn([{ from: 'cooper netties', to: 'Kubernetes' }, { from: 'katlin', to: 'Caitlin' }]));
  await T(() => globalThis.__tellaflowTest.navigate('dictionary'));
  await sleep(1000);
  await main.screenshot({ path: path.join(OUT, '03-dictionary-learned.png') });

  // ── Assistant with the real signed-in Claude CLI ───────────────────────────
  await T(() => globalThis.__tellaflowTest.navigate('assistant'));
  await sleep(800);
  await main.locator('textarea').fill('Open the Calculator app, then tell me today\'s date.');
  await main.locator('button[title="Run"]').click();
  // Answer every approval until the run ends: allow normal actions, deny
  // custom AppleScript (exercises both paths). Screenshot the first prompt.
  let shotApproval = false;
  await waitFor(async () => {
    const [run] = await main.evaluate(() => window.tellaflow.assistantListRuns());
    if (run && run.status !== 'running') return true;
    const allow = main.getByRole('button', { name: 'Allow' });
    if (await allow.count()) {
      if (!shotApproval) { await sleep(400); await main.screenshot({ path: path.join(OUT, '04-assistant-approval.png') }); shotApproval = true; }
      const isScript = await main.locator('text=Review the script above first').count();
      await (isScript ? main.getByRole('button', { name: 'Deny' }) : allow).first().click();
    }
    return false;
  }, { label: 'assistant run to finish', timeout: 300_000, every: 1000 });
  await sleep(800);
  await main.screenshot({ path: path.join(OUT, '05-assistant-chain.png') });
  const runs = await main.evaluate(() => window.tellaflow.assistantListRuns());
  check('assistant: real Claude CLI plans → approval → result → final', runs[0]?.status === 'done',
    `${runs[0]?.provider} · ${runs[0]?.steps.map((s) => s.type).join(' → ')}`);

  // ── Settings: new sections ────────────────────────────────────────────────
  await T(() => globalThis.__tellaflowTest.navigate('settings'));
  await sleep(1500);
  const smart = main.locator('text=Smart dictation').first();
  await smart.scrollIntoViewIfNeeded();
  await sleep(500);
  await main.screenshot({ path: path.join(OUT, '06-settings-smart-meetings.png') });
  await main.locator('text=Run actions without asking').first().scrollIntoViewIfNeeded();
  await sleep(1500);
  await main.screenshot({ path: path.join(OUT, '07-settings-assistant.png') });
} catch (err) {
  check('e2e run', false, err.message);
  try { for (const w of app.windows()) await w.screenshot({ path: path.join(OUT, `zz-error-${Date.now()}.png`) }); } catch {}
  console.log(mainLogs.join('').split('\n').slice(-40).join('\n'));
} finally {
  await app.close().catch(() => {});
  try { process.kill(-vite.pid); } catch {}
}

const failedCount = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failedCount}/${results.length} passed · screenshots in ${OUT}`);
process.exit(failedCount ? 1 : 0);
