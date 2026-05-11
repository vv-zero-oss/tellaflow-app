/**
 * Pure JS text formatter for Whisper transcription output.
 * Zero dependencies. Handles filler removal, voice commands,
 * list detection, and whitespace cleanup.
 */

const FILLER_PATTERNS = [
  /\b(?:um|uh|hmm|hm|ah|eh|er)\b/gi,
  /\b(?:you know)\b/gi,
  /\b(?:I mean)\b/gi,
  /\b(?:sort of|kind of)\b/gi,
  /\b(?:basically)\b/gi,
  /\b(?:actually)\b/gi,
  /\b(?:like),?\s(?=like\b)/gi, // repeated "like, like"
];

const VOICE_COMMANDS = [
  { pattern: /\bnew paragraph\b/gi, replacement: '\n\n' },
  { pattern: /\bnext paragraph\b/gi, replacement: '\n\n' },
  { pattern: /\bnew line\b/gi, replacement: '\n' },
  { pattern: /\bnext line\b/gi, replacement: '\n' },
  { pattern: /\bfull stop\b/gi, replacement: '.' },
  { pattern: /\bquestion mark\b/gi, replacement: '?' },
  { pattern: /\bexclamation mark\b/gi, replacement: '!' },
  { pattern: /\bopen parenthesis\b/gi, replacement: '(' },
  { pattern: /\bclose parenthesis\b/gi, replacement: ')' },
  { pattern: /\bopen bracket\b/gi, replacement: '(' },
  { pattern: /\bclose bracket\b/gi, replacement: ')' },
];

// Words that signal a numbered list item
const ORDINAL_WORDS = {
  'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5,
  'sixth': 6, 'seventh': 7, 'eighth': 8, 'ninth': 9, 'tenth': 10,
};

const NUMBER_WORDS = {
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
};

function formatTranscription(raw) {
  if (!raw || typeof raw !== 'string') return '';

  let text = raw;

  text = removeFillers(text);
  text = applyVoiceCommands(text);
  text = detectAndFormatLists(text);
  text = cleanWhitespace(text);
  text = normalizeTranscriptArtifacts(text);
  text = capitalizeSentences(text);

  return text;
}

function removeFillers(text) {
  for (const pattern of FILLER_PATTERNS) {
    text = text.replace(pattern, '');
  }
  return text;
}

