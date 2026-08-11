import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOC_TYPES,
  deriveTitle,
  excerpt,
  plainText,
  templateFor,
  type StudioValue,
} from "../convex/studioLib.ts";

// Studio's pure document logic (MOO-Studio, Phase 1).
//
// Plate stores a Slate value: an array of block nodes, each with a `children`
// array of text nodes or nested blocks. Everything here walks that tree, so
// none of it needs an editor, a browser, or a database to test.
//
// Shapes verified against Plate's own docs before this was written: blocks
// carry `type`, text nodes carry `text` plus mark properties.

const doc: StudioValue = [
  { type: "h1", children: [{ text: "Turnout in the 4th" }] },
  { type: "p", children: [{ text: "The numbers came from " }, { text: "the March brief", bold: true }] },
  { type: "p", children: [{ text: "" }] },
  {
    type: "ul",
    children: [
      // Three levels: ul > li > p > text. This is Plate's real list shape, and
      // it is the fixture that makes the recursion load-bearing — with li > text
      // a non-recursive reader still passes, which is exactly what the first
      // version of this file did.
      { type: "li", children: [{ type: "p", children: [{ text: "first point" }] }] },
      { type: "li", children: [{ type: "p", children: [{ text: "second point" }] }] },
    ],
  },
];

test("plain text walks nested blocks, not just the top level", () => {
  // A list's text lives two levels down. Reading only the top level would
  // silently drop every bullet from search and from what Zola is sent.
  const got = plainText(doc);
  assert.match(got, /first point/);
  assert.match(got, /second point/);
});

test("marks are text, not markup", () => {
  // The bold run is part of the sentence. Losing it would break the sentence
  // rather than just the styling.
  assert.match(plainText(doc), /The numbers came from the March brief/);
});

test("each block becomes its own line", () => {
  // Otherwise the heading runs into the first paragraph and every excerpt
  // starts with two ideas glued together.
  const lines = plainText(doc).split("\n").filter(Boolean);
  assert.equal(lines[0], "Turnout in the 4th");
  assert.equal(lines[1], "The numbers came from the March brief");
});

test("an empty document is empty text, not a crash", () => {
  assert.equal(plainText([]), "");
  assert.equal(plainText([{ type: "p", children: [{ text: "" }] }]).trim(), "");
});

test("a malformed node does not take the whole document down", () => {
  // This runs over content that came back from a database and, later, from a
  // model. A missing `children` must not throw on a page render.
  const bad = [{ type: "p" }, { type: "p", children: [{ text: "survives" }] }] as StudioValue;
  assert.equal(plainText(bad).trim(), "survives");
});

test("the title is the first line with words in it", () => {
  assert.equal(deriveTitle(doc), "Turnout in the 4th");
});

test("leading empty blocks are skipped when deriving a title", () => {
  // Every template opens with an empty heading, so the first block is blank
  // exactly when someone starts typing in the body instead.
  const started: StudioValue = [
    { type: "h1", children: [{ text: "   " }] },
    { type: "p", children: [{ text: "started in the body" }] },
  ];
  assert.equal(deriveTitle(started), "started in the body");
});

test("a template's section heading is never mistaken for the title", () => {
  // Found by using it. The brief template's first line with words in it is
  // "Summary", so every brief in the index was called Summary — five documents
  // that look identical in the one place they have to be told apart.
  const brief = templateFor("brief");
  assert.equal(deriveTitle(brief), "", "an untouched template has no title yet");

  const written: StudioValue = [
    { type: "h1", children: [{ text: "" }] },
    { type: "h2", children: [{ text: "Summary" }] },
    { type: "p", children: [{ text: "Turnout held up against the early numbers." }] },
  ];
  assert.equal(deriveTitle(written), "Turnout held up against the early numbers.");
});

