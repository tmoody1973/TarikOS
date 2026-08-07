import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanText,
  expandSteps,
  formatSection,
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
