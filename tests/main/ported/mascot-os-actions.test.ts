// Ported from canvas (mascot-os-actions.test.ts) with the code it tests; paths and names adjusted.
/**
 * The desktop tier's main-process half.
 *
 * Every case here is a way this module could hand the renderer something that
 * looks like a safe answer and is not:
 *
 *  - a STATUS READ that raises the system Accessibility prompt. The Settings
 *    panel calls `mascot-os:status` on every open, so one `true` in the wrong
 *    place turns "the user opened Settings" into "macOS asked for Accessibility",
 *    which is exactly the side effect recording.md's read-only rule forbids.
 *  - a SUPPORTED-LOOKING status on a machine where nothing can run, which puts a
 *    Grant button in front of a user for whom no grant exists.
 *  - an ELEMENT MAP capped by plain truncation. Peekaboo emits the AX tree in
 *    traversal order, so the first 80 rows of a real window are chrome and
 *    labels — and a secure text field that falls off the end does not read to
 *    the dispatcher as "secure", it reads as "unknown", which is the branch that
 *    lets `os_type` run (rule 6).
 *  - argv that means something other than what the user approved: a coordinate
 *    click without `--global` lands in window space, an unvalidated point clicks
 *    0,0 (the Apple menu), a refusal reported as "peekaboo unavailable" hides a
 *    renderer bug.
 *
 * No spawning and no Electron: `createOsActions` takes an injected runner and an
 * injected `systemPreferences`, so the whole controller runs in the `node` env.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ACCESSIBILITY_PANE_URL,
  argvForAction,
  capElements,
  createOsActions,
  elementTier,
  MAX_SEE_ELEMENTS,
  OS_STATUS_CACHE_MS,
  roleKey,
  type OsAction,
  type OsActResult,
  type OsActionsApi,
  type OsActionsDeps,
  type OsElement,
} from "../../../src/main/jarvis/desktop/os-actions";
import { splitKeyChords } from "../../../src/main/jarvis/desktop/peekaboo";
import type { PeekabooInfo, ShotResult } from "../../../src/main/jarvis/desktop/peekaboo";

// ── Fakes ───────────────────────────────────────────────────────────────────

const OK_INFO: PeekabooInfo = { ok: true, bin: "/bundled/peekaboo", version: "4.2.0", source: "bundled" };
const MISSING_INFO: PeekabooInfo = {
  ok: false, bin: null, version: null, source: null,
  error: "peekaboo not found — run `npm run fetch:peekaboo` to produce the bundled binary",
};

/** A peekaboo envelope for a command that succeeded. */
const ok = (data: Record<string, unknown> = {}) => ({ success: true, data });
/** …and one for the failures peekaboo reports IN the envelope, with a zero exit. */
const fail = (code: string, message = "nope") => ({ success: false, error: { code, message } });

const permissionsEnvelope = (screen: boolean, ax: boolean) =>
  ok({
    permissions: [
      { name: "Screen Recording", isGranted: screen },
      { name: "Accessibility", isGranted: ax },
    ],
  });

/** `screen list --json`, in the shape the real binary emits (peekaboo.test.ts holds
 *  the verbatim fixture; this is the same keys, built per case). */
const screenListEnvelope = (screens: Array<{ index: number; displayID: number }>) =>
  ok({ screens, primaryIndex: 0 });

/** A successful `shoot`, as `shotFromEnvelope` would have normalised it. */
const shotOk = (path: string, widthPx = 2940, heightPx = 1912): ShotResult =>
  ({ ok: true, path, widthPx, heightPx, errorCode: null });

/** A tiny fake filesystem for `os_open_file`: path → where it really is (a
 *  symlink) and what it is. */
const FILE = { isFile: true, isDirectory: false, mode: 0o644 };
const FS: Record<string, { real?: string; stat: { isFile: boolean; isDirectory: boolean; mode: number } | null }> = {
  "/Users/me": { stat: { isFile: false, isDirectory: true, mode: 0o755 } },
  "/Users/me/notes.txt": { stat: FILE },
  "/Users/me/run.sh": { stat: { ...FILE, mode: 0o755 } },
  "/Users/me/Apps/Tool.app": { stat: { isFile: false, isDirectory: true, mode: 0o755 } },
  "/Users/me/link-out": { real: "/etc/hosts", stat: FILE },
  "/etc/hosts": { stat: FILE },
};
const CLIP: { text: string; formats: string[] } = { text: "", formats: [] };

interface Harness {
  api: OsActionsApi;
  deps: OsActionsDeps;
  runs: Array<{ args: string[]; timeoutMs?: number }>;
  /** Every still the controller asked for: the destination and the display index. */
  stills: Array<{ dst: string; screenIndex: number }>;
  /** Display-topology listeners the controller subscribed, so a test can fire one. */
  displayListeners: Array<() => void>;
  setCursorDisplay(id: number | null): void;
  /** Queue a `shoot` result (or a thrower) for the next capture; the last repeats. */
  still(r: ShotResult | (() => never)): void;
  /** Every `prompt` value `isTrustedAccessibilityClient` was called with. */
  axPrompts: boolean[];
  opened: string[];
  resolveCalls: Array<boolean | undefined>;
  setNow(ms: number): void;
  setTrusted(v: boolean): void;
  /** Queue an envelope (or a thrower) for the next run; the last one repeats. */
  reply(env: Record<string, unknown> | null | (() => never)): void;
}

