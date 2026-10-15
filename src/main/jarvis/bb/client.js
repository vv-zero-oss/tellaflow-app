"use strict";
/**
 * The bit of bb's HTTP API the editor actually speaks.
 *
 * bb's own SDK is workspace-only and never published, so this is hand-rolled
 * over `fetch` against `http://127.0.0.1:<port>/api/v1`. Every route and body
 * here was read off bb-app 0.42.1 rather than guessed:
 * `packages/server-contract/src/public-api.ts` for the route table,
 * `apps/server/src/routes/plugins.ts` for the two plugin calls.
 *
 * Deliberately Electron-free and `fetch`-injectable, so the whole surface is
 * drivable from Vitest without a server.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BbClient = exports.BbApiError = exports.BB_THREAD_STATUSES = void 0;
exports.isHostConnected = isHostConnected;
function isHostConnected(host) {
    return host.status === "connected";
}
/** bb's `threadStatusValues`. `idle` and `error` are a turn that has ended. */
exports.BB_THREAD_STATUSES = [
    "pending",
    "idle",
    "starting",
    "active",
    "stopping",
    "error",
];
/**
 * bb said no. Carries the status and bb's own error envelope so a caller can
 * tell "already installed" (422) from "the server is broken" (500) without
 * parsing message text.
 */
class BbApiError extends Error {
    status;
    url;
    constructor(args) {
        // "Agent backend", not "bb": these messages reach the editor, and bb is an
        // implementation detail nobody chose. Identifiers and docs still name it.
        super(`Agent backend ${args.status}: ${args.message}`);
        this.name = "BbApiError";
        this.status = args.status;
        this.url = args.url;
    }
}
exports.BbApiError = BbApiError;
const DEFAULT_TIMEOUT_MS = 10_000;
/** bb gives each skills.sh fetch ten seconds and may make two (the API, then
 *  the public directory), so a registry page gets more room than a local call. */
const REGISTRY_TIMEOUT_MS = 25_000;
const INSTALL_TIMEOUT_MS = 130_000;
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
}
/** bb answers an error as `{error}` on the plugin routes and `{code,message}`
 *  on the rest; take whichever is there and fall back to the raw body, which is
 *  what a proxy or a crashed handler returns. */
function errorMessage(status, body) {
    try {
        const rec = asRecord(JSON.parse(body));
        if (rec) {
            if (typeof rec.error === "string")
                return rec.error;
            if (typeof rec.message === "string")
                return rec.message;
        }
    }
    catch {
        // Not JSON. The body itself is the most useful thing we have.
    }
    return body.trim() || `HTTP ${status}`;
}
/** Lenient inbound: bb adds fields to these rows over time, and an unknown one
 *  must never sink a list the panel needs. Only what this app reads is
 *  required. */
