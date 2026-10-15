"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DRAG_DURATION_MS = exports.TIMEOUT_MS = void 0;
exports.parsePeekabooVersion = parsePeekabooVersion;
exports.isVersionSupported = isVersionSupported;
exports.darwinMajor = darwinMajor;
exports.isDarwinSupported = isDarwinSupported;
exports.parseEnvelope = parseEnvelope;
exports.shotFromEnvelope = shotFromEnvelope;
exports.screenStillArgs = screenStillArgs;
exports.permissionsArgs = permissionsArgs;
exports.screenListArgs = screenListArgs;
exports.seeArgs = seeArgs;
exports.clickArgs = clickArgs;
exports.escapeTypeText = escapeTypeText;
exports.typeArgs = typeArgs;
exports.splitKeyChords = splitKeyChords;
exports.pressArgs = pressArgs;
exports.scrollArgs = scrollArgs;
exports.menuClickArgs = menuClickArgs;
exports.appArgs = appArgs;
exports.dragArgs = dragArgs;
exports.windowListArgs = windowListArgs;
exports.resultFromEnvelope = resultFromEnvelope;
exports.permissionsFromEnvelope = permissionsFromEnvelope;
exports.screensFromEnvelope = screensFromEnvelope;
exports.normaliseBounds = normaliseBounds;
exports.isSecureElement = isSecureElement;
exports.normaliseElement = normaliseElement;
exports.seeFromEnvelope = seeFromEnvelope;
exports.setPeekabooDownloadRoot = setPeekabooDownloadRoot;
exports.peekabooDownloadDir = peekabooDownloadDir;
exports.resolvePeekaboo = resolvePeekaboo;
exports.createStreamText = createStreamText;
exports.runPeekaboo = runPeekaboo;
exports.shoot = shoot;
/**
 * The Peekaboo CLI (downloaded by Set up; bundled only in a dev checkout): resolution, argv construction, and envelope parsing.
 *
 * Peekaboo (https://github.com/openclaw/Peekaboo, MIT) is a macOS 15+ Swift CLI with two
 * surfaces this app uses:
 *
 *  - SCREEN CAPTURE (`screenStillArgs`/`shoot`) — captures a display to a file in one
 *    shot, with no per-take source picker (the getDisplayMedia path raises one — main.ts
 *    setDisplayMediaRequestHandler). Here it is the mascot's always-on screen vision,
 *    `os-actions.ts::captureScreen`.
 *  - ACCESSIBILITY (`seeArgs`, `clickArgs`, `typeArgs`, …) — the element map + synthetic
 *    input that the mascot's desktop tier drives. Everything here is argv-only: the
 *    gating, the confirmation and the refusals live above this module, in
 *    `electron/mascot/os-actions.ts` and the renderer's mascot dispatcher.
 *
 * WHAT IT DOES NOT REMOVE, despite the pitch: the macOS Screen Recording TCC grant. No
 * API can capture a screen without it. What MEASURED TRUE on macOS 26.5.2 is better than
 * feared, though — a peekaboo spawned as a direct child of Electron main is attributed by
 * TCC to the RESPONSIBLE PROCESS, i.e. the app bundle, so it rides the grant the user has
 * already given and raises no new dialog and no new System Settings row. Verified twice:
 * `permissions status` reported Screen Recording granted for a binary that had never run
 * on the machine, and a capture from Electron main returned real pixels in 365 ms.
 *
 * That inheritance is why `--no-remote` is NOT optional here. It forces local, in-process
 * execution; routing through a Bridge daemon would make the daemon the capturing process
 * and its own TCC grant the one that matters, which is a different (and unowned) identity.
 * It applies to the Accessibility surface for exactly the same reason — a Bridge-hosted
 * `click` is dispatched by the daemon, so the daemon is the process macOS checks against
 * the Accessibility grant the user gave *this app*.
 *
 * (Measured in ui-editor, where this module was written and from which it is ported
 * whole; the mechanism is the app bundle being the responsible process, not anything
 * ui-editor-specific.)
 *
 * Electron is imported LAZILY and defensively (through `createRequire`, since the main
 * process is an ES module here — the same device magiccast/ffmpeg.ts uses) so this module
 * stays unit-testable under plain node, which is also why every argv builder below is a pure exported
 * function tested without spawning anything — the same shape as magiccast/ffmpeg.ts.
 */
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_module_1 = require("node:module");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_string_decoder_1 = require("node:string_decoder");
/** Peekaboo's `see --json` envelope stabilised at 4.x; below that we would be guessing
 *  at the shape of `data.files[]`, so refuse rather than half-work. Mirrors magiccast/ffmpeg.ts's
 *  MIN_MAJOR rationale. */
const MIN_MAJOR = 4;
/** The shipped Mach-O declares LC_BUILD_VERSION minos 15.0, so dyld REFUSES to launch it
 *  below macOS 15. This is a hard floor no runtime fallback can paper over — it is
 *  checked before spawning so the failure is a clean gate rather than a crash.
 *
 *  Expressed in DARWIN majors, not macOS ones, because the macOS numbering has a
 *  discontinuity and Darwin does not: Darwin 23 = macOS 14, Darwin 24 = macOS 15, then
 *  Apple's year-based renumbering makes Darwin 25 = macOS *26*. Any "macOS = darwin + k"
 *  formula is therefore wrong on one side of that jump — the first draft of this gate
 *  reported macOS 33 for Sequoia. Darwin 24 is exactly the macOS 15 floor. */
const MIN_DARWIN_MAJOR = 24;
/** A stuck peekaboo must never wedge a recording. Generous against the measured p95 of
 *  371 ms so a loaded machine is not mistaken for a broken one.
 *
 *  This is the SIGTERM→SIGKILL window, not the overall deadline — see TIMEOUT_MS below,
 *  which is the number that differs per surface. 3 s stays right for the grace: nothing
 *  peekaboo does on SIGTERM (closing an image destination, releasing an SCK lease) takes
 *  seconds, so a child still alive after 3 s is wedged, not busy. */
