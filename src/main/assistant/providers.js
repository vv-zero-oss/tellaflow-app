/**
 * AI providers for the assistant — no API keys.
 *
 * Each provider uses something the user is already signed in to:
 *   claude  — Claude Code CLI   `claude -p --tools "" --output-format json`
 *   codex   — OpenAI Codex CLI  `codex exec --sandbox read-only …` (ChatGPT sign-in)
 *   gemini  — Gemini CLI        `gemini -p …` (Google sign-in)
 *   ollama  — local Ollama server on 127.0.0.1:11434
 *
 * The CLIs' own tools are disabled (or sandboxed read-only for Codex): they
 * only plan. Tellaflow executes the actions itself so it can ask for approval
 * and show every step.
 *
 * Process spawning and HTTP are injected so providers are testable.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const PROVIDER_IDS = ['claude', 'codex', 'gemini', 'ollama'];
const PROVIDER_LABELS = {
  claude: 'Claude (Claude Code CLI)',
  codex: 'ChatGPT / OpenAI (Codex CLI)',
  gemini: 'Gemini (Gemini CLI)',
  ollama: 'Ollama (local models)',
};

/** Run a command, feeding `input` on stdin. Resolves {code, stdout, stderr}. */
function runCommand(cmd, args, { input, timeout = 120_000, env, cwd, signal } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { env: env || process.env, cwd: cwd || os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (fn) => { if (!done) { done = true; clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); fn(); } };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} finish(() => reject(new Error(`${path.basename(cmd)} timed out`))); }, timeout);
    const onAbort = () => { try { child.kill('SIGKILL'); } catch {} finish(() => reject(new Error('Cancelled'))); };
    signal?.addEventListener?.('abort', onAbort);
    child.stdout.on('data', (d) => { stdout += d; if (stdout.length > 8e6) child.kill('SIGKILL'); });
    child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 1e6) stderr = stderr.slice(-1e5); });
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) => finish(() => resolve({ code, stdout, stderr })));
    child.stdin.on('error', () => {});
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

// GUI apps on macOS start with a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin),
// so CLIs installed by npm / Homebrew / the official installers aren't found.
function candidateDirs(home = os.homedir()) {
  return [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ];
}

let loginShellPath = null;
async function getLoginShellPath(run = runCommand) {
  if (loginShellPath != null) return loginShellPath;
  loginShellPath = '';
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    const r = await run(shell, ['-l', '-c', 'printf %s "$PATH"'], { timeout: 4000 });
    if (r.code === 0) loginShellPath = r.stdout.trim();
  } catch {}
  return loginShellPath;
}

async function resolveCli(name, { run = runCommand, exists = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } } } = {}) {
  const dirs = [
    ...(process.env.PATH || '').split(path.delimiter),
    ...candidateDirs(),
  ];
  // nvm: newest node version first
  try {
    const nvm = path.join(os.homedir(), '.nvm', 'versions', 'node');
    for (const v of fs.readdirSync(nvm).sort().reverse()) dirs.push(path.join(nvm, v, 'bin'));
  } catch {}
  for (const d of dirs) {
    if (d && exists(path.join(d, name))) return path.join(d, name);
  }
  const lp = await getLoginShellPath(run);
  for (const d of lp.split(path.delimiter)) {
    if (d && exists(path.join(d, name))) return path.join(d, name);
  }
  return null;
}

/** Env for child CLIs: augmented PATH so `#!/usr/bin/env node` shebangs resolve. */
function childEnv(cliPath) {
  const extra = [path.dirname(cliPath), ...candidateDirs()];
  return { ...process.env, PATH: [...extra, process.env.PATH || ''].join(path.delimiter), NO_COLOR: '1' };
}

