#!/usr/bin/env node
/**
 * test-agent.js — Standalone agent test runner
 *
 * Sends 10 natural-language commands directly to the agent worker,
 * stubs OS-level actions so nothing actually opens or runs,
 * and logs the full tool-call chain + final reply for each test.
 *
 * Run:
 *   node scripts/test-agent.js [--model qwen3-1.7b] [--real]
 *
 * Flags:
 *   --model <key>  Model key from AGENT_REGISTRY (default: first available)
 *   --real         Execute real OS actions (skip stubbing). Dangerous!
 *   --filter <n>   Run only test number N (1-based)
 */

const path  = require('path');
const { fork } = require('child_process');
const os    = require('os');
const fs    = require('fs');

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const realMode    = args.includes('--real');
const modelArg    = args[args.indexOf('--model') + 1] || null;
const filterArg   = args[args.indexOf('--filter') + 1] ? parseInt(args[args.indexOf('--filter') + 1]) : null;

// ── Mock native/Electron modules that don't work in plain Node ───────────────

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (key) => {
          if (key === 'userData') return path.join(os.homedir(), '.tellaflow-test');
          return os.homedir();
        },
        isPackaged: false,
      },
      clipboard: {
        readText:  ()  => 'mocked clipboard text',
        writeText: (t) => {},
        clear:     ()  => {},
      },
      shell: {
        openPath:         () => {},
        openExternal:     () => {},
        showItemInFolder: () => {},
      },
    };
  }

  if (request === 'ws') {
    return { WebSocketServer: class { on() {} } };
  }

  // better-sqlite3 is compiled for Electron's Node — mock it for plain Node tests
  if (request === 'better-sqlite3') {
    return function MockDB() {
      const stmt = {
        get:         () => ({ cnt: 0, count: 0, value: null }),
        all:         () => [],
        run:         () => ({ changes: 0, lastInsertRowid: 1 }),
        iterate:     () => [][Symbol.iterator](),
      };
      const db = {
        pragma:      () => {},
        exec:        () => {},
        prepare:     () => stmt,
        transaction: (fn) => fn, // return fn as-is so it can be called
        close:       () => {},
      };
      return db;
    };
  }

  return origLoad.apply(this, [request, ...rest]);
};

// ── Ensure userData dir exists ────────────────────────────────────────────────

const userData = path.join(os.homedir(), '.tellaflow-test');
fs.mkdirSync(path.join(userData, 'models'), { recursive: true });
fs.mkdirSync(path.join(userData, 'skills'), { recursive: true });

// ── Resolve model path ────────────────────────────────────────────────────────

const agentModule = require('../src/main/agent');
const REGISTRY    = agentModule.AGENT_REGISTRY;

const MODEL_DIRS = [
  path.join(userData, 'models'),
  path.join(process.env.HOME, 'Library', 'Application Support', 'tellaflow', 'models'),
  path.join(process.env.HOME, 'Library', 'Application Support', 'Tellaflow', 'models'),
  path.join(process.env.HOME, '.config', 'tellaflow', 'models'),
];