function harness(over: Partial<OsActionsDeps> & { info?: PeekabooInfo; trusted?: boolean } = {}): Harness {
  const runs: Harness["runs"] = [];
  const stills: Harness["stills"] = [];
  const displayListeners: Array<() => void> = [];
  const axPrompts: boolean[] = [];
  const opened: string[] = [];
  const resolveCalls: Array<boolean | undefined> = [];
  type Reply = Record<string, unknown> | null | (() => never);
  const queue: Reply[] = [];
  type Still = ShotResult | (() => never);
  const stillQueue: Still[] = [];
  let lastStill: Still = shotOk("/shots/screen-1.jpg");
  /** The display the cursor is on. 1 is the built-in display's CGDirectDisplayID
   *  on the machine the verbatim fixtures came from. */
  let cursorId: number | null = 1;
  // Each queued reply is CONSUMED; the last one then repeats. Peeking instead of
  // shifting would leave a spent reply at the head, so a `reply()` queued after
  // a call had already used it would never be reached.
  let last: Reply = null;
  let now = 1_000_000;
  let trusted = over.trusted ?? false;
  const info = over.info ?? OK_INFO;

  const deps: OsActionsDeps = {
    platform: "darwin",
    release: "24.3.0",
    resolve: async (force) => { resolveCalls.push(force); return info; },
    run: async (args, opts) => {
      runs.push({ args, timeoutMs: opts?.timeoutMs });
      const next = queue.length ? (last = queue.shift()!) : last;
      if (typeof next === "function") next();
      return { env: (next ?? null) as Record<string, unknown> | null };
    },
    isTrustedAccessibilityClient: (prompt) => { axPrompts.push(prompt); return trusted; },
    openExternal: (url) => { opened.push(url); },
    nextShotPath: () => "/shots/see-1.png",
    nextScreenShotPath: () => "/shots/screen-1.jpg",
    captureStill: async (dst, screenIndex) => {
      stills.push({ dst, screenIndex });
      const next = stillQueue.length ? (lastStill = stillQueue.shift()!) : lastStill;
      if (typeof next === "function") next();
      return next as ShotResult;
    },
    cursorDisplayId: () => cursorId,
    onDisplaysChanged: (cb) => { displayListeners.push(cb); },
    now: () => now,
    homedir: () => "/Users/me",
    realpath: (p) => {
      if (FS[p] === undefined) throw new Error(`ENOENT ${p}`);
      return FS[p].real ?? p;
    },
    stat: (p) => FS[p]?.stat ?? null,
    openUrl: async (url) => { opened.push(`url:${url}`); },
    openPath: async (p) => { opened.push(`path:${p}`); return ""; },
    clipboard: {
      readText: () => CLIP.text,
      writeText: (t) => { CLIP.text = t; },
      formats: () => CLIP.formats,
    },
    ...over,
  };

  return {
    api: createOsActions(deps),
    deps,
    runs,
    stills,
    displayListeners,
    axPrompts,
    opened,
    resolveCalls,
    setNow: (ms) => { now = ms; },
    setTrusted: (v) => { trusted = v; },
    setCursorDisplay: (id) => { cursorId = id; },
    reply: (env) => { queue.push(env); },
    still: (r) => { stillQueue.push(r); },
  };
}

const el = (over: Partial<OsElement> & { id: string }): OsElement => ({ role: "AXStaticText", ...over });

// ── Status ──────────────────────────────────────────────────────────────────

describe("getOsStatus", () => {
  it("composes the Electron trust probe with peekaboo's permission rows", async () => {
    const h = harness({ trusted: true });
    h.reply(permissionsEnvelope(true, true));

    await expect(h.api.getOsStatus()).resolves.toEqual({
      supported: true,
      screenRecording: true,
      accessibility: true,
      peekaboo: { ok: true, version: "4.2.0" },
    });
    expect(h.runs[0].args).toEqual(["permissions", "status", "--json", "--no-remote"]);
  });

  it("NEVER passes true to isTrustedAccessibilityClient", async () => {
    // The whole point of the non-prompting variant: the Settings panel reads this
    // on every open, and `true` would greet that user with a system dialog they
    // never asked for. Only requestAccessibility is allowed to prompt.
    const h = harness();
    h.reply(permissionsEnvelope(true, true));
    await h.api.getOsStatus();
    await h.api.getOsStatus();
    expect(h.axPrompts.length).toBeGreaterThan(0);
    expect(h.axPrompts).not.toContain(true);
  });

  it("reports accessibility when only Electron says so", async () => {
    // Either source saying yes is enough — a false negative would strand the
    // feature behind a grant the user has already given.
    const h = harness({ trusted: true });
    h.reply(permissionsEnvelope(false, false));
    const s = await h.api.getOsStatus();
    expect(s.accessibility).toBe(true);
    expect(s.screenRecording).toBe(false);
  });

  it("reports accessibility when only peekaboo says so", async () => {
    const h = harness({ trusted: false });
    h.reply(permissionsEnvelope(false, true));
    await expect(h.api.getOsStatus()).resolves.toMatchObject({ accessibility: true });
  });

  it("is not supported off macOS, and asks Electron nothing there", async () => {
    // isTrustedAccessibilityClient is a macOS-only API; reaching it on win32 is
    // a crash, not a false answer.
    const h = harness({ platform: "win32" });
    const s = await h.api.getOsStatus();
    expect(s).toEqual({
      supported: false,
      screenRecording: false,
      accessibility: false,
      peekaboo: { ok: false, version: null, error: expect.stringContaining("macOS 15") },
    });
    expect(h.axPrompts).toEqual([]);
    expect(h.runs).toEqual([]);
  });

  it("is not supported below macOS 15 (Darwin 24)", async () => {
    const h = harness({ release: "23.6.0" });
    await expect(h.api.getOsStatus()).resolves.toMatchObject({ supported: false });
    expect(h.runs).toEqual([]);
  });

  it("with no binary reports the reason, still answers accessibility, and re-resolves", async () => {
    // A cached "not found" from launch must not survive the user installing the
    // binary — hence the forced second resolve on the failure path only.
    const h = harness({ info: MISSING_INFO, trusted: true });
    const s = await h.api.getOsStatus();
    expect(s.supported).toBe(false);
    expect(s.peekaboo).toEqual({ ok: false, version: null, error: MISSING_INFO.error });
    expect(s.accessibility).toBe(true);
    expect(s.screenRecording).toBe(false);
    expect(h.resolveCalls).toEqual([false, true]);
    expect(h.runs).toEqual([]);
  });

  it("does not force a re-resolve once the binary is known good", async () => {
    const h = harness();
    h.reply(permissionsEnvelope(true, true));
    await h.api.getOsStatus();
    expect(h.resolveCalls).toEqual([false]);
  });

  it("survives a peekaboo probe that throws, without caching the failure", async () => {
    const h = harness({ trusted: true });
    h.reply(() => { throw new Error("spawn EACCES"); });
    const s = await h.api.getOsStatus();
    expect(s).toMatchObject({ supported: true, screenRecording: false, accessibility: true });

    // Not cached: the usual cause is a binary just installed or replaced.
    h.reply(permissionsEnvelope(true, true));
    await expect(h.api.getOsStatus()).resolves.toMatchObject({ screenRecording: true });
    expect(h.runs).toHaveLength(2);
  });

  it("reuses the permission probe within the TTL and re-probes after it", async () => {
    // status() is read PER ACTION by the dispatcher, so a chain of 8 would spawn
    // 8 extra peekaboo processes on the path the user is watching.
    const h = harness();
    h.reply(permissionsEnvelope(true, true));
    await h.api.getOsStatus();
    await h.api.getOsStatus();
    expect(h.runs).toHaveLength(1);

    h.setNow(1_000_000 + OS_STATUS_CACHE_MS + 1);
    await h.api.getOsStatus();
    expect(h.runs).toHaveLength(2);
  });
});

