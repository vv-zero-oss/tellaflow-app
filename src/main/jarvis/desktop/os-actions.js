"use strict";
/**
 * The mascot's desktop tier, main-process half (plan.md Phase 5).
 *
 * Four operations sit behind the `mascot-os:*` IPC channels: read the permission
 * status, ask once for Accessibility, look at an app (`see`), and run one action.
 * Everything below is a thin, well-typed shell over `peekaboo.ts` — that module
 * owns argv and envelope shapes, this one owns the gate, the caps and the
 * normalisation the renderer contract promises.
 *
 * A FIFTH operation lives here on its own channel and outside that tier:
 * `captureScreen` (`mascot-vision:capture`), the always-on screen look. It is in
 * this file because it is the same binary and the same platform gate, and on its
 * own channel because it is NOT the same act — it returns an image and no element
 * map, so it needs Screen Recording and nothing else. `ScreenCaptureResult` below
 * carries that boundary in full; read it before widening either path towards the
 * other.
 *
 * ── What this module deliberately does NOT do ───────────────────────────────
 *
 * It does not decide whether an action is ALLOWED. The confirmation prompt, the
 * "run the rest of this task" latch, the app denylist, the ≤8-per-turn cap, the
 * chain abort and the secure-field refusal all live in the renderer's
 * `mascot-dispatch.ts`, and that is not an accident of layering:
 *
 *  - every one of those rules needs a user to ask or a turn to be scoped to, and
 *    main has neither;
 *  - rule 6 (never type into a secure field) is a fail-closed judgement over the
 *    whole element map plus the app that map is evidence about, and main holds
 *    neither half of that: `os_type` carries no target, peekaboo 4.2.0's element
 *    schema has no focused flag (see `isSecureElement` in peekaboo.ts), and the
 *    map itself is held by the renderer for the length of a conversation. What
 *    main owes that rule is honest EVIDENCE, which is why `osSee` below records
 *    whether the look was of the foreground.
 *
 * So main is the mechanism and the renderer is the policy. The one policy main
 * does own is the PLATFORM gate — below macOS 15, or with no binary, there is
 * nothing to grant and nothing to run, and `supported: false` says so once
 * instead of every call failing in its own way.
 *
 * ── Why it is not Set up's grants channel ───────────────────────────────────
 *
 * Set up's rows (`setup:permissions`, electron/grant-reading.ts) read every grant
 * without prompting, and Accessibility is asked for only by Set up's own Allow
 * and by this opt-in tier: the cursor ring and every other feature keep working
 * with no Accessibility grant. This tier's checks stay here because they gate
 * an action, where the prompting variant is the point — and that variant must
 * never be one boolean away from a read a Settings open takes.
 *
 * ── Shape ───────────────────────────────────────────────────────────────────
 *
 * A factory over injected deps (`createOsActions`), the same shape as
 * `mascot-overlay.ts`: the real singleton is built at the bottom of the file and
 * re-exported as four plain functions, while the tests build their own with a
 * fake runner and a fake `systemPreferences` and never spawn or import Electron.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureScreen = exports.osInspect = exports.osAct = exports.osSee = exports.requestAccessibility = exports.getOsStatus = exports.INTERACTIVE_ROLES = exports.ACCESSIBILITY_PANE_URL = exports.OS_STATUS_CACHE_MS = exports.MAX_SEE_ELEMENTS = exports.PROGRAM_EXTENSIONS = exports.CONCEALED_PASTEBOARD_TYPES = void 0;
exports.roleKey = roleKey;
exports.elementTier = elementTier;
exports.capElements = capElements;
exports.argvForAction = argvForAction;
exports.createOsActions = createOsActions;
const node_fs_1 = __importDefault(require("node:fs"));
const node_module_1 = require("node:module");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const peekaboo_1 = require("./peekaboo");
const parseUrl = (raw) => {
    try {
        return new URL(raw);
    }
    catch {
        return null;
    }
};
/** The schemes `os_open_url` opens (the renderer's `OS_URL_PROTOCOLS`). */
const URL_PROTOCOLS = new Set(["http:", "https:"]);
/**
 * Pasteboard types a password manager (or anything copying a secret) marks its
 * copy with — the nspasteboard.org convention every major password manager
 * follows, plus 1Password's own. A clipboard carrying one is never read.
 */
exports.CONCEALED_PASTEBOARD_TYPES = [
    "org.nspasteboard.ConcealedType",
    "com.agilebits.onepassword",
];
/** Extensions that RUN something when opened, beside anything with an execute
 *  bit and every `.app` bundle. Lower-case, with the dot. */
exports.PROGRAM_EXTENSIONS = new Set([
    ".app", ".command", ".tool", ".sh", ".zsh", ".bash", ".pkg", ".mpkg", ".terminal",
    ".workflow", ".action", ".scpt", ".scptd", ".applescript", ".jar", ".prefpane", ".saver", ".dylib",
]);
// ── Tunables ────────────────────────────────────────────────────────────────
/**
 * How many elements one `see` may return.
 *
 * A real app's Accessibility tree is thousands of nodes — Xcode's is five
 * figures — and every element the map keeps is pasted into a model prompt on the
 * next turn. Uncapped, one look at a big window costs more tokens than the whole
 * rest of the turn and pushes the editor context out of the window. 80 is the
 * plan's number and is comfortably more than the actionable controls of any
 * normal window once `capElements` has sorted the interactive ones to the front.
 */
