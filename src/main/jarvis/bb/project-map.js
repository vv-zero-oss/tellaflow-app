"use strict";
/**
 * The adapter between a project folder and the ids bb needs.
 *
 * The editor's world is simple: a project *is* an absolute path. bb's is not —
 * a project there is a row with source checkouts on named hosts, and anything
 * you ask it to run needs a project id plus an environment. bb has no "open
 * this folder" call, so this find-or-creates both, which is what makes the
 * Agent panel work with nothing for the user to set up: open a project, press
 * Agent, and the conversation is already scoped to that folder.
 *
 * Electron-free and driven entirely through the injected client, so the whole
 * resolution is testable against a fake fetch.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeProjectRoot = normalizeProjectRoot;
exports.createProjectMap = createProjectMap;
const node_path_1 = __importDefault(require("node:path"));
const client_1 = require("./client");
/**
 * bb stores a source path as its own normaliser left it: trimmed, with
 * trailing slashes stripped. Comparing a raw folder path against that misses
 * on a trailing slash or a doubled separator — and a miss is not harmless: it
 * creates a SECOND bb project for a folder bb already knows, after which two
 * rows fight over one directory.
 */
function normalizeProjectRoot(root) {
    const trimmed = root.trim();
    if (!trimmed)
        return "";
    const normalized = node_path_1.default.normalize(trimmed);
    return normalized === node_path_1.default.sep ? normalized : normalized.replace(/[/\\]+$/u, "");
}
/**
 * bb's host rows carry no "this is the local machine" flag — the only host
 * type is `persistent` — so the first connected host is the pick. That is
 * sound here because the supervisor starts a loopback-only server against its
 * own data dir, which enrols exactly one host: this machine. It is also the
 * rule the readiness probe uses, so readiness and resolution can never
 * disagree about which host they mean.
 */
async function pickConnectedHostId(client) {
    const hosts = await client.hosts();
    const connected = hosts.find(client_1.isHostConnected);
    if (connected)
        return connected.id;
    throw new Error(noConnectedHostMessage(hosts));
}
/** Read verbatim in the panel when it cannot open, so it says what is wrong
 *  AND what to do. The host list is in it because "no hosts at all" and "a host
 *  that is offline" have different fixes. Says "agent backend", never "bb" —
 *  the identifiers and the docs name it; the copy does not. */
function noConnectedHostMessage(hosts) {
    const seen = hosts.length
        ? `Hosts it reported: ${hosts.map((host) => `${host.name} (${host.status})`).join(", ")}.`
        : "It reported no hosts at all.";
    return (`The agent backend has no connected host, so there is nowhere to run the assistant. ${seen} ` +
        "This machine enrols as a host a moment after the backend comes up — wait for it to finish, " +
        "or reopen the project to relaunch it.");
}
/**
 * A project bb already has for this folder.
 *
 * Host+path first, then path on any host. The fallback is deliberate: reusing
 * bb's row for a folder always beats minting a rival, because bb keys workspace
 * claims on host+path and two projects over one directory is a conflict it will
 * report later, at the least convenient moment.
 */
function findProjectForRoot(projects, root, hostId) {
    const atRoot = (project, onHost) => project.sources.some((source) => normalizeProjectRoot(source.path) === root &&
        (onHost === undefined || source.hostId === onHost));
    const matches = projects.filter((project) => atRoot(project));
    return matches.find((project) => atRoot(project, hostId)) ?? matches[0];
}
function createProjectMap(client) {
    /**
     * Keyed by NORMALIZED root, holding the in-flight promise rather than the
     * settled value. Storing the promise is the point: two panels opened before
     * the first resolution returns would both miss a value-only cache and both
     * create a project for one folder.
     */
    const pending = new Map();
    async function resolveUncached(root) {
        const hostId = await pickConnectedHostId(client);
        const existing = findProjectForRoot(await client.projects(), root, hostId);
        const projectId = existing
            ? existing.id
            : (await client.createProject({ name: node_path_1.default.basename(root), root, hostId }))
                .id;
        return {
            projectId,
            hostId,
            /**
             * ALWAYS `unmanaged`, at the real path. bb's default workspace is a
             * managed git worktree — a checkout inside bb's own data dir — so the
             * assistant would be reading and writing a directory that is not the one
             * the editor has open, and every change it made would appear to do
             * nothing. `hostId` is required alongside it.
             */
            environment: {
                type: "host",
                hostId,
                workspace: { type: "unmanaged", path: root },
            },
        };
    }
    return {
        resolve(cwd) {
            const root = normalizeProjectRoot(cwd);
            const cached = pending.get(root);
            if (cached)
                return cached;
            const attempt = resolveUncached(root).catch((err) => {
                // A failed resolve must never be remembered. The common failure is "the
                // host has not enrolled yet", which is transient — caching it would
                // make the next attempt fail for a reason that is already gone.
                pending.delete(root);
                throw err;
            });
            pending.set(root, attempt);
            return attempt;
        },
        clear() {
            pending.clear();
        },
    };
}
