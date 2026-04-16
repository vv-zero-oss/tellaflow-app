#!/usr/bin/env node
/**
 * diagnose-agent.js — End-to-end agent pipeline diagnostic
 *
 * Tests every link in the chain with REAL OS actions:
 *   1. osascript availability
 *   2. open_url  (opens Safari/Chrome)
 *   3. YouTube search → page load → click first result
 *   4. Chrome extension WebSocket connection
 *   5. JavaScript injection into Chrome
 *   6. LLM tool selection for "play music on YouTube"
 *
 * Run:  node scripts/diagnose-agent.js
 * Flags: --no-browser   skip OS browser tests (safe for CI)
 *        --no-llm       skip LLM tests
 */

const { execFile, exec } = require('child_process');
const { promisify } = require('util');
const https = require('https');
const path  = require('path');
const os    = require('os');
const fs    = require('fs');
const net   = require('net');

const execFileAsync = promisify(execFile);
const execAsync     = promisify(exec);

const noBrowser = process.argv.includes('--no-browser');
const noLLM     = process.argv.includes('--no-llm');

// ── Colour helpers ────────────────────────────────────────────────────────────
const G = (s) => `\x1b[32m${s}\x1b[0m`;
const R = (s) => `\x1b[31m${s}\x1b[0m`;
const Y = (s) => `\x1b[33m${s}\x1b[0m`;
const B = (s) => `\x1b[36m${s}\x1b[0m`;
const D = (s) => `\x1b[2m${s}\x1b[0m`;

let passed = 0, failed = 0, warned = 0;

function ok(label, detail = '') {
  console.log(`  ${G('✓')} ${label}${detail ? D('  ' + detail) : ''}`);
  passed++;
}

function fail(label, detail = '') {
  console.log(`  ${R('✗')} ${label}${detail ? `\n    ${R(detail)}` : ''}`);
  failed++;
}

function warn(label, detail = '') {
  console.log(`  ${Y('⚠')} ${label}${detail ? `\n    ${Y(detail)}` : ''}`);
  warned++;
}

function section(title) {
  console.log(`\n${B('━━')} ${title}`);
}

async function osa(script, timeout = 8000) {
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout });
  return stdout.trim();
}

// ── 1. osascript ──────────────────────────────────────────────────────────────
async function testOsascript() {
  section('1. osascript');
  try {
    const r = await osa('return "ok"');
    if (r === 'ok') ok('osascript is available');
    else fail('osascript returned unexpected value', r);
  } catch (e) {
    fail('osascript not available', e.message);
  }

  // Check Accessibility permission
  try {
    await osa('tell application "System Events" to get name of every process');
    ok('Accessibility permission granted');
  } catch (e) {
    warn('Accessibility permission may be missing',
      'Grant it in System Settings → Privacy & Security → Accessibility');
  }
}

// ── 2. Browser detection ──────────────────────────────────────────────────────
async function testBrowserDetection() {
  section('2. Browser detection');
  try {
    const running = await osa(
      'tell application "System Events" to get name of every process whose background only is false'
    );
    const hasChromeApp  = fs.existsSync('/Applications/Google Chrome.app');
    const hasSafariApp  = fs.existsSync('/Applications/Safari.app');
    const chromeRunning = running.includes('Google Chrome');
    const safariRunning = running.includes('Safari');

    hasChromeApp  ? ok('Google Chrome installed') : warn('Google Chrome not found');
    hasSafariApp  ? ok('Safari installed')         : warn('Safari not found');
    chromeRunning ? ok('Chrome is running')        : warn('Chrome is NOT currently running', 'open_url will start it but extension won\'t be auto-connected');
    safariRunning ? ok('Safari is running')        : warn('Safari is NOT currently running');

    return chromeRunning ? 'Google Chrome' : (safariRunning ? 'Safari' : 'Google Chrome');
  } catch (e) {
    fail('Could not detect running browsers', e.message);
    return 'Safari';
  }
}