exports.MAX_SEE_ELEMENTS = 80;
/**
 * How long a peekaboo permissions probe is reused.
 *
 * `status()` is read PER ACTION by the dispatcher (gate 2 of rule 1), so a chain
 * of 8 actions would otherwise spawn 8 extra peekaboo processes on the path the
 * user is watching. The staleness this admits is bounded and one-directional:
 * `accessibility` also ORs in a FRESH `isTrustedAccessibilityClient(false)`, so
 * a grant made mid-chain is visible immediately; only a REVOKE can be up to this
 * long stale, and the cost of that is one action failing with peekaboo's own
 * PERMISSION_ERROR_ACCESSIBILITY, which is already a narrated outcome.
 */
exports.OS_STATUS_CACHE_MS = 1500;
/**
 * The Accessibility pane deep link.
 *
 * `x-apple.systempreferences:` — the only spelling macOS registers (System
 * Settings still answers to it); `x-apple.systemsettings:` has no handler and
 * fails with "No application found to open URL". Best-effort either way: the URL
 * scheme is not contractual across macOS versions, so a failure here leaves the
 * button inert rather than breaking the grant flow, which the native prompt
 * below has already started.
 */
exports.ACCESSIBILITY_PANE_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
/**
 * Roles that get to survive the element cap first.
 *
 * Matched on a normalised key (lowercased, a leading "ax" stripped), because
 * peekaboo surfaces both the AX constant ("AXButton") and its own lowercase
 * spelling depending on which field carried the role. Anything unlisted is not
 * dropped — it just sorts after these, so a window whose controls all have
 * exotic roles still yields a usable map instead of an empty one.
 */
exports.INTERACTIVE_ROLES = new Set([
    "button", "link", "checkbox", "radiobutton", "popupbutton", "menubutton",
    "menuitem", "menubaritem", "menubar", "menu", "combobox", "textfield",
    "securetextfield", "textarea", "searchfield", "slider", "incrementor",
    "stepper", "segmentedcontrol", "tab", "tabgroup", "disclosuretriangle",
    "colorwell", "toolbarbutton", "switch", "row", "cell", "outline", "table",
    "scrollbar", "list", "sheet", "dialog",
]);
// ── Pure helpers ────────────────────────────────────────────────────────────
/** "AXSecureTextField" → "securetextfield". */
function roleKey(role) {
    return String(role ?? "").toLowerCase().replace(/^ax/, "");
}
/**
 * Which cap tier an element belongs to. Lower survives first.
 *
 * Tier 0 is SECURE FIELDS, and that tier exists for one reason: rule 6 refuses
 * `os_type` when the targeted element is a secure text field, and the dispatcher
 * can only check that against elements it was given. An element capped OUT of
 * the map does not read as "secure", it reads as "unknown" — which is the
 * permissive branch. So a password field must never be the row that falls off
 * the end of a long map.
 */
function elementTier(el) {
    if (el.secure === true)
        return 0;
    return exports.INTERACTIVE_ROLES.has(roleKey(el.role)) ? 1 : 2;
}
/**
 * Cap the element list: secure fields, then interactive controls, then the rest,
 * stable within each tier so peekaboo's own top-to-bottom order survives.
 *
 * A plain `slice` would have been the obvious implementation and is the wrong
 * one: peekaboo emits the tree in traversal order, which on a real window starts
 * with window chrome and static text, so the first 80 rows of a big app are
 * mostly labels and the Save button the user asked about is row 400.
 */
function capElements(elements, max = exports.MAX_SEE_ELEMENTS) {
    if (elements.length <= max)
        return elements;
    const tiers = [[], [], []];
    for (const el of elements)
        tiers[elementTier(el)].push(el);
    return [...tiers[0], ...tiers[1], ...tiers[2]].slice(0, Math.max(0, max));
}
/** Fold peekaboo's error code into the single `error` string the see contract
 *  carries, so a permission failure is still diagnosable in a shape that has no
 *  `errorCode` field of its own. */
function seeError(code, message) {
    const msg = message ?? "peekaboo reported failure";
    return code ? `${code}: ${msg}` : msg;
}
const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);
/** A target the CLI can actually address, or null. Point coordinates must be
 *  finite: `--at NaN,NaN` is argv peekaboo would reject with a parse error the
 *  user cannot act on, and an unvalidated `{x: undefined}` would click 0,0 —
 *  the top-left corner, i.e. the Apple menu. */
