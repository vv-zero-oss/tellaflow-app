// Ported from canvas src/editor/mascot/__tests__/mascot-reply.test.ts; the
// editor actions in its samples are swapped for desktop ones.
/**
 * Tests for the mascot reply protocol.
 *
 * The load-bearing case is the streaming one: `splitMascotReply` is called on
 * every assistant delta, so the interesting inputs are not "a reply" but "every
 * truncation of a reply". The sweep below asserts the bubble-safety invariant at
 * each of those prefixes — no backtick, no JSON, no half-typed word "mascot"
 * ever appears in the prose the user is shown (or, in Phase 3, hears).
 */
import { describe, it, expect } from "vitest";
import { splitMascotReply, parseMascotActions, stripForSpeech } from "../../../src/main/jarvis/mascot-reply";

const BODY = '{"actions":[{"type":"os_click","target":{"elementId":"u1"}}]}';
const REPLY = "Selecting the hero.\n```mascot\n" + BODY + "\n```";
const FENCE_START = REPLY.indexOf("```");

describe("splitMascotReply — complete block", () => {
  const r = splitMascotReply(REPLY);
  it("keeps the prose", () => expect(r.prose).toBe("Selecting the hero."));
  it("removes the block from the prose", () => expect(r.prose).not.toContain("`"));
  it("returns the block body", () => expect(r.fence).toBe(BODY));
  it("is not still open", () => expect(r.fenceOpen).toBe(false));

  it("handles a block with no prose at all", () => {
    const only = splitMascotReply("```mascot\n" + BODY + "\n```");
    expect(only.prose).toBe("");
    expect(only.fence).toBe(BODY);
  });
  it("keeps prose that follows the block", () => {
    const after = splitMascotReply(REPLY + "\nDone.");
    expect(after.prose).toBe("Selecting the hero.\nDone.");
    expect(after.fence).toBe(BODY);
  });
  it("parses a block that closes without a trailing newline", () => {
    const tight = splitMascotReply("Ok.\n```mascot\n" + BODY + "```");
    expect(tight.fence).toBe(BODY);
    expect(tight.fenceOpen).toBe(false);
  });
});

describe("splitMascotReply — partial block never reaches the bubble", () => {
  // Every prefix from the moment the fence starts to one character short of the
  // closing backticks: the prose must stay exactly the sentence, and the caller
  // must be told a fence is open so it doesn't parse actions yet.
  for (let i = FENCE_START + 1; i < REPLY.length; i++) {
    const prefix = REPLY.slice(0, i);
    it(`suppresses the partial at ${i - FENCE_START} char(s) in`, () => {
      const r = splitMascotReply(prefix);
      expect(r.prose).toBe("Selecting the hero.");
      expect(r.fence).toBeNull();
      expect(r.fenceOpen).toBe(true);
    });
  }

  it("suppresses a bare opening backtick run", () => {
    for (const tail of ["`", "``", "```", "```m", "```mas", "```mascot", "```mascot\n", '```mascot\n{"act']) {
      const r = splitMascotReply("Selecting the hero.\n" + tail);
      expect(r.prose).toBe("Selecting the hero.");
      expect(r.fenceOpen).toBe(true);
    }
  });

  it("has nothing to parse while the block is open", () => {
    expect(parseMascotActions(splitMascotReply(REPLY.slice(0, REPLY.length - 2)).fence)).toEqual([]);
  });
});

describe("splitMascotReply — text that only looks like a fence", () => {
  it("leaves a reply with no block alone", () => {
    expect(splitMascotReply("  That heading is the h1.  ")).toEqual({
      prose: "That heading is the h1.", fence: null, fenceOpen: false,
    });
  });
  it("keeps a half-typed inline code span mid-sentence", () => {
    const r = splitMascotReply("Set the `color");
    expect(r.prose).toBe("Set the `color");
    expect(r.fenceOpen).toBe(false);
  });
  it("keeps the closer of a finished non-mascot code block", () => {
    const r = splitMascotReply("Try:\n```css\na{color:red}\n```");
    expect(r.prose).toBe("Try:\n```css\na{color:red}\n```");
    expect(r.fenceOpen).toBe(false);
  });
  it("does not treat another language's fence as ours", () => {
    const r = splitMascotReply("Here:\n```json\n{\"a\":1}\n```");
    expect(r.fence).toBeNull();
    expect(r.fenceOpen).toBe(false);
  });
});