// ── The grant ───────────────────────────────────────────────────────────────

describe("requestAccessibility", () => {
  it("raises the native prompt AND opens the pane when the grant is missing", async () => {
    // macOS shows that prompt at most once per bundle; after it has been
    // dismissed the pane is the only route left to the grant.
    const h = harness({ trusted: false });
    await expect(h.api.requestAccessibility()).resolves.toEqual({ granted: false });
    expect(h.axPrompts).toEqual([true]);
    expect(h.opened).toEqual([ACCESSIBILITY_PANE_URL]);
  });

  it("does not open System Settings when the grant is already in place", async () => {
    const h = harness({ trusted: true });
    await expect(h.api.requestAccessibility()).resolves.toEqual({ granted: true });
    expect(h.opened).toEqual([]);
  });

  it("is a no-op off macOS and never touches the Electron API there", async () => {
    const h = harness({ platform: "linux" });
    await expect(h.api.requestAccessibility()).resolves.toEqual({ granted: false });
    expect(h.axPrompts).toEqual([]);
    expect(h.opened).toEqual([]);
  });

  it("invalidates the cached probe so the next status read is fresh", async () => {
    const h = harness();
    h.reply(permissionsEnvelope(false, false));
    await h.api.getOsStatus();
    expect(h.runs).toHaveLength(1);

    await h.api.requestAccessibility();
    h.reply(permissionsEnvelope(true, true));
    // Same instant, so only the invalidation can explain the second probe.
    await expect(h.api.getOsStatus()).resolves.toMatchObject({ screenRecording: true });
    expect(h.runs).toHaveLength(2);
  });

  it("still reports the verdict when the deep link throws", async () => {
    const h = harness({ trusted: false, openExternal: () => { throw new Error("no handler"); } });
    await expect(h.api.requestAccessibility()).resolves.toEqual({ granted: false });
  });
});

// ── Element capping ─────────────────────────────────────────────────────────

describe("capElements", () => {
  it("leaves a short map exactly as peekaboo ordered it", () => {
    const list = [el({ id: "a" }), el({ id: "b", role: "AXButton" })];
    expect(capElements(list)).toBe(list);
  });

  it("keeps interactive controls when the tail of the tree is where they live", () => {
    // The failure this pins: peekaboo emits the AX tree in traversal order, so a
    // plain slice keeps 80 rows of window chrome and drops the Save button.
    const noise = Array.from({ length: 120 }, (_, i) => el({ id: `t${i}` }));
    const save = el({ id: "save", role: "AXButton", label: "Save" });
    const capped = capElements([...noise, save], 10);
    expect(capped).toHaveLength(10);
    expect(capped[0]).toBe(save);
    expect(capped.filter((e) => e.id === "save")).toHaveLength(1);
  });

  it("puts a secure field first of all", () => {
    // Rule 6 is checked against the elements the dispatcher was GIVEN. A password
    // field capped out of the map reads as "unknown", not "secure" — the branch
    // that lets os_type run.
    const buttons = Array.from({ length: 40 }, (_, i) => el({ id: `b${i}`, role: "AXButton" }));
    const pw = el({ id: "pw", role: "AXSecureTextField", secure: true });
    const capped = capElements([...buttons, pw], 5);
    expect(capped[0]).toBe(pw);
  });

  it("is stable within a tier", () => {
    const list = [
      el({ id: "s1" }),
      el({ id: "b1", role: "AXButton" }),
      el({ id: "s2" }),
      el({ id: "b2", role: "AXButton" }),
    ];
    expect(capElements(list, 3).map((e) => e.id)).toEqual(["b1", "b2", "s1"]);
  });

  it("defaults to the documented cap", () => {
    const list = Array.from({ length: MAX_SEE_ELEMENTS + 25 }, (_, i) => el({ id: `x${i}` }));
    expect(capElements(list)).toHaveLength(MAX_SEE_ELEMENTS);
  });

  it("tiers roles in either spelling peekaboo uses", () => {
    expect(roleKey("AXButton")).toBe("button");
    expect(elementTier(el({ id: "1", role: "AXButton" }))).toBe(1);
    expect(elementTier(el({ id: "2", role: "button" }))).toBe(1);
    expect(elementTier(el({ id: "3", role: "AXStaticText" }))).toBe(2);
    expect(elementTier(el({ id: "4", role: "AXStaticText", secure: true }))).toBe(0);
  });
});

// ── see ─────────────────────────────────────────────────────────────────────