const KILL_GRACE_MS = 3000;
/**
 * Overall deadlines, per surface. Every one is deliberately LONGER than peekaboo's own
 * internal timeout for that command, because peekaboo reports its timeout IN the envelope
 * with a machine-readable code and we cannot: a SIGTERM'd child yields a truncated buffer,
 * `parseEnvelope` returns null, and a diagnosable "element detection timed out on a large
 * window" degrades into "unparseable peekaboo output". Ours is the backstop for a wedged
 * process, not the mechanism by which slow commands fail.
 */
exports.TIMEOUT_MS = {
    /** `--version` and `permissions status`: no capture, no AX traversal, no window walk.
     *  A probe that has not answered in 5 s is not slow, it is stuck — and this one runs on
     *  the app-startup path, so it must never be the thing that hangs a launch. */
    probe: 5_000,
    /** Screen stills. Unchanged from the stills backend's measured p95 of 371 ms. */
    shot: 20_000,
    /** `see` with element detection. Peekaboo's OWN default `--timeout` for see is 20 s
     *  ("Increase this if element detection regularly times out for large/complex windows"
     *  — its help text), and a full AX traversal of something like Xcode or a big Electron
     *  app is the case that actually reaches it. 25 s gives peekaboo its whole 20 s plus
     *  5 s of process-teardown slack, so its structured TIMEOUT envelope always wins the
     *  race against our kill. */
    see: 25_000,
    /** Synthetic input (click/type/press/scroll/menu/app/window). These resolve a target,
     *  maybe focus it, then dispatch — an order of magnitude cheaper than a tree dump. The
     *  plan's 10 s is comfortably above peekaboo's own per-action focus timeouts while
     *  still being short enough that a wedged click does not outlive the user's patience
     *  or the mascot turn it belongs to. */
    act: 10_000,
};
// ───────────────────────────── pure helpers ─────────────────────────────
/** Parse "Peekaboo 4.2.0 (main/809630e4e, built: …)". */
function parsePeekabooVersion(stdout) {
    const m = /Peekaboo\s+v?(\d+)\.(\d+)(?:\.(\d+))?/i.exec(stdout);
    if (!m)
        return null;
    return { version: `${m[1]}.${m[2]}${m[3] ? "." + m[3] : ""}`, major: Number(m[1]) };
}
function isVersionSupported(major) {
    return major >= MIN_MAJOR;
}
/** Darwin major from os.release() ("25.5.0" → 25). Exported for the gate's unit test —
 *  the alternative is shelling out to sw_vers on every probe. Deliberately NOT converted
 *  to a macOS version: see MIN_DARWIN_MAJOR for why that conversion has no valid formula. */
function darwinMajor(release) {
    const m = /^(\d+)\./.exec(release);
    if (!m)
        return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
}
/** Does this Darwin support the bundled binary's minos 15.0 floor? Unknown releases pass:
 *  a machine we cannot identify gets the calibration shot, which is authoritative, rather
 *  than being locked out of the feature by a parsing failure. */
function isDarwinSupported(release) {
    const d = darwinMajor(release);
    return d === null || d >= MIN_DARWIN_MAJOR;
}
/**
 * Parse a Peekaboo `--json` envelope out of stdout.
 *
 * MEASURED, and the reason this is not a one-liner: the output is PRETTY-PRINTED
 * multi-line JSON, and the key order is not stable across error kinds — `success` is the
 * last key for an INVALID_ARGUMENT failure, the second for a VALIDATION_ERROR, the first
 * for `--version`. So the obvious implementation ("scan for the first line that parses as
 * JSON with a success key") can NEVER match: no single line of a pretty-printed object is
 * valid JSON on its own. That version failed on the very first invocation and fell back
 * to video forever, silently.
 *
 * Parse the whole buffer; only if that fails, slice from the first line-initial `{` to the
 * last `}` — which is what actually tolerates a leading banner or hint line, the thing
 * line-scanning was reaching for.
 */
