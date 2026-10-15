"use strict";
/**
 * What the Agent panel frames, for the folder the editor has open.
 *
 * The panel does not render a chat of its own: it frames bb's real web app, so
 * the composer, the timeline, tool rendering, steering, stop and the model
 * picker are bb's and cannot drift from it. bb serves no `X-Frame-Options` and
 * no CSP `frame-ancestors`, which is the only reason this is possible at all.
 *
 * Which URL depends on whether the project has a conversation yet:
 *   - a thread exists → `/projects/<pid>/threads/<tid>`, its detail view
 *   - none yet        → `/projects/<pid>`, bb's compose view, where the first
 *                       message creates the thread
 *
 * An empty thread is deliberately NOT pre-created to always land on the second:
 * bb refuses a thread with empty input unless an origin is named, so a
 * placeholder would mean inventing one and littering the user's bb with empty
 * conversations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setProjectMapFactory = setProjectMapFactory;
exports.bbProjectFor = bbProjectFor;
exports.bbWorkspaceUrl = bbWorkspaceUrl;
exports.threadUrl = threadUrl;
exports.latestThread = latestThread;
exports.sendToWorkspace = sendToWorkspace;
exports.listWorkspaceThreads = listWorkspaceThreads;
exports.sendToWorkspaceThread = sendToWorkspaceThread;
exports.startWorkspaceThread = startWorkspaceThread;
exports.bbAppUrl = bbAppUrl;
const supervisor_1 = require("./supervisor");
const project_map_1 = require("./project-map");
const client_1 = require("./client");
let mapFor = null;
const maps = new WeakMap();
function projectMap(client) {
    if (mapFor)
        return mapFor(client);
    let map = maps.get(client);
    if (!map) {
        map = (0, project_map_1.createProjectMap)(client);
        maps.set(client, map);
    }
    return map;
}
/** Test seam — inject a fake project map. */
function setProjectMapFactory(factory) {
    mapFor = factory;
}
/** Find-or-create the bb project for a folder, without resolving a URL — what
 *  the instructions push needs, since it is keyed by bb's project id. */
async function bbProjectFor(cwd, deps = {}) {
    const ensureServer = deps.ensureServer ?? supervisor_1.ensureBbServer;
    const server = await ensureServer();
    return projectMap(server.client).resolve(cwd);
}
/**
 * Resolve what the panel should frame for `cwd`.
 *
 * Throws when bb cannot be reached, and the panel says so with a Retry: a blank
 * frame is indistinguishable from a slow one and gives nobody anything to act
 * on.
 */
async function bbWorkspaceUrl(cwd, deps = {}, 
/** Frame this conversation rather than the newest — the one a request just
 *  went into. "The newest" is a race with anything else talking to the
 *  project, and a follow-up into an older chat is not the newest at all.
 *  Ignored unless it is one of this project's threads. */
preferThreadId, 
/** Frame the project's home — bb's compose view with the list of its
 *  conversations — even though threads exist. A request that has just opened
 *  a conversation lands here, so the person sees every job in flight and the
 *  new one among them; only a follow-up goes straight into its chat. */
home = false) {
    const ensureServer = deps.ensureServer ?? supervisor_1.ensureBbServer;
    const server = await ensureServer();
    const target = await projectMap(server.client).resolve(cwd);
    // Clicking Agent lands on the home with the list of recent chats, never on
    // whichever chat was last open; only a request that names a chat goes in.
    const threads = home || !preferThreadId
        ? []
        : await server.client.listThreads(target.projectId).catch(() => []);
    const preferred = preferThreadId ? threads.find((thread) => thread.id === preferThreadId) : undefined;
    if (!preferred) {
        return {
            url: `${server.client.origin}/projects/${encodeURIComponent(target.projectId)}`,
            origin: server.client.origin,
            projectId: target.projectId,
        };
    }
    return {
        url: threadUrl(server.client.origin, target.projectId, preferred.id),
        origin: server.client.origin,
        projectId: target.projectId,
        threadId: preferred.id,
    };
}
/**
 * A thread's URL in bb's app.
 *
 * It MUST be the project-scoped route. bb also exposes a projectless
 * `/threads/:id`, which is the obvious-looking one and renders a bare "Not
 * found" for a thread that belongs to a real project — no error, no redirect,
 * just an empty panel.
 */
function threadUrl(origin, projectId, threadId) {
    return `${origin}/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(threadId)}`;
}
/** Newest by `createdAt`, not by position: bb's list ordering is its own
 *  business, and picking an end of the array silently depends on it. */
function latestThread(threads) {
    let best;
    for (const thread of threads) {
        if (!best || (thread.createdAt ?? 0) >= (best.createdAt ?? 0))
            best = thread;
    }
    return best;
}
/**
 * Post text into the conversation the panel is framing.
 *
 * The composer belongs to bb, so this is not how a person types — it is how
 * the editor hands the assistant something the person selected. It must target
 * the thread on screen: opening a new one would leave them watching an empty
 * panel while the assistant worked somewhere else.
 */
async function sendToWorkspace(cwd, text, deps = {}) {
    const ensureServer = deps.ensureServer ?? supervisor_1.ensureBbServer;
    const server = await ensureServer();
    await deps.ensureTools?.();
    const target = await projectMap(server.client).resolve(cwd);
    const threads = await server.client.listThreads(target.projectId).catch(() => []);
    const latest = latestThread(threads);
    if (latest) {
        await server.client.sendMessage(latest.id, [{ type: "text", text }]);
        return { threadId: latest.id, created: false };
    }
    const thread = await createThreadAsPicked(server.client, deps, {
        projectId: target.projectId,
        input: [{ type: "text", text }],
        environment: target.environment,
    });
    return { threadId: thread.id, created: true };
}
/**
 * This folder's conversations, newest first — what the mascot is shown so it
 * can tell a follow-up (same chat) from a new job (a chat of its own).
 */
