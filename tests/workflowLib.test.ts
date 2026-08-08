import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanText,
  daysEndingOn,
  expandSteps,
  formatSection,
  safeSlice,
  workflowTitle,
} from "../convex/workflowLib.ts";

const vars = {
  today: "2026-08-07",
  topics: ["Milwaukee news", "AI in radio"],
};

test("expandSteps preserves step order and resolves {{today}}", () => {
  const out = expandSteps(
    [
      { tool: "get_calendar", args: { date: "{{today}}" } },
      { tool: "get_emails", args: {} },
    ],
    vars,
  );
  assert.deepEqual(
    out.map((s) => s.tool),
    ["get_calendar", "get_emails"],
  );
  assert.equal(out[0].args.date, "2026-08-07");
  assert.equal(out[0].label, "Calendar");
  assert.equal(out[1].label, "Inbox");
});

test("a {{topics}} step fans out into one call per topic, in order", () => {
  const out = expandSteps(
    [
      { tool: "get_calendar", args: {} },
      { tool: "web_research", args: { query: "{{topics}}" } },
    ],
    vars,
  );
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.slice(1).map((s) => s.args.query),
    ["Milwaukee news", "AI in radio"],
  );
  assert.deepEqual(
    out.slice(1).map((s) => s.label),
    ["Milwaukee news", "AI in radio"],
  );
});

test("a {{feedGroups}} step fans out per feed group with joined urls", () => {
  const out = expandSteps(
    [{ tool: "get_rss", args: { feeds: "{{feedGroups}}" } }],
    {
      ...vars,
      feedGroups: [
        { label: "Tech headlines", feeds: ["https://a/feed", "https://b/feed"] },
        { label: "Milwaukee news", feeds: ["https://c/feed"] },
      ],
    },
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    tool: "get_rss",
    args: { label: "Tech headlines", feeds: "https://a/feed https://b/feed" },
    label: "Tech headlines",
  });
  assert.equal(out[1].label, "Milwaukee news");
});

test("{{topic}} resolves from run params (on-demand brief shape)", () => {
  const out = expandSteps(
    [{ tool: "web_research", args: { query: "latest on {{topic}}" } }],
    { ...vars, topic: "Bandcamp" },
  );
  assert.equal(out[0].args.query, "latest on Bandcamp");
});

test("brief email rows link the subject to the thread when threadId exists", () => {
  const { section } = formatSection(
    { tool: "get_emails", args: {}, label: "Inbox" },
    {
      ok: true,
      message: "2 recent email(s).",
      data: {
        emails: [
          {
            subject: "Studio schedule",
            from: "Sarah",
            account: "work-gmail",
            snippet: "quick question",
            threadId: "19fabc",
          },
          { subject: "No thread", from: "X", snippet: "plain" },
        ],
      },
    },
  );
  assert.ok(
    section.body.includes(
      "[Studio schedule](https://tarikos.internal/mail?thread=19fabc&account=work-gmail)",
    ),
  );
  // Rows without a threadId stay bold, never a dead link.
  assert.ok(section.body.includes("**No thread**"));
});

test("failed tool result becomes an error section, run continues", () => {
  const { section, isError } = formatSection(
    { tool: "get_emails", args: {}, label: "Inbox" },
    { ok: false, message: "Email fetch failed: auth expired" },
  );
  assert.equal(isError, true);
  assert.ok(section.body.startsWith("⚠️"));
  assert.ok(section.body.includes("Email fetch failed"));
});

test("research headlines are inline links; unlinked fall back to bold", () => {
  const { section, isError } = formatSection(
    { tool: "web_research", args: { query: "x" }, label: "Milwaukee news" },
    {
      ok: true,
      message: "2 sources found",
      data: {
        results: [
          { title: "Story A", snippet: "Something happened", url: "https://a.example" },
          { title: "Story B", snippet: "More happened" },
        ],
      },
    },
  );
  assert.equal(isError, false);
  assert.equal(section.heading, "Milwaukee news");
  assert.ok(section.body.includes("- [Story A](https://a.example/) — Something happened"));
  assert.ok(section.body.includes("- **Story B** — More happened"));
  assert.deepEqual(section.sources, [
    { title: "Story A", url: "https://a.example/" },
  ]);
});