function readTarget(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const t = raw;
    if (typeof t.elementId === "string" && t.elementId)
        return { elementId: t.elementId };
    if (isFiniteNumber(t.x) && isFiniteNumber(t.y))
        return { point: { x: t.x, y: t.y } };
    return null;
}
const invalid = (why) => ({ ok: false, errorCode: "INVALID_ACTION", error: why });
/**
 * Would peekaboo's argv parser read this model-chosen token as a FLAG?
 *
 * Only two builders can be reached by such a token, and both are checked below:
 * `pressArgs` splits `keys` on whitespace into SEVERAL positional tokens (so
 * `"cmd+q --app Terminal"` becomes `["press","cmd+q","--app","Terminal"]` and
 * retargets the keystroke at an app the renderer's denylist never saw —
 * adversarial-review finding 8), and `appArgs`'s launch form passes the app name
 * POSITIONALLY (so a name of "--foreground" is parsed as a flag, not a name).
 *
 * Every other field these actions carry is pushed as a single argv element
 * AFTER its own flag — `--on`, `--at`, `--text`, `--path`, `--app`, `--to`,
 * `--direction` — where argv is a value position, no shell is involved and one
 * string can never become two tokens. `typeArgs` uses `--text` rather than the
 * positional form for exactly this reason, and says so.
 */
const looksLikeFlag = (token) => token.startsWith("-");
/**
 * `OsAction` → peekaboo argv, or a refusal.
 *
 * Exported for the test, which asserts the argv of every action type without
 * spawning anything — the same contract peekaboo.ts's own builder tests keep.
 */