function applyVoiceCommands(text) {
  for (const { pattern, replacement } of VOICE_COMMANDS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

/**
 * Detects numbered and unordered list patterns in text.
 *
 * Numbered: "first X second Y third Z" or "number one X number two Y"
 *           or "point one X point two Y" or "1 X 2 Y 3 Z"
 * Unordered: not currently auto-detected (too many false positives)
 *            -- users can say "dash" or "new line" explicitly.
 */
function detectAndFormatLists(text) {
  // --- Pattern A: "number one ... number two ..." or "point one ... point two ..."
  const prefixNumbered = /\b(?:number|point)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi;
  if (countMatches(text, prefixNumbered) >= 2) {
    return formatPrefixNumberedList(text);
  }

  // --- Pattern B: "first ... second ... third ..."
  const ordinalPattern = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/gi;
  const ordinalMatches = findOrderedSequence(text, ordinalPattern, ORDINAL_WORDS);
  if (ordinalMatches.length >= 2) {
    return formatOrdinalList(text, ordinalMatches);
  }

  // --- Pattern C: "1. ... 2. ... 3. ..." (Whisper sometimes outputs these directly)
  const digitListPattern = /\b(\d{1,2})\.\s/g;
  if (countMatches(text, digitListPattern) >= 2) {
    return formatDigitList(text);
  }

  return text;
}

function countMatches(text, pattern) {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

/**
 * Finds ordinal words that appear in ascending order.
 */
function findOrderedSequence(text, pattern, wordMap) {
  const matches = [];
  let match;
  const p = new RegExp(pattern.source, pattern.flags);
  while ((match = p.exec(text)) !== null) {
    const word = match[1].toLowerCase();
    const num = wordMap[word];
    if (num !== undefined) {
      matches.push({ index: match.index, length: match[0].length, num, word });
    }
  }

  // Keep only items that form an ascending sequence
  const ascending = [];
  let lastNum = 0;
  for (const m of matches) {
    if (m.num > lastNum) {
      ascending.push(m);
      lastNum = m.num;
    }
  }
  return ascending;
}

function formatPrefixNumberedList(text) {
  const parts = text.split(/\b(?:number|point)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  const markers = [];
  let m;
  const p = /\b(?:number|point)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi;
  while ((m = p.exec(text)) !== null) {
    markers.push(NUMBER_WORDS[m[1].toLowerCase()] || 0);
  }

  if (parts.length <= 1) return text;

  let result = parts[0].trim();
  if (result) result += '\n';

  for (let i = 0; i < markers.length; i++) {
    const content = (parts[i + 1] || '').trim();
    if (content) {
      result += `${markers[i]}. ${capitalizeFirst(content)}\n`;
    }
  }

  return result.trim();
}

function formatOrdinalList(text, matches) {
  const parts = [];
  let lastEnd = 0;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.index > lastEnd) {
      const before = text.substring(lastEnd, m.index).trim();
      if (before && i === 0) {
        parts.push({ type: 'preamble', text: before });
      }
    }

    const nextStart = (i + 1 < matches.length) ? matches[i + 1].index : text.length;
    const content = text.substring(m.index + m.length, nextStart).trim();

    // Remove leading comma, period, or colon after the ordinal
    const cleaned = content.replace(/^[,.:;]\s*/, '').trim();
    parts.push({ type: 'item', num: m.num, text: cleaned });

    lastEnd = nextStart;
  }

  let result = '';
  for (const part of parts) {
    if (part.type === 'preamble') {
      result += part.text + '\n';
    } else {
      result += `${part.num}. ${capitalizeFirst(part.text)}\n`;
    }
  }

  return result.trim();
}

function formatDigitList(text) {
  // Split on "N. " patterns and reconstruct as a proper list
  const lines = text.split(/(?=\b\d{1,2}\.\s)/);
  return lines
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n');
}

function cleanWhitespace(text) {
  return text
    .replace(/[ \t]+/g, ' ')           // collapse horizontal whitespace
    .replace(/ *\n */g, '\n')           // trim spaces around newlines
    .replace(/\n{3,}/g, '\n\n')         // max 2 consecutive newlines
    .replace(/\s+([.,;:!?])/g, '$1')    // no space before punctuation
    .replace(/([.,;:!?])(?=[A-Za-z])/g, '$1 ') // ensure space after punctuation
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// Transcript artifact normalization — patterns and fix-up function
// ═══════════════════════════════════════════════════════════════════════════

// ── URLs & Domains ───────────────────────────────────────────────────────
const TLDS = 'com|org|net|io|dev|co|ai|app|edu|gov|me|info|biz|us|uk|ca|au|de|fr|in|jp|xyz|tech|cloud|gg|tv|fm|so|sh';
const TLD_RE = new RegExp(`(?<=\\S)\\s*\\.\\s*(${TLDS})\\b`, 'gi');
const DOT_WORD_TLD_RE = new RegExp(`(\\S)\\s+dot\\s+(${TLDS})\\b`, 'gi');
const PROTOCOL_RE = /\bHTTPS?\s*colon\s*(?:forward\s*)?slash\s*(?:forward\s*)?slash\s*/gi;
const WWW_DOT_RE = /\bwww\s*(?:dot|\.) */gi;
const SLASH_SPOKEN_RE = /(\.[a-z]{2,6}(?:\/\S*)?)\s+slash\s+/gi;

// ── Email ────────────────────────────────────────────────────────────────
const EMAIL_AT_RE = /(\S+)\s*@\s*(\S+\.\S+)/g;
const AT_SPOKEN_RE = /(\S+)\s+(?:at the rate(?: of)?|at sign)\s+(\S+)/gi;

// ── Phone numbers ────────────────────────────────────────────────────────
// "555 - 123 - 4567" or "555 -123- 4567" → "555-123-4567"
const PHONE_DASH_RE = /(\d{3})\s*-\s*(\d{3})\s*-\s*(\d{4})\b/g;
// "plus 1 555" → "+1 555" (international prefix)
const PHONE_PLUS_RE = /\bplus\s+(\d{1,3})\s+(\d)/gi;
// Spoken: "555 dash 123 dash 4567"
const PHONE_SPOKEN_DASH_RE = /(\d{3})\s+dash\s+(\d{3})\s+dash\s+(\d{4})\b/gi;

// ── File paths ───────────────────────────────────────────────────────────
// "slash users slash documents" → "/users/documents"
const PATH_SPOKEN_SLASH_RE = /(?:^|\s)slash\s+(\w+)/gi;
// "backslash users backslash documents" → "\users\documents"
const PATH_SPOKEN_BACKSLASH_RE = /(?:^|\s)(?:back\s*slash)\s+(\w+)/gi;
// Spaces around path separators: "/ users / documents" → "/users/documents"
const PATH_SLASH_SPACE_RE = /(\/)[ \t]+(\w)/g;
const PATH_SPACE_SLASH_RE = /(\w)[ \t]+(\/)/g;

// ── IP addresses ─────────────────────────────────────────────────────────
// "192 . 168 . 1 . 1" → "192.168.1.1"
const IP_RE = /\b(\d{1,3})\s*\.\s*(\d{1,3})\s*\.\s*(\d{1,3})\s*\.\s*(\d{1,3})\b/g;
// "192 dot 168 dot 1 dot 1" → "192.168.1.1"
const IP_SPOKEN_RE = /\b(\d{1,3})\s+dot\s+(\d{1,3})\s+dot\s+(\d{1,3})\s+dot\s+(\d{1,3})\b/gi;

// ── Version numbers ──────────────────────────────────────────────────────
// "version 3 . 2 . 1" or "v 2 . 0" → "version 3.2.1" / "v2.0"
const VERSION_LABEL_RE = /\b(v(?:ersion)?)\s+(\d+)\s*\.\s*(\d+)(?:\s*\.\s*(\d+))?\b/gi;

// ── File extensions ──────────────────────────────────────────────────────
const FILE_EXTS = 'pdf|docx?|xlsx?|pptx?|csv|txt|jpg|jpeg|png|gif|svg|mp[34]|wav|zip|tar|gz|json|xml|html?|css|jsx?|tsx?|py|rb|go|rs|java|cpp|sh|yaml|yml|md|sql|env|log';
const FILE_EXT_RE = new RegExp(`(\\S)\\s*\\.\\s*(${FILE_EXTS})\\b`, 'gi');
// Spoken: "report dot pdf" → "report.pdf"
const FILE_EXT_SPOKEN_RE = new RegExp(`(\\S)\\s+dot\\s+(${FILE_EXTS})\\b`, 'gi');

// ── Hashtags ─────────────────────────────────────────────────────────────
// "# trending" → "#trending"   (but not "# 1" which is a numbered heading)
const HASHTAG_RE = /#\s+([A-Za-z]\w*)/g;
// "hashtag trending" → "#trending"
const HASHTAG_SPOKEN_RE = /\bhash\s*tag\s+(\w+)/gi;

// ── Currency ─────────────────────────────────────────────────────────────
// "$ 50" → "$50"
const CURRENCY_SPACE_RE = /(\$|€|£|¥)\s+(\d)/g;
// "50 dollars" → "$50", "30 pounds" → "£30", "20 euros" → "€20"
const CURRENCY_SPOKEN_RE = /\b(\d[\d,.]*)\s+dollars?\b/gi;
const CURRENCY_POUNDS_RE = /\b(\d[\d,.]*)\s+pounds?\b/gi;
const CURRENCY_EUROS_RE = /\b(\d[\d,.]*)\s+euros?\b/gi;

// ── Percentages ──────────────────────────────────────────────────────────
// "50 %" → "50%"
const PERCENT_SPACE_RE = /(\d)\s+%/g;
// "50 percent" → "50%"
const PERCENT_SPOKEN_RE = /\b(\d[\d,.]*)\s+percent\b/gi;

// ── Times ────────────────────────────────────────────────────────────────
// "1 : 30" → "1:30"
const TIME_COLON_RE = /\b(\d{1,2})\s*:\s*(\d{2})\b/g;
// "p. m." / "a. m." → "PM" / "AM"
const AM_PM_DOTS_RE = /\b([ap])\.\s*m\.?(?=\s|$)/gi;
// "p m" / "a m" after a time digit → "PM" / "AM"
const AM_PM_SPACE_RE = /(\d)\s+([ap])\s*m(?=\s|$)/gi;

// ── Contractions ─────────────────────────────────────────────────────────
// "don' t" / "can' t" / "won' t" / "isn' t" etc.
const CONTRACTION_RE = /(\w)'\s+(t|s|d|ll|re|ve|m)\b/gi;

// ── Acronyms ─────────────────────────────────────────────────────────────
// "U. S. A." → "USA", "A. I." → "AI"
const ACRONYM_RE = /\b([A-Z])\.\s*(?=([A-Z])\.?\s*(?:[A-Z]\.?\s*)*\b)/g;

// ── Social handles ───────────────────────────────────────────────────────
// "@ username" → " @username" (preserves space before @)
const SOCIAL_HANDLE_RE = /(\s|^)@\s+(\w+)/g;

// ── Ordinal suffixes ─────────────────────────────────────────────────────
// "1 st" → "1st", "2 nd" → "2nd", "3 rd" → "3rd", "4 th" → "4th"
const ORDINAL_SUFFIX_RE = /\b(\d+)\s+(st|nd|rd|th)\b/gi;

// ── Ampersand / brand compounds ──────────────────────────────────────────
// "AT and T" → "AT&T", "R and D" → "R&D"
const AMPERSAND_RE = /\b([A-Z]{1,4})\s+and\s+([A-Z]{1,4})\b/g;

// ── Repeated stutters ────────────────────────────────────────────────────
const STUTTER_RE = /\b(\w+)\s+\1\b/gi;

/**
 * Fix common Whisper transcription artifacts — URLs, emails, phone numbers,
 * file paths, IPs, versions, file extensions, hashtags, currency, percentages,
 * times, contractions, acronyms, social handles, ordinals, ampersands, stutters.
 */
function normalizeTranscriptArtifacts(text) {
  // ── URLs & Domains ──
  text = text.replace(PROTOCOL_RE, (m) => {
    const proto = m.trim().split(/\s/)[0].toLowerCase();
    return proto + '://';
  });
  text = text.replace(WWW_DOT_RE, 'www.');
  text = text.replace(DOT_WORD_TLD_RE, '$1.$2');
  text = text.replace(TLD_RE, (_, tld) => '.' + tld.toLowerCase());
  text = text.replace(SLASH_SPOKEN_RE, '$1/');

  // ── Email ──
  text = text.replace(AT_SPOKEN_RE, '$1@$2');
  text = text.replace(EMAIL_AT_RE, '$1@$2');

  // ── IP addresses (before generic dot cleanup) ──
  text = text.replace(IP_SPOKEN_RE, '$1.$2.$3.$4');
  text = text.replace(IP_RE, '$1.$2.$3.$4');

  // ── Version numbers ──
  text = text.replace(VERSION_LABEL_RE, (_, label, major, minor, patch) => {
    const v = label.toLowerCase() === 'version' ? 'version ' : 'v';
    return patch !== undefined ? `${v}${major}.${minor}.${patch}` : `${v}${major}.${minor}`;
  });

  // ── File extensions ──
  text = text.replace(FILE_EXT_SPOKEN_RE, '$1.$2');
  text = text.replace(FILE_EXT_RE, '$1.$2');

  // ── Phone numbers ──
  text = text.replace(PHONE_SPOKEN_DASH_RE, '$1-$2-$3');
  text = text.replace(PHONE_DASH_RE, '$1-$2-$3');
  text = text.replace(PHONE_PLUS_RE, '+$1 $2');

  // ── File paths ──
  text = text.replace(PATH_SPOKEN_BACKSLASH_RE, '\\$1');
  text = text.replace(PATH_SPOKEN_SLASH_RE, '/$1');
  text = text.replace(PATH_SLASH_SPACE_RE, '$1$2');
  text = text.replace(PATH_SPACE_SLASH_RE, '$1$2');

  // ── Hashtags ──
  text = text.replace(HASHTAG_SPOKEN_RE, '#$1');
  text = text.replace(HASHTAG_RE, '#$1');

  // ── Social handles ──
  text = text.replace(SOCIAL_HANDLE_RE, '$1@$2');

  // ── Currency ──
  text = text.replace(CURRENCY_SPACE_RE, '$1$2');
  text = text.replace(CURRENCY_SPOKEN_RE, '$$$1');
  text = text.replace(CURRENCY_POUNDS_RE, '£$1');
  text = text.replace(CURRENCY_EUROS_RE, '€$1');

  // ── Percentages ──
  text = text.replace(PERCENT_SPACE_RE, '$1%');
  text = text.replace(PERCENT_SPOKEN_RE, '$1%');

  // ── Times ──
  text = text.replace(TIME_COLON_RE, '$1:$2');
  text = text.replace(AM_PM_DOTS_RE, (_, letter) => letter.toUpperCase() + 'M');
  text = text.replace(AM_PM_SPACE_RE, (_, digit, letter) => digit + ' ' + letter.toUpperCase() + 'M');

  // ── Contractions ──
  text = text.replace(CONTRACTION_RE, "$1'$2");

  // ── Acronyms: "U. S. A." → "USA" ──
  // Collapse sequences of single-letter-dot patterns, preserve trailing space
  text = text.replace(/\b((?:[A-Z]\.\s*){2,})/g, (m) => m.replace(/\.\s*/g, '') + ' ');
  text = text.replace(/  +/g, ' ');

  // ── Ordinal suffixes ──
  text = text.replace(ORDINAL_SUFFIX_RE, '$1$2');

  // ── Ampersand compounds: "AT and T" → "AT&T" ──
  text = text.replace(AMPERSAND_RE, '$1&$2');

  // ── Lowercase URLs/emails so capitalisation doesn't break them ──
  text = text.replace(/https?:\/\/\S+/gi, (m) => m.toLowerCase());
  text = text.replace(/\S+@\S+\.\S+/g, (m) => m.toLowerCase());

  // ── Stutter removal (last — other rules may create adjacent dupes) ──
  text = text.replace(STUTTER_RE, '$1');

  return text;
}

function capitalizeSentences(text) {
  // Protect tokens that must not be capitalised (URLs, emails, IPs, file paths,
  // version strings, file.ext, hashtags, handles) by replacing with placeholders.
  const preserved = [];
  const protect = (m) => { preserved.push(m); return `\x00P${preserved.length - 1}\x00`; };
  text = text.replace(/https?:\/\/\S+/gi, protect);                       // URLs
  text = text.replace(/\S+@\S+\.\S+/g, protect);                          // emails
  text = text.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, protect); // IPs
  text = text.replace(/\bv?\d+\.\d+(?:\.\d+)*\b/g, protect);              // versions
  text = text.replace(/\w+\.(?:pdf|docx?|xlsx?|pptx?|csv|txt|jpg|jpeg|png|gif|svg|mp[34]|wav|zip|tar|gz|json|xml|html?|css|jsx?|tsx?|py|rb|go|rs|java|cpp|sh|yaml|yml|md|sql|env|log)\b/gi, protect); // file.ext
  text = text.replace(/[#@]\w+/g, protect);                                // hashtags & handles
  text = text.replace(/[/\\]\w+(?:[/\\]\w+)*/g, protect);                  // file paths

  // Capitalize after sentence-ending punctuation
  text = text.replace(/([.!?]\s+)([a-z])/g, (_, punct, char) => punct + char.toUpperCase());
  // Capitalize after newlines
  text = text.replace(/(^|\n)([a-z])/g, (_, nl, char) => nl + char.toUpperCase());
  // Capitalize the very start
  if (text.length > 0) {
    text = text[0].toUpperCase() + text.slice(1);
  }

  // Restore protected tokens
  text = text.replace(/\x00P(\d+)\x00/g, (_, i) => preserved[Number(i)]);
  return text;
}

function capitalizeFirst(str) {
  if (!str) return str;
  return str[0].toUpperCase() + str.slice(1);
}

module.exports = { formatTranscription };
