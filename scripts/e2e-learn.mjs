#!/usr/bin/env node
/**
 * "Learn from my corrections" in the real Electron app.
 *
 *   xvfb-run -a node scripts/e2e-learn.mjs [outDir]
 *
 * Feeds an edit (pasted text → what the user corrected it to) into the same
 * path the macOS field watcher uses, then checks that: the island offers the
 * word; "Yes" adds it and says so; an unanswered offer still lands in the
 * Dictionary; "No" blocks it. No transcription model needed.
 */
import { _electron as electron } from 'playwright-core';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'e2e-learn'));
fs.mkdirSync(OUT, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-learn-ud-'));

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
  args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
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
const islandView = () => T(() => globalThis.__tellaflowTest.island.view());
const act = (name) => T((_, n) => globalThis.__tellaflowTest.island.action(n), name);
const edit = (args) => T((_, a) => globalThis.__tellaflowTest.island.learnFromEdit(...a), args);
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
  await main.evaluate(() => window.tellaflow.setFloatingBarEnabled(true));
  await expectState('idle', 'island at rest');
  const dict = () => main.evaluate(() => window.tellaflow.getDictionary());

  // ── A short dictation mostly replaced by its fix → offered → Yes ─────────
  const c1 = await edit(['cooper netties docs', 'cooper netties docs', 'Kubernetes docs']);
  check('a short dictation corrected in place yields a correction', c1.length === 1 && c1[0].to === 'Kubernetes', JSON.stringify(c1));
  await expectState('dictionary', 'the island offers the corrected word');
  await shot('01-offer');
  await act('dictionary-yes');
  await expectState('done', '"Yes" confirms on the island');
  check('confirmation names the word', /Added “Kubernetes” to dictionary/.test((await islandView()).content?.doneText || ''), (await islandView()).content?.doneText);
  await shot('02-added');
  check('"Yes" adds it to the Dictionary', (await dict()).some((e) => e.to === 'Kubernetes' && e.packId === 'auto-learned'));
  await expectState('idle', 'back to rest', 10_000);

  // ── Offer left unanswered → still learned (used to be dropped) ───────────
  await edit(['thanks katlin for the notes', 'Hi, thanks katlin for the notes', 'Hi, thanks Caitlin for the notes']);
  await expectState('dictionary', 'a second correction is offered');
  await expectState('idle', 'the offer times out by itself', 20_000);
  check('an unanswered offer still lands in the Dictionary', (await dict()).some((e) => e.from === 'katlin' && e.to === 'Caitlin'));
  check('and a notification is shown for it', logs.join('').includes('[auto-learn] learned "katlin" → "Caitlin"'));

  // ── "No" blocks it ───────────────────────────────────────────────────────
  await edit(['ping zandria today', 'ping zandria today', 'ping Zandra today']);
  await expectState('dictionary', 'a third correction is offered');
  await act('dictionary-no');
  await expectState('idle', '"No" dismisses it');
  check('"No" keeps it out of the Dictionary', !(await dict()).some((e) => e.to === 'Zandra'));
  await edit(['ping zandria today', 'ping zandria today', 'ping Zandra today']);
  await sleep(500);
  check('…and it is not offered again', (await islandState()) === 'idle');

  await T(() => globalThis.__tellaflowTest.navigate('dictionary'));
  await sleep(1200);
  await main.screenshot({ path: path.join(OUT, 'dictionary.png') });
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
