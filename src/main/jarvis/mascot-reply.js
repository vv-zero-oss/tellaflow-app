"use strict";
/**
 * The mascot's reply protocol: streamed prose, then OPTIONALLY one trailing
 * fenced ```mascot block holding `{"actions":[…]}`.
 *
 * This is the same trick as ask-block.ts (one fenced JSON block carved out of an
 * otherwise plain reply), with one difference that drives every design choice
 * here: the `ask` fence is parsed once, at `done`, from a finished message —
 * whereas the mascot's prose is rendered LIVE into a speech bubble, token by
 * token, while the fence is still arriving. So it is not enough to ignore an
 * incomplete fence; the half-written fence must never reach the bubble at all.
 *
 * The failure this file exists to prevent: the model finishes its sentence and
 * starts the block, and for the ~200 ms it takes the rest to stream in, the
 * mascot appears to say "Selecting the hero. ```mascot {"actions":[{"type":"sel"
 * out loud. Hence `fenceOpen` and the trailing-partial trimming below — which
 * has to fire on a prefix as short as a single backtick at the start of a line,
 * because that is genuinely all that has arrived at that instant.
 *
 * The protocol is what the model is ASKED for; this file assumes it will be
 * broken. A second block, an opener glued to the end of a prose line, backticks
 * inside the body, a missing closer: each of those put raw `{"actions":…}` in
 * the bubble back when the split was a pair of regexes matching the first fence
 * out of the reply. So the text is now walked block by block, line by line, and
 * every block found is removed from the prose — not just the first.
 *
 * Parsing is deliberately total: a malformed block yields NO actions and never
 * throws. The prose is the valuable half of the reply — the user should still
 * hear what the mascot said even when the JSON it appended is garbage. Where the
 * two goals collide (a body so mangled that finding its end is guesswork), prose
 * safety wins and the actions are dropped.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitMascotReply = splitMascotReply;
exports.parseMascotActions = parseMascotActions;
exports.stripForSpeech = stripForSpeech;
const mascot_actions_1 = require("./mascot-actions");
/**
 * An opening fence. Once the word "mascot" is on the wire we know exactly what
 * this is, so everything from here to the closing fence is block, not prose —
 * including a body that is still mid-JSON.
 *
 * Deliberately NOT anchored to the start of a line, and case-insensitive: a
 * model that writes `Here you go: ```mascot` or ` ```Mascot ` still has its block
 * recognised. A stricter match would classify the opener as prose and then
 * stream the whole body's JSON into the bubble — the exact failure this module
 * exists to prevent, traded away for spec purity.
 */
const OPEN_FENCE = /`{3,}[ \t]*mascot/i;
/**
 * A whole line that is a backtick run plus an optional info string — the only
 * shape that can END a fenced block. Requiring the run to own its line (and, in
 * the closer case, to carry no info string, per CommonMark) is what keeps
 * backticks INSIDE the body from closing it early: a block whose JSON says
 * `"task":"wrap it in ``` fences"` used to close on those inner backticks,
 * truncating the actions to nothing and spilling `fences"}]}` into the bubble.
 */
const FENCE_LINE = /^[ \t]*`{3,}[ \t]*(.*)$/;
/** The opener of a SECOND mascot block, seen while still inside the first one —
 *  i.e. the model forgot a closer. Recognised so the first block's actions can
 *  still be salvaged instead of the whole rest of the reply being swallowed. */
const MASCOT_INFO = /^mascot\b/i;
/** A closing run glued to the end of a body line — `` {…}``` `` with no newline
 *  before it. Not a fence at all by CommonMark's rules, but models emit it. */
const GLUED_CLOSER = /[ \t]*`{3,}[ \t]*$/;
/** Drop the newline that separates the body's last line from the closing fence.
 *  `\r?` so a CRLF reply yields the same body as an LF one. */
const stripBodyEnd = (body) => body.replace(/\r?\n$/, "");
/** Is this body already a whole JSON value? The gate on accepting a glued
 *  closer: a ``` sitting inside an unfinished JSON string can never pass it. */