test("relative/garbage result urls never become links or sources", () => {
  const { section } = formatSection(
    { tool: "web_research", args: { query: "x" }, label: "Funding" },
    {
      ok: true,
      message: "2 sources found",
      data: {
        results: [
          { title: "Aggregator Story", snippet: "s", url: "/goto?url=CAESVgHuR6" },
          { title: "Real Story", snippet: "s", url: "https://real.example/a" },
        ],
      },
    },
  );
  assert.ok(section.body.includes("- **Aggregator Story** — s"));
  assert.ok(!section.body.includes("/goto"));
  assert.deepEqual(section.sources, [
    { title: "Real Story", url: "https://real.example/a" },
  ]);
});

test("safeSlice never leaves a lone surrogate when cutting an emoji", () => {
  const s = "weekend? 🍕 pizza";
  const cut = safeSlice(s, 10); // 10 lands mid-🍕 surrogate pair
  assert.equal(cut, "weekend? ");
  assert.ok(!/[\uD800-\uDBFF]$/.test(cut));
  assert.equal(safeSlice("plain text", 5), "plain");
});

test("cleanText strips markdown artifacts and hard newlines from snippets", () => {
  assert.equal(
    cleanText("News\n\n# Bandcamp Announces Ban\n**bold** and [a link](https://x.example) here"),
    "News Bandcamp Announces Ban bold and a link here",
  );
});

test("calendar result lists events with Chicago times", () => {
  const { section } = formatSection(
    { tool: "get_calendar", args: {}, label: "Calendar" },
    {
      ok: true,
      message: "1 event(s)",
      data: {
        events: [
          {
            title: "Standup",
            start: "2026-08-07T14:00:00Z",
            allDay: false,
            account: "work",
          },
        ],
      },
    },
  );
  assert.ok(section.body.includes("Standup"));
  assert.ok(section.body.includes("9:00 AM")); // 14:00 UTC = 9:00 CDT
});

test("workflowTitle humanizes the workflow name", () => {
  assert.equal(
    workflowTitle("morning-brief", "2026-08-07"),
    "Morning Brief — 2026-08-07",
  );
});

/* MOO-518. The strip used to step back in 24h chunks from `now` and format each
 * result in Chicago. Chicago's offset moves twice a year, so a fixed 24h step
 * shifts local wall-clock by 23h or 25h across a transition: spring drops a day
 * (2026-03-08 vanished between 03-07 and 03-09) and fall repeats one. Both were
 * reproduced against the shipped code before this was written. */

test("a day window is contiguous, ascending and the right length", () => {
  const dates = daysEndingOn("2026-08-08", 30);
  assert.equal(dates.length, 30);
  assert.equal(dates[29], "2026-08-08", "the window ends on the given day");
  assert.equal(dates[0], "2026-07-10", "and starts 29 days earlier");
  assert.equal(new Set(dates).size, 30, "no repeats");
  for (let i = 1; i < dates.length; i++) {
    assert.ok(dates[i] > dates[i - 1], "strictly ascending");
  }
});

test("spring forward does not drop a day from the window", () => {
  const dates = daysEndingOn("2026-03-09", 5);
  assert.deepEqual(dates, [
    "2026-03-05",
    "2026-03-06",
    "2026-03-07",
    "2026-03-08", // the day the 24h-stepping version skipped
    "2026-03-09",
  ]);
});

test("fall back does not repeat a day in the window", () => {
  const dates = daysEndingOn("2026-11-02", 5);
  assert.deepEqual(dates, [
    "2026-10-29",
    "2026-10-30",
    "2026-10-31",
    "2026-11-01", // the day the 24h-stepping version emitted twice
    "2026-11-02",
  ]);
  assert.equal(new Set(dates).size, 5);
});

test("a day window crosses month and year boundaries", () => {
  assert.deepEqual(daysEndingOn("2026-03-02", 3), [
    "2026-02-28",
    "2026-03-01",
    "2026-03-02",
  ]);
  assert.deepEqual(daysEndingOn("2027-01-01", 2), ["2026-12-31", "2027-01-01"]);
  assert.deepEqual(daysEndingOn("2028-03-01", 2), ["2028-02-29", "2028-03-01"]);
});

test("a single-day window is just that day", () => {
  assert.deepEqual(daysEndingOn("2026-08-08", 1), ["2026-08-08"]);
});