describe("osSee", () => {
  const seeEnvelope = (elements: unknown[]) =>
    ok({
      ui_map: { application_name: "TextEdit", ui_elements: elements },
      screenshot_annotated: "/shots/see-1_annotated.png",
      window_id: 42,
      frontmost_application_name: "TextEdit",
    });

  it("targets an app, asks for a screenshot, and normalises the map", async () => {
    const h = harness();
    h.reply(seeEnvelope([
      { id: "el_1", role: "AXButton", title: "Save", is_enabled: true, bounds: { x: 1, y: 2, width: 3, height: 4 } },
    ]));

    const r = await h.api.osSee("TextEdit");
    expect(r).toEqual({
      ok: true,
      elements: [{ id: "el_1", role: "AXButton", label: "Save", bounds: { x: 1, y: 2, width: 3, height: 4 }, enabled: true }],
      screenshotPath: "/shots/see-1_annotated.png",
      app: "TextEdit",
      windowId: "42",
      frontmostApp: "TextEdit",
    });
    expect(h.runs[0].args).toEqual([
      "see", "--app", "TextEdit", "--path", "/shots/see-1.png", "--annotate", "--no-remote", "--json",
    ]);
  });

  it("uses the see deadline, not the action one, so peekaboo's own timeout wins", async () => {
    // Ours is the backstop for a wedged process; peekaboo's 20 s `see` timeout is
    // the one that produces a diagnosable envelope instead of a killed child.
    const h = harness();
    h.reply(seeEnvelope([]));
    await h.api.osSee();
    expect(h.runs[0].timeoutMs).toBe(25_000);
  });

  it("omits --app when no app is named, so peekaboo looks at the frontmost window", async () => {
    const h = harness();
    h.reply(seeEnvelope([]));
    await h.api.osSee("   ");
    expect(h.runs[0].args).not.toContain("--app");
  });

  /**
   * Finding 2. `os_type` always gets `--foreground`, so it types into whatever
   * has focus; a `see --app X` can read a window that is entirely in the
   * BACKGROUND. Only this flag lets the dispatcher tell the two apart, and it is
   * recorded from what we ASKED for, since nothing in the envelope says whether
   * the app peekaboo looked at was in front.
   */
  it("records that a targetless look was of the FOREGROUND", async () => {
    const h = harness();
    h.reply(seeEnvelope([]));
    expect((await h.api.osSee()).foreground).toBe(true);
    h.reply(seeEnvelope([]));
    // A blank app name is not a target either — the same argv, the same claim.
    expect((await h.api.osSee("   ")).foreground).toBe(true);
  });

  it("does NOT claim foreground for an app-targeted look, however the app answers", async () => {
    const h = harness();
    // The envelope says TextEdit was frontmost, and it is still not evidence
    // that WE looked at the foreground: peekaboo targets a named app through
    // Accessibility without raising it.
    h.reply(seeEnvelope([]));
    expect((await h.api.osSee("TextEdit")).foreground).toBeUndefined();
  });

  it("says nothing about the foreground when the look FAILED", async () => {
    const h = harness();
    h.reply({ success: false, error: { code: "PERMISSION_ERROR_ACCESSIBILITY", message: "denied" } });
    const r = await h.api.osSee();
    expect(r.ok).toBe(false);
    expect(r.foreground).toBeUndefined();
  });

  it("caps the element list", async () => {
    const h = harness();
    h.reply(seeEnvelope(Array.from({ length: 300 }, (_, i) => ({ id: `e${i}`, role: "AXStaticText" }))));
    const r = await h.api.osSee();
    expect(r.elements).toHaveLength(MAX_SEE_ELEMENTS);
  });

  it("falls back to the path it asked for when the envelope names no image", async () => {
    const h = harness();
    h.reply(ok({ ui_map: { ui_elements: [] } }));
    await expect(h.api.osSee()).resolves.toMatchObject({ screenshotPath: "/shots/see-1.png" });
  });

  it("still returns the map when no screenshot path could be prepared", async () => {
    const h = harness({ nextShotPath: () => null });
    h.reply(ok({ ui_map: { ui_elements: [{ id: "a", role: "AXButton" }] } }));
    const r = await h.api.osSee();
    expect(r.ok).toBe(true);
    expect(r.screenshotPath).toBeUndefined();
    expect(h.runs[0].args).not.toContain("--path");
  });

  it("carries peekaboo's error code into the single error string", async () => {
    // OsSeeResult has no errorCode field, and "permission denied" vs "no such
    // window" are different stories for the mascot to tell.
    const h = harness();
    h.reply(fail("PERMISSION_ERROR_ACCESSIBILITY", "Accessibility permission required"));
    await expect(h.api.osSee()).resolves.toEqual({
      ok: false,
      elements: [],
      error: "PERMISSION_ERROR_ACCESSIBILITY: Accessibility permission required",
    });
  });

  it("reports unparseable output rather than an empty map", async () => {
    // An empty map reads as "nothing on screen", which the user will hear as a
    // permission problem it is not.
    const h = harness();
    h.reply(null);
    await expect(h.api.osSee()).resolves.toMatchObject({ ok: false, error: expect.stringContaining("UNPARSEABLE_OUTPUT") });
  });

  it("refuses off macOS and with no binary, without running anything", async () => {
    const off = harness({ platform: "win32" });
    await expect(off.api.osSee()).resolves.toMatchObject({ ok: false, elements: [] });
    expect(off.runs).toEqual([]);

    const missing = harness({ info: MISSING_INFO });
    await expect(missing.api.osSee()).resolves.toEqual({ ok: false, elements: [], error: MISSING_INFO.error });
    expect(missing.runs).toEqual([]);
  });

  it("turns a thrown spawn into a refusal", async () => {
    const h = harness();
    h.reply(() => { throw new Error("EPERM"); });
    await expect(h.api.osSee()).resolves.toMatchObject({ ok: false, error: "EPERM" });
  });
});

// ── Action argv ─────────────────────────────────────────────────────────────

