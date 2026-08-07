import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTelosFile,
  compileTelosSummary,
  buildGoalsSection,
  buildJournalDigest,
  isStale,
  DEFAULT_CADENCE_DAYS,
} from "../convex/telosLib.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-07T12:00:00Z");

function summaryItem(
  overrides: Partial<{
    kind: "mission" | "goal" | "problem" | "challenge" | "strategy" | "dimension";
    text: string;
    measurable: string | undefined;
    status: "active" | "deferred" | "done" | "dropped";
    reviewedAt: number;
    reviewCadenceDays: number;
  }> = {},
) {
  return {
    kind: "goal" as const,
    text: "Ship the thing",
    measurable: undefined,
    status: "active" as const,
    reviewedAt: NOW,
    reviewCadenceDays: 30,
    ...overrides,
  };
}

// ---- GOALS.md ----

test("GOALS: unchecked bullet becomes an active goal with measurable tail", () => {
  const { items } = parseTelosFile(
    "GOALS",
    "# GOALS\n\n## This Quarter (90 days)\n\n- [ ] Launch HYFIN podcast network — 3 shows live by Oct 1\n",
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "goal");
  assert.equal(items[0].status, "active");
  assert.equal(items[0].text, "Launch HYFIN podcast network");
  assert.equal(items[0].measurable, "3 shows live by Oct 1");
});

test("GOALS: checked bullet becomes a done goal", () => {
  const { items } = parseTelosFile(
    "GOALS",
    "## Completed This Year\n\n- [x] Migrated site — done 2026-Q1\n",
  );
  assert.equal(items[0].status, "done");
});

test("GOALS: paused section bullets become deferred", () => {
  const { items } = parseTelosFile(
    "GOALS",
    "## Paused / Deferred\n\n- Open-source the tooling — revisit Q4\n",
  );
  assert.equal(items[0].status, "deferred");
});

test("GOALS: placeholder template lines are skipped and reported", () => {
  const { items, skipped } = parseTelosFile(
    "GOALS",
    "## This Year\n\n- [ ] _Goal — target date_\n",
  );
  assert.equal(items.length, 0);
  assert.equal(skipped.length, 1);
});

// ---- MISSION.md ----

test("MISSION: current mission paragraph parses; placeholders skipped", () => {
  const { items } = parseTelosFile(
    "MISSION",
    "# MISSION\n\n## Current Mission\n\nAmplify Black culture through radio and technology.\n\n## Supporting Themes\n\n- Build tools that outlive me\n- _Theme 2 —_\n",
  );
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.kind === "mission"));
  assert.equal(items[0].text, "Amplify Black culture through radio and technology.");
  assert.equal(items[1].text, "Build tools that outlive me");
});

// ---- PROBLEMS.md / CHALLENGES.md ----

test("PROBLEMS: titled block with statement becomes one problem", () => {
  const { items } = parseTelosFile(
    "PROBLEMS",
    "## Active Problems\n\n### Radio discovery is broken\n\n- **Statement:** Younger listeners never find public radio\n- **Next action:** Ship HYFIN discovery feed\n",
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "problem");
  assert.equal(
    items[0].text,
    "Radio discovery is broken: Younger listeners never find public radio",
  );
});

test("CHALLENGES: titled block becomes a challenge; placeholder titles skipped", () => {
  const { items } = parseTelosFile(
    "CHALLENGES",
    "## Current Challenges\n\n### _Challenge Title_\n\n### Too many projects\n\n- **Nature:** Focus splits across shows and code\n",
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "challenge");
  assert.ok(items[0].text.startsWith("Too many projects"));
});

// ---- STRATEGIES.md ----

test("STRATEGIES: active table rows parse; header and placeholder rows do not", () => {
  const { items } = parseTelosFile(
    "STRATEGIES",
    "## Active Strategies\n\n| Domain | Strategy | Goal It Serves | Status | Review Date |\n|--------|----------|----------------|--------|-------------|\n| _Career_ | _Approach_ | _Goal_ | _Active_ | _YYYY-MM_ |\n| Radio | Weekly AI segment | Grow HYFIN audience | Active | 2026-10 |\n",
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "strategy");
  assert.equal(items[0].text, "Weekly AI segment (Radio)");
  assert.equal(items[0].status, "active");
});