test("a typed h1 beats the body it sits above", () => {
  const titled: StudioValue = [
    { type: "h1", children: [{ text: "Turnout in the 4th" }] },
    { type: "h2", children: [{ text: "Summary" }] },
    { type: "p", children: [{ text: "the body" }] },
  ];
  assert.equal(deriveTitle(titled), "Turnout in the 4th");
});

test("a document with no words has no derived title", () => {
  assert.equal(deriveTitle([{ type: "p", children: [{ text: "  " }] }]), "");
});

test("a long first line is cut short rather than used whole", () => {
  // The title sits in a nav breadcrumb and an index row. An unbounded one
  // breaks both layouts, and the document index is the first screen.
  const long = "x".repeat(300);
  const got = deriveTitle([{ type: "p", children: [{ text: long }] }]);
  assert.ok(got.length < 300, "title must be bounded");
  assert.ok(got.length > 20, "and not truncated to uselessness");
});

test("an excerpt stops at a word, not mid-word", () => {
  // Asserted exactly, not by pattern. The first version used a limit of 30,
  // which happens to land on the end of "numbers" — so a naive slice passed it
  // and the mutation that removed the word-boundary logic survived.
  // 27 lands inside "numbers"; the correct answer backs up to the space.
  assert.equal(excerpt(doc, 27), "Turnout in the 4th The…");
});

test("one very long word is cut hard rather than erased", () => {
  // The fallback branch: backing up to the last space would leave almost
  // nothing when a single word is longer than the whole budget.
  const got = excerpt([{ type: "p", children: [{ text: "a".repeat(80) }] }], 20);
  assert.equal(got, `${"a".repeat(20)}…`);
});

test("an excerpt shorter than the limit gets no ellipsis", () => {
  const got = excerpt([{ type: "p", children: [{ text: "short" }] }], 100);
  assert.equal(got, "short");
});

test("every document type has a template", () => {
  for (const type of DOC_TYPES) {
    const value = templateFor(type);
    assert.ok(Array.isArray(value) && value.length > 0, `${type} has no template`);
  }
});

test("a brief template carries the five sections the PRD names", () => {
  const text = plainText(templateFor("brief")).toLowerCase();
  for (const heading of ["summary", "context", "findings", "recommendation", "next steps"]) {
    assert.match(text, new RegExp(heading), `brief template missing ${heading}`);
  }
});

test("a plan template carries its own sections, not the brief's", () => {
  // Guards the copy-paste failure: five templates built from one another,
  // where two silently share a body.
  const text = plainText(templateFor("plan")).toLowerCase();
  for (const heading of ["objective", "outcomes", "milestones", "actions", "risks"]) {
    assert.match(text, new RegExp(heading), `plan template missing ${heading}`);
  }
  assert.ok(!text.includes("recommendation"), "plan template leaked the brief's sections");
});

test("a decision template carries its own sections", () => {
  const text = plainText(templateFor("decision")).toLowerCase();
  for (const heading of ["context", "options", "decision", "rationale", "consequences"]) {
    assert.match(text, new RegExp(heading), `decision template missing ${heading}`);
  }
});

test("a note starts empty enough to just type into", () => {
  // The point of a note is that it does not impose a shape.
  assert.ok(plainText(templateFor("note")).trim().length === 0);
});

test("no two templates are the same document", () => {
  // The mutation this kills: templateFor returning one shared value for
  // several types. Comparing only two would pass while three collided.
  const seen = new Map<string, string>();
  for (const type of DOC_TYPES) {
    const key = JSON.stringify(templateFor(type));
    const clash = seen.get(key);
    assert.ok(!clash, `${type} and ${clash} have identical templates`);
    seen.set(key, type);
  }
});

test("templates are fresh objects, never a shared one", () => {
  // Returning a module-level constant would let one document's first edit
  // mutate the template every later document is created from.
  const a = templateFor("brief");
  const b = templateFor("brief");
  assert.notEqual(a, b, "same object handed out twice");
  a[0].children[0].text = "clobbered";
  assert.notEqual(b[0].children[0].text, "clobbered", "templates share nested state");
});
