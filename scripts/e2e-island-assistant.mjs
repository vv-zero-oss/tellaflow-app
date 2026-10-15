#!/usr/bin/env node
/**
 * The assistant's island states, with the content that breaks layouts: long
 * answers, unbroken URLs and paths, long questions and options, the full text
 * a step will type. Screenshots each, and checks the card stays inside the
 * island window and nothing runs off its side.
 *
 *   xvfb-run -a node scripts/e2e-island-assistant.mjs [outDir]
 *
 * No AI needed — the views are the ones the assistant sends (src/main/jarvis).
 */
import { _electron as electron } from 'playwright-core';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'e2e-island-assistant'));
fs.mkdirSync(OUT, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-island-assistant-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
async function waitFor(fn, { timeout = 60_000, every = 200, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`); await sleep(every); }
}

const LONG = 'Here is a draft you can send to Maya. Hi Maya — thanks for pulling the numbers together so quickly. I went through the Q3 sheet and the totals line up with what finance sent on Friday, except for the travel line, which still includes the cancelled Berlin trip. Could you take that out and re-share? Once that is fixed I am happy to sign off, and we can send it to the board on Tuesday as planned. Thanks again for turning it around before the weekend.';
const URL_LONG = 'https://docs.example.com/projects/tellaflow/roadmap/2026/q4/assistant/desktop-tier/specs/very-long-path-without-any-spaces-at-all?ref=island&utm_source=assistant&utm_medium=desktop';
const reply = (r) => ({ content: { reply: { title: 'Draft a reply to Maya about the Q3 numbers and the travel line', ...r } } });

const VIEWS = [
  ['00-asking', 'asking', {}],
  ['01-thinking', 'reply', reply({ text: '', status: 'Thinking…', working: true })],
  ['02-waking', 'reply', reply({ text: '', status: 'Waking up — the first answer takes a few extra seconds…', working: true })],
  ['03-short-answer', 'reply', { content: { reply: { title: 'What is 15 percent of 240?', text: '15 percent of 240 is 36.', canInsert: true } } }],
  ['04-streaming-long', 'reply', reply({ text: LONG.slice(0, 260), working: true })],
  ['05-long-answer-settled', 'reply', reply({ text: LONG, canInsert: true })],
  ['06-long-answer-copied', 'reply', reply({ text: LONG, canInsert: true, copied: true })],
  ['07-unbroken-url', 'reply', { content: { reply: { title: 'Where is the roadmap?', text: `It is here: ${URL_LONG}`, canInsert: true } } }],
  ['08-desktop-step', 'reply', { content: { reply: { title: 'Open TextEdit and type the shopping list from my notes', text: 'Typing it into the open document.', status: 'Typing “eggs, milk, bread, coffee, oat…”…', working: true, step: 3 } } }],
  ['09-desktop-done', 'reply', { content: { reply: { title: 'Open TextEdit and type the shopping list from my notes', text: 'The shopping list is typed into a new TextEdit document.', done: true, step: 4 } } }],
  ['10-handoff', 'reply', { content: { reply: { title: 'Research the best hiking boots under $200 and make a comparison table', text: 'Handing the boot comparison to a new chat on the Assistant page.', chat: true } } }],
  ['11-confirm-type-long', 'approval', { content: { notice: { title: 'Type this text?', body: '', quote: LONG, primary: 'Do it', secondary: 'Run the rest', tertiary: 'No' } } }],
  ['12-confirm-url', 'approval', { content: { notice: { title: 'Open this address in your browser?', body: '', quote: URL_LONG, primary: 'Do it', secondary: 'Run the rest', tertiary: 'No' } } }],
  ['13-confirm-forced', 'approval', { content: { notice: { title: 'Quit TextEdit?', body: '', footnote: 'Quitting can lose unsaved work, so this always asks.', primary: 'Do it', secondary: null, tertiary: 'No' } } }],
  ['14-ask-long-options', 'ask', { content: { ask: { question: 'Which of these documents should I send to the design review — the latest export or the one Maya annotated yesterday afternoon?', options: ['Island v3 – final export (shared with the whole design team on Monday)', 'Island v3 – Maya’s annotated copy', 'Both'] } } }],
  ['15-ask-free-text', 'ask', { content: { ask: { question: 'What should the reminder say?', options: [] } } }],
  ['16-install-helper', 'setup', { content: { notice: { title: 'Install the desktop helper', body: 'To see and use your other apps, Tellaflow needs a small helper (Peekaboo). It downloads once and is checked before it runs.', primary: 'Install', primaryAction: 'install-helper', secondary: 'Later' } } }],
  ['17-installing', 'setup', { content: { notice: { title: 'Installing the desktop helper…', body: '', progress: 0.62, footnote: 'Downloading… 62%', primary: null, secondary: null } } }],
  ['18-accessibility', 'setup', { content: { notice: { title: 'Allow Accessibility', body: 'Tellaflow needs Accessibility to click and type in your other apps.', footnote: 'Turn on Tellaflow in System Settings › Privacy & Security › Accessibility, then ask again.', primary: 'Open System Settings', secondary: 'Later' } } }],
  ['19-sign-in', 'error', { content: { notice: { title: 'Sign in to your AI', body: 'The assistant runs on an AI you’re signed in to on this Mac — Claude Code or Codex. No API keys.', footnote: 'Sign in opens Terminal for it; your browser finishes the sign-in. Then ask again.', primary: 'Sign in', primaryAction: 'sign-in', secondary: 'Settings', secondaryAction: 'open-settings' } } }],
  ['20-error-long', 'error', { content: { notice: { title: 'That didn’t work', body: `Agent backend 500: ${'x'.repeat(40)} ${URL_LONG}`, primary: 'Try again', secondary: 'Dismiss' } } }],
  // Dictation's own cards share the Notice layout — checked so it stays theirs.
  ['21-meeting', 'meeting', { content: { notice: { title: 'Design sync is starting', body: 'Google Meet · 6 people · 30 min. Take notes as it happens?' } } }],
  ['22-mic-setup', 'setup', {}],
  ['23-mic-error', 'error', {}],
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
const T = (fn, arg) => app.evaluate(fn, arg);
try {
  const onboarding = await waitFor(() => app.windows().find((w) => w.url().includes('onboarding')), { label: 'onboarding' });
  await onboarding.waitForLoadState('domcontentloaded');
  await onboarding.evaluate(() => window.tellaflow.completeOnboarding());
  await sleep(1500);
  for (const material of ['translucent', 'opaque']) {
    const main = await waitFor(() => app.windows().find((w) => w.url().includes('index.html')), { label: 'main window' });
    await main.evaluate((m) => window.tellaflow.setFeatureSetting('islandMaterial', m), material);
    for (const [name, state, opts] of VIEWS) {
      if (material === 'opaque' && !['05-long-answer-settled', '11-confirm-type-long', '14-ask-long-options'].includes(name)) continue;
      await T((_, a) => globalThis.__tellaflowTest.island.show(a.state, a.opts), { state, opts });
      const page = await waitFor(() => app.windows().find((w) => w.url().includes('toast.html')), { label: 'island' });
      await sleep(900);
      const box = await page.evaluate(() => {
        const island = document.querySelector('[data-island]');
        if (!island) return null;
        const r = island.getBoundingClientRect();
        // Anything inside wider than the island, or poking out of it.
        let overflow = 0;
        for (const el of island.querySelectorAll('*')) {
          const e = el.getBoundingClientRect();
          if (e.width && (e.right > r.right + 0.5 || e.left < r.left - 0.5)) overflow++;
          if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible' && el.children.length === 0) overflow++;
        }
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height, vw: innerWidth, vh: innerHeight, overflow };
      });
      const file = `${name}${material === 'opaque' ? '-opaque' : ''}.png`;
      await page.screenshot({ path: path.join(OUT, file), omitBackground: true });
      const inside = box && box.top >= 0 && box.left >= 0 && box.right <= box.vw && box.bottom <= box.vh;
      check(`${file}: inside the window, nothing overflows`, !!inside && box.overflow === 0, box ? `${Math.round(box.width)}×${Math.round(box.height)} · overflow ${box.overflow}` : 'no island');
    }
  }
} catch (err) {
  check('run', false, err.message);
} finally {
  await app.close().catch(() => {});
  try { process.kill(-vite.pid); } catch {}
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} FAILED` : 'ALL PASSED', `\nScreenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
