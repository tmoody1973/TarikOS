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
  const fn = habits.slice(
    habits.indexOf("export const suggestFromEvidence"),
    habits.indexOf("export const resolveSuggestion"),
  );
  assert.ok(fn.length > 0, "suggestFromEvidence must exist");
  assert.match(
    fn,
    /if\s*\(\s*!canSuggest/,
    "suggestFromEvidence must guard with !canSuggest",
  );
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

test("every habit tool exists in both the route and the provisioning script", () => {
  const route = readFileSync(
    new URL("../src/app/api/tools/[tool]/route.ts", import.meta.url),
    "utf8",
  );
  const provision = readFileSync(
    new URL("../scripts/provision-agent.ts", import.meta.url),
    "utf8",
  );
  for (const tool of [
    "get_habits",
    "log_habit_vote",
    "add_habit",
    "update_habit",
    "log_friction",
  ]) {
    assert.match(route, new RegExp(`case "${tool}"`), `route missing ${tool}`);
    assert.match(
      provision,
      new RegExp(`name: "${tool}"`),
      `provisioning missing ${tool}`,
    );
  }
});

test("the evening check-in cannot nag — it composes a card and stops", () => {
  const cron = readFileSync(
    new URL("../convex/habitsCron.ts", import.meta.url),
    "utf8",
  );
  // No push channel exists yet (MOO-497); the check-in must wait like the
  // morning brief rather than reaching out.
  assert.ok(!/sms|twilio|telnyx|notify/i.test(cron));
  assert.match(cron, /insert\("briefingCards"/);
});