test("empty PAI scaffold yields zero items", () => {
  const { items } = parseTelosFile(
    "GOALS",
    "# GOALS\n\n## This Quarter (90 days)\n\n- [ ] _Specific, measurable goal — deadline_\n\n## This Year\n\n- [ ] _Goal — target date_\n",
  );
  assert.equal(items.length, 0);
});

// ---- Summary compiler ----

test("compileTelosSummary includes only active items", () => {
  const out = compileTelosSummary(
    [
      summaryItem({ kind: "mission", text: "The mission" }),
      summaryItem({ text: "Active goal", measurable: "by Q4" }),
      summaryItem({ text: "Done goal", status: "done" }),
      summaryItem({ kind: "problem", text: "A problem", status: "dropped" }),
    ],
    NOW,
  );
  assert.ok(out.includes("The mission"));
  assert.ok(out.includes("Active goal"));
  assert.ok(out.includes("by Q4"));
  assert.ok(!out.includes("Done goal"));
  assert.ok(!out.includes("A problem"));
});

test("compileTelosSummary flags items past review cadence", () => {
  const out = compileTelosSummary(
    [summaryItem({ text: "Old goal", reviewedAt: NOW - 31 * DAY })],
    NOW,
  );
  assert.ok(/Old goal.*stale/i.test(out));
});

test("compileTelosSummary returns empty string with no items", () => {
  assert.equal(compileTelosSummary([], NOW), "");
});

// ---- Staleness ----

test("isStale is false within cadence and true past it", () => {
  assert.equal(
    isStale({ reviewedAt: NOW - 29 * DAY, reviewCadenceDays: 30 }, NOW),
    false,
  );
  assert.equal(
    isStale({ reviewedAt: NOW - 31 * DAY, reviewCadenceDays: 30 }, NOW),
    true,
  );
});

test("default cadences: goal 30, problem 90, mission 365", () => {
  assert.equal(DEFAULT_CADENCE_DAYS.goal, 30);
  assert.equal(DEFAULT_CADENCE_DAYS.problem, 90);
  assert.equal(DEFAULT_CADENCE_DAYS.mission, 365);
});

// ---- MOO-490: buildGoalsSection ----

const WEEK = 7 * DAY;

function goal(text: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: "goal" as const,
    text,
    measurable: undefined as string | undefined,
    status: "active" as const,
    reviewedAt: NOW,
    reviewCadenceDays: 30,
    updatedAt: undefined as number | undefined,
    createdAt: NOW - 60 * DAY,
    ...overrides,
  };
}

test("buildGoalsSection lists active goals with measurables", () => {
  const body = buildGoalsSection(
    [goal("Ship the thing", { measurable: "by Q4" }), goal("Done goal", { status: "done" })],
    NOW,
  );
  assert.ok(body.includes("Ship the thing"));
  assert.ok(body.includes("by Q4"));
  assert.ok(!body.includes("Done goal"));
});

test("buildGoalsSection drift line separates moved from untouched", () => {
  const body = buildGoalsSection(
    [
      goal("Moved goal", { updatedAt: NOW - 2 * DAY }),
      goal("Fresh new goal", { createdAt: NOW - 1 * DAY }),
      goal("Untouched goal"),
    ],
    NOW,
  );
  assert.ok(/moved this week.*Moved goal/i.test(body) || /Moved goal.*moved/i.test(body));
  assert.ok(/untouched.*Untouched goal/i.test(body) || /Untouched goal.*untouched/i.test(body));
  assert.ok(!new RegExp(`untouched[^\\n]*Fresh new goal`, "i").test(body));
});

test("buildGoalsSection nudges review when items are stale", () => {
  const body = buildGoalsSection(
    [goal("Old goal", { reviewedAt: NOW - 40 * DAY })],
    NOW,
  );
  assert.ok(/review/i.test(body));
});

test("buildGoalsSection with empty telos prompts setup", () => {
  const body = buildGoalsSection([], NOW);
  assert.ok(/telos|interview|set up/i.test(body));
});

test("buildJournalDigest formats entries with day and reflection marker", () => {
  const body = buildJournalDigest([
    { text: "Shipped the thing", mode: "capture", at: NOW },
    { text: "Tomorrow: rest", mode: "reflection", at: NOW - DAY },
  ]);
  assert.ok(/- \*\*\w{3}\*\* — Shipped the thing/.test(body));
  assert.ok(body.includes("(reflection)"));
});

test("buildJournalDigest with no entries says so", () => {
  assert.equal(buildJournalDigest([]), "No journal entries this week.");
});