describe("argvForAction", () => {
  const argv = (a: OsAction): string[] => {
    const r = argvForAction(a);
    if ("refusal" in r) throw new Error(`unexpected refusal: ${r.refusal.errorCode}`);
    return r.args;
  };

  it("clicks by element id in the background", () => {
    // No --foreground: an element click is dispatched through Accessibility and
    // leaves the user's focus (and physical cursor) alone.
    expect(argv({ type: "os_click", target: { elementId: "el_7" } }))
      .toEqual(["click", "--on", "el_7", "--json", "--no-remote"]);
  });

  it("clicks a point in SCREEN space, with the flags peekaboo requires", () => {
    // --global or peekaboo reads --at as window-relative and clicks the wrong
    // pixel silently; --foreground because a background coordinate click with no
    // snapshot is refused outright.
    expect(argv({ type: "os_click", target: { x: 10, y: 20 }, button: "right", double: true }))
      .toEqual(["click", "--at", "10,20", "--global", "--right", "--double", "--foreground", "--json", "--no-remote"]);
  });

  it("types via --text, escaped so backslashes are not control codes", () => {
    // `peekaboo type` interprets \n itself: "C:\note" would submit a form.
    expect(argv({ type: "os_type", text: "C:\\note" }))
      .toEqual(["type", "--text", "C:\\\\note", "--foreground", "--json", "--no-remote"]);
  });

  it("keeps os_type text exactly as approved, including surrounding spaces", () => {
    expect(argv({ type: "os_type", text: "  hi  " })[2]).toBe("  hi  ");
  });

  it("splits a key sequence into separate chords", () => {
    expect(argv({ type: "os_press", keys: "cmd+s" }))
      .toEqual(["press", "cmd+s", "--foreground", "--json", "--no-remote"]);
    expect(argv({ type: "os_press", keys: "ctrl+a Delete" }))
      .toEqual(["press", "ctrl+a", "Delete", "--foreground", "--json", "--no-remote"]);
  });

  /**
   * Finding 8's argv-injection half. `keys` is the ONLY field in this union that
   * becomes several argv tokens, so it is the only one that can add an ARGUMENT
   * rather than a value: `"cmd+q --app Terminal"` builds
   * `["press","cmd+q","--app","Terminal"]`, which retargets the keystroke at an
   * app the renderer's denylist was never shown.
   */
  it("refuses a chord that would arrive as a peekaboo flag", () => {
    for (const keys of ["cmd+q --app Terminal", "--foreground", "cmd+s -x", "-"]) {
      const r = argvForAction({ type: "os_press", keys });
      expect(r).toHaveProperty("refusal");
      expect((r as { refusal: OsActResult }).refusal.errorCode).toBe("INVALID_ACTION");
    }
  });

  it("splits the chords with the SAME function pressArgs uses", () => {
    // Not a re-implementation: `argvForAction` inspects exactly the tokens that
    // become argv. A second copy of this split is what let a destructive
    // sequence past the renderer's guard (findings 1, 3, 8).
    for (const keys of ["cmd+q", "  esc   cmd+q  ", "ctrl+a Delete"]) {
      expect(argv({ type: "os_press", keys }).slice(1, 1 + splitKeyChords(keys).length))
        .toEqual(splitKeyChords(keys));
    }
  });

  it("refuses an app name that would arrive as a flag", () => {
    // `app launch` takes the name POSITIONALLY, so a leading dash is parsed as a
    // flag rather than as an application.
    const r = argvForAction({ type: "os_app", name: "--foreground", action: "launch" });
    expect((r as { refusal: OsActResult }).refusal.errorCode).toBe("INVALID_ACTION");
  });

  it("scrolls inside an element in the background, and at the pointer otherwise", () => {
    expect(argv({ type: "os_scroll", direction: "down", amount: 3, target: { elementId: "el_2" } }))
      .toEqual(["scroll", "--direction", "down", "--amount", "3", "--on", "el_2", "--json", "--no-remote"]);
    // Peekaboo's `scroll` has no coordinate flag, so a point degrades to a
    // foreground scroll wherever the pointer already is.
    expect(argv({ type: "os_scroll", direction: "up", target: { x: 5, y: 5 } }))
      .toEqual(["scroll", "--direction", "up", "--foreground", "--json", "--no-remote"]);
  });

  it("joins a menu path with peekaboo's nesting separator", () => {
    expect(argv({ type: "os_menu", app: "TextEdit", path: ["File", "Save As…"] }))
      .toEqual(["menu", "click", "--app", "TextEdit", "--path", "File > Save As…", "--json", "--no-remote"]);
  });

  it("maps each app verb to the form the shipped CLI documents", () => {
    expect(argv({ type: "os_app", name: "Safari", action: "launch" }))
      .toEqual(["app", "launch", "Safari", "--foreground", "--json", "--no-remote"]);
    expect(argv({ type: "os_app", name: "Safari", action: "focus" }))
      .toEqual(["app", "switch", "--to", "Safari", "--json", "--no-remote"]);
    // No --force and no --foreground: quitting must run the app's own
    // termination path so an unsaved-changes sheet reaches the user.
    expect(argv({ type: "os_app", name: "Safari", action: "quit" }))
      .toEqual(["app", "quit", "--app", "Safari", "--json", "--no-remote"]);
  });

  it("refuses the two actions that are not dispatched through act", () => {
    // os_point moves the mascot's own panel and NEVER clicks; routing it here
    // would turn "let me show you where that is" into an unapproved click.
    for (const a of [{ type: "os_see" }, { type: "os_point", target: { elementId: "e" } }] as OsAction[]) {
      const r = argvForAction(a);
      expect(r).toHaveProperty("refusal");
      expect((r as { refusal: { errorCode?: string } }).refusal.errorCode).toBe("UNSUPPORTED_ACTION");
    }
  });

  it("refuses malformed actions instead of building argv that means something else", () => {
    const bad: unknown[] = [
      null,
      { type: "os_nope" },
      { type: "os_click" },                                        // no target at all
      { type: "os_click", target: { x: Number.NaN, y: 3 } },       // → --at NaN,3
      { type: "os_click", target: { x: 3 } },                      // → a click at 0,0: the Apple menu
      { type: "os_type", text: "" },
      { type: "os_type" },
      { type: "os_press", keys: "   " },
      { type: "os_scroll", direction: "sideways" },
      { type: "os_menu", app: "TextEdit", path: [] },
      { type: "os_menu", path: ["File"] },
      { type: "os_app", name: "Safari", action: "erase" },
      { type: "os_app", action: "quit" },
    ];
    for (const a of bad) {
      const r = argvForAction(a as OsAction);
      expect(r, JSON.stringify(a)).toHaveProperty("refusal");
    }
  });
});

// ── act ─────────────────────────────────────────────────────────────────────

