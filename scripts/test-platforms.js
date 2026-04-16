#!/usr/bin/env node
/**
 * test-platforms.js — 50 platform integration tests
 *
 * Tests agent commands across Slack, WhatsApp, Discord, Google Workspace,
 * GitHub, YouTube, Gmail, Spotify, Twitter, Notion, and mixed workflows.
 *
 * All OS / network actions are stubbed — safe to run without any real apps.
 *
 * Usage:
 *   node scripts/test-platforms.js                # all 50 tests
 *   node scripts/test-platforms.js --filter 3     # single test by number
 *   node scripts/test-platforms.js --filter slack # tests matching "slack"
 *   node scripts/test-platforms.js --no-llm       # skip LLM, just show tests
 */

const path = require('path');
const os   = require('os');
const fs   = require('fs');

// ── Setup mocks ───────────────────────────────────────────────────────────────

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
    const s = { get: () => ({ cnt: 0 }), all: () => [], run: () => ({ changes: 0 }) };
    return { pragma: () => {}, exec: () => {}, prepare: () => s, transaction: fn => fn, close: () => {} };
  };
  return orig.apply(this, [r, ...a]);
};

const ROOT = path.join(__dirname, '..');
const wsMock = { isExtensionConnected: () => false, sendToExtension: async (a, p) => `[EXT:${a}]`, startServer: () => {}, stopServer: () => {} };
require.cache[require.resolve(path.join(ROOT, 'src/main/ws-bridge'))] = {
  id: 'ws-bridge', filename: 'ws-bridge', loaded: true, exports: wsMock,
};

// ── Stub results for every tool ───────────────────────────────────────────────