// ── 3. open_url ───────────────────────────────────────────────────────────────
async function testOpenUrl(browser) {
  if (noBrowser) { warn('Skipping browser tests (--no-browser)'); return; }

  section('3. open_url — navigate browser');
  const testUrl = 'https://www.youtube.com/results?search_query=lofi+hip+hop';

  try {
    if (browser === 'Google Chrome') {
      await osa(`
        tell application "Google Chrome"
          activate
          if (count every window) = 0 then make new window end if
          set URL of active tab of front window to "${testUrl}"
        end tell`);
    } else {
      await osa(`
        tell application "Safari"
          activate
          if (count every window) = 0 then make new window end if
          set URL of current tab of front window to "${testUrl}"
        end tell`);
    }
    ok(`open_url works — opened YouTube search in ${browser}`);
    return true;
  } catch (e) {
    fail(`open_url failed in ${browser}`, e.message);
    return false;
  }
}

// ── 4. JavaScript injection (Chrome) ─────────────────────────────────────────
async function testJsInjection(browser) {
  if (noBrowser || browser !== 'Google Chrome') return false;

  section('4. JavaScript injection via osascript');

  // Wait for page to load
  await new Promise(r => setTimeout(r, 3000));

  try {
    const result = await osa(
      `tell application "Google Chrome" to execute active tab of front window javascript "document.title"`
    );
    if (result && result.length > 0) {
      ok('JS injection works in Chrome', `page title = "${result}"`);
      return true;
    } else {
      warn('JS injection returned empty — "Allow JavaScript from Apple Events" may be disabled',
        'Chrome DevTools → Settings → Experiments → Allow JavaScript from Apple Events');
      return false;
    }
  } catch (e) {
    warn(
      'JS injection failed — "Allow JavaScript from Apple Events" is not enabled',
      'This means youtube_click_first_result (osascript path) won\'t work.\n    ' +
      'Fix: Enable it in Chrome DevTools → Settings → Experiments\n    ' +
      'OR install the Tellaflow Chrome extension instead.'
    );
    return false;
  }
}

// ── 5. HTTP-based YouTube first result fetch ──────────────────────────────────
async function testYoutubeHttpFetch() {
  section('5. YouTube first result (HTTP fetch, no extension needed)');
  const query = 'lofi hip hop';

  try {
    const videoUrl = await fetchFirstYoutubeResult(query);
    ok(`HTTP fetch found first result`, videoUrl);
    return videoUrl;
  } catch (e) {
    fail('HTTP fetch failed', e.message);
    return null;
  }
}

function fetchFirstYoutubeResult(query) {
  return new Promise((resolve, reject) => {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
      (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          // Follow redirect
          return resolve(fetchFirstYoutubeResult(query));
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; if (data.length > 500000) req.destroy(); });
        res.on('end', () => {
          // Extract first videoId from ytInitialData JSON blob
          const match = data.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
          if (match) {
            resolve(`https://www.youtube.com/watch?v=${match[1]}`);
          } else {
            reject(new Error('Could not find videoId in YouTube page source'));
          }
        });
      }
    );
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('HTTP timeout')); });
    req.on('error', reject);
  });
}

