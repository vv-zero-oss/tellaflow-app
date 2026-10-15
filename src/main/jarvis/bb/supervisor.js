"use strict";
/**
 * Bring up — or adopt — the bb server the editor's agent tools hang off.
 *
 * bb (`get-bb/bb`, npm `bb-app`) is an agentic IDE that wraps whichever
 * provider CLI the user has already authenticated. The editor does not reason
 * about providers at all: it starts bb, installs its own plugin into it (see
 * canvas-tools.ts), and lets bb run the agent.
 *
 * Four things here are load-bearing, each preventing a concrete failure:
 *
 *  1. **bb never runs inside Electron.** It pins its own `better-sqlite3`
 *     against the plain-Node ABI while Electron rebuilds native modules against
 *     its own; sharing a module store clobbers one of the two binaries. So: a
 *     child process under a login shell's node, always.
 *
 *  2. **Our data dir is never `~/.bb`.** That is the user's real bb database,
 *     host identity and `daemon.lock`. Pointing a second launcher at it means
 *     two of them fighting over one lock, and this editor's threads showing up
 *     in their sidebar. {@link assertSafeDataDir} makes that a thrown error
 *     rather than a support ticket.
 *
 *  3. **Readiness is three probes, not one.** A bb server answers `/health`
 *     before its host daemon has enrolled, and anything that needs a host fails
 *     with `host_unavailable` until one is `connected` — so we also require
 *     `/system/config` and a connected host in `GET /hosts`.
 *
 *  4. **The host-daemon port is preflighted before we fork.** Adoption keys off
 *     the server port alone, so a daemon orphaned by a crashed editor — still
 *     LISTENing on its port with the server port free — is invisible to it. We
 *     would spawn a launcher whose daemon can never bind, and bb's own
 *     supervisor would restart that half forever.
 *
 * Electron-free and fully injectable (spawn, fetch, clock, sleep) so the whole
 * lifecycle is testable without a real process or socket.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BB_DEFAULT_DAEMON_PORT = exports.BB_DEFAULT_SERVER_PORT = exports.BB_APP_VERSION = void 0;
exports.bbDataDir = bbDataDir;
exports.bbServerPort = bbServerPort;
exports.bbDaemonPort = bbDaemonPort;
exports.assertSafeDataDir = assertSafeDataDir;
exports.bundledLauncher = bundledLauncher;
exports.buildLaunchCommand = buildLaunchCommand;
exports.loginShellInvocation = loginShellInvocation;
exports.probeReady = probeReady;
exports.ensureBbServer = ensureBbServer;
exports.stopBbServer = stopBbServer;
exports.currentBbServer = currentBbServer;
exports.resetBbServerState = resetBbServerState;
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_net_1 = __importDefault(require("node:net"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_module_1 = require("node:module");
const node_child_process_1 = require("node:child_process");
const client_1 = require("./client");
const process_tree_1 = require("../process-tree");
/**
 * The version of bb this app ships. It is a real dependency (`bb-app` in
 * package.json), so this is normally the copy in `node_modules` rather than a
 * download — see {@link bundledLauncher} — and
 * `electron/__tests__/bb-supervisor.test.ts` fails if the two ever disagree.
 *
 * Pinned deliberately: bb states an explicit no-deprecation-window policy, so
 * a floating version can change the wire format between two launches. Bumping
 * it means re-reading the plugin install route, the
 * `/plugins/<id>/http/<path>` mount, and the plugin SDK's `registerTool` /
 * `configure` shapes — everything `resources/bb-plugin` is written against —
 * and re-verifying the panel's chrome selectors (electron/bb/bb-chrome.ts).
 */
exports.BB_APP_VERSION = "0.42.1";
/** bb's own production defaults (`packages/config/src/runtime.ts`). Sharing
 *  them is what makes adoption of a bb the user already runs possible. */
exports.BB_DEFAULT_SERVER_PORT = 38886;
exports.BB_DEFAULT_DAEMON_PORT = 38887;
/** `BB_PROD_DATA_DIR_NAME`. Never ours. */
const USER_BB_DATA_DIR_NAME = ".bb";
const PROBE_TIMEOUT_MS = 1_000;
/** How long a server that is already listening gets to reach full readiness.
 *  We must not spawn a second launcher onto a bound port, so the only options
 *  on this path are wait or fail. */
