#!/usr/bin/env node
/**
 * Switches the real app between transcription models and dictates with each,
 * then screenshots the Models page.
 *
 *   xvfb-run -a node scripts/e2e-models.mjs <short.wav> [outDir]
 *
 * Expects in resources/models/: the Parakeet v2 and Unified folders and
 * ggml-large-v3-turbo-q5_0.bin. Same other requirements as e2e-electron.mjs.
 */
import { _electron as electron } from 'playwright-core';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [shortWav, outArg] = process.argv.slice(2);
const OUT = path.resolve(outArg || path.join(ROOT, 'e2e-models'));
fs.mkdirSync(OUT, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-models-ud-'));

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

const vite = spawn('npx', ['vite', '--config', 'vite.config.ts'], { cwd: ROOT, stdio: 'ignore', detached: true });
await waitFor(async () => { try { return (await fetch('http://localhost:5173/index.html')).ok; } catch { return false; } }, { label: 'vite' });

const app = await electron.launch({
  executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
  cwd: ROOT,
  env: {
    ...process.env,
    TELLAFLOW_E2E: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    // Linux only: let the whisper.cpp addon find libwhisper.so next to it.
    LD_LIBRARY_PATH: `${path.join(ROOT, 'node_modules/@kutalia/whisper-node-addon/dist', `linux-${process.arch}`)}:${process.env.LD_LIBRARY_PATH || ''}`,
  },
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

try {
  const onboarding = await waitFor(() => app.windows().find((w) => w.url().includes('onboarding')), { label: 'onboarding' });
  await onboarding.waitForLoadState('domcontentloaded');
  await onboarding.evaluate(() => window.tellaflow.completeOnboarding());
  const main = await waitFor(() => app.windows().find((w) => w.url().includes('index.html')), { label: 'main window' });
  await main.waitForLoadState('domcontentloaded');
  await main.setViewportSize({ width: 1076, height: 900 });
  await waitFor(() => main.locator('text=Ready').count(), { label: 'model Ready', timeout: 180_000 });

  async function dictateWith(label, select, expectFile) {
    await main.evaluate(select);
    await sleep(500);
    await waitFor(() => main.locator('text=Ready').count(), { label: `${label} ready`, timeout: 180_000 });
    const spec = await T(() => globalThis.__tellaflowTest.engineSpec());
    const file = spec.engine === 'parakeet' ? spec.parakeetPaths.encoder : spec.modelPath;
    check(`${label}: the app loads its files`, file.includes(expectFile), file.replace(ROOT, '.'));
    const before = (await T(() => globalThis.__tellaflowTest.history())).length;
    const t0 = Date.now();
    await T((_, p) => globalThis.__tellaflowTest.dictateWav(p), path.resolve(shortWav));
    const entries = await waitFor(async () => {
      const h = await T(() => globalThis.__tellaflowTest.history());
      return h.length > before ? h : null;
    }, { label: `${label} transcript`, timeout: 180_000 });
    const text = entries[0].text;
    check(`${label}: dictation transcribes`, /future on earth/i.test(text), `${Date.now() - t0} ms → "${text}"`);
  }

  await dictateWith('Parakeet Unified', () => { window.tellaflow.setParakeetVariant('unified'); window.tellaflow.setTranscriptionEngine('parakeet'); }, 'parakeet-unified-en-0.6b');
  await dictateWith('Whisper turbo', () => { window.tellaflow.setModel('turbo'); window.tellaflow.setTranscriptionEngine('whisper'); }, 'ggml-large-v3-turbo-q5_0.bin');
  await dictateWith('Parakeet v2', () => { window.tellaflow.setParakeetVariant('v2'); window.tellaflow.setTranscriptionEngine('parakeet'); }, 'parakeet-tdt-0.6b-v2');

  // Leave Unified selected for the screenshots.
  await main.evaluate(() => { window.tellaflow.setParakeetVariant('unified'); window.tellaflow.setTranscriptionEngine('parakeet'); });
  await T(() => globalThis.__tellaflowTest.navigate('models'));
  await sleep(1500);
  await main.screenshot({ path: path.join(OUT, 'models-top.png') });
  await main.locator('button[role="combobox"]').first().click();
  await sleep(500);
  await main.screenshot({ path: path.join(OUT, 'models-picker.png') });
  await main.keyboard.press('Escape');
  await main.locator('text=Turbo').first().scrollIntoViewIfNeeded();
  await sleep(400);
  await main.screenshot({ path: path.join(OUT, 'models-turbo.png') });
  // Tall viewport so every model card is in one shot.
  await main.setViewportSize({ width: 1076, height: 2200 });
  await sleep(800);
  await main.screenshot({ path: path.join(OUT, 'models-all.png') });
} catch (err) {
  check('run completed', false, err.message);
  console.log(logs.join('').split('\n').filter((l) => /transcription|whisper|model|error/i.test(l)).slice(-25).join('\n'));
} finally {
  await app.close().catch(() => {});
  try { process.kill(-vite.pid); } catch {}
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