function findModel(key) {
  const info = REGISTRY[key];
  if (!info) return null;
  for (const dir of MODEL_DIRS) {
    const p = path.join(dir, info.filename);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Check all models
const availableModels = Object.entries(REGISTRY)
  .map(([key, info]) => {
    const p = findModel(key);
    return { key, info, path: p, available: !!p };
  })
  .filter(m => m.available);

if (availableModels.length === 0) {
  console.error('\n❌  No agent model found. Download one from the Agent page in the app first.\n');
  process.exit(1);
}

const chosenModel = modelArg
  ? availableModels.find(m => m.key === modelArg) || availableModels[0]
  : availableModels[0];

console.log(`\n✦ Tellaflow Agent Test Runner`);
console.log(`  Model : ${chosenModel.info.name} (${chosenModel.key})`);
console.log(`  Path  : ${chosenModel.path}`);
console.log(`  Mode  : ${realMode ? '⚠️  REAL (OS actions enabled)' : '🔒 STUB (OS actions mocked)'}`);
console.log(`${'─'.repeat(65)}\n`);

// ── Load skill-loader with stubs ──────────────────────────────────────────────

const skillLoader = require('../src/main/skill-loader');
skillLoader.reloadSkills();

// Stub executor for safe testing
const STUB_RESULTS = {
  // Browser
  open_url:                   (a) => `[STUB] Opened ${a.url} in ${a.browser || 'Safari'}`,
  search_google:              (a) => `[STUB] Searched Google for "${a.query}"`,
  search_youtube:             (a) => `[STUB] Opened YouTube search for "${a.query}"`,
  open_new_tab:               ()  => `[STUB] Opened new tab`,
  get_current_url:            ()  => `https://www.google.com`,
  get_page_title:             ()  => `Google`,
  browser_back:               ()  => `[STUB] Went back`,
  browser_reload:             ()  => `[STUB] Reloaded page`,
  list_tabs:                  ()  => `1. Google — https://google.com\n2. YouTube — https://youtube.com`,
  close_tab:                  ()  => `[STUB] Tab closed`,
  run_js_in_page:             (a) => `[STUB] JS result: "${a.script?.slice(0, 40)}"`,
  get_page_text:              ()  => `[STUB] Page content: "Breaking news: AI assistant works perfectly..."`,
  click_element:              (a) => `[STUB] Clicked element: ${a.selector}`,
  fill_input:                 (a) => `[STUB] Filled ${a.selector} with "${a.value}"`,
  youtube_play_pause:         ()  => `[STUB] Video playing`,
  youtube_click_first_result: ()  => `[STUB] Playing: "First YouTube result"`,
  // Extension
  ext_navigate:               (a) => `[STUB] Navigated to ${a.url}`,
  ext_get_url:                ()  => `https://www.youtube.com/results?search_query=lofi`,
  ext_get_text:               ()  => `[STUB] Page text: "Search results for lofi hip hop..."`,
  ext_get_links:              ()  => `[{"text":"Lofi Hip Hop Radio","href":"https://youtube.com/watch?v=test"}]`,
  ext_click:                  (a) => `[STUB] Clicked: ${a.selector}`,
  ext_click_text:             (a) => `[STUB] Clicked element with text: "${a.text}"`,
  ext_fill:                   (a) => `[STUB] Filled ${a.selector} with "${a.value}"`,
  ext_submit:                 ()  => `[STUB] Form submitted`,
  ext_scroll:                 (a) => `[STUB] Scrolled ${a.direction}`,
  ext_run_js:                 (a) => `[STUB] JS: "${a.script?.slice(0, 40)}"`,
  ext_new_tab:                (a) => `[STUB] New tab: ${a.url || 'blank'}`,
  ext_list_tabs:              ()  => `1. Google — https://google.com`,
  ext_switch_tab:             (a) => `[STUB] Switched to tab ${a.index}`,
  ext_yt_play_first_result:   ()  => `[STUB] Playing: "Lofi Hip Hop Radio"`,
  ext_yt_play_pause:          ()  => `[STUB] Video paused`,
  // Files
  read_file:                  (a) => `[STUB] Contents of ${a.path}: "Hello world"`,
  write_file:                 (a) => `[STUB] Wrote to ${a.path}`,
  list_directory:             (a) => `[STUB] Files in ${a.path}:\n[file] readme.txt\n[file] photo.jpg`,
  copy_file:                  (a) => `[STUB] Copied ${a.from} → ${a.to}`,
  move_file:                  (a) => `[STUB] Moved ${a.from} → ${a.to}`,
  delete_file:                (a) => `[STUB] Deleted ${a.path}`,
  open_in_finder:             (a) => `[STUB] Opened in Finder: ${a.path}`,
  file_info:                  (a) => JSON.stringify({ path: a.path, type: 'file', size_bytes: 12345 }),
  create_directory:           (a) => `[STUB] Created ${a.path}`,
  copy_file_path_to_clipboard:(a) => `[STUB] Copied path: ${a.path}`,
  copy_latest_download_to_clipboard: () => `[STUB] Copied path: ~/Downloads/latest-report.pdf`,
  open_file:                  (a) => `[STUB] Opened: ${a.path}`,
  // Clipboard
  get_clipboard:              ()  => `mocked clipboard text`,
  set_clipboard:              (a) => `[STUB] Clipboard set to: "${a.text?.slice(0, 60)}"`,
  clear_clipboard:            ()  => `[STUB] Clipboard cleared`,
  // Apps
  open_app:                   (a) => `[STUB] Opened ${a.app}`,
  quit_app:                   (a) => `[STUB] Quit ${a.app}`,
  hide_app:                   (a) => `[STUB] Hidden ${a.app}`,
  minimize_window:            (a) => `[STUB] Minimized ${a.app || 'window'}`,
  get_frontmost_app:          ()  => `Google Chrome`,
  list_running_apps:          ()  => `Safari, Google Chrome, Finder, Terminal, Slack`,
  take_screenshot:            (a) => `[STUB] Screenshot saved to Desktop/${a.filename || 'Screenshot'}.png`,
  // Keyboard
  type_text:                  (a) => `[STUB] Typed: "${a.text?.slice(0, 60)}"`,
  press_key:                  (a) => `[STUB] Pressed: ${a.key}`,
  keystroke:                  (a) => `[STUB] Keystroke: ${a.key}`,
  hotkey:                     (a) => `[STUB] Hotkey: ${JSON.stringify(a)}`,
  // System
  set_volume:                 (a) => `[STUB] Volume set to ${a.volume}`,
  get_volume:                 ()  => `50`,
  set_brightness:             (a) => `[STUB] Brightness set to ${a.level}`,
  set_dark_mode:              ()  => `[STUB] Dark mode enabled`,
  set_light_mode:             ()  => `[STUB] Light mode enabled`,
  show_notification:          (a) => `[STUB] Notification: "${a.title}"`,
  open_url_default:           (a) => `[STUB] Opened ${a.url}`,
  // Shell
  run_command:                (a) => `[STUB] Command output: "${a.command}" → /Users/mac/file.txt`,
  get_latest_download:        ()  => `/Users/mac/Downloads/latest-report.pdf`,
  list_downloads:             ()  => `latest-report.pdf  (1.2 MB, 4/16/2026)\nproject.zip  (45.0 MB, 4/15/2026)`,
  open_terminal:              (a) => `[STUB] Opened Terminal${a.command ? ` with: ${a.command}` : ''}`,
  find_files:                 (a) => `/Users/mac/Documents/${a.pattern || 'file'}.txt`,
  // Memory
  remember:                   (a) => `[STUB] Remembered: ${a.key} = ${a.value}`,
  recall:                     (a) => `[STUB] ${a.key} = test@example.com`,
  forget_fact:                (a) => `[STUB] Forgot: ${a.key}`,
};

// ── Test cases ────────────────────────────────────────────────────────────────

const TESTS = [
  {
    id: 1,
    command: 'Go to google.com and write an email to my boss Eric',
    expect: ['open_url', 'open_url_default', 'open_app', 'run_command', 'search_google'],
    note: 'Should open google.com or Gmail and/or open Mail app',
  },
  {
    id: 2,
    command: 'Play lofi hip hop on YouTube',
    expect: ['search_youtube', 'ext_yt_play_first_result', 'youtube_click_first_result'],
    note: 'Should search YouTube and click first result',
  },
  {
    id: 3,
    command: 'Get my latest downloaded file and copy its path to the clipboard',
    expect: ['copy_latest_download_to_clipboard', 'get_latest_download'],
    note: 'Should find newest file in ~/Downloads and put path in clipboard',
  },
  {
    id: 4,
    command: 'Open Spotify and play something',
    expect: ['open_app'],
    note: 'Should open Spotify app',
  },
  {
    id: 5,
    command: 'Take a screenshot and save it to my Desktop',
    expect: ['take_screenshot'],
    note: 'Should call screencapture',
  },
  {
    id: 6,
    command: 'Copy the file report.pdf from my Downloads folder to the Desktop',
    expect: ['copy_file', 'copy_file_path_to_clipboard', 'run_command'],
    note: 'Should call copy_file (or run_command cp) with src=~/Downloads/report.pdf dst=~/Desktop/',
  },
  {
    id: 7,
    command: 'Open Terminal and run git status',
    expect: ['open_terminal', 'run_command'],
    note: 'Should open Terminal running git status OR run_command directly',
  },
  {
    id: 8,
    command: 'Search Google for the best JavaScript frameworks in 2025',
    expect: ['search_google'],
    note: 'Should call search_google with the query',
  },
  {
    id: 9,
    command: 'Remember that my email is alex@example.com',
    expect: ['remember'],
    note: 'Should call remember with key=email value=alex@example.com',
  },
  {
    id: 10,
    command: "What's in my Downloads folder?",
    expect: ['list_downloads', 'list_directory', 'run_command'],
    note: 'Should list recent files in ~/Downloads',
  },
];

// ── Worker harness ────────────────────────────────────────────────────────────

function spawnWorker(modelPath) {
  return new Promise((resolve, reject) => {
    const w = fork(
      path.join(__dirname, '..', 'src', 'main', 'agent-worker.js'),
      [],
      { silent: true }
    );

    w.stderr.on('data', d => {
      const msg = d.toString().trim();
      // Only show important errors, not llama.cpp verbose output
      if (msg.includes('error') || msg.includes('Error')) {
        process.stderr.write('  [worker stderr] ' + msg.slice(0, 200) + '\n');
      }
    });

    const timeout = setTimeout(() => {
      w.kill();
      reject(new Error('Worker init timed out after 120s'));
    }, 120000);

    w.once('message', (msg) => {
      if (msg.type === 'init-done') {
        clearTimeout(timeout);
        resolve(w);
      } else if (msg.type === 'error') {
        clearTimeout(timeout);
        w.kill();
        reject(new Error('Worker init error: ' + msg.error));
      }
    });

    w.send({ type: 'init', modelPath });
  });
}

async function runSingleTest(worker, test, skillLoader) {
  const allTools    = skillLoader.getToolDefinitions();
  const { buildContext } = require('../src/main/memory');
  const contextText = buildContext();
  const tools = filterTools(test.command, allTools);

  const toolCalls = [];

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Test timed out after 60s'));
    }, 60000);

    worker.on('message', function handler(msg) {
      if (msg.type === 'tool-call' && !realMode) {
        // Intercept tool call — return stub result
        const stubFn = STUB_RESULTS[msg.toolName];
        const result = stubFn
          ? String(stubFn(msg.args || {}))
          : `[STUB] ${msg.toolName}(${JSON.stringify(msg.args)})`;

        toolCalls.push({ tool: msg.toolName, args: msg.args, result });
        worker.send({ type: 'tool-result', reqId: msg.reqId, result });

      } else if (msg.type === 'tool-call' && realMode) {
        // Real mode — actually execute the tool
        skillLoader.executeTool(msg.toolName, msg.args || {}).then(result => {
          toolCalls.push({ tool: msg.toolName, args: msg.args, result });
          worker.send({ type: 'tool-result', reqId: msg.reqId, result });
        }).catch(err => {
          const result = `Error: ${err.message}`;
          toolCalls.push({ tool: msg.toolName, args: msg.args, result });
          worker.send({ type: 'tool-result', reqId: msg.reqId, result });
        });

      } else if (msg.type === 'result') {
        clearTimeout(timeout);
        worker.removeListener('message', handler);
        const reply = (msg.reply || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        resolve({ reply, toolCalls, tools: tools.length });

      } else if (msg.type === 'error') {
        clearTimeout(timeout);
        worker.removeListener('message', handler);
        reject(new Error(msg.error));
      }
    });

    worker.send({ type: 'run', id: Date.now(), transcript: test.command, tools, contextText });
  });
}