/**
 * The bubble-safety invariant, asserted at every truncation of the replies
 * below: not one character of a mascot block — its backticks, its braces, the
 * word "actions" — may appear in what the user is shown. The splitter used to
 * satisfy this only for the FIRST fence of a well-formed reply; a second block,
 * or backticks inside the first block's body, streamed raw JSON into the bubble
 * and then into the transcript.
 */
function expectBubbleSafe(prose: string): void {
  expect(prose).not.toContain("`");
  expect(prose).not.toMatch(/[{}]/);
  expect(prose).not.toMatch(/mascot|actions/i);
}

/** Assert the invariant at every prefix of a reply, plus that the prose only
 *  ever grows towards `expected` — a splitter that returned "" everywhere would
 *  be "safe" and useless. */
function sweep(reply: string, expected: string): void {
  for (let i = 0; i <= reply.length; i++) {
    const { prose } = splitMascotReply(reply.slice(0, i));
    expectBubbleSafe(prose);
    expect(expected.startsWith(prose)).toBe(true);
  }
  expect(splitMascotReply(reply).prose).toBe(expected);
}

describe("splitMascotReply — a model that emits two blocks", () => {
  const A = '{"actions":[{"type":"os_see"}]}';
  const B = '{"actions":[{"type":"os_see"}]}';
  const TWO = "First.\n```mascot\n" + A + "\n```\nAlso:\n```mascot\n" + B + "\n```";

  it("keeps the prose around both blocks and neither body", () => {
    const r = splitMascotReply(TWO);
    expect(r.prose).toBe("First.\nAlso:");
    expect(r.fenceOpen).toBe(false);
  });
  it("honours the first block's actions and drops the second's", () => {
    expect(parseMascotActions(splitMascotReply(TWO).fence)).toEqual([{ type: "os_see" }]);
  });
  it("shows clean prose at every streaming truncation", () => sweep(TWO, "First.\nAlso:"));

  it("still salvages the first block when the closer between them is missing", () => {
    const r = splitMascotReply("First.\n```mascot\n" + A + "\n```mascot\n" + B + "\n```");
    expect(r.prose).toBe("First.");
    expect(parseMascotActions(r.fence)).toEqual([{ type: "os_see" }]);
  });
  it("suppresses a block that is the entire reply, twice over", () => {
    const r = splitMascotReply("```mascot\n" + A + "\n```\n```mascot\n" + B + "\n```");
    expect(r.prose).toBe("");
    expect(r.fence).toBe(A);
  });
});

describe("splitMascotReply — backticks inside the block body", () => {
  const TASK = '{"actions":[{"type":"delegate_to_agent","task":"wrap it in ``` fences"}]}';
  const REPLY_T = "Sure.\n```mascot\n" + TASK + "\n```";

  it("does not let inner backticks close the block", () => {
    const r = splitMascotReply(REPLY_T);
    expect(r.prose).toBe("Sure.");
    expect(r.fence).toBe(TASK);
    expect(parseMascotActions(r.fence)).toEqual([
      { type: "delegate_to_agent", task: "wrap it in ``` fences" },
    ]);
  });
  it("shows clean prose at every streaming truncation", () => sweep(REPLY_T, "Sure."));

  it("treats a quoted ```json block inside the body as body, not as the closer", () => {
    // The body is beyond saving (a fenced example inside JSON is not JSON), so
    // the actions are lost — but the trade this file always makes is prose over
    // actions: the old first-``` -wins scan kept the actions and spilled
    // `json {"note":1} ``` ` into the bubble.
    const nested = 'Ok.\n```mascot\n{"actions":[{"type":"os_see"}]}\n```json\n{"note":1}\n```\n```';
    const r = splitMascotReply(nested);
    expect(r.prose).toBe("Ok.");
    expect(r.fenceOpen).toBe(false);
    expect(parseMascotActions(r.fence)).toEqual([]);
  });
  it("shows clean prose at every truncation of that nested reply", () =>
    sweep('Ok.\n```mascot\n{"actions":[{"type":"os_see"}]}\n```json\n{"note":1}\n```\n```', "Ok."));
});