const ADOPT_READY_TIMEOUT_MS = 15_000;
/** A cold `npx bb-app` downloads ~180MB on first run, so this is generous. */
const SPAWN_READY_TIMEOUT_MS = 180_000;
const READY_POLL_INTERVAL_MS = 250;
/** Where our bb keeps its database. Env-overridable so an automated run can be
 *  pointed at a throwaway directory rather than the one a real session uses. */
function bbDataDir(homeDir = node_os_1.default.homedir(), env = process.env) {
    return env.TELLAFLOW_BB_DATA_DIR || node_path_1.default.join(homeDir, ".tellaflow", "bb");
}
function bbServerPort(env = process.env) {
    const n = Number(env.TELLAFLOW_BB_SERVER_PORT);
    return Number.isInteger(n) && n > 0 && n < 65_536 ? n : exports.BB_DEFAULT_SERVER_PORT;
}
function bbDaemonPort(env = process.env) {
    const n = Number(env.TELLAFLOW_BB_DAEMON_PORT);
    return Number.isInteger(n) && n > 0 && n < 65_536 ? n : exports.BB_DEFAULT_DAEMON_PORT;
}
/** Throw if the data dir is (or is inside) the user's own `~/.bb`. Sharing it
 *  means sharing the SQLite database, the host identity and `daemon.lock` with
 *  their real bb — two launchers, one lock, one host row. */
function assertSafeDataDir(dataDir, homeDir) {
    const userBb = node_path_1.default.resolve(homeDir, USER_BB_DATA_DIR_NAME);
    const resolved = node_path_1.default.resolve(dataDir);
    if (resolved === userBb || resolved.startsWith(`${userBb}${node_path_1.default.sep}`)) {
        throw new Error(`refusing to run the agent backend against the user's own data dir (${resolved})`);
    }
}
/**
 * Where the bundled bb lives.
 *
 * bb ships *inside* the app — it is a dependency, not something fetched on
 * first use — so an editor with no network still has an assistant, and the
 * version that runs is the one this build was tested against rather than
 * whatever npm answers with today.
 *
 * Packaged, Electron puts `node_modules` inside `app.asar`, and bb cannot run
 * from there: it loads native binaries (better-sqlite3, node-pty), which have
 * to be real files on disk. electron-builder's `asarUnpack` writes those to
 * `app.asar.unpacked`, so a resolved path pointing into the archive is
 * rewritten to its unpacked twin here rather than at every call site.
 *
 * Returns null when the dependency is not installed — a checkout with pruned
 * modules — and the launch line falls back to `npx` for that case alone.
 */
function bundledLauncher(resolveFrom = require
    .resolve, exists = node_fs_1.default.existsSync) {
    let launcher;
    try {
        // The launcher by its exported specifier, not by climbing from
        // `bb-app/package.json`: bb-app's `exports` map does not publish its own
        // manifest, so resolving that throws ERR_PACKAGE_PATH_NOT_EXPORTED and the
        // bundled copy would look absent on a machine that has it.
        launcher = resolveFrom("bb-app/dist/bb-app.js");
    }
    catch {
        return null;
    }
    const unpacked = launcher.replace(`${node_path_1.default.sep}app.asar${node_path_1.default.sep}`, `${node_path_1.default.sep}app.asar.unpacked${node_path_1.default.sep}`);
    return exists(unpacked) ? unpacked : null;
}
/**
 * The one shell line that starts the server.
 *
 * bb runs under a plain `node`, never under Electron: it pins its own
 * `better-sqlite3` against the Node ABI while Electron rebuilds native modules
 * against its own, and one module store cannot hold both. `ELECTRON_RUN_AS_NODE`
 * would put it back inside that ABI, so it is not an option either — this is
 * why the launch goes through a shell that finds the user's `node`.
 *
 * A login shell for the same reason: a GUI-launched Electron inherits a minimal
 * PATH, and would find neither `node` nor `npx`.
 *
 * `--server-bind-host 127.0.0.1` is passed explicitly even though it is bb's
 * own default: bb serves an unauthenticated, shell-spawning API, and the cost
 * of that default silently changing is a LAN-reachable one.
 */