// Simple inline tool filter (mirrors agent.js logic)
function filterTools(transcript, allTools) {
  const t = transcript.toLowerCase();
  const wantsBrowser  = /\b(go to|open.*site|website|url|http|google|bing|youtube|search|gmail|safari|chrome|tab|page)\b/.test(t);
  const wantsYoutube  = /\b(youtube|play|song|music|video|watch)\b/.test(t);
  const wantsExt      = /\b(click|fill|form|input|button|link|scroll|submit)\b/.test(t);
  const wantsFile     = /\b(file|folder|directory|download|copy|move|rename|delete|find|desktop|document)\b/.test(t);
  const wantsClip     = /\b(clipboard|paste|copy|clip)\b/.test(t);
  const wantsApp      = /\b(app|application|open|launch|switch|quit|spotify|slack|zoom|terminal|finder|mail|notes)\b/.test(t);
  const wantsKeyboard = /\b(type|press|keystroke|shortcut)\b/.test(t);
  const wantsSystem   = /\b(volume|brightness|dark mode|screenshot|wifi|battery|notification)\b/.test(t);
  const wantsShell    = /\b(terminal|shell|command|run|bash|script|npm|git|download)\b/.test(t);
  const wantsMem      = /\b(remember|recall|forget|preference|my name|my email|my boss)\b/.test(t);

  const ALWAYS = new Set(['show_notification', 'remember', 'recall', 'set_volume', 'set_dark_mode', 'take_screenshot']);

  const allowed = new Set(ALWAYS);

  const add = (names) => names.forEach(n => allowed.add(n));

  if (wantsBrowser || wantsYoutube) add(['open_url', 'search_google', 'search_youtube', 'open_new_tab', 'get_current_url', 'get_page_title', 'browser_back', 'browser_reload', 'list_tabs', 'close_tab', 'get_page_text', 'click_element', 'fill_input', 'youtube_play_pause', 'youtube_click_first_result', 'open_url_default']);
  if (wantsYoutube) add(['ext_yt_play_first_result', 'ext_yt_play_pause']);
  if (wantsExt || wantsBrowser) add(['ext_navigate', 'ext_get_url', 'ext_get_text', 'ext_get_links', 'ext_click', 'ext_click_text', 'ext_fill', 'ext_submit', 'ext_scroll', 'ext_run_js', 'ext_new_tab', 'ext_list_tabs', 'ext_switch_tab']);
  if (wantsFile || wantsShell) add(['read_file', 'write_file', 'list_directory', 'copy_file', 'move_file', 'delete_file', 'open_in_finder', 'file_info', 'create_directory', 'copy_file_path_to_clipboard', 'copy_latest_download_to_clipboard', 'open_file']);
  if (wantsClip || wantsFile) add(['get_clipboard', 'set_clipboard', 'clear_clipboard', 'copy_file_path_to_clipboard', 'copy_latest_download_to_clipboard']);
  if (wantsApp) add(['open_app', 'quit_app', 'hide_app', 'minimize_window', 'get_frontmost_app', 'list_running_apps', 'take_screenshot']);
  if (wantsKeyboard) add(['type_text', 'press_key', 'keystroke', 'hotkey']);
  if (wantsSystem) add(['set_volume', 'get_volume', 'set_brightness', 'set_dark_mode', 'set_light_mode', 'take_screenshot', 'show_notification', 'open_url_default']);
  if (wantsShell) add(['run_command', 'get_latest_download', 'list_downloads', 'open_terminal', 'find_files']);
  if (wantsMem) add(['remember', 'recall', 'forget_fact']);

  if (allowed.size <= 6) {
    add(['open_app', 'open_url', 'search_google', 'run_command', 'get_latest_download']);
  }

  return allTools.filter(t => allowed.has(t.name));
}

