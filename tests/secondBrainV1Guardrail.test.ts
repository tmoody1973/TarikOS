import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Second brain v1: two new stores, and a set of rules that are easy to break by
// accident. Every rule below was a decision, recorded in
// docs/decisions/2026-08-21-second-brain-that-survives.md. Breaking one quietly
// reintroduces the maintenance tax the whole design exists to avoid.
//
// Comments are stripped before every scan, so a rule cannot be satisfied by
// writing it in a comment.

const CODE = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const SCHEMA = CODE("convex/schema.ts");
const BRAIN = CODE("convex/secondBrain.ts");
const ROUTE = CODE("src/app/api/tools/[tool]/route.ts");
const PROVISION = CODE("scripts/provision-agent.ts");

const table = (name: string) =>
  SCHEMA.split(`${name}: defineTable({`)[1]?.split("\n  }")[0] ?? "";

const routeCase = (name: string) =>
  ROUTE.split(`case "${name}":`)[1]?.split("\n    case ")[0] ?? "";

// ------------------------------------------------------- the two new stores

test("decisions stores the choice, the reasoning, and when", () => {
  const t = table("decisions");
  assert.ok(t, "decisions table is missing from the schema");
  assert.match(t, /what: v\.string\(\)/);
  assert.match(t, /why: v\.string\(\)/);
  assert.match(t, /decidedAt: v\.number\(\)/);
});

test("a decision can point at the decision it replaced", () => {
  // Supersession is the whole reason this store exists rather than a memory:
  // the question is never "what do I think" but "what did I decide, and did
  // something later overrule it".
  assert.match(table("decisions"), /supersedes: v\.optional\(v\.id\("decisions"\)\)/);
});

test("an open loop needs nothing but the sentence", () => {
  // The hole between reminders (needs a date) and reply_zero (only sees mail).
  // A person and a due date are OPTIONAL — prompting for either is the
  // regression this test exists to catch.
  const t = table("openLoops");
  assert.ok(t, "openLoops table is missing from the schema");
  assert.match(t, /text: v\.string\(\)/);
  assert.match(t, /person: v\.optional\(/);
  assert.match(t, /dueAt: v\.optional\(v\.number\(\)\)/);
});

test("both new stores keep the conversation they came from", () => {
  // Provenance governs speech: she may state a derived fact as fact. Without
  // the transcript link there is no derivation to point at.
  assert.match(table("decisions"), /transcriptId: v\.optional\(v\.id\("transcripts"\)\)/);
  assert.match(table("openLoops"), /transcriptId: v\.optional\(v\.id\("transcripts"\)\)/);
});

// ------------------------------------------------------------ capture asks nothing

test("neither new tool asks Tarik a question back", () => {
  // remember and capture_thought have never interrogated him, and these two
  // may not start. The failure shape is a route that returns ok:false with a
  // question in it for a field that was simply not supplied.
  for (const name of ["record_decision", "open_loop"]) {
    const c = routeCase(name);
    assert.ok(c, `route case ${name} is missing`);
    assert.doesNotMatch(
      c,
      /Who |When |Which |What date|by when/i,
      `${name} asks for something the conversation already contains`,
    );
  }
});

test("a decision is read back so he can say yes", () => {
  // Reading the rationale back is a confirmation, not a question — the one
  // permitted round trip in the capture path.
  const c = routeCase("record_decision");
  assert.match(c, /why/, "the spoken message does not include the rationale");
});

// --------------------------------------------------------------- the agent knows

test("the three new verbs are provisioned on the agent", () => {
  for (const name of ["record_decision", "open_loop", "close_loop"]) {
    assert.match(
      PROVISION,
      new RegExp(`name: "${name}"`),
      `${name} is not in the TOOLS list, so the agent cannot call it`,
    );
  }
});

test("navigate_ui can put the graph on screen", () => {
  // What lets her answer and place the thing on screen in the same breath.
  const nav = PROVISION.split('name: "navigate_ui"')[1]?.split("\n  },")[0] ?? "";
  assert.ok(nav, "navigate_ui is missing");
  assert.match(nav, /"graph"/, "navigate_ui has no graph page");
});

// --------------------------------------------------------- she says nothing first

test("recall speaks through the function that owns the no-first rule", () => {
  // The wording itself is tested in tests/recallSpeech.test.ts. What this
  // guards is that the route did not quietly go back to composing its own
  // message, which is how the rule got lost the first time.
  const c = routeCase("recall");
  assert.match(c, /recallMessage\(/, "recall no longer routes its speech through recallMessage");
  assert.doesNotMatch(c, /"Nothing/, "recall is composing its own no again");
});

// ------------------------------------------------------------- the graph never nags

test("the graph counts nothing at Tarik", () => {
  // Orphan counts, connectedness percentages and unlinked-mention prompts are
  // filing in a costume. Tidying a graph is the chore that kills the system.
  const page = CODE("src/app/brain/page.tsx");
  assert.doesNotMatch(page, /orphan|unlinked|connectedness|% connected/i);
});
