// Ported from canvas (mascot-peekaboo.test.ts) with the code it tests; paths and names adjusted.
/**
 * Fixtures here come in two grades, and the difference is stated on each one.
 *
 * VERBATIM: `REAL_SUCCESS`, `REAL_INVALID_ARGUMENT`, `REAL_PERMISSIONS` are unmodified
 * output from the shipped peekaboo 4.2.0 binary, captured on macOS 26.5.2. That is not
 * fussiness: the obvious parseEnvelope implementation ("scan for the first line that
 * parses as JSON with a success key") passes every synthetic single-line fixture and can
 * NEVER match real output, because the real output is pretty-printed and no single line of
 * it is valid JSON. A synthetic fixture would have shipped a backend that fell back to
 * video on its first invocation, silently.
 *
 * Note the key order differs between the two error envelopes below — `success` is the
 * 2nd key in one and the 4th in the other. Nothing may depend on position.
 *
 * RECONSTRUCTED: `SEE_ENVELOPE` and its variants. The `see --json` element map could not
 * be captured verbatim on this branch — the binary is not vendored and the machine has no
 * Accessibility grant to dump — so its key names were read out of the shipped Mach-O's
 * CodingKey string table instead (`ui_map`, `ui_elements`, `id`, `role`, `ax_role`,
 * `label`, `value`, `bounds`, `is_enabled`, …). The SHAPE is therefore evidence-backed and
 * the VALUES are invented. Every assertion below that depends on a value peekaboo chooses
 * for us — above all the secure-field flag — is written to fail loudly rather than quietly
 * when the real binary disagrees.
 */
import { describe, it, expect } from "vitest";
import {
  parsePeekabooVersion, isVersionSupported, darwinMajor, isDarwinSupported,
  parseEnvelope, shotFromEnvelope, screenStillArgs, permissionsArgs, screenListArgs,
  seeArgs, clickArgs, typeArgs, escapeTypeText, pressArgs, splitKeyChords, scrollArgs,
  menuClickArgs, appArgs, windowListArgs,
  resultFromEnvelope, permissionsFromEnvelope, screensFromEnvelope, normaliseBounds, normaliseElement,
  isSecureElement, seeFromEnvelope, createStreamText, TIMEOUT_MS,
} from "../../../src/main/jarvis/desktop/peekaboo";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** The module's own source, for the one assertion below that is about a COMMENT.
 *  A rationale block
 *  that describes a rule the code does not implement is a defect in its own
 *  right, and the only way to keep it from coming back is to assert on it. */
const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "main", "jarvis", "desktop", "peekaboo.js"), "utf8");

const REAL_SUCCESS = `{
  "success" : true,
  "data" : {
    "files" : [
      {
        "path" : "/tmp/shots/probe.jpg",
        "mime_type" : "image\\/jpeg",
        "item_label" : "screen0"
      }
    ],
    "observations" : [
      {
        "coordinates" : {
          "logical_bounds" : [ [ 0, 0 ], [ 1470, 956 ] ],
          "image_size_pixels" : {
            "width" : 2940,
            "height" : 1912
          },
          "coordinate_space" : "global_display_points",
          "screen_index" : 0,
          "scale_factor" : 1,
          "screen_name" : "Display 0"
        }
      }
    ]
  }
}`;

const REAL_INVALID_ARGUMENT = `{
  "data" : null,
  "success" : false,
  "debug_logs" : [

  ],
  "error" : {
    "code" : "INVALID_ARGUMENT",
    "message" : "Invalid value 'bogusmode' for mode: Unknown value for CaptureMode"
  }
}`;

const REAL_PERMISSIONS = `{
  "data" : {
    "permissions" : [
      {
        "isRequired" : true,
        "name" : "Screen Recording",
        "isGranted" : true,
        "grantInstructions" : "System Settings > Privacy & Security > Screen Recording"
      }
    ],
    "source" : "local"
  },
  "debug_logs" : [
    "[2026-08-17T08:52:27.672Z] DEBUG: Runtime host: local (in-process)"
  ],
  "success" : true
}`;

/** VERBATIM `screen list --json --no-remote`, shipped 4.2.0 on macOS 26.5.2, one display.
 *  Captured on this branch specifically to settle the field spelling: `displayID` with a
 *  capital ID is the only key that joins to Electron's `Display.id`, and guessing it wrong
 *  degrades into "always capture display 0" — correct on the laptop the test runs on, and
 *  silently wrong on every desk with a second monitor. */
const REAL_SCREEN_LIST = `{
  "success" : true,
  "data" : {
    "screens" : [
      {
        "scaleFactor" : 2,
        "isPrimary" : true,
        "name" : "Built-in Display",
        "bounds" : {
          "x" : 0,
          "y" : 0,
          "height" : 956,
          "width" : 1470
        },
        "resolution" : {
          "height" : 956,
          "width" : 1470
        },
        "position" : {
          "x" : 0,
          "y" : 0
        },
        "visibleArea" : {
          "height" : 923,
          "width" : 1470
        },
        "index" : 0,
        "displayID" : 1
      }
    ],
    "primaryIndex" : 0
  },
  "debug_logs" : [
    "[2026-09-08T07:22:08.564Z] DEBUG: Runtime host: local (in-process)"
  ]
}`;

