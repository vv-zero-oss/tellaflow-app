/**
 * App-context vocabulary.
 *
 * When recording starts we read the frontmost app, its window title and the
 * focused field (read-only Accessibility). From that we pull out words the
 * speaker is likely to say that a speech model will misspell:
 *   - chat apps (Slack, Teams, Discord, Messages…): people's names
 *   - code editors (Cursor, VS Code, Zed, Xcode, JetBrains…): file names and
 *     identifiers, plus "index dot js" → "index.js"
 *
 * The vocabulary is used twice: as a Whisper initial prompt (biases decoding)
 * and as a post-pass that snaps near-miss spellings to the exact term.
 */

const { soundsLike, similarity, squash } = require('./text-similarity');
const { isCommonWord } = require('./common-words');

const CHAT_APPS = [
  'slack', 'microsoft teams', 'teams', 'discord', 'messages', 'whatsapp', 'telegram', 'signal',
  'mattermost', 'element', 'zulip', 'google chat', 'skype', 'messenger', 'mail', 'outlook', 'spark', 'superhuman',
];
const CODE_APPS = [
  'cursor', 'code', 'visual studio code', 'code - insiders', 'vscodium', 'windsurf', 'zed', 'xcode', 'sublime text',
  'intellij idea', 'webstorm', 'pycharm', 'goland', 'rider', 'clion', 'android studio', 'nova', 'bbedit', 'neovide',
  'terminal', 'iterm2', 'warp', 'ghostty',
];
const CODE_BUNDLE_HINTS = ['com.todesktop.230313mzl4w4u92', 'com.microsoft.vscode', 'dev.zed', 'com.jetbrains', 'com.apple.dt.xcode'];
const CHAT_BUNDLE_HINTS = ['com.tinyspeck.slackmacgap', 'com.microsoft.teams', 'com.hnc.discord', 'com.apple.mobilesms', 'net.whatsapp'];

const FILE_EXTENSIONS = [
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'json', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'm', 'mm', 'c', 'h',
  'cpp', 'hpp', 'cs', 'php', 'html', 'css', 'scss', 'md', 'mdx', 'yml', 'yaml', 'toml', 'sql', 'sh', 'txt', 'env',
  'vue', 'svelte', 'lock', 'xml', 'plist', 'gradle', 'tf', 'proto', 'graphql', 'ini', 'cfg',
];
const EXT_ALT = FILE_EXTENSIONS.join('|');
const FILE_RE = new RegExp(`(?:^|[\\s"'(\\[/\\\\])([A-Za-z0-9_][\\w.-]{0,60}\\.(?:${EXT_ALT}))(?=$|[\\s"'),:;\\]])`, 'g');
const IDENT_RE = /\b([a-z]+(?:[A-Z][a-z0-9]+)+|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;
const NAME_RE = /\b([A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?)(?:\s+([A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?))?\b/g;
const MENTION_RE = /@([A-Za-z][\w.-]{1,30})/g;

function classifyApp(app = '', bundleId = '') {
  const a = app.toLowerCase();
  const b = bundleId.toLowerCase();
  if (CODE_APPS.includes(a) || CODE_BUNDLE_HINTS.some((h) => b.startsWith(h))) return 'code';
  if (CHAT_APPS.includes(a) || CHAT_BUNDLE_HINTS.some((h) => b.startsWith(h))) return 'chat';
  return 'other';
}

// Title words that look like names but are UI chrome.
const TITLE_NOISE = new Set([
  'slack', 'teams', 'microsoft', 'discord', 'channel', 'dm', 'direct', 'messages', 'message', 'threads', 'thread',
  'huddle', 'activity', 'home', 'later', 'search', 'chat', 'calendar', 'inbox', 'drafts', 'mentions', 'reactions',
  'workspace', 'general', 'random', 'untitled', 'welcome', 'settings', 'preview', 'edited', 'cursor', 'code', 'visual',
  'studio', 'zed', 'xcode', 'terminal', 'new', 'mail', 'outlook', 'january', 'february', 'march', 'april', 'june',
  'july', 'august', 'september', 'october', 'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'sunday', 'today', 'yesterday', 'i',
]);

function pushUnique(arr, v, max) {
  if (!v || arr.length >= max) return;
  if (!arr.some((x) => x.toLowerCase() === v.toLowerCase())) arr.push(v);
}

function extractNames(text, max = 25) {
  const names = [];
  const s = String(text || '');
  let m;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(s))) {
    const handle = m[1].replace(/[._-]+/g, ' ').trim();
    // "@jane.doe" → "Jane Doe"
    pushUnique(names, handle.split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1)).join(' '), max);
  }
  NAME_RE.lastIndex = 0;
  while ((m = NAME_RE.exec(s))) {
    const parts = [m[1], m[2]].filter(Boolean).filter((w) => !TITLE_NOISE.has(w.toLowerCase()) && !isCommonWord(w));
    if (!parts.length) continue;
    // Sentence-initial single words are mostly not names; keep them only if
    // they are not dictionary words (already filtered) and ≥ 3 letters.
    const name = parts.join(' ');
    if (name.length >= 3) pushUnique(names, name, max);
  }
  return names;
}

