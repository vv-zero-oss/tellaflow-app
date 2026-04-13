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

function capitalizeSentences(text) {
  // Capitalize after sentence-ending punctuation
  text = text.replace(/([.!?]\s+)([a-z])/g, (_, punct, char) => punct + char.toUpperCase());
  // Capitalize after newlines
  text = text.replace(/(^|\n)([a-z])/g, (_, nl, char) => nl + char.toUpperCase());
  // Capitalize the very start
  if (text.length > 0) {
    text = text[0].toUpperCase() + text.slice(1);
  }
  return text;
}

function capitalizeFirst(str) {
  if (!str) return str;
  return str[0].toUpperCase() + str.slice(1);
}

module.exports = { formatTranscription };