function isWholeJson(body) {
    try {
        JSON.parse(body);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Find the next mascot block at or after `from`, scanning line by line.
 *
 * A regex cannot do this job: the body is arbitrary model text that may contain
 * backticks, or a whole quoted ```json example, and a non-greedy `[\s\S]*?`
 * closes on the first of those. So the scan tracks the depth of fenced blocks
 * opened INSIDE the body and only lets a bare ``` line at depth 0 close ours.
 */
function findMascotBlock(text, from) {
    const open = OPEN_FENCE.exec(text.slice(from));
    if (!open)
        return null;
    const start = from + open.index;
    const firstBreak = text.indexOf("\n", start + open[0].length);
    // The opener's own line has not finished arriving, so nothing can have closed
    // it: the whole remainder is fence-in-progress.
    if (firstBreak < 0)
        return { start, body: null, end: text.length };
    const bodyStart = firstBreak + 1;
    let depth = 0;
    let lineStart = bodyStart;
    for (;;) {
        const brk = text.indexOf("\n", lineStart);
        const line = text.slice(lineStart, brk < 0 ? text.length : brk).replace(/\r$/, "");
        const m = FENCE_LINE.exec(line);
        if (m) {
            const info = m[1].trim();
            if (info === "" && depth > 0)
                depth--;
            else if (info === "") {
                return {
                    start,
                    body: stripBodyEnd(text.slice(bodyStart, lineStart)),
                    end: brk < 0 ? text.length : brk + 1,
                };
            }
            else if (MASCOT_INFO.test(info) && depth === 0) {
                // A second opener with no closer between. End this block here and hand
                // the opener back to the caller's loop, so the first block's actions
                // survive a model that dropped a closing fence.
                return { start, body: stripBodyEnd(text.slice(bodyStart, lineStart)), end: lineStart };
            }
            else if (!info.includes("`"))
                depth++;
        }
        // `` ```mascot\n{…}``` `` — a closer with no newline in front of it. Losing
        // a whole turn's actions to a missing "\n" is the worse failure, so it is
        // honoured, but ONLY when everything before it already parses as JSON. That
        // gate is what stops a ``` inside a half-written JSON string from closing
        // the block and handing the rest of the body to the bubble as prose.
        const glued = depth === 0 ? GLUED_CLOSER.exec(line) : null;
        if (glued && glued.index > 0) {
            const body = text.slice(bodyStart, lineStart + glued.index);
            if (isWholeJson(body))
                return { start, body, end: brk < 0 ? text.length : brk + 1 };
        }
        if (brk < 0)
            break;
        lineStart = brk + 1;
    }
    // The same glued closer with a body too malformed to parse. Accepted only at
    // the very END of the text, where there is no tail it could spill into the
    // bubble: mid-stream the block simply stays open until the next delta.
    const flush = text.replace(/\s+$/, "");
    const run = depth === 0 && flush.length > bodyStart ? /`{3,}$/.exec(flush) : null;
    if (run)
        return { start, body: stripBodyEnd(flush.slice(bodyStart, run.index)), end: text.length };
    return { start, body: null, end: text.length };
}
/**
 * A fence-in-progress too short to identify yet, anchored to the end of the text.
 *
 * Two shapes count, and the asymmetry is on purpose:
 *  - 1–3 backticks at the START of a line — a real fence must begin its own line,
 *    so this is the only place a lone "`" or "``" can be an opening fence rather
 *    than the first half of inline `code` in a sentence, which must NOT be eaten.
 *  - three backticks anywhere, since ``` is never inline code.
 * Either may already carry a prefix of the info string ("```m" … "```masco"); the
 * full "```mascot" is caught earlier by OPEN_FENCE.
 */
const TRAILING_PARTIAL = /(?:(?:^|\n)[ \t]*`{1,3}|```)[ \t]*(?:m(?:a(?:s(?:c(?:o)?)?)?)?)?$/;
/**
 * Trim a fence that is still being typed off the end of the prose.
 *
 * The odd-count guard matters: a reply that legitimately ends with a closing
 * ``` (the model showed a CSS snippet) would otherwise have that closer eaten,
 * leaving the bubble showing a code block that never ends. Counting the fence
 * markers before the match tells us which one this is — an odd number means the
 * prose has an open code block and these backticks CLOSE it, so leave them.
 */
function trimTrailingPartialFence(text) {
    const m = TRAILING_PARTIAL.exec(text);
    if (!m)
        return { text, open: false };
    const before = text.slice(0, m.index);
    if ((before.match(/```/g) ?? []).length % 2 === 1)
        return { text, open: false };
    return { text: before, open: true };
}
/**
 * Split a (possibly still streaming) reply into bubble prose and the action
 * block. Safe to call on every delta — it is pure, and cheap enough to run on
 * one: a bubble reply is a few hundred bytes and the loop below almost always
 * runs once.
 *
 * Every mascot block is walked, not just the first, because "the rest is prose"
 * is not true of a model that ignored "Never emit two blocks"
 * (mascot-prompt.ts): the second block's raw `{"actions":…}` used to type itself
 * into the speech bubble, character by character, and land in the transcript.
 *
 * With two blocks, the FIRST one's actions win and every later one is dropped
 * whole — body and actions both. First-wins because that is the block the prose
 * the user just read was introducing; dropping the rest rather than merging
 * because a model that emits two blocks is usually restating or second-guessing
 * itself, and running both would apply an action the user was never told about.
 * The prose AROUND the blocks is all kept: it is genuinely what the mascot said.
 */
function splitMascotReply(text) {
    const segments = [];
    let fence = null;
    let fenceOpen = false;
    let pos = 0;
    for (;;) {
        const block = findMascotBlock(text, pos);
        if (!block) {
            // Only the very end of the text can hold a fence still being typed, so
            // the partial trim runs once, on the final stretch of prose.
            const tail = trimTrailingPartialFence(text.slice(pos));
            segments.push(tail.text);
            fenceOpen = fenceOpen || tail.open;
            break;
        }
        segments.push(text.slice(pos, block.start));
        if (block.body === null) {
            fenceOpen = true;
            break;
        }
        if (fence === null)
            fence = block.body;
        pos = block.end;
    }
    return { prose: segments.map((s) => s.trim()).filter(Boolean).join("\n"), fence, fenceOpen };
}
/**
 * Salvage the JSON value out of a block body the model padded. Models append a
 * stray "// done" line or a sentence after the object often enough that losing
 * every action to it would be a bad trade; slicing to the outermost brackets
 * costs one retry and recovers those turns. Anything still unparseable is a
 * dropped block, not an exception.
 */
function parseLoose(body) {
    try {
        return JSON.parse(body);
    }
    catch { /* fall through to the salvage pass */ }
    const start = Math.min(...[body.indexOf("{"), body.indexOf("[")].filter((i) => i >= 0));
    const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
    if (!Number.isFinite(start) || end <= start)
        return null;
    try {
        return JSON.parse(body.slice(start, end + 1));
    }
    catch {
        return null;
    }
}
/**
 * Validate the actions in a completed block body. Returns `[]` for a null body,
 * malformed JSON, or a payload whose `actions` is not a list — every rejection
 * path is the same silent one, because the mascot's prose already told the user
 * something; a thrown parse error would take that away too.
 *
 * Accepts both `{"actions":[…]}` and a bare top-level array: models emit the
 * array form regularly no matter how the prompt words it, and the allowlist in
 * validateMascotActions is what actually keeps this safe either way.
 */
function parseMascotActions(fence) {
    if (!fence || !fence.trim())
        return [];
    const parsed = parseLoose(fence);
    if (Array.isArray(parsed))
        return (0, mascot_actions_1.validateMascotActions)(parsed);
    if (!parsed || typeof parsed !== "object")
        return [];
    return (0, mascot_actions_1.validateMascotActions)(parsed.actions);
}
/**
 * Flatten prose into something a TTS voice should read aloud (Phase 3).
 *
 * Markdown that renders fine in a bubble is noise in a voice: a speech engine
 * pronounces "**" and reads a URL out character by character. Everything here is
 * about what a listener should HEAR, so link targets, bullet glyphs and code
 * fences are dropped rather than transliterated.
 */
function stripForSpeech(prose) {
    let t = prose;
    // Fenced blocks go entirely — including a mascot block that reached this
    // function because a caller passed raw text instead of split prose, and an
    // unterminated one whose closer never arrived.
    t = t.replace(/```[\s\S]*?```/g, " ").replace(/```[\s\S]*$/, " ");
    // Line-level markers: headings, quotes, bullets, rules. Ordered-list numbers
    // stay — "1." reads as "one", which is information, not decoration.
    t = t
        .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
        .replace(/^[ \t]*>[ \t]?/gm, "")
        .replace(/^[ \t]*[-*+•][ \t]+/gm, "")
        .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, " ");
    // Links and images collapse to their visible text; the href is unspeakable.
    t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
    // Emphasis. The leading-character capture (rather than a lookbehind) keeps
    // snake_case identifiers intact: the `_` in `get_rect` is preceded by a word
    // character, so it never matches an emphasis pair.
    t = t
        .replace(/(^|[^A-Za-z0-9_])(\*\*|__)(\S[\s\S]*?\S|\S)\2(?![A-Za-z0-9_])/g, "$1$3")
        .replace(/(^|[^A-Za-z0-9_*])\*(\S[^*\n]*?\S|\S)\*/g, "$1$2")
        .replace(/(^|[^A-Za-z0-9_])_(\S[^_\n]*?\S|\S)_(?![A-Za-z0-9_])/g, "$1$2")
        .replace(/~~(\S[^~\n]*?\S|\S)~~/g, "$1");
    // Any backtick left is an inline-code marker or a fence remnant.
    t = t.replace(/`/g, "");
    return t.replace(/\s+/g, " ").trim();
}