function extractFiles(text, max = 40) {
  const files = [];
  const s = String(text || '');
  let m;
  FILE_RE.lastIndex = 0;
  while ((m = FILE_RE.exec(s))) pushUnique(files, m[1].replace(/^[./\\]+/, ''), max);
  return files;
}

function extractIdentifiers(text, max = 40) {
  const ids = [];
  let m;
  IDENT_RE.lastIndex = 0;
  const s = String(text || '');
  while ((m = IDENT_RE.exec(s))) if (m[1].length >= 5) pushUnique(ids, m[1], max);
  return ids;
}

/** Window-title segments, e.g. "Jane Doe (DM) - Acme - Slack" → ["Jane Doe (DM)", "Acme", "Slack"]. */
function titleSegments(title) {
  return String(title || '').split(/\s+[-–—|·•]\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {{app?: string, bundleId?: string, windowTitle?: string, focusedValue?: string}} ctx
 * @returns {{kind: 'chat'|'code'|'other', app: string, names: string[], files: string[], terms: string[]}}
 */
function extractContextVocabulary(ctx = {}) {
  const kind = classifyApp(ctx.app, ctx.bundleId);
  const title = ctx.windowTitle || '';
  const value = (ctx.focusedValue || '').slice(-4000);
  const vocab = { kind, app: ctx.app || '', names: [], files: [], terms: [] };

  if (kind === 'chat') {
    const segs = titleSegments(title);
    // Slack/Teams put the conversation first: "Jane Doe (DM)", "Jane, Bob, Ann".
    if (segs.length) {
      const first = segs[0].replace(/\((?:DM|Channel|Group|Huddle)\)/gi, '').replace(/^[#!]/, '').trim();
      if (!/^#/.test(segs[0])) {
        for (const part of first.split(/,\s*|\s+and\s+/)) {
          const n = part.trim();
          if (/^[A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+){0,2}$/.test(n) && !TITLE_NOISE.has(n.toLowerCase())) pushUnique(vocab.names, n, 25);
        }
      }
    }
    for (const n of extractNames(`${title}\n${value}`)) pushUnique(vocab.names, n, 25);
  } else if (kind === 'code') {
    for (const f of extractFiles(`${title}\n${value}`)) pushUnique(vocab.files, f, 40);
    for (const id of extractIdentifiers(value)) pushUnique(vocab.terms, id, 40);
    // Project/folder name is usually the 2nd title segment ("index.ts — my-app").
    const segs = titleSegments(title);
    if (segs[1] && /^[\w.-]{3,40}$/.test(segs[1])) pushUnique(vocab.terms, segs[1], 40);
  } else {
    for (const n of extractNames(title, 10)) pushUnique(vocab.names, n, 10);
  }
  return vocab;
}

function isEmptyVocab(v) {
  return !v || (!v.names.length && !v.files.length && !v.terms.length);
}

/** Short Whisper initial prompt. Whisper uses ~224 prompt tokens; stay well under. */
function buildWhisperPrompt(vocab, maxChars = 400) {
  if (isEmptyVocab(vocab)) return '';
  const parts = [];
  if (vocab.names.length) parts.push(`Names: ${vocab.names.join(', ')}.`);
  if (vocab.files.length) parts.push(`Files: ${vocab.files.join(', ')}.`);
  if (vocab.terms.length) parts.push(`Terms: ${vocab.terms.join(', ')}.`);
  let out = parts.join(' ');
  if (out.length > maxChars) out = out.slice(0, maxChars).replace(/,[^,]*$/, '.');
  return out;
}

const SPOKEN_FILE_RE = new RegExp(`\\b((?:[A-Za-z0-9_-]+\\s+){0,2}[A-Za-z0-9_-]+)\\s+dot\\s+(${EXT_ALT})\\b`, 'gi');

/**
 * "index dot js" → "index.js"; "app config dot ts" → "appConfig.ts" when the
 * vocabulary knows that file.
 */
function normalizeSpokenFileNames(text, files = []) {
  return text.replace(SPOKEN_FILE_RE, (whole, base, ext) => {
    const words = base.trim().split(/\s+/);
    // Try the longest run of preceding words that matches a known file.
    for (let k = Math.min(3, words.length); k >= 1; k--) {
      const stem = words.slice(-k).join('');
      const candidate = files.find((f) => {
        const dot = f.lastIndexOf('.');
        return f.slice(dot + 1).toLowerCase() === ext.toLowerCase() && similarity(f.slice(0, dot), stem) >= 0.85;
      });
      if (candidate) return [...words.slice(0, words.length - k), candidate].join(' ');
    }
    const prefix = words.slice(0, -1);
    return [...prefix, `${words[words.length - 1]}.${ext.toLowerCase()}`].join(' ');
  });
}

/**
 * Replace near-miss spellings of vocabulary terms in `text`.
 * Conservative: exact (case-insensitive) matches get the right casing; fuzzy
 * matches need ≥4 letters, must not be everyday words, and must sound alike.
 */
function snapToVocabulary(text, terms) {
  if (!terms.length) return text;
  const sorted = [...new Set(terms)].sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length || b.length - a.length);
  const tokens = text.split(/(\s+)/); // keep whitespace tokens
  const wordIdx = [];
  tokens.forEach((t, i) => { if (t && !/^\s+$/.test(t)) wordIdx.push(i); });
  const used = new Set();

  for (const term of sorted) {
    const tw = term.split(/\s+/).length;
    const termSq = squash(term.replace(/\.[a-z0-9]+$/i, ''));
    if (termSq.length < 3) continue;
    for (let w = 0; w + tw <= wordIdx.length; w++) {
      const span = wordIdx.slice(w, w + tw);
      if (span.some((i) => used.has(i))) continue;
      const first = span[0];
      const last = span[span.length - 1];
      const phraseRaw = tokens.slice(first, last + 1).join('');
      const lead = phraseRaw.match(/^[^\p{L}\p{N}]*/u)[0];
      const trail = phraseRaw.match(/[^\p{L}\p{N}]*$/u)[0];
      const phrase = phraseRaw.slice(lead.length, phraseRaw.length - trail.length);
      if (!phrase) continue;
      let match = false;
      if (phrase.toLowerCase() === term.toLowerCase()) {
        match = phrase !== term;
      } else {
        const ps = squash(phrase);
        if (ps.length < 4 || termSq.length < 4) continue;
        if (tw === 1 && isCommonWord(phrase)) continue;
        if (phrase.split(/\s+/).every(isCommonWord)) continue;
        const sim = similarity(phrase, term);
        match = sim >= 0.6 && soundsLike(phrase, term) >= 0.82;
      }
      if (!match) continue;
      tokens[first] = lead + term + trail;
      for (let i = first + 1; i <= last; i++) tokens[i] = '';
      span.forEach((i) => used.add(i));
    }
  }
  return tokens.join('').replace(/\s{2,}/g, ' ');
}

function applyContextVocabulary(text, vocab) {
  if (!text || isEmptyVocab(vocab)) return text;
  let out = text;
  if (vocab.kind === 'code' || vocab.files.length) out = normalizeSpokenFileNames(out, vocab.files);
  const terms = [...vocab.names, ...vocab.files, ...vocab.terms];
  return snapToVocabulary(out, terms);
}

module.exports = {
  classifyApp,
  extractContextVocabulary,
  extractNames,
  extractFiles,
  extractIdentifiers,
  buildWhisperPrompt,
  normalizeSpokenFileNames,
  snapToVocabulary,
  applyContextVocabulary,
  isEmptyVocab,
  FILE_EXTENSIONS,
};