function argvForAction(action) {
    if (!action || typeof action !== "object" || typeof action.type !== "string") {
        return { refusal: invalid("no action") };
    }
    switch (action.type) {
        // Neither of these is an "act". `os_see` has its own IPC channel because it
        // returns a payload rather than a verdict, and `os_point` NEVER reaches the
        // CLI at all: it moves the mascot's own panel next to the element and stops.
        // Routing either here would turn "let me show you where that is" into a
        // click the user never approved, so they are refused rather than mapped.
        case "os_see":
        case "os_point":
            return { refusal: { ok: false, errorCode: "UNSUPPORTED_ACTION", error: `${action.type} is not dispatched through mascot-os:act` } };
        case "os_click": {
            const target = readTarget(action.target);
            if (!target)
                return { refusal: invalid("os_click needs an elementId or a finite point") };
            return { args: (0, peekaboo_1.clickArgs)({ ...target, button: action.button === "right" ? "right" : "left", double: action.double === true }) };
        }
        case "os_type": {
            // Only emptiness is rejected, never trimmed: leading and trailing spaces
            // are part of what the user approved in the confirmation dialog, and rule
            // 2 shows them that exact text.
            if (typeof action.text !== "string" || action.text.length === 0)
                return { refusal: invalid("os_type needs text") };
            return { args: (0, peekaboo_1.typeArgs)({ text: action.text }) };
        }
        case "os_press": {
            if (typeof action.keys !== "string" || !action.keys.trim())
                return { refusal: invalid("os_press needs keys") };
            // Split with the SAME function `pressArgs` will use, so what is inspected
            // here is exactly what becomes argv — a second copy of the split rule is
            // how the renderer's guard came to disagree with this builder in the first
            // place (findings 1, 3, 8).
            const chords = (0, peekaboo_1.splitKeyChords)(action.keys);
            if (chords.some(looksLikeFlag)) {
                return { refusal: invalid("os_press keys cannot contain a peekaboo flag") };
            }
            return { args: (0, peekaboo_1.pressArgs)({ keys: action.keys }) };
        }
        case "os_scroll": {
            const dir = action.direction;
            if (dir !== "up" && dir !== "down" && dir !== "left" && dir !== "right") {
                return { refusal: invalid("os_scroll needs a direction") };
            }
            // A point target is passed through even though peekaboo's `scroll` has no
            // coordinate flag: `scrollArgs` reads it only to decide `--foreground`, and
            // dropping it here would make a point-targeted scroll silently identical to
            // a targetless one in the argv the test reads.
            const target = readTarget(action.target) ?? {};
            return { args: (0, peekaboo_1.scrollArgs)({ direction: dir, amount: action.amount, ...target }) };
        }
        case "os_menu": {
            const app = typeof action.app === "string" ? action.app.trim() : "";
            const menuPath = Array.isArray(action.path) ? action.path.filter((s) => typeof s === "string" && !!s) : [];
            if (!app || menuPath.length === 0)
                return { refusal: invalid("os_menu needs an app and a path") };
            return { args: (0, peekaboo_1.menuClickArgs)({ app, path: menuPath }) };
        }
        case "os_drag": {
            const from = readTarget(action.from);
            const to = readTarget(action.to);
            if (!from || !to)
                return { refusal: invalid("os_drag needs two element ids or finite points") };
            // An element id is passed as ONE argv value after its flag, so it cannot
            // become a flag itself — but a leading dash would be read as one by the
            // parser, like `os_press`'s chords.
            if ((from.elementId && looksLikeFlag(from.elementId)) || (to.elementId && looksLikeFlag(to.elementId))) {
                return { refusal: invalid("os_drag element ids cannot start with a dash") };
            }
            return { args: (0, peekaboo_1.dragArgs)({ from, to }) };
        }
        // Done by main itself, not peekaboo (see `osAct`), so there is no argv —
        // and `os_wait` is the renderer's own loop over `see`.
        case "os_open_url":
        case "os_open_file":
        case "os_clipboard_read":
        case "os_clipboard_write":
        case "os_wait":
            return { refusal: { ok: false, errorCode: "UNSUPPORTED_ACTION", error: `${action.type} has no peekaboo argv` } };
        case "os_app": {
            const name = typeof action.name === "string" ? action.name.trim() : "";
            const verb = action.action;
            if (!name || (verb !== "launch" && verb !== "focus" && verb !== "quit")) {
                return { refusal: invalid("os_app needs a name and launch|focus|quit") };
            }
            // `app launch` takes the name POSITIONALLY, so a leading dash makes it a
            // flag instead of an app. No installed application is named that way, and
            // the refusal is a clean INVALID_ACTION rather than peekaboo's own parse
            // error about a flag nobody meant to pass.
            if (looksLikeFlag(name))
                return { refusal: invalid("os_app name cannot start with a dash") };
            return { args: (0, peekaboo_1.appArgs)({ name, action: verb }) };
        }
        default:
            return { refusal: { ok: false, errorCode: "UNSUPPORTED_ACTION", error: `unknown action ${String(action.type)}` } };
    }
}
// ── The controller ──────────────────────────────────────────────────────────
function createOsActions(deps) {
    /** Last peekaboo permissions probe, reused for OS_STATUS_CACHE_MS. */
    let probeCache = null;
    /** True only where the bundled binary can run at all: macOS, 15 or later.
     *  Checked BEFORE anything else so a non-Darwin machine never reaches
     *  `isTrustedAccessibilityClient`, which is a macOS-only API. */
    const platformSupported = () => deps.platform === "darwin" && (0, peekaboo_1.isDarwinSupported)(deps.release);
    /** Never throws: a status read runs on the Settings-open path and on every
     *  action gate, and a rejected promise there reads to the renderer as "the
     *  feature is broken" rather than "not granted". */
    const axTrusted = () => {
        try {
            return deps.isTrustedAccessibilityClient(false) === true;
        }
        catch {
            return false;
        }
    };
    async function probePermissions() {
        const now = deps.now();
        if (probeCache && now - probeCache.at < exports.OS_STATUS_CACHE_MS) {
            return { screenRecording: probeCache.screenRecording, accessibility: probeCache.accessibility };
        }
        try {
            const { env } = await deps.run((0, peekaboo_1.permissionsArgs)(), { timeoutMs: peekaboo_1.TIMEOUT_MS.probe });
            const p = (0, peekaboo_1.permissionsFromEnvelope)(env);
            const value = { screenRecording: p.screenRecording, accessibility: p.accessibility };
            probeCache = { at: now, ...value };
            return value;
        }
        catch {
            // A failed probe is NOT cached: the usual cause is a binary that has just
            // been installed or replaced, and caching the failure would keep the
            // Settings panel reporting "denied" for as long as the app is open.
            return { screenRecording: false, accessibility: false };
        }
    }
    async function getOsStatus() {
        if (!platformSupported()) {
            return {
                supported: false,
                screenRecording: false,
                accessibility: false,
                peekaboo: { ok: false, version: null, error: "the desktop tier needs macOS 15 or later" },
            };
        }
        // Cached resolution on the happy path, forced only after a failure: the
        // Settings panel calls this on every open, and a "peekaboo not found" cached
        // at launch would otherwise survive the user running `npm run fetch:peekaboo`
        // until they restarted the app. Same reasoning as the `ffmpeg:status`
        // handler's forced resolve, minus a `--version` spawn per call once it works.
        let info = await deps.resolve(false).catch((e) => ({
            ok: false, bin: null, version: null, source: null, error: String(e?.message ?? e),
        }));
        if (!info.ok) {
            info = await deps.resolve(true).catch(() => info);
        }
        const peekaboo = { ok: info.ok, version: info.version, ...(info.error ? { error: info.error } : {}) };
        if (!info.ok) {
            // No binary means no probe, so both peekaboo-sourced rows read false and
            // `peekaboo.error` is the reason to show. Accessibility is still reported
            // truthfully — Electron answers it for our own process with no helper
            // involved, and the Settings row is more useful true than blank.
            return { supported: false, screenRecording: false, accessibility: axTrusted(), peekaboo };
        }
        const probe = await probePermissions();
        return {
            supported: true,
            screenRecording: probe.screenRecording,
            // COMPOSED, not picked. `isTrustedAccessibilityClient(false)` is
            // authoritative for the Electron process and needs no spawn; peekaboo's
            // probe is the child's own view, which TCC attributes to the same
            // responsible bundle (measured — see peekaboo.ts's header). Either saying
            // yes is enough: a false negative strands the whole feature behind a grant
            // the user has already given, while a false positive costs exactly one
            // action failing with PERMISSION_ERROR_ACCESSIBILITY, which the mascot
            // already narrates.
            accessibility: axTrusted() || probe.accessibility,
            peekaboo,
        };
    }
    async function requestAccessibility() {
        if (!platformSupported())
            return { granted: false };
        // The ONLY `true` in this file. macOS raises the native prompt at most once
        // per bundle, so this call is the one chance to get the friendly dialog.
        let granted;
        try {
            granted = deps.isTrustedAccessibilityClient(true) === true;
        }
        catch {
            granted = false;
        }
        // …and after that single prompt has been dismissed, the System Settings pane
        // is the ONLY route left to the grant — no API can re-raise it. So the pane
        // is opened whenever the answer is still no, which covers both the very
        // first request (the prompt is up; the pane is where they will be sent
        // anyway) and every later one (there is no prompt at all). It is NOT opened
        // when the grant is already in place: yanking the user into System Settings
        // to be told everything is fine is its own bug.
        if (!granted) {
            try {
                deps.openExternal(exports.ACCESSIBILITY_PANE_URL);
            }
            catch { /* deep links are best-effort */ }
        }
        // A grant taken during this call must be visible on the very next status
        // read — the Settings panel refreshes right after this resolves.
        probeCache = null;
        return { granted };
    }
    async function osSee(app) {
        if (!platformSupported()) {
            return { ok: false, elements: [], error: "the desktop tier needs macOS 15 or later" };
        }
        const info = await deps.resolve(false).catch(() => null);
        if (!info?.ok) {
            return { ok: false, elements: [], error: info?.error ?? "peekaboo unavailable" };
        }
        const target = typeof app === "string" && app.trim() ? app.trim() : undefined;
        const shot = deps.nextShotPath();
        let env;
        try {
            // TIMEOUT_MS.see, not the default act timeout: peekaboo's own `see`
            // deadline is 20 s and ours has to lose that race, so a slow AX traversal
            // comes back as its structured TIMEOUT envelope instead of a killed child
            // and an "unparseable peekaboo output" that names nothing.
            ({ env } = await deps.run((0, peekaboo_1.seeArgs)({ app: target, ...(shot ? { path: shot } : {}) }), { timeoutMs: peekaboo_1.TIMEOUT_MS.see }));
        }
        catch (e) {
            return { ok: false, elements: [], error: String(e?.message ?? e) };
        }
        const parsed = (0, peekaboo_1.seeFromEnvelope)(env);
        if (!parsed.ok)
            return { ok: false, elements: [], error: seeError(parsed.errorCode, parsed.error) };
        const data = parsed.data ?? { elements: [] };
        const out = { ok: true, elements: capElements(parsed.elements) };
        // Recorded from what WE asked for, not from the envelope: peekaboo reports
        // which app it looked at, but nothing in the payload says whether that app
        // was in front. `target` is undefined exactly when the CLI was left to its
        // default, and its default IS the frontmost window (see `seeArgs`). This is
        // the only evidence the dispatcher has that a later `os_type` — which always
        // goes to the foreground — would land on the screen this map describes.
        if (!target)
            out.foreground = true;
        // The envelope names the annotated file when it wrote one; the path we asked
        // for is the fallback, because a `see --path` that succeeded did write there
        // and a map with no image forces the brain to guess from labels alone.
        const screenshotPath = data.screenshotPath ?? shot ?? undefined;
        if (screenshotPath)
            out.screenshotPath = screenshotPath;
        if (data.app)
            out.app = data.app;
        if (data.windowId)
            out.windowId = data.windowId;
        if (data.frontmostApp)
            out.frontmostApp = data.frontmostApp;
        return out;
    }
    /** `~/x` → the home folder's `x`; anything else as given. */
    const expandHome = (p) => p === "~" ? deps.homedir() : p.startsWith("~/") ? node_path_1.default.join(deps.homedir(), p.slice(2)) : p;
    /**
     * Where a path REALLY is and what it is. Symlinks are resolved before the
     * home check (`~/link-to-etc/passwd` is not inside home), and the home folder
     * itself is resolved too (on macOS `/Users` can be reached through a link).
     */
    function inspectFile(raw) {
        if (typeof raw !== "string" || !raw || !node_path_1.default.isAbsolute(expandHome(raw)))
            return { ok: false, error: "not an absolute path" };
        const given = node_path_1.default.resolve(expandHome(raw));
        let home;
        try {
            home = deps.realpath(deps.homedir());
        }
        catch {
            return { ok: false, error: "no home folder" };
        }
        let real;
        let exists = true;
        try {
            real = deps.realpath(given);
        }
        catch {
            // Missing: judged by where it WOULD be, and reported as missing.
            real = given;
            exists = false;
        }
        const insideHome = real !== home && real.startsWith(home + node_path_1.default.sep);
        const st = exists ? deps.stat(real) : null;
        const ext = node_path_1.default.extname(real).toLowerCase();
        const program = exports.PROGRAM_EXTENSIONS.has(ext) ||
            (!!st && st.isFile && (st.mode & 0o111) !== 0) ||
            // A bundle is a directory that opens as a program.
            (!!st && st.isDirectory && ext === ".app");
        return { ok: true, kind: "file", path: real, insideHome, exists: exists && !!st, program };
    }
    function inspectClipboard() {
        let formats = [];
        try {
            formats = deps.clipboard.formats();
        }
        catch { /* unreadable: concealed below */ }
        const concealed = formats.some((f) => exports.CONCEALED_PASTEBOARD_TYPES.includes(f));
        let hasText = false;
        try {
            hasText = deps.clipboard.readText().length > 0;
        }
        catch { /* nothing readable */ }
        return { ok: true, kind: "clipboard", hasText, concealed };
    }
    async function osInspect(what) {
        const w = (what ?? {});
        if (w.kind === "file")
            return inspectFile(typeof w.path === "string" ? w.path : "");
        if (w.kind === "clipboard")
            return inspectClipboard();
        return { ok: false, error: "nothing to inspect" };
    }
    /** The actions main does itself, with Electron, rather than through
     *  peekaboo. Each re-checks its own refusal — the renderer ruled on a
     *  measurement, and the world can change between that and this. */
    async function nativeAct(action) {
        switch (action.type) {
            case "os_open_url": {
                const url = parseUrl(String(action.url));
                if (!url || !URL_PROTOCOLS.has(url.protocol) || url.username || url.password)
                    return invalid("os_open_url needs an http(s) address");
                try {
                    await deps.openUrl(url.toString());
                    return { ok: true };
                }
                catch (e) {
                    return { ok: false, errorCode: "OPEN_FAILED", error: String(e?.message ?? e) };
                }
            }
            case "os_open_file": {
                const info = inspectFile(String(action.path ?? ""));
                if (!info.ok)
                    return invalid(info.error);
                if (!info.insideHome)
                    return { ok: false, errorCode: "OUTSIDE_HOME", error: "only files inside the home folder" };
                if (!info.exists)
                    return { ok: false, errorCode: "NOT_FOUND", error: "no such file" };
                const err = await deps.openPath(info.path).catch((e) => String(e?.message ?? e));
                return err ? { ok: false, errorCode: "OPEN_FAILED", error: err } : { ok: true };
            }
            case "os_clipboard_read": {
                const info = inspectClipboard();
                if (info.concealed)
                    return { ok: false, errorCode: "CONCEALED", error: "the clipboard holds a concealed (password) item" };
                try {
                    return { ok: true, text: deps.clipboard.readText() };
                }
                catch (e) {
                    return { ok: false, errorCode: "CLIPBOARD_FAILED", error: String(e?.message ?? e) };
                }
            }
            case "os_clipboard_write": {
                if (typeof action.text !== "string" || !action.text)
                    return invalid("os_clipboard_write needs text");
                try {
                    deps.clipboard.writeText(action.text);
                    return { ok: true };
                }
                catch (e) {
                    return { ok: false, errorCode: "CLIPBOARD_FAILED", error: String(e?.message ?? e) };
                }
            }
            default:
                return null;
        }
    }
    async function osAct(action) {
        if (!platformSupported()) {
            return { ok: false, errorCode: "NOT_SUPPORTED", error: "the desktop tier needs macOS 15 or later" };
        }
        const native = action && typeof action === "object" ? await nativeAct(action) : null;
        if (native)
            return native;
        const built = argvForAction(action);
        // Refuse BEFORE resolving the binary: an unknown or malformed action is the
        // renderer's bug and must report as such, not as "peekaboo unavailable" on a
        // machine where the CLI happens to be missing too.
        if ("refusal" in built)
            return built.refusal;
        const info = await deps.resolve(false).catch(() => null);
        if (!info?.ok) {
            return { ok: false, errorCode: "PEEKABOO_UNAVAILABLE", error: info?.error ?? "peekaboo unavailable" };
        }
        try {
            const { env } = await deps.run(built.args, { timeoutMs: peekaboo_1.TIMEOUT_MS.act });
            const r = (0, peekaboo_1.resultFromEnvelope)(env);
            // Normalised to exactly the three contract fields, with no `data`: an act
            // is a verdict, and forwarding peekaboo's raw payload would invite the
            // renderer to depend on a shape only peekaboo owns.
            return r.ok
                ? { ok: true }
                : { ok: false, errorCode: r.errorCode ?? "UNKNOWN_ERROR", error: r.error };
        }
        catch (e) {
            return { ok: false, errorCode: "SPAWN_FAILED", error: String(e?.message ?? e) };
        }
    }
    // ── Always-on screen vision ───────────────────────────────────────────────
    /** displayID → peekaboo `--screen-index`, or null when it has not been read (or
     *  has been invalidated by a hot-plug). */
    let screenIndexById = null;
    let watchingDisplays = false;
    /**
     * Start dropping the display map on hot-plugs — LAZILY, on the first capture.
     *
     * Not at construction: the real singleton at the bottom of this file is built
     * when main.ts imports the module, which is BEFORE `app.whenReady()`, and
     * Electron's `screen` module throws if it is touched before the ready event. A
     * subscription in the factory would therefore either crash the launch or force
     * this module to import Electron eagerly, which is the thing that keeps its
     * tests Electron-free. The first capture can only happen once a renderer has a
     * mascot on screen, which is long past ready.
     */
    const watchDisplays = () => {
        if (watchingDisplays)
            return;
        watchingDisplays = true;
        try {
            deps.onDisplaysChanged(() => { screenIndexById = null; });
        }
        catch {
            // A missing subscription costs a stale map after a hot-plug, which resolves
            // to a miss and then to display 0 — never a throw on the capture path.
        }
    };
    /**
     * `peekaboo screen list`, cached until the display topology changes.
     *
     * Cached because this runs on the latency path the whole feature exists to
     * shorten: 59 ms measured, per utterance, to answer a question whose answer
     * only changes when a monitor is plugged in. Invalidated by `watchDisplays`
     * rather than by a TTL, because a TTL is both slower (it re-spawns for nothing)
     * and wronger (it stays stale for the length of the TTL after the one event
     * that actually changes the answer).
     */
    async function screenIndexMap() {
        if (screenIndexById)
            return screenIndexById;
        try {
            const { env } = await deps.run((0, peekaboo_1.screenListArgs)(), { timeoutMs: peekaboo_1.TIMEOUT_MS.probe });
            const parsed = (0, peekaboo_1.screensFromEnvelope)(env);
            if (!parsed.ok)
                return new Map();
            const map = new Map();
            for (const s of parsed.screens)
                map.set(s.displayId, s.index);
            // Only a successful, non-empty read is cached: an empty list means we could
            // not enumerate the displays, and caching that would pin every later capture
            // to display 0 for the rest of the session.
            if (map.size > 0)
                screenIndexById = map;
            return map;
        }
        catch {
            return new Map();
        }
    }
    /** Which display to photograph. Index 0 is the fallback for every uncertainty —
     *  a cursor Electron will not report, a display peekaboo does not list, a failed
     *  enumeration — because a still of the main display is a worse answer than the
     *  right one and a far better answer than none. */
    async function cursorScreenIndex() {
        let id;
        try {
            id = deps.cursorDisplayId();
        }
        catch {
            id = null;
        }
        if (id === null)
            return 0;
        const map = await screenIndexMap();
        return map.get(id) ?? 0;
    }
    async function captureScreen() {
        if (!platformSupported()) {
            return { ok: false, error: "screen vision needs macOS 15 or later" };
        }
        const info = await deps.resolve(false).catch(() => null);
        if (!info?.ok)
            return { ok: false, error: info?.error ?? "peekaboo unavailable" };
        const dst = deps.nextScreenShotPath();
        // No writable path is fatal HERE, unlike `see`: the image is the entire
        // payload, so there is nothing left to return without one.
        if (!dst)
            return { ok: false, error: "no writable path for a screen capture" };
        watchDisplays();
        const index = await cursorScreenIndex();
        let shot;
        try {
            shot = await deps.captureStill(dst, index);
        }
        catch (e) {
            // `shoot` catches its own spawn failures, so this is only reachable through
            // an injected runner — but this result crosses an ipcMain boundary where a
            // rejection reaches the renderer as an opaque error it cannot narrate.
            return { ok: false, error: String(e?.message ?? e) };
        }
        if (!shot.ok || !shot.path) {
            return { ok: false, error: seeError(shot.errorCode ?? undefined, shot.error) };
        }
        const out = { ok: true, path: shot.path };
        // Peekaboo reports the image size in PIXELS; both fields are omitted rather
        // than zeroed when it does not, so a consumer can tell "not reported" from a
        // capture that really is 0 wide.
        if (typeof shot.widthPx === "number")
            out.width = shot.widthPx;
        if (typeof shot.heightPx === "number")
            out.height = shot.heightPx;
        return out;
    }
    return { getOsStatus, requestAccessibility, osSee, osAct, osInspect, captureScreen };
}
// ── The real singleton ──────────────────────────────────────────────────────
/** Screenshots the mascot takes of the user's screen. Its own directory, beside
 *  (not inside) `~/.canvas/recordings`, Magic Cast's fallback root: mixing a
 *  capture of ANOTHER application into a recording's folder would quietly widen
 *  what that pipeline's cleanup is responsible for. Under the home directory
 *  rather than `userData` so the path is plain node — no Electron, no app-ready —
 *  and has no spaces for the agent that is told to open it. */