function buildLaunchCommand(args) {
    const flags = [
        "start",
        "--data-dir",
        shQuote(args.dataDir),
        "--server-bind-host",
        "127.0.0.1",
        "--server-port",
        String(args.serverPort),
        "--host-daemon-port",
        String(args.daemonPort),
    ].join(" ");
    if (args.launcher) {
        // The message matters: "did not become ready" with no explanation is what
        // a missing `node` looks like otherwise, and this is the one prerequisite
        // the app cannot ship for the user.
        return (`if command -v node >/dev/null 2>&1; then exec node ${shQuote(args.launcher)} ${flags}; ` +
            `else echo "the agent backend needs Node on your PATH to run" >&2; exit 127; fi`);
    }
    // No bundled copy (a checkout with pruned modules). Prefer a bb-app the user
    // already has, and download the pinned one only as a last resort — chosen in
    // the shell rather than by a detection round-trip before it, so the decision
    // is made with the same profile PATH the launch itself runs under.
    return (`if command -v bb-app >/dev/null 2>&1; then exec bb-app ${flags}; ` +
        `else exec npx -y bb-app@${args.version} ${flags}; fi`);
}
/**
 * The shell and arguments that run one line under the user's login shell — the
 * PATH a GUI-launched Electron does not have, so the only way to find the
 * `node` (or `npx`) somebody installed. Exported so any other child the app
 * runs under the user's own node starts the same way bb does.
 */
function loginShellInvocation(command, env = process.env, shell) {
    return { shell: shell ?? env.SHELL ?? "/bin/zsh", args: ["-lc", command] };
}
function shQuote(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
/** Children observed exiting, so `waitReady` can bail out at once instead of
 *  burning the whole timeout on a launcher that died on startup. */
const childExited = new WeakSet();
/** All three readiness probes. Returns the connected host, or null if any of
 *  them fails — a health-ok server whose host has not enrolled is NOT ready. */
async function probeReady(client, timeoutMs) {
    if (!(await client.health(timeoutMs)))
        return null;
    try {
        await client.systemConfig(timeoutMs);
    }
    catch {
        return null;
    }
    let hosts;
    try {
        hosts = await client.hosts(timeoutMs);
    }
    catch {
        return null;
    }
    return hosts.find(client_1.isHostConnected) ?? null;
}
async function waitReady(client, deps, args) {
    for (;;) {
        const host = await probeReady(client, args.probeTimeoutMs);
        if (host)
            return host;
        // A launcher that has already exited will never become ready; wait on the
        // clock only while there is something alive to wait for.
        if (args.child && childExited.has(args.child))
            return null;
        if (deps.now() >= args.deadline)
            return null;
        await deps.sleep(args.pollIntervalMs);
    }
}
/**
 * Is anything LISTENing on this port on loopback?
 *
 * A connect probe rather than a bind probe: binding would race the launcher we
 * are about to start, and would have to guess the address family bb uses. A
 * refused connection means free; anything else — connected, or a timeout that
 * suggests a firewall — is treated as occupied, because spawning into an
 * occupied daemon port is the failure with no recovery.
 */
function defaultIsPortInUse(port, timeoutMs = 300) {
    return new Promise((resolve) => {
        const socket = new node_net_1.default.Socket();
        const done = (inUse) => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(inUse);
        };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => done(true));
        socket.once("timeout", () => done(true));
        socket.once("error", (err) => done(err.code !== "ECONNREFUSED"));
        socket.connect(port, "127.0.0.1");
    });
}
/** The server we started, if any. Module-scoped because `ensureBbServer` is
 *  called from more than one entry point and has to be idempotent. */
let owned = null;
let adopted = null;
/** A launcher forked but not yet ready. Quitting during bb's first start —
 *  a cold one downloads for minutes — must stop it too; `owned` is only set
 *  once it answers, and until then nothing else holds on to the child. */
let launching = null;
/**
 * The in-flight start, so concurrent callers share ONE launcher.
 *
 * `owned` cannot do this job: it is not assigned until the end of
 * `startBbServer`, after `waitReady` resolves seconds later, and every step
 * between the "is anything listening?" probe and the spawn awaits. Two callers
 * in the same tick would both see nothing listening and both fork a launcher —
 * and the two then split the ports, one winning the server port and the other
 * the daemon port, with bb's own supervisor restarting the loser forever.
 */
