import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildHabitReview,
  canSuggest,
  cycleEndsAt,
  isCycleActive,
  summarizeTrajectory,
  VOTE_LEVELS,
} from "../convex/habitsLib.ts";

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-08-01T05:00:00Z");

test("only a calendar_suggest habit may receive a suggestion", () => {
  assert.equal(
    canSuggest({ evidenceMode: "calendar_suggest", status: "active" }),
    true,
  );
  assert.equal(
    canSuggest({ evidenceMode: "self_report", status: "active" }),
    false,
  );
});

test("a paused or retired habit never receives a suggestion", () => {
  for (const status of ["paused", "retired"] as const) {
    assert.equal(
      canSuggest({ evidenceMode: "calendar_suggest", status }),
      false,
      `${status} must not be suggestible`,
    );
  }
});

test("a cycle defaults to six weeks and accepts a longer one", () => {
  assert.equal(cycleEndsAt(START), START + 42 * DAY);
  assert.equal(cycleEndsAt(START, 8), START + 56 * DAY);
});

test("a cycle is active between its start and end", () => {
  const cycle = { startsAt: START, endsAt: cycleEndsAt(START) };
  assert.equal(isCycleActive(cycle, START + DAY), true);
  assert.equal(isCycleActive(cycle, START - DAY), false);
  assert.equal(isCycleActive(cycle, START + 60 * DAY), false);
});

test("trajectory counts each level and ignores unlogged days", () => {
  const t = summarizeTrajectory([
    { date: "2026-08-01", level: "standard" },
    { date: "2026-08-02", level: "minimum" },
    { date: "2026-08-03", level: null },
    { date: "2026-08-04", level: "beyond" },
  ]);
  assert.equal(t.logged, 3);
  assert.equal(t.byLevel.standard, 1);
  assert.equal(t.byLevel.minimum, 1);
  assert.equal(t.byLevel.beyond, 1);
  assert.equal(t.byLevel.missed, 0);
});

test("an intentional skip is not a gap", () => {
  // The spec is explicit: a conscious skip carries no penalty.
  const t = summarizeTrajectory([
    { date: "2026-08-01", level: "standard" },
    { date: "2026-08-02", level: "skipped" },
    { date: "2026-08-03", level: "standard" },
  ]);
  assert.equal(t.longestGap, 0);
  assert.equal(t.returns, 0);
});

test("returning after a gap is counted — the metric on display", () => {
  const t = summarizeTrajectory([
    { date: "2026-08-01", level: "standard" },
    { date: "2026-08-02", level: null },
    { date: "2026-08-03", level: "missed" },
    { date: "2026-08-04", level: "minimum" },
    { date: "2026-08-05", level: null },
    { date: "2026-08-06", level: "standard" },
  ]);
  assert.equal(t.longestGap, 2);
  assert.equal(t.returns, 2);
});

test("a trailing gap is not a return until practice resumes", () => {
  const t = summarizeTrajectory([
    { date: "2026-08-01", level: "standard" },
    { date: "2026-08-02", level: null },
  ]);
  assert.equal(t.returns, 0);
  assert.equal(t.longestGap, 1);
});

test("an empty range summarizes to zeroes rather than throwing", () => {
  const t = summarizeTrajectory([]);
  assert.equal(t.logged, 0);
  assert.equal(t.returns, 0);
  assert.equal(t.longestGap, 0);
});

test("every vote level has a counter", () => {
  const t = summarizeTrajectory([]);
  for (const level of VOTE_LEVELS) {
    assert.equal(t.byLevel[level], 0, `${level} must be counted`);
  }
});

test("the review names the most frictional habit and asks for one change", () => {
  const body = buildHabitReview(
    [
      {
        pillar: "Work / Craft",
        days: [
          { date: "2026-08-01", level: "standard" },
          { date: "2026-08-02", level: null },
          { date: "2026-08-03", level: "minimum" },
        ],
        friction: ["back-to-back meetings"],
      },
      {
        pillar: "Health",
        days: [{ date: "2026-08-01", level: "missed" }],
        friction: [],
      },
    ],
  );
  assert.match(body, /Work \/ Craft/);
  assert.match(body, /back-to-back meetings/);
  assert.match(body, /one variable/i);
  // The review must never present a streak.
  assert.ok(!/streak/i.test(body));
});

test("an empty week still produces a usable review", () => {
  const body = buildHabitReview([]);
  assert.match(body, /no active habits/i);
});
