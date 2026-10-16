/**
 * Auto-learn dictionary.
 *
 * After Tellaflow pastes a transcript, we briefly watch the text field it was
 * pasted into (macOS Accessibility API, read-only). If the user fixes a
 * misheard word — "cooper netties" → "Kubernetes" — we learn that as a
 * dictionary replacement so the next dictation gets it right.
 *
 * Wispr Flow documents this behaviour but not its mechanism; this is our own
 * design:
 *   1. ~0.7 s after paste, snapshot the focused field's value (baseline). The
 *      paste lands asynchronously, so retry for a few seconds before deciding
 *      this isn't our field.
 *   2. Poll the same field for up to 45 s while the same app stays frontmost,
 *      remembering the latest value that still contains most of the pasted text
 *      or that holds a learnable fix of it (a short dictation can be mostly
 *      replaced by its correction). Chat apps clear the field when you hit
 *      Enter — that last good value is the corrected one.
 *      As soon as a learnable fix is in the field and the user has stopped
 *      typing (value unchanged for `settlePolls` polls) or sent it, we offer it
 *      right away — waiting out the whole window made the feature look broken.
 *   3. Word-diff baseline vs. corrected value, restricted to the pasted span.
 *      Each small substitution (≤3 words → ≤3 words) that sounds like the
 *      original and isn't an everyday word / number / URL / path / code is a
 *      learned correction.
 *
 * Text never leaves the machine and nothing is written outside the dictionary.
 */

const { soundsLike, squash } = require('./text-similarity');
const { isCommonWord } = require('./common-words');

const MAX_HUNK_WORDS = 3;
const MIN_SOUND_SIMILARITY = 0.5;

function stripPunct(w) {
  return w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function tokenize(text) {
  return String(text || '').split(/\s+/).filter(Boolean).map((raw) => ({ raw, norm: stripPunct(raw) }));
}

/** Word-level LCS diff → list of hunks { del: [i..], ins: [j..] } (indices into a / b). */
function diffWords(a, b) {
  // Trim common prefix/suffix first — edits are local, fields can be huge.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre].norm.toLowerCase() === b[pre].norm.toLowerCase() && a[pre].norm === b[pre].norm) pre++;
  let suf = 0;
  while (
    suf < a.length - pre && suf < b.length - pre &&
    a[a.length - 1 - suf].norm === b[b.length - 1 - suf].norm
  ) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  if (A.length > 600 || B.length > 600) return []; // pathological; skip
  const n = A.length;
  const m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i].norm === B[j].norm ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hunks = [];
  let cur = null;
  let i = 0;
  let j = 0;
  const flush = () => { if (cur && (cur.del.length || cur.ins.length)) hunks.push(cur); cur = null; };
  while (i < n || j < m) {
    if (i < n && j < m && A[i].norm === B[j].norm) { flush(); i++; j++; continue; }
    cur = cur || { del: [], ins: [] };
    if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { cur.ins.push(pre + j); j++; }
    else { cur.del.push(pre + i); i++; }
  }
  flush();
  return hunks;
}

/** Locate the pasted text's word span inside `baselineTokens`. */
function findPastedSpan(baselineTokens, pastedTokens) {
  if (!pastedTokens.length) return null;
  const key = (t) => t.norm.toLowerCase();
  const head = pastedTokens.slice(0, Math.min(3, pastedTokens.length)).map(key);
  for (let s = baselineTokens.length - pastedTokens.length; s >= 0; s--) {
    let ok = true;
    for (let k = 0; k < head.length; k++) {
      if (key(baselineTokens[s + k]) !== head[k]) { ok = false; break; }
    }
    if (ok) return { start: s, end: s + pastedTokens.length };
  }
  return null;
}

const CODE_RE = /[{}()<>[\];=`$#@|\\^~*]/;
const URL_RE = /(https?:\/\/|www\.|\.com\b|\.io\b)/i;

function isLearnable(from, to) {
  if (!from || !to) return false;
  if (from.length > 60 || to.length > 40) return false;
  if (/\d/.test(to) && !/[a-z]/i.test(to)) return false; // numbers
  if (/^\d/.test(to)) return false;
  if (URL_RE.test(to) || to.includes('/')) return false;
  if (CODE_RE.test(to)) return false;
  const toWords = to.split(/\s+/);
  const fromWords = from.split(/\s+/);
  if (toWords.some((w) => w.length > 25)) return false;
  if (from.toLowerCase() === to.toLowerCase()) {
    // Case-only edit: learn it only when it introduces a capital (a proper noun),
    // and never for everyday words ("Will" vs "will").
    return /[A-Z]/.test(to) && from !== to && !fromWords.every(isCommonWord);
  }
  // User rewrote ordinary words ("great" → "good"): style edit, not a mishearing.
  if (toWords.every(isCommonWord)) return false;
  // A single everyday source word would hijack normal speech ("mark" → "Marc").
  if (fromWords.length === 1 && isCommonWord(fromWords[0])) return false;
  return soundsLike(from, to) >= MIN_SOUND_SIMILARITY;
}

/**
 * Pure core: corrections the user made to the pasted span.
 * @returns {{from: string, to: string}[]}
 */
function extractCorrections(pastedText, baselineValue, correctedValue) {
  const pasted = tokenize(pastedText);
  const a = tokenize(baselineValue);
  const b = tokenize(correctedValue);
  const span = findPastedSpan(a, pasted);
  if (!span) return [];
  const out = [];
  const seen = new Set();
  for (const h of diffWords(a, b)) {
    if (!h.del.length || !h.ins.length) continue; // pure insert/delete: not a correction
    if (h.del.length > MAX_HUNK_WORDS || h.ins.length > MAX_HUNK_WORDS) continue;
    if (h.del.some((i) => i < span.start || i >= span.end)) continue;
    const from = h.del.map((i) => a[i].norm).join(' ').trim();
    const to = h.ins.map((j) => b[j].norm).join(' ').trim();
    if (!isLearnable(from, to)) continue;
    const k = `${from.toLowerCase()}→${to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ from: from.toLowerCase(), to });
  }
  return out;
}