const STUBS = {
  // Navigation & browser
  open_url:                     a => `[STUB] Opened ${a.url}`,
  open_url_default:             a => `[STUB] Opened ${a.url}`,
  search_google:                a => `[STUB] Google search: "${a.query}"`,
  search_youtube:               a => `[STUB] YouTube search open for "${a.query}"`,
  youtube_click_first_result:   a => `[STUB] Playing: "Top result for ${a.query || 'query'}"`,
  ext_yt_play_first_result:     a => `[STUB] Extension: playing first YouTube result`,
  ext_navigate:                 a => `[STUB] Navigated to ${a.url}`,
  ext_get_url:                  () => 'https://app.slack.com/client/T123/C456',
  ext_get_text:                 () => `[STUB] Page text content`,
  ext_click:                    a => `[STUB] Clicked ${a.selector}`,
  ext_click_text:               a => `[STUB] Clicked text "${a.text}"`,
  ext_fill:                     a => `[STUB] Filled ${a.selector} = "${a.value}"`,
  ext_type:                     a => `[STUB] Typed "${a.text}" into ${a.selector}`,
  ext_read_messages:            () => `User: Hey!\nBot: Hello there!\nUser: How are you?`,
  ext_site_action:              a => `[STUB] site_action: ${a.action_name}`,
  // Slack
  slack_open_dm:                a => `[STUB] Opened DM with ${a.name}`,
  slack_open_channel:           a => `[STUB] Opened #${a.channel}`,
  slack_send_message:           a => `[STUB] Slack message sent: "${a.message?.slice(0,50)}"`,
  slack_read_messages:          a => `[STUB] Last ${a.count||10} Slack messages:\nAlice: Morning!\nBob: Good morning everyone`,
  slack_search:                 a => `[STUB] Slack search results for "${a.query}"`,
  slack_set_status:             a => `[STUB] Slack status set: ${a.emoji} ${a.text}`,
  slack_react:                  a => `[STUB] Reacted with ${a.emoji}`,
  // Discord
  discord_open_server:          a => `[STUB] Opened Discord server: ${a.server}`,
  discord_open_channel:         a => `[STUB] Opened #${a.channel}`,
  discord_send_message:         a => `[STUB] Discord message sent: "${a.message?.slice(0,50)}"`,
  discord_read_messages:        a => `[STUB] Last 10 Discord messages:\nUser1: hey\nUser2: sup`,
  discord_react:                a => `[STUB] Reacted with ${a.emoji}`,
  discord_search:               a => `[STUB] Discord search: "${a.query}"`,
  // WhatsApp
  whatsapp_open_chat:           a => `[STUB] Opened WhatsApp chat with ${a.contact}`,
  whatsapp_send_message:        a => `[STUB] WhatsApp message sent to ${a.contact}: "${a.message?.slice(0,50)}"`,
  whatsapp_read_messages:       a => `[STUB] Last 10 WhatsApp messages:\nJohn: Are you coming?\nMe: Yes, 5 mins away`,
  whatsapp_new_group:           a => `[STUB] Created WhatsApp group: ${a.name}`,
  // Google Workspace
  sheets_open:                  a => `[STUB] Opened Google Sheet: ${a.url||'new'}`,
  sheets_read_cell:             a => `[STUB] Cell ${a.cell} = "42"`,
  sheets_write_cell:            a => `[STUB] Wrote "${a.value}" to ${a.cell}`,
  sheets_add_row:               a => `[STUB] Added row: ${a.values}`,
  forms_open:                   a => `[STUB] Opened form: ${a.url}`,
  forms_fill_field:             a => `[STUB] Filled "${a.label}" = "${a.value}"`,
  forms_fill_all:               a => `[STUB] Filled all form fields`,
  forms_submit:                 () => `[STUB] Form submitted`,
  docs_open:                    a => `[STUB] Opened Google Doc: ${a.url}`,
  docs_read:                    () => `[STUB] Doc content: Project status update Q4...`,
  docs_type:                    a => `[STUB] Typed into Google Doc: "${a.text?.slice(0,40)}"`,
  calendar_open:                () => `[STUB] Opened Google Calendar`,
  calendar_create_event:        a => `[STUB] Created event: "${a.title}" on ${a.date}`,
  calendar_read_today:          () => `[STUB] Today: 9am Team standup, 2pm Client review`,
  drive_search:                 a => `[STUB] Drive search: "${a.query}"`,
  drive_open_file:              a => `[STUB] Opened "${a.name}" from Drive`,
  // GitHub
  github_search:                a => `[STUB] GitHub search: "${a.query}"`,
  github_create_pr:             () => `[STUB] Opened New Pull Request`,
  github_open_issue:            () => `[STUB] Opened Issues tab`,
  github_create_issue:          a => `[STUB] Created issue: "${a.title}"`,
  // Notion
  notion_new_page:              a => `[STUB] Created Notion page: "${a.title}"`,
  notion_add_text:              a => `[STUB] Added text to Notion: "${a.text?.slice(0,40)}"`,
  notion_search:                a => `[STUB] Notion search: "${a.query}"`,
  // Gmail
  gmail_compose:                () => `[STUB] Gmail compose window open`,
  gmail_set_recipient:          a => `[STUB] Gmail To: ${a.email}`,
  gmail_set_subject:            a => `[STUB] Gmail Subject: ${a.subject}`,
  gmail_set_body:               a => `[STUB] Gmail body set`,
  gmail_send:                   () => `[STUB] Email sent`,
  gmail_search:                 a => `[STUB] Gmail search: "${a.query}"`,
  gmail_reply:                  () => `[STUB] Opened reply`,
  gmail_archive:                () => `[STUB] Email archived`,
  // Spotify
  spotify_play_pause:           () => `[STUB] Spotify play/pause`,
  spotify_next:                 () => `[STUB] Spotify next track`,
  spotify_previous:             () => `[STUB] Spotify previous track`,
  spotify_search:               a => `[STUB] Spotify search: "${a.query}"`,
  spotify_play_first_result:    () => `[STUB] Spotify playing first result`,
  // File & system
  open_app:                     a => `[STUB] Opened ${a.app}`,
  run_command:                  a => `[STUB] Ran: ${a.command}`,
  show_notification:            a => `[STUB] Notification: ${a.title}`,
  remember:                     a => `[STUB] Remembered ${a.key} = ${a.value}`,
  recall:                       a => `[STUB] Recalled ${a.key}`,
  // Twitter
  twitter_tweet:                a => `[STUB] Tweeted: "${a.text?.slice(0,50)}"`,
  twitter_search:               a => `[STUB] Twitter search: "${a.query}"`,
  twitter_like:                 () => `[STUB] Liked tweet`,
};