describe("osAct", () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it("runs the argv for the action on the action deadline", async () => {
    h.reply(ok({ clicked: true }));
    await expect(h.api.osAct({ type: "os_click", target: { elementId: "el_7" } })).resolves.toEqual({ ok: true });
    expect(h.runs[0]).toEqual({ args: ["click", "--on", "el_7", "--json", "--no-remote"], timeoutMs: 10_000 });
  });

  it("returns no payload on success, only the verdict", async () => {
    h.reply(ok({ element: { id: "x" }, extra: "peekaboo's own shape" }));
    await expect(h.api.osAct({ type: "os_press", keys: "cmd+s" })).resolves.toEqual({ ok: true });
  });

  it("keeps peekaboo's error code verbatim for the transcript", async () => {
    // "no permission" and "that button moved" ask for very different next steps,
    // and rule 9 puts this string in front of the brain.
    h.reply(fail("ELEMENT_NOT_FOUND", "No element with id el_7"));
    await expect(h.api.osAct({ type: "os_click", target: { elementId: "el_7" } })).resolves.toEqual({
      ok: false, errorCode: "ELEMENT_NOT_FOUND", error: "No element with id el_7",
    });
  });

  it("reports a zero-exit refusal as a failure", async () => {
    // Peekaboo reports failures IN the envelope; an exit code alone cannot tell
    // "denied" from "done".
    h.reply(fail("PERMISSION_ERROR_ACCESSIBILITY"));
    await expect(h.api.osAct({ type: "os_type", text: "hello" })).resolves.toMatchObject({ ok: false });
  });

  it("reports unparseable output rather than assuming success", async () => {
    h.reply(null);
    await expect(h.api.osAct({ type: "os_type", text: "hello" })).resolves.toMatchObject({
      ok: false, errorCode: "UNPARSEABLE_OUTPUT",
    });
  });

  it("turns a thrown spawn into SPAWN_FAILED", async () => {
    h.reply(() => { throw new Error("ENOENT"); });
    await expect(h.api.osAct({ type: "os_menu", app: "TextEdit", path: ["File", "Save"] })).resolves.toEqual({
      ok: false, errorCode: "SPAWN_FAILED", error: "ENOENT",
    });
  });

  it("refuses a malformed action BEFORE resolving the binary", async () => {
    // Otherwise a renderer bug reports as "peekaboo unavailable" on any machine
    // where the CLI happens to be missing too, and gets chased in the wrong file.
    const r = await h.api.osAct({ type: "os_click" } as unknown as OsAction);
    expect(r).toMatchObject({ ok: false, errorCode: "INVALID_ACTION" });
    expect(h.resolveCalls).toEqual([]);
    expect(h.runs).toEqual([]);
  });

  it("refuses when the binary is missing, and when the platform cannot run it", async () => {
    const missing = harness({ info: MISSING_INFO });
    await expect(missing.api.osAct({ type: "os_press", keys: "cmd+s" })).resolves.toEqual({
      ok: false, errorCode: "PEEKABOO_UNAVAILABLE", error: MISSING_INFO.error,
    });
    expect(missing.runs).toEqual([]);

    const off = harness({ platform: "win32" });
    await expect(off.api.osAct({ type: "os_press", keys: "cmd+s" })).resolves.toMatchObject({
      ok: false, errorCode: "NOT_SUPPORTED",
    });
    expect(off.runs).toEqual([]);
  });

  it("never routes os_see or os_point to the CLI", async () => {
    await expect(h.api.osAct({ type: "os_point", target: { elementId: "e" } })).resolves.toMatchObject({
      ok: false, errorCode: "UNSUPPORTED_ACTION",
    });
    expect(h.runs).toEqual([]);
  });

  it("does not enforce the renderer's safety rules", async () => {
    // Deliberate, and the reason the dispatcher owns them: main has no user to
    // confirm with, no turn to scope "run the rest of this task" to, and — since
    // os_type carries no target and peekaboo's element schema has no focused
    // flag — no way to know which field would receive the keystrokes. This test
    // exists so that a future reader who expects a denylist here finds the
    // answer instead of adding a half one.
    h.reply(ok());
    await expect(h.api.osAct({ type: "os_app", name: "1Password", action: "quit" })).resolves.toEqual({ ok: true });
    h.reply(ok());
    await expect(h.api.osAct({ type: "os_type", text: "hunter2" })).resolves.toEqual({ ok: true });
  });
});

// ── Always-on screen vision ─────────────────────────────────────────────────

/**
 * `captureScreen` is the one path here that runs with NO user consent beyond the
 * mascot being switched on, so every case below is about the two properties that
 * make that acceptable:
 *
 *  - it returns an IMAGE AND NOTHING ELSE. The desktop tier's consent gate exists
 *    to protect the ELEMENT MAP — the secure-field refusal, os_point's bounds and
 *    the only element ids the model may click all read from it — so an always-on
 *    capture that ever produced elements would feed those rules from a look the
 *    user never opted into. `--no-elements` is what makes that true, and the test
 *    for it is that this path never spawns anything but `screen list`.
 *  - it needs Screen Recording and nothing else. Touching `axTrusted()` or the
 *    permissions probe here would demand the desktop tier's grant for a feature
 *    that injects nothing, so neither may appear on this path at all.
 *
 * And one that makes it USABLE: it never rejects. The renderer awaits this inside
 * a mascot turn, where an unhandled rejection takes the turn and the bubble.
 */