describe("splitMascotReply — CRLF replies", () => {
  const CRLF = "Selecting the hero.\r\n```mascot\r\n" + BODY + "\r\n```";

  it("splits exactly as the LF form does", () => {
    const r = splitMascotReply(CRLF);
    expect(r.prose).toBe("Selecting the hero.");
    expect(r.fence).toBe(BODY);
    expect(r.fenceOpen).toBe(false);
  });
  it("handles a CRLF reply that is nothing but the block", () => {
    const r = splitMascotReply("```mascot\r\n" + BODY + "\r\n```");
    expect(r.prose).toBe("");
    expect(r.fence).toBe(BODY);
    expect(r.fenceOpen).toBe(false);
  });
  it("keeps CRLF prose that follows the block", () => {
    expect(splitMascotReply(CRLF + "\r\nDone.").prose).toBe("Selecting the hero.\nDone.");
  });
  it("shows clean prose at every streaming truncation", () => sweep(CRLF, "Selecting the hero."));
  it("suppresses both blocks of a CRLF two-block reply", () => {
    const two = CRLF + "\r\nAlso:\r\n```mascot\r\n{\"actions\":[{\"type\":\"os_see\"}]}\r\n```";
    expect(splitMascotReply(two).prose).toBe("Selecting the hero.\nAlso:");
    expect(splitMascotReply(two).fence).toBe(BODY);
  });
});

describe("splitMascotReply — openers the protocol did not ask for", () => {
  it("recognises an opener the model left at the end of a prose line", () => {
    const r = splitMascotReply("Here you go: ```mascot\n" + BODY + "\n```");
    expect(r.prose).toBe("Here you go:");
    expect(r.fence).toBe(BODY);
  });
  it("recognises a capitalised info string", () => {
    expect(splitMascotReply("Ok.\n```Mascot\n" + BODY + "\n```").fence).toBe(BODY);
  });
  it("keeps a glued closer working when prose follows it", () => {
    const r = splitMascotReply("Ok.\n```mascot\n" + BODY + "```\nDone.");
    expect(r.prose).toBe("Ok.\nDone.");
    expect(r.fence).toBe(BODY);
    expect(r.fenceOpen).toBe(false);
  });
  it("never leaks a body whose closing run has not arrived", () => {
    // Mid-stream shape of the delegate_to_agent body above: the reply ends
    // inside a JSON string that happens to contain backticks.
    const partial = 'Sure.\n```mascot\n{"actions":[{"type":"delegate_to_agent","task":"use ```';
    const r = splitMascotReply(partial);
    expect(r.prose).toBe("Sure.");
    expect(parseMascotActions(r.fence)).toEqual([]);

    // One delta later the string closes, and the block is plainly still open —
    // the backticks never got to end it and take the rest of the body with them.
    const next = splitMascotReply(partial + ' fences"}]}');
    expect(next.prose).toBe("Sure.");
    expect(next.fence).toBeNull();
    expect(next.fenceOpen).toBe(true);
  });
  it("still salvages a padded body closed without a newline", () => {
    const r = splitMascotReply("Ok.\n```mascot\n" + BODY + "\n// done```");
    expect(r.prose).toBe("Ok.");
    expect(parseMascotActions(r.fence)).toEqual([{ type: "os_click", target: { elementId: "u1" } }]);
  });
});