let starting = null;
function ensureBbServer(options = {}) {
    if (starting)
        return starting;
    // Cleared on settle rather than kept: a server that later dies must still be
    // restartable, and the `owned && probeReady` fast path at the top of
    // startBbServer makes re-entry cheap.
    starting = startBbServer(options).finally(() => {
        starting = null;
    });
    return starting;
}
async function startBbServer(options = {}) {
    const env = options.env ?? process.env;
    const homeDir = options.homeDir ?? node_os_1.default.homedir();
    const serverPort = options.serverPort ?? bbServerPort(env);
    const daemonPort = options.daemonPort ?? bbDaemonPort(env);
    const dataDir = options.dataDir ?? bbDataDir(homeDir, env);
    const probeTimeoutMs = options.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? READY_POLL_INTERVAL_MS;
    const deps = {
        now: options.now ?? Date.now,
        sleep: options.sleep ??
            ((ms) => new Promise((r) => {
                const t = setTimeout(r, ms);
                t.unref?.();
            })),
        log: options.log ?? (() => { }),
    };
    // Already ours and still answering — reuse it without another readiness round.
    if (owned && (await probeReady(owned.handle.client, probeTimeoutMs))) {
        return owned.handle;
    }
    const client = new client_1.BbClient({ port: serverPort, fetchImpl: options.fetchImpl });
    // 1. Adopt a server that is already listening. Reachability is decided by
    //    /health alone (cheap, 1s) so we never fork onto a bound port; full
    //    readiness is then waited for, not assumed.
    if (await client.health(probeTimeoutMs)) {
        deps.log(`[bb] server already listening on :${serverPort} — adopting it`);
        const host = await waitReady(client, deps, {
            probeTimeoutMs,
            pollIntervalMs,
            deadline: deps.now() + (options.readyTimeoutMs ?? ADOPT_READY_TIMEOUT_MS),
            child: null,
        });
        if (!host) {
            throw new Error(`an agent backend is listening on :${serverPort} but never reported a ` +
                `connected host — nothing can be run against it`);
        }
        // An adopted server chose its own daemon port and data dir; reporting ours
        // for them would be a lie the rest of the app would act on.
        let adoptedDaemonPort = daemonPort;
        let adoptedDataDir = dataDir;
        try {
            const config = await client.systemConfig(probeTimeoutMs);
            if (typeof config.hostDaemonPort === "number") {
                adoptedDaemonPort = config.hostDaemonPort;
            }
            if (typeof config.dataDir === "string" && config.dataDir) {
                adoptedDataDir = config.dataDir;
            }
        }
        catch {
            // Readiness already proved it answers; keep our defaults.
        }
        adopted = {
            client,
            serverPort,
            daemonPort: adoptedDaemonPort,
            dataDir: adoptedDataDir,
            hostId: host.id,
            spawned: false,
        };
        return adopted;
    }
    // 2. Nothing listening — start our own.
    assertSafeDataDir(dataDir, homeDir);
    const portInUse = options.isPortInUse ?? defaultIsPortInUse;
    if (await portInUse(daemonPort)) {
        throw new Error(`the agent backend's host-daemon port :${daemonPort} is already in use, ` +
            `but nothing is serving on :${serverPort} — usually a daemon orphaned ` +
            `by a previous session. Stop it and try again ` +
            `(\`lsof -nP -iTCP:${daemonPort} -sTCP:LISTEN\`).`);
    }
    const launcher = options.launcher === undefined ? bundledLauncher() : options.launcher;
    const command = buildLaunchCommand({
        launcher,
        dataDir,
        serverPort,
        daemonPort,
        version: options.bbAppVersion ?? exports.BB_APP_VERSION,
    });
    deps.log(launcher
        ? `[bb] starting the bundled agent backend (${launcher})`
        : `[bb] no bundled agent backend — falling back to bb-app@${options.bbAppVersion ?? exports.BB_APP_VERSION}`);
    const spawnImpl = options.spawnImpl ??
        ((cmd, args, opts) => (0, node_child_process_1.spawn)(cmd, args, opts));
    const login = loginShellInvocation(command, env, options.shell);
    const child = spawnImpl(login.shell, login.args, {
        env: {
            ...env,
            // bb's telemetry defaults ON; this is not our data to send.
            BB_TELEMETRY: "false",
            BB_DATA_DIR: dataDir,
            BB_SERVER_BIND_HOST: "127.0.0.1",
            BB_SERVER_PORT: String(serverPort),
            BB_HOST_DAEMON_PORT: String(daemonPort),
        },
    });
    let markExited;
    const exited = new Promise((resolve) => (markExited = resolve));
    child.once("exit", () => {
        childExited.add(child);
        markExited();
    });
    child.once("error", () => {
        childExited.add(child);
        markExited();
    });
    launching = { child, exited };
    // Keep the tail of the launcher's stderr. Without it a failed start is an
    // opaque timeout, when the actual cause — npx cannot reach the registry, the
    // Node version is below bb's `engines`, the daemon lock is held — was printed
    // and thrown away.
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
        stderr = (stderr + String(chunk)).slice(-2000);
    });
    // And read stdout, though nothing here wants it. `spawn` pipes it by default,
    // and a pipe nobody reads fills (~64KB on macOS) and then blocks bb's next
    // write — the server stops answering mid-session and the agent hangs with
    // nothing logged. A listener puts the stream in flowing mode, which is all
    // it takes.
    child.stdout?.on("data", () => { });
    const host = await waitReady(client, deps, {
        probeTimeoutMs,
        pollIntervalMs,
        deadline: deps.now() + (options.readyTimeoutMs ?? SPAWN_READY_TIMEOUT_MS),
        child,
    });
    if (launching?.child === child)
        launching = null;
    if (!host) {
        try {
            child.kill("SIGTERM");
        }
        catch {
            // Already gone.
        }
        const tail = stderr.trim() ? `\n${stderr.trim()}` : "";
        throw new Error(`The agent backend did not become ready on :${serverPort} ` +
            `(data dir ${dataDir})${tail}`);
    }
    const handle = {
        client,
        serverPort,
        daemonPort,
        dataDir,
        hostId: host.id,
        spawned: true,
    };
    // `owned` is a single slot. If anything ever displaces a launcher we already
    // own, signal the old child here: `stopBbServer` only ever kills `owned`, so
    // a dropped handle is a launcher that outlives the app and keeps its restart
    // loop running until somebody finds it by hand. The single-flight guard above
    // should make this unreachable — it is a backstop with no other recovery.
    if (owned && owned.child !== child) {
        try {
            owned.child.kill("SIGTERM");
        }
        catch {
            // Already gone.
        }
    }
    owned = { child, handle, exited };
    adopted = null;
    deps.log(`[bb] server ready on :${serverPort} (host ${host.id})`);
    return handle;
}
/** bb-app gives its server and its host daemon 5s each on SIGTERM and then
 *  a 1s SIGKILL wait, in turn; a little over that before we step in. */
