import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The module's central promise is that inferred evidence can never mark a
// habit done. These scan the source the way the mail no-send and browser
// no-credentials tripwires do.

const habits = readFileSync(
  new URL("../convex/habits.ts", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../convex/schema.ts", import.meta.url),
  "utf8",
);

test("the suggestion path never inserts a vote", () => {
  const fn = habits.slice(
    habits.indexOf("export const suggestFromEvidence"),
    habits.indexOf("export const resolveSuggestion"),
  );
  assert.ok(fn.length > 0, "suggestFromEvidence must exist");
  assert.ok(
    !/insert\(\s*"habitVotes"/.test(fn),
    "suggestFromEvidence must not write a vote",
  );
  assert.match(fn, /insert\(\s*"habitSuggestions"/);
});

test("suggestions are gated by canSuggest, not by the caller", () => {
  assert.match(habits, /canSuggest\(/);
});

test("evidenceMode defaults to self_report in the schema", () => {
  assert.match(schema, /evidenceMode:\s*v\.optional\(/);
  assert.match(habits, /evidenceMode\s*\?\?\s*"self_report"/);
});

test("no streak counter exists anywhere in the module", () => {
  for (const src of [habits, schema]) {
    assert.ok(!/streak/i.test(src), "the design has no streak concept");
  }
});

test("votes are unique per habit per day — lookup before insert", () => {
  const fn = habits.slice(
    habits.indexOf("export const logVote"),
    habits.indexOf("export const upsertHabit"),
  );
  assert.match(fn, /by_habit_date/);
  assert.match(fn, /ctx\.db\.patch\(/);
});