async function listWorkspaceThreads(cwd, deps = {}) {
    const ensureServer = deps.ensureServer ?? supervisor_1.ensureBbServer;
    const server = await ensureServer();
    const target = await projectMap(server.client).resolve(cwd);
    const threads = await server.client.listThreads(target.projectId);
    return [...threads].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}
/**
 * Post into ONE named conversation of this folder's project — a follow-up.
 *
 * `queue-if-active`, not the composer's `steer-if-active`: a follow-up the
 * mascot hands over while that chat is still working must land after the turn
 * under way, not change it halfway. A thread that is not this project's is
 * refused rather than written to, so a stale id can never post into another
 * project's conversation.
 */
async function sendToWorkspaceThread(cwd, threadId, text, deps = {}) {
    const ensureServer = deps.ensureServer ?? supervisor_1.ensureBbServer;
    const server = await ensureServer();
    await deps.ensureTools?.();
    const target = await projectMap(server.client).resolve(cwd);
    const threads = await server.client.listThreads(target.projectId);
    if (!threads.some((thread) => thread.id === threadId)) {
        throw new Error("that conversation is not in this project");
    }
    await server.client.sendMessage(threadId, [{ type: "text", text }], { mode: "queue-if-active" });
    const origin = server.client.origin;
    return { url: threadUrl(origin, target.projectId, threadId), origin, projectId: target.projectId, threadId };
}
/**
 * Start a *new* conversation in this folder's project, with one request as its
 * first message.
 *
 * The difference from `sendToWorkspace` is the whole point of this function.
 * That one posts into the conversation the panel is already framing, which is
 * right for a save: it continues the work on screen, and opening a second
 * thread would leave somebody watching an unchanged panel. A request made from
 * the board is the other thing — one job, about one layer, said once — and it
 * gets a thread of its own for two reasons:
 *
 *   - **The transcript is about that job.** A person who asks for three
 *     variations of a cover and comes back an hour later should find a
 *     conversation about the cover, not the tail of an afternoon.
 *   - **It cannot steer somebody else's turn.** `sendMessage` is
 *     `steer-if-active`, which is exactly what a composer means and exactly
 *     what a request from the board must not do: "make three variations of
 *     this" delivered into the middle of a running job changes that job.
 *
 * The URL comes back with it so the panel can frame the thread it just made
 * rather than guess at it — the newest thread is normally the one, but "the
 * newest" is a race with anything else talking to the same project.
 */
async function startWorkspaceThread(cwd, text, deps = {}) {
    const ensureServer = deps.ensureServer ?? supervisor_1.ensureBbServer;
    const server = await ensureServer();
    await deps.ensureTools?.();
    const target = await projectMap(server.client).resolve(cwd);
    const thread = await createThreadAsPicked(server.client, deps, {
        projectId: target.projectId,
        input: [{ type: "text", text }],
        environment: target.environment,
    });
    const origin = server.client.origin;
    return {
        url: threadUrl(origin, target.projectId, thread.id),
        origin,
        projectId: target.projectId,
        threadId: thread.id,
    };
}
/**
 * Create a thread on the model last picked in bb's composer.
 *
 * If bb will not take that pick — the provider has since been logged out of,
 * or its model is gone from the catalogue — the thread is made again on bb's
 * own default rather than failing: a request from the board that runs on
 * another model is a far smaller surprise than one that never runs. Only a
 * refusal (4xx) is retried; a server that is down is down either way.
 */
async function createThreadAsPicked(client, deps, args) {
    const execution = deps.modelChoice ? await deps.modelChoice().catch(() => null) : null;
    if (!execution)
        return client.createThread(args);
    try {
        // As the app, not as an SDK: bb remembers the execution of an app-made
        // thread as the PROJECT's default (`project_execution_defaults`, only for
        // origin "app"), and that default is what its composer offers for the next
        // chat in the project. Made as "sdk", a project the editor started never
        // had one, so its composer fell back to bb's server default — ChatGPT —
        // even though every request the editor sent ran on the model last picked.
        return await client.createThread({ ...args, execution, origin: "app" });
    }
    catch (err) {
        if (!(err instanceof client_1.BbApiError) || err.status < 400 || err.status >= 500)
            throw err;
        return client.createThread(args);
    }
}
/**
 * bb's own root, for a window that is only bb (agent mode).
 *
 * No project is resolved on purpose. The Agent panel's whole job is to scope a
 * conversation to the folder on the board; an agent window has no board, so
 * scoping it to a project would mean inventing one — and bb's root is already
 * the view it ships for "start a conversation, pick where it runs".
 *
 * Nothing here installs the editor's plugin either. The layer tools only mean
 * something to a window with a document in it, and a window with no board that
 * quietly handed bb a callback into an empty editor would be worse than one
 * that never offered the tools at all.
 */
async function bbAppUrl(deps = {}) {
    const ensureServer = deps.ensureServer ?? supervisor_1.ensureBbServer;
    const server = await ensureServer();
    const origin = server.client.origin;
    return { url: `${origin}/`, origin };
}