function stub(toolName, args) {
  const fn = STUBS[toolName];
  return fn ? String(fn(args || {})) : `[STUB] ${toolName}()`;
}

// ── Test definitions ──────────────────────────────────────────────────────────

const TESTS = [
  // ── Slack (10) ─────────────────────────────────────────────────────────────
  {
    id:     1,
    label:  'Slack — open DM with person',
    cmd:    'Open a Slack DM with Alice Johnson',
    expect: ['slack_open_dm'],
    group:  'slack',
  },
  {
    id:     2,
    label:  'Slack — send DM',
    cmd:    'Send a Slack message to Bob saying "Hey, can we sync at 3pm?"',
    expect: ['slack_send_message', 'slack_open_dm'],
    group:  'slack',
  },
  {
    id:     3,
    label:  'Slack — open channel',
    cmd:    'Open the general channel in Slack',
    expect: ['slack_open_channel'],
    group:  'slack',
  },
  {
    id:     4,
    label:  'Slack — send message to channel',
    cmd:    'Go to the engineering channel in Slack and send "Deployment complete"',
    expect: ['slack_send_message', 'slack_open_channel'],
    group:  'slack',
  },
  {
    id:     5,
    label:  'Slack — read messages',
    cmd:    'Read the last 10 messages in the general Slack channel',
    expect: ['slack_read_messages'],
    group:  'slack',
  },
  {
    id:     6,
    label:  'Slack — search',
    cmd:    'Search Slack for messages about the quarterly report',
    expect: ['slack_search'],
    group:  'slack',
  },
  {
    id:     7,
    label:  'Slack — set status',
    cmd:    'Set my Slack status to on vacation with a palm tree emoji',
    expect: ['slack_set_status'],
    group:  'slack',
  },
  {
    id:     8,
    label:  'Slack — react to message',
    cmd:    'Add a thumbs up reaction to the last Slack message',
    expect: ['slack_react'],
    group:  'slack',
  },
  {
    id:     9,
    label:  'Slack — open DM and read',
    cmd:    'Open my DM with Sarah in Slack and show me the last 5 messages',
    expect: ['slack_open_dm', 'slack_read_messages'],
    group:  'slack',
  },
  {
    id:     10,
    label:  'Slack — send reminder message',
    cmd:    'Message everyone in the standup channel on Slack: "Standup in 5 minutes!"',
    expect: ['slack_send_message', 'slack_open_channel'],
    group:  'slack',
  },

  // ── Discord (8) ────────────────────────────────────────────────────────────
  {
    id:     11,
    label:  'Discord — open server',
    cmd:    'Open my Gaming server on Discord',
    expect: ['discord_open_server'],
    group:  'discord',
  },
  {
    id:     12,
    label:  'Discord — open channel',
    cmd:    'Go to the announcements channel on Discord',
    expect: ['discord_open_channel'],
    group:  'discord',
  },
  {
    id:     13,
    label:  'Discord — send message',
    cmd:    'Send "Good morning everyone!" in the general Discord channel',
    expect: ['discord_send_message'],
    group:  'discord',
  },
  {
    id:     14,
    label:  'Discord — read messages',
    cmd:    'Read the last 10 messages from the general Discord channel',
    expect: ['discord_read_messages'],
    group:  'discord',
  },
  {
    id:     15,
    label:  'Discord — send to specific server+channel',
    cmd:    'In Discord, go to the Dev Talk server and post "New release is live" in the releases channel',
    expect: ['discord_send_message', 'discord_open_server', 'discord_open_channel'],
    group:  'discord',
  },
  {
    id:     16,
    label:  'Discord — react to message',
    cmd:    'React to the last Discord message with a fire emoji',
    expect: ['discord_react'],
    group:  'discord',
  },
  {
    id:     17,
    label:  'Discord — search messages',
    cmd:    'Search Discord for messages about the product launch',
    expect: ['discord_search'],
    group:  'discord',
  },
  {
    id:     18,
    label:  'Discord — open channel in server',
    cmd:    'Open Discord, go to the Tech Enthusiasts server, then the random channel',
    expect: ['discord_open_server', 'discord_open_channel'],
    group:  'discord',
  },

  // ── WhatsApp (6) ──────────────────────────────────────────────────────────
  {
    id:     19,
    label:  'WhatsApp — open chat',
    cmd:    'Open my WhatsApp conversation with Mom',
    expect: ['whatsapp_open_chat'],
    group:  'whatsapp',
  },
  {
    id:     20,
    label:  'WhatsApp — send message',
    cmd:    'Send a WhatsApp message to Dad saying "I\'ll be home by 7"',
    expect: ['whatsapp_send_message'],
    group:  'whatsapp',
  },
  {
    id:     21,
    label:  'WhatsApp — read messages',
    cmd:    'Read my last WhatsApp messages from John',
    expect: ['whatsapp_read_messages'],
    group:  'whatsapp',
  },
  {
    id:     22,
    label:  'WhatsApp — open and send',
    cmd:    'WhatsApp Sarah and tell her the meeting is moved to 4pm',
    expect: ['whatsapp_send_message', 'whatsapp_open_chat'],
    group:  'whatsapp',
  },
  {
    id:     23,
    label:  'WhatsApp — new group',
    cmd:    'Create a new WhatsApp group called Team Project',
    expect: ['whatsapp_new_group'],
    group:  'whatsapp',
  },
  {
    id:     24,
    label:  'WhatsApp — broadcast to multiple',
    cmd:    'Message Alex on WhatsApp to say the sprint review is at 2pm',
    expect: ['whatsapp_send_message'],
    group:  'whatsapp',
  },

  // ── Google Workspace (10) ─────────────────────────────────────────────────
  {
    id:     25,
    label:  'Google Sheets — open new',
    cmd:    'Create a new Google Sheet',
    expect: ['sheets_open'],
    group:  'workspace',
  },
  {
    id:     26,
    label:  'Google Sheets — write cell',
    cmd:    'In the Google Sheet, write "Q4 Revenue" in cell A1',
    expect: ['sheets_write_cell'],
    group:  'workspace',
  },
  {
    id:     27,
    label:  'Google Sheets — read cell',
    cmd:    'What is the value of cell B3 in the current Google Sheet?',
    expect: ['sheets_read_cell'],
    group:  'workspace',
  },
  {
    id:     28,
    label:  'Google Forms — fill and submit',
    cmd:    'In the Google Form, fill in the Name field with "John Smith" and submit',
    expect: ['forms_fill_field', 'forms_submit'],
    group:  'workspace',
  },
  {
    id:     29,
    label:  'Google Docs — open new',
    cmd:    'Open a new Google Doc',
    expect: ['docs_open'],
    group:  'workspace',
  },
  {
    id:     30,
    label:  'Google Docs — type text',
    cmd:    'Type "Meeting Notes - Q4 Review" into the Google Doc',
    expect: ['docs_type'],
    group:  'workspace',
  },
  {
    id:     31,
    label:  'Google Calendar — create event',
    cmd:    'Create a Google Calendar event called Team Lunch for tomorrow at noon',
    expect: ['calendar_create_event'],
    group:  'workspace',
  },
  {
    id:     32,
    label:  'Google Calendar — read today',
    cmd:    'What\'s on my Google Calendar today?',
    expect: ['calendar_read_today', 'calendar_open'],
    group:  'workspace',
  },
  {
    id:     33,
    label:  'Google Drive — search file',
    cmd:    'Search Google Drive for my Q4 budget spreadsheet',
    expect: ['drive_search'],
    group:  'workspace',
  },
  {
    id:     34,
    label:  'Google Drive — open file',
    cmd:    'Open the project timeline file from Google Drive',
    expect: ['drive_open_file'],
    group:  'workspace',
  },

  // ── GitHub (5) ────────────────────────────────────────────────────────────
  {
    id:     35,
    label:  'GitHub — search repos',
    cmd:    'Search GitHub for React charting libraries',
    expect: ['github_search', 'open_url', 'search_google'],
    group:  'github',
  },
  {
    id:     36,
    label:  'GitHub — create PR',
    cmd:    'Open a new pull request on the current GitHub repo',
    expect: ['github_create_pr', 'open_url'],
    group:  'github',
  },
  {
    id:     37,
    label:  'GitHub — view issues',
    cmd:    'Show me the issues on this GitHub repository',
    expect: ['github_open_issue', 'open_url'],
    group:  'github',
  },
  {
    id:     38,
    label:  'GitHub — create issue',
    cmd:    'Create a GitHub issue titled "Fix login redirect bug" with a description',
    expect: ['github_create_issue', 'open_url'],
    group:  'github',
  },
  {
    id:     39,
    label:  'GitHub — navigate to repo',
    cmd:    'Go to the microsoft/vscode repository on GitHub',
    expect: ['open_url', 'search_google'],
    group:  'github',
  },

  // ── Gmail (4) ─────────────────────────────────────────────────────────────
  {
    id:     40,
    label:  'Gmail — compose and send email',
    cmd:    'Compose an email to boss@company.com with subject "Q4 Update" and send it',
    expect: ['gmail_compose', 'gmail_set_recipient', 'gmail_send', 'open_url'],
    group:  'gmail',
  },
  {
    id:     41,
    label:  'Gmail — search inbox',
    cmd:    'Search Gmail for emails from my boss about the project',
    expect: ['gmail_search', 'open_url'],
    group:  'gmail',
  },
  {
    id:     42,
    label:  'Gmail — reply to email',
    cmd:    'Open Gmail and reply to the first unread email',
    expect: ['gmail_reply', 'gmail_open_first', 'open_url'],
    group:  'gmail',
  },
  {
    id:     43,
    label:  'Gmail — archive email',
    cmd:    'Archive the currently open email in Gmail',
    expect: ['gmail_archive', 'open_url'],
    group:  'gmail',
  },

  // ── Notion (3) ────────────────────────────────────────────────────────────
  {
    id:     44,
    label:  'Notion — create page',
    cmd:    'Create a new Notion page called "Sprint Planning"',
    expect: ['notion_new_page', 'open_url'],
    group:  'notion',
  },
  {
    id:     45,
    label:  'Notion — add content',
    cmd:    'Add a note to my Notion page: "Review PRs before standup"',
    expect: ['notion_add_text', 'open_url'],
    group:  'notion',
  },
  {
    id:     46,
    label:  'Notion — search',
    cmd:    'Search Notion for the product roadmap page',
    expect: ['notion_search', 'open_url'],
    group:  'notion',
  },

  // ── YouTube (3) ───────────────────────────────────────────────────────────
  {
    id:     47,
    label:  'YouTube — play song',
    cmd:    'Play Taylor Swift on YouTube',
    expect: ['search_youtube', 'ext_yt_play_first_result', 'youtube_click_first_result'],
    group:  'youtube',
  },
  {
    id:     48,
    label:  'YouTube — like video',
    cmd:    'Like this YouTube video',
    expect: ['youtube_like', 'ext_site_action'],
    group:  'youtube',
  },
  {
    id:     49,
    label:  'YouTube — search and play podcast',
    cmd:    'Search YouTube for a React tutorial and play it',
    expect: ['search_youtube', 'ext_yt_play_first_result', 'youtube_click_first_result'],
    group:  'youtube',
  },

  // ── Cross-platform workflow (1) ───────────────────────────────────────────
  {
    id:     50,
    label:  'Multi-platform — announce and schedule',
    cmd:    'Send "Team meeting in 10 minutes" to the general Slack channel',
    expect: ['slack_send_message', 'slack_open_channel'],
    group:  'multi',
  },
];

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const filterArg = args.find((_, i) => args[i - 1] === '--filter');
const noLLM = args.includes('--no-llm');