describe("no assembled reply leaks at any truncation", () => {
  // The hand-written cases above are the ones that actually happened; this is
  // the net under them. Every combination of the shapes models produce — prose
  // before/after, one or two blocks, bodies with backticks or broken JSON, a
  // closer on its own line or glued to the body, LF or CRLF — is streamed one
  // character at a time and checked. Deterministic: a fixed product, no PRNG.
  const prefixes = ["", "Sure.", "Here you go: "];
  const bodies = [
    BODY,
    '{"actions":[{"type":"delegate_to_agent","task":"use ``` here"}]}',
    "{oops",
    '{"actions":[]}\n// done',
  ];
  const closers = ["\n```", "```"];
  const tails = ["", "Done.", "Also:"];

  it("keeps the bubble free of block text in every shape", () => {
    let checked = 0;
    for (const eol of ["\n", "\r\n"]) {
      for (const prefix of prefixes) {
        for (const body of bodies) {
          for (const closer of closers) {
            for (const tail of tails) {
              for (const blocks of [1, 2]) {
                const block = "```mascot\n" + body + closer;
                const reply = [prefix, block, tail, blocks === 2 ? block : ""]
                  .filter(Boolean).join("\n").replace(/\n/g, eol);
                for (let i = 0; i <= reply.length; i++) {
                  expectBubbleSafe(splitMascotReply(reply.slice(0, i)).prose);
                  checked++;
                }
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it("leaks at most the ambiguous backticks when the opener is mid-line", () => {
    // An opener glued to the end of a prose line is the one shape where the
    // trailing-partial trim cannot help: mid-sentence, ` and `` are far more
    // often the start of an inline `code` span, which must not be eaten. So the
    // window is one or two backticks for one delta — never the info string,
    // never a byte of the body.
    const reply = "Here you go: ```mascot\n" + BODY + "\n```";
    const flashes = new Set<string>();
    for (let i = 0; i <= reply.length; i++) {
      const { prose } = splitMascotReply(reply.slice(0, i));
      expect(prose.replace(/`{1,2}$/, "")).not.toContain("`");
      expect(prose).not.toMatch(/[{}]|mascot|actions/i);
      if (prose.endsWith("`")) flashes.add(prose);
    }
    expect([...flashes]).toEqual(["Here you go: `", "Here you go: ``"]);
  });
});

describe("parseMascotActions", () => {
  it("reads the actions array", () => {
    expect(parseMascotActions(BODY)).toEqual([{ type: "os_click", target: { elementId: "u1" } }]);
  });
  it("accepts a bare top-level array", () => {
    expect(parseMascotActions('[{"type":"os_see"}]')).toEqual([{ type: "os_see" }]);
  });
  it("drops an action whose id is not on the allowlist", () => {
    // (Tellaflow: the desktop tier's version of an id off the allowlist.)
    const out = parseMascotActions('{"actions":[{"type":"os_app","name":"Notes","action":"delete"},{"type":"os_app","name":"Notes","action":"launch"}]}');
    expect(out).toEqual([{ type: "os_app", name: "Notes", action: "launch" }]);
  });
  it("drops an unknown action type", () => {
    expect(parseMascotActions('{"actions":[{"type":"rm_rf"}]}')).toEqual([]);
  });
  it("returns nothing for a null or empty fence", () => {
    expect(parseMascotActions(null)).toEqual([]);
    expect(parseMascotActions("   ")).toEqual([]);
  });
  it("returns nothing when actions is not a list", () => {
    expect(parseMascotActions('{"actions":"select the hero"}')).toEqual([]);
  });
  it("salvages a block the model padded with prose", () => {
    const out = parseMascotActions('Here you go:\n{"actions":[{"type":"os_see"}]}\nThat should do it.');
    expect(out).toEqual([{ type: "os_see" }]);
  });
});

describe("malformed JSON costs the actions, never the prose", () => {
  const broken = "Here you go.\n```mascot\n{\"actions\": [ oops\n```";
  const r = splitMascotReply(broken);
  it("still shows the prose", () => expect(r.prose).toBe("Here you go."));
  it("still hides the block", () => expect(r.prose).not.toContain("actions"));
  it("yields no actions and does not throw", () => expect(parseMascotActions(r.fence)).toEqual([]));
});

describe("stripForSpeech", () => {
  it("drops emphasis and code markers", () =>
    expect(stripForSpeech("That **hero** is *too* `narrow`")).toBe("That hero is too narrow"));
  it("reads a link as its text, not its href", () =>
    expect(stripForSpeech("Check [the hero](#hero) first")).toBe("Check the hero first"));
  it("drops bullets and collapses the list into one line", () =>
    expect(stripForSpeech("- one\n- two\n* three")).toBe("one two three"));
  it("keeps ordered-list numbers, which carry meaning aloud", () =>
    expect(stripForSpeech("1. open the panel\n2. click add")).toBe("1. open the panel 2. click add"));
  it("drops headings and quote markers", () =>
    expect(stripForSpeech("## Contrast\n> too low")).toBe("Contrast too low"));
  it("removes a leftover fence and its contents", () =>
    expect(stripForSpeech('All set.\n```mascot\n{"actions":[]}\n```')).toBe("All set."));
  it("removes an unterminated fence remnant", () =>
    expect(stripForSpeech("All set.\n```mascot\n{\"acti")).toBe("All set."));
  it("leaves snake_case identifiers intact", () =>
    expect(stripForSpeech("I called get_rect on it")).toBe("I called get_rect on it"));
  it("keeps arithmetic asterisks intact", () =>
    expect(stripForSpeech("width is 2 * 3 rem")).toBe("width is 2 * 3 rem"));
  it("collapses stray whitespace", () =>
    expect(stripForSpeech("  Done.   \n\n  Anything else?  ")).toBe("Done. Anything else?"));
  it("handles empty prose", () => expect(stripForSpeech("")).toBe(""));
});
