const path = require('path');
const fs = require('fs');
const https = require('https');
const { fork } = require('child_process');

// ─── Model registry ───────────────────────────────────────────────────────────

const AGENT_REGISTRY = {
  'qwen2.5-1.5b': {
    name: 'Qwen2.5 1.5B',
    filename: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
    size: '1.0 GB',
    bytes: 1_000_000_000,
    quality: 'Good',
    context: '32K',
    description: 'Reliable agent planning with 32K context. Best for most users.',
    url: 'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
  },
  'qwen3-1.7b': {
    name: 'Qwen3 1.7B',
    filename: 'Qwen_Qwen3-1.7B-Q4_K_M.gguf',
    size: '1.1 GB',
    bytes: 1_100_000_000,
    quality: 'Best',
    context: '32K',
    description: 'Latest generation Qwen3. Stronger reasoning and tool use. Recommended.',
    url: 'https://huggingface.co/bartowski/Qwen_Qwen3-1.7B-GGUF/resolve/main/Qwen_Qwen3-1.7B-Q4_K_M.gguf',
  },
  'qwen2.5-3b': {
    name: 'Qwen2.5 3B',
    filename: 'Qwen2.5-3B-Instruct-Q4_K_M.gguf',
    size: '2.0 GB',
    bytes: 2_000_000_000,
    quality: 'Best',
    context: '32K',
    description: 'Larger model for complex multi-step commands. Requires ~3GB RAM.',
    url: 'https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf',
  },
};

// ─── Paths ────────────────────────────────────────────────────────────────────

function getAgentModelsDir() {
  const { app } = require('electron');
  const dir = path.join(app.getPath('userData'), 'models');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getModelFilePath(modelKey) {
  const info = AGENT_REGISTRY[modelKey];
  if (info) return path.join(getAgentModelsDir(), info.filename);
  // Cross-registry fallback: grammar models can be used as agent models
  const { GRAMMAR_REGISTRY } = require('./grammar');
  const gInfo = GRAMMAR_REGISTRY[modelKey];
  if (gInfo) return path.join(getAgentModelsDir(), gInfo.filename);
  return null;
}

function isAgentModelAvailable(modelKey) {
  const p = getModelFilePath(modelKey);
  if (!p) return false;
  try { return fs.existsSync(p); } catch { return false; }
}

// ─── Download tracking ────────────────────────────────────────────────────────

const activeDownloads = {};
const pausedModels = new Set();

function getPartialSize(modelKey) {
  const p = getModelFilePath(modelKey);
  if (!p) return 0;
  try { return fs.statSync(p + '.tmp').size; } catch { return 0; }
}

function getAgentModelsStatus() {
  const result = {};
  for (const [key, info] of Object.entries(AGENT_REGISTRY)) {
    const available = isAgentModelAvailable(key);
    const dl = activeDownloads[key];
    let status = available ? 'downloaded' : 'not_downloaded';
    let downloaded = 0;
    const total = info.bytes;

    if (dl) {
      status = 'downloading';
      downloaded = dl.downloaded;
    } else if (!available) {
      const partial = getPartialSize(key);
      if (partial > 0) { status = 'paused'; downloaded = partial; }
    }
    result[key] = { ...info, available, status, downloaded, total };
  }
  return result;
}

function startAgentDownload(modelKey, { onProgress, onComplete, onError }) {
  const info = AGENT_REGISTRY[modelKey];
  if (!info) { onError?.(new Error(`Unknown agent model: ${modelKey}`)); return; }

  const destPath = getModelFilePath(modelKey);
  const tmpPath = destPath + '.tmp';

  if (fs.existsSync(destPath)) { onComplete?.(destPath); return; }
  if (activeDownloads[modelKey]) { onError?.(new Error(`Already downloading ${modelKey}`)); return; }

  pausedModels.delete(modelKey);

  let startByte = 0;
  try { startByte = fs.statSync(tmpPath).size; } catch {}

  const MAX_REDIRECTS = 10;
  function doRequest(url, resumeFrom, redirectCount = 0) {
    if (redirectCount > MAX_REDIRECTS) {
      delete activeDownloads[modelKey];
      onError?.(new Error(`Too many redirects`));
      return;
    }
    const headers = {};
    if (resumeFrom > 0) headers['Range'] = `bytes=${resumeFrom}-`;
    const proto = url.startsWith('https') ? https : require('http');
    const req = proto.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        doRequest(res.headers.location, resumeFrom, redirectCount + 1);
        return;
      }
      if (res.statusCode === 416) {
        try { fs.unlinkSync(tmpPath); } catch {}
        doRequest(url, 0, redirectCount + 1);
        return;
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        delete activeDownloads[modelKey];
        onError?.(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let totalBytes;
      if (res.statusCode === 206) {
        const range = res.headers['content-range'];
        totalBytes = range
          ? parseInt(range.match(/\/(\d+)$/)?.[1] ?? info.bytes, 10)
          : resumeFrom + parseInt(res.headers['content-length'] || '0', 10);
      } else {
        totalBytes = parseInt(res.headers['content-length'], 10) || info.bytes;
        resumeFrom = 0;
      }

      let downloadedBytes = res.statusCode === 206 ? resumeFrom : 0;
      const flags = res.statusCode === 206 ? 'a' : 'w';
      const ws = fs.createWriteStream(tmpPath, { flags });

      activeDownloads[modelKey] = { request: req, response: res, writeStream: ws, downloaded: downloadedBytes };

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (activeDownloads[modelKey]) activeDownloads[modelKey].downloaded = downloadedBytes;
        onProgress?.({ modelKey, downloaded: downloadedBytes, total: totalBytes, percent: Math.round((downloadedBytes / totalBytes) * 100) });
      });

      res.pipe(ws);

      ws.on('finish', () => {
        if (pausedModels.has(modelKey)) return;
        delete activeDownloads[modelKey];
        try { fs.renameSync(tmpPath, destPath); onComplete?.(destPath); }
        catch (err) { onError?.(err); }
      });

      ws.on('error', (err) => { delete activeDownloads[modelKey]; try { fs.unlinkSync(tmpPath); } catch {} onError?.(err); });
      res.on('error', (err) => { delete activeDownloads[modelKey]; onError?.(err); });
    });
    req.on('error', (err) => { delete activeDownloads[modelKey]; onError?.(err); });
  }

  doRequest(info.url, startByte);
}