function parseEnvelope(stdout) {
    const whole = stdout.trim();
    if (!whole)
        return null;
    try {
        const v = JSON.parse(whole);
        return v && typeof v === "object" ? v : null;
    }
    catch { /* fall through to the slice below */ }
    const start = /^\{/m.exec(whole)?.index;
    const end = whole.lastIndexOf("}");
    if (start === undefined || end <= start)
        return null;
    try {
        const v = JSON.parse(whole.slice(start, end + 1));
        return v && typeof v === "object" ? v : null;
    }
    catch {
        return null;
    }
}
/** Normalise an envelope into a ShotResult. Kept pure and separate from the spawn so the
 *  real multi-line fixtures can be asserted without touching the filesystem. */
function shotFromEnvelope(env, fallbackPath) {
    if (!env)
        return { ok: false, path: null, widthPx: null, heightPx: null, errorCode: null, error: "unparseable peekaboo output" };
    if (env.success !== true) {
        const err = (env.error ?? {});
        return { ok: false, path: null, widthPx: null, heightPx: null, errorCode: err.code ?? null, error: err.message ?? "peekaboo reported failure" };
    }
    const data = (env.data ?? {});
    const px = data.observations?.[0]?.coordinates?.image_size_pixels;
    return {
        ok: true,
        path: data.files?.[0]?.path ?? fallbackPath,
        widthPx: px?.width ?? null,
        heightPx: px?.height ?? null,
        errorCode: null,
    };
}
/**
 * argv for one still of a whole display.
 *
 * NAMED `screenStillArgs`, not `seeArgs`: on `feat/peekaboo-stills-capture` this builder
 * owned the name, but `see` is one CLI verb with two completely different invocations,
 * and the ACCESSIBILITY one is what every caller on this branch wants (`seeArgs` below).
 * Two builders cannot share a name, and an overload taking either a path+index or an
 * options bag is the kind of signature that gets called wrong. Renaming this one is the
 * deliberate choice: when the stills branch merges, its `capture-backend.ts` call to
 * `seeArgs(dst, index)` fails to COMPILE against the object signature instead of quietly
 * building a screen-capture argv where an element dump was meant.
 *
 * Every flag is load-bearing:
 * - `--format jpg` — NOT png. Our bundled ffmpeg is a slim LGPL build carrying `mjpeg`
 *   and nothing else (measured: `-decoders` lists exactly `V....D mjpeg`), so it cannot
 *   decode a PNG and the downscale step would die on its own input.
 * - `--no-elements` — skips all accessibility traversal. The stills path needs no element
 *   map, and skipping the traversal is what keeps the shutter at ~370 ms. (Note this is
 *   no longer a claim that Accessibility is never requested anywhere in the app — the
 *   mascot's desktop tier requests it on explicit opt-in — but the CAPTURE path still
 *   must not depend on a grant the user may never have given.)
 *
 *   That last sentence used to be an assertion nobody had checked, and the mascot's
 *   always-on vision (`os-actions.ts::captureScreen`) now leans on it for every
 *   utterance, so it was MEASURED — by watching tccd rather than by revoking anyone's
 *   grant. Over one such capture, a freshly spawned peekaboo makes exactly two TCC
 *   authorization requests: `kTCCServiceListenEvent` (which a bare `screen list` makes
 *   too, so it is an unconditional startup probe, not part of capturing) and
 *   `kTCCServiceScreenCapture`. `kTCCServiceAccessibility` is never queried at all.
 *   Residual gap, stated plainly: this shows the grant is not CONSULTED on this path,
 *   on macOS 26.5.2, with both grants present — nobody has run it with Accessibility
 *   actually denied.
 * - `--no-remote` — force local execution. See the module header: routing through a
 *   Bridge daemon changes which process TCC holds responsible, which is the whole
 *   mechanism that makes this backend dialog-free.
 * - `--capture-engine cg` — the classic/CoreGraphics engine ("cg" is an alias for
 *   "classic"; Peekaboo docs/engine.md). NOTE it is NOT /usr/sbin/screencapture, which is
 *   a narrowly-scoped helper the window path may use. Explicit classic never probes or
 *   claims in-process ScreenCaptureKit, so it cannot take Peekaboo's per-user
 *   process-lifetime SCK owner lease; the default "auto" can fall through to
 *   SCScreenshotManager and would.
 */
function screenStillArgs(dst, screenIndex) {
    return [
        "see",
        "--mode", "screen",
        "--screen-index", String(Math.max(0, Math.trunc(screenIndex))),
        "--no-remote",
        "--capture-engine", "cg",
        "--no-elements",
        "--format", "jpg",
        "--path", dst,
        "--json",
    ];
}
/** argv for the read-only permission probe. Non-prompting by construction: it resolves
 *  Screen Recording through CGPreflightScreenCaptureAccess and Accessibility through
 *  AXIsProcessTrusted — the variants that do NOT raise a dialog. That matters because
 *  recording.md's rule is that a status read must never have a permission side effect
 *  (askForMediaAccess is the prompting call, which is why merely opening Settings
 *  must never reach it).
 *
 *  Its VERDICT is not trustworthy on its own, though — the stills path gates on a
 *  calibration shot instead. For the mascot's desktop tier it is one of two inputs:
 *  `systemPreferences.isTrustedAccessibilityClient(false)` is the authoritative
 *  Accessibility answer for OUR process, and this probe supplies the peekaboo-side view
 *  plus the Screen Recording row. See os-actions.ts. */
function permissionsArgs() {
    return ["permissions", "status", "--json", "--no-remote"];
}
/** argv for the display inventory. Read-only and permission-free (MEASURED: 59 ms with
 *  neither TCC grant involved), which is what lets `os-actions.ts` translate the display
 *  the CURSOR is on into the `--screen-index` `screenStillArgs` wants without ever
 *  putting a permission read on the capture path. */
function screenListArgs() {
    return ["screen", "list", "--json", "--no-remote"];
}
/**
 * argv for the ACCESSIBILITY `see` — the element map plus an annotated screenshot.
 *
 * This is a different invocation from `screenStillArgs`, not a variant of it: no
 * `--no-elements` (the map is the point), no `--capture-engine cg` (that pin exists to
 * avoid taking the SCK lease during a long recording; a one-off mascot look has no
 * recording to protect and should take peekaboo's default engine for the target), and a
 * window/app target rather than a display index.
 *
 * No `--timeout` is passed: peekaboo's own default for `see` is 20 s and TIMEOUT_MS.see
 * is deliberately set above it so peekaboo's structured timeout envelope, not our kill,
 * is what the user sees.
 */
function seeArgs(opts = {}) {
    const { app, path: dst, json = true, windowTitle } = opts;
    const annotate = opts.annotate ?? !!dst;
    const args = ["see"];
    if (app)
        args.push("--app", app);
    if (windowTitle)
        args.push("--window-title", windowTitle);
    if (dst)
        args.push("--path", dst);
    if (annotate)
        args.push("--annotate");
    args.push("--no-remote");
    if (json)
        args.push("--json");
    return args;
}
function clickArgs(opts) {
    const args = ["click"];
    if (opts.elementId) {
        args.push("--on", opts.elementId);
    }
    else if (opts.point) {
        // `--global` says the point is in screen space; without it peekaboo reads --at as
        // window-relative as soon as --app/--window-* is present, which silently clicks the
        // wrong pixel rather than failing. It requires --at, so it is only ever added here.
        args.push("--at", `${opts.point.x},${opts.point.y}`, "--global");
    }
    if (opts.app)
        args.push("--app", opts.app);
    if (opts.windowId)
        args.push("--window-id", opts.windowId);
    if (opts.button === "right")
        args.push("--right");
    if (opts.double)
        args.push("--double");
    if (opts.snapshot)
        args.push("--snapshot", opts.snapshot);
    // See ClickArgsOpts.snapshot: a coordinate click with no snapshot is refused outright
    // in the background, so it must go through the cursor or it cannot happen at all.
    if (opts.foreground ?? (!!opts.point && !opts.snapshot))
        args.push("--foreground");
    args.push("--json", "--no-remote");
    return args;
}
/**
 * Escape a string so peekaboo types it LITERALLY.
 *
 * `peekaboo type` interprets `\n`, `\t`, `\b`, `\e` and `\\` inside its text argument
 * (its own help lists them). So the eight characters `C:\note` are typed as `C:` +
 * Return + `ote` — the user asked for a Windows path and got a submitted form. Because
 * `\\` is documented as the literal-backslash escape, the transform is exactly
 * "double every backslash", and it is invertible: nothing else in the text is special.
 *
 * A REAL newline character is left alone on purpose. It survives argv untouched (we spawn
 * with no shell), and peekaboo types it as Return, which is what a multi-line paste means.
 */
function escapeTypeText(text) {
    return text.replace(/\\/g, "\\\\");
}
function typeArgs(opts) {
    // `--text` rather than the positional form: text beginning with "-" would otherwise be
    // parsed as a flag, and "-n" is a plausible thing to ask the mascot to type.
    const args = ["type", "--text", escapeTypeText(opts.text)];
    if (opts.app)
        args.push("--app", opts.app);
    if (opts.windowId)
        args.push("--window-id", opts.windowId);
    if (opts.clear)
        args.push("--clear");
    // "Without a target, --foreground is required for intentional global input." With an
    // --app target peekaboo delivers in the background and leaves the user's focus alone.
    if (opts.foreground ?? !(opts.app || opts.windowId))
        args.push("--foreground");
    args.push("--json", "--no-remote");
    return args;
}
/**
 * Split a `keys` string into the chords `press` will receive as separate argv tokens.
 *
 * THE ONLY DEFINITION OF THIS SPLIT. It is exported — and `pressArgs` below is written in
 * terms of it — because a second copy of the rule is how adversarial-review findings 1, 3
 * and 8 happened: the renderer's destructive-shortcut guard normalised the whole string
 * as ONE chord while this builder split it into a SEQUENCE, so `"esc cmd+q"` was not
 * recognised as ⌘Q and quit the frontmost app with the forced confirmation skipped.
 * Anything that has to reason about what `press` will actually do must derive its answer
 * from this function (the renderer, which cannot import main, keeps a structural copy
 * pinned to this one by a cross-realm test — see mascot-dispatch.ts's `splitOsKeyChords`).
 *
 * Note what this makes `keys` unique among the fields these builders take: it is the only
 * model-chosen string that becomes SEVERAL argv tokens, so it is the only one that can
 * introduce an extra ARGUMENT (`"cmd+q --app Terminal"` → `["press","cmd+q","--app",
 * "Terminal"]`). Every other field is pushed as a single element after its own flag, where
 * argv is already a value position and no shell is involved. os-actions.ts refuses a chord
 * that would arrive as a flag; this function does not silently drop it, because a splitter
 * that quietly discarded tokens would hide the same class of bug from the guard above it.
 */
function splitKeyChords(keys) {
    return keys.trim().split(/\s+/).filter(Boolean);
}
function pressArgs(opts) {
    // Chords are positional and a SEQUENCE is several of them, so the string is split on
    // whitespace rather than passed whole: `["press", "ctrl+a Delete"]` is one malformed
    // chord, `["press", "ctrl+a", "Delete"]` is the two-step sequence that was asked for.
    const chords = splitKeyChords(opts.keys);
    const args = ["press", ...chords];
    if (opts.app)
        args.push("--app", opts.app);
    if (opts.windowId)
        args.push("--window-id", opts.windowId);
    // "Raw chords require either explicit --foreground consent or a fresh exact-window
    // receipt… App/PID-only and targetless background press are refused." An --app alone is
    // NOT enough here (unlike `type`), so the window id is the only background key.
    if (opts.foreground ?? !opts.windowId)
        args.push("--foreground");
    args.push("--json", "--no-remote");
    return args;
}
function scrollArgs(opts) {
    const args = ["scroll", "--direction", opts.direction];
    if (opts.amount !== undefined && Number.isFinite(opts.amount)) {
        args.push("--amount", String(Math.max(1, Math.trunc(opts.amount))));
    }
    if (opts.elementId)
        args.push("--on", opts.elementId);
    if (opts.app)
        args.push("--app", opts.app);
    if (opts.foreground ?? !opts.elementId)
        args.push("--foreground");
    args.push("--json", "--no-remote");
    return args;
}
/**
 * argv for a menu item.
 *
 * The path is joined with " > ", peekaboo's documented nesting separator
 * (`--path "Format > Font > Show Fonts"`). A menu title that itself contains " > " would
 * be split wrongly — no CLI escape exists for it — so os-actions.ts should treat a
 * `menu click` failure as "path not found" and re-`see` rather than retrying.
 *
 * `--app` is mandatory in this builder even though the CLI allows targeting the frontmost
 * app with `--foreground`: "Background menu click requires --app or --pid", and a menu
 * click whose target is "whatever is in front right now" is exactly the action a
 * confirmation dialog cannot describe honestly to the user.
 */
function menuClickArgs(opts) {
    return ["menu", "click", "--app", opts.app, "--path", opts.path.join(" > "), "--json", "--no-remote"];
}
/**
 * argv for `os_app`.
 *
 * Two mappings that are not one-to-one with the verb names, both deliberate:
 *
 * - `focus` → `app switch --to <name>`. `app focus` exists, but `switch --to` is the form
 *   the shipped CLI actually documents with an example, and its validator names the flag
 *   ("Either --to or --cycle must be specified"), so it is the one we can be sure parses.
 * - `launch` → `--foreground`. Not optional: "Cold launch, open, new-instance, relaunch,
 *   and unhide require foreground=true because macOS cannot guarantee those operations
 *   will preserve the user's foreground work." Without it the launch is refused.
 *
 * `quit` gets no `--foreground` and no `--force`: quitting must let the app run its own
 * termination path, so an unsaved-changes sheet appears and the user — not the mascot —
 * decides. (`os_app quit` also always confirms, even in auto-run; that is dispatch's job.)
 */
function appArgs(opts) {
    switch (opts.action) {
        case "launch": return ["app", "launch", opts.name, "--foreground", "--json", "--no-remote"];
        case "focus": return ["app", "switch", "--to", opts.name, "--json", "--no-remote"];
        case "quit": return ["app", "quit", "--app", opts.name, "--json", "--no-remote"];
    }
}
/**
 * argv for `os_drag`. `--foreground` is not optional: "Drag always changes the
 * shared physical cursor and requires --foreground" (the 4.2.0 help). An
 * element id or an `x,y` point on each end, as `--from`/`--to` take either.
 * The duration is fixed and short enough to feel like a hand, long enough that
 * apps that watch for a drag (not a teleport) see one.
 */
exports.DRAG_DURATION_MS = 450;
function dragArgs(opts) {
    const end = (t) => t.elementId ?? `${t.point.x},${t.point.y}`;
    return [
        "drag",
        "--from", end(opts.from),
        "--to", end(opts.to),
        "--duration", String(Math.max(50, Math.round(opts.durationMs ?? exports.DRAG_DURATION_MS))),
        "--foreground",
        "--json", "--no-remote",
    ];
}
function windowListArgs(opts = {}) {
    const args = ["window", "list"];
    if (opts.app)
        args.push("--app", opts.app);
    args.push("--json", "--no-remote");
    return args;
}
/**
 * Normalise any peekaboo envelope to `{ ok, errorCode, data }`.
 *
 * NEVER throws and never infers success from an exit code: peekaboo reports failures IN
 * the envelope, and a zero exit with `"success": false` is the normal way a refusal
 * arrives. A null envelope (killed child, empty stdout, a non-JSON dyld error) is a
 * failure with a synthetic code so callers have something to switch on.
 */
function resultFromEnvelope(env) {
    if (!env)
        return { ok: false, errorCode: "UNPARSEABLE_OUTPUT", error: "unparseable peekaboo output" };
    if (env.success !== true) {
        const err = (env.error ?? {});
        return {
            ok: false,
            errorCode: err.code ?? "UNKNOWN_ERROR",
            error: err.message ?? "peekaboo reported failure",
        };
    }
    return { ok: true, data: (env.data ?? {}) };
}
/** Every permission row peekaboo knows about, normalised to a name→granted map with the
 *  names lowercased ("screen recording", "accessibility", "event synthesizing"). */
function permissionsFromEnvelope(env) {
    const r = resultFromEnvelope(env);
    if (!r.ok)
        return { ok: false, screenRecording: false, accessibility: false, errorCode: r.errorCode, error: r.error };
    const rows = Array.isArray(r.data?.permissions) ? r.data.permissions : [];
    const granted = (needle) => rows.some((p) => typeof p?.name === "string" && p.name.toLowerCase().includes(needle) && p.isGranted === true);
    return { ok: true, screenRecording: granted("screen recording"), accessibility: granted("accessibility") };
}
/**
 * Normalise a `screen list --json` envelope into the display inventory.
 *
 * VERBATIM shape, read off the shipped 4.2.0 binary on macOS 26.5.2:
 * `data.screens[] = { index, displayID, name, isPrimary, scaleFactor, bounds, … }`.
 * `displayID` is spelled with a capital ID there; the snake_case and camelCase spellings
 * are accepted too because which one arrives depends on the runtime host (the same reason
 * `seeFromEnvelope` reads `ui_map` and `uiMap`), and a wrong guess here degrades silently
 * into "always capture display 0" — right on a laptop, wrong on every desk with a second
 * monitor, and invisible in a unit test that only ever has one screen.
 *
 * A row with no usable displayID is DROPPED rather than carried with a sentinel: the map
 * built from these exists solely to be keyed by that number, and a row that cannot be
 * keyed would only ever produce a miss.
 */
function screensFromEnvelope(env) {
    const r = resultFromEnvelope(env);
    if (!r.ok)
        return { ok: false, screens: [], errorCode: r.errorCode, error: r.error };
    const rows = Array.isArray(r.data?.screens) ? r.data.screens : [];
    const screens = [];
    rows.forEach((raw, i) => {
        if (!raw || typeof raw !== "object")
            return;
        const o = raw;
        const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
        const displayId = num(o.displayID) ?? num(o.display_id) ?? num(o.displayId);
        if (displayId === null)
            return;
        // The array position is the fallback for `index`, not a replacement for it:
        // peekaboo states the index it will accept back on `--screen-index`, and only if it
        // omitted one is position the best available guess.
        const index = num(o.index) ?? i;
        const name = typeof o.name === "string" && o.name ? o.name : undefined;
        screens.push({ index: Math.max(0, Math.trunc(index)), displayId, ...(name ? { name } : {}) });
    });
    return { ok: true, screens };
}
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/**
 * Read a rectangle out of whatever shape the envelope used.
 *
 * Four spellings are accepted because the bundled binary's `bounds` encoding could not be
 * confirmed without running it (see the file's report): Swift encodes CGRect as either a
 * 4-element array or an `{origin,size}` pair depending on how the type declares Codable,
 * and peekaboo's own screen observations use the nested `[[x,y],[w,h]]` form seen in
 * `logical_bounds`. Guessing one and getting it wrong would put the mascot's pointer in
 * the corner of the screen with no error anywhere, so all four are handled and anything
 * else yields undefined rather than a rectangle at 0,0.
 */
function normaliseBounds(raw) {
    if (!raw)
        return undefined;
    if (Array.isArray(raw)) {
        if (raw.length === 4 && raw.every((n) => num(n) !== null)) {
            return { x: raw[0], y: raw[1], width: raw[2], height: raw[3] };
        }
        // [[x, y], [width, height]] — peekaboo's logical_bounds shape.
        if (raw.length === 2 && Array.isArray(raw[0]) && Array.isArray(raw[1])) {
            const [a, b] = raw;
            if ([a[0], a[1], b[0], b[1]].every((n) => num(n) !== null)) {
                return { x: a[0], y: a[1], width: b[0], height: b[1] };
            }
        }
        return undefined;
    }
    if (typeof raw !== "object")
        return undefined;
    const o = raw;
    const flat = [num(o.x), num(o.y), num(o.width), num(o.height)];
    if (flat.every((n) => n !== null)) {
        return { x: flat[0], y: flat[1], width: flat[2], height: flat[3] };
    }
    const origin = (o.origin ?? {});
    const size = (o.size ?? {});
    const nested = [num(origin.x), num(origin.y), num(size.width), num(size.height)];
    if (nested.every((n) => n !== null)) {
        return { x: nested[0], y: nested[1], width: nested[2], height: nested[3] };
    }
    return undefined;
}
/**
 * Is this element a secure text field? THE SAFETY RULE FOR `os_type` HANGS OFF THIS, and
 * it is the weakest thing in the file. Read this before relying on it.
 *
 * Peekaboo 4.2.0's `see --json` element schema — read out of the shipped binary's coding
 * keys — is exactly:
 *
 *   id, role, ax_role, title, label, value, description, role_description, help,
 *   identifier, confidence, bounds, is_actionable, is_enabled, is_selected,
 *   is_value_settable, keyboard_shortcut
 *
 * There is NO secure flag (`is_secure` appears nowhere in the binary's string table) and
 * no focused flag either. So this predicate infers it from the role, which works only if
 * peekaboo's AXTreeCollector surfaces the AXSecureTextField SUBROLE in `role`/`ax_role`
 * rather than the AXTextField role every password field also reports. The collector does
 * compare against "axsecuretextfield", but what it does with the answer is UNVERIFIED —
 * it may only redact the value.
 *
 * Consequences, which os-actions.ts and the dispatcher must both encode:
 *  - `secure: true` is trustworthy. `secure: false` means NO EVIDENCE, not "safe".
 *  - Every plausible key spelling is checked first, so a future peekaboo that does export
 *    a flag starts being believed without a code change here.
 *  - Rule 6 ("refuse os_type into a secure field") is NOT a rule about a targeted element:
 *    `os_type` carries no target at all (mascot-actions.ts's union is `{type:"os_type";
 *    text}`), and its argv gets `--foreground`, so the keystrokes go to whatever has focus
 *    on the whole screen. What is enforceable is therefore a FAIL-CLOSED check over the
 *    entire map, and that is what `secureTypeRefusal` (mascot-dispatch.ts) implements: a
 *    focused row that is secure refuses; with no focus reported, ANY secure row on screen
 *    refuses; and no map at all — or one whose evidence does not describe the app the
 *    keystrokes will reach — refuses too. `normaliseElement` below does carry a
 *    `focused` flag whenever the payload spells one (`is_focused`/`focused`), which 4.2.0
 *    does not — that branch is for the hosts and future versions that do, not dead code.
 *    Do not narrow this to a per-target rule: `os_type` can never satisfy one.
 */
function isSecureElement(raw) {
    for (const key of ["secure", "is_secure", "isSecure", "is_secure_text_field", "secureTextField"]) {
        if (raw[key] === true)
            return true;
    }
    const haystack = [raw.role, raw.ax_role, raw.axRole, raw.subrole, raw.ax_subrole, raw.role_description]
        .filter((v) => typeof v === "string")
        .join(" ")
        .toLowerCase();
    // "axsecuretextfield" is the AX constant; "secure text field" is what AXRoleDescription
    // reads as, and VoiceOver-facing descriptions are the other place it could surface.
    return haystack.includes("securetextfield") || haystack.includes("secure text");
}
/** One raw ui_elements entry → OsElement, or null if it has no usable id. */
function normaliseElement(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const o = raw;
    const id = typeof o.id === "string" && o.id ? o.id
        : typeof o.element_id === "string" && o.element_id ? o.element_id
            : typeof o.identifier === "string" && o.identifier ? o.identifier
                : null;
    // An element with no id cannot be clicked (`--on` takes the opaque id) and cannot be
    // referred to by the brain, so it is dropped rather than carried as an unusable row.
    if (!id)
        return null;
    const role = typeof o.role === "string" && o.role ? o.role
        : typeof o.ax_role === "string" && o.ax_role ? o.ax_role
            : "unknown";
    const str = (v) => (typeof v === "string" && v ? v : undefined);
    // `label` falls back through title → description: peekaboo populates whichever the app
    // exposed, and an element the model cannot name is an element it will not use.
    const label = str(o.label) ?? str(o.title) ?? str(o.description) ?? str(o.role_description);
    const bounds = normaliseBounds(o.bounds ?? o.frame ?? o.rect);
    const secure = isSecureElement(o);
    const el = { id, role };
    if (label !== undefined)
        el.label = label;
    // A secure field's value is never carried, even if peekaboo hands one over: this object
    // ends up in the mascot transcript, which is sent to the brain and may be persisted.
    if (!secure) {
        const value = str(o.value);
        if (value !== undefined)
            el.value = value;
    }
    if (bounds)
        el.bounds = bounds;
    if (typeof o.is_enabled === "boolean")
        el.enabled = o.is_enabled;
    else if (typeof o.enabled === "boolean")
        el.enabled = o.enabled;
    if (typeof o.is_focused === "boolean")
        el.focused = o.is_focused;
    else if (typeof o.focused === "boolean")
        el.focused = o.focused;
    if (secure)
        el.secure = true;
    return el;
}
/**
 * Normalise a `see --json` envelope into the element map.
 *
 * The elements live at `data.ui_map.ui_elements`; `data.elements` is accepted too because
 * the daemon/MCP path spells the same payload in camelCase. Both are tried rather than
 * picking one, since which spelling arrives depends on the runtime host and a wrong guess
 * yields a silent empty map — the mascot then reports "I don't see anything on screen",
 * which reads as a permission problem and is not.
 */
function seeFromEnvelope(env) {
    const r = resultFromEnvelope(env);
    // `data` is dropped on the failure path rather than forwarded: it is peekaboo's raw
    // shape, not an OsSeeData, and a caller that reads `.data` after ignoring `.ok` should
    // find nothing there instead of a half-populated map.
    if (!r.ok)
        return { ok: false, errorCode: r.errorCode, error: r.error, elements: [] };
    const data = r.data ?? {};
    const map = (data.ui_map ?? data.uiMap ?? {});
    const rawList = (Array.isArray(map.ui_elements) && map.ui_elements) ||
        (Array.isArray(map.elements) && map.elements) ||
        (Array.isArray(data.elements) && data.elements) ||
        [];
    const elements = rawList.map(normaliseElement).filter((e) => e !== null);
    const str = (v) => (typeof v === "string" && v ? v : undefined);
    const id = (v) => typeof v === "number" ? String(v) : (typeof v === "string" && v ? v : undefined);
    const out = { elements };
    const shot = str(data.screenshot_annotated) ?? str(data.annotatedPath)
        ?? str(data.screenshot_raw) ?? str(data.screenshotPath);
    if (shot)
        out.screenshotPath = shot;
    const app = str(map.application_name) ?? str(data.application_name);
    if (app)
        out.app = app;
    const win = id(data.window_id) ?? id(data.windowId) ?? id(map.window_id);
    if (win)
        out.windowId = win;
    const frontmost = str(data.frontmost_application_name) ?? str(data.frontmostApplicationName);
    if (frontmost)
        out.frontmostApp = frontmost;
    return { ok: true, data: out, elements };
}
// ───────────────────────────── resolution ─────────────────────────────
function platformDir() {
    return `${process.platform}-${process.arch}`;
}
/** A packaged app: the bundled copy is the only one it may run. */
function isPackagedApp() {
    try {

        const { app } = require("electron");
        return app?.isPackaged === true;
    }
    catch {
        return false;
    }
}
function bundledDir() {
    try {
        // Lazy + guarded: keeps this module loadable under plain node for unit tests.

        const { app } = require("electron");
        if (app?.isPackaged)
            return node_path_1.default.join(process.resourcesPath, "peekaboo", platformDir());
        return node_path_1.default.join(app.getAppPath(), "resources", "peekaboo", platformDir());
    }
    catch {
        return node_path_1.default.join(process.cwd(), "resources", "peekaboo", platformDir());
    }
}
/** Where Set up downloads Peekaboo to (electron/tools/peekaboo-install.ts):
 *  the app's own data folder, set by main at launch. A release no longer
 *  carries it — it was 30 MB of the DMG — so a packaged app finds it here. */
let downloadRoot = null;
function setPeekabooDownloadRoot(root) {
    downloadRoot = root;
    cached = null;
}
/** The directory a download lands in, laid out like the bundle's. */
function peekabooDownloadDir() {
    return downloadRoot ? node_path_1.default.join(downloadRoot, platformDir()) : null;
}
function usable(p) {
    if (!p)
        return false;
    try {
        node_fs_1.default.accessSync(p, node_fs_1.default.constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
async function probePath(name) {
    const r = await runRaw("/usr/bin/which", [name], { timeoutMs: exports.TIMEOUT_MS.probe }).catch(() => null);
    const first = r?.stdout.split("\n")[0]?.trim();
    return first && usable(first) ? first : null;
}
let cached = null;
/**
 * Resolve the CLI. Ladder order is env → BUNDLED → DOWNLOADED → PATH, and bundled-before-PATH is
 * deliberate: TCC tracks by code signature, so preferring a user's brew-installed copy
 * would make our capture identity depend on whether they happen to have brewed peekaboo,
 * and a brew upgrade moving the binary to a new Cellar path would silently change it
 * again between takes. The bundled copy is the only one whose signature we control.
 *
 * A PACKAGED app never reaches PATH at all: Set up downloads Peekaboo into the app's
 * data folder (the pinned, checksummed npm tarball — electron/tools/peekaboo-install.ts)
 * rather than shipping its 30 MB in the DMG, the owner's call, and a person never runs a
 * command for it. A release once showed "v4.2.0" only on a machine that happened to have
 * peekaboo on PATH; the downloaded copy is the only one a release trusts. PATH stays a
 * dev-checkout convenience only.
 */
async function resolvePeekaboo(force = false) {
    if (cached && !force)
        return cached;
    if (process.platform !== "darwin") {
        cached = { ok: false, bin: null, version: null, source: null, error: "Peekaboo is macOS-only" };
        return cached;
    }
    if (!isDarwinSupported(node_os_1.default.release())) {
        cached = { ok: false, bin: null, version: null, source: null,
            error: "Peekaboo needs macOS 15 or later" };
        return cached;
    }
    const candidates = [];
    if (process.env.TELLAFLOW_PEEKABOO_BIN)
        candidates.push({ bin: process.env.TELLAFLOW_PEEKABOO_BIN, source: "env" });
    const bd = bundledDir();
    if (bd)
        candidates.push({ bin: node_path_1.default.join(bd, "peekaboo"), source: "bundled" });
    const dd = peekabooDownloadDir();
    if (dd)
        candidates.push({ bin: node_path_1.default.join(dd, "peekaboo"), source: "downloaded" });
    let picked = null;
    for (const c of candidates)
        if (usable(c.bin)) {
            picked = c;
            break;
        }
    const packaged = isPackagedApp();
    if (!picked && !packaged) {
        const p = await probePath("peekaboo");
        if (p)
            picked = { bin: p, source: "path" };
    }
    if (!picked) {
        cached = { ok: false, bin: null, version: null, source: null,
            error: packaged
                ? "the desktop helper isn’t installed yet — install it from Settings › Assistant"
                : "peekaboo not found — install it from Settings › Assistant" };
        return cached;
    }
    try {
        const r = await runRaw(picked.bin, ["--version"], { timeoutMs: exports.TIMEOUT_MS.probe });
        const parsed = parsePeekabooVersion(r.stdout + r.stderr);
        if (!parsed) {
            cached = { ok: false, ...picked, version: null, error: "could not parse peekaboo version" };
            return cached;
        }
        if (!isVersionSupported(parsed.major)) {
            cached = { ok: false, ...picked, version: parsed.version,
                error: `peekaboo ${parsed.version} is too old (need ${MIN_MAJOR}+)` };
            return cached;
        }
        cached = { ok: true, bin: picked.bin, version: parsed.version, source: picked.source };
    }
    catch (e) {
        cached = { ok: false, ...picked, version: null, error: String(e?.message ?? e) };
    }
    return cached;
}
/**
 * Accumulate a child stream's chunks into text, decoding ACROSS chunk boundaries.
 *
 * `stdout += String(chunk)` — the obvious form, and the one this replaced — decodes each
 * Buffer on its own. A pipe hands over whatever bytes are ready (the high-water mark is
 * 64 KiB, and a big `see` map is well past it), so a boundary lands mid-character often
 * enough to matter: each half of a split UTF-8 sequence decodes to U+FFFD, and "Café"
 * reaches the model and the confirmation dialog as "Caf??" — a label that no longer
 * matches what the user is looking at on screen. The JSON stays parseable, so nothing
 * anywhere reports a problem. `StringDecoder` holds the incomplete tail back until the
 * next chunk completes it, which is exactly the missing piece.
 *
 * Exported for the test: the alternative — `stream.setEncoding("utf8")` — is a one-liner
 * that leaves the boundary behaviour untestable without spawning a real child.
 */
function createStreamText() {
    const decoder = new node_string_decoder_1.StringDecoder("utf8");
    let text = "";
    return {
        push(chunk) { text += typeof chunk === "string" ? chunk : decoder.write(chunk); },
        // `end()` flushes bytes still held back. A truncated sequence (a killed child) yields
        // U+FFFD there, which is the honest answer — those bytes never were a character.
        done() { text += decoder.end(); return text; },
    };
}
function runRaw(bin, args, opts) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = (0, node_child_process_1.spawn)(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
        }
        catch (e) {
            reject(e);
            return;
        }
        const out = createStreamText(), err = createStreamText();
        let settled = false;
        let killTimer = null;
        let deadline = null;
        // Both timers are cleared on settle. The deadline used to be left running, which kept
        // the event loop alive for its full duration after a command had already answered —
        // invisible in Electron main, but it holds a vitest worker open for 25 s per see().
        const done = (fn) => {
            if (settled)
                return;
            settled = true;
            if (killTimer)
                clearTimeout(killTimer);
            if (deadline)
                clearTimeout(deadline);
            fn();
        };
        child.stdout?.on("data", (d) => { out.push(d); });
        child.stderr?.on("data", (d) => { err.push(d); });
        child.on("error", (e) => done(() => reject(e)));
        // `close` fires after both streams have ended, so every chunk has already been pushed
        // and `done()` only has the decoder's held-back tail left to flush.
        child.on("close", (code) => done(() => resolve({ code, stdout: out.done(), stderr: err.done() })));
        // SIGTERM then SIGKILL, matching magiccast/ffmpeg.ts: a wedged child must not hold the take.
        const arm = () => {
            try {
                child.kill("SIGTERM");
            }
            catch { /* already exited */ }
            killTimer = setTimeout(() => { try {
                child.kill("SIGKILL");
            }
            catch { /* already exited */ } }, KILL_GRACE_MS);
        };
        if (opts.timeoutMs)
            deadline = setTimeout(() => { if (!settled)
                arm(); }, opts.timeoutMs);
        opts.signal?.addEventListener("abort", arm, { once: true });
    });
}
/** Run a peekaboo subcommand and return its parsed envelope. Never throws on a non-zero
 *  exit — Peekaboo reports failures IN the envelope, and the exit code alone cannot
 *  distinguish "denied" from "no such display".
 *
 *  The default timeout is NOT optional. Without one a wedged child hangs its caller
 *  forever, and on the desktop tier the caller is a mascot turn the user is watching — a
 *  turn that never ends is worse than one that fails, because Stop cannot cancel a promise
 *  that has no loser. TIMEOUT_MS.act is the floor; see/shot callers pass their own. */
async function runPeekaboo(args, opts = {}) {
    const info = await resolvePeekaboo();
    if (!info.ok || !info.bin)
        throw new Error(info.error ?? "peekaboo unavailable");
    const r = await runRaw(info.bin, args, { timeoutMs: exports.TIMEOUT_MS.act, ...opts });
    return { code: r.code, env: parseEnvelope(r.stdout), stderr: r.stderr };
}
/** Capture one still of `screenIndex` to `dst`. */
async function shoot(dst, screenIndex, opts = {}) {
    try {
        const { env } = await runPeekaboo(screenStillArgs(dst, screenIndex), { timeoutMs: exports.TIMEOUT_MS.shot, ...opts });
        return shotFromEnvelope(env, dst);
    }
    catch (e) {
        return { ok: false, path: null, widthPx: null, heightPx: null, errorCode: "SPAWN_FAILED", error: String(e?.message ?? e) };
    }
}
