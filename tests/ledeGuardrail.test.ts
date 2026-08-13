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