// ── 6. Navigate to first result ───────────────────────────────────────────────
async function testNavigateToVideo(browser, videoUrl) {
  if (noBrowser || !videoUrl) return;

  section('6. Navigate to first YouTube result (HTTP approach)');

  try {
    const safeUrl = videoUrl.replace(/"/g, '\\"');
    if (browser === 'Google Chrome') {
      await osa(`
        tell application "Google Chrome"
          activate
          set URL of active tab of front window to "${safeUrl}"
        end tell`);
    } else {
      await osa(`
        tell application "Safari"
          activate
          set URL of current tab of front window to "${safeUrl}"
        end tell`);
    }
    ok(`Navigated to video — ${videoUrl}`);

    // Wait and try to play
    await new Promise(r => setTimeout(r, 3000));

    if (browser === 'Google Chrome') {
      try {
        const r = await osa(
          `tell application "Google Chrome" to execute active tab of front window javascript "document.querySelector('video')?.play();'play attempted'"`
        );
        ok('Video play triggered via JS injection', r);
      } catch {
        warn('JS play failed — video may autoplay or need manual play',
          'YouTube videos usually autoplay when navigated to directly');
      }
    }
  } catch (e) {
    fail('Navigate to video failed', e.message);
  }
}

// ── 7. WebSocket / extension ──────────────────────────────────────────────────
async function testWebSocket() {
  section('7. WebSocket bridge (ws://localhost:9009)');

  const portOpen = await new Promise((resolve) => {
    const s = net.createConnection(9009, 'localhost');
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error',   () => resolve(false));
    setTimeout(() => { s.destroy(); resolve(false); }, 2000);
  });

  if (portOpen) {
    ok('WebSocket server is listening on port 9009');
    // Check if extension is connected
    try {
      const WebSocket = require('ws');
      const ws = new WebSocket('ws://localhost:9009');
      await new Promise((resolve) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'get_status' }));
          setTimeout(() => { ws.close(); resolve(); }, 1000);
        });
        ws.on('error', () => resolve());
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.connected) ok('Chrome extension IS connected to Tellaflow ✓');
          else warn('Chrome extension is NOT connected yet',
            'Load /extension folder as unpacked extension in Chrome → chrome://extensions → Load unpacked');
        });
        setTimeout(() => { ws.close(); resolve(); }, 2000);
      });
    } catch {
      warn('Could not check extension connection (ws package may not be available in this context)');
    }
  } else {
    warn('WebSocket server is not running',
      'Start the Tellaflow app first. The server starts automatically when the app opens.');
  }
}

// ── 8. Skill loader ───────────────────────────────────────────────────────────
async function testSkillLoader() {
  section('8. Skill loader');

  const Module = require('module');
  const orig = Module._load;
  Module._load = function (r, ...a) {
    if (r === 'electron') return {
      app: { getPath: () => os.homedir(), isPackaged: false },
      clipboard: { readText: () => '', writeText: () => {}, clear: () => {} },
      shell: { openPath: () => {}, openExternal: () => {}, showItemInFolder: () => {} },
    };
    if (r === 'ws') return { WebSocketServer: class { on() {} } };
    if (r === 'better-sqlite3') return function MockDB() {
      const stmt = { get: () => ({ cnt: 0 }), all: () => [], run: () => ({ changes: 0 }) };
      return { pragma: () => {}, exec: () => {}, prepare: () => stmt, transaction: (fn) => fn, close: () => {} };
    };
    return orig.apply(this, [r, ...a]);
  };

  try {
    const sl = require('../src/main/skill-loader');
    sl.reloadSkills();
    const tools = sl.getToolDefinitions();
    ok(`Loaded ${tools.length} tools`);

    const key = ['open_url', 'search_youtube', 'youtube_click_first_result', 'ext_navigate', 'gmail_compose', 'spotify_play_pause', 'twitter_tweet'];
    for (const k of key) {
      const t = tools.find(x => x.name === k);
      t ? ok(`  Tool "${k}" ✓`) : fail(`  Tool "${k}" missing`);
    }
  } catch (e) {
    fail('Skill loader failed', e.message);
  }
}

// ── 9. Model availability ─────────────────────────────────────────────────────
async function testModel() {
  section('9. Agent model');

  const modelDirs = [
    path.join(os.homedir(), 'Library', 'Application Support', 'tellaflow', 'models'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Tellaflow', 'models'),
  ];

  const modelFiles = ['Qwen_Qwen3-1.7B-Q4_K_M.gguf', 'Qwen2.5-3B-Instruct-Q4_K_M.gguf',
                      'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf'];

  let found = false;
  for (const dir of modelDirs) {
    for (const f of modelFiles) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) {
        const size = (fs.statSync(p).size / 1024 / 1024).toFixed(0);
        ok(`Found ${f}`, `${size} MB at ${p}`);
        found = true;
      }
    }
  }

  if (!found) {
    fail('No agent model found', 'Download one from the Agent page in the Tellaflow app');
  }

  // Check if .tmp files are present (incomplete download)
  for (const dir of modelDirs) {
    if (!fs.existsSync(dir)) continue;
    const tmpFiles = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
    if (tmpFiles.length > 0) {
      warn(`Incomplete model download: ${tmpFiles.join(', ')}`,
        'The model is still downloading or the download was interrupted');
    }
  }
}

