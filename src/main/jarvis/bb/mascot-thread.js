"use strict";
/**
 * The mascot's brain, main-process half: one warm HIDDEN bb conversation per
 * project folder, streamed back to the editor a turn at a time
 * (docs/mascot.md §The brain).
 *
 * bb is the only model path in this app, and its unit of work is a thread. Two
 * measurements on bb 0.42.1 decided the shape of this module:
 *
 *  - **A new thread costs ~14 s to its first token; a warm one ~1.5 s.** The
 *    difference is the provider CLI booting. A mascot is a character the user is
 *    staring at, so a thread per utterance (ui-editor's stateless run) is not an
 *    option here: the conversation keeps ONE thread per folder, created — and
 *    its cold start paid — at `warm`, i.e. when the mascot is switched on, not
 *    when the user first speaks.
 *  - **bb prunes `item/agentMessage/delta` rows once the item completes.** The
 *    stream therefore has to be read while it happens; the completed item
 *    carries the whole text for a reader that arrives late, which is also what
 *    makes this reader tolerant of a missed wake.
 *
 * Four rules it holds:
 *
 *  1. **A message is only ever sent to an IDLE thread, with
 *     `queue-if-active`.** bb's default `steer-if-active` would deliver a new
 *     utterance INTO the turn still answering the old one — the opposite of
 *     "the newest utterance wins". So the running turn is stopped, the thread
 *     is waited to idle, and only then is the message posted. That is also
 *     what makes "the next `turn/completed` is ours" true.
 *  2. **Exactly one terminal event per turn** (`done` or `error`), on every
 *     path — completion, failure, timeout, a converted question, a stop. The
 *     renderer clears its Stop button on it.
 *  3. **A native question is converted, never awaited.** Nothing in the mascot
 *     can answer bb's question UI (the thread is hidden, and the panel window
 *     is unfocusable), so a question stops the turn and comes back as one
 *     `question` event the bubble renders as an `ask_user`.
 *  4. **Stopped means silent.** After `stop`, nothing more is emitted for that
 *     turn — a late delta from the interrupted reply landing in the bubble of
 *     the one that replaced it is the failure this whole subsystem is shaped
 *     around.
 *
 * Electron-free and dependency-injected, like client.ts, so all of it runs in
 * Vitest against a fake client.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MASCOT_REASONING_LEVEL = exports.MASCOT_ROTATE_TOKENS = exports.MASCOT_WAIT_SLICE_MS = exports.MASCOT_IDLE_WAIT_MS = exports.MASCOT_TURN_IDLE_MS = void 0;
exports.questionFromInteraction = questionFromInteraction;
exports.isApproval = isApproval;
exports.toolFromItem = toolFromItem;
exports.createMascotThreads = createMascotThreads;
const model_choice_1 = require("./model-choice");
/** How long creating a thread may take: the first one on a bb that has just
 *  started is slow (Tellaflow measured 10 s+ in a cold container). */
const THREAD_CREATE_TIMEOUT_MS = 90_000;
/** No event of any kind for this long ends the turn as a timeout. An
 *  INACTIVITY window, so a long tool loop that keeps emitting is never cut. */
exports.MASCOT_TURN_IDLE_MS = 45_000;
/** How long a turn waits for the previous one to reach idle after a stop. */
exports.MASCOT_IDLE_WAIT_MS = 10_000;
/** Long-poll slice. Deltas wake it at once; anything else is seen within it. */
exports.MASCOT_WAIT_SLICE_MS = 250;
/** Past this the thread is archived after the turn and the next one starts
 *  fresh (re-seeded from the renderer's transcript). The mascot's context is
 *  per-turn state plus a short conversation, so a thread this full is carrying
 *  mostly stale boards. */
exports.MASCOT_ROTATE_TOKENS = 150_000;
/** Replies are two sentences and an action block; deep reasoning only buys
 *  silence in front of a character. The user's provider and model are kept. */
exports.MASCOT_REASONING_LEVEL = "low";
const WARM_SUFFIX = "\n\nReply with exactly one word: ready";
/** Statuses bb gives an interaction that is still waiting on somebody. */
const SETTLED_INTERACTION = new Set(["resolved", "answered", "cancelled", "canceled", "expired", "completed", "rejected", "denied"]);
function str(v) {
    return typeof v === "string" && v.trim() ? v : null;
}
function rec(v) {
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}
/**
 * The question inside a bb interaction payload, if it is one. bb's payload
 * shape varies by provider; this reads the spellings the providers use and
 * falls back to a generic line rather than dropping the question — an ask the
 * user cannot see is a turn that looks hung.
 */