function shotDir() {
    return node_path_1.default.join(node_os_1.default.homedir(), ".tellaflow", "assistant", "shots");
}
/**
 * How long a capture of the user's screen is kept on disk.
 *
 * The number that made this worth stating: the always-on vision path writes one
 * ~545 KB full-display JPEG PER UTTERANCE, so an hour of talking is ~33 MB. Every
 * shot is read once, seconds later, by the turn that asked for it — nothing
 * references one across an hour, let alone a restart — so an hour of retention is
 * already generous, and it is what bounds the directory.
 */
const SHOT_RETENTION_MS = 60 * 60 * 1000;
/**
 * Prepare a path under the shot directory, pruning old captures on the way.
 *
 * The prune is HERE rather than in a launch sweep in main.ts because this
 * directory only ever grows while the mascot is in use, and a session that never
 * restarts the app would otherwise accumulate captures of the user's screen
 * forever.
 *
 * ONE cleaner, for BOTH capture kinds. It deletes by AGE over every file in the
 * directory, not by pattern, so the always-on stills added beside `see`'s
 * annotated PNGs are covered by it the moment they land there — which is the
 * whole reason they were put in this directory rather than a second one with a
 * second sweep that could rot independently. The distinct name prefixes
 * (`see-…` / `screen-…`) are what keep the two kinds separable by eye and by any
 * future rule that wants to treat them differently.
 */
