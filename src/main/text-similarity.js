/**
 * Small string-similarity helpers shared by auto-learn and context vocabulary.
 */

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Letters/digits only, lowercase: "Cooper Netties" → "coopernetties". */
function squash(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** 0..1 similarity of the squashed strings. */
function similarity(a, b) {
  const x = squash(a);
  const y = squash(b);
  if (!x.length && !y.length) return 1;
  const d = levenshtein(x, y);
  return 1 - d / Math.max(x.length, y.length);
}

/**
 * Rough English phonetic key (simplified Metaphone-style). Collapses common
 * sound-alike spellings so "cooper netties" and "kubernetes" land close.
 */
function phoneticKey(s) {
  let t = squash(s).replace(/[0-9]/g, '');
  if (!t) return '';
  t = t
    .replace(/^kn|^gn|^pn|^wr/, (m) => m[1])
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/c(?=[iey])/g, 's')
    .replace(/c/g, 'k')
    .replace(/dg(?=[iey])/g, 'j')
    .replace(/g(?=[iey])/g, 'j')
    .replace(/sh|ch/g, 'x')
    .replace(/th/g, '0')
    .replace(/z/g, 's')
    .replace(/v/g, 'f')
    .replace(/w(?![aeiou])/g, '')
    .replace(/h(?![aeiou])/g, '')
    .replace(/([^aeiou])h/g, '$1')
    .replace(/y(?![aeiou])/g, '');
  const first = t[0];
  const rest = t.slice(1).replace(/[aeiou]/g, '');
  return (first + rest).replace(/(.)\1+/g, '$1');
}

/** Best of spelling and phonetic similarity. */
function soundsLike(a, b) {
  const pa = phoneticKey(a);
  const pb = phoneticKey(b);
  const phon = pa && pb ? 1 - levenshtein(pa, pb) / Math.max(pa.length, pb.length) : 0;
  return Math.max(similarity(a, b), phon);
}

module.exports = { levenshtein, squash, similarity, phoneticKey, soundsLike };