describe("captureScreen", () => {
  const TWO_DISPLAYS = screenListEnvelope([
    { index: 0, displayID: 1 },
    { index: 1, displayID: 724_003_355 },
  ]);

  it("returns the still, its size, and nothing that could feed the element map", async () => {
    const h = harness();
    h.reply(TWO_DISPLAYS);
    h.still(shotOk("/shots/screen-1.jpg"));

    const r = await h.api.captureScreen();
    expect(r).toEqual({ ok: true, path: "/shots/screen-1.jpg", width: 2940, height: 1912 });
    // No `see`, no element dump, no permissions probe — the ONLY spawn this path
    // is allowed is the display enumeration.
    expect(h.runs.map((run) => run.args[0])).toEqual(["screen"]);
    expect(h.stills).toHaveLength(1);
  });

  it("writes to the .jpg helper, never the see path's .png name", async () => {
    // `screenStillArgs` hardcodes `--format jpg` while `nextShotPath` hardcodes
    // `.png`, and peekaboo REFUSES that pair — MEASURED on 4.2.0: "INVALID_ARGUMENT
    // — Invalid value './x.png' for path: Conflicts with --format jpg". Sharing one
    // helper does not mislabel a file, it fails every capture on every machine.
    const h = harness();
    h.reply(TWO_DISPLAYS);
    await h.api.captureScreen();
    expect(h.stills[0].dst).toBe("/shots/screen-1.jpg");
  });

  it("never reads the Accessibility grant", async () => {
    // The load-bearing difference from `osSee`. Gating an image-only capture on
    // Accessibility would demand the desktop tier's grant for a path that injects
    // nothing and traverses no AX tree.
    const h = harness({ trusted: false });
    h.reply(TWO_DISPLAYS);
    await expect(h.api.captureScreen()).resolves.toMatchObject({ ok: true });
    expect(h.axPrompts).toEqual([]);
  });

  it("photographs the display the CURSOR is on, not display 0", async () => {
    // On a two-monitor desk the editor is routinely on the display the user is
    // NOT talking about, and a hardcoded index 0 captures that one every time.
    const h = harness();
    h.setCursorDisplay(724_003_355);
    h.reply(TWO_DISPLAYS);
    await h.api.captureScreen();
    expect(h.stills[0].screenIndex).toBe(1);
  });

  it("falls back to display 0 when the cursor's display is not in the list", async () => {
    const h = harness();
    h.setCursorDisplay(999);
    h.reply(TWO_DISPLAYS);
    await h.api.captureScreen();
    expect(h.stills[0].screenIndex).toBe(0);
  });

  it("does not even enumerate when Electron cannot name the cursor's display", async () => {
    const h = harness();
    h.setCursorDisplay(null);
    await h.api.captureScreen();
    expect(h.stills[0].screenIndex).toBe(0);
    expect(h.runs).toEqual([]);
  });

  it("caches the enumeration, and drops it on a display hot-plug", async () => {
    // 59 ms measured, per utterance, to answer a question that only changes when
    // a monitor is plugged in — on the latency path this whole feature exists to
    // shorten.
    const h = harness();
    h.reply(TWO_DISPLAYS);
    await h.api.captureScreen();
    await h.api.captureScreen();
    expect(h.runs).toHaveLength(1);

    // Subscribed exactly once, however many captures run.
    expect(h.displayListeners).toHaveLength(1);
    for (const cb of h.displayListeners) cb();
    await h.api.captureScreen();
    expect(h.runs).toHaveLength(2);
  });

  it("does not cache a failed or empty enumeration", async () => {
    // Caching either would pin every later capture to display 0 for the rest of
    // the session — the exact failure the cursor lookup exists to avoid.
    const h = harness();
    h.setCursorDisplay(724_003_355);
    h.reply(fail("TIMEOUT"));
    await h.api.captureScreen();
    expect(h.stills[0].screenIndex).toBe(0);

    h.reply(ok({ screens: [] }));
    await h.api.captureScreen();
    expect(h.runs).toHaveLength(2);

    h.reply(TWO_DISPLAYS);
    await h.api.captureScreen();
    expect(h.stills[2].screenIndex).toBe(1);
  });

  it("carries peekaboo's own failure code into the error string", async () => {
    // A denied Screen Recording grant is the failure this path actually meets,
    // and the mascot has to be able to say which one it was.
    const h = harness();
    h.reply(TWO_DISPLAYS);
    h.still({ ok: false, path: null, widthPx: null, heightPx: null, errorCode: "PERMISSION_ERROR_SCREEN_RECORDING", error: "no grant" });
    await expect(h.api.captureScreen()).resolves.toEqual({
      ok: false, error: "PERMISSION_ERROR_SCREEN_RECORDING: no grant",
    });
  });

  it("omits the size when peekaboo did not report one", async () => {
    // Omitted rather than zeroed, so a consumer can tell "not reported" from a
    // capture that really is 0 wide.
    const h = harness();
    h.reply(TWO_DISPLAYS);
    h.still({ ok: true, path: "/shots/screen-1.jpg", widthPx: null, heightPx: null, errorCode: null });
    await expect(h.api.captureScreen()).resolves.toEqual({ ok: true, path: "/shots/screen-1.jpg" });
  });

  it("resolves a refusal for every failure, and never rejects", async () => {
    // This is awaited inside a mascot turn: an unhandled rejection there takes
    // the turn and the bubble with it, so there is no failure that may throw.
    const off = harness({ platform: "win32" });
    await expect(off.api.captureScreen()).resolves.toMatchObject({ ok: false });
    expect(off.stills).toEqual([]);

    const old = harness({ release: "23.6.0" });
    await expect(old.api.captureScreen()).resolves.toMatchObject({ ok: false });

    const missing = harness({ info: MISSING_INFO });
    await expect(missing.api.captureScreen()).resolves.toEqual({ ok: false, error: MISSING_INFO.error });
    expect(missing.stills).toEqual([]);

    // No writable path is FATAL here, unlike a look: the image is the whole
    // payload, so there is nothing left to return without one.
    const noPath = harness({ nextScreenShotPath: () => null });
    await expect(noPath.api.captureScreen()).resolves.toMatchObject({ ok: false });
    expect(noPath.stills).toEqual([]);

    const threw = harness();
    threw.reply(TWO_DISPLAYS);
    threw.still(() => { throw new Error("ENOENT"); });
    await expect(threw.api.captureScreen()).resolves.toEqual({ ok: false, error: "ENOENT" });

    // A cursor read that throws (the `screen` module touched mid-teardown) is a
    // fallback to display 0, not a failed capture.
    const noCursor = harness({ cursorDisplayId: () => { throw new Error("not ready"); } });
    await expect(noCursor.api.captureScreen()).resolves.toMatchObject({ ok: true });
    expect(noCursor.stills[0].screenIndex).toBe(0);

    // …and so is a subscription the host cannot make.
    const noWatch = harness({ onDisplaysChanged: () => { throw new Error("not ready"); } });
    noWatch.reply(TWO_DISPLAYS);
    await expect(noWatch.api.captureScreen()).resolves.toMatchObject({ ok: true });

    // A screen-list spawn that throws must not take the capture with it.
    const noList = harness({ run: async () => { throw new Error("spawn EACCES"); } });
    await expect(noList.api.captureScreen()).resolves.toMatchObject({ ok: true });
    expect(noList.stills[0].screenIndex).toBe(0);
  });
});

// ── The module's own singleton ──────────────────────────────────────────────