function pauseAgentDownload(modelKey) {
  const dl = activeDownloads[modelKey];
  if (!dl) return false;
  pausedModels.add(modelKey);
  try { dl.response.unpipe(dl.writeStream); } catch {}
  try { dl.response.destroy(); } catch {}
  try { dl.request.destroy(); } catch {}
  try { dl.writeStream.end(); } catch {}
  delete activeDownloads[modelKey];
  return true;
}

function cancelAgentDownload(modelKey) {
  const dl = activeDownloads[modelKey];
  if (dl) {
    pausedModels.add(modelKey);
    try { dl.response.unpipe(dl.writeStream); } catch {}
    try { dl.response.destroy(); } catch {}
    try { dl.request.destroy(); } catch {}
    try { dl.writeStream.end(); } catch {}
    delete activeDownloads[modelKey];
  }
  pausedModels.delete(modelKey);
  const p = getModelFilePath(modelKey);
  if (p) try { fs.unlinkSync(p + '.tmp'); } catch {}
}

function deleteAgentModel(modelKey) {
  cancelAgentDownload(modelKey);
  const p = getModelFilePath(modelKey);
  if (p) try { fs.unlinkSync(p); } catch {}
}

// ─── Active model ─────────────────────────────────────────────────────────────

function getActiveModelKey() {
  const config = require('./config');
  const stored = config.getAgentModel?.();
  // Accept any key from either registry if it's downloaded
  if (stored && isAgentModelAvailable(stored)) return stored;
  // Fallback: first available agent model, then first available grammar model
  for (const key of Object.keys(AGENT_REGISTRY)) {
    if (isAgentModelAvailable(key)) return key;
  }
  const { GRAMMAR_REGISTRY } = require('./grammar');
  for (const key of Object.keys(GRAMMAR_REGISTRY)) {
    if (isAgentModelAvailable(key)) return key;
  }
  return null;
}

function getActiveModelPath() {
  const key = getActiveModelKey();
  return key ? getModelFilePath(key) : null;
}

function isModelAvailable() {
  return getActiveModelPath() !== null;
}

// ─── Worker lifecycle ─────────────────────────────────────────────────────────

let worker = null;
let initPromise = null;
let workerReady = false;
let requestId = 0;
const pending = new Map();

// Multi-turn ask_user state
let pendingAskUserReqId = null;
let pendingAskUserQuestion = null;

// Session idle timeout — reset context after 5 minutes of inactivity
let sessionLastUsed = 0;
const SESSION_IDLE_MS = 5 * 60 * 1000;