function prepareShotPath(name) {
    const dir = shotDir();
    try {
        node_fs_1.default.mkdirSync(dir, { recursive: true });
        const cutoff = Date.now() - SHOT_RETENTION_MS;
        try {
            for (const f of node_fs_1.default.readdirSync(dir)) {
                const p = node_path_1.default.join(dir, f);
                try {
                    if (node_fs_1.default.statSync(p).mtimeMs < cutoff)
                        node_fs_1.default.unlinkSync(p);
                }
                catch { /* raced with another sweep */ }
            }
        }
        catch { /* a missing or unreadable directory is not a reason to skip the shot */ }
        return node_path_1.default.join(dir, name);
    }
    catch {
        return null;
    }
}
/** The annotated screenshot a `see` writes. `.png` because `seeArgs` passes no
 *  `--format`, and MEASURED: with no `--format`, peekaboo takes the encoding from
 *  the path's extension (`--path x.png` → `image/png`, `--path x.jpg` →
 *  `image/jpeg`).
 *
 *  No writable path is not fatal for a look: `seeArgs` without `--path` still
 *  returns the element map, which is the part the brain reasons over. */
function nextShotPath() {
    return prepareShotPath(`see-${Date.now()}.png`);
}
/**
 * The full-display still an always-on look writes.
 *
 * `.jpg`, and its OWN helper, because `screenStillArgs` hardcodes `--format jpg`
 * while `nextShotPath` hardcodes `.png` — and peekaboo REFUSES that combination
 * outright. MEASURED against the shipped 4.2.0 binary:
 *
 *   INVALID_ARGUMENT — Invalid value './x.png' for path: Conflicts with
 *   --format jpg.  (hint: Use a .jpg path, or omit --format)
 *
 * So reusing `nextShotPath()` here would not have mislabelled a file, it would
 * have made EVERY vision capture fail with an argument error, on every machine,
 * for a reason no part of this feature mentions.
 */
