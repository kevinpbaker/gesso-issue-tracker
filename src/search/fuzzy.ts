/**
 * Fuzzy matching, for the command palette.
 *
 * Every word of the query has to appear in the text as a subsequence:
 * `stdn` finds "Set status: Done". A match scores higher the more of it
 * is contiguous, the more of it lands on word starts, and the earlier it
 * begins; a word found whole as a substring scores higher still, and one
 * the text starts with highest. Case and accents don't count.
 */

/** The score of `query` against `text`, higher is better, or -1 when some word of it doesn't match. */
export function fuzzyScore(query: string, text: string): number {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return 0;
  }
  const haystack = fold(text);
  let total = 0;
  for (const word of words) {
    const score = wordScore(word, haystack);
    if (score < 0) {
      return -1;
    }
    total += score;
  }
  // Shorter texts win a tie: "Done" over "Done, and archived".
  return total - haystack.length * 0.01;
}

function wordScore(word: string, text: string): number {
  const at = text.indexOf(word);
  if (at === 0) return 100 + word.length * 3;
  if (at > 0) return (isStart(text, at) ? 80 : 50) + word.length * 3 - Math.min(at, 20) * 0.5;
  // A subsequence: tried from each place the first letter is, keeping
  // the best, so `sd` in "set status: done" lands on "s…d" well.
  let best = -1;
  let tries = 0;
  for (let from = text.indexOf(word[0]!); from !== -1 && tries < 12; from = text.indexOf(word[0]!, from + 1), tries++) {
    const score = subsequence(word, text, from);
    if (score > best) best = score;
  }
  return best;
}

function subsequence(word: string, text: string, from: number): number {
  let score = 0;
  let previous = -2;
  let position = from;
  for (const char of word) {
    const found = text.indexOf(char, position);
    if (found === -1) return -1;
    if (found === previous + 1) score += 5;
    if (isStart(text, found)) score += 8;
    score += 1 - Math.min(found - position, 10) * 0.3;
    previous = found;
    position = found + 1;
  }
  return score - Math.min(from, 20) * 0.2;
}

function isStart(text: string, at: number): boolean {
  return at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1]!);
}

function fold(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
}
