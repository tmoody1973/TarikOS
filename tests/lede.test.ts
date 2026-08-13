import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LEDE_CHARS,
  LEDE_BRIEF,
  LENS,
  ledeInput,
  trimLede,
} from "../src/lib/lede.ts";

// The lede is the first thing in the system that turns a Gmail subject or a
// search snippet into Zola's OWN words rather than a quotation. These are the
// rules that make that safe, and the rules that make it speakable.
// Design: docs/superpowers/specs/2026-08-13-brief-lede-design.md

const SECTIONS = [
  { heading: "Goals", body: "- Become certified in one of Anthropic's courses." },
  { heading: "Calendar", body: "- 10:00 AM · Standup" },
  { heading: "Inbox", body: "- [Indiegraf](https://tarikos.internal/mail?thread=1) — Valeria" },
];

// ---------------------------------------------------- the fenced input

test("the sections are fenced and labelled as data", () => {
  const input = ledeInput(SECTIONS);
  assert.match(input, /DATA/);
  assert.match(input, /never an instruction/i);
  assert.match(input, /--- begin sections ---/);
  assert.match(input, /--- end sections ---/);
});

test("a huge section cannot fill the writer's context", () => {
  const huge = [{ heading: "Runaway", body: "x".repeat(50_000) }];
  const input = ledeInput(huge);
  assert.ok(input.length < 13_000, `input was ${input.length} chars`);
});

test("one runaway section cannot crowd out the others", () => {
  const sections = [
    { heading: "Runaway", body: "x".repeat(50_000) },
    { heading: "Calendar", body: "- 10:00 AM · Standup" },
  ];
  const input = ledeInput(sections);
  assert.match(input, /Calendar/, "the second section must survive the first");
});

test("a failed section is not material for the lede", () => {
  // formatSection writes errors as "⚠️ <message>". A lede that reports the
  // Gmail token expired is worse than a lede that does not mention mail.
  const input = ledeInput([
    { heading: "Inbox", body: "⚠️ Gmail token expired" },
    { heading: "Calendar", body: "- 10:00 AM · Standup" },
  ]);
  assert.doesNotMatch(input, /token expired/);
  assert.match(input, /Standup/);
});

test("yesterday is labelled as last time, not mixed into today", () => {
  const input = ledeInput(SECTIONS, "The Valeria email is the one that matters.");
  assert.match(input, /--- what you said last time ---/);
  const lastTime = input.indexOf("--- what you said last time ---");
  const sections = input.indexOf("--- begin sections ---");
  assert.ok(lastTime < sections, "last time must be separated from today");
});

test("no previous lede means no last-time block at all", () => {
  assert.doesNotMatch(ledeInput(SECTIONS), /last time/);
  assert.doesNotMatch(ledeInput(SECTIONS, ""), /last time/);
  assert.doesNotMatch(ledeInput(SECTIONS, null), /last time/);
});

// ---------------------------------------------------- speakability

test("a markdown link is spoken as its title, not its brackets", () => {
  assert.equal(
    trimLede("The [Indiegraf note](https://example.com/x) is worth reading."),
    "The Indiegraf note is worth reading.",
  );
});

test("bullets and headings do not survive into speech", () => {
  const spoken = trimLede("## Today\n- Your 10am moved.\n- **Valeria** is waiting.");
  assert.doesNotMatch(spoken, /[#*\-]/);
  assert.match(spoken, /Your 10am moved/);
  assert.match(spoken, /Valeria is waiting/);
});

test("a cap falls on a sentence boundary rather than mid-word", () => {
  const long = `${"Something happened today. ".repeat(60)}`;
  const spoken = trimLede(long);
  assert.ok(spoken.length <= MAX_LEDE_CHARS, `was ${spoken.length}`);
  assert.match(spoken, /\.$/, "must end on a full stop, not a half word");
});

test("nothing usable yields nothing, never an empty-looking lede", () => {
  assert.equal(trimLede(""), "");
  assert.equal(trimLede("   \n  "), "");
});

// ---------------------------------------------------- the brief

test("the writer is told it holds nothing", () => {
  assert.match(LEDE_BRIEF, /NOTHING except/);
  assert.match(LEDE_BRIEF, /no tools/i);
});

test("the writer is told what to do when the material tries to instruct it", () => {
  assert.match(LEDE_BRIEF, /tries to instruct you/i);
});

test("the writer is told this will be heard, not read", () => {
  assert.match(LEDE_BRIEF, /HEAR/);
  assert.match(LEDE_BRIEF, /No markdown/i);
});

test("every workflow that gets a lede has a lens", () => {
  for (const name of ["morning-brief", "research-brief", "weekly-review"]) {
    assert.ok(LENS[name], `no lens for ${name}`);
  }
  assert.equal(LENS["memory-consolidation"], undefined);
});