/** Share of pasted words still present in `value` (0..1). */
function overlap(pastedText, value) {
  const words = tokenize(pastedText).map((t) => squash(t.norm)).filter(Boolean);
  if (!words.length) return 0;
  const have = new Set(tokenize(value).map((t) => squash(t.norm)));
  return words.filter((w) => have.has(w)).length / words.length;
}

/**
 * Side-effectful watcher. All OS access is injected:
 *   readFocused(): Promise<{ app: string, value: string } | null>
 *   onLearn(corrections, ctx)
 */
function createAutoLearnWatcher({
  readFocused,
  onLearn,
  isEnabled = () => true,
  timers = { setTimeout, clearTimeout },
  baselineDelayMs = 700,
  baselineAttempts = 5,
  pollMs = 1500,
  settlePolls = 2,
  windowMs = 45_000,
  log = console,
}) {
  let session = null;

  function stop(evaluate = true) {
    const s = session;
    if (!s) return;
    session = null;
    if (s.timer) timers.clearTimeout(s.timer);
    if (!evaluate || !s.baseline || !s.lastGood || s.lastGood === s.baseline) return;
    const corrections = extractCorrections(s.pasted, s.baseline, s.lastGood);
    if (!corrections.length) {
      log.log?.(`[auto-learn] field in ${s.app} was edited, but no misheard-word fix found`);
      return;
    }
    try { onLearn(corrections, { app: s.app }); } catch (err) { log.warn?.('[auto-learn] onLearn failed:', err.message); }
  }

  function isGoodValue(s, value) {
    if (!value) return false;
    if (overlap(s.pasted, value) >= 0.5) return true;
    return extractCorrections(s.pasted, s.baseline, value).length > 0;
  }

  async function tick(s) {
    if (session !== s) return;
    let snap = null;
    try { snap = await readFocused(); } catch { snap = null; }
    if (session !== s) return;
    const sameApp = !!snap && (!s.app || snap.app === s.app);
    if (s.baseline != null && !sameApp) { stop(true); return; }
    if (s.baseline == null) {
      if (!sameApp || !snap.value || overlap(s.pasted, snap.value) < 0.8) {
        // The paste may not have landed yet (app activation, slow field).
        if (++s.baselineTries < baselineAttempts) {
          s.timer = timers.setTimeout(() => tick(s), baselineDelayMs);
          return;
        }
        log.log?.(!sameApp || snap.value
          ? `[auto-learn] focused field in ${snap?.app || 'the frontmost app'} doesn't contain the dictation; not watching`
          : `[auto-learn] can't read the focused text field in ${snap.app}; not watching`);
        stop(false);
        return;
      }
      s.baseline = snap.value;
      s.lastGood = snap.value;
      s.lastSeen = snap.value;
      s.app = snap.app;
    } else {
      const good = isGoodValue(s, snap.value);
      if (good) s.lastGood = snap.value;
      s.stable = snap.value === s.lastSeen ? s.stable + 1 : 0;
      s.lastSeen = snap.value;
      // Edit finished (paused, or the field was sent/cleared): offer it now.
      const settled = good ? s.stable >= settlePolls : true;
      if (settled && s.lastGood !== s.baseline && extractCorrections(s.pasted, s.baseline, s.lastGood).length) {
        stop(true);
        return;
      }
    }
    if (Date.now() - s.startedAt >= windowMs) { stop(true); return; }
    s.timer = timers.setTimeout(() => tick(s), pollMs);
  }

  /** Begin watching after a paste. Any previous watch is evaluated and ended. */
  function watch(pastedText, { app = null } = {}) {
    stop(true);
    if (!isEnabled() || !pastedText || pastedText.length < 3) return;
    const s = { pasted: pastedText, app, baseline: null, baselineTries: 0, lastGood: null, lastSeen: null, stable: 0, startedAt: Date.now(), timer: null };
    session = s;
    s.timer = timers.setTimeout(() => tick(s), baselineDelayMs);
  }

  return { watch, stop, isWatching: () => !!session };
}

module.exports = { extractCorrections, isLearnable, diffWords, tokenize, overlap, createAutoLearnWatcher };