function questionFromInteraction(data) {
    const interaction = rec(data.interaction) ?? data;
    const status = str(interaction.status)?.toLowerCase();
    if (status && SETTLED_INTERACTION.has(status))
        return null;
    const payload = rec(interaction.payload) ?? {};
    const kind = str(payload.kind) ?? str(payload.type) ?? str(interaction.kind);
    if (kind && /approval|permission/i.test(kind))
        return null;
    const questions = Array.isArray(payload.questions) ? payload.questions : null;
    const first = rec(questions?.[0]) ?? payload;
    const question = str(first.question) ?? str(first.prompt) ?? str(first.text) ?? str(first.header);
    const rawOptions = Array.isArray(first.options) ? first.options : [];
    const options = rawOptions
        .map((o) => str(rec(o)?.label) ?? str(o))
        .filter((o) => !!o)
        .slice(0, 4);
    if (!question && !options.length)
        return { question: "I have a question — could you say a bit more?", options: [] };
    return { question: question ?? "Which one?", options };
}
/** Whether an interaction asks for a permission nobody here can grant. */
function isApproval(data) {
    const interaction = rec(data.interaction) ?? data;
    const status = str(interaction.status)?.toLowerCase();
    if (status && SETTLED_INTERACTION.has(status))
        return false;
    const payload = rec(interaction.payload) ?? {};
    const kind = str(payload.kind) ?? str(payload.type) ?? str(interaction.kind);
    return !!kind && /approval|permission/i.test(kind);
}
/** A chip-worthy tool item: what the mascot is doing while it is quiet. */
function toolFromItem(item) {
    switch (item.type) {
        case "toolCall":
            return { name: str(item.tool) ?? "tool", input: item.arguments };
        case "commandExecution":
            return { name: "Bash", input: { command: item.command } };
        case "fileChange": {
            const change = rec(Array.isArray(item.changes) ? item.changes[0] : null);
            return { name: "Edit", input: { file_path: str(change?.path) ?? "" } };
        }
        case "fileRead":
            return { name: "Read", input: { file_path: str(item.path) ?? "" } };
        case "search":
        case "webSearch":
            return { name: "Search", input: { query: str(item.query) ?? "" } };
        default:
            return null;
    }
}
function createMascotThreads(deps) {
    const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const now = deps.now ?? Date.now;
    const log = deps.log ?? (() => { });
    const threads = new Map();
    let active = null;
    const folder = (cwd) => cwd || deps.fallbackCwd();
    async function waitIdle(client, threadId, limitMs) {
        const until = now() + limitMs;
        while (now() < until) {
            const status = await client.threadStatus(threadId).catch(() => null);
            if (status === "idle" || status === "error" || status === null)
                return;
            await sleep(150);
        }
    }
    async function createThread(client, cwd, text) {
        await deps.ensureTools?.();
        const target = await deps.resolve(cwd);
        const input = [{ type: "text", text }];
        const base = { projectId: target.projectId, input, environment: target.environment, visibility: "hidden" };
        const pick = deps.modelChoice ? await deps.modelChoice().catch(() => null) : null;
        // A refused attempt falls through to the next, the same tolerance
        // startWorkspaceThread has (see executionAttempts for the order and why).
        const attempts = await (0, model_choice_1.executionAttempts)(client, pick, exports.MASCOT_REASONING_LEVEL);
        let lastError = null;
        for (const attempt of attempts) {
            try {
                // Tellaflow: a cold bb takes well over the client's default 10 s
                // to make its first thread (it resolves the provider's
                // environment first). Aborting it there fell through to "bb
                // default" — a provider the user may not have — while the
                // abandoned create kept provisioning and failed the next turn.
                const id = (await client.createThread({ ...base, ...(attempt ? { execution: attempt } : {}), timeoutMs: THREAD_CREATE_TIMEOUT_MS })).id;
                // Said once per thread: which model the mascot is really talking on is
                // the first question when it answers slowly or oddly.
                log("mascot thread created", { threadId: id, provider: attempt?.providerId ?? "bb default", model: attempt?.model ?? null });
                return id;
            }
            catch (err) {
                log("mascot thread refused", { provider: attempt?.providerId ?? "bb default", error: err instanceof Error ? err.message : String(err) });
                lastError = err;
            }
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
    /**
     * Warms in flight, by folder. A warm is registered HERE, synchronously,
     * before its thread exists — because creating one takes seconds (6.4 s
     * measured) and the user's first sentence routinely lands inside that window.
     * Without this the turn saw no thread, made a SECOND one in the same folder
     * at the same moment, and bb failed provisioning both ("Provisioning thread
     * failed" in the desktop suite). A turn now waits for the warm instead.
     */
    const warming = new Map();
    function warm(cwd, standing) {
        const key = folder(cwd);
        if (threads.has(key) || warming.has(key))
            return Promise.resolve({ ok: true });
        let result = { ok: true };
        const job = (async () => {
            try {
                const client = await deps.client();
                const threadId = await createThread(client, key, standing + WARM_SUFFIX);
                const record = { threadId, usedTokens: 0, ready: Promise.resolve() };
                // The warm-up turn has to finish before a real message is posted, or the
                // user's first sentence would queue behind "ready" — or, worse, be read
                // as part of the same turn.
                record.ready = waitIdle(client, threadId, 120_000).catch(() => { });
                threads.set(key, record);
                log("warmed", { cwd: key, threadId });
            }
            catch (err) {
                result = { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
            finally {
                warming.delete(key);
            }
        })();
        warming.set(key, job);
        return job.then(() => result);
    }
    function emit(turn, event) {
        // Rule 4: a stopped turn is silent, whatever is still in flight for it.
        if (turn.stopped || active !== turn)
            return;
        try {
            deps.emit(event);
        }
        catch (err) {
            log("emit threw", String(err));
        }
    }
    async function stop(turnId) {
        const turn = active;
        if (!turn || (turnId && turn.turnId !== turnId))
            return;
        turn.stopped = true;
        active = null;
        if (turn.threadId) {
            const client = await deps.client().catch(() => null);
            await client?.stopThread(turn.threadId).catch(() => { });
        }
    }
    async function turn(req) {
        // Rule 1, first half: the newest utterance wins, and the old turn is
        // stopped before anything of the new one is sent.
        await stop();
        const me = { turnId: req.turnId, threadId: null, stopped: false };
        active = me;
        const terminal = (event) => {
            emit(me, event);
            if (active === me)
                active = null;
        };
        let client;
        try {
            client = await deps.client();
        }
        catch (err) {
            terminal({ turnId: req.turnId, kind: "error", message: `The assistant isn't running: ${err instanceof Error ? err.message : String(err)}` });
            return;
        }
        const key = folder(req.cwd);
        // A warm for this folder still making its thread: wait for it rather than
        // race it with a second one (see `warming`). A failed warm leaves no
        // record, and this turn then makes the thread itself.
        const pendingWarm = warming.get(key);
        if (pendingWarm) {
            emit(me, { turnId: req.turnId, kind: "waking" });
            await pendingWarm;
            if (me.stopped)
                return;
        }
        let record = threads.get(key);
        let afterSeq = 0;
        try {
            if (!record) {
                if (!pendingWarm)
                    emit(me, { turnId: req.turnId, kind: "waking" });
                // A thread this turn is making counts as a warm in flight
                // (Tellaflow): a warm that lands while it is being made —
                // the app's startup warm under a first command — waits for it
                // instead of making a second thread in the same folder, which
                // bb then refuses ("409: Environment unavailable").
                const creating = createThread(client, key, `${req.standing}\n\n${req.prompt}`);
                const marker = creating.then(() => { }, () => { });
                warming.set(key, marker);
                let threadId;
                try {
                    threadId = await creating;
                }
                finally {
                    if (warming.get(key) === marker)
                        warming.delete(key);
                }
                record = { threadId, usedTokens: 0, ready: Promise.resolve() };
                threads.set(key, record);
                me.threadId = threadId;
            }
            else {
                me.threadId = record.threadId;
                await record.ready;
                if (me.stopped)
                    return;
                // Rule 1, second half: whatever turn was running (the one just stopped,
                // or a warm-up) has to be over before this message goes in.
                await waitIdle(client, record.threadId, exports.MASCOT_IDLE_WAIT_MS);
                if (me.stopped)
                    return;
                afterSeq = await client.latestEventSeq(record.threadId);
                await client.sendMessage(record.threadId, [{ type: "text", text: req.prompt }], {
                    mode: "queue-if-active",
                    reasoningLevel: exports.MASCOT_REASONING_LEVEL,
                });
            }
        }
        catch (err) {
            // A thread bb no longer knows (archived, a data dir reset) is forgotten so
            // the next turn makes a fresh one instead of failing forever.
            if (record)
                threads.delete(key);
            terminal({ turnId: req.turnId, kind: "error", message: err instanceof Error ? err.message : String(err) });
            return;
        }
        if (me.stopped)
            return;
        const threadId = me.threadId;
        const items = new Map();
        const order = [];
        let lastText = "";
        let lastActivity = now();
        const textNow = () => order.map((id) => items.get(id) ?? "").filter(Boolean).join("\n\n");
        const pushText = () => {
            const text = textNow();
            if (text !== lastText) {
                lastText = text;
                emit(me, { turnId: req.turnId, kind: "text", text });
            }
        };
        while (!me.stopped) {
            if (now() - lastActivity > exports.MASCOT_TURN_IDLE_MS) {
                await client.stopThread(threadId).catch(() => { });
                terminal({ turnId: req.turnId, kind: "error", message: "I took too long to answer, so I stopped." });
                return;
            }
            let events;
            try {
                await client.waitForEvent(threadId, "item/agentMessage/delta", afterSeq, exports.MASCOT_WAIT_SLICE_MS).catch(() => false);
                if (me.stopped)
                    return;
                events = await client.threadEvents(threadId, afterSeq);
            }
            catch (err) {
                terminal({ turnId: req.turnId, kind: "error", message: err instanceof Error ? err.message : String(err) });
                return;
            }
            if (me.stopped)
                return;
            for (const event of events) {
                afterSeq = Math.max(afterSeq, event.seq);
                lastActivity = now();
                const data = event.data;
                switch (event.type) {
                    case "item/started": {
                        const item = rec(data.item);
                        if (!item)
                            break;
                        if (item.type === "agentMessage" && typeof item.id === "string") {
                            if (!items.has(item.id))
                                order.push(item.id);
                            items.set(item.id, typeof item.text === "string" ? item.text : "");
                        }
                        else {
                            const tool = toolFromItem(item);
                            if (tool)
                                emit(me, { turnId: req.turnId, kind: "tool", ...tool });
                        }
                        break;
                    }
                    case "item/agentMessage/delta": {
                        const id = str(data.itemId);
                        const delta = typeof data.delta === "string" ? data.delta : "";
                        if (!id)
                            break;
                        if (!items.has(id))
                            order.push(id);
                        items.set(id, (items.get(id) ?? "") + delta);
                        pushText();
                        break;
                    }
                    case "item/completed": {
                        const item = rec(data.item);
                        if (item?.type === "agentMessage" && typeof item.id === "string" && typeof item.text === "string") {
                            if (!items.has(item.id))
                                order.push(item.id);
                            items.set(item.id, item.text);
                            pushText();
                        }
                        break;
                    }
                    case "thread/contextWindowUsage/updated": {
                        const used = rec(data.contextWindowUsage)?.usedTokens;
                        if (typeof used === "number" && record)
                            record.usedTokens = used;
                        break;
                    }
                    case "system/interaction/lifecycle":
                    case "system/userQuestion/lifecycle": {
                        if (isApproval(data)) {
                            await client.stopThread(threadId).catch(() => { });
                            terminal({ turnId: req.turnId, kind: "error", message: "That needs a permission I can't give from here — try it in the Agent panel." });
                            return;
                        }
                        const q = questionFromInteraction(data);
                        if (q) {
                            // Rule 3: converted, never awaited.
                            await client.stopThread(threadId).catch(() => { });
                            pushText();
                            emit(me, { turnId: req.turnId, kind: "question", ...q });
                            terminal({ turnId: req.turnId, kind: "done", text: lastText });
                            return;
                        }
                        break;
                    }
                    case "system/error": {
                        const message = str(data.message) ?? str(rec(data.error)?.message) ?? "The assistant hit an error.";
                        terminal({ turnId: req.turnId, kind: "error", message });
                        return;
                    }
                    case "turn/completed": {
                        const status = str(data.status);
                        pushText();
                        if (status && status !== "completed" && !lastText) {
                            terminal({ turnId: req.turnId, kind: "error", message: str(rec(data.error)?.message) ?? `The turn ended: ${status}` });
                        }
                        else {
                            terminal({ turnId: req.turnId, kind: "done", text: lastText });
                        }
                        if (record && record.usedTokens > exports.MASCOT_ROTATE_TOKENS) {
                            threads.delete(key);
                            void client.archiveThread(threadId).catch(() => { });
                            log("rotated", { cwd: key, threadId, usedTokens: record.usedTokens });
                        }
                        return;
                    }
                    default:
                        break;
                }
                if (me.stopped)
                    return;
            }
        }
    }
    async function reset(cwd) {
        await stop();
        const keys = cwd === undefined ? [...threads.keys()] : [folder(cwd)];
        const client = await deps.client().catch(() => null);
        for (const key of keys) {
            const record = threads.get(key);
            threads.delete(key);
            if (record && client) {
                await client.stopThread(record.threadId).catch(() => { });
                await client.archiveThread(record.threadId).catch(() => { });
            }
        }
    }
    return { warm, turn, stop, reset };
}