const STOP_GRACE_MS = 13_000;
/**
 * Stop the server — only if we started it — and wait until it has gone.
 *
 * An adopted server is the user's own bb, or another checkout's, and several
 * checkouts commonly run on one machine; killing it on quit would take down
 * work this process never owned.
 *
 * Waited for, and forced past the grace period: the launcher forwards SIGTERM
 * to its server and host daemon, and the daemon owns the terminals the app
 * ran dev servers in. Signalling it and letting the app exit at once is how a
 * bb (and a dev server under it) came to outlive the app — nothing was left
 * to notice that the launcher never finished shutting down.
 */
async function stopBbServer(options = {}) {
    adopted = null;
    const targets = [owned, launching].filter((t) => t !== null);
    owned = null;
    launching = null;
    await Promise.all(targets.map((t) => stopLauncher(t.child, t.exited, options)));
}
async function stopLauncher(child, exited, options) {
    if (childExited.has(child))
        return;
    try {
        child.kill("SIGTERM");
    }
    catch {
        // Already gone.
    }
    let timer;
    const stopped = await Promise.race([
        exited.then(() => true),
        new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), options.graceMs ?? STOP_GRACE_MS);
        }),
    ]);
    clearTimeout(timer);
    if (stopped || child.pid === undefined)
        return;
    (options.killTree ?? ((pid) => void (0, process_tree_1.killProcessTree)(pid)))(child.pid);
}
/** The handle from the last successful `ensureBbServer`, or null. */
function currentBbServer() {
    return owned?.handle ?? adopted;
}
/** Test seam: forget any tracked server without signalling it. */
function resetBbServerState() {
    owned = null;
    launching = null;
    adopted = null;
    starting = null;
}
