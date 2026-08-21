/**
 * A cheap suspicion pass over an answer, run before Zola speaks it.
 *
 * The premise, from ticket 11: most wrong answers are strangely SHAPED first
 * and explicably wrong second. The reply_zero bug was visibly odd — eighteen
 * results where three to five is normal, the same sender six times — before
 * anyone understood why. That is arithmetic, not intelligence, so it costs
 * nothing to run every time.
 *
 * Explicitly NOT a model call. Asking a model "does this look right" adds a hop
 * to a voice path that was optimised the night before, spends tokens against a
 * quota already hit once, and models are poor judges of their own output.
 *
 * This is the generic half. It names a doubt; it never invents a fix. Where a
 * tool knows its own fix ("set aside 73 as bulk"), the tool applies it and says
 * so — that part cannot be written once, because knowing the fix is knowing the
 * domain.
 */

/** One source owning more than this share of an answer is the tell. */
const CONCENTRATION = 0.5;

/** Below this many results, one repeated source is coincidence, not a pattern. */
const MIN_FOR_CONCENTRATION = 4;

export function shapeNote<T>(
  items: readonly T[],
  opts: { normal: [number, number]; sourceOf?: (item: T) => string },
): string | null {
  const [lo, hi] = opts.normal;
  const n = items.length;

  // Count first: it is the loudest tell and the one that caught the real bug.
  if (n > hi) return `${n} — more than usual`;
  if (n < lo) return n === 0 ? "none — fewer than usual" : `${n} — fewer than usual`;

  if (opts.sourceOf && n >= MIN_FOR_CONCENTRATION) {
    const counts = new Map<string, number>();
    for (const item of items) {
      const k = opts.sourceOf(item);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let top = 0;
    for (const c of counts.values()) if (c > top) top = c;
    if (top / n > CONCENTRATION) return `${top} of ${n} from the same sender`;
  }

  return null;
}
