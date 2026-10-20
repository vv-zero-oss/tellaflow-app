#!/usr/bin/env node
/**
 * The assistant, end to end in the real app. First its setup, through the
 * real UI: off by default (no Assistant page, no command key), switched on in
 * Settings, then Download — the real Node + bb install (src/main/jarvis/
 * runtime.js) into a throwaway folder. Then real bb (started by the app on the
 * Node it downloaded, in a throwaway data folder), the real AI, the island:
 * sends commands the way the command key does and screenshots every island
 * state, then the Assistant page (bb framed) and Settings › Assistant.
 *
 *   xvfb-run -a node scripts/e2e-assistant.mjs [outDir]
 *
 * Needs: network (the download), a signed-in provider CLI (`claude`), the
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
const runtimeDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-assistant-rt-')), 'assistant');

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
const ran = (d, file) => (d?.quick ?? []).some((c) => c[0] === file);
const CASES = [
  // Instant commands: no AI, done as the key is let go.
  { id: 'instant-screenshot', request: 'Take a screenshot', expect: (v, t, d) => /Screenshot saved/.test(t) && ran(d, 'screencapture'), fast: true },
  { id: 'instant-music', request: 'Pause the music', expect: (v, t, d) => /Paused Spotify/.test(t) && ran(d, 'osascript'), fast: true },
  { id: 'instant-open', request: 'Open Safari', expect: (v, t, d) => /Opened Safari/.test(t) && ran(d, 'open'), fast: true },
  // Mixed requests: every step instant, or the instant part first and only
  // the rest to the AI.
  { id: 'mixed-instant', request: 'Open Safari and go to github.com', expect: (v, t, d) => /Opened Safari\. Opened github\.com\./.test(t) && d.quick.some((c) => c[1] === 'https://github.com'), fast: 'open-url' },
  { id: 'mixed-ai', request: 'Open Notes and tell me what 12 times 12 is', expect: (v, t, d) => /^Opened Notes\./.test(t) && /144/.test(t) && d.quick.some((c) => c[2] === 'Notes') },
  { id: 'answer', request: 'What is 15 percent of 240? Answer in one short sentence.', expect: (v, t) => /36/.test(t) },
  // A question that needs a lookup is answered here, by the island's own
  // thread with its tools — not handed to a chat.
  { id: 'lookup', request: 'What is the weather in Mumbai right now?', expect: (v, t) => /mumbai/i.test(t) && /°|degree|celsius|rain|humid|cloud|sunny|clear/i.test(t) && !v?.content?.reply?.chat },
  { id: 'follow-up', request: 'And in Fahrenheit?', expect: (v, t) => /°F|fahrenheit/i.test(t) },
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
  // The bridge: a chat asks on the island, gets the answer, and reports back
  // there when it is done.
  {
    id: 'chat-talks-back',
    request: 'Start a new chat to plan a three-course dinner menu for four. It must first ask me on the island whether it should be vegetarian, with the options Vegetarian and Anything.',
    expect: (v) => v?.content?.reply?.chat === true,
    bridge: true,
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
    TELLAFLOW_ASSISTANT_RUNTIME_DIR: runtimeDir,
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

  // ── Setup: off by default → switched on → Download → ready ─────────────
  const navAssistant = () => main.locator('nav button', { hasText: 'Assistant' }).count();
  const settingsTab = (name) => main.locator('[data-testid="settings-tabs"] [role="tab"]', { hasText: name });
  const commandKeyRow = () => main.getByText('Command key', { exact: true }).count();
  const trayShortcuts = async () => (await T(() => globalThis.__tellaflowTest.trayMenu.items())).find((i) => i.label === 'Shortcuts').submenu.map((i) => i.label);
  await sleep(1000);
  check('off by default: no Assistant page in the sidebar', (await navAssistant()) === 0);
  check('off by default: the menubar menu lists no assistant key', !(await trayShortcuts()).includes('Ask the assistant'));
  await T(() => globalThis.__tellaflowTest.navigate('settings'));
  await sleep(800);
  check('off by default: Settings has no Assistant tab', (await settingsTab('Assistant').count()) === 0);
  check('off by default: no command key setting anywhere', (await commandKeyRow()) === 0);
  await main.locator('[data-testid="beta-features"]').scrollIntoViewIfNeeded();
  await sleep(400);
  await main.screenshot({ path: path.join(OUT, 'setup-01-off.png') });
  await settingsTab('Permissions').click();
  await sleep(500);
  check('off by default: no Screen Recording permission to grant', (await main.getByText('Screen Recording', { exact: true }).count()) === 0);
  await settingsTab('General').click();
  await sleep(300);

  // Switching it on opens its own tab, with the download.
  await main.locator('[data-testid="assistant-enabled"]').click();
  const download = main.locator('[data-testid="assistant-download"]');
  await download.waitFor({ timeout: 10_000 });
  await sleep(600);
  check('on: lands on the new Assistant tab', (await settingsTab('Assistant').getAttribute('aria-selected')) === 'true');
  check('on: the Assistant page appears in the sidebar', (await navAssistant()) === 1);
  check('on: nothing is downloaded until Download is pressed', !fs.existsSync(runtimeDir));
  check('on: the menubar menu lists the assistant key', (await trayShortcuts()).includes('Ask the assistant'));
  await main.screenshot({ path: path.join(OUT, 'setup-02-on-download.png') });
  // Pressing the command key before the download: a notice, not silence.
  const keyStarted = await T(() => globalThis.__tellaflowTest.island.commandKeyDown());
  const notice = (await view())?.content?.notice;
  check('command key before the download says to download first', !keyStarted && /Download the assistant first/.test(notice?.title ?? ''), JSON.stringify(notice));
  await shot('setup-02b-command-key-before-download', 1200);
  // Its button opens Settings › Assistant.
  await T(() => globalThis.__tellaflowTest.navigate('transcripts'));
  await sleep(300);
  await act('retry');
  await sleep(600);
  check('the notice’s Open Settings lands on the Assistant tab', (await settingsTab('Assistant').getAttribute('aria-selected')) === 'true');
  // The Assistant page offers the same download.
  await main.locator('nav button', { hasText: 'Assistant' }).click();
  await sleep(800);
  await main.screenshot({ path: path.join(OUT, 'setup-03-assistant-page-download.png') });
  await T(() => globalThis.__tellaflowTest.navigate('settings/assistant'));
  await sleep(500);
  const assistantWell = main.locator('[data-testid="assistant-settings"]');

  const tDl = Date.now();
  await main.locator('[data-testid="assistant-download"]').click();
  await main.locator('[data-testid="assistant-download-progress"]').waitFor({ timeout: 10_000 });
  await assistantWell.scrollIntoViewIfNeeded();
  let phaseShots = 0;
  for (let last = ''; ;) {
    const rt = await main.evaluate(() => window.tellaflow.assistantRuntimeStatus());
    if (!rt.installing) { check('Download installs Node + bb', rt.state === 'installed' && !rt.error, `${rt.error ?? rt.state} in ${Math.round((Date.now() - tDl) / 1000)} s`); break; }
    const phase = rt.progress?.phase ?? '';
    if (phase !== last && phaseShots < 4) { last = phase; await sleep(300); await main.screenshot({ path: path.join(OUT, `setup-04-downloading-${++phaseShots}-${phase}.png`) }); }
    if (Date.now() - tDl > 600_000) { check('Download installs Node + bb', false, 'timed out'); break; }
    await sleep(250);
  }
  await main.locator('text=Run actions without asking').first().waitFor({ timeout: 15_000 });
  await assistantWell.scrollIntoViewIfNeeded();
  await sleep(1500);
  await main.screenshot({ path: path.join(OUT, 'setup-05-ready.png') });

  await main.evaluate((p) => window.tellaflow.assistantSetSettings({ provider: p, screenVision: false }), process.env.E2E_PROVIDER || 'claude-code');

  for (const c of CASES) {
    const t0 = Date.now();
    const quickBefore = (await desk())?.quick?.length ?? 0;
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
        const dd = d ? { ...d, quick: (d.quick ?? []).slice(quickBefore) } : {};
        check(`${c.id}: "${c.request}"`, !!c.expect(v, reply?.text ?? '', dd), `${st}: ${JSON.stringify(reply?.text ?? v?.content?.notice ?? '')} · first words ${firstWordsMs ?? '—'} ms · ${Math.round((Date.now() - t0) / 1000)} s`);
        if (c.fast) check(`${c.id}: answered in under a second, without the AI`, firstWordsMs !== null && firstWordsMs < 1000 && mainLogs.join('').includes(`instant command { id: '${typeof c.fast === 'string' ? c.fast : c.request.includes('screenshot') ? 'screenshot' : c.request.includes('music') ? 'media' : 'open-app'}'`), `${firstWordsMs} ms to the answer`);
        break;
      }
      await sleep(120);
    }
    summary.push(`${c.id}: "${c.request}" → ${seen.map((s) => s.split('|')[0]).join(' → ')}`);
    await act(c.then || 'dismiss');
    await sleep(800);
    if (c.bridge) await chatTalksBack(c);
  }

  /** After a hand-off: the chat's question on the island, answered there, and
   *  its report on the island when it is done. */
  async function chatTalksBack(c) {
    const t0 = Date.now();
    const ask = await waitFor(async () => { const v = await view(); return v?.state === 'ask' ? v : null; }, { label: "the chat's question on the island", timeout: 240_000 }).catch(() => null);
    check(`${c.id}: the chat asks on the island`, !!ask, JSON.stringify(ask?.content?.ask ?? null));
    if (ask) {
      await shot(`${c.id}-ask`, 400);
      const i = Math.max(0, (ask.content.ask.options ?? []).findIndex((o) => /veg/i.test(o)));
      await act(`answer:${i}`);
      await sleep(300);
      await shot(`${c.id}-answered`, 100);
    }
    const report = await waitFor(async () => {
      const v = await view();
      const r = v?.content?.reply;
      return v?.state === 'reply' && r && !r.working && r.chat && r.done && r.text && !/started|I'll tell you/i.test(r.text) ? v : null;
    }, { label: "the chat's report on the island", timeout: 300_000, every: 300 }).catch(() => null);
    check(`${c.id}: the chat reports back on the island`, !!report, `${JSON.stringify(report?.content?.reply ?? null)} · ${Math.round((Date.now() - t0) / 1000)} s after the hand-off`);
    if (report) await shot(`${c.id}-report`, 400);
    summary.push(`${c.id}: chat → ask on island → answered → report on island: ${JSON.stringify(report?.content?.reply?.text ?? null)}`);
    await act('dismiss');
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

  // bb wears the app's theme: its mode, and its background is the card it sits in.
  const themeMatches = async () => {
    const app = await main.evaluate(() => ({
      dark: document.documentElement.classList.contains('dark'),
      card: getComputedStyle(document.querySelector('[data-assistant-frame]').parentElement).backgroundColor,
    }));
    const bb = await frame.evaluate(() => ({
      dark: document.documentElement.classList.contains('dark'),
      bg: getComputedStyle(document.body).backgroundColor,
      styled: !!document.getElementById('__tellaflow_bb_chrome'),
    }));
    return { ok: bb.styled && app.dark === bb.dark && app.card === bb.bg, app, bb };
  };
  if (frame) {
    const dark = await waitFor(async () => { const r = await themeMatches(); return r.ok ? r : null; }, { label: 'bb in the dark theme', timeout: 15_000 }).catch(async () => themeMatches());
    check('bb wears the app’s dark theme', dark.ok, JSON.stringify(dark));
    // What the app's own applyTheme does (src/renderer/src/lib/theme.ts).
    await main.evaluate(() => { window.tellaflow.setTheme('light'); document.documentElement.classList.remove('dark'); document.documentElement.classList.add('light'); });
    const light = await waitFor(async () => { const r = await themeMatches(); return r.ok && !r.app.dark ? r : null; }, { label: 'bb in the light theme', timeout: 15_000 }).catch(async () => themeMatches());
    check('bb follows the app to light, live', light.ok && !light.app.dark, JSON.stringify(light));
    await sleep(1000);
    await main.screenshot({ path: path.join(OUT, 'assistant-page-light.png') });
    await main.evaluate(() => { window.tellaflow.setTheme('dark'); document.documentElement.classList.remove('light'); document.documentElement.classList.add('dark'); });
    await sleep(800);
  }

  await T(() => globalThis.__tellaflowTest.navigate('settings/assistant'));
  await sleep(800);
  await main.locator('text=What can I say?').first().click();
  await main.locator('text=Run actions without asking').first().scrollIntoViewIfNeeded();
  await sleep(2500);
  await main.screenshot({ path: path.join(OUT, 'settings-assistant.png') });
  check('Settings › Assistant lists the instant commands', (await main.locator('[data-quick-commands] li').count()) >= 10);
  check('Settings › Assistant has no Control apps row', (await main.locator('text=Control apps').count()) === 0);

  // ── And back out: Remove frees the disk; off hides it all and stops bb ──
  await main.locator('[data-testid="assistant-settings"] button', { hasText: 'Remove' }).click();
  await main.locator('[data-testid="assistant-download"]').waitFor({ timeout: 30_000 });
  check('Remove deletes the download', !fs.existsSync(runtimeDir));
  const bbUp = async () => { try { return (await fetch('http://127.0.0.1:38986/health')).ok; } catch { return false; } };
  check('Remove stops bb', !(await bbUp()));
  await main.locator('[data-testid="assistant-settings"]').scrollIntoViewIfNeeded();
  await sleep(600);
  await main.screenshot({ path: path.join(OUT, 'setup-06-removed.png') });
  await main.locator('[data-testid="assistant-turn-off"]').click();
  await sleep(800);
  check('off again: no Assistant page, tab or command key', (await navAssistant()) === 0 && (await settingsTab('Assistant').count()) === 0 && (await commandKeyRow()) === 0);
  check('off again: back on General, by the switch', (await settingsTab('General').getAttribute('aria-selected')) === 'true');
  await main.screenshot({ path: path.join(OUT, 'setup-07-off-again.png') });

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
