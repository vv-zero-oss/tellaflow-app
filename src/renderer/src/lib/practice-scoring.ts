/**
 * Echo Ladder scoring: token-level alignment → WER-style word accuracy.
 * Reference: WER on token sequences (substitutions, insertions, deletions).
 */

export type AlignmentOp = 'match' | 'substitute' | 'insert' | 'delete';

export type TokenAlignmentStep = {
  op: AlignmentOp;
  refToken?: string;
  hypToken?: string;
  refIndex?: number;
  hypIndex?: number;
};

export type EchoScoreResult = {
  refTokens: string[];
  hypTokens: string[];
  /** (substitutions + insertions + deletions) / refLen */
  wer: number;
  wordAccuracy: number;
  pass: boolean;
  matchedRefIndices: Set<number>;
  steps: TokenAlignmentStep[];
};

/** Lowercase, strip punctuation, collapse whitespace → tokens */
export function normalizeForPractice(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(s: string): string[] {
  const n = normalizeForPractice(s);
  if (!n) return [];
  return n.split(' ');
}

/**
 * Word-level edit distance alignment (Levenshtein on tokens).
 * WER = edits / refTokens.length (if ref empty, wer=0 when hyp empty else 1).
 */
export function scoreEchoRound(
  reference: string,
  hypothesis: string,
  passThreshold = 0.85,
): EchoScoreResult {
  const refTokens = tokenize(reference);
  const hypTokens = tokenize(hypothesis);
  const m = refTokens.length;
  const n = hypTokens.length;

  if (m === 0) {
    const wer = n === 0 ? 0 : 1;
    return {
      refTokens,
      hypTokens,
      wer,
      wordAccuracy: 1 - wer,
      pass: wer <= 1 - passThreshold,
      matchedRefIndices: new Set(),
      steps: [],
    };
  }

  const inf = m + n + 2;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(inf));
  const back: ('M' | 'S' | 'I' | 'D')[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill('M'),
  );

  dp[0][0] = 0;

  for (let i = 1; i <= m; i++) {
    dp[i][0] = i;
    back[i][0] = 'D';
  }
  for (let j = 1; j <= n; j++) {
    dp[0][j] = j;
    back[0][j] = 'I';
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const same = refTokens[i - 1] === hypTokens[j - 1];
      const subCost = same ? 0 : 1;
      const del = dp[i - 1][j] + 1;
      const ins = dp[i][j - 1] + 1;
      const sub = dp[i - 1][j - 1] + subCost;

      let best = sub;
      let b: 'M' | 'S' | 'I' | 'D' = same ? 'M' : 'S';
      if (del < best) {
        best = del;
        b = 'D';
      }
      if (ins < best) {
        best = ins;
        b = 'I';
      }
      dp[i][j] = best;
      back[i][j] = b;
    }
  }

  const edits = dp[m][n];
  const wer = edits / m;
  const wordAccuracy = Math.max(0, Math.min(1, 1 - wer));
  const pass = wordAccuracy >= passThreshold;

  const steps: TokenAlignmentStep[] = [];
  const matchedRefIndices = new Set<number>();
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const b = i > 0 && j > 0 ? back[i][j] : i > 0 ? 'D' : 'I';
    if (b === 'M') {
      steps.push({
        op: 'match',
        refToken: refTokens[i - 1],
        hypToken: hypTokens[j - 1],
        refIndex: i - 1,
        hypIndex: j - 1,
      });
      matchedRefIndices.add(i - 1);
      i--;
      j--;
    } else if (b === 'S') {
      steps.push({
        op: 'substitute',
        refToken: refTokens[i - 1],
        hypToken: hypTokens[j - 1],
        refIndex: i - 1,
        hypIndex: j - 1,
      });
      i--;
      j--;
    } else if (b === 'D') {
      steps.push({ op: 'delete', refToken: refTokens[i - 1], refIndex: i - 1 });
      i--;
    } else {
      steps.push({ op: 'insert', hypToken: hypTokens[j - 1], hypIndex: j - 1 });
      j--;
    }
  }
  steps.reverse();

  return {
    refTokens,
    hypTokens,
    wer,
    wordAccuracy,
    pass,
    matchedRefIndices,
    steps,
  };
}