/** Both rows, so the two-permission composition os-actions.ts needs is covered. */
const PERMISSIONS_BOTH = `{
  "data" : {
    "permissions" : [
      { "isRequired" : true, "name" : "Screen Recording", "isGranted" : true },
      { "isRequired" : true, "name" : "Accessibility", "isGranted" : true },
      { "isRequired" : false, "name" : "Event Synthesizing", "isGranted" : false }
    ],
    "source" : "local"
  },
  "success" : true
}`;

/**
 * RECONSTRUCTED (see the file header). Pretty-printed in peekaboo's own style so the
 * whole-buffer parse is still what is being exercised.
 */
const SEE_ENVELOPE = `{
  "success" : true,
  "data" : {
    "snapshot_id" : "snap_8812",
    "screenshot_raw" : "/tmp/see/raw.png",
    "screenshot_annotated" : "/tmp/see/annotated.png",
    "frontmost_application_name" : "Safari",
    "window_id" : 12345,
    "ui_map" : {
      "application_name" : "Safari",
      "window_title" : "Sign in",
      "element_count" : 4,
      "interactable_count" : 3,
      "ui_elements" : [
        {
          "id" : "B1",
          "role" : "AXButton",
          "ax_role" : "AXButton",
          "label" : "Sign In",
          "bounds" : { "x" : 100, "y" : 220, "width" : 80, "height" : 32 },
          "is_enabled" : true,
          "is_actionable" : true
        },
        {
          "id" : "T1",
          "role" : "AXTextField",
          "ax_role" : "AXTextField",
          "label" : "Email",
          "value" : "sahil@example.com",
          "bounds" : { "x" : 100, "y" : 140, "width" : 240, "height" : 24 },
          "is_enabled" : true
        },
        {
          "id" : "T2",
          "role" : "AXSecureTextField",
          "ax_role" : "AXTextField",
          "role_description" : "secure text field",
          "label" : "Password",
          "value" : "hunter2",
          "bounds" : { "x" : 100, "y" : 180, "width" : 240, "height" : 24 },
          "is_enabled" : true
        },
        {
          "role" : "AXStaticText",
          "label" : "no id — unusable"
        }
      ]
    }
  }
}`;

describe("parseEnvelope", () => {
  it("parses real pretty-printed success output", () => {
    const env = parseEnvelope(REAL_SUCCESS);
    expect(env?.success).toBe(true);
  });

  it("parses a real error envelope where `success` is NOT the first key", () => {
    const env = parseEnvelope(REAL_INVALID_ARGUMENT);
    expect(env?.success).toBe(false);
    expect((env?.error as { code: string }).code).toBe("INVALID_ARGUMENT");
  });

  it("parses a real envelope where `success` is the LAST key", () => {
    const env = parseEnvelope(REAL_PERMISSIONS);
    expect(env?.success).toBe(true);
  });

  it("no line of real output is itself valid JSON — the regression this guards", () => {
    const everyLineFails = REAL_SUCCESS.split("\n").every((line) => {
      try { const v = JSON.parse(line.trim()); return typeof v !== "object" || v === null; }
      catch { return true; }
    });
    expect(everyLineFails).toBe(true);
  });

  it("tolerates a leading banner line before the object", () => {
    const env = parseEnvelope(`Tip: rebuild via pnpm run build:cli\n${REAL_SUCCESS}`);
    expect(env?.success).toBe(true);
  });

  it("returns null for empty or non-JSON output", () => {
    expect(parseEnvelope("")).toBeNull();
    expect(parseEnvelope("   \n  ")).toBeNull();
    expect(parseEnvelope("command not found")).toBeNull();
  });
});

describe("shotFromEnvelope", () => {
  it("extracts path and pixel dimensions from a real success envelope", () => {
    const r = shotFromEnvelope(parseEnvelope(REAL_SUCCESS), "/fallback.jpg");
    expect(r.ok).toBe(true);
    expect(r.path).toBe("/tmp/shots/probe.jpg");
    expect(r.widthPx).toBe(2940);
    expect(r.heightPx).toBe(1912);
  });

  it("surfaces the error code so the degradation rule can key off it", () => {
    const r = shotFromEnvelope(parseEnvelope(REAL_INVALID_ARGUMENT), "/fallback.jpg");
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("INVALID_ARGUMENT");
  });

  it("is not ok when the output could not be parsed at all", () => {
    expect(shotFromEnvelope(null, "/fallback.jpg").ok).toBe(false);
  });
});

describe("parsePeekabooVersion", () => {
  it("parses the real --version line", () => {
    const v = parsePeekabooVersion("Peekaboo 4.2.0 (main/809630e4e, built: 2026-08-16T06:41:59-07:00)");
    expect(v).toEqual({ version: "4.2.0", major: 4 });
  });

  it("rejects unrelated output", () => {
    expect(parsePeekabooVersion("bash: peekaboo: command not found")).toBeNull();
  });

  it("gates on the major that stabilised the envelope shape", () => {
    expect(isVersionSupported(4)).toBe(true);
    expect(isVersionSupported(5)).toBe(true);
    expect(isVersionSupported(3)).toBe(false);
  });
});

