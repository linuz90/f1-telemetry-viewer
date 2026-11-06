/**
 * Matching for the ⌘K palette. Every query word has to land on one of an
 * item's words; how well it lands sets the score: exact word, prefix,
 * substring, then one typo (two for long words). Accents and punctuation are
 * ignored, so "sao paulo", "São Paulo" and "interlag" find the same track.
 */

export function normalizeSearchText(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function searchWords(...texts: (string | null | undefined)[]): string[] {
  return normalizeSearchText(texts.filter(Boolean).join(" "))
    .split(/[^a-z0-9.:']+/)
    .filter(Boolean);
}

/** Edit distance, stopping early once it passes `max`. */
function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > max) return false;
    previous = current;
  }
  return previous[b.length] <= max;
}

function wordScore(token: string, word: string): number {
  if (word === token) return 4;
  if (word.startsWith(token)) return 3;
  if (token.length >= 3 && word.includes(token)) return 2;
  if (token.length >= 4) {
    const max = token.length >= 7 ? 2 : 1;
    // A typo in a word still being typed: compare with the word's start too.
    if (
      withinEdits(token, word, max) ||
      withinEdits(token, word.slice(0, token.length), max)
    ) {
      return 1;
    }
  }
  return 0;
}

/** Score of an item for a query, or 0 when any query word finds no match. */
export function scoreWords(
  words: readonly string[],
  tokens: readonly string[],
) {
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const word of words) best = Math.max(best, wordScore(token, word));
    if (best === 0) return 0;
    total += best;
  }
  return total;
}
