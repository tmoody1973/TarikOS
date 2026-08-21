/**
 * Time buckets for the trust stream.
 *
 * The brain page is not an archive and must not become one — people do not
 * browse their notes, they search when they have a question, and voice already
 * does the searching. What the screen is for is checking her work: what did she
 * learn, where did she get it, and is any of it wrong.
 *
 * That makes recency the spine. Something written last night is the thing most
 * likely to be wrong and least likely to have been checked. Everything past a
 * month is a tail, and gets one honest heading rather than a calendar.
 */

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export const BUCKETS = [
  "Today",
  "Yesterday",
  "Earlier this week",
  "Earlier this month",
  "Older",
] as const;

export type Bucket = (typeof BUCKETS)[number];

export function bucketOf(at: number, now: number): Bucket {
  const age = now - at;
  if (age < DAY) return "Today";
  if (age < 2 * DAY) return "Yesterday";
  if (age < 7 * DAY) return "Earlier this week";
  if (age < 31 * DAY) return "Earlier this month";
  return "Older";
}

/**
 * Newest first, empty buckets omitted.
 *
 * A heading over nothing reads as "you have nothing here", which is a different
 * and worse claim than simply not showing the heading.
 */
export function groupByBucket<T extends { at: number }>(
  items: readonly T[],
  now: number,
): { bucket: Bucket; items: T[] }[] {
  const sorted = [...items].sort((a, b) => b.at - a.at);
  return BUCKETS.map((bucket) => ({
    bucket,
    items: sorted.filter((i) => bucketOf(i.at, now) === bucket),
  })).filter((g) => g.items.length > 0);
}

/** Short enough to sit on the same line as the kind chip. */
export function ago(at: number, now: number): string {
  const d = Math.max(0, now - at);
  if (d < MIN) return "just now";
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  if (d < 31 * DAY) return `${Math.floor(d / DAY)}d ago`;
  if (d < 365 * DAY) return `${Math.floor(d / (30 * DAY))}mo ago`;
  return `${Math.floor(d / (365 * DAY))}y ago`;
}