// ── 10. Full pipeline simulation (LLM) ───────────────────────────────────────
async function testLLMPipeline() {
  if (noLLM) { warn('Skipping LLM test (--no-llm)'); return; }

  section('10. LLM pipeline — "go to youtube and play lofi music"');

  // Same mocking as test-agent.js
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (r, ...a) {
    if (r === 'electron') return { app: { getPath: () => os.homedir(), isPackaged: false }, clipboard: { readText: () => '', writeText: () => {}, clear: () => {} }, shell: { openPath: () => {}, openExternal: () => {}, showItemInFolder: () => {} } };
    if (r === 'ws') return { WebSocketServer: class { on() {} } };
    if (r === 'better-sqlite3') return function MockDB() { const s = { get: () => ({ cnt: 0 }), all: () => [], run: () => ({ changes: 0 }) }; return { pragma: () => {}, exec: () => {}, prepare: () => s, transaction: (fn) => fn, close: () => {} }; };
    return orig.apply(this, [r, ...a]);
  };

  const agentMod = require('../src/main/agent');
  const REGISTRY = agentMod.AGENT_REGISTRY;
  const modelDirs = [
    path.join(os.homedir(), 'Library', 'Application Support', 'tellaflow', 'models'),
  ];

  let modelPath = null;
  for (const [, info] of Object.entries(REGISTRY)) {
    for (const dir of modelDirs) {
      const p = path.join(dir, info.filename);
      if (fs.existsSync(p)) { modelPath = p; break; }
    }
    if (modelPath) break;
  }

  if (!modelPath) {
    warn('No model found — skipping LLM test');
    return;
  }

  const { fork } = require('child_process');
  const sl = require('../src/main/skill-loader');
  sl.reloadSkills();

  const { buildContext } = require('../src/main/memory');
  const transcript = 'go to youtube and play lofi hip hop music';

  console.log(`  Testing: "${transcript}"`);
  console.log(`  Loading model (10-30s)…`);

  const worker = fork(path.join(__dirname, '..', 'src', 'main', 'agent-worker.js'), [], { silent: true });
  worker.stderr.on('data', () => {}); // suppress llama.cpp noise

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Model load timeout')), 90000);
    worker.once('message', (msg) => {
      if (msg.type === 'init-done') { clearTimeout(timer); resolve(); }
      else if (msg.type === 'error') { clearTimeout(timer); reject(new Error(msg.error)); }
    });
    worker.send({ type: 'init', modelPath });
  }).catch(e => { fail('LLM init failed', e.message); return; });

  console.log('  Model loaded. Running agent...');

  const allTools = sl.getToolDefinitions();

  // Use same filter logic from agent.js
  function filterTools(t, tools) {
    const lower = t.toLowerCase();
    const allowed = new Set(['show_notification', 'remember', 'recall', 'open_url', 'search_youtube',
      'youtube_click_first_result', 'youtube_play_pause', 'ext_yt_play_first_result', 'ext_yt_play_pause',
      'youtube_search', 'youtube_like', 'search_google', 'open_app', 'open_url_default']);
    return tools.filter(t => allowed.has(t.name));
  }

  const tools = filterTools(transcript, allTools);
  const contextText = buildContext();

  const toolCalls = [];
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Agent timeout (60s)')), 60000);
    worker.on('message', (msg) => {
      if (msg.type === 'tool-call') {
        const stubFn = {
          open_url:                  (a) => `[STUB] Opened ${a.url}`,
          search_youtube:            (a) => `[STUB] YouTube search results open for "${a.query}"`,
          youtube_click_first_result: () => `[STUB] Playing: "Lofi Hip Hop Radio 24/7"`,
          youtube_play_pause:        () => `[STUB] Video playing`,
          ext_yt_play_first_result:  () => `[STUB] Extension: playing first result`,
          show_notification:         (a) => `[STUB] Notification: ${a.title}`,
          open_app:                  (a) => `[STUB] Opened ${a.app}`,
          open_url_default:          (a) => `[STUB] Opened ${a.url}`,
        }[msg.toolName];
        const r = stubFn ? String(stubFn(msg.args || {})) : `[STUB] ${msg.toolName}()`;
        toolCalls.push({ tool: msg.toolName, args: msg.args, result: r });
        worker.send({ type: 'tool-result', reqId: msg.reqId, result: r });
      } else if (msg.type === 'result') {
        clearTimeout(timer);
        resolve(msg.reply);
      } else if (msg.type === 'error') {
        clearTimeout(timer);
        reject(new Error(msg.error));
      }
    });
    worker.send({ type: 'run', id: Date.now(), transcript, tools, contextText });
  }).catch(e => { fail('LLM run failed', e.message); worker.kill(); return null; });

  worker.kill();

  if (result !== null) {
    if (toolCalls.length === 0) {
      fail('LLM made NO tool calls — it replied without taking action');
    } else {
      const toolNames = toolCalls.map(t => t.tool);
      const wentToYT  = toolNames.some(n => ['open_url', 'search_youtube', 'ext_navigate', 'open_url_default'].includes(n));
      const playedVid = toolNames.some(n => ['youtube_click_first_result', 'ext_yt_play_first_result', 'youtube_play_pause'].includes(n));

      ok(`LLM called ${toolCalls.length} tools: ${toolNames.join(' → ')}`);
      wentToYT  ? ok('Navigated to YouTube ✓')    : warn('Did not navigate to YouTube');
      playedVid ? ok('Attempted to play video ✓')  : warn('Did not play a video');
    }
    console.log(`  Reply: "${result}"`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${B('Tellaflow Agent Diagnostic')}`);
  console.log(D(`  Testing the full "go to YouTube and play music" pipeline\n`));

  await testOsascript();
  const browser = await testBrowserDetection();
  const browserOpened = await testOpenUrl(browser);
  const jsWorks = await testJsInjection(browser);

  if (!jsWorks) {
    section('4b. Alternative: HTTP fetch for YouTube result');
    console.log(D('  (Used when Chrome JS injection is not available)'));
  }

  const videoUrl = await testYoutubeHttpFetch();
  await testNavigateToVideo(browser, videoUrl);
  await testWebSocket();
  await testSkillLoader();
  await testModel();
  await testLLMPipeline();

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log(`\n${B('━━')} Summary`);
  console.log(`  ${G(passed + ' passed')}  ${R(failed + ' failed')}  ${Y(warned + ' warnings')}\n`);

  if (failed > 0) {
    console.log(R('  Some checks failed — fix the issues above before running the agent.\n'));
  } else if (warned > 0) {
    console.log(Y('  All critical checks passed but there are warnings to review.\n'));
  } else {
    console.log(G('  All checks passed! The agent pipeline should work correctly.\n'));
  }

  // Key recommendations
  console.log(B('  Key steps to make agent work:'));
  console.log('  1. Open the Tellaflow app (starts the WebSocket server)');
  console.log('  2. Load the /extension folder as an unpacked Chrome extension');
  console.log('     chrome://extensions → Enable Developer mode → Load unpacked');
  console.log('  3. Open Chrome and navigate to YouTube');
  console.log('  4. The extension connects automatically to the app');
  console.log('  5. Say "go to YouTube and play lofi music" using the agent hotkey\n');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
