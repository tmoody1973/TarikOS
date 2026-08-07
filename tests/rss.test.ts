import { test } from "node:test";
import assert from "node:assert/strict";
import { itemsToResults } from "../src/lib/rss.ts";

const NOW = Date.parse("2026-08-07T12:00:00Z");

test("itemsToResults keeps recent items, newest first, capped shape", () => {
  const results = itemsToResults(
    [
      {
        title: "Old story",
        link: "https://x/old",
        isoDate: "2026-08-01T12:00:00Z",
      },
      {
        title: "Newer",
        link: "https://x/newer",
        isoDate: "2026-08-07T09:00:00Z",
        contentSnippet: "b",
      },
      {
        title: "Newest",
        link: "https://x/newest",
        isoDate: "2026-08-07T11:00:00Z",
        contentSnippet: "a",
      },
      { title: "No link", isoDate: "2026-08-07T11:30:00Z" },
    ],
    NOW,
  );
  assert.deepEqual(
    results.map((r) => r.title),
    ["Newest", "Newer"],
  );
  assert.equal(results[0].url, "https://x/newest");
});