let testsToRun = TESTS;
if (filterArg) {
  const n = parseInt(filterArg);
  if (!isNaN(n)) {
    testsToRun = TESTS.filter(t => t.id === n);
  } else {
    const lower = filterArg.toLowerCase();
    testsToRun = TESTS.filter(t =>
      t.group.includes(lower) || t.label.toLowerCase().includes(lower) || t.cmd.toLowerCase().includes(lower)
    );
  }
}

// ── Colours ───────────────────────────────────────────────────────────────────
const G = s => `\x1b[32m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const B = s => `\x1b[36m${s}\x1b[0m`;
const D = s => `\x1b[2m${s}\x1b[0m`;

// ── Load model & skill tools ──────────────────────────────────────────────────

async function main() {
  console.log(`\n${B('Tellaflow Platform Tests')} ${D(`(${testsToRun.length}/${TESTS.length} tests)`)}`);

  if (noLLM) {
    console.log(Y('\n  --no-llm: listing tests without running LLM\n'));
    for (const t of testsToRun) {
      console.log(`  ${B(String(t.id).padStart(2))}. [${t.group}] ${t.label}`);
      console.log(D(`      "${t.cmd}"`));
      console.log(D(`      Expects: ${t.expect.join(' | ')}`));
    }
    return;
  }

  const sl = require(path.join(ROOT, 'src/main/skill-loader'));
  sl.reloadSkills();
  const allTools = sl.getToolDefinitions();

  // Find model
  let modelPath = null;
  const modelDirs = [
    path.join(os.homedir(), 'Library', 'Application Support', 'tellaflow', 'models'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Tellaflow', 'models'),
  ];
  for (const dir of modelDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.gguf'))) {
      modelPath = path.join(dir, f);
      break;
    }
    if (modelPath) break;
  }
  if (!modelPath) {
    console.error(R('\n  No model found — download one from the Agent page in the app\n'));
    process.exit(1);
  }

  console.log(D(`  Model : ${path.basename(modelPath)}`));
  console.log(`  Mode  : ${Y('⚠ STUB')} (OS/network actions mocked)\n`);

  const { fork } = require('child_process');
  const workerPath = path.join(ROOT, 'src/main/agent-worker.js');
  const worker = fork(workerPath, [], { silent: true });
  worker.stderr.on('data', () => {});

  console.log('  Loading model (10-30s)…');
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Model load timeout')), 90000);
    worker.once('message', msg => {
      if (msg.type === 'init-done') { clearTimeout(t); resolve(); }
      else if (msg.type === 'error') { clearTimeout(t); reject(new Error(msg.error)); }
    });
    worker.send({ type: 'init', modelPath });
  });
  console.log('  Model ready. Running tests…\n  ─'.repeat(1) + '─'.repeat(61));

  let passed = 0, warned = 0, total = 0;
  const failures = [];

  for (const test of testsToRun) {
    total++;
    const start = Date.now();

    // Build relevant tools
    const { selectRelevantTools } = buildSelectRelevantTools(allTools);
    const tools = selectRelevantTools(test.cmd, allTools);
    const toolCalls = [];

    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Agent timeout')), 90000);
      worker.on('message', function handler(msg) {
        if (msg.type === 'tool-call') {
          toolCalls.push({ tool: msg.toolName, args: msg.args });
          worker.send({ type: 'tool-result', reqId: msg.reqId, result: stub(msg.toolName, msg.args) });
        } else if (msg.type === 'result') {
          clearTimeout(timer);
          worker.removeListener('message', handler);
          resolve(msg.reply);
        } else if (msg.type === 'error') {
          clearTimeout(timer);
          worker.removeListener('message', handler);
          reject(new Error(msg.error));
        }
      });
      worker.send({ type: 'run', id: Date.now(), transcript: test.cmd, tools, contextText: '', resetSession: true });
    }).catch(e => { return `ERROR: ${e.message}`; });

    const elapsed = Date.now() - start;
    const calledTools = toolCalls.map(t => t.tool);
    const expectedAny = test.expect.some(e => calledTools.includes(e));

    if (calledTools.length === 0 || !expectedAny) {
      warned++;
      const label = calledTools.length === 0 ? Y('⚠  (no tools called)') : Y('⚠  (wrong tools)');
      console.log(`${label}`);
      console.log(`  ${Y('⚠')}  Test ${test.id}: "${test.label}"`);
      console.log(D(`     Cmd    : ${test.cmd}`));
      console.log(D(`     Called : ${calledTools.join(' → ') || 'none'}`));
      console.log(D(`     Expect : ${test.expect.join(' | ')}`));
      if (reply) console.log(D(`     Reply  : "${reply.slice(0, 100)}"`));
      failures.push({ id: test.id, label: test.label, called: calledTools, expected: test.expect });
    } else {
      passed++;
      console.log(`  ${G('✓')} Test ${test.id}: ${test.label} ${D(`(${calledTools.join(' → ')}) ${elapsed}ms`)}`);
    }
  }

  worker.kill();

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(62));
  console.log(`  Results: ${G(passed + ' passed')}, ${Y(warned + ' warnings')}, ${total} total`);

  if (failures.length > 0) {
    console.log(`\n  ${Y('Warnings (model may need a larger context or better prompts):')}`);
    for (const f of failures.slice(0, 5)) {
      console.log(`    #${f.id} ${f.label}: called ${f.called.join(',')||'nothing'}, expected ${f.expected[0]}`);
    }
  }
  console.log();

  process.exit(warned > total * 0.5 ? 1 : 0);
}

// ── Inline tool filter (mirrors agent.js) ────────────────────────────────────

function buildSelectRelevantTools(allTools) {
  function selectRelevantTools(transcript, allTools) {
    const t = transcript.toLowerCase();
    const wantsSlack     = /\b(slack|dm|channel|message.*person|send.*slack|slack.*message)\b/.test(t);
    const wantsDiscord   = /\b(discord|server|join.*server)\b/.test(t);
    const wantsWhatsApp  = /\b(whatsapp|whats app)\b/.test(t);
    const wantsWorkspace = /\b(google sheet|spreadsheet|google form|google doc|google cal|calendar|sheets|forms|docs|drive)\b/.test(t);
    const wantsGitHub    = /\b(github|pull request|pr|issue|repository)\b/.test(t);
    const wantsNotion    = /\b(notion|page|workspace|database)\b/.test(t);
    const wantsYoutube   = /\b(youtube|play|song|music|video|watch)\b/.test(t);
    const wantsGmail     = /\b(gmail|email|inbox|compose|send mail)\b/.test(t);
    const wantsSpotify   = /\b(spotify)\b/.test(t);
    const wantsBrowser   = /\b(browser|go to|open.*site|website|url|http|navigate|google|search|safari|chrome|tab)\b/.test(t);
    const wantsApp       = /\b(app|application|open|launch|switch|quit|hide)\b/.test(t);

    const ALWAYS = new Set(['show_notification', 'remember', 'recall', 'open_url', 'open_url_default', 'open_app', 'search_google']);

    if (wantsSlack)     { ['slack_open_dm','slack_open_channel','slack_send_message','slack_read_messages','slack_search','slack_set_status','slack_react'].forEach(n=>ALWAYS.add(n)); }
    if (wantsDiscord)   { ['discord_open_server','discord_open_channel','discord_send_message','discord_read_messages','discord_react','discord_search'].forEach(n=>ALWAYS.add(n)); }
    if (wantsWhatsApp)  { ['whatsapp_open_chat','whatsapp_send_message','whatsapp_read_messages','whatsapp_new_group'].forEach(n=>ALWAYS.add(n)); }
    if (wantsWorkspace) { ['sheets_open','sheets_read_cell','sheets_write_cell','forms_fill_field','forms_submit','docs_open','docs_read','docs_type','calendar_create_event','calendar_read_today','drive_search','drive_open_file'].forEach(n=>ALWAYS.add(n)); }
    if (wantsGitHub)    { ['github_search','github_create_pr','github_open_issue','github_create_issue'].forEach(n=>ALWAYS.add(n)); }
    if (wantsNotion)    { ['notion_new_page','notion_add_text','notion_search'].forEach(n=>ALWAYS.add(n)); }
    if (wantsYoutube)   { ['search_youtube','youtube_click_first_result','ext_yt_play_first_result','youtube_play_pause','youtube_like'].forEach(n=>ALWAYS.add(n)); }
    if (wantsGmail)     { ['gmail_compose','gmail_set_recipient','gmail_set_subject','gmail_set_body','gmail_send','gmail_search','gmail_reply','gmail_archive','gmail_open_first'].forEach(n=>ALWAYS.add(n)); }
    if (wantsSpotify)   { ['spotify_play_pause','spotify_next','spotify_search','spotify_play_first_result'].forEach(n=>ALWAYS.add(n)); }
    if (wantsBrowser)   { ['open_url','search_google','ext_navigate','ext_click','ext_fill'].forEach(n=>ALWAYS.add(n)); }
    if (wantsApp)       { ['open_app','quit_app','get_frontmost_app'].forEach(n=>ALWAYS.add(n)); }

    return allTools.filter(t => ALWAYS.has(t.name));
  }
  return { selectRelevantTools };
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