describe("the macOS 15 floor", () => {
  it("reads the Darwin major", () => {
    expect(darwinMajor("24.0.0")).toBe(24);
    expect(darwinMajor("25.5.0")).toBe(25); // the dev machine, macOS 26.5.2
  });

  it("admits Darwin 24+ and rejects below", () => {
    expect(isDarwinSupported("24.0.0")).toBe(true);  // macOS 15 — exactly the minos floor
    expect(isDarwinSupported("25.5.0")).toBe(true);  // macOS 26
    expect(isDarwinSupported("23.6.0")).toBe(false); // macOS 14 — dyld refuses to launch
  });

  it("does NOT try to convert Darwin to a macOS number", () => {
    // There is no valid formula: Darwin 24 is macOS 15, but Darwin 25 is macOS 26 after
    // Apple's year-based renumbering. A "+9" offset reported macOS 33 for Sequoia and a
    // "+1" offset reports macOS 25 for Sonoma. Gating on Darwin sidesteps the whole trap.
    expect(darwinMajor("24.0.0")).not.toBe(15);
    expect(darwinMajor("25.5.0")).not.toBe(26);
  });

  it("lets an unparseable release through to the authoritative calibration shot", () => {
    expect(darwinMajor("")).toBeNull();
    expect(isDarwinSupported("")).toBe(true);
    expect(isDarwinSupported("unknown")).toBe(true);
  });
});

describe("screenStillArgs", () => {
  const args = screenStillArgs("/tmp/s.jpg", 0);

  it("requests jpg, because the bundled slim ffmpeg carries mjpeg and no PNG decoder", () => {
    expect(args).toContain("--format");
    expect(args[args.indexOf("--format") + 1]).toBe("jpg");
    expect(args).not.toContain("png");
  });

  it("skips element detection, so a capture needs no Accessibility grant", () => {
    expect(args).toContain("--no-elements");
  });

  it("forces local execution, so TCC attributes the capture to the app", () => {
    expect(args).toContain("--no-remote");
  });

  it("pins the classic/CoreGraphics engine rather than letting auto reach for SCK", () => {
    expect(args[args.indexOf("--capture-engine") + 1]).toBe("cg");
  });

  it("captures a whole display, non-interactively", () => {
    expect(args[args.indexOf("--mode") + 1]).toBe("screen");
    expect(args[args.indexOf("--screen-index") + 1]).toBe("0");
  });

  it("clamps a nonsense screen index instead of forwarding it", () => {
    expect(screenStillArgs("/tmp/s.jpg", -3)[screenStillArgs("/tmp/s.jpg", -3).indexOf("--screen-index") + 1]).toBe("0");
    expect(screenStillArgs("/tmp/s.jpg", 1.7)[screenStillArgs("/tmp/s.jpg", 1.7).indexOf("--screen-index") + 1]).toBe("1");
  });
});

describe("read-only probes", () => {
  it("permissions status never asks to prompt", () => {
    const a = permissionsArgs();
    expect(a).toEqual(["permissions", "status", "--json", "--no-remote"]);
    expect(a).not.toContain("request");
    expect(a).not.toContain("--prompt");
  });

  it("screen list is local and machine-readable", () => {
    expect(screenListArgs()).toContain("--no-remote");
    expect(screenListArgs()).toContain("--json");
  });
});

// ─────────────────────── accessibility argv builders ───────────────────────

/** Every desktop-tier invocation must carry both, for the reasons in the module header:
 *  no --json means no parseable result, no --no-remote means a Bridge daemon becomes the
 *  process macOS checks the Accessibility grant against. */
const ALL_BUILDERS: [string, string[]][] = [
  ["see", seeArgs({ app: "Safari", path: "/tmp/a.png" })],
  ["click/element", clickArgs({ elementId: "B1" })],
  ["click/point", clickArgs({ point: { x: 10, y: 20 } })],
  ["type", typeArgs({ text: "hi", app: "TextEdit" })],
  ["press", pressArgs({ keys: "cmd+s" })],
  ["scroll", scrollArgs({ direction: "down", amount: 3, elementId: "S1" })],
  ["menu", menuClickArgs({ app: "TextEdit", path: ["File", "Save"] })],
  ["app/launch", appArgs({ name: "Safari", action: "launch" })],
  ["app/focus", appArgs({ name: "Safari", action: "focus" })],
  ["app/quit", appArgs({ name: "Safari", action: "quit" })],
  ["window list", windowListArgs({ app: "Safari" })],
  ["permissions", permissionsArgs()],
];