function getWorkerPath() {
  const { app } = require('electron');
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'main', 'agent-worker.js');
  }
  return path.join(__dirname, 'agent-worker.js');
}

function ensureWorker() {
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    const modelPath = getActiveModelPath();
    if (!modelPath || !fs.existsSync(modelPath)) {
      initPromise = null;
      return reject(new Error('No agent model available. Please download a model in the Agent settings.'));
    }

    worker = fork(getWorkerPath(), [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });

    worker.stdout.on('data', (d) => process.stdout.write(d));
    worker.stderr.on('data', (d) => process.stderr.write(d));

    worker.on('message', async (msg) => {
      if (msg.type === 'init-done') {
        workerReady = true;
        console.log(`[agent] Worker ready (${getActiveModelKey()})`);
        resolve();

      } else if (msg.type === 'result') {
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); p.resolve({ reply: msg.reply, actions: p.actions }); }

      } else if (msg.type === 'error') {
        if (!workerReady) {
          initPromise = null;
          reject(new Error(msg.error));
        } else {
          const p = pending.get(msg.id);
          if (p) { pending.delete(msg.id); p.reject(new Error(msg.error)); }
        }

      } else if (msg.type === 'tool-call') {
        const pendingId = msg.id ?? [...pending.keys()].at(-1);
        const p = pending.get(pendingId);
        if (p) p.actions.push({ tool: msg.toolName, args: msg.args, result: null });
        try {
          const { executeTool } = require('./skill-loader');
          const result = await executeTool(msg.toolName, msg.args);
          if (p) { const last = p.actions.at(-1); if (last) last.result = result; }
          worker.send({ type: 'tool-result', reqId: msg.reqId, result });
        } catch (err) {
          const errStr = `Error: ${err.message}`;
          if (p) { const last = p.actions.at(-1); if (last) last.result = errStr; }
          worker.send({ type: 'tool-result', reqId: msg.reqId, result: errStr });
        }

      } else if (msg.type === 'ask_user') {
        // LLM is asking a clarifying question — surface it via the UI
        // Store the pending reqId so the next user input can answer it
        pendingAskUserReqId = msg.reqId;
        pendingAskUserQuestion = msg.question;
        console.log('[agent] ask_user:', msg.question);
        // Notify the renderer so it can display the question
        try {
          const { sendToMainWindow } = require('./main-window');
          sendToMainWindow('agent-question', { question: msg.question, reqId: msg.reqId });
        } catch { /* renderer may not be open */ }
        const { Notification } = require('electron');
        new Notification({ title: 'Agent needs input', body: msg.question, silent: false }).show();
      }
    });

    worker.on('exit', (code) => {
      console.warn('[agent] Worker exited with code', code);
      worker = null;
      initPromise = null;
      workerReady = false;
      for (const [, p] of pending) p.reject(new Error('Agent worker exited'));
      pending.clear();
    });

    worker.send({ type: 'init', modelPath });
  });

  return initPromise;
}

// ─── Run agent command ────────────────────────────────────────────────────────

/**
 * Filter the full 76-tool list down to ~25 relevant tools based on
 * keywords in the transcript. This prevents context-window overflow
 * with small models (1.5–3 B params, 8 K context).
 */
