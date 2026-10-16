/**
 * The assistant's runtime, downloaded on demand — not shipped in the app.
 *
 * The assistant is behind a setting (Settings › Assistant), and most people
 * only dictate, so the ~350 MB it runs on is fetched when somebody turns it on
 * and presses Download, into the app's data folder:
 *
 *   <root>/node/bin/node                        Node, pinned and checksummed
 *   <root>/bb/node_modules/bb-app/dist/bb-app.js bb, `npm ci` against the
 *                                                lockfile in
 *                                                resources/assistant-runtime
 *   <root>/INSTALLED.json                       what is there, written last
 *
 * Every package is pinned: Node by sha256 (the table below), bb's whole
 * dependency closure by the lockfile's integrity hashes. bb's native modules
 * (better-sqlite3, node-pty, @parcel/watcher) are fetched as prebuilds for the
 * Node they will run on, because `npm ci` runs on that Node with it first on
 * PATH — the same reason bb never runs inside Electron (supervisor.js).
 *
 * Nothing half-installed is ever visible: the install is staged beside the
 * root, verified by loading bb's native modules on its own Node, and renamed
 * into place whole; INSTALLED.json is the last file written. An app update
 * that pins a different Node or bb reads as "outdated" — Download again.
 *
 * Electron-free (scripts/install-assistant.js runs it from a plain Node).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { download, extract } = require('./desktop/download');

const NODE_VERSION = 'v22.23.3';
// sha256 of node-<version>-<target>.tar.gz, from nodejs.org/dist/<version>/SHASUMS256.txt
const NODE_SHA256 = {
  'darwin-arm64': '23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53',
  'darwin-x64': '8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8',
  'linux-x64': '1084aa36196bba4c3a5e69a1ee388a6e4ff729dad09445fbcd434b28fe3c24af',
};

/** The manifest + lockfile `npm ci` installs from (copied into the app). */
function manifestDir() {
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'assistant-runtime'));
  candidates.push(path.join(__dirname, '..', '..', '..', 'resources', 'assistant-runtime'));
  return candidates.find((d) => fs.existsSync(path.join(d, 'package-lock.json'))) || null;
}

/** The bb version the lockfile pins. */
function pinnedBbVersion(dir = manifestDir()) {
  if (!dir) return null;
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
    return lock.packages?.['node_modules/bb-app']?.version || null;
  } catch { return null; }
}

function target(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

let root = null;
/** Where the runtime lives (the app's data folder; env-overridable for e2e). */
function setRuntimeRoot(dir) { root = dir; }
function runtimeRoot(env = process.env) {
  return env.TELLAFLOW_ASSISTANT_RUNTIME_DIR || root;
}

function readInstalled(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'INSTALLED.json'), 'utf8')); } catch { return null; }
}

/**
 * What is on disk: 'missing' | 'outdated' | 'installed', with the paths
 * supervisor.js launches when installed.
 */
function runtimeStatus(dir = runtimeRoot()) {
  const want = { node: NODE_VERSION, bb: pinnedBbVersion() };
  const supported = !!NODE_SHA256[target()];
  if (!dir) return { state: 'missing', supported, want, installed: null, node: null, launcher: null };
  const installed = readInstalled(dir);
  const node = path.join(dir, 'node', 'bin', 'node');
  const launcher = path.join(dir, 'bb', 'node_modules', 'bb-app', 'dist', 'bb-app.js');
  if (!installed || !fs.existsSync(node) || !fs.existsSync(launcher)) {
    return { state: 'missing', supported, want, installed: null, node: null, launcher: null };
  }
  const current = installed.node === want.node && installed.bb === want.bb && installed.target === target();
  return {
    state: current ? 'installed' : 'outdated',
    supported,
    want,
    installed,
    // An outdated runtime still runs: it is what the user had, and bb's wire
    // format is what the pin protects — Download again replaces it.
    node,
    launcher,
  };
}

/** Run a command; reject with the tail of its output. */
function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const keep = (d) => { out = (out + String(d)).slice(-4000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const onAbort = () => { try { child.kill('SIGTERM'); } catch {} };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) reject(new Error('Cancelled.'));
      else if (code === 0) resolve(out);
      else reject(new Error(`${path.basename(args[0] || cmd)} exited ${code}: ${out.trim().slice(-600)}`));
    });
  });
}

/** The environment npm runs in: none of a parent `npm run`'s settings. */
function installEnv(nodeBin, cacheDir, env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^npm_/i.test(k) || k === 'ELECTRON_RUN_AS_NODE' || k === 'NODE_OPTIONS') continue;
    out[k] = v;
  }
  out.PATH = `${nodeBin}${path.delimiter}${env.PATH || ''}`;
  out.npm_config_cache = cacheDir;
  out.npm_config_update_notifier = 'false';
  out.npm_config_fund = 'false';
  out.npm_config_audit = 'false';
  return out;
}