describe("every accessibility invocation", () => {
  it.each(ALL_BUILDERS)("%s is local and machine-readable", (_name, args) => {
    expect(args).toContain("--json");
    expect(args).toContain("--no-remote");
  });

  it.each(ALL_BUILDERS)("%s never shell-quotes its own values", (_name, args) => {
    // spawn() takes an argv array with no shell, so a quote here would be TYPED, clicked
    // or searched for. Any embedded quote must have come from the caller's data.
    for (const a of args) expect(a).not.toMatch(/^["'].*["']$/);
  });
});

describe("seeArgs — the ACCESSIBILITY see, not the screen still", () => {
  it("keeps element detection on: the map is the point", () => {
    const a = seeArgs({ app: "Safari", path: "/tmp/a.png" });
    expect(a).not.toContain("--no-elements");
    expect(a[0]).toBe("see");
  });

  it("targets an app by name and annotates the shot it writes", () => {
    const a = seeArgs({ app: "Safari", path: "/tmp/a.png" });
    expect(a[a.indexOf("--app") + 1]).toBe("Safari");
    expect(a[a.indexOf("--path") + 1]).toBe("/tmp/a.png");
    expect(a).toContain("--annotate");
  });

  it("omits --annotate when nothing is written, since it needs a file to draw on", () => {
    expect(seeArgs({ app: "Safari" })).not.toContain("--annotate");
  });

  it("with no app, targets the frontmost window — the desktop-surface pre-capture", () => {
    expect(seeArgs()).not.toContain("--app");
  });

  it("passes a shell-hostile app name as ONE argv element, unquoted", () => {
    const a = seeArgs({ app: `My "App" & Co` });
    expect(a[a.indexOf("--app") + 1]).toBe(`My "App" & Co`);
  });

  it("can drop --json for a human-readable run", () => {
    expect(seeArgs({ app: "Safari", json: false })).not.toContain("--json");
  });

  it("is NOT the screen-still builder — the two share a verb and nothing else", () => {
    expect(seeArgs({ app: "Safari" })).not.toContain("--no-elements");
    expect(screenStillArgs("/tmp/s.jpg", 0)).not.toContain("--annotate");
  });
});

describe("clickArgs", () => {
  it("prefers the opaque element id, which peekaboo can dispatch in the background", () => {
    const a = clickArgs({ elementId: "B1", app: "Safari" });
    expect(a[a.indexOf("--on") + 1]).toBe("B1");
    expect(a).not.toContain("--at");
    expect(a).not.toContain("--foreground");
  });

  it("marks a raw point as GLOBAL, or --at is read as window-relative", () => {
    const a = clickArgs({ point: { x: 12, y: 34 }, app: "Safari" });
    expect(a[a.indexOf("--at") + 1]).toBe("12,34");
    expect(a).toContain("--global");
  });

  it("falls back to the cursor for a snapshotless point click, which is otherwise refused", () => {
    expect(clickArgs({ point: { x: 1, y: 2 } })).toContain("--foreground");
  });

  it("stays in the background when a fresh snapshot authorises the coordinates", () => {
    const a = clickArgs({ point: { x: 1, y: 2 }, snapshot: "snap_8812" });
    expect(a[a.indexOf("--snapshot") + 1]).toBe("snap_8812");
    expect(a).not.toContain("--foreground");
  });

  it("passes the right button and the double flag", () => {
    expect(clickArgs({ elementId: "B1", button: "right" })).toContain("--right");
    expect(clickArgs({ elementId: "B1", double: true })).toContain("--double");
    expect(clickArgs({ elementId: "B1", button: "left" })).not.toContain("--right");
    expect(clickArgs({ elementId: "B1" })).not.toContain("--double");
  });
});

describe("typeArgs", () => {
  it("doubles backslashes so the text is typed LITERALLY", () => {
    // peekaboo interprets \n \t \b \e inside --text. Without this, asking the mascot to
    // type the Windows path C:\note submits the form on the "\n".
    expect(escapeTypeText("C:\\note")).toBe("C:\\\\note");
    const a = typeArgs({ text: "C:\\note", app: "TextEdit" });
    expect(a[a.indexOf("--text") + 1]).toBe("C:\\\\note");
  });

  it("leaves a REAL newline alone — argv carries it and peekaboo types Return", () => {
    const a = typeArgs({ text: "line one\nline two", app: "TextEdit" });
    expect(a[a.indexOf("--text") + 1]).toBe("line one\nline two");
  });

  it("passes quotes, ampersands and spaces through as one argv element", () => {
    const nasty = `say "hi" & $(whoami) 'now'`;
    const a = typeArgs({ text: nasty, app: "TextEdit" });
    expect(a[a.indexOf("--text") + 1]).toBe(nasty);
  });

  it("uses --text so a leading dash is a value, not a flag", () => {
    const a = typeArgs({ text: "--version", app: "TextEdit" });
    expect(a[a.indexOf("--text") + 1]).toBe("--version");
    expect(a[1]).toBe("--text");
  });

  it("delivers in the background when an app is named, leaving the user's focus alone", () => {
    expect(typeArgs({ text: "hi", app: "TextEdit" })).not.toContain("--foreground");
  });

  it("requires --foreground with no target, which peekaboo would otherwise refuse", () => {
    expect(typeArgs({ text: "hi" })).toContain("--foreground");
  });

  it("does not clear the field unless asked", () => {
    expect(typeArgs({ text: "hi", app: "TextEdit" })).not.toContain("--clear");
    expect(typeArgs({ text: "hi", app: "TextEdit", clear: true })).toContain("--clear");
  });
});

describe("pressArgs", () => {
  it("passes one chord positionally", () => {
    expect(pressArgs({ keys: "cmd+s" }).slice(0, 2)).toEqual(["press", "cmd+s"]);
  });

  it("splits a SEQUENCE into separate chords, not one malformed chord", () => {
    expect(pressArgs({ keys: "ctrl+a Delete" }).slice(0, 3)).toEqual(["press", "ctrl+a", "Delete"]);
  });

  it("tolerates ragged whitespace from a model reply", () => {
    expect(pressArgs({ keys: "  cmd+shift+4   Escape  " }).slice(0, 3)).toEqual(["press", "cmd+shift+4", "Escape"]);
  });

  it("needs --foreground without a window id: targetless background press is refused", () => {
    expect(pressArgs({ keys: "cmd+s" })).toContain("--foreground");
    expect(pressArgs({ keys: "cmd+s", app: "TextEdit" })).toContain("--foreground");
  });

  it("goes background once an exact window pins the receipt", () => {
    const a = pressArgs({ keys: "Return", windowId: "12345" });
    expect(a[a.indexOf("--window-id") + 1]).toBe("12345");
    expect(a).not.toContain("--foreground");
  });
});

describe("splitKeyChords — the one definition of what `press` receives", () => {
  it("is what pressArgs is built from, token for token", () => {
    // Findings 1, 3 and 8: the renderer's destructive-shortcut guard kept its own
    // copy of this rule, normalised the whole string as ONE chord, and so waved
    // `"esc cmd+q"` through to quit the frontmost app. Exported so there is one
    // rule to derive an answer from, and asserted here so `pressArgs` cannot
    // quietly stop using it.
    for (const keys of ["cmd+s", "esc cmd+q", "  ctrl+a   Delete  ", "a\tb", "cmd+q --app Terminal"]) {
      const chords = splitKeyChords(keys);
      expect(pressArgs({ keys }).slice(1, 1 + chords.length)).toEqual(chords);
    }
  });

  it("drops nothing and merges nothing", () => {
    expect(splitKeyChords("esc cmd+q")).toEqual(["esc", "cmd+q"]);
    expect(splitKeyChords("   ")).toEqual([]);
    expect(splitKeyChords("")).toEqual([]);
  });
});

describe("scrollArgs", () => {
  it("scrolls inside a named element, in the background", () => {
    const a = scrollArgs({ direction: "up", amount: 10, elementId: "S1" });
    expect(a[a.indexOf("--direction") + 1]).toBe("up");
    expect(a[a.indexOf("--amount") + 1]).toBe("10");
    expect(a[a.indexOf("--on") + 1]).toBe("S1");
    expect(a).not.toContain("--foreground");
  });

  it("needs the physical pointer without an element, which peekaboo says outright", () => {
    expect(scrollArgs({ direction: "down" })).toContain("--foreground");
  });

  it("cannot honour a point: peekaboo's scroll has no coordinate target", () => {
    const a = scrollArgs({ direction: "down", point: { x: 10, y: 20 } });
    expect(a).not.toContain("--at");
    expect(a).toContain("--foreground");
  });

  it("clamps a fractional or zero amount instead of forwarding it", () => {
    expect(scrollArgs({ direction: "down", amount: 0, elementId: "S1" })[
      scrollArgs({ direction: "down", amount: 0, elementId: "S1" }).indexOf("--amount") + 1]).toBe("1");
    expect(scrollArgs({ direction: "down", amount: 3.9, elementId: "S1" })[
      scrollArgs({ direction: "down", amount: 3.9, elementId: "S1" }).indexOf("--amount") + 1]).toBe("3");
  });
});

describe("menuClickArgs", () => {
  it("joins a nested path with peekaboo's ' > ' separator", () => {
    const a = menuClickArgs({ app: "TextEdit", path: ["Format", "Font", "Show Fonts"] });
    expect(a[a.indexOf("--path") + 1]).toBe("Format > Font > Show Fonts");
  });

  it("uses --path even for a single item, so there is one code path to reason about", () => {
    expect(menuClickArgs({ app: "Safari", path: ["New Window"] })[
      menuClickArgs({ app: "Safari", path: ["New Window"] }).indexOf("--path") + 1]).toBe("New Window");
  });

  it("always names the app: background menu clicks require it, and 'whatever is in front' is not confirmable", () => {
    const a = menuClickArgs({ app: `My "App"`, path: ["File", "Save"] });
    expect(a[a.indexOf("--app") + 1]).toBe(`My "App"`);
    expect(a).not.toContain("--foreground");
  });
});

describe("appArgs", () => {
  it("launches with --foreground, which macOS requires for a cold launch", () => {
    const a = appArgs({ name: "Visual Studio Code", action: "launch" });
    expect(a.slice(0, 3)).toEqual(["app", "launch", "Visual Studio Code"]);
    expect(a).toContain("--foreground");
  });

  it("focuses via `app switch --to`, the documented CLI form", () => {
    const a = appArgs({ name: "Terminal", action: "focus" });
    expect(a.slice(0, 4)).toEqual(["app", "switch", "--to", "Terminal"]);
  });

  it("quits by name and never forces: the app's own save sheet must still appear", () => {
    const a = appArgs({ name: "Safari", action: "quit" });
    expect(a.slice(0, 4)).toEqual(["app", "quit", "--app", "Safari"]);
    expect(a).not.toContain("--force");
    expect(a).not.toContain("--all");
  });

  it("passes an app name with spaces and quotes as one element", () => {
    expect(appArgs({ name: `My "App" & Co`, action: "quit" })).toContain(`My "App" & Co`);
  });
});

describe("windowListArgs", () => {
  it("lists every window when no app is named", () => {
    expect(windowListArgs()).toEqual(["window", "list", "--json", "--no-remote"]);
  });

  it("scopes to one app when it is", () => {
    const a = windowListArgs({ app: "Safari" });
    expect(a[a.indexOf("--app") + 1]).toBe("Safari");
  });
});

// ─────────────────────────── envelope normalisers ───────────────────────────

describe("resultFromEnvelope", () => {
  it("reports ok with the data payload for a real success envelope", () => {
    const r = resultFromEnvelope(parseEnvelope(REAL_SUCCESS));
    expect(r.ok).toBe(true);
    expect(r.errorCode).toBeUndefined();
    expect(r.data).toBeTruthy();
  });

  it("keeps peekaboo's own error code verbatim, so the transcript can name the failure", () => {
    const r = resultFromEnvelope(parseEnvelope(REAL_INVALID_ARGUMENT));
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("INVALID_ARGUMENT");
    expect(r.error).toContain("bogusmode");
  });

  it("turns an unparseable buffer into a failure with a code, never a throw", () => {
    const r = resultFromEnvelope(null);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("UNPARSEABLE_OUTPUT");
  });

  it("does not infer success from the absence of an error object", () => {
    // A killed child can leave `{"data":{}}` behind. Missing `success` is not success.
    expect(resultFromEnvelope(parseEnvelope(`{"data":{}}`)).ok).toBe(false);
    expect(resultFromEnvelope(parseEnvelope(`{"success":false}`)).errorCode).toBe("UNKNOWN_ERROR");
  });
});

describe("permissionsFromEnvelope", () => {
  it("reads Screen Recording out of the real one-row envelope", () => {
    const p = permissionsFromEnvelope(parseEnvelope(REAL_PERMISSIONS));
    expect(p.ok).toBe(true);
    expect(p.screenRecording).toBe(true);
    // Absent row means not granted — never "unknown, assume yes".
    expect(p.accessibility).toBe(false);
  });

  it("reads both rows when both are present", () => {
    const p = permissionsFromEnvelope(parseEnvelope(PERMISSIONS_BOTH));
    expect(p.screenRecording).toBe(true);
    expect(p.accessibility).toBe(true);
  });

  it("denies everything when the probe itself failed", () => {
    const p = permissionsFromEnvelope(parseEnvelope(REAL_INVALID_ARGUMENT));
    expect(p.ok).toBe(false);
    expect(p.screenRecording).toBe(false);
    expect(p.accessibility).toBe(false);
  });

  it("denies everything when nothing could be parsed", () => {
    expect(permissionsFromEnvelope(null)).toMatchObject({ ok: false, accessibility: false });
  });
});

describe("screensFromEnvelope — which display the mascot photographs", () => {
  it("reads index and displayID out of the real envelope", () => {
    const r = screensFromEnvelope(parseEnvelope(REAL_SCREEN_LIST));
    expect(r.ok).toBe(true);
    expect(r.screens).toEqual([{ index: 0, displayId: 1, name: "Built-in Display" }]);
  });

  it("keys every display in a multi-monitor list by its own displayID", () => {
    // The case the single-display fixture above cannot cover, and the only one
    // where this function does any work: peekaboo's index is a position in ITS
    // enumeration, so the cursor's display can only be found through displayID.
    // RECONSTRUCTED — same shape as the verbatim fixture, second row invented.
    const env = parseEnvelope(JSON.stringify({
      success: true,
      data: {
        screens: [
          { index: 0, displayID: 1, name: "Built-in Display", isPrimary: true },
          { index: 1, displayID: 724_003_355, name: "DELL U2723QE" },
        ],
      },
    }));
    expect(screensFromEnvelope(env).screens.map((s) => [s.displayId, s.index])).toEqual([
      [1, 0],
      [724_003_355, 1],
    ]);
  });

  it("accepts the snake_case and camelCase spellings of displayID", () => {
    // Which spelling arrives depends on the runtime host, exactly as with
    // ui_map/uiMap in seeFromEnvelope. A wrong guess yields no rows at all,
    // which reads as "one display" and captures the wrong screen forever.
    const env = parseEnvelope(JSON.stringify({
      success: true,
      data: { screens: [{ index: 3, display_id: 7 }, { index: 4, displayId: 9 }] },
    }));
    expect(screensFromEnvelope(env).screens).toEqual([
      { index: 3, displayId: 7 },
      { index: 4, displayId: 9 },
    ]);
  });

  it("falls back to the array position when a row omits its index", () => {
    const env = parseEnvelope(JSON.stringify({
      success: true,
      data: { screens: [{ displayID: 11 }, { displayID: 12 }] },
    }));
    expect(screensFromEnvelope(env).screens).toEqual([
      { index: 0, displayId: 11 },
      { index: 1, displayId: 12 },
    ]);
  });

  it("drops a row that carries no usable displayID", () => {
    // The map built from these is keyed by that number and nothing else, so a
    // row that cannot be keyed could only ever produce a miss.
    const env = parseEnvelope(JSON.stringify({
      success: true,
      data: { screens: [{ index: 0, name: "Nameless" }, { index: 1, displayID: "2" }, null, { index: 2, displayID: 5 }] },
    }));
    expect(screensFromEnvelope(env).screens).toEqual([{ index: 2, displayId: 5 }]);
  });

  it("reports a failed or unparseable enumeration rather than an empty desk", () => {
    // `ok:false` and `screens:[]` are different answers: os-actions.ts caches only
    // a successful, non-empty read, so a failure must not be mistaken for "this
    // machine has no displays" and pin every later capture to index 0.
    const failed = screensFromEnvelope(parseEnvelope(REAL_INVALID_ARGUMENT));
    expect(failed.ok).toBe(false);
    expect(failed.screens).toEqual([]);
    expect(failed.errorCode).toBeTruthy();
    expect(screensFromEnvelope(null)).toMatchObject({ ok: false, errorCode: "UNPARSEABLE_OUTPUT" });
  });
});

describe("normaliseBounds", () => {
  it("reads the flat object form", () => {
    expect(normaliseBounds({ x: 1, y: 2, width: 3, height: 4 })).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it("reads Swift's CGRect origin/size form", () => {
    expect(normaliseBounds({ origin: { x: 1, y: 2 }, size: { width: 3, height: 4 } }))
      .toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it("reads the flat 4-element array form", () => {
    expect(normaliseBounds([1, 2, 3, 4])).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it("reads peekaboo's own nested logical_bounds form", () => {
    expect(normaliseBounds([[0, 0], [1470, 956]])).toEqual({ x: 0, y: 0, width: 1470, height: 956 });
  });

  it("returns undefined rather than a rectangle at the origin when it cannot tell", () => {
    // A silent {0,0,0,0} would fly the mascot's pointer to the top-left corner with no
    // error anywhere — the exact failure mode this whole function exists to avoid.
    expect(normaliseBounds(undefined)).toBeUndefined();
    expect(normaliseBounds({})).toBeUndefined();
    expect(normaliseBounds("100,200")).toBeUndefined();
    expect(normaliseBounds({ x: 1, y: 2 })).toBeUndefined();
    expect(normaliseBounds([1, 2, 3])).toBeUndefined();
    expect(normaliseBounds({ x: 1, y: 2, width: "3", height: 4 })).toBeUndefined();
  });
});

describe("isSecureElement — the flag os_type's refusal depends on", () => {
  it("believes an explicit boolean if a future peekaboo ever exports one", () => {
    expect(isSecureElement({ role: "AXTextField", secure: true })).toBe(true);
    expect(isSecureElement({ role: "AXTextField", is_secure: true })).toBe(true);
    expect(isSecureElement({ role: "AXTextField", isSecure: true })).toBe(true);
  });

  it("infers it from the AXSecureTextField role, the only signal 4.2.0 could give", () => {
    expect(isSecureElement({ role: "AXSecureTextField" })).toBe(true);
    expect(isSecureElement({ ax_role: "AXSecureTextField" })).toBe(true);
    expect(isSecureElement({ role: "AXTextField", subrole: "AXSecureTextField" })).toBe(true);
    expect(isSecureElement({ role: "AXTextField", role_description: "secure text field" })).toBe(true);
  });

  it("does NOT flag an ordinary text field", () => {
    expect(isSecureElement({ role: "AXTextField", label: "Email" })).toBe(false);
    expect(isSecureElement({ role: "AXButton", label: "Secure Sign In" })).toBe(false);
  });

  /**
   * Finding 18. The rationale block on this predicate told the next implementer
   * that rule 6 "cannot be enforced from focus, because nothing in the map says
   * which element has it" and that "the enforceable rule is the one about the
   * element the mascot itself targeted". Both halves were false against the
   * shipped code — `normaliseElement` does carry focus, and `os_type` has no
   * target at all — and acting on the advice would have replaced a fail-closed
   * whole-map check with an always-allow, on the one rule that stops a chat
   * reply typing into a password field.
   */
  it("its rationale block describes the rule that actually exists (finding 18)", () => {
    const block = SOURCE.slice(
      SOURCE.indexOf("Is this element a secure text field?"),
      SOURCE.indexOf("export function isSecureElement"),
    );
    expect(block.length).toBeGreaterThan(200);
    expect(block).not.toContain("cannot be enforced from focus");
    expect(block).not.toContain("the element the mascot itself targeted");
    // It has to name the rule that IS implemented, so the reader lands there.
    expect(block).toContain("secureTypeRefusal");
    expect(block.toLowerCase()).toContain("fail-closed");
  });

  it("is a one-way signal: false means NO EVIDENCE, not verified-safe", () => {
    // Documented as a test so the next reader meets it here too. Peekaboo 4.2.0's element
    // schema has no secure flag at all, so a password field whose role comes back as a
    // plain AXTextField reads as false. Callers must treat an unidentified focus as
    // unsafe rather than treating `secure === false` as permission to type.
    expect(isSecureElement({ role: "AXTextField", label: "Password" })).toBe(false);
  });
});

describe("normaliseElement", () => {
  it("maps the documented key names onto OsElement", () => {
    const el = normaliseElement({
      id: "B1", role: "AXButton", label: "Sign In",
      bounds: { x: 1, y: 2, width: 3, height: 4 }, is_enabled: true,
    });
    expect(el).toEqual({ id: "B1", role: "AXButton", label: "Sign In", bounds: { x: 1, y: 2, width: 3, height: 4 }, enabled: true });
  });

  it("drops an element with no id — it cannot be clicked or referred to", () => {
    expect(normaliseElement({ role: "AXStaticText", label: "hello" })).toBeNull();
    expect(normaliseElement(null)).toBeNull();
    expect(normaliseElement("nope")).toBeNull();
  });

  it("falls back through title and description for a label", () => {
    expect(normaliseElement({ id: "x", role: "AXButton", title: "Save" })?.label).toBe("Save");
    expect(normaliseElement({ id: "x", role: "AXButton", description: "Save the file" })?.label).toBe("Save the file");
  });

  it("flags a secure field and REFUSES TO CARRY ITS VALUE", () => {
    // The normalised element goes into the mascot transcript, which is fed to the brain
    // and may be persisted. A password must not travel with it even once.
    const el = normaliseElement({ id: "T2", role: "AXSecureTextField", label: "Password", value: "hunter2" });
    expect(el?.secure).toBe(true);
    expect(el?.value).toBeUndefined();
  });

  it("carries focus when the payload spells it — the branch the old comment called impossible", () => {
    // Peekaboo 4.2.0 exports no focus flag, which is exactly why this is written
    // to believe one the moment a payload has it. It is not dead code, and the
    // dispatcher's `focused.secure` branch is not dead either.
    expect(normaliseElement({ id: "t1", role: "AXTextField", is_focused: true })?.focused).toBe(true);
    expect(normaliseElement({ id: "t1", role: "AXTextField", focused: true })?.focused).toBe(true);
    expect(normaliseElement({ id: "t1", role: "AXTextField" })?.focused).toBeUndefined();
  });

  it("keeps an ordinary field's value, which is what makes 'read the form back' work", () => {
    const el = normaliseElement({ id: "T1", role: "AXTextField", label: "Email", value: "a@b.c" });
    expect(el?.value).toBe("a@b.c");
    expect(el?.secure).toBeUndefined();
  });
});

describe("seeFromEnvelope", () => {
  const r = seeFromEnvelope(parseEnvelope(SEE_ENVELOPE));

  it("finds the elements under data.ui_map.ui_elements", () => {
    expect(r.ok).toBe(true);
    expect(r.elements.map((e) => e.id)).toEqual(["B1", "T1", "T2"]); // the id-less row is gone
  });

  it("carries the annotated screenshot, the app, the window and the frontmost app", () => {
    expect(r.data?.screenshotPath).toBe("/tmp/see/annotated.png");
    expect(r.data?.app).toBe("Safari");
    expect(r.data?.windowId).toBe("12345"); // numeric in the envelope, string in the map
    expect(r.data?.frontmostApp).toBe("Safari");
  });

  it("marks the password field secure and strips its value", () => {
    const pw = r.elements.find((e) => e.id === "T2");
    expect(pw?.secure).toBe(true);
    expect(pw?.value).toBeUndefined();
  });

  it("accepts the camelCase spelling the daemon/MCP host uses", () => {
    const alt = seeFromEnvelope(parseEnvelope(
      `{"success":true,"data":{"elements":[{"id":"B9","role":"AXButton"}],"annotatedPath":"/tmp/x.png"}}`));
    expect(alt.elements.map((e) => e.id)).toEqual(["B9"]);
    expect(alt.data?.screenshotPath).toBe("/tmp/x.png");
  });

  it("returns an empty list and the error code on a failed see, never a throw", () => {
    const bad = seeFromEnvelope(parseEnvelope(REAL_INVALID_ARGUMENT));
    expect(bad.ok).toBe(false);
    expect(bad.errorCode).toBe("INVALID_ARGUMENT");
    expect(bad.elements).toEqual([]);
  });

  it("survives an envelope with no ui_map at all", () => {
    const empty = seeFromEnvelope(parseEnvelope(`{"success":true,"data":{}}`));
    expect(empty.ok).toBe(true);
    expect(empty.elements).toEqual([]);
    expect(empty.data?.screenshotPath).toBeUndefined();
  });
});

describe("child output is decoded as a STREAM, not per chunk", () => {
  /**
   * Finding 19. `stdout += String(chunk)` decodes every Buffer on its own, so a
   * UTF-8 sequence split across two chunks becomes two replacement characters —
   * and a `see` map of a large window arrives in several chunks, since the pipe
   * hands over whatever is ready. The JSON still parses, so the corruption is
   * silent: an element the user is looking at is labelled "Caf??" in the model's
   * map and in the confirmation dialog.
   */
  const payload = '{"label":"Café ☕ — 日本語"}';

  it("reassembles a character split across chunks", () => {
    const bytes = Buffer.from(payload, "utf8");
    const acc = createStreamText();
    // One byte at a time: the harshest possible split, and every multi-byte
    // character in the payload is broken by it.
    for (let i = 0; i < bytes.length; i++) acc.push(bytes.subarray(i, i + 1));
    expect(acc.done()).toBe(payload);
  });

  it("…which the per-chunk form provably could not", () => {
    // The bug, demonstrated, so nobody restores the one-liner thinking it was
    // equivalent.
    const bytes = Buffer.from(payload, "utf8");
    let naive = "";
    for (let i = 0; i < bytes.length; i++) naive += String(bytes.subarray(i, i + 1));
    expect(naive).not.toBe(payload);
    expect(naive).toContain("\ufffd");
  });

  it("passes plain ASCII and pre-decoded strings straight through", () => {
    const acc = createStreamText();
    acc.push(Buffer.from('{"ok":', "utf8"));
    acc.push("true}");
    expect(acc.done()).toBe('{"ok":true}');
  });

  it("flushes a truncated tail rather than losing it", () => {
    // A killed child leaves half a character behind. Those bytes never were a
    // character, so U+FFFD is the honest answer — but they must not vanish, or a
    // truncated envelope would look like a complete one.
    const acc = createStreamText();
    acc.push(Buffer.from([0xe2, 0x98]));
    expect(acc.done()).toBe("\ufffd");
  });
});

describe("timeouts", () => {
  it("gives `see` more room than peekaboo's own 20s element-detection default", () => {
    // Ours must LOSE the race so peekaboo's structured TIMEOUT envelope is what surfaces;
    // a SIGTERM'd child yields a truncated buffer and "unparseable peekaboo output",
    // which reads like a broken install rather than a slow window.
    expect(TIMEOUT_MS.see).toBeGreaterThan(20_000);
  });

  it("keeps the startup probe short — it runs on the launch path", () => {
    expect(TIMEOUT_MS.probe).toBeLessThan(TIMEOUT_MS.act);
  });

  it("bounds every action, so Stop always has a loser to race", () => {
    for (const ms of Object.values(TIMEOUT_MS)) {
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(30_000);
    }
  });
});