function selectRelevantTools(transcript, allTools) {
  const t = transcript.toLowerCase();

  // ── Keyword groups ──────────────────────────────────────────────────────────
  const wantsBrowser = /\b(browser|go to|open.*site|website|url|http|navigate|google|bing|youtube|search|gmail|email.*browser|safari|chrome|firefox|tab|page)\b/.test(t);
  const wantsYoutube = /\b(youtube|play|song|music|video|watch)\b/.test(t);
  const wantsExt     = /\b(click|fill|form|input|button|link|scroll|submit|select)\b/.test(t);
  const wantsFile    = /\b(file|folder|directory|download|copy|move|rename|delete|find|open|read|write|desktop|document)\b/.test(t);
  const wantsClip    = /\b(clipboard|paste|copy|clip)\b/.test(t);
  const wantsApp     = /\b(app|application|open|launch|switch|quit|hide|spotify|slack|zoom|terminal|finder|mail|notes)\b/.test(t);
  const wantsKeyboard = /\b(type|press|keystroke|shortcut|cmd|command|enter|escape)\b/.test(t);
  const wantsSystem  = /\b(volume|brightness|dark mode|light mode|screenshot|wifi|battery|notification|reminder|alarm)\b/.test(t);
  const wantsShell   = /\b(terminal|shell|command|run|bash|script|npm|git|ls|find|grep|download)\b/.test(t);
  const wantsMem     = /\b(remember|recall|forget|preference|my name|my email|my boss)\b/.test(t);

  // Always include system + memory (small, high utility)
  const ALWAYS_INCLUDE = ['show_notification', 'remember', 'recall', 'set_volume', 'set_dark_mode', 'take_screenshot'];

  const allowed = new Set(ALWAYS_INCLUDE);

  // Skill groups → tool name prefixes/exact names
  const skillMap = {
    browser:  ['open_url', 'search_google', 'search_youtube', 'open_new_tab', 'get_current_url', 'get_page_title',
                'browser_back', 'browser_reload', 'list_tabs', 'close_tab', 'run_js_in_page', 'get_page_text',
                'click_element', 'fill_input', 'youtube_play_pause', 'youtube_click_first_result', 'open_url_default'],
    youtube:  ['search_youtube', 'youtube_play_pause', 'youtube_click_first_result', 'ext_yt_play_first_result', 'ext_yt_play_pause'],
    ext:      ['ext_navigate', 'ext_get_url', 'ext_get_text', 'ext_get_links', 'ext_click', 'ext_click_text',
                'ext_fill', 'ext_submit', 'ext_scroll', 'ext_run_js', 'ext_new_tab', 'ext_list_tabs', 'ext_switch_tab'],
    file:     ['read_file', 'write_file', 'list_directory', 'copy_file', 'move_file', 'delete_file', 'open_in_finder',
                'file_info', 'create_directory', 'copy_file_path_to_clipboard', 'copy_latest_download_to_clipboard', 'open_file'],
    clip:     ['get_clipboard', 'set_clipboard', 'clear_clipboard', 'copy_file_path_to_clipboard', 'copy_latest_download_to_clipboard'],
    app:      ['open_app', 'quit_app', 'hide_app', 'minimize_window', 'get_frontmost_app', 'list_running_apps', 'take_screenshot'],
    keyboard: ['type_text', 'press_key', 'keystroke', 'hotkey'],
    system:   ['set_volume', 'get_volume', 'set_brightness', 'set_dark_mode', 'set_light_mode', 'take_screenshot',
                'show_notification', 'open_url_default'],
    shell:    ['run_command', 'get_latest_download', 'list_downloads', 'open_terminal', 'find_files'],
    memory:   ['remember', 'recall', 'forget_fact'],
  };

  const wantsGmail     = /\b(gmail|email|inbox|compose|send mail)\b/.test(t);
  const wantsOutlook   = /\b(outlook|office mail)\b/.test(t);
  const wantsSpotify   = /\b(spotify)\b/.test(t);
  const wantsTwitter   = /\b(twitter|tweet|x\.com)\b/.test(t);
  const wantsFacebook  = /\b(facebook|fb)\b/.test(t);
  const wantsSlack     = /\b(slack|dm|channel|message.*person|send.*slack|open.*dm|open.*channel|read.*message)\b/.test(t);
  const wantsWhatsApp  = /\b(whatsapp|whats app|what.*app)\b/.test(t);
  const wantsDiscord   = /\b(discord|server|join.*server|open.*server)\b/.test(t);
  const wantsWorkspace = /\b(google sheet|spreadsheet|google form|google doc|google cal|calendar|sheets|forms|docs)\b/.test(t);
  const wantsGitHub    = /\b(github|pull request|pr|issue|repository|repo)\b/.test(t);
  const wantsNotion    = /\b(notion|page|workspace|database)\b/.test(t);

  if (wantsBrowser || wantsYoutube) { for (const n of skillMap.browser) allowed.add(n); }
  if (wantsYoutube)                  { for (const n of skillMap.youtube) allowed.add(n); }
  if (wantsExt || wantsBrowser)      { for (const n of skillMap.ext)    allowed.add(n); }
  if (wantsFile || wantsShell)       { for (const n of skillMap.file)   allowed.add(n); }
  if (wantsClip || wantsFile)        { for (const n of skillMap.clip)   allowed.add(n); }
  if (wantsApp)                      { for (const n of skillMap.app)    allowed.add(n); }
  if (wantsKeyboard)                 { for (const n of skillMap.keyboard) allowed.add(n); }
  if (wantsSystem)                   { for (const n of skillMap.system) allowed.add(n); }
  if (wantsShell)                    { for (const n of skillMap.shell)  allowed.add(n); }
  if (wantsMem)                      { for (const n of skillMap.memory) allowed.add(n); }

  // Site-specific recipe tools
  if (wantsGmail)     { ['gmail_compose','gmail_set_recipient','gmail_set_subject','gmail_set_body','gmail_send','gmail_search','gmail_reply','gmail_archive'].forEach(n => allowed.add(n)); }
  if (wantsOutlook)   { ['outlook_compose','outlook_set_recipient','outlook_set_subject','outlook_set_body','outlook_send','outlook_reply'].forEach(n => allowed.add(n)); }
  if (wantsYoutube)   { ['youtube_play_pause','youtube_like','youtube_search','youtube_play_first_result','youtube_subscribe','youtube_mute','youtube_fullscreen','youtube_seek_forward','youtube_seek_back'].forEach(n => allowed.add(n)); }
  if (wantsSpotify)   { ['spotify_play_pause','spotify_next','spotify_previous','spotify_like','spotify_shuffle','spotify_search','spotify_play_first_result'].forEach(n => allowed.add(n)); }
  if (wantsTwitter)   { ['twitter_tweet','twitter_like','twitter_retweet','twitter_reply','twitter_follow','twitter_search'].forEach(n => allowed.add(n)); }
  if (wantsFacebook)  { ['facebook_post','facebook_like','facebook_comment','facebook_share','facebook_search'].forEach(n => allowed.add(n)); }
  if (wantsSlack)     { ['slack_open_dm','slack_open_channel','slack_send_message','slack_read_messages','slack_search','slack_set_status','slack_react'].forEach(n => allowed.add(n)); }
  if (wantsWhatsApp)  { ['whatsapp_open_chat','whatsapp_send_message','whatsapp_read_messages','whatsapp_new_group'].forEach(n => allowed.add(n)); }
  if (wantsDiscord)   { ['discord_open_server','discord_open_channel','discord_send_message','discord_read_messages','discord_react'].forEach(n => allowed.add(n)); }
  if (wantsWorkspace) { ['sheets_open','sheets_read_cell','sheets_write_cell','sheets_add_row','forms_fill_field','forms_submit','docs_open','docs_read','calendar_create_event'].forEach(n => allowed.add(n)); }
  if (wantsGitHub)    { ['github_open_repo','github_create_pr','github_open_issue'].forEach(n => allowed.add(n)); }
  if (wantsNotion)    { ['notion_open_page','notion_create_page','notion_add_block'].forEach(n => allowed.add(n)); }

  // If nothing matched, fall back to a minimal but broadly useful set
  if (allowed.size <= ALWAYS_INCLUDE.length) {
    for (const n of [...skillMap.app, ...skillMap.browser, ...skillMap.shell]) allowed.add(n);
  }

  const filtered = allTools.filter(t => allowed.has(t.name));
  console.log(`[agent] tools: ${allTools.length} → ${filtered.length} for: "${transcript.slice(0, 60)}"`);
  return filtered;
}

