#!/usr/bin/env node
/**
 * The menubar menu in the real app: dictates a WAV so "Paste Last Transcript"
 * has something, checks the items, picks a microphone and a language from the
 * menu, and screenshots the menu and its submenus.
 *
 *   xvfb-run -a -s "-screen 0 1280x800x24" node scripts/e2e-tray.mjs <short.wav> [outDir]
 *
 * Same requirements as scripts/e2e-island.mjs. Linux has no menubar, so the
 * menu is popped up on the main window and the X display is captured with
 * ImageMagick's `import` (the native menu is not part of any page).
 */
import { _electron as electron } from 'playwright-core';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [shortWav, outArg] = process.argv.slice(2);
const OUT = path.resolve(outArg || path.join(ROOT, 'e2e-tray'));
fs.mkdirSync(OUT, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-tray-ud-'));

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
const items = () => T(() => globalThis.__tellaflowTest.trayMenu.items());
const find = (list, label) => list.find((i) => i.label === label);

async function shot(name, submenu = null) {
  await T((_, s) => globalThis.__tellaflowTest.trayMenu.popup(s), submenu);
  await sleep(700);
  execFileSync('import', ['-window', 'root', path.join(OUT, `${name}.png`)]);
  await T(() => globalThis.__tellaflowTest.trayMenu.close());
  await sleep(300);
}

try {
  const onboarding = await waitFor(() => app.windows().find((w) => w.url().includes('onboarding')), { label: 'onboarding' });
  await onboarding.waitForLoadState('domcontentloaded');
  await onboarding.evaluate(() => window.tellaflow.completeOnboarding());
  const main = await waitFor(() => app.windows().find((w) => w.url().includes('index.html')), { label: 'main window' });
  await main.waitForLoadState('domcontentloaded');
  await main.setViewportSize({ width: 1076, height: 760 });
  await waitFor(() => main.locator('text=Ready').count(), { label: 'model Ready', timeout: 180_000 });

  // Nothing dictated yet.
  let menu = await items();
  check('Paste Last Transcript is disabled before any dictation', find(menu, 'Paste Last Transcript').enabled === false);

  // Dictate, then the menu offers the transcript.
  await T((_, p) => globalThis.__tellaflowTest.dictateWav(p), path.resolve(shortWav));
  const entry = await waitFor(async () => (await T(() => globalThis.__tellaflowTest.history()))[0], { label: 'transcript', timeout: 120_000 });
  menu = await items();
  const paste = find(menu, 'Paste Last Transcript');
  check('Paste Last Transcript is enabled with ⌃⌘V', paste.enabled && paste.accelerator === 'Control+Command+V');
  const preview = menu[menu.indexOf(paste) + 1].label;
  check('the next line previews the last transcript', preview.startsWith('“') && entry.text.startsWith(preview.slice(1, 12)), preview);
  check('order matches the reference menu',
    JSON.stringify(menu.map((i) => i.label || '---')) === JSON.stringify(['Start Recording', 'Open Tellaflow', '---', 'Check for Updates…', '---', 'Paste Last Transcript', preview, '---', 'Shortcuts', 'Microphone', 'Language', 'Settings…', '---', 'Quit Tellaflow']));

  await main.evaluate(() => window.tellaflow.setFeatureSetting?.('meetingNotesEnabled', true));
  await shot('tray-menu');

  // Shortcuts.
  const sc = find(menu, 'Shortcuts').submenu;
  check('Shortcuts lists dictate / assistant / paste keys', find(sc, 'Dictate').sublabel === 'fn' && find(sc, 'Paste last transcript').sublabel === '⌃⌘V', JSON.stringify(sc.map((i) => [i.label, i.sublabel])));
  await shot('tray-shortcuts', 'Shortcuts');

  // Microphone: the fake media device shows up; picking it is saved.
  const mics = find(menu, 'Microphone').submenu.filter((i) => i.type === 'radio');
  check('Microphone lists the devices with Auto-detect checked', mics.length >= 2 && mics[0].checked, mics.map((m) => m.label).join(', '));
  await shot('tray-microphone', 'Microphone');
  await T((_, l) => globalThis.__tellaflowTest.trayMenu.click(l, 'Microphone'), mics[1].label);
  const cfg = await main.evaluate(() => window.tellaflow.getConfig());
  check('picking a microphone in the menu saves it', cfg.microphoneDeviceId && cfg.microphoneDeviceId !== 'auto', cfg.microphoneDeviceId);
  const after = find(await items(), 'Microphone').submenu.find((i) => i.checked);
  check('…and moves the check mark', after?.label === mics[1].label, after?.label);

  // Language: Parakeet is English only.
  const langP = find(menu, 'Language').submenu;
  check('Language says Parakeet is English only', !!find(langP, 'Parakeet is English only'));
  await shot('tray-language-parakeet', 'Language');

  // Language with Whisper: pick Japanese → translation on.
  await main.evaluate(() => window.tellaflow.setTranscriptionEngine('whisper'));
  await sleep(500);
  await T(() => globalThis.__tellaflowTest.trayMenu.click('Japanese', 'Language'));
  const cfg2 = await main.evaluate(() => window.tellaflow.getConfig());
  check('picking Japanese turns on translation from Japanese', cfg2.translationEnabled === true && cfg2.translationLanguage === 'ja', JSON.stringify([cfg2.translationEnabled, cfg2.translationLanguage]));
  const checkedLangs = find(await items(), 'Language').submenu.filter((i) => i.checked).map((i) => i.label);
  check('exactly one language is checked', checkedLangs.length === 1 && checkedLangs[0] === 'Japanese', checkedLangs.join(', '));
  await shot('tray-language-whisper', 'Language');
  await T(() => globalThis.__tellaflowTest.trayMenu.click('English', 'Language'));
  const cfg3 = await main.evaluate(() => window.tellaflow.getConfig());
  check('picking English turns translation off', cfg3.translationEnabled === false);
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
