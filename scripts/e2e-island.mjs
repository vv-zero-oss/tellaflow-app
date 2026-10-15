#!/usr/bin/env node
/**
 * Drives the voice island in the real Electron app and screenshots each state.
 *
 *   xvfb-run -a node scripts/e2e-island.mjs <short.wav> [outDir]
 *
 * Same requirements as scripts/e2e-electron.mjs (Electron binary,
 * better-sqlite3 built for Electron, playwright-core, a transcription model).
 * Island screenshots are taken with a transparent background (island-*.png).
 */
import { _electron as electron } from 'playwright-core';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [shortWav, outArg] = process.argv.slice(2);
const OUT = path.resolve(outArg || path.join(ROOT, 'e2e-island'));
fs.mkdirSync(OUT, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-island-ud-'));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 60_000, every = 150, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(every);
  }
}

const vite = spawn('npx', ['vite', '--config', 'vite.config.ts'], { cwd: ROOT, stdio: 'ignore', detached: true });
await waitFor(async () => { try { return (await fetch('http://localhost:5173/index.html')).ok; } catch { return false; } }, { label: 'vite' });

const app = await electron.launch({
  executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  args: ['.', '--no-sandbox', '--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--user-data-dir=${userData}`],
  cwd: ROOT,
  env: { ...process.env, TELLAFLOW_E2E: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  timeout: 60_000,
});
const logs = [];
app.process().stdout.on('data', (d) => logs.push(String(d)));
app.process().stderr.on('data', (d) => logs.push(String(d)));

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

async function shot(name, { settle = 700 } = {}) {
  await sleep(settle);
  const page = await waitFor(islandPage, { label: 'island window' });
  await page.screenshot({ path: path.join(OUT, `island-${name}.png`), omitBackground: true });
}

async function expectState(state, label, timeout = 30_000) {
  try {
    await waitFor(async () => (await islandState()) === state, { label: state, timeout });
    check(label, true);
  } catch {
    check(label, false, `island shows "${await islandState()}"`);
  }
}

try {
  const onboarding = await waitFor(() => app.windows().find((w) => w.url().includes('onboarding')), { label: 'onboarding' });
  await onboarding.waitForLoadState('domcontentloaded');
  await onboarding.evaluate(() => window.tellaflow.completeOnboarding());
  const main = await waitFor(() => app.windows().find((w) => w.url().includes('index.html')), { label: 'main window' });
  await main.waitForLoadState('domcontentloaded');
  await main.setViewportSize({ width: 1076, height: 800 });
  await waitFor(() => main.locator('text=Ready').count(), { label: 'model Ready', timeout: 180_000 });

  // ── Resting: the idle dot ────────────────────────────────────────────────
  await main.evaluate(() => window.tellaflow.setFloatingBarEnabled(true));
  await expectState('idle', 'always-on island rests on the idle dot');
  await shot('01-idle');

  // ── Click the dot → dictating (cancel / finish) ──────────────────────────
  await act('start-listening');
  await expectState('dictating', 'clicking the dot starts dictation with cancel / finish');
  await shot('02-dictating');
  await act('cancel-dictation');
  await expectState('idle', 'cancel returns to the idle dot');

  // ── Real dictation → transcribing → done (Undo) ──────────────────────────
  await T((_, p) => globalThis.__tellaflowTest.dictateWav(p), path.resolve(shortWav));
  await expectState('transcribing', 'a recording shows "Transcribing…"', 60_000);
  await shot('03-transcribing', { settle: 150 });
  await expectState('done', 'the transcript is inserted and the island says so', 120_000);
  await shot('04-done');
  await expectState('idle', 'done returns to rest by itself', 10_000);

  // ── Dictionary offer ─────────────────────────────────────────────────────
  await T(() => globalThis.__tellaflowTest.island.offerWord([{ from: 'kubernetes', to: 'Kubernetes' }]));
  await expectState('dictionary', 'a learned word is offered to the dictionary');
  await shot('05-dictionary');
  await act('dictionary-yes');
  const learned = await main.evaluate(() => window.tellaflow.getDictionary());
  check('"Yes" adds the word to the dictionary', learned.some((e) => e.to === 'Kubernetes' || e.to_word === 'Kubernetes'));

  // ── Meeting: ask → recording (timer, Stop) → saved ───────────────────────
  await T(() => globalThis.__tellaflowTest.island.askMeeting({ app: 'Zoom' }));
  await expectState('meeting', 'a detected meeting asks before recording');
  await shot('06-meeting');
  await act('transcribe');
  await expectState('recording', '"Transcribe meeting" starts recording with a timer');
  await shot('07-recording', { settle: 3200 });
  await act('stop-recording');
  await expectState('done', 'Stop saves the meeting notes', 20_000);
  await shot('08-meeting-saved');

  // ── Command key → assistant on the island ────────────────────────────────
  // Whatever AI this machine has decides the path: a streamed reply if one is
  // signed in, an error card if not. Screenshot every assistant state we pass.
  await expectState('idle', 'back to rest after the meeting', 10_000);
  await T(() => globalThis.__tellaflowTest.island.setRecordingPurpose('command'));
  await T((_, p) => globalThis.__tellaflowTest.dictateWav(p), path.resolve(shortWav));
  const seen = [];
  const t0 = Date.now();
  for (;;) {
    const st = await islandState();
    if (seen[seen.length - 1] !== st) {
      seen.push(st);
      if (['reply', 'ask', 'approval', 'setup', 'error'].includes(st)) await shot(`09-command-${seen.length}-${st}`, { settle: 300 });
    }
    const view = await T(() => globalThis.__tellaflowTest.island.view());
    const settled = (st === 'reply' && view?.content?.reply && !view.content.reply.working) || ['setup', 'error'].includes(st);
    if (settled || Date.now() - t0 > 180_000) break;
    await sleep(200);
  }
  check('a command-key request runs on the island', seen.includes('reply') && ['reply', 'setup', 'error'].includes(seen[seen.length - 1]), seen.join(' → '));
  const transcript = await main.evaluate(() => window.tellaflow.assistantTranscript());
  check('the spoken command went to the assistant, not into a text field', transcript.some((e) => e.role === 'user'), transcript[0]?.text);
  await act('dismiss');

  // ── Side placement: upright pill ─────────────────────────────────────────
  await main.evaluate(() => window.tellaflow.setFeatureSetting('islandPlacement', 'right'));
  await act('start-listening');
  await expectState('dictating', 'dictation on the right edge');
  await shot('10-dictating-right');
  await act('cancel-dictation');
  await main.evaluate(() => window.tellaflow.setFeatureSetting('islandMaterial', 'opaque'));
  await main.evaluate(() => window.tellaflow.setFeatureSetting('islandPlacement', 'bottom'));
  await T(() => globalThis.__tellaflowTest.island.askMeeting({ app: 'Google Meet' }));
  await expectState('meeting', 'opaque material');
  await shot('11-meeting-opaque');
  await act('not-now');

  // ── Settings: island + command key ───────────────────────────────────────
  await T(() => globalThis.__tellaflowTest.navigate('settings'));
  await sleep(1200);
  await main.screenshot({ path: path.join(OUT, 'settings.png'), fullPage: true });
  await main.locator('text=Command key').scrollIntoViewIfNeeded();
  await main.screenshot({ path: path.join(OUT, 'settings-command-key.png') });
  await main.locator('text=Island position').scrollIntoViewIfNeeded();
  await main.screenshot({ path: path.join(OUT, 'settings-island.png') });
} catch (err) {
  check('run completed', false, err.message);
  console.log(logs.join('').split('\n').slice(-40).join('\n'));
} finally {
  await app.close().catch(() => {});
  try { process.kill(-vite.pid); } catch {}
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