/**
 * Try to detect which hostname the user's Chrome tab is on.
 * We ask the ws-bridge; if the extension isn't connected we get null.
 */
async function detectCurrentSite() {
  try {
    const wsBridge = require('./ws-bridge');
    if (!wsBridge.isExtensionConnected()) return null;
    const url = await wsBridge.sendToExtension('get_url', {});
    if (!url || url.startsWith('chrome://') || url.startsWith('about:')) return null;
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Build site-specific context hint and tools for the LLM when the browser
 * is on a page with known recipes.
 */
async function buildSiteContext(transcript, allTools) {
  const hostname = await detectCurrentSite();
  if (!hostname) return { siteTools: [], siteHint: '' };

  const { SITE_RECIPES } = require('./site-recipes');
  const recipe = SITE_RECIPES[hostname];
  if (!recipe) return { siteTools: [], siteHint: '' };

  // Find all tools that are recipe tools for this hostname
  const recipeActionNames = new Set(Object.keys(recipe.actions));
  const siteTools = allTools.filter(t => recipeActionNames.has(t.name));

  // Also always include ext_get_site_actions and ext_site_action as fallbacks
  const extras = ['ext_get_site_actions', 'ext_site_action', 'ext_navigate', 'ext_get_url', 'ext_get_text'];
  for (const name of extras) {
    if (!siteTools.find(t => t.name === name)) {
      const t = allTools.find(t => t.name === name);
      if (t) siteTools.push(t);
    }
  }

  const actionList = Object.entries(recipe.actions)
    .map(([name, def]) => {
      const params = Object.keys(def.params || {});
      return `  ${name}${params.length ? `(${params.join(', ')})` : ''}: ${def.description}`;
    })
    .join('\n');

  const siteHint =
    `\n## You are currently on ${recipe.label} (${hostname})\n` +
    `Use these dedicated actions — do NOT manually click selectors:\n${actionList}`;

  return { siteTools, siteHint };
}

/**
 * Run one agent turn.
 * @param {string} transcript — what the user said
 * @param {object} opts
 * @param {boolean} opts.isAnswer — true if this is answering a prior ask_user question
 * @param {boolean} opts.resetSession — true to force a fresh LLM context
 */
async function runAgent(transcript, opts = {}) {
  await ensureWorker();

  const { getToolDefinitions } = require('./skill-loader');
  const { buildContext, addHistoryEntry } = require('./memory');

  // ── If this is an answer to a pending ask_user, route it back to the worker ─
  if (opts.isAnswer && pendingAskUserReqId) {
    const reqId = pendingAskUserReqId;
    pendingAskUserReqId = null;
    pendingAskUserQuestion = null;
    worker.send({ type: 'user_answer', reqId, answer: transcript });
    // The worker will continue its current run and eventually send a `result` message
    // which will be handled by the existing pending entry — nothing to return here yet
    return `[Answering: ${transcript}]`;
  }

  // ── Determine if session should be reset ──────────────────────────────────
  const now = Date.now();
  const idleReset = (now - sessionLastUsed) > SESSION_IDLE_MS && sessionLastUsed > 0;
  const resetSession = opts.resetSession || idleReset;
  sessionLastUsed = now;

  const allTools = getToolDefinitions();
  const { siteTools, siteHint } = await buildSiteContext(transcript, allTools);

  let tools = selectRelevantTools(transcript, allTools);

  if (siteTools.length > 3) {
    const GENERIC_EXT = new Set(['ext_click', 'ext_fill', 'ext_type', 'ext_submit', 'ext_wait_for',
      'ext_get_text_of', 'ext_get_attr', 'ext_is_visible', 'ext_scroll_to', 'ext_screenshot',
      'ext_wait_ms', 'ext_run_js', 'ext_press', 'ext_hover', 'ext_select_option', 'ext_focus', 'ext_clear']);
    tools = tools.filter(t => !GENERIC_EXT.has(t.name));
    const toolNames = new Set(tools.map(t => t.name));
    for (const st of siteTools) {
      if (!toolNames.has(st.name)) { tools.push(st); toolNames.add(st.name); }
    }
  }

  const contextText = buildContext() + siteHint;
  const id = ++requestId;

  return new Promise((resolve, reject) => {
    const record = {
      resolve: (r) => {
        addHistoryEntry(transcript, r.actions, true);
        resolve(r.reply);
      },
      reject: (e) => {
        addHistoryEntry(transcript, [], false);
        reject(e);
      },
      actions: [],
    };

    pending.set(id, record);
    worker.send({ type: 'run', id, transcript, tools, contextText, resetSession });
  });
}

/**
 * Answer a pending ask_user question from the agent.
 * Called by index.js when the user speaks while an ask_user is pending.
 */
function answerAgentQuestion(answer) {
  if (!pendingAskUserReqId) return false;
  const reqId = pendingAskUserReqId;
  pendingAskUserReqId = null;
  pendingAskUserQuestion = null;
  if (worker) worker.send({ type: 'user_answer', reqId, answer });
  return true;
}

function getPendingQuestion() {
  return pendingAskUserQuestion;
}

function resetAgentSession() {
  if (worker) worker.send({ type: 'reset_session' });
  pendingAskUserReqId = null;
  pendingAskUserQuestion = null;
  sessionLastUsed = 0;
}

async function dispose() {
  if (worker) { worker.kill(); worker = null; }
  initPromise = null;
  workerReady = false;
  pending.clear();
}

async function restartWorker() {
  await dispose();
}

module.exports = {
  AGENT_REGISTRY,
  runAgent,
  answerAgentQuestion,
  getPendingQuestion,
  resetAgentSession,
  isModelAvailable,
  isAgentModelAvailable,
  getAgentModelsStatus,
  getActiveModelKey,
  startAgentDownload,
  pauseAgentDownload,
  cancelAgentDownload,
  deleteAgentModel,
  dispose,
  restartWorker,
};
