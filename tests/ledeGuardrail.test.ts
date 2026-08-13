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
  assert.match(SCHEMA, /lede: v\.optional\(v\.string\(\)\)/);
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
  const body = strip(WORKFLOWS).split("export const briefForLede")[1] ?? "";
  assert.ok(body, "briefForLede must exist");
  assert.match(body, /trigger.*cron|cron.*trigger/s);
});
