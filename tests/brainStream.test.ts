import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketOf, groupByBucket, ago } from "../src/lib/brainStream.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 21, 15, 0, 0); // Fri 21 Aug 2026, 10am Chicago

// The stream exists to answer one question: what does she think she knows about
// me, and is any of it wrong. That makes RECENCY the spine — a thing she learned
// last night is the thing most likely to be wrong and least likely to have been
// checked. Everything older is a long tail nobody reads.

test("something from an hour ago is today", () => {
  assert.equal(bucketOf(NOW - 3600_000, NOW), "Today");
});

test("something from yesterday is not lumped into today", () => {
  // The whole point of the buckets is that "1d ago" and "2h ago" are different
  // kinds of trust. A single "recent" bucket loses that.
  assert.equal(bucketOf(NOW - DAY - 3600_000, NOW), "Yesterday");
});

test("a few days back is this week", () => {
  assert.equal(bucketOf(NOW - 4 * DAY, NOW), "Earlier this week");
});

test("anything past a month is just older", () => {
  // No month-by-month archive. Past a certain age the honest label is "old",
  // and pretending otherwise builds a browsing UI nobody uses.
  assert.equal(bucketOf(NOW - 200 * DAY, NOW), "Older");
});

test("groups keep newest first, and empty buckets do not appear", () => {
  const items = [
    { id: "old", at: NOW - 90 * DAY },
    { id: "now", at: NOW - 1000 },
    { id: "now2", at: NOW - 2000 },
  ];
  const groups = groupByBucket(items, NOW);
  assert.deepEqual(
    groups.map((g) => g.bucket),
    ["Today", "Older"],
    "an empty bucket rendered as a heading is a lie about having nothing",
  );
  assert.deepEqual(groups[0].items.map((i) => i.id), ["now", "now2"]);
});

test("relative time is short enough to sit on one line", () => {
  assert.equal(ago(NOW - 1000, NOW), "just now");
  assert.equal(ago(NOW - 3 * 3600_000, NOW), "3h ago");
  assert.equal(ago(NOW - 3 * DAY, NOW), "3d ago");
  assert.equal(ago(NOW - 40 * DAY, NOW), "1mo ago");
});