function cliError(name, r) {
  const msg = (r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ');
  if (/log ?in|sign ?in|auth|credential|api key|unauthor/i.test(msg)) {
    return new Error(`${name} is installed but not signed in. Run \`${name}\` in Terminal once to sign in.`);
  }
  return new Error(`${name} exited with code ${r.code}${msg ? `: ${msg.slice(0, 300)}` : ''}`);
}

function createClaudeProvider({ run = runCommand, resolve = resolveCli, model } = {}) {
  return {
    id: 'claude',
    label: PROVIDER_LABELS.claude,
    async detect() {
      const p = await resolve('claude', { run });
      return p ? { available: true, path: p } : { available: false, detail: 'Install Claude Code: npm i -g @anthropic-ai/claude-code, then run `claude` once to sign in.' };
    },
    async complete(prompt, { signal } = {}) {
      const bin = await resolve('claude', { run });
      if (!bin) throw new Error('Claude Code CLI not found.');
      const args = ['-p', '--tools', '', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config'];
      if (model) args.push('--model', model);
      const r = await run(bin, args, { input: prompt, env: childEnv(bin), signal, timeout: 180_000 });
      if (r.code !== 0) throw cliError('claude', r);
      let out;
      try { out = JSON.parse(r.stdout); } catch { return r.stdout; }
      if (out.is_error) throw new Error(`Claude: ${out.result || out.subtype || 'error'}`);
      return out.result ?? '';
    },
  };
}

function createCodexProvider({ run = runCommand, resolve = resolveCli, model } = {}) {
  return {
    id: 'codex',
    label: PROVIDER_LABELS.codex,
    async detect() {
      const p = await resolve('codex', { run });
      return p ? { available: true, path: p } : { available: false, detail: 'Install Codex CLI: npm i -g @openai/codex, then run `codex` once and sign in with ChatGPT.' };
    },
    async complete(prompt, { signal } = {}) {
      const bin = await resolve('codex', { run });
      if (!bin) throw new Error('Codex CLI not found.');
      const outFile = path.join(os.tmpdir(), `tellaflow-codex-${process.pid}-${Date.now()}.txt`);
      // Read-only sandbox + "-" (prompt on stdin). We only want the final message.
      const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '--output-last-message', outFile];
      if (model) args.push('--model', model);
      args.push('-');
      try {
        const r = await run(bin, args, { input: prompt, env: childEnv(bin), signal, timeout: 180_000 });
        if (r.code !== 0) throw cliError('codex', r);
        try { return fs.readFileSync(outFile, 'utf8'); } catch { return r.stdout; }
      } finally {
        try { fs.unlinkSync(outFile); } catch {}
      }
    },
  };
}

function createGeminiProvider({ run = runCommand, resolve = resolveCli, model } = {}) {
  return {
    id: 'gemini',
    label: PROVIDER_LABELS.gemini,
    async detect() {
      const p = await resolve('gemini', { run });
      return p ? { available: true, path: p } : { available: false, detail: 'Install Gemini CLI: npm i -g @google/gemini-cli, then run `gemini` once to sign in with Google.' };
    },
    async complete(prompt, { signal } = {}) {
      const bin = await resolve('gemini', { run });
      if (!bin) throw new Error('Gemini CLI not found.');
      // Prompt on stdin; `-p` with an instruction is appended to it. Default
      // approval mode never auto-runs Gemini's own tools in non-interactive use.
      const args = ['-p', 'Follow the instructions above and reply with the JSON object only.'];
      if (model) args.push('-m', model);
      const r = await run(bin, args, { input: prompt, env: childEnv(bin), signal, timeout: 180_000 });
      if (r.code !== 0) throw cliError('gemini', r);
      return r.stdout;
    },
  };
}

async function httpJson(url, { method = 'GET', body, timeout = 120_000, signal } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener?.('abort', onAbort);
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

function createOllamaProvider({ http = httpJson, host = 'http://127.0.0.1:11434', getModel = () => '' } = {}) {
  async function pickModel() {
    const configured = getModel();
    if (configured) return configured;
    const tags = await http(`${host}/api/tags`, { timeout: 3000 });
    const names = (tags.models || []).map((m) => m.name);
    if (!names.length) throw new Error('Ollama has no models. Run `ollama pull llama3.2` first.');
    return names[0];
  }
  return {
    id: 'ollama',
    label: PROVIDER_LABELS.ollama,
    async detect() {
      try {
        const tags = await http(`${host}/api/tags`, { timeout: 1500 });
        const models = (tags.models || []).map((m) => m.name);
        return models.length
          ? { available: true, models }
          : { available: false, models, detail: 'Ollama is running but has no models. Run `ollama pull llama3.2`.' };
      } catch {
        return { available: false, detail: 'Ollama is not running. Install it from ollama.com and start it.' };
      }
    },
    async complete(prompt, { signal } = {}) {
      const model = await pickModel();
      const out = await http(`${host}/api/chat`, {
        method: 'POST',
        signal,
        body: { model, stream: false, format: 'json', options: { temperature: 0 }, messages: [{ role: 'user', content: prompt }] },
      });
      return out?.message?.content || '';
    },
  };
}

function createProviders(opts = {}) {
  return {
    claude: createClaudeProvider(opts.claude),
    codex: createCodexProvider(opts.codex),
    gemini: createGeminiProvider(opts.gemini),
    ollama: createOllamaProvider(opts.ollama),
  };
}

/** Detect all providers; returns [{id, label, available, detail, path?, models?}]. */
async function detectProviders(providers) {
  return Promise.all(
    PROVIDER_IDS.map(async (id) => {
      try {
        return { id, label: providers[id].label, ...(await providers[id].detect()) };
      } catch (err) {
        return { id, label: providers[id].label, available: false, detail: err.message };
      }
    }),
  );
}

/** 'auto' → first available in PROVIDER_IDS order. */
async function pickProvider(providers, preferred = 'auto') {
  if (preferred && preferred !== 'auto') return providers[preferred] || null;
  for (const status of await detectProviders(providers)) if (status.available) return providers[status.id];
  return null;
}

module.exports = {
  PROVIDER_IDS,
  PROVIDER_LABELS,
  runCommand,
  resolveCli,
  createClaudeProvider,
  createCodexProvider,
  createGeminiProvider,
  createOllamaProvider,
  createProviders,
  detectProviders,
  pickProvider,
};
