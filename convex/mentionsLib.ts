// Connecting a record to a goal without guessing.
//
// Exactly one real column links anything to a telos item: habits.telosItemId.
// Everything else on the Focus page — the decisions, open loops and documents
// that bear on a goal — has to come from somewhere, and ticket 02 forbids
// inference in v1 because inference is the only thing that manufactures a
// review queue.
//
// A word overlap is not an inference. "This decision literally contains the
// distinctive words of that goal" is a fact about two strings. It can be shown
// as a fact, it is labelled a mention rather than a relationship, and there is
// nothing to approve, dismiss or tidy.
//
// Pure — no Convex imports — so the tests can run it directly.

/** Words too common to distinguish anything. Small on purpose: a long list is a taste. */
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "at", "by",
  "with", "from", "into", "as", "is", "are", "was", "were", "be", "been",
  "it", "its", "this", "that", "these", "those", "my", "his", "her", "their",
  "i", "he", "she", "they", "we", "you", "not", "no", "but", "if", "so",
  "up", "out", "off", "over", "then", "than", "do", "does", "did", "get",
]);

/** Two letters is an initialism worth keeping; one is noise. */
const MIN_LEN = 2;

/** How many of a goal's key words a record must carry before it counts. */
const MIN_HITS = 2;

export function keyWords(text: string): string[] {
  const seen = new Set<string>();
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= MIN_LEN && !STOP.has(w))
    .filter((w) => (seen.has(w) ? false : (seen.add(w), true)));
}

/**
 * Does `text` mention `goal`?
 *
 * Two distinctive words, not one. One shared word means a goal about "work"
 * swallows every row in the store, which is the failure that makes a related
 * section worthless — and worse than empty, because it looks researched.
 */
export function mentions(text: string, goal: string): boolean {
  const keys = keyWords(goal);
  if (keys.length === 0) return false;
  const words = new Set(keyWords(text));
  let hits = 0;
  for (const k of keys) {
    if (words.has(k) && ++hits >= Math.min(MIN_HITS, keys.length)) return true;
  }
  return false;
}