function parseProject(value) {
    const rec = asRecord(value);
    if (!rec || typeof rec.id !== "string")
        return null;
    const sources = Array.isArray(rec.sources)
        ? rec.sources.flatMap((entry) => {
            const source = asRecord(entry);
            return source &&
                typeof source.path === "string" &&
                typeof source.hostId === "string"
                ? [{ hostId: source.hostId, path: source.path }]
                : [];
        })
        : [];
    return {
        id: rec.id,
        name: typeof rec.name === "string" ? rec.name : rec.id,
        sources,
    };
}
function parseThreadEvent(value) {
    const rec = asRecord(value);
    if (!rec || typeof rec.seq !== "number" || typeof rec.type !== "string")
        return null;
    return { seq: rec.seq, type: rec.type, data: asRecord(rec.data) ?? {} };
}
function parseThread(value) {
    const rec = asRecord(value);
    if (!rec || typeof rec.id !== "string")
        return null;
    return {
        id: rec.id,
        title: typeof rec.title === "string" ? rec.title : null,
        createdAt: typeof rec.createdAt === "number" ? rec.createdAt : 0,
    };
}
function parseSkill(value) {
    const rec = asRecord(value);
    if (!rec || typeof rec.id !== "string" || typeof rec.name !== "string")
        return null;
    return {
        id: rec.id,
        name: rec.name,
        description: typeof rec.description === "string" ? rec.description : null,
        scope: typeof rec.scope === "string" ? rec.scope : "unknown",
        manageable: rec.manageable === true,
        registrySkillId: typeof rec.registrySkillId === "string" ? rec.registrySkillId : null,
    };
}
function parseRegistrySkill(value) {
    const rec = asRecord(value);
    if (!rec ||
        typeof rec.id !== "string" ||
        typeof rec.source !== "string" ||
        typeof rec.skillId !== "string" ||
        typeof rec.name !== "string") {
        return null;
    }
    return {
        id: rec.id,
        source: rec.source,
        skillId: rec.skillId,
        name: rec.name,
        installs: typeof rec.installs === "number" ? rec.installs : 0,
        url: typeof rec.url === "string" ? rec.url : `https://www.skills.sh/${rec.id}`,
        summary: typeof rec.summary === "string" ? rec.summary : null,
    };
}
function parseTerminal(value) {
    const rec = asRecord(value);
    const id = rec && typeof rec.id === "string" ? rec.id : null;
    const status = rec?.status;
    if (!id ||
        (status !== "starting" && status !== "disconnected" && status !== "running" && status !== "exited")) {
        throw new Error("agent backend returned a malformed terminal");
    }
    return { id, status, exitCode: typeof rec?.exitCode === "number" ? rec.exitCode : null };
}
class BbClient {
    origin;
    baseUrl;
    fetchImpl;
    constructor(options) {
        this.origin = `http://127.0.0.1:${options.port}`;
        this.baseUrl = `${this.origin}/api/v1`;
        this.fetchImpl = options.fetchImpl ?? fetch;
    }
    async request(method, url, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        timer.unref?.();
        let response;
        try {
            response = await this.fetchImpl(url, {
                method,
                // A JSON content-type is not decoration on the plugin routes: bb's
                // "local" auth requires it for a mutation, which is what stops a page
                // in a browser from forging one.
                headers: body === undefined ? {} : { "content-type": "application/json" },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                signal: controller.signal,
            });
        }
        finally {
            clearTimeout(timer);
        }
        const text = await response.text();
        if (!response.ok) {
            throw new BbApiError({
                status: response.status,
                message: errorMessage(response.status, text),
                url,
            });
        }
        if (!text)
            return null;
        try {
            return JSON.parse(text);
        }
        catch {
            return text;
        }
    }
    /** `GET /health`, off the API prefix. Answers before the host daemon has
     *  enrolled, which is why it is one of three probes and not the gate. */
    async health(timeoutMs) {
        try {
            await this.request("GET", `${this.origin}/health`, undefined, timeoutMs);
            return true;
        }
        catch {
            return false;
        }
    }
    /** `GET /api/v1/system/config`. Read as an opaque record: we only need it to
     *  prove the server finished booting, since answering it reads config and the
     *  database. */
    async systemConfig(timeoutMs) {
        const value = await this.request("GET", `${this.baseUrl}/system/config`, undefined, timeoutMs);
        const rec = asRecord(value);
        if (!rec)
            throw new Error("agent backend returned a malformed system config");
        return rec;
    }
    /** `GET /api/v1/system/providers/state`: each provider CLI's health, with
     *  the command that signs it in. Opaque here; bb-login.ts reads it. A health
     *  check runs the CLI on the host, hence the longer wait. */
    async providerStates(timeoutMs = 20_000) {
        return this.request("GET", `${this.baseUrl}/system/providers/state`, undefined, timeoutMs);
    }
    /** `GET /api/v1/system/providers`: the providers bb offers, already in the
     *  order its Settings › Providers list shows them. Opaque here;
     *  provider-choice.ts reads it. */
    async providers(timeoutMs = 20_000) {
        return this.request("GET", `${this.baseUrl}/system/providers`, undefined, timeoutMs);
    }
    /** A provider's logo, at the `logoUrl` path `providers()` answered, as its
     *  text. bb's logos are SVG; the caller checks before trusting that. */
    async providerLogo(logoPath, timeoutMs) {
        const value = await this.request("GET", new URL(logoPath, this.origin).toString(), undefined, timeoutMs);
        return typeof value === "string" ? value : "";
    }
    /** `PUT /api/v1/settings/general`. bb's schema is strict and whole — every
     *  field, no partial update — so the caller sends back the `generalSettings`
     *  it read from `systemConfig` with its one change. */
    async putGeneralSettings(settings) {
        return this.request("PUT", `${this.baseUrl}/settings/general`, settings);
    }
    /** `GET /api/v1/hosts`. Rows bb cannot parse are dropped rather than thrown
     *  over: one unknown host must not hide the connected one beside it. */
    async hosts(timeoutMs) {
        const value = await this.request("GET", `${this.baseUrl}/hosts`, undefined, timeoutMs);
        if (!Array.isArray(value)) {
            throw new Error("agent backend returned a malformed host list");
        }
        return value.flatMap((entry) => {
            const rec = asRecord(entry);
            const id = rec && typeof rec.id === "string" ? rec.id : null;
            const status = rec && (rec.status === "connected" || rec.status === "disconnected")
                ? rec.status
                : null;
            if (!id || !status)
                return [];
            const name = rec && typeof rec.name === "string" ? rec.name : id;
            return [{ id, name, status }];
        });
    }
    // ─────────────────────────── projects ───────────────────────────
    /** `GET /api/v1/projects`. Rows bb answers with that this build cannot read
     *  are dropped rather than thrown over: one unfamiliar project must not hide
     *  the folder the editor has open. */
    async projects() {
        const value = await this.request("GET", `${this.baseUrl}/projects`);
        if (!Array.isArray(value)) {
            throw new Error("agent backend returned a malformed project list");
        }
        return value.flatMap((entry) => {
            const project = parseProject(entry);
            return project ? [project] : [];
        });
    }
    /**
     * `POST /api/v1/projects` → 201.
     *
     * The wire body is `{name, source:{hostId, type:"local_path", path}}`, whose
     * `source` arm is strict. The caller has a flat `{name, root, hostId}`, which
     * is what it knows, so the nesting is assembled here.
     */
    async createProject(args) {
        const value = await this.request("POST", `${this.baseUrl}/projects`, {
            name: args.name,
            source: { hostId: args.hostId, type: "local_path", path: args.root },
        });
        const project = parseProject(value);
        if (!project)
            throw new Error("agent backend returned a malformed project");
        return project;
    }
    // ─────────────────────────── threads ───────────────────────────
    /** `GET /api/v1/threads?projectId=…`. An unreadable list is an empty one:
     *  the panel then frames bb's compose view, which still works. */
    async listThreads(projectId) {
        const value = await this.request("GET", `${this.baseUrl}/threads?projectId=${encodeURIComponent(projectId)}&archived=false`);
        const rows = Array.isArray(value)
            ? value
            : Array.isArray(asRecord(value)?.threads)
                ? asRecord(value).threads
                : [];
        return rows.flatMap((entry) => {
            const thread = parseThread(entry);
            return thread ? [thread] : [];
        });
    }
    /**
     * `GET /api/v1/threads/:id` → the thread's `status`.
     *
     * What tells a save that the assistant's turn is over: `bb:send` resolves
     * when the message is posted, and this is the one place bb says whether the
     * turn it started is still running. Anything this build does not recognise
     * is answered as null rather than guessed at.
     */
    async threadStatus(threadId) {
        const value = await this.request("GET", `${this.baseUrl}/threads/${encodeURIComponent(threadId)}`);
        const status = asRecord(value)?.status;
        return typeof status === "string" && exports.BB_THREAD_STATUSES.includes(status)
            ? status
            : null;
    }
    /** `POST /api/v1/threads` → 201. `origin` is required; "sdk" is what a
     *  programmatic sender is. With no `execution`, bb picks the provider
     *  itself — see model-choice.ts for why the editor names one. */
    async createThread(args) {
        const execution = args.execution;
        const value = await this.request("POST", `${this.baseUrl}/threads`, {
            projectId: args.projectId,
            origin: args.origin ?? "sdk",
            input: args.input,
            environment: args.environment,
            ...(args.visibility ? { visibility: args.visibility } : {}),
            ...(execution ? { providerId: execution.providerId } : {}),
            ...(execution?.model ? { model: execution.model } : {}),
            ...(execution?.reasoningLevel ? { reasoningLevel: execution.reasoningLevel } : {}),
        }, args.timeoutMs);
        const thread = parseThread(value);
        if (!thread)
            throw new Error("agent backend returned a malformed thread");
        return thread;
    }
    /**
     * `POST /api/v1/threads/:id/send`.
     *
     * `steer-if-active` is what a composer means: deliver into a running turn if
     * there is one, otherwise start one.
     */
    async sendMessage(threadId, input, options = {}) {
        await this.request("POST", `${this.baseUrl}/threads/${encodeURIComponent(threadId)}/send`, {
            input,
            mode: options.mode ?? "steer-if-active",
            ...(options.reasoningLevel ? { reasoningLevel: options.reasoningLevel } : {}),
        });
    }
    /**
     * `GET /api/v1/threads/:id/events?afterSeq=…&order=asc`.
     *
     * The thread's event log, oldest first. bb PRUNES `item/agentMessage/delta`
     * rows once their `item/completed` lands (measured on 0.42.1: seqs 9–11 of a
     * finished reply were gone), so a reader that wants the stream has to be
     * reading while it happens; the completed item carries the whole text for
     * anyone who arrives late.
     */
    async threadEvents(threadId, afterSeq, limit = 500) {
        const value = await this.request("GET", `${this.baseUrl}/threads/${encodeURIComponent(threadId)}/events?afterSeq=${Math.max(0, Math.floor(afterSeq))}&limit=${limit}&order=asc`);
        const rows = Array.isArray(value) ? value : [];
        return rows.flatMap((entry) => {
            const event = parseThreadEvent(entry);
            return event ? [event] : [];
        });
    }
    /** The newest event's `seq`, or 0 for an empty log — where a reader starts
     *  so it sees only what a message it is about to send produces. */
    async latestEventSeq(threadId) {
        const value = await this.request("GET", `${this.baseUrl}/threads/${encodeURIComponent(threadId)}/events?limit=1&order=desc`);
        const first = Array.isArray(value) ? parseThreadEvent(value[0]) : null;
        return first?.seq ?? 0;
    }
    /**
     * `GET /api/v1/threads/:id/events/wait?type=…&afterSeq=…&waitMs=…` — a long
     * poll that returns as soon as an event of `type` lands after `afterSeq`
     * (200) or when `waitMs` runs out (204). bb takes exactly ONE type here, so
     * a reader waits on the one it is latency-sensitive to and re-reads the whole
     * log on every wake. Answers whether something arrived; never throws for a
     * plain timeout.
     */
    async waitForEvent(threadId, type, afterSeq, waitMs) {
        const value = await this.request("GET", `${this.baseUrl}/threads/${encodeURIComponent(threadId)}/events/wait?type=${encodeURIComponent(type)}&afterSeq=${Math.max(0, Math.floor(afterSeq))}&waitMs=${Math.max(0, Math.floor(waitMs))}`, undefined, waitMs + DEFAULT_TIMEOUT_MS);
        return value !== null;
    }
    /** `POST /api/v1/threads/:id/stop` — interrupts the running turn. bb answers
     *  `{ok:true}` at once and reaches `idle` a moment later. */
    async stopThread(threadId) {
        await this.request("POST", `${this.baseUrl}/threads/${encodeURIComponent(threadId)}/stop`, {});
    }
    /** `POST /api/v1/threads/:id/archive`. What bb's own docs ask of anything that
     *  makes worker threads: put them away once they are done with. */
    async archiveThread(threadId) {
        await this.request("POST", `${this.baseUrl}/threads/${encodeURIComponent(threadId)}/archive`, {});
    }
    /**
     * `GET /api/v1/system/providers/state` — which providers are installed and
     * signed in on this machine. `ready` is the only status that can run a turn;
     * bb's own default provider need not be one of them (it chose Codex on a
     * machine with only Claude Code, and answered 503 to every thread).
     */
    async readyProviders() {
        const value = await this.request("GET", `${this.baseUrl}/system/providers/state`);
        const rows = asRecord(value)?.providers;
        return Array.isArray(rows)
            ? rows.flatMap((row) => {
                const rec = asRecord(row);
                return rec && rec.status === "ready" && typeof rec.providerId === "string" ? [rec.providerId] : [];
            })
            : [];
    }
    /** `GET /api/v1/threads/:id/output` — the latest final assistant text, or
     *  null when the thread has none yet. */
    async threadOutput(threadId) {
        const value = await this.request("GET", `${this.baseUrl}/threads/${encodeURIComponent(threadId)}/output`);
        const output = asRecord(value)?.output;
        return typeof output === "string" ? output : null;
    }
    // ─────────────────────────── plugins ───────────────────────────
    /**
     * `POST /api/v1/plugins/install` `{source}`.
     *
     * bb answers `{ok:false, error}` with a 422 for a plugin it refuses — most
     * often one already registered from this same path, which is success as far
     * as the editor is concerned. The caller decides that; this only reports it.
     */
    async installPlugin(source) {
        const url = `${this.baseUrl}/plugins/install`;
        const value = await this.request("POST", url, { source });
        const rec = asRecord(value);
        if (rec && rec.ok === false) {
            throw new BbApiError({
                status: 422,
                message: typeof rec.error === "string" ? rec.error : "plugin install failed",
                url,
            });
        }
        return rec ? (asRecord(rec.plugin) ?? rec) : null;
    }
    /**
     * `POST /api/v1/plugins/reload?id=<pluginId>`.
     *
     * Restarts a plugin's host, which is the only way code on disk becomes code
     * bb is running: the plugin is registered by path once and never read again,
     * so a `git pull` leaves an editor talking to the version installed months
     * ago — with the tools, the schemas and the instructions of that version.
     *
     * Everything the plugin holds in memory goes with the restart, the editor's
     * callback included. That is the caller's problem to sequence: the config
     * POST has to come after.
     */
    async reloadPlugin(pluginId) {
        const url = `${this.baseUrl}/plugins/reload?id=${encodeURIComponent(pluginId)}`;
        const value = await this.request("POST", url, {});
        const rec = asRecord(value);
        if (rec && rec.ok === false) {
            throw new BbApiError({
                status: 422,
                message: typeof rec.error === "string" ? rec.error : "plugin reload failed",
                url,
            });
        }
        return rec;
    }
    /** One row of `GET /api/v1/plugins`, reduced to what the editor decides on. */
    async listPlugins() {
        const value = await this.request("GET", `${this.baseUrl}/plugins`);
        const rows = Array.isArray(value)
            ? value
            : Array.isArray(asRecord(value)?.plugins)
                ? asRecord(value).plugins
                : [];
        return rows.flatMap((entry) => {
            const rec = asRecord(entry);
            if (!rec || typeof rec.id !== "string")
                return [];
            return [
                {
                    id: rec.id,
                    source: typeof rec.source === "string" ? rec.source : "",
                    rootDir: typeof rec.rootDir === "string" ? rec.rootDir : "",
                    provenance: typeof rec.provenance === "string" ? rec.provenance : "",
                },
            ];
        });
    }
    /**
     * `DELETE /api/v1/plugins/:id`.
     *
     * Unloads the plugin's host and forgets its registration, settings and
     * secrets. bb refuses it for a built-in (409), and the editor only ever asks
     * it of a record that points at the editor's own plugin folder — see
     * `evictShadowingPlugins` in canvas-tools.ts for the one case that needs it.
     */
    async removePlugin(pluginId) {
        const url = `${this.baseUrl}/plugins/${encodeURIComponent(pluginId)}`;
        const value = await this.request("DELETE", url);
        const rec = asRecord(value);
        if (rec && rec.ok === false) {
            throw new BbApiError({
                status: 422,
                message: typeof rec.error === "string" ? rec.error : "plugin remove failed",
                url,
            });
        }
    }
    /** `GET /api/v1/plugins/:id/settings` → the plugin's current values. bb
     *  answers 404 until the plugin's factory has run. */
    async pluginSettings(pluginId) {
        const value = await this.request("GET", `${this.baseUrl}/plugins/${encodeURIComponent(pluginId)}/settings`);
        return asRecord(asRecord(value)?.values) ?? {};
    }
    /** `PUT /api/v1/plugins/:id/settings` `{values}` — a partial update, which bb
     *  validates against the plugin's schema (400 with the reason) and hands to
     *  the running plugin. */
    async putPluginSettings(pluginId, values) {
        await this.request("PUT", `${this.baseUrl}/plugins/${encodeURIComponent(pluginId)}/settings`, { values });
    }
    // ─────────────────────────── skills ───────────────────────────
    /**
     * `GET /api/v1/projects/:id/skills?environmentId=`.
     *
     * Every skill bb would load for that project's workspace — builtin, user,
     * provider and plugin alike. `environmentId` is required-but-nullable on the
     * wire, which a query string can only say as an empty value.
     */
    async projectSkills(projectId) {
        const value = await this.request("GET", `${this.baseUrl}/projects/${encodeURIComponent(projectId)}/skills?environmentId=`);
        const rows = asRecord(value)?.skills;
        if (!Array.isArray(rows)) {
            throw new Error("agent backend returned a malformed skill list");
        }
        return rows.flatMap((entry) => {
            const skill = parseSkill(entry);
            return skill ? [skill] : [];
        });
    }
    /** `DELETE /api/v1/projects/:id/skills` `{skillId, environmentId}`. bb
     *  refuses (403) anything it did not install itself — bundled and plugin
     *  skills are not the user's to remove. */
    async deleteSkill(projectId, skillId) {
        await this.request("DELETE", `${this.baseUrl}/projects/${encodeURIComponent(projectId)}/skills`, { skillId, environmentId: null });
    }
    /**
     * `GET /api/v1/skills-registry?q=&page=&perPage=`.
     *
     * bb's proxy onto skills.sh: trending with no query, all-time installs with
     * one. Server-wide, so no project is named.
     */
    async searchSkillsRegistry(args) {
        const params = new URLSearchParams({
            q: args.query,
            page: String(args.page),
            perPage: String(args.perPage),
        });
        const value = await this.request("GET", `${this.baseUrl}/skills-registry?${params.toString()}`, undefined, REGISTRY_TIMEOUT_MS);
        const rec = asRecord(value);
        if (!rec || !Array.isArray(rec.skills)) {
            throw new Error("agent backend returned a malformed registry page");
        }
        const pagination = asRecord(rec.pagination);
        return {
            skills: rec.skills.flatMap((entry) => {
                const skill = parseRegistrySkill(entry);
                return skill ? [skill] : [];
            }),
            hasMore: pagination?.hasMore === true,
            total: typeof pagination?.total === "number" ? pagination.total : rec.skills.length,
        };
    }
    /**
     * `POST /api/v1/skills-registry/entries` `{ids}`.
     *
     * The same rows as a search, but read off each skill's own page, which is the
     * only place skills.sh carries a summary. bb drops ids it cannot resolve
     * rather than failing the batch.
     */
    async registryEntries(ids) {
        const value = await this.request("POST", `${this.baseUrl}/skills-registry/entries`, { ids }, REGISTRY_TIMEOUT_MS);
        const rows = asRecord(value)?.entries;
        return Array.isArray(rows)
            ? rows.flatMap((entry) => {
                const skill = parseRegistrySkill(entry);
                return skill ? [skill] : [];
            })
            : [];
    }
    /**
     * `POST /api/v1/skills-registry/install` `{registrySkillId}`.
     *
     * bb runs the `skills` CLI under `npx` to fetch the package, validates the
     * SKILL.md against the registry entry and moves it into `<dataDir>/skills`.
     * Its own ceiling on that is two minutes, so ours sits just past it: a
     * shorter one would report a failure for an install that went on to land.
     */
    async installRegistrySkill(registrySkillId) {
        await this.request("POST", `${this.baseUrl}/skills-registry/install`, { registrySkillId }, INSTALL_TIMEOUT_MS);
    }
    // ─────────────────────────── terminals ───────────────────────────
    /** `POST /api/v1/terminals`: a pty on a host, in a folder, running one
     *  command. The same terminals bb's own UI lists, so a dev server started
     *  from the editor is one a person can find and stop there too. */
    async createTerminal(args) {
        const value = await this.request("POST", `${this.baseUrl}/terminals`, {
            cols: args.cols ?? 120,
            rows: args.rows ?? 32,
            target: { kind: "host_path", hostId: args.hostId, cwd: args.cwd },
            start: { mode: "command", command: args.command },
            title: args.title,
        });
        return parseTerminal(value);
    }
    /** `GET /api/v1/terminals/:id`. */
    async terminal(terminalId) {
        return parseTerminal(await this.request("GET", `${this.baseUrl}/terminals/${encodeURIComponent(terminalId)}`));
    }
    /** `GET /api/v1/terminals/:id/output?sinceSeq=`: what the pty printed after
     *  `sinceSeq`, and the sequence number to ask from next time. */
    async terminalOutput(terminalId, sinceSeq) {
        const value = asRecord(await this.request("GET", `${this.baseUrl}/terminals/${encodeURIComponent(terminalId)}/output?sinceSeq=${sinceSeq}`));
        const chunks = Array.isArray(value?.chunks) ? value.chunks : [];
        const text = chunks
            .map((chunk) => asRecord(chunk)?.dataBase64)
            .filter((data) => typeof data === "string")
            .map((data) => Buffer.from(data, "base64").toString("utf8"))
            .join("");
        const nextSeq = typeof value?.nextSeq === "number" ? value.nextSeq : sinceSeq;
        return { text, nextSeq };
    }
    /** `POST /api/v1/terminals/:id/close`. The body is required: bb answers
     *  `{}` with a 400 ("expected one of force|if-clean"), which is how Cancel
     *  once left the dev server running in bb while the panel said cancelled.
     *  `force` because a dev server is never "clean" — it is always running. */
    async closeTerminal(terminalId) {
        await this.request("POST", `${this.baseUrl}/terminals/${encodeURIComponent(terminalId)}/close`, { mode: "force", reason: "user" });
    }
    /** Call a route the plugin registered with `bb.http.route`, which bb mounts
     *  at `/api/v1/plugins/<id>/http/<path>`. */
    async pluginHttp(pluginId, routePath, body) {
        const path = routePath.replace(/^\/+/, "");
        const url = `${this.baseUrl}/plugins/${encodeURIComponent(pluginId)}/http/${path}`;
        return this.request("POST", url, body ?? {});
    }
}
exports.BbClient = BbClient;
