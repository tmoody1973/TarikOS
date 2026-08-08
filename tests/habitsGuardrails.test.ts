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

test("the evening check-in cannot nag — it has no way to reach outside Convex", () => {
  const cron = readFileSync(
    new URL("../convex/habitsCron.ts", import.meta.url),
    "utf8",
  );
  // internalMutation can't fetch(). The only way to eventually push is to
  // schedule or call another function — ban those call shapes, not words,
  // so a comment describing the design doesn't trip the guard.
  assert.ok(!/ctx\.scheduler|ctx\.runAction|ctx\.runMutation|fetch\(/.test(cron));
  assert.match(cron, /internalMutation/);
  assert.match(cron, /insert\("briefingCards"/);
});

test("only a signed-in human can turn a suggestion into a vote", () => {
  const fn = habits.slice(habits.indexOf("export const resolveSuggestion"));
  assert.match(fn, /await requireUser\(ctx\)/);
  // A tool-secret branch here would let inferred evidence vote without a human.
  assert.ok(!/checkToolSecret/.test(fn), "resolveSuggestion must stay human-only");
  assert.ok(!/secret/.test(fn), "resolveSuggestion must not accept a secret");
});

test("the agent instruction carries the habit tone and escalation rules", () => {
  const provision = readFileSync(
    new URL("../scripts/provision-agent.ts", import.meta.url),
    "utf8",
  );
  // Same shape as the browse GUARDRAILS test: the rule must be in the
  // instruction, not just in a design document nobody ships.
  assert.match(provision, /HABIT_GUARDRAILS/);
  assert.match(provision, /never shame/i);
  assert.match(provision, /human support/i);
  // Mutation guard: the constant must actually be wired into the prompt, not just declared.
  // If someone reverts the concatenation, this fails and catches the silent breakage.
  assert.match(provision, /prompt:\s*PERSONA\s*\+\s*HABIT_GUARDRAILS/);
});