let installing = null;

/**
 * Download Node and install bb. onProgress({ phase, received, total }):
 * phase 'node' (bytes), 'bb' (npm ci), 'verify'.
 */
function installRuntime(options = {}) {
  if (installing) return installing;
  installing = doInstall(options).finally(() => { installing = null; });
  return installing;
}

async function doInstall({ onProgress = () => {}, signal, dir = runtimeRoot() } = {}) {
  if (!dir) throw new Error('The assistant has nowhere to download to yet.');
  const t = target();
  const sha256 = NODE_SHA256[t];
  if (!sha256) throw new Error(`The assistant isn't available on ${t}.`);
  const manifest = manifestDir();
  const bbVersion = pinnedBbVersion(manifest);
  if (!manifest || !bbVersion) throw new Error('The assistant’s package list is missing from this build.');

  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tellaflow-assistant-'));
  const staged = `${dir}.part`;
  try {
    // 1. Node.
    const name = `node-${NODE_VERSION}-${t}`;
    const tarball = path.join(work, 'node.tgz');
    onProgress({ phase: 'node', received: 0, total: null });
    await download(`https://nodejs.org/dist/${NODE_VERSION}/${name}.tar.gz`, tarball, {
      sha256,
      signal,
      onProgress: (received, total) => onProgress({ phase: 'node', received, total }),
    });
    await extract(tarball, work);
    fs.rmSync(tarball, { force: true });
    const dist = path.join(work, name);
    const nodeBin = path.join(dist, 'bin');
    const npmCli = path.join(dist, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!fs.existsSync(path.join(nodeBin, 'node')) || !fs.existsSync(npmCli)) {
      throw new Error('The Node download has no node or npm in it.');
    }

    fs.rmSync(staged, { recursive: true, force: true });
    fs.mkdirSync(path.join(staged, 'node', 'bin'), { recursive: true });
    // Only the runtime and its licence: npm and headers are not needed to run bb.
    fs.copyFileSync(path.join(nodeBin, 'node'), path.join(staged, 'node', 'bin', 'node'));
    fs.chmodSync(path.join(staged, 'node', 'bin', 'node'), 0o755);
    fs.copyFileSync(path.join(dist, 'LICENSE'), path.join(staged, 'node', 'LICENSE'));

    // 2. bb, exactly as locked.
    onProgress({ phase: 'bb', received: 0, total: null });
    const bbDir = path.join(staged, 'bb');
    fs.mkdirSync(bbDir, { recursive: true });
    for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(manifest, f), path.join(bbDir, f));
    const env = installEnv(nodeBin, path.join(work, 'npm-cache'));
    await run(path.join(nodeBin, 'node'), [npmCli, 'ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: bbDir, env, signal });

    // 3. Verified the way bb will run: its own native modules on its own Node.
    onProgress({ phase: 'verify', received: 0, total: null });
    const stagedNode = path.join(staged, 'node', 'bin', 'node');
    const bbPkg = path.join(bbDir, 'node_modules', 'bb-app');
    if (!fs.existsSync(path.join(bbPkg, 'dist', 'bb-app.js'))) throw new Error('bb installed without its launcher.');
    await run(stagedNode, ['-e', [
      "const { createRequire } = require('module');",
      `const r = createRequire(${JSON.stringify(path.join(bbPkg, 'package.json'))});`,
      "const Database = r('better-sqlite3'); new Database(':memory:').close();",
      "r('node-pty');",
    ].join('\n')], { cwd: bbPkg, env: installEnv(path.dirname(stagedNode), path.join(work, 'npm-cache')), signal });

    fs.writeFileSync(path.join(staged, 'INSTALLED.json'), JSON.stringify({
      node: NODE_VERSION,
      bb: bbVersion,
      target: t,
      at: new Date().toISOString(),
    }, null, 2));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(staged, dir);
  } catch (err) {
    fs.rmSync(staged, { recursive: true, force: true });
    throw err;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return runtimeStatus(dir);
}

/** Delete the download (the caller stops bb first). */
function removeRuntime(dir = runtimeRoot()) {
  if (!dir) return;
  fs.rmSync(`${dir}.part`, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = {
  NODE_VERSION,
  NODE_SHA256,
  manifestDir,
  pinnedBbVersion,
  setRuntimeRoot,
  runtimeRoot,
  runtimeStatus,
  installRuntime,
  removeRuntime,
  installEnv,
  isInstalling: () => !!installing,
};