function nextScreenShotPath() {
    return prepareShotPath(`screen-${Date.now()}.jpg`);
}
const real = createOsActions({
    platform: process.platform,
    release: node_os_1.default.release(),
    resolve: (force) => (0, peekaboo_1.resolvePeekaboo)(force),
    run: (args, opts) => (0, peekaboo_1.runPeekaboo)(args, opts),
    captureStill: (dst, screenIndex) => (0, peekaboo_1.shoot)(dst, screenIndex),
    // Electron is required LAZILY so this module stays loadable under plain node
    // for the unit tests, exactly as peekaboo.ts does it. A top-level
    // import would drag Electron into the test's module graph through the back door.
    isTrustedAccessibilityClient: (prompt) => {
        const { systemPreferences } = require("electron");
        return systemPreferences.isTrustedAccessibilityClient(prompt);
    },
    openExternal: (url) => {
        const { shell } = require("electron");
        shell.openExternal(url).catch(() => { });
    },
    nextShotPath,
    nextScreenShotPath,
    cursorDisplayId: () => {
        try {
            const { screen } = require("electron");
            // `Display.id` on macOS IS the CGDirectDisplayID peekaboo reports as
            // `displayID`, which is the only field the two enumerations share.
            return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
        }
        catch {
            // Reached when `screen` is touched before app-ready or a display is being
            // torn down mid-read. Null means "fall back to display 0", never a throw on
            // the capture path.
            return null;
        }
    },
    onDisplaysChanged: (cb) => {
        try {
            const { screen } = require("electron");
            // All THREE events, unlike mascot-overlay.ts's two: that controller only
            // needs to re-clamp a rectangle, which an ADDED display cannot invalidate,
            // while a display→index map is exactly what plugging a monitor in renders
            // wrong — peekaboo renumbers its indices around the new one.
            screen.on("display-added", cb);
            screen.on("display-removed", cb);
            screen.on("display-metrics-changed", cb);
        }
        catch { /* no subscription: a stale map resolves to a miss, then to display 0 */ }
    },
    now: () => Date.now(),
    homedir: () => node_os_1.default.homedir(),
    realpath: (p) => node_fs_1.default.realpathSync(p),
    stat: (p) => {
        try {
            const st = node_fs_1.default.statSync(p);
            return { isFile: st.isFile(), isDirectory: st.isDirectory(), mode: st.mode };
        }
        catch {
            return null;
        }
    },
    openUrl: (url) => {
        const { shell } = require("electron");
        return shell.openExternal(url);
    },
    openPath: (p) => {
        const { shell } = require("electron");
        return shell.openPath(p);
    },
    clipboard: {
        readText: () => require("electron").clipboard.readText(),
        writeText: (text) => require("electron").clipboard.writeText(text),
        formats: () => require("electron").clipboard.availableFormats(),
    },
});
const getOsStatus = () => real.getOsStatus();
exports.getOsStatus = getOsStatus;
const requestAccessibility = () => real.requestAccessibility();
exports.requestAccessibility = requestAccessibility;
const osSee = (app) => real.osSee(app);
exports.osSee = osSee;
const osAct = (action) => real.osAct(action);
exports.osAct = osAct;
const osInspect = (what) => real.osInspect(what);
exports.osInspect = osInspect;
/** The always-on screen look. Deliberately NOT part of the `mascot-os:*` tier —
 *  see `ScreenCaptureResult` for the boundary this keeps. */
const captureScreen = () => real.captureScreen();
exports.captureScreen = captureScreen;
