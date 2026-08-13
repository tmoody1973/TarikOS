import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The lede at its seams. Source scans rather than unit tests, the shape
// tests/zolaMailGuardrail.test.ts uses, because what matters here is what the
// code is WIRED to rather than what a function returns.
// Design: docs/superpowers/specs/2026-08-13-brief-lede-design.md

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const strip = (s: string) =>
  s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const SCHEMA = read("../convex/schema.ts");
const WORKFLOWS = read("../convex/workflows.ts");

test("the lede is a field on the brief, never a section", () => {
  // A section would inflate sections.length, which get_brief's own message
  // quotes back to Zola, and would become a block with a heading inside
  // briefDigest's loop.
  assert.match(strip(SCHEMA), /lede: v\.optional\(v\.string\(\)\)/);
});

test("finishBrief can store a lede", () => {
  const body = strip(WORKFLOWS).split("export const finishBrief")[1] ?? "";
  assert.ok(body, "finishBrief must exist");
  assert.match(body.slice(0, 900), /lede/);
});

test("only recurring workflows are given the previous brief", () => {
  // research-brief is voice-triggered per topic: its previous run could be
  // about Bandcamp while this one is about Indiegraf, and calling that
  // "last time" would have the writer inventing comparisons.
  const stripped = strip(WORKFLOWS);
  const body = stripped.split("export const briefForLede")[1] ?? "";
  assert.ok(body, "briefForLede must exist");
  // Extract just the function body, bounded by the next export
  const funcBody = body.split(/^export /m)[0] ?? "";
  assert.match(funcBody, /if\s*\(\s*workflow\s*\?\s*\.\s*trigger\s*\.\s*type\s*===\s*["']cron["']/);
});

const ROUTE = read("../src/app/api/tools/[tool]/route.ts");
const PROVISION = read("../scripts/provision-agent.ts");

/** One `case "name": {` block from the tool route, comments stripped. */
function routeCase(name: string): string {
  const body = ROUTE.split(`case "${name}": {`)[1]?.split("\n    }")[0] ?? "";
  assert.ok(body, `no route case for ${name}`);
  return strip(body);
}

test("Zola cannot write her own lede", () => {
  // A runner-only tool, the shape send_brief_digest already established.
  assert.match(ROUTE, /case "write_lede":/);
  assert.doesNotMatch(PROVISION, /name: "write_lede"/);
});

test("the writer call carries no tools", () => {
  const body = routeCase("write_lede");
  assert.doesNotMatch(
    body,
    /tools:/,
    "a lede writer with tools is a mail headline with hands",
  );
});

test("the writer carries none of Tarik's standing context", () => {
  const body = routeCase("write_lede");
  for (const forbidden of ["telos", "standing", "recall", "memories", "getBrief"]) {
    assert.doesNotMatch(
      body,
      new RegExp(forbidden, "i"),
      `the writer must not reach for ${forbidden}`,
    );
  }
});

test("the writer's material goes through the fenced builder", () => {
  const body = routeCase("write_lede");
  assert.match(body, /ledeInput\(/);
  assert.match(body, /LEDE_BRIEF/);
  assert.match(body, /trimLede\(/, "raw model output must never be stored");
});

test("a lede cut off at the token ceiling is never spoken as finished", () => {
  const body = routeCase("write_lede");
  assert.match(
    body,
    /stop_reason\s*===\s*["']max_tokens["']/,
    "trimLede only cuts long output at a sentence boundary — a short truncation must fail loudly instead",
  );
});

const RUNNER = read("../convex/workflowRunner.ts");

test("the lede is written after every section, never during", () => {
  const src = strip(RUNNER);
  const loop = src.indexOf("for (const step of steps)");
  const lede = src.indexOf('callTool("write_lede"');
  assert.ok(loop > 0 && lede > 0, "both steps must exist");
  assert.ok(lede > loop, "the writer must see the whole brief, not half of it");
});

test("a failed lede still leaves a finished brief", () => {
  // The runner's existing rule — a partial brief beats no brief — extends to
  // a brief with no lede beating no brief.
  const src = strip(RUNNER);
  const lede = src.indexOf('callTool("write_lede"');
  const finish = src.indexOf("finishBrief");
  assert.ok(finish > lede, "finishBrief must run after, and unconditionally");
  assert.doesNotMatch(
    src.slice(lede, finish),
    /throw |return;/,
    "nothing between the writer and finishBrief may abandon the run",
  );
});

test("the Telegram digest gets the lede too", () => {
  assert.match(strip(RUNNER), /send_brief_digest[\s\S]{0,200}lede/);
});

test("the runner type-checks the lede before use", () => {
  // A shape cast without verification is a way to break the promise that a
  // failed writer still leaves a finished brief. If the route returns a
  // non-string, we must drop it rather than let it fail inside finishBrief.
  const src = strip(RUNNER);
  assert.match(
    src,
    /typeof\s+raw\s*===\s*["']string["']/,
    "the runner must verify lede is a string before trusting it",
  );
});

test("get_brief speaks the lede when there is one", () => {
  const body = routeCase("get_brief");
  assert.match(body, /lede/, "the lede must reach Zola");
  assert.match(
    body,
    /brief\.lede\s*\?\?|brief\.lede\s*\|\|/,
    "and must fall back to the section wording for briefs built before this",
  );
});

test("the persona sends her to the lede rather than to the sections", () => {
  const morning = PROVISION.split("MORNING BRIEFING")[1]?.slice(0, 500) ?? "";
  assert.ok(morning, "the morning briefing instruction must exist");
  assert.doesNotMatch(
    morning,
    /speak from its sections/i,
    "that instruction is what the lede replaces",
  );
});