// ── Result display ────────────────────────────────────────────────────────────

function printResult(test, result, passed, elapsed) {
  const icon = passed ? '✅' : '⚠️ ';
  console.log(`${icon} Test ${test.id}: "${test.command}"`);
  console.log(`   Note   : ${test.note}`);
  console.log(`   Tools  : ${result.tools} sent to model`);

  if (result.toolCalls.length === 0) {
    console.log(`   Actions: (none — model replied without calling tools)`);
  } else {
    for (const tc of result.toolCalls) {
      const args = JSON.stringify(tc.args || {}).slice(0, 100);
      console.log(`   → ${tc.tool}(${args})`);
      console.log(`     ↳ ${String(tc.result).slice(0, 120)}`);
    }
  }

  console.log(`   Reply  : "${result.reply}"`);
  console.log(`   Time   : ${elapsed}ms`);

  const toolsUsed = result.toolCalls.map(tc => tc.tool);
  const matched   = test.expect.some(e => toolsUsed.includes(e));
  if (!matched && test.expect.length > 0) {
    console.log(`   ⚠  Expected one of: ${test.expect.join(', ')}`);
    console.log(`      Got: ${toolsUsed.join(', ') || 'none'}`);
  }
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const testsToRun = filterArg
    ? TESTS.filter(t => t.id === filterArg)
    : TESTS;

  if (testsToRun.length === 0) {
    console.error(`No test with id ${filterArg}`);
    process.exit(1);
  }

  console.log(`Loading model (this takes 10-30s)…\n`);
  let worker;
  try {
    worker = await spawnWorker(chosenModel.path);
  } catch (err) {
    console.error('❌  Failed to load model:', err.message);
    process.exit(1);
  }
  console.log('Model loaded. Running tests…\n');

  let passed = 0, failed = 0;

  for (const test of testsToRun) {
    process.stdout.write(`⏳ Test ${test.id}/${testsToRun.length}: "${test.command.slice(0, 50)}…" `);
    const start = Date.now();
    try {
      const result  = await runSingleTest(worker, test, skillLoader);
      const elapsed = Date.now() - start;
      const toolsUsed = result.toolCalls.map(tc => tc.tool);
      const ok = test.expect.length === 0 || test.expect.some(e => toolsUsed.includes(e));
      process.stdout.write(`${ok ? '✅' : '⚠️ '} (${elapsed}ms)\n`);
      printResult(test, result, ok, elapsed);
      if (ok) passed++; else failed++;
    } catch (err) {
      const elapsed = Date.now() - start;
      process.stdout.write(`❌  (${elapsed}ms)\n`);
      console.log(`❌  Test ${test.id}: "${test.command}"`);
      console.log(`   Error: ${err.message}\n`);
      failed++;
    }
  }

  worker.kill();

  console.log('─'.repeat(65));
  console.log(`Results: ${passed} passed, ${failed} failed / ${testsToRun.length} total`);
  console.log();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
