import { test } from "node:test";
import assert from "node:assert/strict";
import {
  briefKind,
  splitBriefs,
  groupBriefsByDay,
  chicagoDayKey,
  scoreBrief,
} from "../src/lib/briefArchive.ts";

// ---- briefKind: workflowName → archive identity ----

test("workflow names map to their archive kinds", () => {
  assert.equal(briefKind("morning-brief").key, "morning");
  assert.equal(briefKind("weekly-review").key, "review");
  assert.equal(briefKind("research-brief").key, "research");
  assert.equal(briefKind("browse").key, "browse");
  assert.equal(briefKind("memory-consolidation").key, "system");
});

test("unknown workflow names fall back to research, not crash", () => {
  assert.equal(briefKind("something-new").key, "research");
});

// ---- splitBriefs: editorial vs operational ----

const mk = (over: Record<string, unknown>) => ({
  _id: "x",
  _creationTime: 0,
  title: "t",
  workflowName: "morning-brief",
  status: "ready",
  headings: [],
  excerpt: "",
  ...over,
});

test("consolidation runs and errored runs are system, rest editorial", () => {
  const { editorial, system } = splitBriefs([
    mk({ _id: "a" }),
    mk({ _id: "b", workflowName: "memory-consolidation" }),
    mk({ _id: "c", workflowName: "browse", status: "error" }),
    mk({ _id: "d", workflowName: "browse" }),
  ]);
  assert.deepEqual(
    editorial.map((b) => b._id),
    ["a", "d"],
  );
  assert.deepEqual(
    system.map((b) => b._id),
    ["b", "c"],
  );
});

// ---- day grouping (Chicago days) ----

test("chicagoDayKey buckets a UTC timestamp into its Chicago date", () => {
  // 2026-08-08 03:00 UTC = 2026-08-07 22:00 Chicago (CDT)
  assert.equal(chicagoDayKey(Date.parse("2026-08-08T03:00:00Z")), "2026-08-07");
});

test("groupBriefsByDay labels today, yesterday, then dates, newest first", () => {
  const today = Date.parse("2026-08-08T15:00:00Z"); // 10:00 Chicago
  const yesterday = Date.parse("2026-08-07T15:00:00Z");
  const older = Date.parse("2026-08-05T15:00:00Z");
  const groups = groupBriefsByDay(
    [
      mk({ _id: "t1", _creationTime: today }),
      mk({ _id: "y1", _creationTime: yesterday }),
      mk({ _id: "o1", _creationTime: older }),
      mk({ _id: "t2", _creationTime: today - 1000 }),
    ],
    today,
  );
  assert.equal(groups[0].label, "TODAY");
  assert.deepEqual(
    groups[0].briefs.map((b) => b._id),
    ["t1", "t2"],
  );
  assert.equal(groups[1].label, "YESTERDAY");
  assert.match(groups[2].label, /AUG 5/);
});

// ---- scoring for search + find_brief ----

test("scoreBrief ranks title and heading hits above excerpt hits", () => {
  const inTitle = mk({ title: "Voyager probe coverage" });
  const inHeading = mk({ headings: ["VOYAGER UPDATE"] });
  const inExcerpt = mk({ excerpt: "the voyager probe keeps going" });
  const none = mk({});
  const q = "voyager probe";
  assert.ok(scoreBrief(inTitle, q) > scoreBrief(inHeading, q));
  assert.ok(scoreBrief(inHeading, q) > scoreBrief(inExcerpt, q));
  assert.ok(scoreBrief(inExcerpt, q) > 0);
  assert.equal(scoreBrief(none, q), 0);
});