describe("module exports", () => {
  it("exposes the five IPC entry points", async () => {
    const mod = await import("../../../src/main/jarvis/desktop/os-actions");
    for (const name of ["getOsStatus", "requestAccessibility", "osSee", "osAct", "captureScreen"] as const) {
      expect(typeof mod[name], name).toBe("function");
    }
  });

  it("loads with no Electron in the module graph", () => {
    // Electron is required lazily inside the real deps, so importing this file
    // under plain node (as every main-process unit test does) must not throw.
    expect(() => vi.resetModules()).not.toThrow();
  });
});

// The vision channel's ROUTING (mascot-vision:capture → captureScreen, never
// osSee) is asserted behaviourally in mascot-os-ipc.test.ts, against
// electron/mascot/os-ipc.ts — the file that registers it here.

describe("the actions main does itself — URL, file, clipboard", () => {
  beforeEach(() => {
    CLIP.text = "";
    CLIP.formats = [];
  });

  it("os_drag is peekaboo's drag, foreground, one argv value per end", () => {
    const built = argvForAction({ type: "os_drag", from: { elementId: "B7" }, to: { x: 10, y: 20 } });
    expect(built).toEqual({ args: ["drag", "--from", "B7", "--to", "10,20", "--duration", "450", "--foreground", "--json", "--no-remote"] });
    expect(argvForAction({ type: "os_drag", from: { elementId: "-x" }, to: { x: 1, y: 1 } })).toMatchObject({ refusal: { errorCode: "INVALID_ACTION" } });
    expect(argvForAction({ type: "os_drag", from: { x: Number.NaN, y: 1 }, to: { x: 1, y: 1 } } as never)).toMatchObject({ refusal: { errorCode: "INVALID_ACTION" } });
  });

  it("opens an http(s) address and nothing else — never through peekaboo", async () => {
    const h = harness();
    await expect(h.api.osAct({ type: "os_open_url", url: "https://example.com/x" })).resolves.toEqual({ ok: true });
    expect(h.opened).toEqual(["url:https://example.com/x"]);
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "https://u:p@example.com", "nope"]) {
      await expect(h.api.osAct({ type: "os_open_url", url })).resolves.toMatchObject({ ok: false, errorCode: "INVALID_ACTION" });
    }
    expect(h.opened).toHaveLength(1);
    expect(h.runs).toEqual([]);
  });

  it("measures a file: inside home or not (symlinks resolved), there or not, a program or not", async () => {
    const h = harness();
    await expect(h.api.osInspect({ kind: "file", path: "~/notes.txt" })).resolves.toEqual({
      ok: true, kind: "file", path: "/Users/me/notes.txt", insideHome: true, exists: true, program: false,
    });
    await expect(h.api.osInspect({ kind: "file", path: "/Users/me/run.sh" })).resolves.toMatchObject({ insideHome: true, program: true });
    await expect(h.api.osInspect({ kind: "file", path: "~/Apps/Tool.app" })).resolves.toMatchObject({ insideHome: true, program: true });
    // A link inside home that points out of it is OUTSIDE.
    await expect(h.api.osInspect({ kind: "file", path: "~/link-out" })).resolves.toMatchObject({ path: "/etc/hosts", insideHome: false });
    await expect(h.api.osInspect({ kind: "file", path: "/etc/hosts" })).resolves.toMatchObject({ insideHome: false });
    await expect(h.api.osInspect({ kind: "file", path: "~/missing.txt" })).resolves.toMatchObject({ insideHome: true, exists: false });
    // The home folder itself is not "inside" it.
    await expect(h.api.osInspect({ kind: "file", path: "~" })).resolves.toMatchObject({ insideHome: false });
    await expect(h.api.osInspect({ kind: "file", path: "relative/x" })).resolves.toMatchObject({ ok: false });
    await expect(h.api.osInspect({ kind: "nothing" })).resolves.toMatchObject({ ok: false });
  });

  it("opens a file inside home, and re-checks that itself — the renderer's measurement is not trusted", async () => {
    const h = harness();
    await expect(h.api.osAct({ type: "os_open_file", path: "~/notes.txt" })).resolves.toEqual({ ok: true });
    await expect(h.api.osAct({ type: "os_open_file", path: "~/link-out" })).resolves.toMatchObject({ ok: false, errorCode: "OUTSIDE_HOME" });
    await expect(h.api.osAct({ type: "os_open_file", path: "/etc/hosts" })).resolves.toMatchObject({ ok: false, errorCode: "OUTSIDE_HOME" });
    await expect(h.api.osAct({ type: "os_open_file", path: "~/missing.txt" })).resolves.toMatchObject({ ok: false, errorCode: "NOT_FOUND" });
    expect(h.opened).toEqual(["path:/Users/me/notes.txt"]);
  });

  it("reads the clipboard's text, and never a concealed (password) item", async () => {
    const h = harness();
    CLIP.text = "hello";
    await expect(h.api.osInspect({ kind: "clipboard" })).resolves.toEqual({ ok: true, kind: "clipboard", hasText: true, concealed: false });
    await expect(h.api.osAct({ type: "os_clipboard_read" })).resolves.toEqual({ ok: true, text: "hello" });
    CLIP.formats = ["public.utf8-plain-text", "org.nspasteboard.ConcealedType"];
    CLIP.text = "hunter2";
    await expect(h.api.osInspect({ kind: "clipboard" })).resolves.toMatchObject({ concealed: true });
    const read = await h.api.osAct({ type: "os_clipboard_read" });
    expect(read).toMatchObject({ ok: false, errorCode: "CONCEALED" });
    expect(JSON.stringify(read)).not.toContain("hunter2");
  });

  it("writes the clipboard exactly", async () => {
    const h = harness();
    await expect(h.api.osAct({ type: "os_clipboard_write", text: "  two spaces " })).resolves.toEqual({ ok: true });
    expect(CLIP.text).toBe("  two spaces ");
    await expect(h.api.osAct({ type: "os_clipboard_write", text: "" })).resolves.toMatchObject({ ok: false, errorCode: "INVALID_ACTION" });
  });

  it("os_wait never reaches main as an act", async () => {
    const h = harness();
    await expect(h.api.osAct({ type: "os_wait", ms: 100 })).resolves.toMatchObject({ ok: false, errorCode: "UNSUPPORTED_ACTION" });
    expect(h.runs).toEqual([]);
  });
});
